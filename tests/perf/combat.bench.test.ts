import { performance } from 'node:perf_hooks';
import {
  createInitialCombatCheckpoint,
  createKnightCombatSnapshot,
  DEFAULT_COMBAT_RESOURCES,
  HUNT_STRATEGIES,
  MAX_OFFLINE_DURATION_MS,
  simulateHuntSegment
} from '@tibia-idle/domain';
import { describe, expect, it } from 'vitest';

interface BenchmarkMetrics {
  readonly label: string;
  readonly sessions: number;
  readonly durationPerSessionMs: number;
  readonly wallTimeMs: number;
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
  readonly totalEvents: number;
  readonly totalKills: number;
  readonly heapDeltaMb: number;
  readonly sessionsPerSec: number;
  readonly eventsPerSec: number;
}

function runCombatBenchmark(params: {
  label: string;
  sessions: number;
  durationPerSessionMs: number;
}): BenchmarkMetrics {
  const knight = createKnightCombatSnapshot({
    level: 14,
    melee: 42,
    shielding: 40
  });
  const resources = {
    ...DEFAULT_COMBAT_RESOURCES,
    hpPotions: 5000,
    mpPotions: 5000
  };
  const zones = ['damp-catacombs', 'sunken-crypts', 'ashwind-ridge'] as const;

  const memBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const t0 = performance.now();

  let totalEvents = 0;
  let totalKills = 0;

  for (let i = 0; i < params.sessions; i += 1) {
    const zoneId = zones[i % zones.length] ?? 'damp-catacombs';
    const strategy = HUNT_STRATEGIES[i % HUNT_STRATEGIES.length] ?? 'balanced';
    const cp0 = createInitialCombatCheckpoint({
      character: knight,
      zoneId,
      strategy,
      seed: 100_000 + i,
      resources
    });
    const res = simulateHuntSegment({
      character: knight,
      checkpoint: cp0,
      durationMs: params.durationPerSessionMs,
      resourcesConfig: resources
    });
    totalEvents += res.simulatedEvents;
    totalKills += res.deltaKills;
  }

  const wallTimeMs = Math.max(0.01, performance.now() - t0);
  const cpuDelta = process.cpuUsage(cpuBefore);
  const memAfter = process.memoryUsage().heapUsed;

  const cpuUserMs = Number((cpuDelta.user / 1000).toFixed(2));
  const cpuSystemMs = Number((cpuDelta.system / 1000).toFixed(2));
  const heapDeltaMb = Number(((memAfter - memBefore) / (1024 * 1024)).toFixed(2));
  const sessionsPerSec = Math.floor((params.sessions / wallTimeMs) * 1000);
  const eventsPerSec = Math.floor((totalEvents / wallTimeMs) * 1000);

  return {
    label: params.label,
    sessions: params.sessions,
    durationPerSessionMs: params.durationPerSessionMs,
    wallTimeMs: Number(wallTimeMs.toFixed(2)),
    cpuUserMs,
    cpuSystemMs,
    totalEvents,
    totalKills,
    heapDeltaMb,
    sessionsPerSec,
    eventsPerSec
  };
}

describe('IDLE-004A — Domain Combat Performance Baseline (100 sessions, 1000 sessions, 24h single session)', () => {
  it('measures baseline throughput for 100 sessions (1h), 1000 sessions (1h), and 1x 24h session', () => {
    const bench100 = runCombatBenchmark({
      label: '100x 1h offline sessions',
      sessions: 100,
      durationPerSessionMs: 3_600_000
    });
    const bench1000 = runCombatBenchmark({
      label: '1000x 1h offline sessions',
      sessions: 1000,
      durationPerSessionMs: 3_600_000
    });
    const bench24h = runCombatBenchmark({
      label: '1x 24h offline session',
      sessions: 1,
      durationPerSessionMs: MAX_OFFLINE_DURATION_MS
    });

    console.info('[COMBAT_BENCHMARK_BASELINE]', JSON.stringify({ bench100, bench1000, bench24h }));

    expect(bench100.totalEvents).toBeGreaterThan(100_000);
    expect(bench1000.totalEvents).toBeGreaterThan(1_000_000);
    expect(bench24h.totalEvents).toBeGreaterThan(50_000);
    expect(bench24h.totalKills).toBeGreaterThan(1000);
  });
});
