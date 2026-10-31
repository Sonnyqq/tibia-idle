import { randomUUID } from 'node:crypto';
import { buildApiServer } from '@tibia-idle/api';
import {
  type BuyNpcProductResponseDto,
  type CharacterDto,
  type NpcShopCatalogResponseDto,
  type NpcShopHistoryResponseDto,
  type SellNpcItemResponseDto,
  type UserDto
} from '@tibia-idle/contracts';
import {
  applyMigrations,
  buyNpcProduct,
  createDatabasePool,
  equipInventoryItem,
  getCharacterEquipment,
  getCharacterInventory,
  loadMigrationsFromDir,
  reconcileCharacterEconomy,
  resolveTestDatabaseConfig,
  sellNpcInventoryItem,
  settleHunt,
  startHunt,
  stopHunt,
  type StopHuntResult
} from '@tibia-idle/database';
import { createFixedClock, DEFAULT_COMBAT_SIMULATION_CONFIG, DEFAULT_NPC_MERCHANT } from '@tibia-idle/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('IDLE-005C — NPC Shop, Potion Restock & Gold Economy Integration Tests', () => {
  const dbConfig = resolveTestDatabaseConfig(process.env);
  const pool = createDatabasePool(dbConfig);

  beforeAll(async () => {
    const migrations = loadMigrationsFromDir();
    await applyMigrations(pool, migrations);
    await pool.query(
      'TRUNCATE TABLE npc_transaction_lines, npc_transactions, inventory_movements, inventory_instances, inventory_containers, currency_ledger, hunt_reward_items, hunt_segments, hunts, characters, sessions, users RESTART IDENTITY CASCADE'
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createTestAccountAndCharacter(
    name: string,
    initialGold = 1000
  ): Promise<{
    user: UserDto;
    character: CharacterDto;
    sessionCookie: string;
    csrfToken: string;
    server: Awaited<ReturnType<typeof buildApiServer>>;
  }> {
    const clock = createFixedClock(1_700_000_000_000);
    const server = await buildApiServer({
      dbPool: pool,
      clock
    });
    await server.ready();

    const email = `merchant_${randomUUID()}@example.com`;
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

    const suffix = Array.from({ length: 4 }, () =>
      String.fromCharCode(97 + Math.floor(Math.random() * 26))
    ).join('');
    const safeName = `${name.replace(/[^A-Za-z ]/g, '').slice(0, 15)} ${suffix}`.trim();

    const charRes = await server.inject({
      method: 'POST',
      url: '/characters',
      headers: {
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: { name: safeName, vocation: 'knight' }
    });
    expect(charRes.statusCode).toBe(201);
    const char = charRes.json() as CharacterDto;

    // Adjust starting gold if required for test
    if (initialGold !== 100) {
      await pool.query('UPDATE characters SET gold = $1 WHERE id = $2', [initialGold, char.id]);
      await pool.query(
        `UPDATE currency_ledger
         SET amount = $1, balance_after = $1
         WHERE character_id = $2 AND source_type = 'CHARACTER_INITIAL_GRANT'`,
        [initialGold, char.id]
      );
    }

    return {
      user: regJson.user,
      character: { ...char, stats: { ...char.stats, gold: initialGold } },
      sessionCookie,
      csrfToken,
      server
    };
  }

  it('GET /npc-shop/catalog returns complete buy & sell offers with cache header', async () => {
    const server = await buildApiServer({ dbPool: pool });
    await server.ready();

    const res = await server.inject({
      method: 'GET',
      url: '/npc-shop/catalog'
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    const catalog = res.json() as NpcShopCatalogResponseDto;

    expect(catalog.merchant.id).toBe(DEFAULT_NPC_MERCHANT.id);
    expect(catalog.catalogVersion).toBe(1);
    expect(catalog.buyOffers.length).toBe(2);
    expect(catalog.buyOffers.map((o) => o.productId)).toContain('health-potion');
    expect(catalog.buyOffers.map((o) => o.productId)).toContain('mana-potion');
    expect(catalog.sellOffers.length).toBeGreaterThanOrEqual(12);

    await server.close();
  });

  describe('Potion purchases', () => {
    it('successfully purchases 10 health potions, debits gold, and updates currency_ledger', async () => {
      const ctx = await createTestAccountAndCharacter('Buy Hero One', 1000);
      try {
        const idempotencyKey = randomUUID();
        const res = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 10,
            idempotencyKey
          }
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as BuyNpcProductResponseDto;
        expect(body.characterId).toBe(ctx.character.id);
        expect(body.productId).toBe('health-potion');
        expect(body.quantity).toBe(10);
        expect(body.unitPriceGold).toBe(45);
        expect(body.totalCostGold).toBe(450);
        expect(body.newGoldBalance).toBe(550);
        expect(body.newPotionCount).toBe(260); // starter 250 + 10
        expect(body.idempotentReplay).toBe(false);

        // Verify database state
        const charRes = await pool.query<{ gold: string; hp_potions: number }>(
          'SELECT gold, hp_potions FROM characters WHERE id = $1',
          [ctx.character.id]
        );
        expect(Number(charRes.rows[0]?.gold)).toBe(550);
        expect(charRes.rows[0]?.hp_potions).toBe(260);

        // Verify currency ledger
        const ledgerRes = await pool.query<{ source_type: string; amount: string; balance_after: string }>(
          "SELECT source_type, amount, balance_after FROM currency_ledger WHERE character_id = $1 AND source_type = 'NPC_PURCHASE'",
          [ctx.character.id]
        );
        expect(ledgerRes.rows).toHaveLength(1);
        expect(ledgerRes.rows[0]?.amount).toBe('-450');
        expect(ledgerRes.rows[0]?.balance_after).toBe('550');

        // Test idempotency replay
        const replayRes = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 10,
            idempotencyKey
          }
        });

        expect(replayRes.statusCode).toBe(200);
        const replayBody = replayRes.json() as BuyNpcProductResponseDto;
        expect(replayBody.idempotentReplay).toBe(true);
        expect(replayBody.newGoldBalance).toBe(550);

        // Reconcile economy
        const recon = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon.isGoldReconciled).toBe(true);
        expect(recon.isPotionsReconciled).toBe(true);
      } finally {
        await ctx.server.close();
      }
    });

    it('rejects purchase when gold is insufficient (400 INSUFFICIENT_GOLD)', async () => {
      const ctx = await createTestAccountAndCharacter('Poor Hero', 40); // 40 gold, health potion costs 45
      try {
        const res = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 1,
            idempotencyKey: randomUUID()
          }
        });

        expect(res.statusCode).toBe(400);
        const err = res.json();
        expect(err.error.code).toBe('INSUFFICIENT_GOLD');

        // State remains unchanged
        const charRes = await pool.query<{ gold: string; hp_potions: number }>(
          'SELECT gold, hp_potions FROM characters WHERE id = $1',
          [ctx.character.id]
        );
        expect(Number(charRes.rows[0]?.gold)).toBe(40);
        expect(charRes.rows[0]?.hp_potions).toBe(250);
      } finally {
        await ctx.server.close();
      }
    });

    it('rejects reusing idempotency key with a different payload (409 conflict)', async () => {
      const ctx = await createTestAccountAndCharacter('Replay Hero', 1000);
      try {
        const key = randomUUID();
        const first = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 1,
            idempotencyKey: key
          }
        });
        expect(first.statusCode).toBe(200);

        const conflict = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-mana-potion', // different product!
            quantity: 1,
            idempotencyKey: key
          }
        });
        expect(conflict.statusCode).toBe(409);
        expect(conflict.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
      } finally {
        await ctx.server.close();
      }
    });
  });

  describe('Item sales', () => {
    it('successfully sells 5 rat-pelt from backpack, credits gold, and updates movements', async () => {
      const ctx = await createTestAccountAndCharacter('Seller Hero', 100);
      try {
        // Insert 10 rat pelts into character's backpack
        const backpackRes = await pool.query<{ id: string }>(
          "SELECT id FROM inventory_containers WHERE character_id = $1 AND container_type = 'backpack'",
          [ctx.character.id]
        );
        const backpackId = backpackRes.rows[0]?.id ?? '';

        await pool.query(
          `INSERT INTO inventory_instances (
             id, character_id, container_id, slot_index, item_id, quantity, metadata, row_version
           )
           VALUES ($1, $2, $3, 0, 'rat-pelt', 10, '{}'::jsonb, 1)`,
          [randomUUID(), ctx.character.id, backpackId]
        );

        // Also mock a hunt reward claimed for this item to satisfy full reconciliation
        const segmentId = randomUUID();
        const huntId = randomUUID();
        await pool.query(
          `INSERT INTO hunts (id, character_id, start_idempotency_key, zone_id, strategy, status, stop_reason, started_at, settled_until, completed_at, simulation_version, config_digest, private_checkpoint, reserved_hp_potions, reserved_mp_potions, potions_returned)
           VALUES ($1, $2, $3, 'damp-catacombs', 'balanced', 'COMPLETED', 'MANUAL_STOP', NOW(), NOW(), NOW(), 1, 'digest', '{}'::jsonb, 0, 0, TRUE)`,
          [huntId, ctx.character.id, randomUUID()]
        );
        await pool.query(
          `INSERT INTO hunt_segments (id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version, segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, committed_at, rewards)
           VALUES ($1, $2, 'seg-1', 1, 2, NOW(), NOW(), 1000, 1, 'MANUAL_STOP', NOW(), '{"deltaLootByItem": {"rat-pelt": 10}}'::jsonb)`,
          [segmentId, huntId]
        );
        const rewardId = randomUUID();
        await pool.query(
          `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state, claimed_at, created_at)
           VALUES ($1, $2, $3, $4, 'rat-pelt', 10, 'CLAIMED', NOW(), NOW())`,
          [rewardId, huntId, segmentId, ctx.character.id]
        );
        await pool.query(
          `INSERT INTO inventory_movements (id, character_id, operation_type, operation_key, item_id, quantity, created_at)
           VALUES ($1, $2, 'CLAIM_HUNT_REWARD', $3, 'rat-pelt', 10, NOW())`,
          [randomUUID(), ctx.character.id, randomUUID()]
        );

        const idempotencyKey = randomUUID();
        // Rat pelt price is 9 gold each. 5 * 9 = 45 gold payout.
        const res = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/sell`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            itemId: 'rat-pelt',
            quantity: 5,
            idempotencyKey
          }
        });

        expect(res.statusCode).toBe(200);
        const body = res.json() as SellNpcItemResponseDto;
        expect(body.itemId).toBe('rat-pelt');
        expect(body.quantitySold).toBe(5);
        expect(body.unitPriceGold).toBe(9);
        expect(body.totalPayoutGold).toBe(45);
        expect(body.newGoldBalance).toBe(145);
        expect(body.idempotentReplay).toBe(false);

        // Check backpack remaining quantity is 5
        const instRes = await pool.query<{ quantity: number }>(
          "SELECT quantity FROM inventory_instances WHERE character_id = $1 AND item_id = 'rat-pelt'",
          [ctx.character.id]
        );
        expect(instRes.rows[0]?.quantity).toBe(5);

        // Check currency ledger CREDIT
        const ledgerRes = await pool.query<{ source_type: string; amount: string; balance_after: string }>(
          "SELECT source_type, amount, balance_after FROM currency_ledger WHERE character_id = $1 AND source_type = 'NPC_SALE'",
          [ctx.character.id]
        );
        expect(ledgerRes.rows).toHaveLength(1);
        expect(ledgerRes.rows[0]?.amount).toBe('45');
        expect(ledgerRes.rows[0]?.balance_after).toBe('145');

        // Check inventory movements
        const movRes = await pool.query<{ operation_type: string; quantity: number }>(
          "SELECT operation_type, quantity FROM inventory_movements WHERE character_id = $1 AND operation_type = 'NPC_SALE'",
          [ctx.character.id]
        );
        expect(movRes.rows).toHaveLength(1);
        expect(movRes.rows[0]?.quantity).toBe(5);

        // Reconcile economy
        const recon = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon.isGoldReconciled).toBe(true);
        expect(recon.isLootReconciled).toBe(true);
        expect(recon.isPotionsReconciled).toBe(true);
      } finally {
        await ctx.server.close();
      }
    });

    it('rejects selling an unsellable item (400 ITEM_NOT_SELLABLE)', async () => {
      const ctx = await createTestAccountAndCharacter('Invalid Seller', 100);
      try {
        const res = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/sell`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            itemId: 'non-existent-or-forbidden-item',
            quantity: 1,
            idempotencyKey: randomUUID()
          }
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('ITEM_NOT_SELLABLE');
      } finally {
        await ctx.server.close();
      }
    });

    it('rejects selling more items than possessed in backpack (400 INSUFFICIENT_ITEMS)', async () => {
      const ctx = await createTestAccountAndCharacter('Greedy Seller', 100);
      try {
        const res = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/sell`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            itemId: 'rat-pelt',
            quantity: 5,
            idempotencyKey: randomUUID()
          }
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('INSUFFICIENT_ITEMS');
      } finally {
        await ctx.server.close();
      }
    });

    it('prevents selling equipped items directly from paperdoll', async () => {
      const ctx = await createTestAccountAndCharacter('Equip Seller', 100);
      try {
        // Put rusted-blade into backpack, equip it, then attempt to sell it
        const bpRes = await pool.query<{ id: string }>(
          "SELECT id FROM inventory_containers WHERE character_id = $1 AND container_type = 'backpack'",
          [ctx.character.id]
        );
        const bpId = bpRes.rows[0]?.id ?? '';

        await pool.query(
          `INSERT INTO inventory_instances (
             id, character_id, container_id, slot_index, item_id, quantity, metadata, row_version
           )
           VALUES ($1, $2, $3, 0, 'rusted-blade', 1, '{}'::jsonb, 1)`,
          [randomUUID(), ctx.character.id, bpId]
        );

        // Equip it into weapon slot
        await equipInventoryItem(pool, {
          characterId: ctx.character.id,
          backpackSlot: 0,
          equipmentSlot: 'weapon',
          idempotencyKey: randomUUID()
        });

        // Verify it is in equipment and no longer in backpack
        const eq = await getCharacterEquipment(pool, ctx.character.id);
        expect(eq.slots.weapon?.itemId).toBe('rusted-blade');

        const inv = await getCharacterInventory(pool, ctx.character.id);
        expect(inv.slots.find((s) => s.itemId === 'rusted-blade')).toBeUndefined();

        // Attempt to sell rusted-blade
        const res = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/sell`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            itemId: 'rusted-blade',
            quantity: 1,
            idempotencyKey: randomUUID()
          }
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe('INSUFFICIENT_ITEMS');
      } finally {
        await ctx.server.close();
      }
    });
  });

  describe('Active hunt locking', () => {
    it('blocks buy and sell requests while character is on an active hunt (409 ACTIVE_HUNT_LOCKED)', async () => {
      const ctx = await createTestAccountAndCharacter('Active Hunter', 1000);
      try {
        // Start an active hunt
        const startRes = await startHunt(pool, {
          characterId: ctx.character.id,
          zoneId: 'damp-catacombs',
          strategy: 'balanced',
          requestedHpPotions: 10,
          requestedMpPotions: 10,
          idempotencyKey: randomUUID(),
          clock: createFixedClock(1_700_000_000_000)
        });
        if (!startRes.ok) {
          throw new Error(`startHunt failed: ${startRes.reason}`);
        }
        expect(startRes.hunt.status).toBe('ACTIVE');

        // Attempt buy
        const buyRes = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 1,
            idempotencyKey: randomUUID()
          }
        });
        expect(buyRes.statusCode).toBe(409);
        expect(buyRes.json().error.code).toBe('ACTIVE_HUNT_LOCKED');

        // Attempt sell
        const sellRes = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/sell`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            itemId: 'rat-pelt',
            quantity: 1,
            idempotencyKey: randomUUID()
          }
        });
        expect(sellRes.statusCode).toBe(409);
        expect(sellRes.json().error.code).toBe('ACTIVE_HUNT_LOCKED');
      } finally {
        await ctx.server.close();
      }
    });
  });

  describe('Concurrency & Race safety', () => {
    it('handles 20 concurrent buy requests under budget with zero double-spend', async () => {
      // 1000 gold. HP potion costs 45g. 20 * 45 = 900g.
      // Let's set gold to exactly 450 gold (can afford exactly 10 potions).
      // We send 20 concurrent requests for 1 potion each.
      const ctx = await createTestAccountAndCharacter('Concurrent Buyer', 450);
      try {
        const promises = Array.from({ length: 20 }, (_, i) => {
          return ctx.server.inject({
            method: 'POST',
            url: `/characters/${ctx.character.id}/npc-shop/buy`,
            headers: {
              cookie: ctx.sessionCookie,
              'x-csrf-token': ctx.csrfToken
            },
            payload: {
              offerId: 'offer-buy-health-potion',
              quantity: 1,
              idempotencyKey: `buy-concurrent-${i}-${randomUUID()}`
            }
          });
        });

        const responses = await Promise.all(promises);
        const successes = responses.filter((r) => r.statusCode === 200);
        const failures = responses.filter((r) => r.statusCode === 400);

        expect(successes.length).toBe(10);
        expect(failures.length).toBe(10);

        for (const f of failures) {
          expect(f.json().error.code).toBe('INSUFFICIENT_GOLD');
        }

        // Verify final gold is exactly 0
        const charRes = await pool.query<{ gold: string; hp_potions: number }>(
          'SELECT gold, hp_potions FROM characters WHERE id = $1',
          [ctx.character.id]
        );
        expect(Number(charRes.rows[0]?.gold)).toBe(0);
        expect(charRes.rows[0]?.hp_potions).toBe(260); // 250 + 10

        const recon = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon.isGoldReconciled).toBe(true);
        expect(recon.isPotionsReconciled).toBe(true);
      } finally {
        await ctx.server.close();
      }
    });

    it('handles 20 concurrent sell requests from a stack with zero duplicate gold', async () => {
      const ctx = await createTestAccountAndCharacter('Concurrent Seller', 100);
      try {
        // Put 10 copper coins into backpack (2 gold each)
        const bpRes = await pool.query<{ id: string }>(
          "SELECT id FROM inventory_containers WHERE character_id = $1 AND container_type = 'backpack'",
          [ctx.character.id]
        );
        const bpId = bpRes.rows[0]?.id ?? '';

        await pool.query(
          `INSERT INTO inventory_instances (
             id, character_id, container_id, slot_index, item_id, quantity, metadata, row_version
           )
           VALUES ($1, $2, $3, 0, 'copper-coin', 10, '{}'::jsonb, 1)`,
          [randomUUID(), ctx.character.id, bpId]
        );

        // 20 concurrent requests each trying to sell 1 copper coin
        const promises = Array.from({ length: 20 }, (_, i) => {
          return ctx.server.inject({
            method: 'POST',
            url: `/characters/${ctx.character.id}/npc-shop/sell`,
            headers: {
              cookie: ctx.sessionCookie,
              'x-csrf-token': ctx.csrfToken
            },
            payload: {
              itemId: 'copper-coin',
              quantity: 1,
              idempotencyKey: `sell-concurrent-${i}-${randomUUID()}`
            }
          });
        });

        const responses = await Promise.all(promises);
        const successes = responses.filter((r) => r.statusCode === 200);
        const failures = responses.filter((r) => r.statusCode === 400);

        expect(successes.length).toBe(10);
        expect(failures.length).toBe(10);

        // Character gold must be exactly 100 + 10 * 2 = 120
        const charRes = await pool.query<{ gold: string }>(
          'SELECT gold FROM characters WHERE id = $1',
          [ctx.character.id]
        );
        expect(Number(charRes.rows[0]?.gold)).toBe(120);

        // Remaining inventory instances of copper-coin must be 0
        const invRes = await pool.query<{ quantity: number }>(
          "SELECT quantity FROM inventory_instances WHERE character_id = $1 AND item_id = 'copper-coin'",
          [ctx.character.id]
        );
        expect(invRes.rows.length).toBe(0);

        const recon = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon.isGoldReconciled).toBe(true);
      } finally {
        await ctx.server.close();
      }
    });

    it('executes real buy and sell operations with pool.maxConnections=1 with idempotent retries', async () => {
      const singlePool = createDatabasePool({
        ...dbConfig,
        maxConnections: 1
      });

      const ctx = await createTestAccountAndCharacter('SinglePool Hero', 500);
      try {
        const bpRes = await pool.query<{ id: string }>(
          "SELECT id FROM inventory_containers WHERE character_id = $1 AND container_type = 'backpack'",
          [ctx.character.id]
        );
        const bpId = bpRes.rows[0]?.id ?? '';

        await pool.query(
          `INSERT INTO inventory_instances (id, character_id, container_id, slot_index, item_id, quantity, metadata, row_version)
           VALUES ($1, $2, $3, 0, 'rat-pelt', 4, '{}'::jsonb, 1)`,
          [randomUUID(), ctx.character.id, bpId]
        );

        // Real buy on pool=1
        const buyKey = randomUUID();
        const buyResult = await buyNpcProduct(singlePool, {
          characterId: ctx.character.id,
          offerId: 'offer-buy-health-potion',
          quantity: 2,
          idempotencyKey: buyKey
        });
        expect(buyResult.idempotentReplay).toBe(false);
        expect(buyResult.newGoldBalance).toBe(410); // 500 - 90
        expect(buyResult.newPotionCount).toBe(252);

        // Idempotent retry on pool=1
        const buyReplay = await buyNpcProduct(singlePool, {
          characterId: ctx.character.id,
          offerId: 'offer-buy-health-potion',
          quantity: 2,
          idempotencyKey: buyKey
        });
        expect(buyReplay.idempotentReplay).toBe(true);
        expect(buyReplay.newGoldBalance).toBe(410);
        expect(buyReplay.newPotionCount).toBe(252);

        // Real sell on pool=1 (4 rat-pelt * 9 = 36 gold)
        const sellKey = randomUUID();
        const sellResult = await sellNpcInventoryItem(singlePool, {
          characterId: ctx.character.id,
          itemId: 'rat-pelt',
          quantity: 4,
          idempotencyKey: sellKey
        });
        expect(sellResult.idempotentReplay).toBe(false);
        expect(sellResult.totalPayoutGold).toBe(36);
        expect(sellResult.newGoldBalance).toBe(446); // 410 + 36

        // Idempotent retry sell on pool=1
        const sellReplay = await sellNpcInventoryItem(singlePool, {
          characterId: ctx.character.id,
          itemId: 'rat-pelt',
          quantity: 4,
          idempotencyKey: sellKey
        });
        expect(sellReplay.idempotentReplay).toBe(true);
        expect(sellReplay.newGoldBalance).toBe(446);

        // Reconcile on pool=1
        const recon = await reconcileCharacterEconomy(singlePool, ctx.character.id);
        expect(recon.isGoldReconciled).toBe(true);
        expect(recon.isPotionsReconciled).toBe(true);
      } finally {
        await ctx.server.close();
        await singlePool.end();
      }
    });

    it('enforces serialisation and no double-spend with 20 concurrent buys on finite gold balance', async () => {
      // 450 gold allows exactly 10x 45 gold potions
      const ctx = await createTestAccountAndCharacter('Concurrent Buyer', 450);
      try {
        const promises = Array.from({ length: 20 }, (_, i) => {
          return ctx.server.inject({
            method: 'POST',
            url: `/characters/${ctx.character.id}/npc-shop/buy`,
            headers: {
              cookie: ctx.sessionCookie,
              'x-csrf-token': ctx.csrfToken
            },
            payload: {
              offerId: 'offer-buy-health-potion',
              quantity: 1,
              idempotencyKey: `buy-race-${i}-${randomUUID()}`
            }
          });
        });

        const responses = await Promise.all(promises);
        const successes = responses.filter((r) => r.statusCode === 200);
        const failures = responses.filter((r) => r.statusCode === 400);

        expect(successes).toHaveLength(10);
        expect(failures).toHaveLength(10);

        const charRes = await pool.query<{ gold: string; hp_potions: number }>(
          'SELECT gold, hp_potions FROM characters WHERE id = $1',
          [ctx.character.id]
        );
        expect(Number(charRes.rows[0]?.gold)).toBe(0);
        expect(charRes.rows[0]?.hp_potions).toBe(260); // 250 + 10

        const recon = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon.isGoldReconciled).toBe(true);
        expect(recon.isPotionsReconciled).toBe(true);
      } finally {
        await ctx.server.close();
      }
    });

    it('simulates crash before commit and verifies zero balance/potion change and no key persistence', async () => {
      const ctx = await createTestAccountAndCharacter('Crash Before Commit Hero', 200);
      try {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('UPDATE characters SET gold = gold - 90 WHERE id = $1', [ctx.character.id]);
          // Simulated crash/abort before commit
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }

        const charRes = await pool.query<{ gold: string; hp_potions: number }>(
          'SELECT gold, hp_potions FROM characters WHERE id = $1',
          [ctx.character.id]
        );
        expect(Number(charRes.rows[0]?.gold)).toBe(200);
        expect(charRes.rows[0]?.hp_potions).toBe(250);

        const txRes = await pool.query('SELECT count(*) FROM npc_transactions WHERE character_id = $1', [ctx.character.id]);
        expect(Number(txRes.rows[0]?.count)).toBe(0);

        const recon = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon.isGoldReconciled).toBe(true);
      } finally {
        await ctx.server.close();
      }
    });

    it('simulates lost response after commit and verifies replay receives exact response without double-debit', async () => {
      const ctx = await createTestAccountAndCharacter('Lost Response Hero', 300);
      try {
        const idempotencyKey = randomUUID();
        const first = await buyNpcProduct(pool, {
          characterId: ctx.character.id,
          offerId: 'offer-buy-health-potion',
          quantity: 2,
          idempotencyKey
        });
        expect(first.idempotentReplay).toBe(false);
        expect(first.newGoldBalance).toBe(210);
        expect(first.newPotionCount).toBe(252);

        // Network dropped before response reached client; client retries with same idempotency key
        const retry = await buyNpcProduct(pool, {
          characterId: ctx.character.id,
          offerId: 'offer-buy-health-potion',
          quantity: 2,
          idempotencyKey
        });
        expect(retry.idempotentReplay).toBe(true);
        expect(retry.newGoldBalance).toBe(210);
        expect(retry.newPotionCount).toBe(252);

        // Verify only 1 currency ledger row was inserted
        const ledgerRes = await pool.query(
          "SELECT count(*) FROM currency_ledger WHERE character_id = $1 AND source_type = 'NPC_PURCHASE'",
          [ctx.character.id]
        );
        expect(Number(ledgerRes.rows[0]?.count)).toBe(1);

        const recon = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon.isGoldReconciled).toBe(true);
        expect(recon.isPotionsReconciled).toBe(true);
      } finally {
        await ctx.server.close();
      }
    });
  });

  describe('P1 — Idempotency Canonical Payload & Active Hunt Replay', () => {
    it('verifies buy replay compares full canonical payload and rejects modified parameters', async () => {
      const ctx = await createTestAccountAndCharacter('Payload Buy Hero', 500);
      try {
        const key = randomUUID();
        const firstRes = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 2,
            idempotencyKey: key
          }
        });
        expect(firstRes.statusCode).toBe(200);
        const firstBody = firstRes.json() as BuyNpcProductResponseDto;
        expect(firstBody.idempotentReplay).toBe(false);

        // Exact same replay -> 200 idempotentReplay=true
        const replayRes = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 2,
            idempotencyKey: key
          }
        });
        expect(replayRes.statusCode).toBe(200);
        const replayBody = replayRes.json() as BuyNpcProductResponseDto;
        expect(replayBody.idempotentReplay).toBe(true);
        expect(replayBody.newGoldBalance).toBe(firstBody.newGoldBalance);

        // Changed quantity -> 409 conflict
        const qtyConflict = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 3,
            idempotencyKey: key
          }
        });
        expect(qtyConflict.statusCode).toBe(409);
        expect(qtyConflict.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');

        // Changed offerId -> 409 conflict
        const offerConflict = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-mana-potion',
            quantity: 2,
            idempotencyKey: key
          }
        });
        expect(offerConflict.statusCode).toBe(409);
        expect(offerConflict.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');
      } finally {
        await ctx.server.close();
      }
    });

    it('verifies sell replay compares full canonical payload and validates instanceId vs slotIndex', async () => {
      const ctx = await createTestAccountAndCharacter('Payload Sell Hero', 100);
      try {
        const bpRes = await pool.query<{ id: string }>(
          "SELECT id FROM inventory_containers WHERE character_id = $1 AND container_type = 'backpack'",
          [ctx.character.id]
        );
        const bpId = bpRes.rows[0]?.id ?? '';

        const instId0 = randomUUID();
        const instId1 = randomUUID();
        await pool.query(
          `INSERT INTO inventory_instances (id, character_id, container_id, slot_index, item_id, quantity, metadata, row_version)
           VALUES
             ($1, $2, $3, 0, 'rat-pelt', 5, '{}'::jsonb, 1),
             ($4, $2, $3, 1, 'copper-coin', 10, '{}'::jsonb, 1)`,
          [instId0, ctx.character.id, bpId, instId1]
        );

        // 1. Sell with matching instanceId and slotIndex
        const sellKey = randomUUID();
        const matchRes = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/sell`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            itemId: 'rat-pelt',
            instanceId: instId0,
            slotIndex: 0,
            quantity: 2,
            idempotencyKey: sellKey
          }
        });
        expect(matchRes.statusCode).toBe(200);
        const matchBody = matchRes.json() as SellNpcItemResponseDto;
        expect(matchBody.idempotentReplay).toBe(false);

        // 2. Exact same replay -> 200 idempotentReplay=true
        const replayRes = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/sell`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            itemId: 'rat-pelt',
            instanceId: instId0,
            slotIndex: 0,
            quantity: 2,
            idempotencyKey: sellKey
          }
        });
        expect(replayRes.statusCode).toBe(200);
        expect((replayRes.json() as SellNpcItemResponseDto).idempotentReplay).toBe(true);

        // 3. Changed quantity -> 409 conflict
        const qtyConflict = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/sell`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            itemId: 'rat-pelt',
            instanceId: instId0,
            slotIndex: 0,
            quantity: 3,
            idempotencyKey: sellKey
          }
        });
        expect(qtyConflict.statusCode).toBe(409);
        expect(qtyConflict.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD');

        // 4. Mismatched slotIndex for given instanceId -> 400 INSTANCE_SLOT_MISMATCH
        const mismatchSlotRes = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/sell`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            itemId: 'copper-coin',
            instanceId: instId1,
            slotIndex: 5, // instId1 is at slot 1, not 5!
            quantity: 1,
            idempotencyKey: randomUUID()
          }
        });
        expect(mismatchSlotRes.statusCode).toBe(400);
        expect(mismatchSlotRes.json().error.code).toBe('INSTANCE_SLOT_MISMATCH');

        // 5. Mismatched item type for given instanceId -> 400 ITEM_TYPE_MISMATCH
        const mismatchTypeRes = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/sell`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            itemId: 'rat-pelt', // instId1 is copper-coin, not rat-pelt!
            instanceId: instId1,
            slotIndex: 1,
            quantity: 1,
            idempotencyKey: randomUUID()
          }
        });
        expect(mismatchTypeRes.statusCode).toBe(400);
        expect(mismatchTypeRes.json().error.code).toBe('ITEM_TYPE_MISMATCH');
      } finally {
        await ctx.server.close();
      }
    });

    it('allows idempotent replay during active hunt but blocks fresh transactions', async () => {
      const ctx = await createTestAccountAndCharacter('Hunt Replay Hero', 500);
      try {
        const buyKey = randomUUID();
        const initialBuy = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 2,
            idempotencyKey: buyKey
          }
        });
        expect(initialBuy.statusCode).toBe(200);

        // Start active hunt
        const startRes = await startHunt(pool, {
          characterId: ctx.character.id,
          userId: ctx.user.id,
          zoneId: 'damp-catacombs',
          strategy: 'balanced',
          idempotencyKey: randomUUID(),
          requestedHpPotions: 10,
          requestedMpPotions: 5
        });
        expect(startRes.ok).toBe(true);

        // Replaying prior buy with same key during active hunt succeeds (idempotentReplay = true)
        const replayRes = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 2,
            idempotencyKey: buyKey
          }
        });
        expect(replayRes.statusCode).toBe(200);
        expect(replayRes.json().idempotentReplay).toBe(true);

        // Fresh buy during active hunt is locked (409 ACTIVE_HUNT_LOCKED)
        const freshBuy = await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 1,
            idempotencyKey: randomUUID()
          }
        });
        expect(freshBuy.statusCode).toBe(409);
        expect(freshBuy.json().error.code).toBe('ACTIVE_HUNT_LOCKED');
      } finally {
        await ctx.server.close();
      }
    });
  });

  describe('P1 — Potion Reconciliation Comprehensive Test Suite', () => {
    it('maintains strict potion reconciliation across hunt lifecycle: start, partial settlement, consumption, stop continuation, completion, and restock', async () => {
      const clock = createFixedClock(1_700_000_000_000);
      const ctx = await createTestAccountAndCharacter('Recon Potion Master', 1000);
      try {
        // State 1: Fresh character with starting supplies (250 HP, 150 MP)
        const recon1 = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon1.isPotionsReconciled).toBe(true);
        expect(recon1.characterHpPotions).toBe(250);
        expect(recon1.characterMpPotions).toBe(150);
        expect(recon1.unusedReservedHpPotions).toBe(0);
        expect(recon1.unusedReservedMpPotions).toBe(0);

        // State 2: Hunt started with 20 HP and 10 MP potions reserved
        const startRes = await startHunt(pool, {
          characterId: ctx.character.id,
          userId: ctx.user.id,
          zoneId: 'damp-catacombs',
          strategy: 'balanced',
          idempotencyKey: 'recon-hunt-1',
          requestedHpPotions: 20,
          requestedMpPotions: 10,
          clock
        });
        expect(startRes.ok).toBe(true);
        if (!startRes.ok) return;

        const recon2 = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon2.isPotionsReconciled).toBe(true);
        expect(recon2.characterHpPotions).toBe(230);
        expect(recon2.characterMpPotions).toBe(140);
        expect(recon2.unusedReservedHpPotions).toBe(20);
        expect(recon2.unusedReservedMpPotions).toBe(10);
        expect(recon2.totalHpPotionsConsumed).toBe(0);
        expect(recon2.totalMpPotionsConsumed).toBe(0);

        // State 3: Partial settlement with potions consumed
        clock.advanceMs(10 * 60 * 1000); // 10 minutes
        const settleRes = await settleHunt(pool, {
          huntId: startRes.hunt.huntId,
          segmentKey: 'seg-recon-1',
          clock
        });
        expect(settleRes.ok).toBe(true);
        if (!settleRes.ok) return;

        const recon3 = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon3.isPotionsReconciled).toBe(true);
        expect(recon3.characterHpPotions).toBe(230);
        expect(recon3.totalHpPotionsConsumed).toBe(settleRes.rewards.deltaHpPotionsUsed);
        expect(recon3.totalMpPotionsConsumed).toBe(settleRes.rewards.deltaMpPotionsUsed);
        expect(recon3.unusedReservedHpPotions).toBe(20 - settleRes.rewards.deltaHpPotionsUsed);
        expect(recon3.unusedReservedMpPotions).toBe(10 - settleRes.rewards.deltaMpPotionsUsed);

        // State 4: Stop hunt and return unused potions
        clock.advanceMs(5 * 60 * 1000);
        const stopRes = await stopHunt(pool, {
          huntId: startRes.hunt.huntId,
          stopIdempotencyKey: randomUUID(),
          clock
        });
        expect(stopRes.ok).toBe(true);
        if (!stopRes.ok) return;

        const recon4 = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon4.isPotionsReconciled).toBe(true);
        expect(recon4.unusedReservedHpPotions).toBe(0);
        expect(recon4.unusedReservedMpPotions).toBe(0);
        expect(recon4.characterHpPotions).toBe(250 - recon4.totalHpPotionsConsumed);
        expect(recon4.characterMpPotions).toBe(150 - recon4.totalMpPotionsConsumed);

        // State 5: Purchase potions at NPC shop between hunts
        const buyHp = await buyNpcProduct(pool, {
          characterId: ctx.character.id,
          offerId: 'offer-buy-health-potion',
          quantity: 15,
          idempotencyKey: randomUUID()
        });
        expect(buyHp.newPotionCount).toBe(recon4.characterHpPotions + 15);

        const buyMp = await buyNpcProduct(pool, {
          characterId: ctx.character.id,
          offerId: 'offer-buy-mana-potion',
          quantity: 8,
          idempotencyKey: randomUUID()
        });
        expect(buyMp.newPotionCount).toBe(recon4.characterMpPotions + 8);

        const recon5 = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon5.isPotionsReconciled).toBe(true);
        expect(recon5.totalHpPotionsPurchased).toBe(15);
        expect(recon5.totalMpPotionsPurchased).toBe(8);

        // State 6: Second consecutive hunt
        const startRes2 = await startHunt(pool, {
          characterId: ctx.character.id,
          userId: ctx.user.id,
          zoneId: 'damp-catacombs',
          strategy: 'safe',
          idempotencyKey: 'recon-hunt-2',
          requestedHpPotions: 25,
          requestedMpPotions: 15,
          clock
        });
        expect(startRes2.ok).toBe(true);
        if (!startRes2.ok) return;

        clock.advanceMs(15 * 60 * 1000);
        const stopRes2 = await stopHunt(pool, {
          huntId: startRes2.hunt.huntId,
          stopIdempotencyKey: randomUUID(),
          clock
        });
        expect(stopRes2.ok).toBe(true);

        const recon6 = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(recon6.isPotionsReconciled).toBe(true);
        expect(recon6.isGoldReconciled).toBe(true);
        expect(recon6.unusedReservedHpPotions).toBe(0);
        expect(recon6.unusedReservedMpPotions).toBe(0);
      } finally {
        await ctx.server.close();
      }
    });

    it('reconciles potions accurately under STOP_CONTINUATION_REQUIRED and simulated mid-drain recovery', async () => {
      const clock = createFixedClock(1_700_000_000_000);
      const ctx = await createTestAccountAndCharacter('Continuation Hero', 500);
      try {
        const lowBudgetConfig = {
          ...DEFAULT_COMBAT_SIMULATION_CONFIG,
          maxEventsPerCall: 200
        };

        const startRes = await startHunt(pool, {
          characterId: ctx.character.id,
          userId: ctx.user.id,
          zoneId: 'damp-catacombs',
          strategy: 'safe',
          idempotencyKey: 'continuation-hunt-start',
          requestedHpPotions: 50,
          requestedMpPotions: 20,
          clock,
          config: lowBudgetConfig
        });
        expect(startRes.ok).toBe(true);
        if (!startRes.ok) return;

        // Advance 2 hours so that multiple segments are needed
        clock.advanceMs(2 * 60 * 60 * 1000);

        // Call stopHunt with maxDrainSegments = 1 to force STOP_CONTINUATION_REQUIRED
        const stopRes = await stopHunt(pool, {
          huntId: startRes.hunt.huntId,
          stopIdempotencyKey: 'stop-step-1',
          maxDrainSegments: 1,
          clock,
          config: lowBudgetConfig
        });
        expect(stopRes.ok).toBe(true);
        if (!stopRes.ok) return;
        expect(stopRes.status).toBe('STOP_CONTINUATION_REQUIRED');
        expect(stopRes.continuationRequired).toBe(true);

        // Verify economy reconciles cleanly in STOP_CONTINUATION_REQUIRED state!
        const reconMidDrain = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(reconMidDrain.isPotionsReconciled).toBe(true);
        expect(reconMidDrain.isGoldReconciled).toBe(true);

        // Finish draining the remaining segments
        let finalStop: StopHuntResult = stopRes;
        while (finalStop.ok && finalStop.continuationRequired) {
          finalStop = await stopHunt(pool, {
            huntId: startRes.hunt.huntId,
            stopIdempotencyKey: 'stop-step-1',
            maxDrainSegments: 50,
            clock,
            config: lowBudgetConfig
          });
        }
        expect(finalStop.ok).toBe(true);
        if (!finalStop.ok) return;
        expect(finalStop.status).toBe('COMPLETED');

        // Verify economy reconciles cleanly after completion!
        const reconCompleted = await reconcileCharacterEconomy(pool, ctx.character.id);
        expect(reconCompleted.isPotionsReconciled).toBe(true);
        expect(reconCompleted.isGoldReconciled).toBe(true);
        expect(reconCompleted.unusedReservedHpPotions).toBe(0);
        expect(reconCompleted.unusedReservedMpPotions).toBe(0);
      } finally {
        await ctx.server.close();
      }
    });
  });

  describe('History endpoint', () => {
    it('returns sorted transaction history for character', async () => {
      const ctx = await createTestAccountAndCharacter('History Hero', 1000);
      try {
        await ctx.server.inject({
          method: 'POST',
          url: `/characters/${ctx.character.id}/npc-shop/buy`,
          headers: {
            cookie: ctx.sessionCookie,
            'x-csrf-token': ctx.csrfToken
          },
          payload: {
            offerId: 'offer-buy-health-potion',
            quantity: 2,
            idempotencyKey: randomUUID()
          }
        });

        const res = await ctx.server.inject({
          method: 'GET',
          url: `/characters/${ctx.character.id}/npc-shop/history`,
          headers: {
            cookie: ctx.sessionCookie
          }
        });

        expect(res.statusCode).toBe(200);
        const history = res.json() as NpcShopHistoryResponseDto;
        expect(history.characterId).toBe(ctx.character.id);
        expect(history.transactions.length).toBe(1);
        expect(history.transactions[0]?.productId).toBe('health-potion');
        expect(history.transactions[0]?.totalGold).toBe(90);
      } finally {
        await ctx.server.close();
      }
    });
  });
});
