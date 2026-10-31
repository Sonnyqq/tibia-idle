import { randomUUID } from 'node:crypto';
import { buildApiServer } from '@tibia-idle/api';
import {
  type CharacterDto,
  ClaimHuntRewardResponseSchema,
  MoveInventoryItemResponseSchema,
  SplitInventoryStackResponseSchema,
  type UserDto
} from '@tibia-idle/contracts';
import {
  applyMigrations,
  claimHuntReward,
  createDatabasePool,
  getCharacterContainers,
  getCharacterInventory,
  loadMigrationsFromDir,
  moveInventoryItem,
  reconcileCharacterEconomy,
  resolveTestDatabaseConfig,
  splitInventoryStack
} from '@tibia-idle/database';
import {
  createFixedClock,
  ITEM_DEFINITIONS
} from '@tibia-idle/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('IDLE-005A — Persistent Inventory, Backpack, Capacity & AFK Loot Claim Integration Tests', () => {
  const dbConfig = resolveTestDatabaseConfig(process.env);
  const pool = createDatabasePool(dbConfig);

  beforeAll(async () => {
    const migrations = loadMigrationsFromDir();
    await applyMigrations(pool, migrations);
    await pool.query(
      'TRUNCATE TABLE inventory_movements, inventory_instances, inventory_containers, currency_ledger, hunt_reward_items, hunt_segments, hunts, characters, sessions, users RESTART IDENTITY CASCADE'
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createTestAccountAndCharacter(
    name: string,
    vocation: 'knight' | 'paladin' | 'sorcerer' | 'druid' = 'knight'
  ): Promise<{ user: UserDto; character: CharacterDto; sessionCookie: string; csrfToken: string }> {
    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({
      dbPool: pool,
      clock
    });
    await server.ready();

    const email = `hero_${randomUUID()}@example.com`;
    const password = 'StrongPassword123!';

    const regRes = await server.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password, locale: 'pl' }
    });
    expect(regRes.statusCode).toBe(201);
    const regJson = regRes.json();
    const rawSetCookie = Array.isArray(regRes.headers['set-cookie'])
      ? regRes.headers['set-cookie'][0]
      : (regRes.headers['set-cookie'] as string);
    const sessionCookie = (rawSetCookie ?? '').split(';')[0] ?? '';
    const csrfToken = regJson.csrfToken as string;

    const charRes = await server.inject({
      method: 'POST',
      url: '/characters',
      headers: {
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: { name, vocation }
    });
    expect(charRes.statusCode).toBe(201);
    const char = charRes.json() as CharacterDto;

    await server.close();
    return {
      user: regJson.user,
      character: char,
      sessionCookie,
      csrfToken
    };
  }

  it('proves all 12 domain items have valid server configurations, positive weights and stackability rules', () => {
    expect(ITEM_DEFINITIONS).toHaveLength(12);
    for (const item of ITEM_DEFINITIONS) {
      expect(item.itemId).toBeTruthy();
      expect(item.weightUnits).toBeGreaterThan(0);
      expect(Number.isSafeInteger(item.weightUnits)).toBe(true);
      if (item.stackable) {
        expect(item.maxStackSize).toBe(100);
      } else {
        expect(item.maxStackSize).toBe(1);
        expect(item.equipmentSlot).toBeDefined();
      }
    }
  });

  it('creates 20-slot starting backpack automatically on character creation', async () => {
    const { character } = await createTestAccountAndCharacter('Backpack Hero');

    const containers = await getCharacterContainers(pool, character.id);
    expect(containers).toHaveLength(1);
    expect(containers[0]?.containerType).toBe('backpack');
    expect(containers[0]?.slotCapacity).toBe(20);
    expect(containers[0]?.occupiedSlots).toBe(0);

    const inv = await getCharacterInventory(pool, character.id);
    expect(inv.container.slotCapacity).toBe(20);
    expect(inv.slots).toHaveLength(0);
    expect(inv.capacity.occupiedSlots).toBe(0);
    expect(inv.capacity.maxSlots).toBe(20);
    expect(inv.capacity.currentWeight).toBe(0);
    expect(inv.capacity.maxWeight).toBe(5000); // Knight base capacity
    expect(inv.capacity.remainingCapacity).toBe(5000);
  });

  it('claims hunt rewards into backpack, stacks items, handles non-stackables, and respects capacity & full inventory', async () => {
    const { character, sessionCookie, csrfToken } =
      await createTestAccountAndCharacter('Claim Specialist');
    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    try {
      // 1. Manually insert hunt, hunt_segment, and reward items for testing claim
      const huntId = randomUUID();
      const segmentId = randomUUID();
      const now = new Date();

      await pool.query(
        `INSERT INTO hunts (
           id, character_id, start_idempotency_key, zone_id, strategy, status,
           started_at, settled_until, completed_at, simulation_version, config_digest, private_checkpoint,
           reserved_hp_potions, reserved_mp_potions, potions_returned, row_version
         )
         VALUES ($1, $2, 'start-key-claim', 'damp-catacombs', 'balanced', 'COMPLETED', $3, $3, $3, '1.0.0', 'digest', '{}'::jsonb, 0, 0, true, 1)`,
        [huntId, character.id, now]
      );

      await pool.query(
        `INSERT INTO hunt_segments (
           id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version,
           segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, is_partial, rewards
         )
         VALUES ($1, $2, 'seg-1', 1, 2, $3, $3, 60000, 10, 'TIME_REACHED', false, $4::jsonb)`,
        [
          segmentId,
          huntId,
          now,
          JSON.stringify({
            deltaGoldGained: 50,
            deltaXpGained: 100,
            deltaLootByItem: {
              'copper-coin': 40,
              'rat-pelt': 10,
              'rusted-blade': 1
            }
          })
        ]
      );

      const rewardCoinId = randomUUID();
      const rewardPeltId = randomUUID();
      const rewardBladeId = randomUUID();

      await pool.query(
        `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state, created_at)
         VALUES
           ($1, $4, $5, $6, 'copper-coin', 40, 'UNCLAIMED', $7),
           ($2, $4, $5, $6, 'rat-pelt', 10, 'UNCLAIMED', $7),
           ($3, $4, $5, $6, 'rusted-blade', 1, 'UNCLAIMED', $7)`,
        [rewardCoinId, rewardPeltId, rewardBladeId, huntId, segmentId, character.id, now]
      );

      // Check initial inbox GET
      const inboxRes = await server.inject({
        method: 'GET',
        url: `/characters/${character.id}/hunt-rewards`,
        headers: { cookie: sessionCookie }
      });
      expect(inboxRes.statusCode).toBe(200);
      expect(inboxRes.json().items).toHaveLength(3);

      // 2. Claim first reward: 40 copper coins
      const claim1Res = await server.inject({
        method: 'POST',
        url: `/characters/${character.id}/hunt-rewards/${rewardCoinId}/claim`,
        headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
        payload: { idempotencyKey: 'claim-key-1' }
      });
      expect(claim1Res.statusCode).toBe(200);
      const claim1 = ClaimHuntRewardResponseSchema.parse(claim1Res.json());
      expect(claim1.claimedItem.itemId).toBe('copper-coin');
      expect(claim1.claimedItem.quantity).toBe(40);
      expect(claim1.claimedItem.ownershipState).toBe('CLAIMED');
      expect(claim1.inventory.slots).toHaveLength(1);
      expect(claim1.inventory.slots[0]?.slotIndex).toBe(0);
      expect(claim1.inventory.slots[0]?.itemId).toBe('copper-coin');
      expect(claim1.inventory.slots[0]?.quantity).toBe(40);
      expect(claim1.inventory.capacity.currentWeight).toBe(40); // 40 * 1 = 40

      // Idempotent retry of same key returns original response
      const retryClaim1Res = await server.inject({
        method: 'POST',
        url: `/characters/${character.id}/hunt-rewards/${rewardCoinId}/claim`,
        headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
        payload: { idempotencyKey: 'claim-key-1' }
      });
      expect(retryClaim1Res.statusCode).toBe(200);
      const retryClaim1 = ClaimHuntRewardResponseSchema.parse(retryClaim1Res.json());
      expect(retryClaim1.idempotentReplay).toBe(true);
      expect(retryClaim1.inventory.slots).toHaveLength(1);

      // Claiming already claimed reward with a DIFFERENT key returns 409 REWARD_ALREADY_CLAIMED
      const diffKeyClaimRes = await server.inject({
        method: 'POST',
        url: `/characters/${character.id}/hunt-rewards/${rewardCoinId}/claim`,
        headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
        payload: { idempotencyKey: 'different-claim-key' }
      });
      expect(diffKeyClaimRes.statusCode).toBe(409);
      expect(diffKeyClaimRes.json().error.code).toBe('REWARD_ALREADY_CLAIMED');

      // 3. Claim non-stackable reward: rusted-blade (weight 250)
      const claimBladeRes = await server.inject({
        method: 'POST',
        url: `/characters/${character.id}/hunt-rewards/${rewardBladeId}/claim`,
        headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
        payload: { idempotencyKey: 'claim-blade-key' }
      });
      expect(claimBladeRes.statusCode).toBe(200);
      const claimBlade = ClaimHuntRewardResponseSchema.parse(claimBladeRes.json());
      expect(claimBlade.inventory.slots).toHaveLength(2);
      expect(claimBlade.inventory.capacity.currentWeight).toBe(290); // 40 + 250 = 290

      // 4. Claim 10 rat-pelts (weight 50)
      const claimPeltRes = await server.inject({
        method: 'POST',
        url: `/characters/${character.id}/hunt-rewards/${rewardPeltId}/claim`,
        headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
        payload: { idempotencyKey: 'claim-pelt-key' }
      });
      expect(claimPeltRes.statusCode).toBe(200);
      const claimPelt = ClaimHuntRewardResponseSchema.parse(claimPeltRes.json());
      expect(claimPelt.inventory.slots).toHaveLength(3);
      expect(claimPelt.inventory.capacity.currentWeight).toBe(340); // 290 + 50 = 340
    } finally {
      await server.close();
    }
  });

  it('handles stack splitting, item moving, stack merging, and slot swapping', async () => {
    const { character, sessionCookie, csrfToken } =
      await createTestAccountAndCharacter('Stack Manager');
    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    try {
      // Setup inventory: insert 50 copper coins at slot 0, and 1 rusted-blade at slot 1
      const containerRes = await pool.query<{ id: string }>(
        'SELECT id FROM inventory_containers WHERE character_id = $1 AND container_type = $2',
        [character.id, 'backpack']
      );
      const containerRow = containerRes.rows[0];
      if (!containerRow) throw new Error('Container not found');
      const containerId = containerRow.id;

      await pool.query(
        `INSERT INTO inventory_instances (id, character_id, container_id, slot_index, item_id, quantity)
         VALUES
           ($1, $2, $3, 0, 'copper-coin', 50),
           ($4, $2, $3, 1, 'rusted-blade', 1)`,
        [randomUUID(), character.id, containerId, randomUUID()]
      );

      // 1. Split stack: split 20 coins from slot 0 into empty slot 5
      const splitRes = await server.inject({
        method: 'POST',
        url: `/characters/${character.id}/inventory/split`,
        headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
        payload: { fromSlot: 0, toSlot: 5, quantity: 20, idempotencyKey: 'split-key-1' }
      });
      expect(splitRes.statusCode).toBe(200);
      const splitJson = SplitInventoryStackResponseSchema.parse(splitRes.json());
      expect(splitJson.inventory.slots).toHaveLength(3);

      const slot0 = splitJson.inventory.slots.find((s) => s.slotIndex === 0);
      const slot5 = splitJson.inventory.slots.find((s) => s.slotIndex === 5);
      expect(slot0?.quantity).toBe(30);
      expect(slot5?.quantity).toBe(20);

      // 2. Move item: move the 20 coins from slot 5 to empty slot 6
      const moveRes = await server.inject({
        method: 'POST',
        url: `/characters/${character.id}/inventory/move`,
        headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
        payload: { fromSlot: 5, toSlot: 6, idempotencyKey: 'move-key-1' }
      });
      expect(moveRes.statusCode).toBe(200);
      const moveJson = MoveInventoryItemResponseSchema.parse(moveRes.json());
      expect(moveJson.action).toBe('MOVED');
      expect(moveJson.inventory.slots.find((s) => s.slotIndex === 5)).toBeUndefined();
      expect(moveJson.inventory.slots.find((s) => s.slotIndex === 6)?.quantity).toBe(20);

      // 3. Merge stacks: move 20 coins from slot 6 back into slot 0 (which has 30 coins)
      const mergeRes = await server.inject({
        method: 'POST',
        url: `/characters/${character.id}/inventory/move`,
        headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
        payload: { fromSlot: 6, toSlot: 0, idempotencyKey: 'merge-key-1' }
      });
      expect(mergeRes.statusCode).toBe(200);
      const mergeJson = MoveInventoryItemResponseSchema.parse(mergeRes.json());
      expect(mergeJson.action).toBe('MERGED');
      expect(mergeJson.inventory.slots).toHaveLength(2);
      expect(mergeJson.inventory.slots.find((s) => s.slotIndex === 0)?.quantity).toBe(50);
      expect(mergeJson.inventory.slots.find((s) => s.slotIndex === 6)).toBeUndefined();

      // 4. Swap slots: move slot 0 (coins) to slot 1 (rusted-blade) -> SWAPPED!
      const swapRes = await server.inject({
        method: 'POST',
        url: `/characters/${character.id}/inventory/move`,
        headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
        payload: { fromSlot: 0, toSlot: 1, idempotencyKey: 'swap-key-1' }
      });
      expect(swapRes.statusCode).toBe(200);
      const swapJson = MoveInventoryItemResponseSchema.parse(swapRes.json());
      expect(swapJson.action).toBe('SWAPPED');
      expect(swapJson.inventory.slots.find((s) => s.slotIndex === 0)?.itemId).toBe('rusted-blade');
      expect(swapJson.inventory.slots.find((s) => s.slotIndex === 1)?.itemId).toBe('copper-coin');
    } finally {
      await server.close();
    }
  });

  it('rejects claim when backpack is full or capacity exceeded, leaving reward UNCLAIMED', async () => {
    const { character, sessionCookie, csrfToken } =
      await createTestAccountAndCharacter('Full Backpack');
    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    try {
      const containerRes = await pool.query<{ id: string }>(
        'SELECT id FROM inventory_containers WHERE character_id = $1 AND container_type = $2',
        [character.id, 'backpack']
      );
      const containerRow = containerRes.rows[0];
      if (!containerRow) throw new Error('Container not found');
      const containerId = containerRow.id;

      // Fill all 20 slots with 1 copper-coin each (20 weight total, well below 5000 cap)
      for (let s = 0; s < 20; s++) {
        await pool.query(
          `INSERT INTO inventory_instances (id, character_id, container_id, slot_index, item_id, quantity)
           VALUES ($1, $2, $3, $4, 'copper-coin', 1)`,
          [randomUUID(), character.id, containerId, s]
        );
      }

      // Insert reward for a non-stackable item that cannot merge into existing slots
      const rewardId = randomUUID();
      const huntId = randomUUID();
      const segId = randomUUID();
      await pool.query(
        `INSERT INTO hunts (id, character_id, start_idempotency_key, zone_id, strategy, status, started_at, settled_until, completed_at, simulation_version, config_digest, private_checkpoint, reserved_hp_potions, reserved_mp_potions, potions_returned)
         VALUES ($1, $2, 'full-test', 'damp-catacombs', 'balanced', 'COMPLETED', NOW(), NOW(), NOW(), '1.0.0', 'd', '{}'::jsonb, 0, 0, true)`,
        [huntId, character.id]
      );
      await pool.query(
        `INSERT INTO hunt_segments (id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version, segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, rewards)
         VALUES ($1, $2, 's1', 1, 2, NOW(), NOW(), 1000, 1, 'TIME_REACHED', '{"deltaLootByItem":{"silver-ring":1}}'::jsonb)`,
        [segId, huntId]
      );
      await pool.query(
        `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
         VALUES ($1, $2, $3, $4, 'silver-ring', 1, 'UNCLAIMED')`,
        [rewardId, huntId, segId, character.id]
      );

      // Attempt to claim when slots full -> 400 INVENTORY_FULL
      const fullRes = await server.inject({
        method: 'POST',
        url: `/characters/${character.id}/hunt-rewards/${rewardId}/claim`,
        headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
        payload: { idempotencyKey: 'claim-full-fail' }
      });
      expect(fullRes.statusCode).toBe(400);
      expect(fullRes.json().error.code).toBe('INVENTORY_FULL');

      // Verify reward remains strictly UNCLAIMED
      const rewardCheck = await pool.query<{ ownership_state: string }>(
        'SELECT ownership_state FROM hunt_reward_items WHERE id = $1',
        [rewardId]
      );
      expect(rewardCheck.rows[0]?.ownership_state).toBe('UNCLAIMED');

      // Now clear 1 slot so space exists, but create an ultra heavy reward exceeding 5000 max capacity
      await pool.query(
        'DELETE FROM inventory_instances WHERE character_id = $1 AND slot_index = 19',
        [character.id]
      );
      const heavyRewardId = randomUUID();
      await pool.query(
        `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
         VALUES ($1, $2, $3, $4, 'rusted-blade', 30, 'UNCLAIMED')`, // 30 * 250 = 7500 > 5000 cap!
        [heavyRewardId, huntId, segId, character.id]
      );

      const capRes = await server.inject({
        method: 'POST',
        url: `/characters/${character.id}/hunt-rewards/${heavyRewardId}/claim`,
        headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
        payload: { idempotencyKey: 'claim-cap-fail' }
      });
      expect(capRes.statusCode).toBe(400);
      expect(capRes.json().error.code).toBe('CAPACITY_EXCEEDED');

      // Verify no extra item instance was created beyond the 19 slots
      const countRes = await pool.query<{ count: string }>(
        'SELECT count(*) FROM inventory_instances WHERE character_id = $1',
        [character.id]
      );
      expect(Number(countRes.rows[0]?.count)).toBe(19);
    } finally {
      await server.close();
    }
  });

  it('prevents double claims under 20 concurrent parallel requests without duplicating items', async () => {
    const { character } = await createTestAccountAndCharacter('Concurrent Claimer');

    const rewardId = randomUUID();
    const huntId = randomUUID();
    const segId = randomUUID();
    await pool.query(
      `INSERT INTO hunts (id, character_id, start_idempotency_key, zone_id, strategy, status, started_at, settled_until, completed_at, simulation_version, config_digest, private_checkpoint, reserved_hp_potions, reserved_mp_potions, potions_returned)
       VALUES ($1, $2, 'concurrent-test', 'damp-catacombs', 'balanced', 'COMPLETED', NOW(), NOW(), NOW(), '1.0.0', 'd', '{}'::jsonb, 0, 0, true)`,
      [huntId, character.id]
    );
    await pool.query(
      `INSERT INTO hunt_segments (id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version, segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, rewards)
       VALUES ($1, $2, 's1', 1, 2, NOW(), NOW(), 1000, 1, 'TIME_REACHED', '{"deltaLootByItem":{"chitin-plate":5}}'::jsonb)`,
      [segId, huntId]
    );
    await pool.query(
      `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
       VALUES ($1, $2, $3, $4, 'chitin-plate', 5, 'UNCLAIMED')`,
      [rewardId, huntId, segId, character.id]
    );

    // Launch 20 concurrent claims on the same rewardId (each with distinct idempotencyKey)
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        claimHuntReward(pool, {
          characterId: character.id,
          rewardId,
          idempotencyKey: `concurrent-claim-${i}`
        })
      )
    );

    const successCount = results.filter((r) => r.status === 'SUCCESS').length;
    const alreadyClaimedCount = results.filter((r) => r.status === 'REWARD_ALREADY_CLAIMED').length;

    expect(successCount).toBe(1);
    expect(alreadyClaimedCount).toBe(19);

    // Verify DB: exactly 1 instance created with quantity 5
    const instRes = await pool.query<{ quantity: number }>(
      'SELECT quantity FROM inventory_instances WHERE character_id = $1',
      [character.id]
    );
    expect(instRes.rows).toHaveLength(1);
    expect(instRes.rows[0]?.quantity).toBe(5);

    // Verify exactly 1 movement recorded
    const moveRes = await pool.query<{ count: string }>(
      `SELECT count(*) FROM inventory_movements WHERE character_id = $1 AND operation_type = 'CLAIM_HUNT_REWARD'`,
      [character.id]
    );
    expect(Number(moveRes.rows[0]?.count)).toBe(1);
  });

  it('reconciles economy: totalSettledLoot = unclaimedInboxLoot + claimedInventoryLoot across migrations & inventory moves', async () => {
    const { character } = await createTestAccountAndCharacter('Recon Master');

    // 1. Simulate settled hunt with 2 segments
    const huntId = randomUUID();
    const seg1Id = randomUUID();
    const seg2Id = randomUUID();
    const now = new Date();

    await pool.query(
      `INSERT INTO hunts (id, character_id, start_idempotency_key, zone_id, strategy, status, started_at, settled_until, completed_at, simulation_version, config_digest, private_checkpoint, reserved_hp_potions, reserved_mp_potions, potions_returned)
       VALUES ($1, $2, 'recon-test', 'damp-catacombs', 'balanced', 'COMPLETED', $3, $3, $3, '1.0.0', 'd', '{}'::jsonb, 0, 0, true)`,
      [huntId, character.id, now]
    );

    await pool.query(
      `INSERT INTO hunt_segments (id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version, segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, rewards)
       VALUES
         ($1, $3, 's1', 1, 2, $4, $4, 60000, 10, 'TIME_REACHED', '{"deltaGoldGained":100,"deltaXpGained":200,"deltaLootByItem":{"ancient-bone":4,"glow-moss":10}}'::jsonb),
         ($2, $3, 's2', 2, 3, $4, $4, 60000, 10, 'TIME_REACHED', '{"deltaGoldGained":50,"deltaXpGained":100,"deltaLootByItem":{"ancient-bone":2,"drake-scale":1}}'::jsonb)`,
      [seg1Id, seg2Id, huntId, now]
    );

    const rBone1 = randomUUID();
    const rMoss = randomUUID();
    const rBone2 = randomUUID();
    const rScale = randomUUID();

    await pool.query(
      `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
       VALUES
         ($1, $5, $6, $7, 'ancient-bone', 4, 'UNCLAIMED'),
         ($2, $5, $6, $7, 'glow-moss', 10, 'UNCLAIMED'),
         ($3, $5, $8, $7, 'ancient-bone', 2, 'UNCLAIMED'),
         ($4, $5, $8, $7, 'drake-scale', 1, 'UNCLAIMED')`,
      [rBone1, rMoss, rBone2, rScale, huntId, seg1Id, character.id, seg2Id]
    );

    // Initial reconciliation: all items are in UNCLAIMED inbox
    const recInitial = await reconcileCharacterEconomy(pool, character.id);
    expect(recInitial.isLootReconciled).toBe(true);
    expect(recInitial.totalSettledItemsByCode['ancient-bone']).toBe(6);
    expect(recInitial.totalUnclaimedItemsByCode['ancient-bone']).toBe(6);
    expect(recInitial.totalClaimedItemsByCode['ancient-bone'] ?? 0).toBe(0);

    // Claim rBone1 (4 ancient-bones)
    const claimRes = await claimHuntReward(pool, {
      characterId: character.id,
      rewardId: rBone1,
      idempotencyKey: 'recon-claim-bone-1'
    });
    expect(claimRes.status).toBe('SUCCESS');

    // Split and move stack inside inventory
    await splitInventoryStack(pool, {
      characterId: character.id,
      fromSlot: 0,
      toSlot: 4,
      quantity: 2,
      idempotencyKey: 'recon-split-1'
    });
    await moveInventoryItem(pool, {
      characterId: character.id,
      fromSlot: 4,
      toSlot: 8,
      idempotencyKey: 'recon-move-1'
    });

    // Post-claim reconciliation:
    // ancient-bone: 6 settled = 2 unclaimed (rBone2) + 4 claimed (rBone1)
    const recAfterClaim = await reconcileCharacterEconomy(pool, character.id);
    expect(recAfterClaim.isLootReconciled).toBe(true);
    expect(recAfterClaim.totalSettledItemsByCode['ancient-bone']).toBe(6);
    expect(recAfterClaim.totalUnclaimedItemsByCode['ancient-bone']).toBe(2);
    expect(recAfterClaim.totalClaimedItemsByCode['ancient-bone']).toBe(4);
    expect(recAfterClaim.totalMovementClaimedItemsByCode['ancient-bone']).toBe(4);
  });

  it('enforces IDOR character ownership isolation and rejects tampering', async () => {
    const userA = await createTestAccountAndCharacter('Alice Knight');
    const userB = await createTestAccountAndCharacter('Bob Knight');

    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    try {
      // User A attempts to read User B's inventory -> 404
      const idorInvRes = await server.inject({
        method: 'GET',
        url: `/characters/${userB.character.id}/inventory`,
        headers: { cookie: userA.sessionCookie }
      });
      expect(idorInvRes.statusCode).toBe(404);

      // User A attempts to move User B's inventory items -> 404
      const idorMoveRes = await server.inject({
        method: 'POST',
        url: `/characters/${userB.character.id}/inventory/move`,
        headers: { cookie: userA.sessionCookie, 'x-csrf-token': userA.csrfToken },
        payload: { fromSlot: 0, toSlot: 1, idempotencyKey: 'idor-key' }
      });
      expect(idorMoveRes.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('guarantees atomicity and idempotency across pre-commit crash and post-commit response drop', async () => {
    const { character } = await createTestAccountAndCharacter('Crash Tester');

    const rewardId = randomUUID();
    const huntId = randomUUID();
    const segId = randomUUID();
    await pool.query(
      `INSERT INTO hunts (id, character_id, start_idempotency_key, zone_id, strategy, status, started_at, settled_until, completed_at, simulation_version, config_digest, private_checkpoint, reserved_hp_potions, reserved_mp_potions, potions_returned)
       VALUES ($1, $2, 'crash-hunt', 'damp-catacombs', 'balanced', 'COMPLETED', NOW(), NOW(), NOW(), '1.0.0', 'd', '{}'::jsonb, 0, 0, true)`,
      [huntId, character.id]
    );
    await pool.query(
      `INSERT INTO hunt_segments (id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version, segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, rewards)
       VALUES ($1, $2, 's1', 1, 2, NOW(), NOW(), 1000, 1, 'TIME_REACHED', '{"deltaLootByItem":{"ancient-bone":5}}'::jsonb)`,
      [segId, huntId]
    );
    await pool.query(
      `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
       VALUES ($1, $2, $3, $4, 'ancient-bone', 5, 'UNCLAIMED')`,
      [rewardId, huntId, segId, character.id]
    );

    // 1. Crash before commit via fault hook
    await expect(
      claimHuntReward(pool, {
        characterId: character.id,
        rewardId,
        idempotencyKey: 'crash-key-pre',
        faultHook: async (stage) => {
          if (stage === 'BEFORE_COMMIT') {
            throw new Error('SIMULATED_PRE_COMMIT_DATABASE_CRASH');
          }
        }
      })
    ).rejects.toThrow('SIMULATED_PRE_COMMIT_DATABASE_CRASH');

    // Reward must remain UNCLAIMED and no items in inventory
    const checkPre = await pool.query<{ ownership_state: string }>(
      'SELECT ownership_state FROM hunt_reward_items WHERE id = $1',
      [rewardId]
    );
    expect(checkPre.rows[0]?.ownership_state).toBe('UNCLAIMED');

    const invPre = await getCharacterInventory(pool, character.id);
    expect(invPre.slots).toHaveLength(0);

    // 2. Crash after commit (response lost)
    await expect(
      claimHuntReward(pool, {
        characterId: character.id,
        rewardId,
        idempotencyKey: 'crash-key-post',
        faultHook: async (stage) => {
          if (stage === 'AFTER_COMMIT') {
            throw new Error('SIMULATED_POST_COMMIT_NETWORK_DROP');
          }
        }
      })
    ).rejects.toThrow('SIMULATED_POST_COMMIT_NETWORK_DROP');

    // DB committed: reward is CLAIMED and inventory has the item
    const checkPost = await pool.query<{ ownership_state: string }>(
      'SELECT ownership_state FROM hunt_reward_items WHERE id = $1',
      [rewardId]
    );
    expect(checkPost.rows[0]?.ownership_state).toBe('CLAIMED');

    // Client retries with the SAME idempotency key -> returns idempotent replay
    const retryRes = await claimHuntReward(pool, {
      characterId: character.id,
      rewardId,
      idempotencyKey: 'crash-key-post'
    });
    expect(retryRes.status).toBe('SUCCESS');
    if (retryRes.status === 'SUCCESS') {
      expect(retryRes.idempotentReplay).toBe(true);
      expect(retryRes.inventory.slots).toHaveLength(1);
      expect(retryRes.inventory.slots[0]?.quantity).toBe(5);
    }
  });

  it('P0: rejects idempotency payload conflict on claim, move, and split with HTTP 409', async () => {
    const { character, sessionCookie, csrfToken } = await createTestAccountAndCharacter('IdempConflict');
    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({ dbPool: pool, clock });
    await server.ready();

    const huntId = randomUUID();
    const segId = randomUUID();
    await pool.query(
      `INSERT INTO hunts (id, character_id, start_idempotency_key, zone_id, strategy, status, started_at, settled_until, completed_at, simulation_version, config_digest, private_checkpoint, reserved_hp_potions, reserved_mp_potions, potions_returned, row_version)
       VALUES ($1, $2, $3, 'damp-catacombs', 'balanced', 'COMPLETED', NOW() - INTERVAL '1 hour', NOW(), NOW(), '1.0.0', 'hash', '{"simulatedEvents":10}'::jsonb, 0, 0, true, 1)`,
      [huntId, character.id, randomUUID()]
    );
    await pool.query(
      `INSERT INTO hunt_segments (id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version, segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, is_partial, rewards, committed_at)
       VALUES ($1, $2, $3, 1, 2, NOW() - INTERVAL '1 hour', NOW(), 3600000, 10, 'TIME_REACHED', false, '{"deltaXpGained":100,"deltaGoldGained":50,"deltaLootByItem":{"copper-coin":20,"rusted-blade":1}}'::jsonb, NOW())`,
      [segId, huntId, randomUUID()]
    );

    const rewardA = randomUUID();
    const rewardB = randomUUID();
    await pool.query(
      `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
       VALUES
         ($1, $2, $3, $4, 'copper-coin', 20, 'UNCLAIMED'),
         ($5, $2, $3, $4, 'rusted-blade', 1, 'UNCLAIMED')`,
      [rewardA, huntId, segId, character.id, rewardB]
    );

    // 1. Claim reward A with key K1 via API -> SUCCESS (200)
    const claimARes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/hunt-rewards/${rewardA}/claim`,
      headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
      payload: { idempotencyKey: 'shared-claim-key' }
    });
    expect(claimARes.statusCode).toBe(200);
    const claimABody = claimARes.json() as { idempotentReplay: boolean };
    expect(claimABody.idempotentReplay).toBe(false);

    // 2. Claim reward B with the SAME key K1 via API -> 409 IDEMPOTENCY_KEY_CONFLICT
    const claimBConflictRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/hunt-rewards/${rewardB}/claim`,
      headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
      payload: { idempotencyKey: 'shared-claim-key' }
    });
    expect(claimBConflictRes.statusCode).toBe(409);
    const conflictBody = claimBConflictRes.json() as { error: { code: string; messageKey: string } };
    expect(conflictBody.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(conflictBody.error.messageKey).toBe('error.idempotencyConflict');

    // Reward B must remain UNCLAIMED and zero duplicates
    const checkB = await pool.query<{ ownership_state: string }>(
      'SELECT ownership_state FROM hunt_reward_items WHERE id = $1',
      [rewardB]
    );
    expect(checkB.rows[0]?.ownership_state).toBe('UNCLAIMED');

    // Direct repository call returns IDEMPOTENCY_KEY_CONFLICT
    const directConflict = await claimHuntReward(pool, {
      characterId: character.id,
      rewardId: rewardB,
      idempotencyKey: 'shared-claim-key'
    });
    expect(directConflict.status).toBe('IDEMPOTENCY_KEY_CONFLICT');

    // Replay on reward A with same key K1 -> 200 SUCCESS idempotentReplay
    const replayARes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/hunt-rewards/${rewardA}/claim`,
      headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
      payload: { idempotencyKey: 'shared-claim-key' }
    });
    expect(replayARes.statusCode).toBe(200);
    const replayABody = replayARes.json() as { idempotentReplay: boolean };
    expect(replayABody.idempotentReplay).toBe(true);

    // 3. Move idempotency conflict test:
    // Move slot 0 to slot 3 with key M1
    const moveRes1 = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/inventory/move`,
      headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
      payload: { fromSlot: 0, toSlot: 3, idempotencyKey: 'shared-move-key' }
    });
    expect(moveRes1.statusCode).toBe(200);
    const moveBody1 = moveRes1.json() as { action: string; idempotentReplay: boolean };
    expect(moveBody1.action).toBe('MOVED');
    expect(moveBody1.idempotentReplay).toBe(false);

    // Move slot 3 to slot 5 with the SAME key M1 -> 409 IDEMPOTENCY_KEY_CONFLICT
    const moveConflictRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/inventory/move`,
      headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
      payload: { fromSlot: 3, toSlot: 5, idempotencyKey: 'shared-move-key' }
    });
    expect(moveConflictRes.statusCode).toBe(409);

    // Replay original move 0 to 3 with key M1 -> 200 SUCCESS preserving action MOVED
    const replayMoveRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/inventory/move`,
      headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
      payload: { fromSlot: 0, toSlot: 3, idempotencyKey: 'shared-move-key' }
    });
    expect(replayMoveRes.statusCode).toBe(200);
    const replayMoveBody = replayMoveRes.json() as { action: string; idempotentReplay: boolean };
    expect(replayMoveBody.action).toBe('MOVED');
    expect(replayMoveBody.idempotentReplay).toBe(true);

    // 4. Split idempotency conflict test:
    // Split slot 3 to slot 4 with quantity 5 and key S1
    const splitRes1 = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/inventory/split`,
      headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
      payload: { fromSlot: 3, toSlot: 4, quantity: 5, idempotencyKey: 'shared-split-key' }
    });
    expect(splitRes1.statusCode).toBe(200);
    const splitBody1 = splitRes1.json() as { idempotentReplay: boolean };
    expect(splitBody1.idempotentReplay).toBe(false);

    // Split slot 3 to slot 4 with quantity 8 and same key S1 -> 409 IDEMPOTENCY_KEY_CONFLICT
    const splitConflictRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/inventory/split`,
      headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
      payload: { fromSlot: 3, toSlot: 4, quantity: 8, idempotencyKey: 'shared-split-key' }
    });
    expect(splitConflictRes.statusCode).toBe(409);

    // Replay original split 3 to 4 with quantity 5 -> 200 SUCCESS idempotentReplay
    const replaySplitRes = await server.inject({
      method: 'POST',
      url: `/characters/${character.id}/inventory/split`,
      headers: { cookie: sessionCookie, 'x-csrf-token': csrfToken },
      payload: { fromSlot: 3, toSlot: 4, quantity: 5, idempotencyKey: 'shared-split-key' }
    });
    expect(replaySplitRes.statusCode).toBe(200);
    const replaySplitBody = replaySplitRes.json() as { idempotentReplay: boolean };
    expect(replaySplitBody.idempotentReplay).toBe(true);

    // Economy reconciliation after all operations
    const recon = await reconcileCharacterEconomy(pool, character.id);
    expect(recon.isLootReconciled).toBe(true);
    expect(recon.totalClaimedItemsByCode['copper-coin']).toBe(20);
    expect(recon.totalUnclaimedItemsByCode['rusted-blade']).toBe(1);
  });

  it('P1: handles concurrent opposite moves (A->B and B->A), concurrent claims, splits and merges without deadlocks', async () => {
    const { character } = await createTestAccountAndCharacter('ConcurrentMoves');
    const containerRes = await pool.query<{ id: string }>(
      'SELECT id FROM inventory_containers WHERE character_id = $1 AND container_type = $2',
      [character.id, 'backpack']
    );
    const containerId = containerRes.rows[0]?.id;
    if (!containerId) throw new Error('Container not found');

    // Seed slot 0 with 50 copper-coin and slot 1 with 1 rusted-blade
    await pool.query(
      `INSERT INTO inventory_instances (id, character_id, container_id, slot_index, item_id, quantity)
       VALUES
         ($1, $2, $3, 0, 'copper-coin', 50),
         ($4, $2, $3, 1, 'rusted-blade', 1)`,
      [randomUUID(), character.id, containerId, randomUUID()]
    );

    // Run 20 concurrent move operations with opposing directions (0->1 vs 1->0)
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 20; i++) {
      const from = i % 2 === 0 ? 0 : 1;
      const to = i % 2 === 0 ? 1 : 0;
      promises.push(
        moveInventoryItem(pool, {
          characterId: character.id,
          fromSlot: from,
          toSlot: to,
          idempotencyKey: `concurrent-move-${i}`
        })
      );
    }

    const results = await Promise.allSettled(promises);
    for (const r of results) {
      expect(r.status).toBe('fulfilled');
    }

    // Verify inventory consistency: exactly 2 items, total quantities preserved (50 and 1)
    const inv = await getCharacterInventory(pool, character.id);
    expect(inv.slots).toHaveLength(2);
    const coins = inv.slots.find((s) => s.itemId === 'copper-coin');
    const blade = inv.slots.find((s) => s.itemId === 'rusted-blade');
    expect(coins?.quantity).toBe(50);
    expect(blade?.quantity).toBe(1);
  });

  it('P1: executes claim, move, split and idempotent replays successfully on a pool with maxConnections = 1 without hanging', async () => {
    const oneConnPool = createDatabasePool({ ...dbConfig, maxConnections: 1 });
    try {
      const { character } = await createTestAccountAndCharacter('PoolSizeOne');
      const huntId = randomUUID();
      const segId = randomUUID();
      const rewardId = randomUUID();

      await oneConnPool.query(
        `INSERT INTO hunts (id, character_id, start_idempotency_key, zone_id, strategy, status, started_at, settled_until, completed_at, simulation_version, config_digest, private_checkpoint, reserved_hp_potions, reserved_mp_potions, potions_returned, row_version)
         VALUES ($1, $2, $3, 'damp-catacombs', 'balanced', 'COMPLETED', NOW() - INTERVAL '1 hour', NOW(), NOW(), '1.0.0', 'hash', '{"simulatedEvents":10}'::jsonb, 0, 0, true, 1)`,
        [huntId, character.id, randomUUID()]
      );
      await oneConnPool.query(
        `INSERT INTO hunt_segments (id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version, segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, is_partial, rewards, committed_at)
         VALUES ($1, $2, $3, 1, 2, NOW() - INTERVAL '1 hour', NOW(), 3600000, 10, 'TIME_REACHED', false, '{"deltaXpGained":100,"deltaGoldGained":50,"deltaLootByItem":{"copper-coin":50}}'::jsonb, NOW())`,
        [segId, huntId, randomUUID()]
      );
      await oneConnPool.query(
        `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
         VALUES ($1, $2, $3, $4, 'copper-coin', 50, 'UNCLAIMED')`,
        [rewardId, huntId, segId, character.id]
      );

      // 1. Claim on maxConnections = 1
      const claimResult = await claimHuntReward(oneConnPool, {
        characterId: character.id,
        rewardId,
        idempotencyKey: 'pool-one-claim-1'
      });
      expect(claimResult.status).toBe('SUCCESS');
      if (claimResult.status === 'SUCCESS') {
        expect(claimResult.claimedItem.quantity).toBe(50);
        expect(claimResult.inventory.slots).toHaveLength(1);
      }

      // 2. Replay claim on maxConnections = 1
      const claimReplay = await claimHuntReward(oneConnPool, {
        characterId: character.id,
        rewardId,
        idempotencyKey: 'pool-one-claim-1'
      });
      expect(claimReplay.status).toBe('SUCCESS');
      if (claimReplay.status === 'SUCCESS') {
        expect(claimReplay.idempotentReplay).toBe(true);
      }

      // 3. Move on maxConnections = 1
      const moveResult = await moveInventoryItem(oneConnPool, {
        characterId: character.id,
        fromSlot: 0,
        toSlot: 5,
        idempotencyKey: 'pool-one-move-1'
      });
      expect(moveResult.status).toBe('SUCCESS');
      if (moveResult.status === 'SUCCESS') {
        expect(moveResult.action).toBe('MOVED');
        expect(moveResult.inventory.slots[0]?.slotIndex).toBe(5);
      }

      // 4. Replay move on maxConnections = 1
      const moveReplay = await moveInventoryItem(oneConnPool, {
        characterId: character.id,
        fromSlot: 0,
        toSlot: 5,
        idempotencyKey: 'pool-one-move-1'
      });
      expect(moveReplay.status).toBe('SUCCESS');
      if (moveReplay.status === 'SUCCESS') {
        expect(moveReplay.action).toBe('MOVED');
        expect(moveReplay.idempotentReplay).toBe(true);
      }

      // 5. Split on maxConnections = 1
      const splitResult = await splitInventoryStack(oneConnPool, {
        characterId: character.id,
        fromSlot: 5,
        toSlot: 8,
        quantity: 20,
        idempotencyKey: 'pool-one-split-1'
      });
      expect(splitResult.status).toBe('SUCCESS');
      if (splitResult.status === 'SUCCESS') {
        expect(splitResult.inventory.slots).toHaveLength(2);
      }

      // 6. Replay split on maxConnections = 1
      const splitReplay = await splitInventoryStack(oneConnPool, {
        characterId: character.id,
        fromSlot: 5,
        toSlot: 8,
        quantity: 20,
        idempotencyKey: 'pool-one-split-1'
      });
      expect(splitReplay.status).toBe('SUCCESS');
      if (splitReplay.status === 'SUCCESS') {
        expect(splitReplay.idempotentReplay).toBe(true);
      }

      // Economy reconciliation on oneConnPool
      const recon = await reconcileCharacterEconomy(oneConnPool, character.id);
      expect(recon.isLootReconciled).toBe(true);
      expect(recon.totalClaimedItemsByCode['copper-coin']).toBe(50);
    } finally {
      await oneConnPool.end();
    }
  });

  it('verifies complete economy reconciliation across all 12 items after claims, moves, and splits', async () => {
    const { character } = await createTestAccountAndCharacter('FullReconciliation');
    const huntId = randomUUID();
    const segId = randomUUID();

    await pool.query(
      `INSERT INTO hunts (id, character_id, start_idempotency_key, zone_id, strategy, status, started_at, settled_until, completed_at, simulation_version, config_digest, private_checkpoint, reserved_hp_potions, reserved_mp_potions, potions_returned, row_version)
       VALUES ($1, $2, $3, 'damp-catacombs', 'balanced', 'COMPLETED', NOW() - INTERVAL '1 hour', NOW(), NOW(), '1.0.0', 'hash', '{"simulatedEvents":10}'::jsonb, 0, 0, true, 1)`,
      [huntId, character.id, randomUUID()]
    );
    const allLootMap: Record<string, number> = {};
    for (const itemDef of ITEM_DEFINITIONS) {
      allLootMap[itemDef.itemId] = 2;
    }

    await pool.query(
      `INSERT INTO hunt_segments (id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version, segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, is_partial, rewards, committed_at)
       VALUES ($1, $2, $3, 1, 2, NOW() - INTERVAL '1 hour', NOW(), 3600000, 10, 'TIME_REACHED', false, $4::jsonb, NOW())`,
      [segId, huntId, randomUUID(), JSON.stringify({ deltaXpGained: 100, deltaGoldGained: 50, deltaLootByItem: allLootMap })]
    );

    // Insert 12 distinct item rewards
    const rewardIds: string[] = [];
    for (const itemDef of ITEM_DEFINITIONS) {
      const rid = randomUUID();
      rewardIds.push(rid);
      await pool.query(
        `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
         VALUES ($1, $2, $3, $4, $5, 2, 'UNCLAIMED')`,
        [rid, huntId, segId, character.id, itemDef.itemId]
      );
    }

    // Claim first 5 items into backpack
    for (let i = 0; i < 5; i++) {
      const rid = rewardIds[i];
      if (!rid) continue;
      const res = await claimHuntReward(pool, {
        characterId: character.id,
        rewardId: rid,
        idempotencyKey: `econ-claim-${i}`
      });
      expect(res.status).toBe('SUCCESS');
    }

    // Reconcile: 5 claimed, 7 unclaimed, ledger consistent
    const recon1 = await reconcileCharacterEconomy(pool, character.id);
    expect(recon1.isLootReconciled).toBe(true);
    expect(Object.keys(recon1.totalClaimedItemsByCode)).toHaveLength(5);
    expect(Object.keys(recon1.totalUnclaimedItemsByCode)).toHaveLength(7);

    // Perform move and split
    const moveRes = await moveInventoryItem(pool, {
      characterId: character.id,
      fromSlot: 0,
      toSlot: 15,
      idempotencyKey: 'econ-move-1'
    });
    expect(moveRes.status).toBe('SUCCESS');

    // Split stack if slot 15 is stackable
    const inv = await getCharacterInventory(pool, character.id);
    const slot15 = inv.slots.find((s) => s.slotIndex === 15);
    if (slot15 && slot15.stackable && slot15.quantity >= 2) {
      const splitRes = await splitInventoryStack(pool, {
        characterId: character.id,
        fromSlot: 15,
        toSlot: 16,
        quantity: 1,
        idempotencyKey: 'econ-split-1'
      });
      expect(splitRes.status).toBe('SUCCESS');
    }

    // Reconcile again: must remain 100% reconciled
    const recon2 = await reconcileCharacterEconomy(pool, character.id);
    expect(recon2.isLootReconciled).toBe(true);
    expect(Object.keys(recon2.totalClaimedItemsByCode)).toHaveLength(5);
    expect(Object.keys(recon2.totalUnclaimedItemsByCode)).toHaveLength(7);
  });
});
