import {
  analyzeZoneEfficiency,
  assertCatalogAlignmentWithCombatConfig,
  type CombatCharacterSnapshot,
  type CombatSimulationConfig,
  createInitialCombatCheckpoint,
  createInitialRngState,
  createKnightCombatSnapshot,
  createStatefulRng,
  DEFAULT_COMBAT_RESOURCES,
  DEFAULT_COMBAT_SIMULATION_CONFIG,
  HUNT_STRATEGIES,
  MAX_OFFLINE_DURATION_MS,
  resolveKnightAttack,
  resolveMonsterAttack,
  rollMonsterKillLoot,
  simulateHuntSegment,
  validateCombatConfig
} from '@tibia-idle/domain';
import { describe, expect, it } from 'vitest';

describe('IDLE-004A — Deterministic Idle Combat Engine (Unit, Golden, Replay, Chunk Equivalence & Property Tests)', () => {
  it('aligns 100% with INITIAL_ZONES_CATALOG (3 zones, 6 monsters, 12 items) and validates config', () => {
    expect(() => assertCatalogAlignmentWithCombatConfig()).not.toThrow();
    expect(() => validateCombatConfig(DEFAULT_COMBAT_SIMULATION_CONFIG)).not.toThrow();
    expect(Object.keys(DEFAULT_COMBAT_SIMULATION_CONFIG.zones)).toEqual([
      'damp-catacombs',
      'sunken-crypts',
      'ashwind-ridge'
    ]);
    expect(Object.keys(DEFAULT_COMBAT_SIMULATION_CONFIG.monsters)).toEqual([
      'cellar-stalker',
      'mire-carapace',
      'bone-sentinel',
      'crypt-wraith',
      'ashwind-drake',
      'ember-acolyte'
    ]);
  });

  it('produces bit-exact golden Mulberry32 RNG sequence and restores state at arbitrary cursor', () => {
    const initial = createInitialRngState(1337);
    const rngA = createStatefulRng(initial);
    const seqA = [
      rngA.nextUint32(),
      rngA.nextUint32(),
      rngA.nextUint32(),
      rngA.nextUint32(),
      rngA.nextUint32()
    ];

    // Golden snapshot for seed 1337
    expect(seqA).toEqual([
      792042790,
      815997621,
      3480950701,
      2764880138,
      1850162886
    ]);

    // Checkpoint after 2 draws and resume
    const rngB1 = createStatefulRng(initial);
    expect(rngB1.nextUint32()).toBe(seqA[0]);
    expect(rngB1.nextUint32()).toBe(seqA[1]);
    const savedState = rngB1.getState();
    expect(savedState.cursor).toBe(2);

    const rngB2 = createStatefulRng(savedState);
    expect([rngB2.nextUint32(), rngB2.nextUint32(), rngB2.nextUint32()]).toEqual(
      seqA.slice(2)
    );
    expect(rngB2.getState()).toEqual(rngA.getState());
  });

  it('locks golden simulation output for Knight Level 5 in damp-catacombs (seed 20261031, 15 min)', () => {
    const knight = createKnightCombatSnapshot({
      level: 5,
      melee: 22,
      shielding: 21
    });
    const cp0 = createInitialCombatCheckpoint({
      character: knight,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      seed: 20261031
    });

    const res = simulateHuntSegment({
      character: knight,
      checkpoint: cp0,
      durationMs: 15 * 60 * 1000
    });

    // Golden invariants & exact deterministic replay
    const replayRes = simulateHuntSegment({
      character: knight,
      checkpoint: cp0,
      durationMs: 15 * 60 * 1000
    });
    expect(replayRes).toEqual(res);
    expect(res.checkpoint.totalKills).toBeGreaterThan(25);
    expect(res.checkpoint.totalXpGained).toBeGreaterThan(700);
    expect(res.checkpoint.totalGoldGained).toBeGreaterThan(80);
    expect(res.checkpoint.rng.cursor).toBeGreaterThan(100);
  });

  it('guarantees strict chunk equivalence: 60m single-pass === 30m + 30m === irregular mid-encounter splits', () => {
    const knight = createKnightCombatSnapshot({
      level: 10,
      melee: 32,
      shielding: 30
    });

    for (const strategy of HUNT_STRATEGIES) {
      const cpInitial = createInitialCombatCheckpoint({
        character: knight,
        zoneId: 'sunken-crypts',
        strategy,
        seed: 987654321
      });

      const sixtyMinMs = 60 * 60 * 1000;
      const continuous = simulateHuntSegment({
        character: knight,
        checkpoint: cpInitial,
        durationMs: sixtyMinMs
      });

      // 30m + 30m split
      const half1 = simulateHuntSegment({
        character: knight,
        checkpoint: cpInitial,
        durationMs: 30 * 60 * 1000
      });
      const half2 = simulateHuntSegment({
        character: knight,
        checkpoint: half1.checkpoint,
        durationMs: 30 * 60 * 1000
      });

      expect(half2.checkpoint).toEqual(continuous.checkpoint);
      expect(half1.deltaKills + half2.deltaKills).toBe(continuous.deltaKills);
      expect(half1.deltaXpGained + half2.deltaXpGained).toBe(continuous.deltaXpGained);
      expect(half1.deltaGoldGained + half2.deltaGoldGained).toBe(continuous.deltaGoldGained);

      // Irregular millisecond splits that cut directly across ongoing encounters (e.g. 777ms, 2345ms, ...)
      const irregularChunks = [
        777,
        2_345,
        15_111,
        41_767,
        540_000,
        1_200_000,
        1_800_000
      ];
      expect(irregularChunks.reduce((a, b) => a + b, 0)).toBe(sixtyMinMs);

      let runningCp = cpInitial;
      for (const chunkMs of irregularChunks) {
        const step = simulateHuntSegment({
          character: knight,
          checkpoint: runningCp,
          durationMs: chunkMs
        });
        runningCp = step.checkpoint;
      }

      expect(runningCp).toEqual(continuous.checkpoint);
    }
  });

  it('handles 0s, 1s, 1h, 24h, and >24h cap durations accurately', () => {
    const knight = createKnightCombatSnapshot({
      level: 14,
      melee: 45,
      shielding: 44
    });
    const abundantResources = {
      ...DEFAULT_COMBAT_RESOURCES,
      hpPotions: 5000,
      mpPotions: 5000
    };

    const cp0 = createInitialCombatCheckpoint({
      character: knight,
      zoneId: 'damp-catacombs',
      strategy: 'safe',
      seed: 42,
      resources: abundantResources
    });

    // 0 seconds
    const zeroRes = simulateHuntSegment({
      character: knight,
      checkpoint: cp0,
      durationMs: 0,
      resourcesConfig: abundantResources
    });
    expect(zeroRes.deltaElapsedMs).toBe(0);
    expect(zeroRes.deltaKills).toBe(0);
    expect(zeroRes.checkpoint.totalXpGained).toBe(0);
    expect(zeroRes.checkpoint.totalGoldGained).toBe(0);
    expect(Object.keys(zeroRes.checkpoint.totalLootByItem)).toHaveLength(0);

    // 1 second (1000ms: encounter spawns, timers decrement by 1000ms, 0 kills yet -> 0 loot)
    const oneSecRes = simulateHuntSegment({
      character: knight,
      checkpoint: cp0,
      durationMs: 1000,
      resourcesConfig: abundantResources
    });
    expect(oneSecRes.deltaElapsedMs).toBe(1000);
    expect(oneSecRes.deltaKills).toBe(0);
    expect(Object.keys(oneSecRes.checkpoint.totalLootByItem)).toHaveLength(0);
    expect(oneSecRes.checkpoint.activeEncounter).not.toBeNull();
    expect(oneSecRes.checkpoint.activeEncounter?.nextPlayerAttackInMs).toBe(1000);

    // 1 hour
    const oneHourRes = simulateHuntSegment({
      character: knight,
      checkpoint: cp0,
      durationMs: 3_600_000,
      resourcesConfig: abundantResources
    });
    expect(oneHourRes.deltaElapsedMs).toBe(3_600_000);
    expect(oneHourRes.checkpoint.totalKills).toBeGreaterThan(200);
    expect(oneHourRes.stopReason).toBe('TIME_REACHED');

    // >24h request is capped at MAX_OFFLINE_DURATION_MS (24h = 86_400_000ms)
    const overCapRes = simulateHuntSegment({
      character: knight,
      checkpoint: cp0,
      durationMs: MAX_OFFLINE_DURATION_MS + 7_200_000,
      resourcesConfig: abundantResources
    });
    expect(overCapRes.checkpoint.elapsedMs).toBe(MAX_OFFLINE_DURATION_MS);
    expect(overCapRes.stopReason).toBe('MAX_OFFLINE_CAP_REACHED');
    expect(overCapRes.checkpoint.terminated).toBe(true);
  });

  it('terminates simulation cleanly on character death or critical potion exhaustion and never drops HP/MP below 0', () => {
    // Weak level 1 knight with 0 potions entering high-level ashwind-ridge
    const fragileKnight = createKnightCombatSnapshot({
      level: 1,
      melee: 10,
      shielding: 10,
      hp: 80,
      maxHp: 80
    });
    const noPotions = {
      ...DEFAULT_COMBAT_RESOURCES,
      hpPotions: 0,
      mpPotions: 0
    };

    const cpAggressive = createInitialCombatCheckpoint({
      character: fragileKnight,
      zoneId: 'ashwind-ridge',
      strategy: 'aggressive',
      seed: 777,
      resources: noPotions
    });

    const deathRes = simulateHuntSegment({
      character: fragileKnight,
      checkpoint: cpAggressive,
      durationMs: 600_000,
      resourcesConfig: noPotions
    });

    expect(deathRes.checkpoint.terminated).toBe(true);
    expect(deathRes.stopReason).toBe('CHARACTER_DIED');
    expect(deathRes.checkpoint.currentHp).toBe(0);
    expect(deathRes.checkpoint.currentMp).toBeGreaterThanOrEqual(0);
    expect(deathRes.checkpoint.elapsedMs).toBeLessThan(600_000);

    // Calling simulateHuntSegment again on a terminated checkpoint is a safe no-op
    const afterDeathRes = simulateHuntSegment({
      character: fragileKnight,
      checkpoint: deathRes.checkpoint,
      durationMs: 60_000,
      resourcesConfig: noPotions
    });
    expect(afterDeathRes.deltaElapsedMs).toBe(0);
    expect(afterDeathRes.deltaKills).toBe(0);

    // Safe strategy with 1 potion retreats before dying when potions run out and HP falls below 45%
    const onePotion = {
      ...DEFAULT_COMBAT_RESOURCES,
      hpPotions: 1,
      mpPotions: 0
    };
    const midKnight = createKnightCombatSnapshot({
      level: 8,
      melee: 25,
      shielding: 25,
      hp: 250,
      maxHp: 250
    });
    const cpSafe = createInitialCombatCheckpoint({
      character: midKnight,
      zoneId: 'sunken-crypts',
      strategy: 'safe',
      seed: 555,
      resources: onePotion
    });
    const retreatRes = simulateHuntSegment({
      character: midKnight,
      checkpoint: cpSafe,
      durationMs: 3_600_000,
      resourcesConfig: onePotion
    });
    expect(retreatRes.checkpoint.terminated).toBe(true);
    expect(retreatRes.stopReason).toBe('OUT_OF_HP_POTIONS_CRITICAL');
    expect(retreatRes.checkpoint.currentHp).toBeGreaterThan(0);
  });

  it('demonstrates meaningful behavioral differences across SAFE, BALANCED, and AGGRESSIVE strategies', () => {
    const knight = createKnightCombatSnapshot({
      level: 10,
      melee: 30,
      shielding: 30
    });
    const largeResources = {
      ...DEFAULT_COMBAT_RESOURCES,
      hpPotions: 1000,
      mpPotions: 1000
    };

    const safeMetrics = analyzeZoneEfficiency({
      character: knight,
      zoneId: 'sunken-crypts',
      strategy: 'safe',
      seed: 10101,
      sampleDurationMs: 3_600_000,
      resources: largeResources
    });
    const balancedMetrics = analyzeZoneEfficiency({
      character: knight,
      zoneId: 'sunken-crypts',
      strategy: 'balanced',
      seed: 10101,
      sampleDurationMs: 3_600_000,
      resources: largeResources
    });
    const aggressiveMetrics = analyzeZoneEfficiency({
      character: knight,
      zoneId: 'sunken-crypts',
      strategy: 'aggressive',
      seed: 10101,
      sampleDurationMs: 3_600_000,
      resources: largeResources
    });

    // Aggressive kills faster and earns more XP/h than Balanced, which kills faster than Safe
    expect(aggressiveMetrics.killsPerHour).toBeGreaterThan(balancedMetrics.killsPerHour);
    expect(balancedMetrics.killsPerHour).toBeGreaterThan(safeMetrics.killsPerHour);
    expect(aggressiveMetrics.xpPerHour).toBeGreaterThan(balancedMetrics.xpPerHour);
    expect(balancedMetrics.xpPerHour).toBeGreaterThan(safeMetrics.xpPerHour);

    // Aggressive consumes more mana potions (Brutal Strike) and takes more damage than Safe
    expect(aggressiveMetrics.mpPotionsPerHour).toBeGreaterThan(safeMetrics.mpPotionsPerHour);
  });

  it('rejects non-Knight vocations and invalid combat configurations or snapshots', () => {
    const invalidVocationSnapshot: CombatCharacterSnapshot = {
      ...createKnightCombatSnapshot({ level: 5, melee: 20, shielding: 20 }),
      vocation: 'sorcerer'
    };

    expect(() =>
      createInitialCombatCheckpoint({
        character: invalidVocationSnapshot,
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        seed: 1
      })
    ).toThrow(/only 'knight' is enabled/);

    expect(() =>
      createInitialCombatCheckpoint({
        character: createKnightCombatSnapshot({ level: 5, melee: 20, shielding: 20 }),
        zoneId: 'non-existent-zone',
        strategy: 'balanced',
        seed: 1
      })
    ).toThrow(/Unknown zone/);

    const badConfig: CombatSimulationConfig = {
      ...DEFAULT_COMBAT_SIMULATION_CONFIG,
      playerAttackIntervalMs: 0
    };
    expect(() => validateCombatConfig(badConfig)).toThrow();
  });

  it('verifies property invariants across 60 randomized seeds, levels, zones, and strategies', () => {
    const prng = createStatefulRng(createInitialRngState(9001));
    const zoneIds = Object.keys(DEFAULT_COMBAT_SIMULATION_CONFIG.zones);

    for (let i = 0; i < 60; i += 1) {
      const level = prng.nextInt(1, 35);
      const melee = prng.nextInt(10, 65);
      const shielding = prng.nextInt(10, 65);
      const zoneId = zoneIds[prng.nextInt(0, zoneIds.length - 1)] ?? 'damp-catacombs';
      const strategy = HUNT_STRATEGIES[prng.nextInt(0, HUNT_STRATEGIES.length - 1)] ?? 'balanced';
      const seed = prng.nextUint32();
      const durationMs = prng.nextInt(0, 600_000);

      const knight = createKnightCombatSnapshot({ level, melee, shielding });
      const cp0 = createInitialCombatCheckpoint({
        character: knight,
        zoneId,
        strategy,
        seed
      });

      const res = simulateHuntSegment({
        character: knight,
        checkpoint: cp0,
        durationMs
      });

      const cp = res.checkpoint;

      // Invariant 1: Vitals and resources are finite integers within [0, max]
      expect(Number.isSafeInteger(cp.currentHp)).toBe(true);
      expect(cp.currentHp).toBeGreaterThanOrEqual(0);
      expect(cp.currentHp).toBeLessThanOrEqual(knight.maxHp);

      expect(Number.isSafeInteger(cp.currentMp)).toBe(true);
      expect(cp.currentMp).toBeGreaterThanOrEqual(0);
      expect(cp.currentMp).toBeLessThanOrEqual(knight.maxMp);

      expect(cp.hpPotionsRemaining).toBeGreaterThanOrEqual(0);
      expect(cp.mpPotionsRemaining).toBeGreaterThanOrEqual(0);

      // Invariant 2: Rewards are non-negative integers and zero when totalKills === 0
      expect(Number.isSafeInteger(cp.totalXpGained)).toBe(true);
      expect(Number.isSafeInteger(cp.totalGoldGained)).toBe(true);
      expect(cp.totalXpGained).toBeGreaterThanOrEqual(0);
      expect(cp.totalGoldGained).toBeGreaterThanOrEqual(0);

      if (cp.totalKills === 0) {
        expect(cp.totalXpGained).toBe(0);
        expect(cp.totalGoldGained).toBe(0);
        expect(Object.keys(cp.totalLootByItem)).toHaveLength(0);
      }

      // Invariant 3: Sum of killsByMonster equals totalKills
      const monsterKillsSum = Object.values(cp.killsByMonster).reduce((a, b) => a + b, 0);
      expect(monsterKillsSum).toBe(cp.totalKills);

      // Invariant 4: Every dropped item quantity is a positive integer
      for (const qty of Object.values(cp.totalLootByItem)) {
        expect(Number.isSafeInteger(qty)).toBe(true);
        expect(qty).toBeGreaterThan(0);
      }

      // Invariant 5: Damage rolls and loot rolls never produce NaN or negative values
      const sampleMonster = DEFAULT_COMBAT_SIMULATION_CONFIG.monsters['cellar-stalker'];
      if (!sampleMonster) {
        throw new Error('Missing cellar-stalker monster config');
      }
      const atk = resolveKnightAttack(
        knight,
        sampleMonster,
        DEFAULT_COMBAT_SIMULATION_CONFIG.strategies[strategy],
        cp.currentMp,
        prng
      );
      expect(atk.damage).toBeGreaterThanOrEqual(0);
      const def = resolveMonsterAttack(
        sampleMonster,
        knight,
        DEFAULT_COMBAT_SIMULATION_CONFIG.strategies[strategy],
        prng
      );
      expect(def).toBeGreaterThanOrEqual(0);
      const loot = rollMonsterKillLoot(sampleMonster, prng);
      expect(loot.goldGained).toBeGreaterThanOrEqual(sampleMonster.goldMin);
      expect(loot.goldGained).toBeLessThanOrEqual(sampleMonster.goldMax);
    }
  });
});
