import {
  applyMigrations,
  createCharacterTransactional,
  createDatabasePool,
  createUserAccount,
  loadMigrationsFromDir,
  reconcileCharacterEconomy,
  resolveTestDatabaseConfig,
  settleHunt,
  type SettlementFaultStage,
  startHunt,
  stopHunt
} from '@tibia-idle/database';
import {
  assertNoRngLeakInPublicPayload,
  type CombatCheckpointState,
  createFixedClock,
  DEFAULT_COMBAT_SIMULATION_CONFIG,
  MAX_OFFLINE_DURATION_MS,
  MAX_SAFE_ECONOMY_INT
} from '@tibia-idle/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

describe('IDLE-004B-1 — Persistent Offline Hunts, Settlement Atomicity, Concurrency & Crash Recovery (PostgreSQL)', () => {
  const dbConfig = resolveTestDatabaseConfig(process.env);
  const pool = createDatabasePool(dbConfig);

  beforeAll(async () => {
    await pool.query(
      'DROP TABLE IF EXISTS currency_ledger, hunt_reward_items, hunt_segments, hunts, characters, sessions, users, schema_migrations CASCADE'
    );
    const migrations = loadMigrationsFromDir();
    await applyMigrations(pool, migrations);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE currency_ledger, hunt_reward_items, hunt_segments, hunts, characters, sessions, users RESTART IDENTITY CASCADE'
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedUserAndKnight(params?: {
    email?: string;
    name?: string;
    vocation?: 'knight' | 'paladin' | 'sorcerer' | 'druid';
    level?: number;
    hp?: number;
    maxHp?: number;
    melee?: number;
    shielding?: number;
    hpPotions?: number;
    mpPotions?: number;
    nowIso?: string;
  }) {
    const nowIso = params?.nowIso ?? '2026-10-31T08:00:00.000Z';
    const userRes = await createUserAccount(pool, {
      email: params?.email ?? 'knight@example.com',
      passwordHash: 'argon2id-hash',
      locale: 'pl',
      nowIso
    });
    if (!userRes.ok) {
      throw new Error('Failed to create test user');
    }
    const charRes = await createCharacterTransactional(pool, {
      userId: userRes.user.id,
      name: params?.name ?? 'Sir Roland',
      vocation: params?.vocation ?? 'knight',
      nowIso
    });
    if (!charRes.ok) {
      throw new Error(`Failed to create test character: ${charRes.reason}`);
    }

    if (
      params?.level !== undefined ||
      params?.hp !== undefined ||
      params?.maxHp !== undefined ||
      params?.melee !== undefined ||
      params?.shielding !== undefined ||
      params?.hpPotions !== undefined ||
      params?.mpPotions !== undefined
    ) {
      await pool.query(
        `UPDATE characters
         SET level = COALESCE($2, level),
             hp = COALESCE($3, hp),
             max_hp = COALESCE($4, max_hp),
             skill_melee = COALESCE($5, skill_melee),
             skill_shielding = COALESCE($6, skill_shielding),
             hp_potions = COALESCE($7, hp_potions),
             mp_potions = COALESCE($8, mp_potions)
         WHERE id = $1`,
        [
          charRes.character.id,
          params.level ?? null,
          params.hp ?? null,
          params.maxHp ?? null,
          params.melee ?? null,
          params.shielding ?? null,
          params.hpPotions ?? null,
          params.mpPotions ?? null
        ]
      );
    }

    return {
      user: userRes.user,
      characterId: charRes.character.id
    };
  }

  it('starts a hunt transactionally, reserves real potions, enforces idempotency, and blocks a second concurrent active hunt', async () => {
    const clock = createFixedClock(Date.parse('2026-10-31T08:00:00.000Z'));
    const { user, characterId } = await seedUserAndKnight({ nowIso: clock.nowIso() });

    const start1 = await startHunt(pool, {
      characterId,
      userId: user.id,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      idempotencyKey: 'start-key-001',
      requestedHpPotions: 100,
      requestedMpPotions: 50,
      clock
    });

    expect(start1.ok).toBe(true);
    if (!start1.ok) return;

    expect(start1.idempotentReplay).toBe(false);
    expect(start1.hunt.status).toBe('ACTIVE');
    expect(start1.hunt.reservedHpPotions).toBe(100);
    expect(start1.hunt.reservedMpPotions).toBe(50);
    expect(start1.character.hpPotions).toBe(150); // 250 starter - 100 reserved
    expect(start1.character.mpPotions).toBe(100); // 150 starter - 50 reserved
    expect(() => assertNoRngLeakInPublicPayload(start1.hunt)).not.toThrow();

    // Idempotent retry with identical key returns the same hunt without deducting potions again
    const startReplay = await startHunt(pool, {
      characterId,
      userId: user.id,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      idempotencyKey: 'start-key-001',
      requestedHpPotions: 100,
      requestedMpPotions: 50,
      clock
    });
    expect(startReplay.ok).toBe(true);
    if (!startReplay.ok) return;
    expect(startReplay.idempotentReplay).toBe(true);
    expect(startReplay.hunt.huntId).toBe(start1.hunt.huntId);
    expect(startReplay.character.hpPotions).toBe(150);

    // Same idempotency key with different strategy/zone is rejected
    const startConflict = await startHunt(pool, {
      characterId,
      userId: user.id,
      zoneId: 'damp-catacombs',
      strategy: 'aggressive',
      idempotencyKey: 'start-key-001',
      clock
    });
    expect(startConflict).toEqual({ ok: false, reason: 'IDEMPOTENCY_KEY_CONFLICT' });

    // Second active hunt with a new key is rejected while the first hunt is ACTIVE
    const secondHunt = await startHunt(pool, {
      characterId,
      userId: user.id,
      zoneId: 'damp-catacombs',
      strategy: 'safe',
      idempotencyKey: 'start-key-002',
      clock
    });
    expect(secondHunt).toEqual({ ok: false, reason: 'ACTIVE_HUNT_ALREADY_EXISTS' });

    // Race test: two simultaneous startHunt requests on a fresh character
    const { user: user2, characterId: char2 } = await seedUserAndKnight({
      email: 'race-knight@example.com',
      name: 'Sir Tristan',
      nowIso: clock.nowIso()
    });
    const [raceA, raceB] = await Promise.all([
      startHunt(pool, {
        characterId: char2,
        userId: user2.id,
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        idempotencyKey: 'race-start-a',
        requestedHpPotions: 80,
        requestedMpPotions: 40,
        clock
      }),
      startHunt(pool, {
        characterId: char2,
        userId: user2.id,
        zoneId: 'damp-catacombs',
        strategy: 'safe',
        idempotencyKey: 'race-start-b',
        requestedHpPotions: 80,
        requestedMpPotions: 40,
        clock
      })
    ]);

    const successes = [raceA, raceB].filter((r) => r.ok);
    const failures = [raceA, raceB].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({ ok: false, reason: 'ACTIVE_HUNT_ALREADY_EXISTS' });

    const activeCount = await pool.query<{ cnt: string }>(
      "SELECT COUNT(*)::text AS cnt FROM hunts WHERE character_id = $1 AND status = 'ACTIVE'",
      [char2]
    );
    expect(activeCount.rows[0]?.cnt).toBe('1');
  });

  it('settles hunts accurately after 0s, 1s, 1h, and enforces the 24h cap with full XP/level, gold ledger, and loot inbox reconciliation', async () => {
    const clock = createFixedClock(Date.parse('2026-10-31T08:00:00.000Z'));
    const { characterId } = await seedUserAndKnight({
      level: 10,
      hp: 320,
      maxHp: 320,
      melee: 35,
      shielding: 34,
      hpPotions: 5000,
      mpPotions: 5000,
      nowIso: clock.nowIso()
    });

    const startRes = await startHunt(pool, {
      characterId,
      zoneId: 'damp-catacombs',
      strategy: 'safe',
      idempotencyKey: 'hunt-0-1-1h-24h',
      requestedHpPotions: 5000,
      requestedMpPotions: 5000,
      seedSource: () => 20261031,
      clock
    });
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    const huntId = startRes.hunt.huntId;

    // 1. Settle after 0 seconds
    const settle0s = await settleHunt(pool, {
      huntId,
      segmentKey: 'seg-0s',
      clock
    });
    expect(settle0s.ok).toBe(true);
    if (!settle0s.ok) return;
    expect(settle0s.rewards.deltaElapsedMs).toBe(0);
    expect(settle0s.rewards.deltaKills).toBe(0);
    expect(settle0s.rewards.deltaXpGained).toBe(0);
    expect(settle0s.rewards.deltaGoldGained).toBe(0);
    expect(Object.keys(settle0s.rewards.deltaLootByItem)).toHaveLength(0);

    // 2. Settle after 1 second (1000ms)
    clock.advanceMs(1_000);
    const settle1s = await settleHunt(pool, {
      huntId,
      segmentKey: 'seg-1s',
      clock
    });
    expect(settle1s.ok).toBe(true);
    if (!settle1s.ok) return;
    expect(settle1s.rewards.deltaElapsedMs).toBe(1_000);
    expect(settle1s.rewards.deltaKills).toBe(0);
    expect(settle1s.hunt.checkpointView.activeEncounter).not.toBeNull();
    expect(settle1s.hunt.checkpointView.activeEncounter?.nextPlayerAttackInMs).toBe(1_000);

    // 3. Settle remaining 59m 59s to reach 1 hour (3,600,000ms)
    clock.advanceMs(3_599_000);
    const settle1h = await settleHunt(pool, {
      huntId,
      segmentKey: 'seg-1h',
      clock
    });
    expect(settle1h.ok).toBe(true);
    if (!settle1h.ok) return;
    expect(settle1h.rewards.deltaElapsedMs).toBe(3_599_000);
    expect(settle1h.hunt.checkpointView.elapsedMs).toBe(3_600_000);
    expect(settle1h.rewards.deltaKills).toBeGreaterThan(200);
    expect(settle1h.rewards.deltaXpGained).toBeGreaterThan(5_000);
    expect(settle1h.rewards.deltaGoldGained).toBeGreaterThan(500);
    expect(Object.keys(settle1h.rewards.deltaLootByItem).length).toBeGreaterThan(0);

    // Verify level progression keeps hunt combat snapshot immutable while updating character level
    expect(settle1h.character.stats.xp).toBe(settle1h.rewards.deltaXpGained);
    const recAfter1h = await reconcileCharacterEconomy(pool, characterId);
    expect(recAfter1h.isGoldReconciled).toBe(true);
    expect(recAfter1h.isLootReconciled).toBe(true);
    expect(recAfter1h.isXpLevelReconciled).toBe(true);

    // 4. Advance clock by 25 more hours (total 26h > 24h cap) -> must cap at 24h (86,400,000ms) and complete hunt
    clock.advanceMs(25 * 3_600_000);
    const settleCap = await settleHunt(pool, {
      huntId,
      segmentKey: 'seg-24h-cap',
      clock
    });
    expect(settleCap.ok).toBe(true);
    if (!settleCap.ok) return;
    expect(settleCap.hunt.status).toBe('COMPLETED');
    expect(settleCap.hunt.stopReason).toBe('MAX_OFFLINE_CAP_REACHED');
    expect(settleCap.hunt.checkpointView.elapsedMs).toBe(MAX_OFFLINE_DURATION_MS);
    expect(settleCap.rewards.deltaElapsedMs).toBe(MAX_OFFLINE_DURATION_MS - 3_600_000);
    expect(settleCap.hunt.potionsReturned).toBe(true);

    // Subsequent settle call on a completed hunt returns ALREADY_COMPLETED with 0 rewards
    clock.advanceMs(3_600_000);
    const settleAfterCap = await settleHunt(pool, {
      huntId,
      segmentKey: 'seg-after-cap',
      clock
    });
    expect(settleAfterCap.ok).toBe(true);
    if (!settleAfterCap.ok) return;
    expect(settleAfterCap.status).toBe('ALREADY_COMPLETED');
    expect(settleAfterCap.rewards.deltaElapsedMs).toBe(0);
    expect(settleAfterCap.rewards.deltaXpGained).toBe(0);
    expect(settleAfterCap.rewards.deltaGoldGained).toBe(0);

    const finalRec = await reconcileCharacterEconomy(pool, characterId);
    expect(finalRec.isGoldReconciled).toBe(true);
    expect(finalRec.isLootReconciled).toBe(true);
    expect(finalRec.isXpLevelReconciled).toBe(true);
  });

  it('persists partial settlements on EVENT_BUDGET_EXHAUSTED, advances settled_until only by processed time, and resumes to exact equivalence', async () => {
    const startEpoch = Date.parse('2026-10-31T10:00:00.000Z');
    const clockPartial = createFixedClock(startEpoch);
    const clockContinuous = createFixedClock(startEpoch);

    const { characterId: charPartial } = await seedUserAndKnight({
      email: 'partial@example.com',
      name: 'Partial Knight',
      level: 10,
      melee: 32,
      shielding: 30,
      nowIso: clockPartial.nowIso()
    });
    const { characterId: charContinuous } = await seedUserAndKnight({
      email: 'continuous@example.com',
      name: 'Continuous Knight',
      level: 10,
      melee: 32,
      shielding: 30,
      nowIso: clockContinuous.nowIso()
    });

    const startP = await startHunt(pool, {
      characterId: charPartial,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      idempotencyKey: 'partial-hunt',
      seedSource: () => 777888,
      clock: clockPartial
    });
    const startC = await startHunt(pool, {
      characterId: charContinuous,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      idempotencyKey: 'continuous-hunt',
      seedSource: () => 777888,
      clock: clockContinuous
    });
    expect(startP.ok && startC.ok).toBe(true);
    if (!startP.ok || !startC.ok) return;

    // Advance both clocks by 5 minutes (300,000 ms)
    const windowMs = 300_000;
    clockPartial.advanceMs(windowMs);
    clockContinuous.advanceMs(windowMs);

    const lowBudgetConfig = {
      ...DEFAULT_COMBAT_SIMULATION_CONFIG,
      maxEventsPerCall: 40
    };

    // First settle on charPartial must be PARTIAL_SETTLED and must NOT move settled_until to now
    const step1 = await settleHunt(pool, {
      huntId: startP.hunt.huntId,
      segmentKey: 'partial-seg-1',
      clock: clockPartial,
      config: lowBudgetConfig
    });
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    expect(step1.status).toBe('PARTIAL_SETTLED');
    expect(step1.rewards.isPartialSettlement).toBe(true);
    expect(step1.rewards.deltaElapsedMs).toBeGreaterThan(0);
    expect(step1.rewards.deltaElapsedMs).toBeLessThan(windowMs);
    expect(Date.parse(step1.hunt.settledUntilIso)).toBe(
      startEpoch + step1.rewards.deltaElapsedMs
    );

    // Resume remaining segments until fully settled
    let segIndex = 2;
    let lastStep = step1;
    while (lastStep.status === 'PARTIAL_SETTLED') {
      const nextStep = await settleHunt(pool, {
        huntId: startP.hunt.huntId,
        segmentKey: `partial-seg-${segIndex}`,
        clock: clockPartial,
        config: lowBudgetConfig
      });
      expect(nextStep.ok).toBe(true);
      if (!nextStep.ok) return;
      lastStep = nextStep;
      segIndex += 1;
    }

    expect(lastStep.status).toBe('SETTLED');
    expect(Date.parse(lastStep.hunt.settledUntilIso)).toBe(startEpoch + windowMs);

    // Settle charContinuous in a single pass
    const continuousRes = await settleHunt(pool, {
      huntId: startC.hunt.huntId,
      segmentKey: 'continuous-seg-1',
      clock: clockContinuous
    });
    expect(continuousRes.ok).toBe(true);
    if (!continuousRes.ok) return;

    // Compare final states and economy reconciliation between partial-resumed and continuous
    // (configDigest differs only because characterId UUID differs between the two characters)
    expect({
      ...lastStep.hunt.checkpointView,
      configDigest: 'normalized'
    }).toEqual({
      ...continuousRes.hunt.checkpointView,
      configDigest: 'normalized'
    });
    expect(lastStep.character.stats).toEqual(continuousRes.character.stats);

    const recP = await reconcileCharacterEconomy(pool, charPartial);
    const recC = await reconcileCharacterEconomy(pool, charContinuous);
    expect(recP.isGoldReconciled).toBe(true);
    expect(recP.isLootReconciled).toBe(true);
    expect(recP.isXpLevelReconciled).toBe(true);
    expect(recP.characterGold).toBe(recC.characterGold);
    expect(recP.characterXp).toBe(recC.characterXp);
    expect(recP.totalUnclaimedItemsByCode).toEqual(recC.totalUnclaimedItemsByCode);
  });

  it('guarantees zero double rewards under idempotent retries, parallel settlements, and stop vs settle races', async () => {
    const clock = createFixedClock(Date.parse('2026-10-31T12:00:00.000Z'));
    const { characterId } = await seedUserAndKnight({
      level: 8,
      melee: 28,
      shielding: 28,
      nowIso: clock.nowIso()
    });

    const startRes = await startHunt(pool, {
      characterId,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      idempotencyKey: 'race-settle-hunt',
      seedSource: () => 424242,
      clock
    });
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    const huntId = startRes.hunt.huntId;

    clock.advanceMs(30 * 60 * 1000); // 30 minutes

    // 1. Five concurrent settlements with the SAME segmentKey AND five with DISTINCT segmentKeys
    const [same1, same2, diff1, diff2, diff3] = await Promise.all([
      settleHunt(pool, { huntId, segmentKey: 'same-key', clock }),
      settleHunt(pool, { huntId, segmentKey: 'same-key', clock }),
      settleHunt(pool, { huntId, segmentKey: 'diff-key-1', clock }),
      settleHunt(pool, { huntId, segmentKey: 'diff-key-2', clock }),
      settleHunt(pool, { huntId, segmentKey: 'diff-key-3', clock })
    ]);

    expect(same1.ok && same2.ok && diff1.ok && diff2.ok && diff3.ok).toBe(true);

    // Repeating same-key again returns idempotentReplay: true and 0 extra rewards
    const retrySame = await settleHunt(pool, { huntId, segmentKey: 'same-key', clock });
    expect(retrySame.ok).toBe(true);
    if (!retrySame.ok) return;
    expect(retrySame.idempotentReplay).toBe(true);

    const recAfterConcurrent = await reconcileCharacterEconomy(pool, characterId);
    expect(recAfterConcurrent.isGoldReconciled).toBe(true);
    expect(recAfterConcurrent.isLootReconciled).toBe(true);
    expect(recAfterConcurrent.isXpLevelReconciled).toBe(true);

    // 2. Concurrent race between stopHunt and settleHunt after another 15 minutes
    clock.advanceMs(15 * 60 * 1000);
    const [stopRes, concurrentSettleRes] = await Promise.all([
      stopHunt(pool, {
        huntId,
        stopIdempotencyKey: 'stop-race-key',
        settleBeforeStop: true,
        clock
      }),
      settleHunt(pool, {
        huntId,
        segmentKey: 'concurrent-with-stop',
        clock
      })
    ]);

    expect(stopRes.ok).toBe(true);
    expect(concurrentSettleRes.ok).toBe(true);
    if (!stopRes.ok) return;

    expect(stopRes.hunt.status).toBe('COMPLETED');
    expect(stopRes.hunt.potionsReturned).toBe(true);

    // Verify potion conservation: character remaining + used in hunt === initial 250 HP / 150 MP
    const charAfterStop = await pool.query<{ hp_potions: number; mp_potions: number }>(
      'SELECT hp_potions, mp_potions FROM characters WHERE id = $1',
      [characterId]
    );
    expect(
      (charAfterStop.rows[0]?.hp_potions ?? 0) + stopRes.hunt.checkpointView.hpPotionsUsed
    ).toBe(250);
    expect(
      (charAfterStop.rows[0]?.mp_potions ?? 0) + stopRes.hunt.checkpointView.mpPotionsUsed
    ).toBe(150);

    // Calling stopHunt a second time is idempotent and does NOT return potions twice
    const stopReplay = await stopHunt(pool, {
      huntId,
      stopIdempotencyKey: 'stop-race-key-2',
      clock
    });
    expect(stopReplay.ok).toBe(true);
    if (!stopReplay.ok) return;
    expect(stopReplay.alreadyCompleted).toBe(true);
    expect(stopReplay.unusedHpPotionsReturned).toBe(0);
    expect(stopReplay.character.hpPotions).toBe(charAfterStop.rows[0]?.hp_potions);

    const recFinal = await reconcileCharacterEconomy(pool, characterId);
    expect(recFinal.isGoldReconciled).toBe(true);
    expect(recFinal.isLootReconciled).toBe(true);
    expect(recFinal.isXpLevelReconciled).toBe(true);
  });

  it('survives all 4 fault-injection crash points (before & after COMMIT) with atomic rollback or idempotent recovery', async () => {
    const clock = createFixedClock(Date.parse('2026-10-31T14:00:00.000Z'));
    const { characterId } = await seedUserAndKnight({
      level: 10,
      melee: 34,
      shielding: 32,
      nowIso: clock.nowIso()
    });

    const startRes = await startHunt(pool, {
      characterId,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      idempotencyKey: 'fault-injection-hunt',
      seedSource: () => 999111,
      clock
    });
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    const huntId = startRes.hunt.huntId;

    clock.advanceMs(20 * 60 * 1000); // 20 minutes (guarantees kills, XP, gold, and item drops)

    const preCommitFaultStages: SettlementFaultStage[] = [
      'AFTER_CHECKPOINT_UPDATE_BEFORE_COMMIT',
      'AFTER_GOLD_LEDGER_BEFORE_COMMIT',
      'AFTER_REWARD_ITEMS_BEFORE_COMMIT'
    ];

    for (const stage of preCommitFaultStages) {
      await expect(
        settleHunt(pool, {
          huntId,
          segmentKey: 'fault-seg-20m',
          clock,
          faultInjection: { failAtStage: stage }
        })
      ).rejects.toThrow(`FAULT_INJECTION: ${stage}`);

      // Verify 100% transaction rollback: no segment row, no reward items, gold still 100, xp still 0, row_version still 1
      const segCount = await pool.query<{ cnt: string }>(
        'SELECT COUNT(*)::text AS cnt FROM hunt_segments WHERE hunt_id = $1',
        [huntId]
      );
      const itemCount = await pool.query<{ cnt: string }>(
        'SELECT COUNT(*)::text AS cnt FROM hunt_reward_items WHERE hunt_id = $1',
        [huntId]
      );
      const huntState = await pool.query<{ row_version: number }>(
        'SELECT row_version FROM hunts WHERE id = $1',
        [huntId]
      );
      const charState = await pool.query<{ xp: string; gold: string }>(
        'SELECT xp::text, gold::text FROM characters WHERE id = $1',
        [characterId]
      );

      expect(segCount.rows[0]?.cnt).toBe('0');
      expect(itemCount.rows[0]?.cnt).toBe('0');
      expect(huntState.rows[0]?.row_version).toBe(1);
      expect(charState.rows[0]).toEqual({ xp: '0', gold: '100' });
    }

    // Now test crash AFTER_COMMIT_BEFORE_RESPONSE: DB commits, then process throws before returning
    await expect(
      settleHunt(pool, {
        huntId,
        segmentKey: 'fault-seg-20m',
        clock,
        faultInjection: { failAtStage: 'AFTER_COMMIT_BEFORE_RESPONSE' }
      })
    ).rejects.toThrow('FAULT_INJECTION: AFTER_COMMIT_BEFORE_RESPONSE');

    // Retry with the same segmentKey after recovery -> returns committed result idempotently without double rewards
    const recoveredRes = await settleHunt(pool, {
      huntId,
      segmentKey: 'fault-seg-20m',
      clock
    });
    expect(recoveredRes.ok).toBe(true);
    if (!recoveredRes.ok) return;
    expect(recoveredRes.idempotentReplay).toBe(true);
    expect(recoveredRes.rewards.deltaKills).toBeGreaterThan(20);
    expect(recoveredRes.rewards.deltaXpGained).toBeGreaterThan(500);
    expect(recoveredRes.rewards.deltaGoldGained).toBeGreaterThan(50);

    const rec = await reconcileCharacterEconomy(pool, characterId);
    expect(rec.isGoldReconciled).toBe(true);
    expect(rec.isLootReconciled).toBe(true);
    expect(rec.isXpLevelReconciled).toBe(true);
  });

  it('handles character death (HP = 0 in combat checkpoint, full revival at camp for characters.hp > 0) and potion exhaustion without free potion refills', async () => {
    const clock = createFixedClock(Date.parse('2026-10-31T16:00:00.000Z'));
    const { characterId } = await seedUserAndKnight({
      level: 20,
      hp: 80,
      maxHp: 455,
      melee: 12,
      shielding: 12,
      hpPotions: 1,
      mpPotions: 0,
      nowIso: clock.nowIso()
    });

    // 1. Start hunt in high-danger ashwind-ridge with 0 requested potions -> Knight dies
    const deathHuntStart = await startHunt(pool, {
      characterId,
      zoneId: 'ashwind-ridge',
      strategy: 'aggressive',
      idempotencyKey: 'death-hunt',
      requestedHpPotions: 0,
      requestedMpPotions: 0,
      seedSource: () => 777,
      clock
    });
    expect(deathHuntStart.ok).toBe(true);
    if (!deathHuntStart.ok) return;

    clock.advanceMs(10 * 60 * 1000);
    const deathSettle = await settleHunt(pool, {
      huntId: deathHuntStart.hunt.huntId,
      segmentKey: 'death-settle-1',
      clock
    });
    expect(deathSettle.ok).toBe(true);
    if (!deathSettle.ok) return;

    expect(deathSettle.hunt.status).toBe('COMPLETED');
    expect(deathSettle.hunt.stopReason).toBe('CHARACTER_DIED');
    expect(deathSettle.hunt.checkpointView.currentHp).toBe(0);
    expect(deathSettle.rewards.combatEndHp).toBe(0);
    expect(deathSettle.rewards.revivedAtCamp).toBe(true);
    expect(deathSettle.character.stats.hp).toBe(deathSettle.character.stats.maxHp);
    expect(deathSettle.character.stats.hp).toBeGreaterThan(0);

    // 2. Start a second hunt using the remaining 1 HP potion in sunken-crypts (safe) -> retreats on OUT_OF_HP_POTIONS_CRITICAL
    const retreatHuntStart = await startHunt(pool, {
      characterId,
      zoneId: 'sunken-crypts',
      strategy: 'safe',
      idempotencyKey: 'retreat-hunt',
      requestedHpPotions: 1,
      requestedMpPotions: 0,
      seedSource: () => 555,
      clock
    });
    expect(retreatHuntStart.ok).toBe(true);
    if (!retreatHuntStart.ok) return;
    expect(retreatHuntStart.character.hpPotions).toBe(0);

    clock.advanceMs(60 * 60 * 1000);
    const retreatSettle = await settleHunt(pool, {
      huntId: retreatHuntStart.hunt.huntId,
      segmentKey: 'retreat-settle-1',
      clock
    });
    expect(retreatSettle.ok).toBe(true);
    if (!retreatSettle.ok) return;
    expect(retreatSettle.hunt.status).toBe('COMPLETED');
    expect(retreatSettle.hunt.stopReason).toBe('OUT_OF_HP_POTIONS_CRITICAL');
    expect(retreatSettle.character.hpPotions).toBe(0); // Potion was consumed, not regenerated for free

    // 3. Attempting to start a third hunt requesting 1 HP potion when character has 0 left fails with INSUFFICIENT_RESOURCES
    const noSupplyStart = await startHunt(pool, {
      characterId,
      zoneId: 'damp-catacombs',
      strategy: 'safe',
      idempotencyKey: 'no-supply-hunt',
      requestedHpPotions: 1,
      clock
    });
    expect(noSupplyStart).toEqual({ ok: false, reason: 'INSUFFICIENT_RESOURCES' });
  });

  it('rejects invalid inputs, unauthorized access, tampered configDigest/RNG checkpoints, and BIGINT economy overflow', async () => {
    const clock = createFixedClock(Date.parse('2026-10-31T18:00:00.000Z'));
    const { user, characterId } = await seedUserAndKnight({
      level: 5,
      nowIso: clock.nowIso()
    });
    const { user: otherUser, characterId: mageCharId } = await seedUserAndKnight({
      email: 'mage@example.com',
      name: 'Archmage Eldrin',
      vocation: 'sorcerer',
      nowIso: clock.nowIso()
    });

    // Validation & authorization checks on startHunt
    expect(
      await startHunt(pool, {
        characterId,
        userId: otherUser.id,
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        idempotencyKey: 'k1',
        clock
      })
    ).toEqual({ ok: false, reason: 'FORBIDDEN_CHARACTER' });

    expect(
      await startHunt(pool, {
        characterId: mageCharId,
        userId: otherUser.id,
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        idempotencyKey: 'k2',
        clock
      })
    ).toEqual({ ok: false, reason: 'UNSUPPORTED_VOCATION' });

    expect(
      await startHunt(pool, {
        characterId,
        userId: user.id,
        zoneId: 'ashwind-ridge', // requires level 20
        strategy: 'balanced',
        idempotencyKey: 'k3',
        clock
      })
    ).toEqual({ ok: false, reason: 'LEVEL_TOO_LOW' });

    expect(
      await startHunt(pool, {
        characterId,
        userId: user.id,
        zoneId: 'unknown-zone',
        strategy: 'balanced',
        idempotencyKey: 'k4',
        clock
      })
    ).toEqual({ ok: false, reason: 'UNKNOWN_ZONE' });

    expect(
      await startHunt(pool, {
        characterId,
        userId: user.id,
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        idempotencyKey: '   ',
        clock
      })
    ).toEqual({ ok: false, reason: 'INVALID_IDEMPOTENCY_KEY' });

    expect(
      await startHunt(pool, {
        characterId,
        userId: user.id,
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        idempotencyKey: 'k5',
        requestedHpPotions: -5,
        clock
      })
    ).toEqual({ ok: false, reason: 'INVALID_RESOURCE_REQUEST' });

    // Start valid hunt to test tamper & overflow guards on settleHunt
    const validStart = await startHunt(pool, {
      characterId,
      userId: user.id,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      idempotencyKey: 'valid-hunt',
      seedSource: () => 123456,
      clock
    });
    expect(validStart.ok).toBe(true);
    if (!validStart.ok) return;
    const huntId = validStart.hunt.huntId;

    clock.advanceMs(10 * 60 * 1000);

    // 1. Tamper with config_digest in DB -> rejected as CORRUPTED_CHECKPOINT
    const origHuntRow = await pool.query<{
      config_digest: string;
      private_checkpoint: CombatCheckpointState;
    }>('SELECT config_digest, private_checkpoint FROM hunts WHERE id = $1', [huntId]);
    const origDigest = origHuntRow.rows[0]?.config_digest ?? '';
    const origCheckpoint = origHuntRow.rows[0]?.private_checkpoint;

    await pool.query("UPDATE hunts SET config_digest = 'v1:0000000000000000' WHERE id = $1", [
      huntId
    ]);
    expect(await settleHunt(pool, { huntId, segmentKey: 'tamper-digest', clock })).toEqual({
      ok: false,
      reason: 'CORRUPTED_CHECKPOINT'
    });

    // Restore config_digest, tamper with RNG state inside private_checkpoint JSONB -> rejected as CORRUPTED_CHECKPOINT
    const tamperedRngCp = JSON.parse(JSON.stringify(origCheckpoint)) as {
      rng: { state: number };
    };
    tamperedRngCp.rng.state = -999;
    await pool.query(
      'UPDATE hunts SET config_digest = $2, private_checkpoint = $3::jsonb WHERE id = $1',
      [huntId, origDigest, JSON.stringify(tamperedRngCp)]
    );
    expect(await settleHunt(pool, { huntId, segmentKey: 'tamper-rng', clock })).toEqual({
      ok: false,
      reason: 'CORRUPTED_CHECKPOINT'
    });

    // Restore valid checkpoint
    await pool.query('UPDATE hunts SET private_checkpoint = $2::jsonb WHERE id = $1', [
      huntId,
      JSON.stringify(origCheckpoint)
    ]);

    // 2. Mismatched simulationVersion in config -> rejected as CONFIG_MISMATCH
    expect(
      await settleHunt(pool, {
        huntId,
        segmentKey: 'mismatch-ver',
        clock,
        config: {
          ...DEFAULT_COMBAT_SIMULATION_CONFIG,
          version: '9.9.9'
        }
      })
    ).toEqual({
      ok: false,
      reason: 'CONFIG_MISMATCH'
    });

    // 3. BIGINT / MAX_SAFE_ECONOMY_INT overflow guard
    await expect(
      pool.query('UPDATE characters SET gold = $2 WHERE id = $1', [
        characterId,
        '9007199254740992'
      ])
    ).rejects.toThrow(/chk_characters_safe_xp_gold/);

    await pool.query('UPDATE characters SET gold = $2 WHERE id = $1', [
      characterId,
      String(MAX_SAFE_ECONOMY_INT)
    ]);
    expect(await settleHunt(pool, { huntId, segmentKey: 'overflow-seg', clock })).toEqual({
      ok: false,
      reason: 'ECONOMY_OVERFLOW'
    });
  });

  it('supports parallel hunt lifecycles across multiple distinct characters without cross-character interference', async () => {
    const clock = createFixedClock(Date.parse('2026-10-31T20:00:00.000Z'));
    const [charA, charB] = await Promise.all([
      seedUserAndKnight({
        email: 'parallel-a@example.com',
        name: 'Knight Alpha',
        level: 10,
        melee: 30,
        shielding: 30,
        nowIso: clock.nowIso()
      }),
      seedUserAndKnight({
        email: 'parallel-b@example.com',
        name: 'Knight Beta',
        level: 12,
        melee: 36,
        shielding: 35,
        nowIso: clock.nowIso()
      })
    ]);

    const [startA, startB] = await Promise.all([
      startHunt(pool, {
        characterId: charA.characterId,
        zoneId: 'damp-catacombs',
        strategy: 'safe',
        idempotencyKey: 'alpha-start',
        seedSource: () => 111,
        clock
      }),
      startHunt(pool, {
        characterId: charB.characterId,
        zoneId: 'sunken-crypts',
        strategy: 'aggressive',
        idempotencyKey: 'beta-start',
        seedSource: () => 222,
        clock
      })
    ]);

    expect(startA.ok && startB.ok).toBe(true);
    if (!startA.ok || !startB.ok) return;

    clock.advanceMs(30 * 60 * 1000);

    const [settleA, settleB] = await Promise.all([
      settleHunt(pool, {
        huntId: startA.hunt.huntId,
        segmentKey: 'alpha-seg-1',
        clock
      }),
      settleHunt(pool, {
        huntId: startB.hunt.huntId,
        segmentKey: 'beta-seg-1',
        clock
      })
    ]);

    expect(settleA.ok && settleB.ok).toBe(true);

    const [recA, recB] = await Promise.all([
      reconcileCharacterEconomy(pool, charA.characterId),
      reconcileCharacterEconomy(pool, charB.characterId)
    ]);

    expect(recA.isGoldReconciled).toBe(true);
    expect(recA.isLootReconciled).toBe(true);
    expect(recA.isXpLevelReconciled).toBe(true);
    expect(recB.isGoldReconciled).toBe(true);
    expect(recB.isLootReconciled).toBe(true);
    expect(recB.isXpLevelReconciled).toBe(true);
  });

  it('P0: safely drains an 8h hunt under low event budget on stopHunt without losing time, duplicating rewards, or returning potions prematurely, including mid-drain crash recovery and stop races', async () => {
    const startEpoch = Date.parse('2026-10-31T00:00:00.000Z');
    const clockDrained = createFixedClock(startEpoch);
    const clockReference = createFixedClock(startEpoch);

    const [drainedSeed, refSeed] = await Promise.all([
      seedUserAndKnight({
        email: 'p0-drained@example.com',
        name: 'Sir Drained',
        level: 14,
        hp: 380,
        maxHp: 380,
        melee: 42,
        shielding: 40,
        hpPotions: 4000,
        mpPotions: 3000,
        nowIso: clockDrained.nowIso()
      }),
      seedUserAndKnight({
        email: 'p0-reference@example.com',
        name: 'Sir Reference',
        level: 14,
        hp: 380,
        maxHp: 380,
        melee: 42,
        shielding: 40,
        hpPotions: 4000,
        mpPotions: 3000,
        nowIso: clockReference.nowIso()
      })
    ]);

    const [startDrained, startRef] = await Promise.all([
      startHunt(pool, {
        characterId: drainedSeed.characterId,
        zoneId: 'damp-catacombs',
        strategy: 'safe',
        idempotencyKey: '8h-drained-start',
        requestedHpPotions: 3500,
        requestedMpPotions: 2500,
        seedSource: () => 8080808,
        clock: clockDrained
      }),
      startHunt(pool, {
        characterId: refSeed.characterId,
        zoneId: 'damp-catacombs',
        strategy: 'safe',
        idempotencyKey: '8h-ref-start',
        requestedHpPotions: 3500,
        requestedMpPotions: 2500,
        seedSource: () => 8080808,
        clock: clockReference
      })
    ]);
    expect(startDrained.ok && startRef.ok).toBe(true);
    if (!startDrained.ok || !startRef.ok) return;

    const eightHoursMs = 8 * 3_600_000; // 28,800,000 ms
    clockDrained.advanceMs(eightHoursMs);
    clockReference.advanceMs(eightHoursMs);

    // Very low event budget: ~13,000 events in 8h -> with maxEventsPerCall=400 it needs ~33 segments
    const lowBudgetConfig = {
      ...DEFAULT_COMBAT_SIMULATION_CONFIG,
      maxEventsPerCall: 400
    };

    // 1. First stopHunt call with bounded maxDrainSegments=6 MUST NOT finalize the hunt or return potions
    const stopStep1 = await stopHunt(pool, {
      huntId: startDrained.hunt.huntId,
      stopIdempotencyKey: 'stop-8h-key',
      settleBeforeStop: true,
      maxDrainSegments: 6,
      clock: clockDrained,
      config: lowBudgetConfig
    });
    expect(stopStep1.ok).toBe(true);
    if (!stopStep1.ok) return;

    expect(stopStep1.status).toBe('STOP_CONTINUATION_REQUIRED');
    expect(stopStep1.continuationRequired).toBe(true);
    expect(stopStep1.alreadyCompleted).toBe(false);
    expect(stopStep1.segmentsSettled).toBe(6);
    expect(stopStep1.unprocessedDurationMs).toBeGreaterThan(0);
    expect(stopStep1.unprocessedDurationMs).toBeLessThan(eightHoursMs);
    expect(stopStep1.hunt.status).toBe('ACTIVE');
    expect(stopStep1.hunt.potionsReturned).toBe(false);
    expect(stopStep1.unusedHpPotionsReturned).toBe(0);
    expect(stopStep1.unusedMpPotionsReturned).toBe(0);
    expect(stopStep1.character.hpPotions).toBe(500); // 4000 initial - 3500 reserved, 0 returned yet
    expect(Date.parse(stopStep1.stopCutoffIso)).toBe(startEpoch + eightHoursMs);

    // 2. Simulate crash after committing 3 more intermediate drain segments
    // Also advance clock by +10 minutes to prove the single stopCutoffIso remains locked at 8h!
    clockDrained.advanceMs(10 * 60 * 1000);
    await expect(
      stopHunt(pool, {
        huntId: startDrained.hunt.huntId,
        stopIdempotencyKey: 'stop-8h-key',
        settleBeforeStop: true,
        maxDrainSegments: 6,
        clock: clockDrained,
        config: lowBudgetConfig,
        faultInjection: { failAfterDrainSegments: 3 }
      })
    ).rejects.toThrow('FAULT_INJECTION: STOP_AFTER_DRAIN_SEGMENT_COMMIT');

    // Verify intermediate economy is 100% reconciled right after the mid-drain crash
    const recMidCrash = await reconcileCharacterEconomy(pool, drainedSeed.characterId);
    expect(recMidCrash.isGoldReconciled).toBe(true);
    expect(recMidCrash.isLootReconciled).toBe(true);
    expect(recMidCrash.isXpLevelReconciled).toBe(true);

    // 3. Also test concurrent race during continuation: stopHunt vs settleHunt + two concurrent stopHunt calls
    const [raceStopA, raceStopB, raceSettle] = await Promise.all([
      stopHunt(pool, {
        huntId: startDrained.hunt.huntId,
        stopIdempotencyKey: 'stop-8h-key',
        settleBeforeStop: true,
        maxDrainSegments: 4,
        clock: clockDrained,
        config: lowBudgetConfig
      }),
      stopHunt(pool, {
        huntId: startDrained.hunt.huntId,
        stopIdempotencyKey: 'stop-8h-concurrent-key',
        settleBeforeStop: true,
        maxDrainSegments: 4,
        clock: clockDrained,
        config: lowBudgetConfig
      }),
      settleHunt(pool, {
        huntId: startDrained.hunt.huntId,
        segmentKey: 'concurrent-mid-stop-settle',
        clock: clockDrained,
        config: lowBudgetConfig
      })
    ]);
    expect(raceStopA.ok && raceStopB.ok && raceSettle.ok).toBe(true);
    if (!raceStopA.ok || !raceStopB.ok) return;
    expect(raceStopA.status).toBe('STOP_CONTINUATION_REQUIRED');
    expect(raceStopB.status).toBe('STOP_CONTINUATION_REQUIRED');

    // 4. Continue retrying stopHunt until continuationRequired === false
    let finalStop: typeof stopStep1 = raceStopA;
    let safetyRetries = 0;
    while (finalStop.ok && finalStop.continuationRequired) {
      safetyRetries += 1;
      expect(safetyRetries).toBeLessThan(30);
      const nextStop = await stopHunt(pool, {
        huntId: startDrained.hunt.huntId,
        stopIdempotencyKey: 'stop-8h-key',
        settleBeforeStop: true,
        maxDrainSegments: 8,
        clock: clockDrained,
        config: lowBudgetConfig
      });
      expect(nextStop.ok).toBe(true);
      if (!nextStop.ok) return;
      finalStop = nextStop;
    }

    expect(finalStop.ok).toBe(true);
    if (!finalStop.ok) return;
    expect(finalStop.status).toBe('COMPLETED');
    expect(finalStop.continuationRequired).toBe(false);
    expect(finalStop.unprocessedDurationMs).toBe(0);
    expect(finalStop.hunt.status).toBe('COMPLETED');
    expect(finalStop.hunt.stopReason).toBe('MANUAL_STOP');
    expect(finalStop.hunt.checkpointView.stopReason).toBe('MANUAL_STOP');
    expect(finalStop.hunt.checkpointView.terminated).toBe(true);
    expect(finalStop.hunt.checkpointView.elapsedMs).toBe(eightHoursMs);
    expect(Date.parse(finalStop.hunt.settledUntilIso)).toBe(startEpoch + eightHoursMs);
    expect(Date.parse(finalStop.hunt.completedAtIso ?? '')).toBe(startEpoch + eightHoursMs);
    expect(finalStop.hunt.potionsReturned).toBe(true);

    // 5. Settle & stop the continuous 8h reference hunt in a single default budget pass
    const refStop = await stopHunt(pool, {
      huntId: startRef.hunt.huntId,
      stopIdempotencyKey: 'stop-ref-key',
      settleBeforeStop: true,
      clock: clockReference
    });
    expect(refStop.ok).toBe(true);
    if (!refStop.ok) return;

    // Bit-for-bit identical combat results and zero lost time / zero duplicate rewards
    expect({
      ...finalStop.hunt.checkpointView,
      configDigest: 'normalized'
    }).toEqual({
      ...refStop.hunt.checkpointView,
      configDigest: 'normalized'
    });
    expect(finalStop.character.stats).toEqual(refStop.character.stats);
    expect(finalStop.character.hpPotions).toBe(refStop.character.hpPotions);
    expect(finalStop.character.mpPotions).toBe(refStop.character.mpPotions);
    expect(
      finalStop.character.hpPotions + finalStop.hunt.checkpointView.hpPotionsUsed
    ).toBe(4000);
    expect(
      finalStop.character.mpPotions + finalStop.hunt.checkpointView.mpPotionsUsed
    ).toBe(3000);

    // 6. Multiple stopHunt retries after COMPLETED are idempotent no-ops
    const [retryAfter1, retryAfter2] = await Promise.all([
      stopHunt(pool, {
        huntId: startDrained.hunt.huntId,
        stopIdempotencyKey: 'stop-8h-key',
        clock: clockDrained
      }),
      stopHunt(pool, {
        huntId: startDrained.hunt.huntId,
        stopIdempotencyKey: 'stop-8h-key-extra',
        clock: clockDrained
      })
    ]);
    expect(retryAfter1.ok && retryAfter2.ok).toBe(true);
    if (!retryAfter1.ok || !retryAfter2.ok) return;
    expect(retryAfter1.alreadyCompleted).toBe(true);
    expect(retryAfter1.unusedHpPotionsReturned).toBe(0);
    expect(retryAfter2.alreadyCompleted).toBe(true);
    expect(retryAfter2.unusedHpPotionsReturned).toBe(0);

    const [recDrained, recRef] = await Promise.all([
      reconcileCharacterEconomy(pool, drainedSeed.characterId),
      reconcileCharacterEconomy(pool, refSeed.characterId)
    ]);
    expect(recDrained.isGoldReconciled).toBe(true);
    expect(recDrained.isLootReconciled).toBe(true);
    expect(recDrained.isXpLevelReconciled).toBe(true);
    expect(recDrained.characterGold).toBe(recRef.characterGold);
    expect(recDrained.characterXp).toBe(recRef.characterXp);
    expect(recDrained.totalUnclaimedItemsByCode).toEqual(recRef.totalUnclaimedItemsByCode);
  });

  it('P1: preserves frozen balance rules and RNG for existing hunts across config version rollover (Config A -> Config B)', async () => {
    const startEpoch = Date.parse('2026-10-31T21:00:00.000Z');
    const clockRollover = createFixedClock(startEpoch);
    const clockPureA = createFixedClock(startEpoch);

    const [charRollover, charPureA, charNewB] = await Promise.all([
      seedUserAndKnight({
        email: 'rollover-a@example.com',
        name: 'Knight Rollover',
        level: 10,
        melee: 32,
        shielding: 30,
        nowIso: clockRollover.nowIso()
      }),
      seedUserAndKnight({
        email: 'pure-a@example.com',
        name: 'Knight PureA',
        level: 10,
        melee: 32,
        shielding: 30,
        nowIso: clockPureA.nowIso()
      }),
      seedUserAndKnight({
        email: 'new-b@example.com',
        name: 'Knight NewB',
        level: 10,
        melee: 32,
        shielding: 30,
        nowIso: clockRollover.nowIso()
      })
    ]);

    const configVersionA = {
      ...DEFAULT_COMBAT_SIMULATION_CONFIG,
      version: '1.0.0'
    };

    const stalkerA = DEFAULT_COMBAT_SIMULATION_CONFIG.monsters['cellar-stalker'];
    const carapaceA = DEFAULT_COMBAT_SIMULATION_CONFIG.monsters['mire-carapace'];
    if (!stalkerA || !carapaceA) {
      throw new Error('Missing damp-catacombs monsters');
    }

    // Config Version B (simulating a balance patch on server restart: 10x XP and 10x Gold)
    const configVersionB = {
      ...DEFAULT_COMBAT_SIMULATION_CONFIG,
      version: '1.1.0',
      monsters: {
        ...DEFAULT_COMBAT_SIMULATION_CONFIG.monsters,
        'cellar-stalker': {
          ...stalkerA,
          xpReward: stalkerA.xpReward * 10,
          goldMin: stalkerA.goldMin * 10,
          goldMax: stalkerA.goldMax * 10
        },
        'mire-carapace': {
          ...carapaceA,
          xpReward: carapaceA.xpReward * 10,
          goldMin: carapaceA.goldMin * 10,
          goldMax: carapaceA.goldMax * 10
        }
      }
    };

    // Step A & B: Start Hunt A under Config Version A and persist checkpoint in PostgreSQL
    const [startRolloverA, startPureA] = await Promise.all([
      startHunt(pool, {
        characterId: charRollover.characterId,
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        idempotencyKey: 'rollover-hunt-a',
        seedSource: () => 515151,
        clock: clockRollover,
        config: configVersionA
      }),
      startHunt(pool, {
        characterId: charPureA.characterId,
        zoneId: 'damp-catacombs',
        strategy: 'balanced',
        idempotencyKey: 'pure-hunt-a',
        seedSource: () => 515151,
        clock: clockPureA,
        config: configVersionA
      })
    ]);
    expect(startRolloverA.ok && startPureA.ok).toBe(true);
    if (!startRolloverA.ok || !startPureA.ok) return;

    // Settle first 15m under Config Version A before restart
    clockRollover.advanceMs(15 * 60 * 1000);
    clockPureA.advanceMs(15 * 60 * 1000);

    const [seg1Rollover, seg1PureA] = await Promise.all([
      settleHunt(pool, {
        huntId: startRolloverA.hunt.huntId,
        segmentKey: 'seg-15m',
        clock: clockRollover,
        config: configVersionA
      }),
      settleHunt(pool, {
        huntId: startPureA.hunt.huntId,
        segmentKey: 'seg-15m',
        clock: clockPureA,
        config: configVersionA
      })
    ]);
    expect(seg1Rollover.ok && seg1PureA.ok).toBe(true);

    // Step C & D: Server restarts with Config Version B (1.1.0, 10x XP/gold).
    // Also start a brand-new Hunt B after the restart using Config Version B.
    const startHuntB = await startHunt(pool, {
      characterId: charNewB.characterId,
      zoneId: 'damp-catacombs',
      strategy: 'balanced',
      idempotencyKey: 'new-hunt-b',
      seedSource: () => 515151,
      clock: clockRollover,
      config: configVersionB
    });
    expect(startHuntB.ok).toBe(true);
    if (!startHuntB.ok) return;
    expect(startHuntB.hunt.simulationVersion).toBe('1.1.0');

    // Advance another 30 minutes and settle Hunt A while server passes Config Version B!
    clockRollover.advanceMs(30 * 60 * 1000);
    clockPureA.advanceMs(30 * 60 * 1000);

    const [seg2RolloverUnderB, seg2PureAUnderA, seg1NewBUnderB] = await Promise.all([
      settleHunt(pool, {
        huntId: startRolloverA.hunt.huntId,
        segmentKey: 'seg-45m-under-b',
        clock: clockRollover,
        config: configVersionB
      }),
      settleHunt(pool, {
        huntId: startPureA.hunt.huntId,
        segmentKey: 'seg-45m-under-a',
        clock: clockPureA,
        config: configVersionA
      }),
      settleHunt(pool, {
        huntId: startHuntB.hunt.huntId,
        segmentKey: 'seg-new-b-30m',
        clock: clockRollover,
        config: configVersionB
      })
    ]);

    expect(seg2RolloverUnderB.ok && seg2PureAUnderA.ok && seg1NewBUnderB.ok).toBe(true);
    if (!seg2RolloverUnderB.ok || !seg2PureAUnderA.ok || !seg1NewBUnderB.ok) return;

    // Hunt A settled under Config B runtime MUST preserve Config A's version, digest, RNG, and exact rewards!
    expect(seg2RolloverUnderB.hunt.simulationVersion).toBe('1.0.0');
    expect(seg2RolloverUnderB.hunt.configDigest).toBe(startRolloverA.hunt.configDigest);
    expect(seg2RolloverUnderB.rewards).toEqual(seg2PureAUnderA.rewards);
    expect({
      ...seg2RolloverUnderB.hunt.checkpointView,
      configDigest: 'normalized'
    }).toEqual({
      ...seg2PureAUnderA.hunt.checkpointView,
      configDigest: 'normalized'
    });

    // Meanwhile, New Hunt B started under Config B earned ~10x XP/gold for its 30m window
    expect(seg1NewBUnderB.rewards.deltaXpGained).toBeGreaterThan(
      seg2RolloverUnderB.rewards.deltaXpGained * 5
    );

    // Stopping Hunt A under Config B also succeeds cleanly with consistent MANUAL_STOP reason
    const stopRolloverA = await stopHunt(pool, {
      huntId: startRolloverA.hunt.huntId,
      stopIdempotencyKey: 'stop-rollover-a',
      settleBeforeStop: true,
      clock: clockRollover,
      config: configVersionB
    });
    expect(stopRolloverA.ok).toBe(true);
    if (!stopRolloverA.ok) return;
    expect(stopRolloverA.hunt.status).toBe('COMPLETED');
    expect(stopRolloverA.hunt.stopReason).toBe('MANUAL_STOP');
    expect(stopRolloverA.hunt.checkpointView.stopReason).toBe('MANUAL_STOP');

    const recRollover = await reconcileCharacterEconomy(pool, charRollover.characterId);
    expect(recRollover.isGoldReconciled).toBe(true);
    expect(recRollover.isLootReconciled).toBe(true);
    expect(recRollover.isXpLevelReconciled).toBe(true);
  });
});
