import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  applyMigrations,
  createDatabasePool,
  loadMigrationsFromDir,
  resolveTestDatabaseConfig,
  settleHunt,
  startHunt
} from '@tibia-idle/database';
import { createFixedClock, HUNT_STRATEGIES } from '@tibia-idle/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

interface DbSettlementBenchSummary {
  readonly label: string;
  readonly sessions: number;
  readonly concurrency: number;
  readonly wallTimeMs: number;
  readonly sessionsPerSec: number;
  readonly p50TotalMs: number;
  readonly p95TotalMs: number;
  readonly avgSimulationMs: number;
  readonly avgLockWaitMs: number;
  readonly avgTransactionMs: number;
  readonly totalRetries: number;
  readonly heapDeltaMb: number;
}

function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((p / 100) * sortedValues.length))
  );
  return Number((sortedValues[idx] ?? 0).toFixed(2));
}

describe('IDLE-004B-1 — PostgreSQL Settlement Performance & Concurrency Baseline (100 & 1000 sessions)', () => {
  const dbConfig = resolveTestDatabaseConfig(process.env);
  const pool = createDatabasePool({
    ...dbConfig,
    maxConnections: 20
  });

  beforeAll(async () => {
    const migrations = loadMigrationsFromDir();
    await applyMigrations(pool, migrations);
    await pool.query(
      'TRUNCATE TABLE currency_ledger, hunt_reward_items, hunt_segments, hunts, characters, sessions, users RESTART IDENTITY CASCADE'
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedBatchHunts(count: number, clockIso: string): Promise<string[]> {
    const clock = createFixedClock(Date.parse(clockIso));
    const userIds: string[] = [];
    const charIds: string[] = [];

    for (let i = 0; i < count; i += 1) {
      userIds.push(randomUUID());
      charIds.push(randomUUID());
    }

    // Bulk insert test accounts & knights so benchmark measures startHunt/settleHunt accurately
    await pool.query(
      `INSERT INTO users (id, email, email_normalized, password_hash, locale, created_at)
       SELECT u_id, 'bench_' || ord || '_' || u_id || '@example.com', 'bench_' || ord || '_' || u_id || '@example.com', 'hash', 'pl', $2::timestamptz
       FROM unnest($1::uuid[]) WITH ORDINALITY AS t(u_id, ord)`,
      [userIds, clockIso]
    );

    await pool.query(
      `INSERT INTO characters (
         id, user_id, slot_number, name, name_normalized, vocation,
         level, xp, hp, max_hp, mp, max_mp, gold,
         skill_melee, skill_distance, skill_magic, skill_shielding,
         hp_potions, mp_potions, created_at
       )
       SELECT
         c_id, u_id, 1,
         'BenchKnight_' || ord || '_' || substr(c_id::text, 1, 6),
         'benchknight_' || ord || '_' || substr(c_id::text, 1, 6),
         'knight', 12, 0, 350, 350, 95, 95, 100,
         35, 10, 1, 34,
         500, 300, $3::timestamptz
       FROM unnest($1::uuid[], $2::uuid[]) WITH ORDINALITY AS t(c_id, u_id, ord)`,
      [charIds, userIds, clockIso]
    );

    const zones = ['damp-catacombs', 'sunken-crypts'] as const;
    const huntIds: string[] = [];
    const concurrency = 20;

    for (let offset = 0; offset < count; offset += concurrency) {
      const slice = charIds.slice(offset, offset + concurrency);
      const started = await Promise.all(
        slice.map((characterId, idx) => {
          const i = offset + idx;
          return startHunt(pool, {
            characterId,
            zoneId: zones[i % zones.length] ?? 'damp-catacombs',
            strategy: HUNT_STRATEGIES[i % HUNT_STRATEGIES.length] ?? 'balanced',
            idempotencyKey: `bench-start-${i}`,
            seedSource: () => 500_000 + i,
            clock
          });
        })
      );
      for (const res of started) {
        if (!res.ok) {
          throw new Error(`Benchmark startHunt failed: ${res.reason}`);
        }
        huntIds.push(res.hunt.huntId);
      }
    }

    return huntIds;
  }

  async function runSettlementBatchBenchmark(params: {
    label: string;
    huntIds: readonly string[];
    concurrency: number;
    settleClockIso: string;
  }): Promise<DbSettlementBenchSummary> {
    const settleClock = createFixedClock(Date.parse(params.settleClockIso));
    const totalTimes: number[] = [];
    let sumSimMs = 0;
    let sumLockMs = 0;
    let sumTxMs = 0;
    let totalRetries = 0;

    const memBefore = process.memoryUsage().heapUsed;
    const t0 = performance.now();

    for (let offset = 0; offset < params.huntIds.length; offset += params.concurrency) {
      const batch = params.huntIds.slice(offset, offset + params.concurrency);
      const results = await Promise.all(
        batch.map((huntId, idx) =>
          settleHunt(pool, {
            huntId,
            segmentKey: `bench-settle-${offset + idx}`,
            clock: settleClock
          })
        )
      );
      for (const res of results) {
        if (!res.ok) {
          throw new Error(`Benchmark settleHunt failed: ${res.reason}`);
        }
        totalTimes.push(res.telemetry.totalMs);
        sumSimMs += res.telemetry.simulationMs;
        sumLockMs += res.telemetry.lockWaitMs;
        sumTxMs += res.telemetry.transactionMs;
        totalRetries += res.telemetry.retries;
      }
    }

    const wallTimeMs = Math.max(0.01, performance.now() - t0);
    const memAfter = process.memoryUsage().heapUsed;
    const sorted = [...totalTimes].sort((a, b) => a - b);
    const count = params.huntIds.length;

    return {
      label: params.label,
      sessions: count,
      concurrency: params.concurrency,
      wallTimeMs: Number(wallTimeMs.toFixed(2)),
      sessionsPerSec: Math.floor((count / wallTimeMs) * 1000),
      p50TotalMs: percentile(sorted, 50),
      p95TotalMs: percentile(sorted, 95),
      avgSimulationMs: Number((sumSimMs / count).toFixed(3)),
      avgLockWaitMs: Number((sumLockMs / count).toFixed(3)),
      avgTransactionMs: Number((sumTxMs / count).toFixed(3)),
      totalRetries,
      heapDeltaMb: Number(((memAfter - memBefore) / (1024 * 1024)).toFixed(2))
    };
  }

  it('measures PostgreSQL settlement throughput, lock wait, transaction time, p50/p95, and retries for 100 sessions, 1000 sessions, and 10 parallel requests on a single character', async () => {
    const startIso100 = '2026-10-31T08:00:00.000Z';
    const settleIso100 = '2026-10-31T08:30:00.000Z'; // 30m offline per session
    const huntIds100 = await seedBatchHunts(100, startIso100);
    const bench100 = await runSettlementBatchBenchmark({
      label: '100x 30m DB settlements (concurrency=16)',
      huntIds: huntIds100,
      concurrency: 16,
      settleClockIso: settleIso100
    });

    const startIso1000 = '2026-10-31T09:00:00.000Z';
    const settleIso1000 = '2026-10-31T09:30:00.000Z'; // 30m offline per session
    const huntIds1000 = await seedBatchHunts(1000, startIso1000);
    const bench1000 = await runSettlementBatchBenchmark({
      label: '1000x 30m DB settlements (concurrency=20)',
      huntIds: huntIds1000,
      concurrency: 20,
      settleClockIso: settleIso1000
    });

    // Also measure 10 simultaneous settle requests colliding on the SAME active hunt
    const [contendedHuntId] = await seedBatchHunts(1, '2026-10-31T10:00:00.000Z');
    if (!contendedHuntId) {
      throw new Error('Missing contendedHuntId');
    }
    const contendedClock = createFixedClock(Date.parse('2026-10-31T10:30:00.000Z'));
    const tContended0 = performance.now();
    const contendedResults = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        settleHunt(pool, {
          huntId: contendedHuntId,
          segmentKey: `contended-seg-${idx}`,
          clock: contendedClock
        })
      )
    );
    const contendedWallMs = Number((performance.now() - tContended0).toFixed(2));
    let contendedRetries = 0;
    let positiveElapsedCount = 0;
    for (const r of contendedResults) {
      expect(r.ok).toBe(true);
      if (r.ok) {
        contendedRetries += r.telemetry.retries;
        if (r.rewards.deltaElapsedMs > 0) {
          positiveElapsedCount += 1;
        }
      }
    }
    // Exactly 1 of the 10 concurrent settlements processes the 30m window; the other 9 observe 0ms remaining
    expect(positiveElapsedCount).toBe(1);

    console.info(
      '[HUNT_DB_BENCHMARK_BASELINE]',
      JSON.stringify({
        bench100,
        bench1000,
        sameCharacterContention10x: {
          wallTimeMs: contendedWallMs,
          totalRetries: contendedRetries,
          positiveElapsedCount
        }
      })
    );

    expect(bench100.sessions).toBe(100);
    expect(bench1000.sessions).toBe(1000);
  });
});
