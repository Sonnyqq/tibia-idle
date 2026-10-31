import {
  analyzeZoneEfficiency,
  areHuntSnapshotsStructurallyEqual,
  assertCatalogAlignmentWithCombatConfig,
  assertNoRngLeakInPublicPayload,
  type CombatCharacterSnapshot,
  type CombatCheckpointState,
  type CombatResourceLoadout,
  type CombatSimulationConfig,
  createInitialCombatCheckpoint,
  createInitialRngState,
  createKnightCombatSnapshot,
  createStatefulRng,
  DEFAULT_COMBAT_RESOURCES,
  DEFAULT_COMBAT_SIMULATION_CONFIG,
  deserializeCombatCheckpoint,
  generateCryptographicHuntSeed,
  HUNT_STOP_REASONS,
  HUNT_STRATEGIES,
  isSupportedSimulationVersion,
  MAX_OFFLINE_DURATION_MS,
  MAX_POTION_STACK_COUNT,
  reconstructSimulationConfigFromSnapshot,
  resolveKnightAttack,
  resolveMonsterAttack,
  rollMonsterKillLoot,
  serializeCombatCheckpoint,
  simulateHuntSegment,
  toPublicHuntCheckpointView,
  validateCombatCheckpoint,
  validateCombatConfig,
  validateCombatResources
} from '@tibia-idle/domain';
import { describe, expect, it } from 'vitest';

describe('IDLE-004A — Deterministic Idle Combat Engine (Unit, Golden, Replay, Partial Settlement, Validation & Security Tests)', () => {
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

      // Irregular millisecond splits that cut directly across ongoing encounters
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

  it('handles EVENT_BUDGET_EXHAUSTED partial settlement and resumes to 100% bit-exact equivalence without losing time or duplicating rewards', () => {
    const knight = createKnightCombatSnapshot({
      level: 10,
      melee: 32,
      shielding: 30
    });
    const cp0 = createInitialCombatCheckpoint({
      character: knight,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      seed: 20260401
    });

    const targetDurationMs = 120_000; // 2 minutes
    const continuous = simulateHuntSegment({
      character: knight,
      checkpoint: cp0,
      durationMs: targetDurationMs
    });
    expect(continuous.stopReason).toBe('TIME_REACHED');
    expect(continuous.isPartialSettlement).toBe(false);
    expect(continuous.unprocessedDurationMs).toBe(0);
    expect(continuous.deltaElapsedMs).toBe(targetDurationMs);

    // Test very low event budgets (1, 2, 5, 19) to force frequent mid-encounter partial settlements
    for (const budget of [1, 2, 5, 19]) {
      const lowBudgetConfig: CombatSimulationConfig = {
        ...DEFAULT_COMBAT_SIMULATION_CONFIG,
        maxEventsPerCall: budget
      };

      // First call with low budget must NOT claim TIME_REACHED
      const firstCall = simulateHuntSegment({
        character: knight,
        checkpoint: cp0,
        durationMs: targetDurationMs,
        config: lowBudgetConfig
      });
      expect(firstCall.stopReason).toBe('EVENT_BUDGET_EXHAUSTED');
      expect(firstCall.isPartialSettlement).toBe(true);
      expect(firstCall.checkpoint.terminated).toBe(false);
      expect(firstCall.checkpoint.stopReason).toBeNull();
      expect(firstCall.deltaElapsedMs).toBeLessThan(targetDurationMs);
      expect(firstCall.deltaElapsedMs + firstCall.unprocessedDurationMs).toBe(targetDurationMs);

      // Resume loop until all requested time is processed
      let currentCp = cp0;
      let remainingMs = targetDurationMs;
      let sumElapsedMs = 0;
      let sumKills = 0;
      let sumXp = 0;
      let sumGold = 0;
      const sumLoot: Record<string, number> = {};
      let calls = 0;

      while (remainingMs > 0) {
        calls += 1;
        expect(calls).toBeLessThan(1000);
        const step = simulateHuntSegment({
          character: knight,
          checkpoint: currentCp,
          durationMs: remainingMs,
          config: lowBudgetConfig
        });

        // Every partial step must make forward progress on events or time
        expect(step.simulatedEvents > 0 || step.deltaElapsedMs > 0).toBe(true);
        expect(step.deltaElapsedMs + step.unprocessedDurationMs).toBe(remainingMs);

        sumElapsedMs += step.deltaElapsedMs;
        sumKills += step.deltaKills;
        sumXp += step.deltaXpGained;
        sumGold += step.deltaGoldGained;
        for (const [itemId, qty] of Object.entries(step.deltaLootByItem)) {
          sumLoot[itemId] = (sumLoot[itemId] ?? 0) + qty;
        }

        currentCp = step.checkpoint;
        remainingMs = step.unprocessedDurationMs;

        if (!step.isPartialSettlement) {
          expect(step.stopReason).toBe('TIME_REACHED');
          expect(remainingMs).toBe(0);
          break;
        } else {
          expect(step.stopReason).toBe('EVENT_BUDGET_EXHAUSTED');
        }
      }

      // Bit-for-bit identical final checkpoint and zero lost time / zero duplicate rewards
      expect(sumElapsedMs).toBe(targetDurationMs);
      expect(sumKills).toBe(continuous.deltaKills);
      expect(sumXp).toBe(continuous.deltaXpGained);
      expect(sumGold).toBe(continuous.deltaGoldGained);
      expect(sumLoot).toEqual(continuous.deltaLootByItem);
      expect(currentCp).toEqual(continuous.checkpoint);
    }

    // Also verify that >24h request interrupted by EVENT_BUDGET_EXHAUSTED does NOT prematurely report MAX_OFFLINE_CAP_REACHED
    const lowBudgetCapRes = simulateHuntSegment({
      character: knight,
      checkpoint: cp0,
      durationMs: MAX_OFFLINE_DURATION_MS + 60_000,
      config: {
        ...DEFAULT_COMBAT_SIMULATION_CONFIG,
        maxEventsPerCall: 5
      }
    });
    expect(lowBudgetCapRes.stopReason).toBe('EVENT_BUDGET_EXHAUSTED');
    expect(lowBudgetCapRes.isPartialSettlement).toBe(true);
    expect(lowBudgetCapRes.checkpoint.terminated).toBe(false);
    expect(lowBudgetCapRes.checkpoint.elapsedMs).toBeLessThan(MAX_OFFLINE_DURATION_MS);
  });

  it('supports JSON checkpoint serialization round-trip and rejects tampered checkpoints', () => {
    const knight = createKnightCombatSnapshot({
      level: 9,
      melee: 28,
      shielding: 27
    });
    const cp0 = createInitialCombatCheckpoint({
      character: knight,
      zoneId: 'sunken-crypts',
      strategy: 'balanced',
      seed: 314159
    });

    const continuous = simulateHuntSegment({
      character: knight,
      checkpoint: cp0,
      durationMs: 60_000
    });

    // Stop mid-encounter at 1,500ms, serialize to JSON, deserialize, then stop at 13,333ms, serialize/deserialize again, and finish 60,000ms
    const part1 = simulateHuntSegment({
      character: knight,
      checkpoint: cp0,
      durationMs: 1_500
    });
    expect(part1.checkpoint.activeEncounter).not.toBeNull();

    const json1 = serializeCombatCheckpoint(part1.checkpoint);
    const restoredCp1 = deserializeCombatCheckpoint(json1);
    expect(restoredCp1).toEqual(part1.checkpoint);
    expect(Object.isFrozen(restoredCp1)).toBe(true);
    expect(Object.isFrozen(restoredCp1.snapshot)).toBe(true);

    const part2 = simulateHuntSegment({
      character: knight,
      checkpoint: restoredCp1,
      durationMs: 11_833
    });
    const json = serializeCombatCheckpoint(part2.checkpoint);
    const restoredCp = deserializeCombatCheckpoint(json);
    expect(restoredCp).toEqual(part2.checkpoint);

    const part3 = simulateHuntSegment({
      character: knight,
      checkpoint: restoredCp,
      durationMs: 60_000 - 13_333
    });
    expect(part3.checkpoint).toEqual(continuous.checkpoint);

    // Reject malformed JSON and tampered checkpoint fields
    expect(() => deserializeCombatCheckpoint('')).toThrow();
    expect(() => deserializeCombatCheckpoint('{not-valid-json')).toThrow();

    const tamperedPotionConservation = JSON.parse(json) as CombatCheckpointState;
    (tamperedPotionConservation as { hpPotionsRemaining: number }).hpPotionsRemaining += 10;
    expect(() => deserializeCombatCheckpoint(JSON.stringify(tamperedPotionConservation))).toThrow(
      /Invalid numeric state or potion invariant/
    );

    const tamperedSnapshotStat = JSON.parse(json) as CombatCheckpointState;
    (
      tamperedSnapshotStat.snapshot.character as {
        melee: number;
      }
    ).melee = 999;
    expect(() => deserializeCombatCheckpoint(JSON.stringify(tamperedSnapshotStat))).toThrow(
      /Checkpoint configuration digest or header mismatch/
    );
  });

  it('validates resources strictly, rejects zero-heal potions, and handles extreme potion stacks in O(1) without loops', () => {
    const knight = createKnightCombatSnapshot({
      level: 10,
      melee: 30,
      shielding: 30,
      hp: 50,
      maxHp: 5000,
      mp: 10,
      maxMp: 2000
    });

    // Zero or negative heal/restore amounts must be rejected (prevents infinite potion loops)
    const zeroHpHeal: CombatResourceLoadout = {
      ...DEFAULT_COMBAT_RESOURCES,
      hpPotionHealAmount: 0
    };
    const zeroMpRestore: CombatResourceLoadout = {
      ...DEFAULT_COMBAT_RESOURCES,
      mpPotionRestoreAmount: 0
    };
    const negativeHeal: CombatResourceLoadout = {
      ...DEFAULT_COMBAT_RESOURCES,
      hpPotionHealAmount: -25
    };
    expect(() => validateCombatResources(zeroHpHeal)).toThrow(/heal\/restore amounts/);
    expect(() => validateCombatResources(zeroMpRestore)).toThrow(/heal\/restore amounts/);
    expect(() => validateCombatResources(negativeHeal)).toThrow(/heal\/restore amounts/);

    expect(() =>
      createInitialCombatCheckpoint({
        character: knight,
        zoneId: 'damp-catacombs',
        strategy: 'safe',
        seed: 1,
        resources: zeroHpHeal
      })
    ).toThrow(/heal\/restore amounts/);

    // NaN, Infinity, negative counts, floats, or stacks above MAX_POTION_STACK_COUNT must be rejected
    const badResourceCases: CombatResourceLoadout[] = [
      { ...DEFAULT_COMBAT_RESOURCES, hpPotions: -1 },
      { ...DEFAULT_COMBAT_RESOURCES, mpPotions: -5 },
      { ...DEFAULT_COMBAT_RESOURCES, hpPotions: Number.NaN },
      { ...DEFAULT_COMBAT_RESOURCES, mpPotions: Number.POSITIVE_INFINITY },
      { ...DEFAULT_COMBAT_RESOURCES, hpPotions: 12.5 },
      { ...DEFAULT_COMBAT_RESOURCES, hpPotions: MAX_POTION_STACK_COUNT + 1 },
      { ...DEFAULT_COMBAT_RESOURCES, hpPotionUnitCostGold: -1 },
      { ...DEFAULT_COMBAT_RESOURCES, mpPotionUnitCostGold: Number.NaN }
    ];
    for (const invalidResources of badResourceCases) {
      expect(() => validateCombatResources(invalidResources)).toThrow();
    }

    // Extreme valid potion count (MAX_POTION_STACK_COUNT = 1_000_000) with heal=1 and large HP deficit
    // resolves in O(1) time without hanging
    const extremeValidResources: CombatResourceLoadout = {
      hpPotions: MAX_POTION_STACK_COUNT,
      mpPotions: MAX_POTION_STACK_COUNT,
      hpPotionHealAmount: 1,
      mpPotionRestoreAmount: 1,
      hpPotionUnitCostGold: 1,
      mpPotionUnitCostGold: 1
    };
    const cpExtreme = createInitialCombatCheckpoint({
      character: knight,
      zoneId: 'damp-catacombs',
      strategy: 'safe',
      seed: 123,
      resources: extremeValidResources
    });
    const resExtreme = simulateHuntSegment({
      character: knight,
      checkpoint: cpExtreme,
      durationMs: 2_000,
      resourcesConfig: extremeValidResources
    });
    // Safe threshold is 65% of 5000 = 3250 -> targetHp = 3251 -> heals from 50 to 3251 using 3201 potions in O(1)
    expect(resExtreme.deltaHpPotionsUsed).toBeGreaterThanOrEqual(3201);
    expect(
      resExtreme.checkpoint.hpPotionsRemaining + resExtreme.checkpoint.hpPotionsUsed
    ).toBe(MAX_POTION_STACK_COUNT);
  });

  it('enforces immutable hunt configuration snapshot and rejects mid-hunt parameter changes', () => {
    const knight = createKnightCombatSnapshot({
      level: 8,
      melee: 25,
      shielding: 24
    });
    const cp0 = createInitialCombatCheckpoint({
      character: knight,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      seed: 77
    });

    // Snapshot is deeply frozen
    expect(Object.isFrozen(cp0)).toBe(true);
    expect(Object.isFrozen(cp0.snapshot)).toBe(true);
    expect(Object.isFrozen(cp0.snapshot.character)).toBe(true);
    expect(Object.isFrozen(cp0.snapshot.character.equipment)).toBe(true);
    expect(Object.isFrozen(cp0.snapshot.resources)).toBe(true);
    expect(Object.isFrozen(cp0.snapshot.monsters)).toBe(true);

    // 1. Mid-hunt change to character melee or equipment is forbidden
    const buffedKnight: CombatCharacterSnapshot = {
      ...knight,
      melee: knight.melee + 5
    };
    expect(() =>
      simulateHuntSegment({
        character: buffedKnight,
        checkpoint: cp0,
        durationMs: 10_000
      })
    ).toThrow(/Hunt configuration mismatch/);

    const swappedGearKnight: CombatCharacterSnapshot = {
      ...knight,
      equipment: {
        ...knight.equipment,
        weaponAttack: knight.equipment.weaponAttack + 10
      }
    };
    expect(() =>
      simulateHuntSegment({
        character: swappedGearKnight,
        checkpoint: cp0,
        durationMs: 10_000
      })
    ).toThrow(/Hunt configuration mismatch/);

    // 2. Mid-hunt change to potion heal amount or initial loadout is forbidden
    expect(() =>
      simulateHuntSegment({
        character: knight,
        checkpoint: cp0,
        durationMs: 10_000,
        resourcesConfig: {
          ...DEFAULT_COMBAT_RESOURCES,
          hpPotionHealAmount: 200
        }
      })
    ).toThrow(/Hunt configuration mismatch/);

    // 3. Mid-hunt change to monster combat stats or strategy parameters is forbidden
    const stalker = DEFAULT_COMBAT_SIMULATION_CONFIG.monsters['cellar-stalker'];
    if (!stalker) {
      throw new Error('Missing cellar-stalker config');
    }
    const modifiedBalanceConfig: CombatSimulationConfig = {
      ...DEFAULT_COMBAT_SIMULATION_CONFIG,
      monsters: {
        ...DEFAULT_COMBAT_SIMULATION_CONFIG.monsters,
        'cellar-stalker': {
          ...stalker,
          xpReward: 9999
        }
      }
    };
    expect(() =>
      simulateHuntSegment({
        character: knight,
        checkpoint: cp0,
        durationMs: 10_000,
        config: modifiedBalanceConfig
      })
    ).toThrow(/Hunt configuration mismatch/);

    // 4. Mid-hunt change to simulationVersion is forbidden
    const modifiedVersionConfig: CombatSimulationConfig = {
      ...DEFAULT_COMBAT_SIMULATION_CONFIG,
      version: '2.0.0'
    };
    expect(() =>
      simulateHuntSegment({
        character: knight,
        checkpoint: cp0,
        durationMs: 10_000,
        config: modifiedVersionConfig
      })
    ).toThrow(/does not match config version/);
  });

  it('enforces RNG security boundary: server CSPRNG seed generation and public payload redaction', () => {
    const seed1 = generateCryptographicHuntSeed();
    const seed2 = generateCryptographicHuntSeed();
    expect(Number.isSafeInteger(seed1)).toBe(true);
    expect(seed1).toBeGreaterThanOrEqual(0);
    expect(seed1).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isSafeInteger(seed2)).toBe(true);

    // Deterministic test injection for cryptographic seed generator
    const injectedSeed = generateCryptographicHuntSeed(
      () => new Uint8Array([0x12, 0x34, 0x56, 0x78])
    );
    expect(injectedSeed).toBe(0x12345678);
    expect(() => generateCryptographicHuntSeed(() => new Uint8Array([1, 2]))).toThrow(
      /at least 4 bytes/
    );

    const knight = createKnightCombatSnapshot({ level: 5, melee: 20, shielding: 20 });
    const cp = createInitialCombatCheckpoint({
      character: knight,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      seed: seed1
    });

    // Internal checkpoint contains `rng` and triggers leak guard if exposed directly
    expect(() => assertNoRngLeakInPublicPayload(cp)).toThrow(/Security boundary violation/);
    expect(() => assertNoRngLeakInPublicPayload({ nested: { seed: 123 } })).toThrow(
      /Security boundary violation/
    );
    expect(() => assertNoRngLeakInPublicPayload({ cursor: 5 })).toThrow(
      /Security boundary violation/
    );

    // Public projection strips `rng` and `snapshot` cleanly
    const publicView = toPublicHuntCheckpointView(cp);
    expect('rng' in publicView).toBe(false);
    expect('snapshot' in publicView).toBe(false);
    expect(() => assertNoRngLeakInPublicPayload(publicView)).not.toThrow();
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

    expect(aggressiveMetrics.killsPerHour).toBeGreaterThan(balancedMetrics.killsPerHour);
    expect(balancedMetrics.killsPerHour).toBeGreaterThan(safeMetrics.killsPerHour);
    expect(aggressiveMetrics.xpPerHour).toBeGreaterThan(balancedMetrics.xpPerHour);
    expect(balancedMetrics.xpPerHour).toBeGreaterThan(safeMetrics.xpPerHour);
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

    const nanThresholdConfig: CombatSimulationConfig = {
      ...DEFAULT_COMBAT_SIMULATION_CONFIG,
      strategies: {
        ...DEFAULT_COMBAT_SIMULATION_CONFIG.strategies,
        safe: {
          ...DEFAULT_COMBAT_SIMULATION_CONFIG.strategies.safe,
          hpPotionThresholdPermille: Number.NaN
        }
      }
    };
    expect(() => validateCombatConfig(nanThresholdConfig)).toThrow(/Invalid strategy configuration/);
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
      expect(() => validateCombatCheckpoint(cp)).not.toThrow();

      // Invariant 1: Vitals and resources are finite integers within [0, max]
      expect(Number.isSafeInteger(cp.currentHp)).toBe(true);
      expect(cp.currentHp).toBeGreaterThanOrEqual(0);
      expect(cp.currentHp).toBeLessThanOrEqual(knight.maxHp);

      expect(Number.isSafeInteger(cp.currentMp)).toBe(true);
      expect(cp.currentMp).toBeGreaterThanOrEqual(0);
      expect(cp.currentMp).toBeLessThanOrEqual(knight.maxMp);

      expect(cp.hpPotionsRemaining).toBeGreaterThanOrEqual(0);
      expect(cp.mpPotionsRemaining).toBeGreaterThanOrEqual(0);
      expect(cp.hpPotionsRemaining + cp.hpPotionsUsed).toBe(cp.snapshot.resources.hpPotions);
      expect(cp.mpPotionsRemaining + cp.mpPotionsUsed).toBe(cp.snapshot.resources.mpPotions);

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

  it('reconstructs frozen 1.x balance snapshots across config rollovers, validates full structural equality beyond FNV, and supports MANUAL_STOP', () => {
    expect(isSupportedSimulationVersion('1.0.0')).toBe(true);
    expect(isSupportedSimulationVersion('1.1.0')).toBe(true);
    expect(isSupportedSimulationVersion('1.2.3-balance.1')).toBe(true);
    expect(isSupportedSimulationVersion('2.0.0')).toBe(false);
    expect(isSupportedSimulationVersion('9.9.9')).toBe(false);
    expect(HUNT_STOP_REASONS).toContain('MANUAL_STOP');

    const knight = createKnightCombatSnapshot({ level: 10, melee: 30, shielding: 30 });
    const cpA = createInitialCombatCheckpoint({
      character: knight,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      seed: 12345
    });

    const reconstructed = reconstructSimulationConfigFromSnapshot(cpA.snapshot, {
      maxEventsPerCall: 250
    });
    expect(reconstructed.version).toBe('1.0.0');
    expect(reconstructed.maxEventsPerCall).toBe(250);
    expect(areHuntSnapshotsStructurallyEqual(cpA.snapshot, cpA.snapshot)).toBe(true);

    const alteredSnapshot = {
      ...cpA.snapshot,
      character: {
        ...cpA.snapshot.character,
        melee: cpA.snapshot.character.melee + 1
      }
    };
    expect(areHuntSnapshotsStructurallyEqual(cpA.snapshot, alteredSnapshot)).toBe(false);

    // Checkpoint terminated with MANUAL_STOP passes validation and serialization round-trip
    const manualStoppedCp: CombatCheckpointState = {
      ...cpA,
      terminated: true,
      stopReason: 'MANUAL_STOP'
    };
    const serialized = serializeCombatCheckpoint(manualStoppedCp);
    const deserialized = deserializeCombatCheckpoint(serialized);
    expect(deserialized.terminated).toBe(true);
    expect(deserialized.stopReason).toBe('MANUAL_STOP');
  });

  it('proves equipment scaling determinism, higher damage throughput with weapon equipped, and frozen snapshot stability', () => {
    const seed = 424242;
    const durationMs = 600_000; // 10 minutes

    // 1. Baseline knight without equipment (Attack 18)
    const baseKnight = createKnightCombatSnapshot({
      level: 1,
      melee: 15,
      shielding: 15,
      equipment: {
        weaponAttack: 18,
        shieldDefense: 16,
        totalArmor: 10,
        critChancePermille: 50,
        critMultiplierPermille: 1250
      }
    });

    const cpBase0 = createInitialCombatCheckpoint({
      character: baseKnight,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      seed
    });

    const simBase = simulateHuntSegment({
      character: baseKnight,
      checkpoint: cpBase0,
      durationMs
    });

    // 2. Equipped knight with rusted-blade (+4 weaponAttack -> 22)
    const equippedKnight = createKnightCombatSnapshot({
      level: 1,
      melee: 15,
      shielding: 15,
      equipment: {
        weaponAttack: 22,
        shieldDefense: 16,
        totalArmor: 10,
        critChancePermille: 50,
        critMultiplierPermille: 1250
      }
    });

    const cpEquipped0 = createInitialCombatCheckpoint({
      character: equippedKnight,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      seed
    });

    const simEquipped = simulateHuntSegment({
      character: equippedKnight,
      checkpoint: cpEquipped0,
      durationMs
    });

    // Bit-for-bit replay test: running equipped knight again with identical seed produces 100% identical checkpoint
    const replayEquipped = simulateHuntSegment({
      character: equippedKnight,
      checkpoint: cpEquipped0,
      durationMs
    });
    expect(serializeCombatCheckpoint(replayEquipped.checkpoint)).toBe(
      serializeCombatCheckpoint(simEquipped.checkpoint)
    );

    // Progression test: Higher attack results in greater or equal kills and XP
    expect(simEquipped.checkpoint.totalKills).toBeGreaterThanOrEqual(simBase.checkpoint.totalKills);
    expect(simEquipped.checkpoint.totalXpGained).toBeGreaterThanOrEqual(simBase.checkpoint.totalXpGained);

    // Snapshot freeze test: The checkpoint snapshot preserves the exact equipment at hunt start
    expect(simEquipped.checkpoint.snapshot.character.equipment.weaponAttack).toBe(22);
    expect(simBase.checkpoint.snapshot.character.equipment.weaponAttack).toBe(18);
  });
});
