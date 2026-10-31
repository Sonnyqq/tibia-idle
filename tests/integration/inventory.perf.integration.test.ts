import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  applyMigrations,
  claimHuntReward,
  createDatabasePool,
  getCharacterInventory,
  loadMigrationsFromDir,
  moveInventoryItem,
  resolveTestDatabaseConfig
} from '@tibia-idle/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((p / 100) * sortedValues.length))
  );
  return Number((sortedValues[idx] ?? 0).toFixed(2));
}

describe('IDLE-005A — Inventory & Loot Claim Performance Baseline (100 & 1000 reads, claims, concurrent race & move/split)', () => {
  const dbConfig = resolveTestDatabaseConfig(process.env);
  const pool = createDatabasePool({
    ...dbConfig,
    maxConnections: 20
  });

  beforeAll(async () => {
    const migrations = loadMigrationsFromDir();
    await applyMigrations(pool, migrations);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('measures baseline performance for 100 reads, 1000 reads, 100 distinct claims, 20-way race on same reward, and 100 move/split operations', async () => {
    // 1. Seed character with backpack and items
    const userId = randomUUID();
    const charId = randomUUID();
    const containerId = randomUUID();
    const now = new Date();

    const email = `perf_user_${randomUUID()}@example.com`;
    await pool.query(
      `INSERT INTO users (id, email, email_normalized, password_hash, locale)
       VALUES ($1, $2, $2, 'hash', 'pl')`,
      [userId, email]
    );

    const charName = `Hero ${randomUUID().slice(0, 8)}`;
    await pool.query(
      `INSERT INTO characters (
         id, user_id, slot_number, name, name_normalized, vocation,
         level, xp, hp, max_hp, mp, max_mp, gold,
         skill_melee, skill_distance, skill_magic, skill_shielding
       )
       VALUES ($1, $2, 1, $3, lower($3), 'knight', 10, 5000, 320, 320, 85, 85, 1000, 30, 10, 5, 25)`,
      [charId, userId, charName]
    );

    await pool.query(
      `INSERT INTO inventory_containers (id, character_id, container_type, slot_capacity, row_version, created_at)
       VALUES ($1, $2, 'backpack', 20, 1, $3)`,
      [containerId, charId, now]
    );

    await pool.query(
      `INSERT INTO inventory_instances (id, character_id, container_id, slot_index, item_id, quantity)
       VALUES
         ($1, $2, $3, 0, 'copper-coin', 80),
         ($4, $2, $3, 1, 'rat-pelt', 25),
         ($5, $2, $3, 2, 'ancient-bone', 10)`,
      [randomUUID(), charId, containerId, randomUUID(), randomUUID()]
    );

    // Bench A: 100 concurrent inventory reads
    const initialMemory = process.memoryUsage().heapUsed;
    const start100 = performance.now();
    const times100: number[] = [];
    const readPromises100 = Array.from({ length: 100 }, async () => {
      const t0 = performance.now();
      const inv = await getCharacterInventory(pool, charId);
      expect(inv.slots.length).toBeGreaterThanOrEqual(1);
      times100.push(performance.now() - t0);
    });
    await Promise.all(readPromises100);
    const wallTime100 = performance.now() - start100;
    times100.sort((a, b) => a - b);

    // Bench B: 1000 inventory reads (batched with concurrency 20)
    const start1000 = performance.now();
    const times1000: number[] = [];
    const concurrency = 20;
    const batchSize = 50; // 20 * 50 = 1000
    for (let b = 0; b < batchSize; b++) {
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          const t0 = performance.now();
          const inv = await getCharacterInventory(pool, charId);
          expect(inv.slots.length).toBeGreaterThanOrEqual(1);
          times1000.push(performance.now() - t0);
        })
      );
    }
    const wallTime1000 = performance.now() - start1000;
    times1000.sort((a, b) => a - b);

    // Bench C: 100 distinct claims
    const huntId = randomUUID();
    const segId = randomUUID();
    await pool.query(
      `INSERT INTO hunts (id, character_id, start_idempotency_key, zone_id, strategy, status, started_at, settled_until, completed_at, simulation_version, config_digest, private_checkpoint, reserved_hp_potions, reserved_mp_potions, potions_returned)
       VALUES ($1, $2, 'perf-hunt', 'damp-catacombs', 'balanced', 'COMPLETED', NOW(), NOW(), NOW(), '1.0.0', 'd', '{}'::jsonb, 0, 0, true)`,
      [huntId, charId]
    );
    await pool.query(
      `INSERT INTO hunt_segments (id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version, segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, rewards)
       VALUES ($1, $2, 's1', 1, 2, NOW(), NOW(), 1000, 1, 'TIME_REACHED', '{"deltaLootByItem":{"copper-coin":100}}'::jsonb)`,
      [segId, huntId]
    );

    // Create 100 segments with 1 reward row each
    const rewardIds: string[] = [];
    for (let i = 0; i < 100; i++) {
      const sId = randomUUID();
      await pool.query(
        `INSERT INTO hunt_segments (id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version, segment_from, segment_to, processed_duration_ms, simulated_events, stop_reason, rewards)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), 1000, 1, 'TIME_REACHED', '{"deltaLootByItem":{"copper-coin":1}}'::jsonb)`,
        [sId, huntId, `perf-seg-${i}`, i + 2, i + 3]
      );
      const rId = randomUUID();
      rewardIds.push(rId);
      await pool.query(
        `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
         VALUES ($1, $2, $3, $4, 'copper-coin', 1, 'UNCLAIMED')`,
        [rId, huntId, sId, charId]
      );
    }

    const startClaims = performance.now();
    const claimTimes: number[] = [];
    // Process in batches of 10
    for (let i = 0; i < 100; i += 10) {
      await Promise.all(
        rewardIds.slice(i, i + 10).map(async (rId, idx) => {
          const t0 = performance.now();
          const res = await claimHuntReward(pool, {
            characterId: charId,
            rewardId: rId,
            idempotencyKey: `perf-claim-${i + idx}`
          });
          expect(res.status).toBe('SUCCESS');
          claimTimes.push(performance.now() - t0);
        })
      );
    }
    const wallTimeClaims = performance.now() - startClaims;
    claimTimes.sort((a, b) => a - b);

    // Bench D: 20-way concurrent race on the SAME reward
    const raceRewardId = randomUUID();
    await pool.query(
      `INSERT INTO hunt_reward_items (id, hunt_id, hunt_segment_id, character_id, item_id, quantity, ownership_state)
       VALUES ($1, $2, $3, $4, 'chitin-plate', 2, 'UNCLAIMED')`,
      [raceRewardId, huntId, segId, charId]
    );

    const raceStart = performance.now();
    const raceResults = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        claimHuntReward(pool, {
          characterId: charId,
          rewardId: raceRewardId,
          idempotencyKey: `perf-race-${i}`
        })
      )
    );
    const wallTimeRace = performance.now() - raceStart;
    const raceSuccessCount = raceResults.filter((r) => r.status === 'SUCCESS').length;
    const raceAlreadyCount = raceResults.filter((r) => r.status === 'REWARD_ALREADY_CLAIMED').length;
    expect(raceSuccessCount).toBe(1);
    expect(raceAlreadyCount).toBe(19);

    // Bench E: 100 sequential Move & Split operations
    const startMove = performance.now();
    for (let i = 0; i < 50; i++) {
      await moveInventoryItem(pool, {
        characterId: charId,
        fromSlot: 0,
        toSlot: 5,
        idempotencyKey: `perf-move-${i}-a`
      });
      await moveInventoryItem(pool, {
        characterId: charId,
        fromSlot: 5,
        toSlot: 0,
        idempotencyKey: `perf-move-${i}-b`
      });
    }
    const wallTimeMove = performance.now() - startMove;

    const finalMemory = process.memoryUsage().heapUsed;
    const heapDeltaMb = Number(((finalMemory - initialMemory) / (1024 * 1024)).toFixed(2));

    const summary = {
      bench100Reads: {
        total: 100,
        wallTimeMs: Number(wallTime100.toFixed(2)),
        readsPerSec: Math.round((100 / wallTime100) * 1000),
        p50Ms: percentile(times100, 50),
        p95Ms: percentile(times100, 95)
      },
      bench1000Reads: {
        total: 1000,
        wallTimeMs: Number(wallTime1000.toFixed(2)),
        readsPerSec: Math.round((1000 / wallTime1000) * 1000),
        p50Ms: percentile(times1000, 50),
        p95Ms: percentile(times1000, 95)
      },
      bench100Claims: {
        total: 100,
        wallTimeMs: Number(wallTimeClaims.toFixed(2)),
        claimsPerSec: Math.round((100 / wallTimeClaims) * 1000),
        p50Ms: percentile(claimTimes, 50),
        p95Ms: percentile(claimTimes, 95)
      },
      race20Claims: {
        wallTimeMs: Number(wallTimeRace.toFixed(2)),
        successCount: raceSuccessCount,
        rejectedCount: raceAlreadyCount
      },
      move100Ops: {
        total: 100,
        wallTimeMs: Number(wallTimeMove.toFixed(2)),
        opsPerSec: Math.round((100 / wallTimeMove) * 1000)
      },
      heapDeltaMb
    };

    console.log('[INVENTORY_PERF_BASELINE]', JSON.stringify(summary));
    expect(summary.bench100Reads.readsPerSec).toBeGreaterThan(100);
    expect(summary.bench1000Reads.readsPerSec).toBeGreaterThan(200);
  });
});
