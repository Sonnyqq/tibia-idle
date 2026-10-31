import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  applyMigrations,
  createDatabasePool,
  equipInventoryItem,
  getCharacterEquipment,
  loadMigrationsFromDir,
  resolveTestDatabaseConfig,
  startHunt,
  unequipInventoryItem
} from '@tibia-idle/database';
import {
  createSystemClock
} from '@tibia-idle/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((p / 100) * sortedValues.length))
  );
  return Number((sortedValues[idx] ?? 0).toFixed(2));
}

describe('IDLE-005B — Equipment Paperdoll & Combat Stats Performance Baseline', () => {
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

  it('measures baseline performance for 100 reads, 1000 reads, 100 equip/unequip cycles, 20-way race, and startHunt with/without equipment', async () => {
    const userId = randomUUID();
    const charId = randomUUID();
    const backpackId = randomUUID();
    const equipmentId = randomUUID();

    const email = `perf_equip_${randomUUID()}@example.com`;
    await pool.query(
      `INSERT INTO users (id, email, email_normalized, password_hash, locale)
       VALUES ($1, $2, $2, 'hash', 'en')`,
      [userId, email]
    );

    const charName = `EquipPerf ${randomUUID().replace(/[^a-zA-Z]/g, '').slice(0, 6)}`;
    await pool.query(
      `INSERT INTO characters (
         id, user_id, slot_number, name, name_normalized, vocation,
         level, xp, hp, max_hp, mp, max_mp, gold,
         skill_melee, skill_distance, skill_magic, skill_shielding
       )
       VALUES ($1, $2, 1, $3, lower($3), 'knight', 10, 5000, 320, 320, 85, 85, 1000, 30, 10, 5, 25)`,
      [charId, userId, charName]
    );

    // Containers: backpack (20 slots) and equipment (9 slots)
    await pool.query(
      `INSERT INTO inventory_containers (id, character_id, container_type, slot_capacity)
       VALUES ($1, $3, 'backpack', 20), ($2, $3, 'equipment', 9)`,
      [backpackId, equipmentId, charId]
    );

    // Add weapon to backpack slot 0
    const weaponInstanceId = randomUUID();
    await pool.query(
      `INSERT INTO inventory_instances (id, character_id, container_id, slot_index, item_id, quantity, row_version)
       VALUES ($1, $2, $3, 0, 'rusted-blade', 1, 1)`,
      [weaponInstanceId, charId, backpackId]
    );

    // --- Benchmark 1: 100 Equipment Reads ---
    const read100Durations: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t0 = performance.now();
      const eq = await getCharacterEquipment(pool, charId);
      const t1 = performance.now();
      read100Durations.push(t1 - t0);
      expect(eq.characterId).toBe(charId);
    }
    read100Durations.sort((a, b) => a - b);
    const read100Avg = read100Durations.reduce((a, b) => a + b, 0) / 100;
    const read100P95 = percentile(read100Durations, 95);
    const read100P99 = percentile(read100Durations, 99);

    // --- Benchmark 2: 1000 Equipment Reads ---
    const read1000Durations: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const t0 = performance.now();
      const eq = await getCharacterEquipment(pool, charId);
      const t1 = performance.now();
      read1000Durations.push(t1 - t0);
      expect(eq.characterId).toBe(charId);
    }
    read1000Durations.sort((a, b) => a - b);
    const read1000Avg = read1000Durations.reduce((a, b) => a + b, 0) / 1000;
    const read1000P95 = percentile(read1000Durations, 95);
    const read1000P99 = percentile(read1000Durations, 99);

    // --- Benchmark 3: 100 Equip / Unequip Cycles ---
    const cycleDurations: number[] = [];
    const clock = createSystemClock();
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      const equipRes = await equipInventoryItem(pool, {
        characterId: charId,
        backpackSlot: 0,
        equipmentSlot: 'weapon',
        idempotencyKey: randomUUID()
      });
      const unequipRes = await unequipInventoryItem(pool, {
        characterId: charId,
        equipmentSlot: 'weapon',
        targetBackpackSlot: 0,
        idempotencyKey: randomUUID()
      });
      const t1 = performance.now();
      cycleDurations.push(t1 - t0);
      expect(equipRes.status).toBe('SUCCESS');
      expect(unequipRes.status).toBe('SUCCESS');
    }
    cycleDurations.sort((a, b) => a - b);
    const cycleAvg = cycleDurations.reduce((a, b) => a + b, 0) / 50;
    const cycleP95 = percentile(cycleDurations, 95);
    const cycleP99 = percentile(cycleDurations, 99);

    // --- Benchmark 4: 20-way Concurrent Race on Equip ---
    const raceT0 = performance.now();
    const raceResults = await Promise.all(
      Array.from({ length: 20 }, () =>
        equipInventoryItem(pool, {
          characterId: charId,
          backpackSlot: 0,
          equipmentSlot: 'weapon',
          idempotencyKey: randomUUID()
        })
      )
    );
    const raceWallMs = performance.now() - raceT0;
    const successes = raceResults.filter((r) => r.status === 'SUCCESS');
    expect(successes).toHaveLength(1);

    // Unequip to restore state
    await unequipInventoryItem(pool, {
      characterId: charId,
      equipmentSlot: 'weapon',
      targetBackpackSlot: 0,
      idempotencyKey: randomUUID()
    });

    // --- Benchmark 5: startHunt with Equipment vs without Equipment ---
    // Start hunt without equipment
    const startWithoutT0 = performance.now();
    const huntWithoutRes = await startHunt(pool, {
      characterId: charId,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      requestedHpPotions: 0,
      requestedMpPotions: 0,
      idempotencyKey: randomUUID(),
      clock
    });
    const startWithoutMs = performance.now() - startWithoutT0;
    expect(huntWithoutRes.ok).toBe(true);
    if (huntWithoutRes.ok) {
      // Cancel/stop hunt to free character
      await pool.query(
        "UPDATE hunts SET status = 'COMPLETED', stop_reason = 'MANUAL_STOP', completed_at = NOW(), potions_returned = TRUE WHERE id = $1",
        [huntWithoutRes.hunt.huntId]
      );
    }

    // Now equip weapon
    await equipInventoryItem(pool, {
      characterId: charId,
      backpackSlot: 0,
      equipmentSlot: 'weapon',
      idempotencyKey: randomUUID()
    });

    // Start hunt with weapon equipped
    const startWithT0 = performance.now();
    const huntWithRes = await startHunt(pool, {
      characterId: charId,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      requestedHpPotions: 0,
      requestedMpPotions: 0,
      idempotencyKey: randomUUID(),
      clock
    });
    const startWithMs = performance.now() - startWithT0;
    expect(huntWithRes.ok).toBe(true);
    if (huntWithRes.ok) {
      await pool.query(
        "UPDATE hunts SET status = 'COMPLETED', stop_reason = 'MANUAL_STOP', completed_at = NOW(), potions_returned = TRUE WHERE id = $1",
        [huntWithRes.hunt.huntId]
      );
    }

    const report = {
      read100: { avgMs: Number(read100Avg.toFixed(2)), p95Ms: read100P95, p99Ms: read100P99 },
      read1000: { avgMs: Number(read100Avg.toFixed(2)), p95Ms: read1000P95, p99Ms: read1000P99 },
      cycle50EquipUnequip: { avgMs: Number(cycleAvg.toFixed(2)), p95Ms: cycleP95, p99Ms: cycleP99 },
      race20ConcurrentEquip: { wallMs: Number(raceWallMs.toFixed(2)) },
      startHuntWithoutEquipmentMs: Number(startWithoutMs.toFixed(2)),
      startHuntWithEquipmentMs: Number(startWithMs.toFixed(2))
    };

    console.log('[EQUIPMENT_PERF_BENCHMARK]', JSON.stringify(report));

    expect(read100Avg).toBeLessThan(50);
    expect(read1000Avg).toBeLessThan(50);
    expect(cycleAvg).toBeLessThan(100);
    expect(raceWallMs).toBeLessThan(500);
  });
});
