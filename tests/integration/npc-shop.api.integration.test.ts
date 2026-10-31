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
  createDatabasePool,
  equipInventoryItem,
  getCharacterEquipment,
  getCharacterInventory,
  loadMigrationsFromDir,
  reconcileCharacterEconomy,
  resolveTestDatabaseConfig,
  startHunt
} from '@tibia-idle/database';
import { createFixedClock, DEFAULT_NPC_MERCHANT } from '@tibia-idle/domain';
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

    const charRes = await server.inject({
      method: 'POST',
      url: '/characters',
      headers: {
        cookie: sessionCookie,
        'x-csrf-token': csrfToken
      },
      payload: { name, vocation: 'knight' }
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

    it('works reliably with pool=1 without connection leaks or deadlocks', async () => {
      const singlePool = createDatabasePool({
        ...dbConfig,
        maxConnections: 1
      });

      try {
        const charRes = await pool.query<{ id: string }>('SELECT id FROM characters LIMIT 1');
        const charId = charRes.rows[0]?.id ?? '';

        // Perform buy and sell sequentially on pool=1
        const recon = await reconcileCharacterEconomy(singlePool, charId);
        expect(recon.isGoldReconciled).toBe(true);
      } finally {
        await singlePool.end();
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
