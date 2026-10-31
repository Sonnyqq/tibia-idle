import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  type ActiveHuntDto,
  type CharacterDto,
  type CharacterHuntRewardItemDto,
  type HuntSegmentDto,
  type HuntSummaryDto,
  type VocationDto
} from '@tibia-idle/contracts';
import {
  assertNoRngLeakInPublicPayload,
  calculateCharacterVitalsForLevel,
  CATALOG_ITEMS_MAP,
  type Clock,
  type CombatCharacterSnapshot,
  type CombatCheckpointState,
  type CombatResourceLoadout,
  type CombatSimulationConfig,
  createInitialCombatCheckpoint,
  createSystemClock,
  DEFAULT_COMBAT_RESOURCES,
  DEFAULT_COMBAT_SIMULATION_CONFIG,
  DEFAULT_KNIGHT_EQUIPMENT,
  deserializeCombatCheckpoint,
  generateCryptographicHuntSeed,
  HUNT_STRATEGIES,
  type HuntStopReason,
  type HuntStrategy,
  isSupportedSimulationVersion,
  MAX_OFFLINE_DURATION_MS,
  MAX_POTION_STACK_COUNT,
  MAX_SAFE_ECONOMY_INT,
  type PublicHuntCheckpointView,
  reconstructSimulationConfigFromSnapshot,
  resolveLevelFromTotalXp,
  serializeCombatCheckpoint,
  simulateHuntSegment,
  toPublicHuntCheckpointView,
  VALID_CATALOG_ITEM_IDS,
  validateCombatConfig
} from '@tibia-idle/domain';
import type pg from 'pg';

export type HuntStatus = 'ACTIVE' | 'COMPLETED';
export type PersistedHuntStopReason = HuntStopReason;
export const DEFAULT_MAX_STOP_DRAIN_SEGMENTS = 24 as const;

export interface ExtendedCharacterDto extends CharacterDto {
  readonly hpPotions: number;
  readonly mpPotions: number;
  readonly rowVersion: number;
}

export interface PublicHuntSessionView {
  readonly huntId: string;
  readonly characterId: string;
  readonly zoneId: string;
  readonly strategy: HuntStrategy;
  readonly status: HuntStatus;
  readonly stopReason: PersistedHuntStopReason | null;
  readonly startedAtIso: string;
  readonly settledUntilIso: string;
  readonly stopRequestedAtIso: string | null;
  readonly completedAtIso: string | null;
  readonly simulationVersion: string;
  readonly configDigest: string;
  readonly reservedHpPotions: number;
  readonly reservedMpPotions: number;
  readonly potionsReturned: boolean;
  readonly rowVersion: number;
  readonly snapshotMaxHp?: number;
  readonly snapshotMaxMp?: number;
  readonly snapshotLevel?: number;
  readonly checkpointView: PublicHuntCheckpointView;
}

export interface SettlementSegmentRewardsSummary {
  readonly deltaElapsedMs: number;
  readonly unprocessedDurationMs: number;
  readonly isPartialSettlement: boolean;
  readonly deltaKills: number;
  readonly deltaKillsByMonster: Readonly<Record<string, number>>;
  readonly deltaXpGained: number;
  readonly deltaGoldGained: number;
  readonly deltaLootByItem: Readonly<Record<string, number>>;
  readonly deltaDamageDealt: number;
  readonly deltaDamageTaken: number;
  readonly deltaHpPotionsUsed: number;
  readonly deltaMpPotionsUsed: number;
  readonly simulatedEvents: number;
  readonly levelBefore: number;
  readonly levelAfter: number;
  readonly combatEndHp: number;
  readonly revivedAtCamp: boolean;
  readonly campHpRestoredTo: number | null;
  readonly unusedHpPotionsReturned: number;
  readonly unusedMpPotionsReturned: number;
}

export type SettlementFaultStage =
  | 'AFTER_CHECKPOINT_UPDATE_BEFORE_COMMIT'
  | 'AFTER_GOLD_LEDGER_BEFORE_COMMIT'
  | 'AFTER_REWARD_ITEMS_BEFORE_COMMIT'
  | 'AFTER_COMMIT_BEFORE_RESPONSE';

export interface SettlementFaultInjectionHook {
  readonly failAtStage?: SettlementFaultStage | undefined;
  readonly onBeforeLockAcquire?: (() => Promise<void>) | undefined;
  readonly onAfterLockAcquired?: (() => Promise<void>) | undefined;
}

export interface SettlementTelemetry {
  readonly simulationMs: number;
  readonly lockWaitMs: number;
  readonly transactionMs: number;
  readonly totalMs: number;
  readonly retries: number;
}

export interface StartHuntInput {
  readonly characterId: string;
  readonly userId?: string | undefined;
  readonly zoneId: string;
  readonly strategy: HuntStrategy;
  readonly idempotencyKey: string;
  readonly requestedHpPotions?: number | undefined;
  readonly requestedMpPotions?: number | undefined;
  readonly clock?: Clock | undefined;
  readonly seedSource?: (() => number) | undefined;
  readonly config?: CombatSimulationConfig | undefined;
}

export type StartHuntResult =
  | {
      readonly ok: true;
      readonly hunt: PublicHuntSessionView;
      readonly character: ExtendedCharacterDto;
      readonly idempotentReplay: boolean;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'CHARACTER_NOT_FOUND'
        | 'FORBIDDEN_CHARACTER'
        | 'UNSUPPORTED_VOCATION'
        | 'UNKNOWN_ZONE'
        | 'LEVEL_TOO_LOW'
        | 'INVALID_STRATEGY'
        | 'INVALID_IDEMPOTENCY_KEY'
        | 'INVALID_RESOURCE_REQUEST'
        | 'INSUFFICIENT_RESOURCES'
        | 'ACTIVE_HUNT_ALREADY_EXISTS'
        | 'IDEMPOTENCY_KEY_CONFLICT';
    };

export interface SettleHuntInput {
  readonly huntId: string;
  readonly characterId?: string | undefined;
  readonly userId?: string | undefined;
  readonly segmentKey: string;
  readonly clock?: Clock | undefined;
  readonly config?: CombatSimulationConfig | undefined;
  readonly faultInjection?: SettlementFaultInjectionHook | undefined;
}

export type SettleHuntResult =
  | {
      readonly ok: true;
      readonly status: 'SETTLED' | 'PARTIAL_SETTLED' | 'ALREADY_COMPLETED';
      readonly idempotentReplay: boolean;
      readonly hunt: PublicHuntSessionView;
      readonly segmentId: string | null;
      readonly segmentKey: string;
      readonly rewards: SettlementSegmentRewardsSummary;
      readonly character: ExtendedCharacterDto;
      readonly telemetry: SettlementTelemetry;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'HUNT_NOT_FOUND'
        | 'FORBIDDEN_HUNT'
        | 'INVALID_SEGMENT_KEY'
        | 'CORRUPTED_CHECKPOINT'
        | 'CONFIG_MISMATCH'
        | 'ECONOMY_OVERFLOW';
    };

export interface StopHuntFaultInjectionHook {
  readonly failAfterDrainSegments?: number | undefined;
}

export interface StopHuntInput {
  readonly huntId: string;
  readonly characterId?: string | undefined;
  readonly userId?: string | undefined;
  readonly stopIdempotencyKey: string;
  readonly settleBeforeStop?: boolean | undefined;
  readonly maxDrainSegments?: number | undefined;
  readonly clock?: Clock | undefined;
  readonly config?: CombatSimulationConfig | undefined;
  readonly faultInjection?: StopHuntFaultInjectionHook | undefined;
}

export type StopHuntResult =
  | {
      readonly ok: true;
      readonly status: 'COMPLETED' | 'ALREADY_COMPLETED' | 'STOP_CONTINUATION_REQUIRED';
      readonly alreadyCompleted: boolean;
      readonly continuationRequired: boolean;
      readonly unprocessedDurationMs: number;
      readonly segmentsSettled: number;
      readonly stopCutoffIso: string;
      readonly hunt: PublicHuntSessionView;
      readonly character: ExtendedCharacterDto;
      readonly unusedHpPotionsReturned: number;
      readonly unusedMpPotionsReturned: number;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'HUNT_NOT_FOUND'
        | 'FORBIDDEN_HUNT'
        | 'INVALID_IDEMPOTENCY_KEY'
        | 'CORRUPTED_CHECKPOINT'
        | 'CONFIG_MISMATCH'
        | 'ECONOMY_OVERFLOW';
    };

export interface ReconcileCharacterEconomyReport {
  readonly characterId: string;
  readonly characterGold: number;
  readonly ledgerGoldSum: number;
  readonly latestLedgerBalanceAfter: number;
  readonly isGoldReconciled: boolean;
  readonly totalUnclaimedItemsByCode: Readonly<Record<string, number>>;
  readonly totalClaimedItemsByCode: Readonly<Record<string, number>>;
  readonly totalMovementClaimedItemsByCode: Readonly<Record<string, number>>;
  readonly totalSettledItemsByCode: Readonly<Record<string, number>>;
  readonly isLootReconciled: boolean;
  readonly totalSettledXp: number;
  readonly characterXp: number;
  readonly characterLevel: number;
  readonly expectedLevel: number;
  readonly isXpLevelReconciled: boolean;
}

interface CharacterDbRow {
  id: string;
  user_id: string;
  slot_number: number;
  name: string;
  vocation: VocationDto;
  level: number;
  xp: string | number;
  hp: number;
  max_hp: number;
  mp: number;
  max_mp: number;
  gold: string | number;
  skill_melee: number;
  skill_distance: number;
  skill_magic: number;
  skill_shielding: number;
  hp_potions: number;
  mp_potions: number;
  row_version: number;
  created_at: Date;
}

interface HuntDbRow {
  id: string;
  character_id: string;
  start_idempotency_key: string;
  zone_id: string;
  strategy: HuntStrategy;
  status: HuntStatus;
  stop_reason: PersistedHuntStopReason | null;
  started_at: Date;
  settled_until: Date;
  stop_requested_at: Date | null;
  completed_at: Date | null;
  simulation_version: string;
  config_digest: string;
  private_checkpoint: unknown;
  reserved_hp_potions: number;
  reserved_mp_potions: number;
  potions_returned: boolean;
  row_version: number;
}

interface HuntSegmentDbRow {
  id: string;
  hunt_id: string;
  segment_key: string;
  start_checkpoint_version: number;
  end_checkpoint_version: number;
  segment_from: Date;
  segment_to: Date;
  processed_duration_ms: number;
  simulated_events: number;
  stop_reason: PersistedHuntStopReason;
  is_partial: boolean;
  rewards: SettlementSegmentRewardsSummary;
  committed_at: Date;
}

const MAX_SETTLEMENT_RETRIES = 32;

function isPgUniqueViolation(err: unknown): err is { code: string; constraint?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

function parseSafeBigIntField(raw: string | number): bigint {
  try {
    return typeof raw === 'number' ? BigInt(Math.trunc(raw)) : BigInt(raw);
  } catch {
    return -1n;
  }
}

function isSafeEconomyBigInt(value: bigint): boolean {
  return value >= 0n && value <= BigInt(MAX_SAFE_ECONOMY_INT);
}

function mapExtendedCharacterDto(row: CharacterDbRow): ExtendedCharacterDto {
  return {
    id: row.id,
    userId: row.user_id,
    slotNumber: Number(row.slot_number),
    name: row.name,
    vocation: row.vocation,
    stats: {
      level: Number(row.level),
      xp: Number(row.xp),
      hp: Number(row.hp),
      maxHp: Number(row.max_hp),
      mp: Number(row.mp),
      maxMp: Number(row.max_mp),
      gold: Number(row.gold),
      melee: Number(row.skill_melee),
      distance: Number(row.skill_distance),
      magic: Number(row.skill_magic),
      shielding: Number(row.skill_shielding)
    },
    hpPotions: Number(row.hp_potions),
    mpPotions: Number(row.mp_potions),
    rowVersion: Number(row.row_version),
    createdAt: row.created_at.toISOString()
  };
}

function parseAndValidateStoredCheckpoint(
  rawCheckpoint: unknown,
  expectedSimulationVersion: string,
  expectedConfigDigest: string
): CombatCheckpointState {
  const serialized =
    typeof rawCheckpoint === 'string' ? rawCheckpoint : JSON.stringify(rawCheckpoint);
  const checkpoint = deserializeCombatCheckpoint(serialized);
  if (
    checkpoint.simulationVersion !== expectedSimulationVersion ||
    checkpoint.configDigest !== expectedConfigDigest
  ) {
    throw new RangeError('Hunt row metadata does not match stored checkpoint digest/version');
  }
  return checkpoint;
}

function mapPublicHuntView(
  row: HuntDbRow,
  validatedCheckpoint: CombatCheckpointState
): PublicHuntSessionView {
  const checkpointView = toPublicHuntCheckpointView(validatedCheckpoint);
  assertNoRngLeakInPublicPayload(checkpointView);
  return {
    huntId: row.id,
    characterId: row.character_id,
    zoneId: row.zone_id,
    strategy: row.strategy,
    status: row.status,
    stopReason: row.stop_reason,
    startedAtIso: row.started_at.toISOString(),
    settledUntilIso: row.settled_until.toISOString(),
    stopRequestedAtIso: row.stop_requested_at ? row.stop_requested_at.toISOString() : null,
    completedAtIso: row.completed_at ? row.completed_at.toISOString() : null,
    simulationVersion: row.simulation_version,
    configDigest: row.config_digest,
    reservedHpPotions: Number(row.reserved_hp_potions),
    reservedMpPotions: Number(row.reserved_mp_potions),
    potionsReturned: Boolean(row.potions_returned),
    rowVersion: Number(row.row_version),
    snapshotMaxHp: validatedCheckpoint.snapshot.character.maxHp,
    snapshotMaxMp: validatedCheckpoint.snapshot.character.maxMp,
    snapshotLevel: validatedCheckpoint.snapshot.character.level,
    checkpointView
  };
}

function createZeroRewardsSummary(level: number, currentHp: number): SettlementSegmentRewardsSummary {
  return {
    deltaElapsedMs: 0,
    unprocessedDurationMs: 0,
    isPartialSettlement: false,
    deltaKills: 0,
    deltaKillsByMonster: {},
    deltaXpGained: 0,
    deltaGoldGained: 0,
    deltaLootByItem: {},
    deltaDamageDealt: 0,
    deltaDamageTaken: 0,
    deltaHpPotionsUsed: 0,
    deltaMpPotionsUsed: 0,
    simulatedEvents: 0,
    levelBefore: level,
    levelAfter: level,
    combatEndHp: currentHp,
    revivedAtCamp: false,
    campHpRestoredTo: null,
    unusedHpPotionsReturned: 0,
    unusedMpPotionsReturned: 0
  };
}

/**
 * Starts a persistent server-authoritative offline hunt inside an atomic PostgreSQL transaction.
 * Locks the character row, verifies vocation/level/zone/strategy, reserves real potions,
 * generates a cryptographic server seed, and persists the initial checkpoint.
 */
export async function startHunt(
  pool: pg.Pool,
  input: StartHuntInput
): Promise<StartHuntResult> {
  const idempotencyKey =
    typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (idempotencyKey.length < 1 || idempotencyKey.length > 128) {
    return { ok: false, reason: 'INVALID_IDEMPOTENCY_KEY' };
  }

  if (
    typeof input.strategy !== 'string' ||
    !(HUNT_STRATEGIES as readonly string[]).includes(input.strategy)
  ) {
    return { ok: false, reason: 'INVALID_STRATEGY' };
  }

  const config = input.config ?? DEFAULT_COMBAT_SIMULATION_CONFIG;
  validateCombatConfig(config);

  const zone = config.zones[input.zoneId];
  if (!zone) {
    return { ok: false, reason: 'UNKNOWN_ZONE' };
  }

  const clock = input.clock ?? createSystemClock();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const charRes = await client.query<CharacterDbRow>(
      'SELECT * FROM characters WHERE id = $1 FOR UPDATE',
      [input.characterId]
    );
    const charRow = charRes.rows[0];
    if (!charRow) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'CHARACTER_NOT_FOUND' };
    }

    if (input.userId !== undefined && charRow.user_id !== input.userId) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'FORBIDDEN_CHARACTER' };
    }

    // 1. Check idempotency key for this character
    const existingIdemRes = await client.query<HuntDbRow>(
      `SELECT * FROM hunts
       WHERE character_id = $1 AND start_idempotency_key = $2
       LIMIT 1`,
      [charRow.id, idempotencyKey]
    );
    const existingIdemHunt = existingIdemRes.rows[0];
    if (existingIdemHunt) {
      if (
        existingIdemHunt.zone_id !== zone.id ||
        existingIdemHunt.strategy !== input.strategy
      ) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'IDEMPOTENCY_KEY_CONFLICT' };
      }
      const existingCp = parseAndValidateStoredCheckpoint(
        existingIdemHunt.private_checkpoint,
        existingIdemHunt.simulation_version,
        existingIdemHunt.config_digest
      );
      await client.query('ROLLBACK');
      return {
        ok: true,
        hunt: mapPublicHuntView(existingIdemHunt, existingCp),
        character: mapExtendedCharacterDto(charRow),
        idempotentReplay: true
      };
    }

    // 2. Enforce at most one ACTIVE hunt per character
    const activeRes = await client.query<{ id: string }>(
      `SELECT id FROM hunts
       WHERE character_id = $1 AND status = 'ACTIVE'
       LIMIT 1`,
      [charRow.id]
    );
    if ((activeRes.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'ACTIVE_HUNT_ALREADY_EXISTS' };
    }

    // 3. Validate vocation and zone minimum level
    if (charRow.vocation !== 'knight') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'UNSUPPORTED_VOCATION' };
    }
    const charLevel = Number(charRow.level);
    if (charLevel < zone.minLevel) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'LEVEL_TOO_LOW' };
    }

    // 4. Validate and reserve real potion supplies from character
    const availHpPotions = Number(charRow.hp_potions);
    const availMpPotions = Number(charRow.mp_potions);
    const requestedHpPotions = input.requestedHpPotions ?? availHpPotions;
    const requestedMpPotions = input.requestedMpPotions ?? availMpPotions;

    if (
      !Number.isSafeInteger(requestedHpPotions) ||
      requestedHpPotions < 0 ||
      requestedHpPotions > MAX_POTION_STACK_COUNT ||
      !Number.isSafeInteger(requestedMpPotions) ||
      requestedMpPotions < 0 ||
      requestedMpPotions > MAX_POTION_STACK_COUNT
    ) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'INVALID_RESOURCE_REQUEST' };
    }

    if (requestedHpPotions > availHpPotions || requestedMpPotions > availMpPotions) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'INSUFFICIENT_RESOURCES' };
    }

    const xpBig = parseSafeBigIntField(charRow.xp);
    if (!isSafeEconomyBigInt(xpBig)) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'INVALID_RESOURCE_REQUEST' };
    }

    const characterSnapshot: CombatCharacterSnapshot = {
      characterId: charRow.id,
      vocation: charRow.vocation,
      level: charLevel,
      xp: Number(xpBig),
      hp: Number(charRow.hp),
      maxHp: Number(charRow.max_hp),
      mp: Number(charRow.mp),
      maxMp: Number(charRow.max_mp),
      melee: Number(charRow.skill_melee),
      shielding: Number(charRow.skill_shielding),
      magic: Number(charRow.skill_magic),
      equipment: DEFAULT_KNIGHT_EQUIPMENT
    };

    const resourceLoadout: CombatResourceLoadout = {
      ...DEFAULT_COMBAT_RESOURCES,
      hpPotions: requestedHpPotions,
      mpPotions: requestedMpPotions
    };

    const seed = input.seedSource ? input.seedSource() : generateCryptographicHuntSeed();
    const initialCheckpoint = createInitialCombatCheckpoint({
      character: characterSnapshot,
      zoneId: zone.id,
      strategy: input.strategy,
      seed,
      resources: resourceLoadout,
      config
    });

    const updatedCharRes = await client.query<CharacterDbRow>(
      `UPDATE characters
       SET hp_potions = hp_potions - $2,
           mp_potions = mp_potions - $3,
           row_version = row_version + 1
       WHERE id = $1
       RETURNING *`,
      [charRow.id, requestedHpPotions, requestedMpPotions]
    );
    const updatedChar = updatedCharRes.rows[0];
    if (!updatedChar) {
      throw new Error('Failed to update character potions during startHunt');
    }

    const nowIso = clock.nowIso();
    const huntId = randomUUID();
    const serializedCheckpoint = serializeCombatCheckpoint(initialCheckpoint);

    const insertHuntRes = await client.query<HuntDbRow>(
      `INSERT INTO hunts (
         id, character_id, start_idempotency_key, zone_id, strategy, status, stop_reason,
         started_at, settled_until, completed_at, simulation_version, config_digest,
         private_checkpoint, reserved_hp_potions, reserved_mp_potions, potions_returned, row_version
       )
       VALUES (
         $1, $2, $3, $4, $5, 'ACTIVE', NULL,
         $6::timestamptz, $6::timestamptz, NULL, $7, $8,
         $9::jsonb, $10, $11, FALSE, 1
       )
       RETURNING *`,
      [
        huntId,
        charRow.id,
        idempotencyKey,
        zone.id,
        input.strategy,
        nowIso,
        initialCheckpoint.simulationVersion,
        initialCheckpoint.configDigest,
        serializedCheckpoint,
        requestedHpPotions,
        requestedMpPotions
      ]
    );
    const huntRow = insertHuntRes.rows[0];
    if (!huntRow) {
      throw new Error('Failed to insert hunt row');
    }

    await client.query('COMMIT');
    return {
      ok: true,
      hunt: mapPublicHuntView(huntRow, initialCheckpoint),
      character: mapExtendedCharacterDto(updatedChar),
      idempotentReplay: false
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (isPgUniqueViolation(err)) {
      return { ok: false, reason: 'ACTIVE_HUNT_ALREADY_EXISTS' };
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Settles an active offline hunt up to authoritative server time (`clock.nowMs()`).
 * Uses optimistic snapshot reading + out-of-transaction deterministic simulation +
 * short pessimistic commit transaction with `FOR UPDATE` row locks, `row_version`
 * verification, and `(hunt_id, segment_key)` / `(hunt_id, start_checkpoint_version)`
 * uniqueness constraints to guarantee ZERO double rewards.
 */
export async function settleHunt(
  pool: pg.Pool,
  input: SettleHuntInput
): Promise<SettleHuntResult> {
  const tTotalStart = performance.now();
  let simulationMs = 0;
  let lockWaitMs = 0;
  let transactionMs = 0;
  let retries = 0;

  const segmentKey = typeof input.segmentKey === 'string' ? input.segmentKey.trim() : '';
  if (segmentKey.length < 1 || segmentKey.length > 128) {
    return { ok: false, reason: 'INVALID_SEGMENT_KEY' };
  }

  const clock = input.clock ?? createSystemClock();
  const effectiveConfig = input.config ?? DEFAULT_COMBAT_SIMULATION_CONFIG;
  try {
    validateCombatConfig(effectiveConfig);
  } catch {
    return { ok: false, reason: 'CONFIG_MISMATCH' };
  }
  if (!isSupportedSimulationVersion(effectiveConfig.version)) {
    return { ok: false, reason: 'CONFIG_MISMATCH' };
  }

  while (retries <= MAX_SETTLEMENT_RETRIES) {
    // Phase 1: Read current hunt & character state without holding transaction locks
    const huntQuery = await pool.query<HuntDbRow & { owner_user_id: string }>(
      `SELECT h.*, c.user_id AS owner_user_id
       FROM hunts h
       INNER JOIN characters c ON c.id = h.character_id
       WHERE h.id = $1
       LIMIT 1`,
      [input.huntId]
    );
    const snapshotHuntRow = huntQuery.rows[0];
    if (!snapshotHuntRow) {
      return { ok: false, reason: 'HUNT_NOT_FOUND' };
    }
    if (
      (input.characterId !== undefined && snapshotHuntRow.character_id !== input.characterId) ||
      (input.userId !== undefined && snapshotHuntRow.owner_user_id !== input.userId)
    ) {
      return { ok: false, reason: 'FORBIDDEN_HUNT' };
    }
    if (!isSupportedSimulationVersion(snapshotHuntRow.simulation_version)) {
      return { ok: false, reason: 'CONFIG_MISMATCH' };
    }

    // Fast path: check if this exact segmentKey was already committed
    const priorSegmentRes = await pool.query<HuntSegmentDbRow>(
      `SELECT * FROM hunt_segments
       WHERE hunt_id = $1 AND segment_key = $2
       LIMIT 1`,
      [snapshotHuntRow.id, segmentKey]
    );
    const priorSegment = priorSegmentRes.rows[0];
    if (priorSegment) {
      let currentCp: CombatCheckpointState;
      try {
        currentCp = parseAndValidateStoredCheckpoint(
          snapshotHuntRow.private_checkpoint,
          snapshotHuntRow.simulation_version,
          snapshotHuntRow.config_digest
        );
      } catch {
        return { ok: false, reason: 'CORRUPTED_CHECKPOINT' };
      }
      const charRes = await pool.query<CharacterDbRow>(
        'SELECT * FROM characters WHERE id = $1 LIMIT 1',
        [snapshotHuntRow.character_id]
      );
      const charRow = charRes.rows[0];
      if (!charRow) {
        return { ok: false, reason: 'HUNT_NOT_FOUND' };
      }
      return {
        ok: true,
        status: priorSegment.is_partial ? 'PARTIAL_SETTLED' : 'SETTLED',
        idempotentReplay: true,
        hunt: mapPublicHuntView(snapshotHuntRow, currentCp),
        segmentId: priorSegment.id,
        segmentKey: priorSegment.segment_key,
        rewards: priorSegment.rewards,
        character: mapExtendedCharacterDto(charRow),
        telemetry: {
          simulationMs: Number(simulationMs.toFixed(3)),
          lockWaitMs: Number(lockWaitMs.toFixed(3)),
          transactionMs: Number(transactionMs.toFixed(3)),
          totalMs: Number((performance.now() - tTotalStart).toFixed(3)),
          retries
        }
      };
    }

    let prevCheckpoint: CombatCheckpointState;
    try {
      prevCheckpoint = parseAndValidateStoredCheckpoint(
        snapshotHuntRow.private_checkpoint,
        snapshotHuntRow.simulation_version,
        snapshotHuntRow.config_digest
      );
    } catch {
      return { ok: false, reason: 'CORRUPTED_CHECKPOINT' };
    }

    if (snapshotHuntRow.status === 'COMPLETED') {
      const charRes = await pool.query<CharacterDbRow>(
        'SELECT * FROM characters WHERE id = $1 LIMIT 1',
        [snapshotHuntRow.character_id]
      );
      const charRow = charRes.rows[0];
      if (!charRow) {
        return { ok: false, reason: 'HUNT_NOT_FOUND' };
      }
      return {
        ok: true,
        status: 'ALREADY_COMPLETED',
        idempotentReplay: false,
        hunt: mapPublicHuntView(snapshotHuntRow, prevCheckpoint),
        segmentId: null,
        segmentKey,
        rewards: createZeroRewardsSummary(Number(charRow.level), Number(charRow.hp)),
        character: mapExtendedCharacterDto(charRow),
        telemetry: {
          simulationMs: Number(simulationMs.toFixed(3)),
          lockWaitMs: Number(lockWaitMs.toFixed(3)),
          transactionMs: Number(transactionMs.toFixed(3)),
          totalMs: Number((performance.now() - tTotalStart).toFixed(3)),
          retries
        }
      };
    }

    // Reconstruct the hunt's frozen balance configuration from its immutable snapshot
    // so older hunts preserve their original balance rules across config rollovers
    // while applying only the runtime `maxEventsPerCall` execution budget.
    let huntFrozenConfig: CombatSimulationConfig;
    try {
      huntFrozenConfig = reconstructSimulationConfigFromSnapshot(prevCheckpoint.snapshot, {
        maxEventsPerCall: effectiveConfig.maxEventsPerCall
      });
    } catch {
      return { ok: false, reason: 'CONFIG_MISMATCH' };
    }

    // Phase 2: Out-of-transaction deterministic combat simulation (clamped to stop_requested_at if stopping)
    const rawNowMs = clock.nowMs();
    const effectiveNowMs =
      snapshotHuntRow.stop_requested_at !== null
        ? Math.min(rawNowMs, snapshotHuntRow.stop_requested_at.getTime())
        : rawNowMs;
    const settledUntilMs = snapshotHuntRow.settled_until.getTime();
    const availableDurationMs = Math.max(0, effectiveNowMs - settledUntilMs);

    const tSim0 = performance.now();
    let simResult;
    try {
      simResult = simulateHuntSegment({
        character: prevCheckpoint.snapshot.character,
        checkpoint: prevCheckpoint,
        durationMs: availableDurationMs,
        resourcesConfig: prevCheckpoint.snapshot.resources,
        config: huntFrozenConfig
      });
    } catch {
      return { ok: false, reason: 'CONFIG_MISMATCH' };
    }
    simulationMs += performance.now() - tSim0;

    // Phase 3: Short atomic PostgreSQL transaction with canonical lock order & version check
    if (input.faultInjection?.onBeforeLockAcquire) {
      await input.faultInjection.onBeforeLockAcquire();
    }

    const client = await pool.connect();
    const tTx0 = performance.now();
    try {
      await client.query('BEGIN');

      const tLock0 = performance.now();
      const lockedCharRes = await client.query<CharacterDbRow>(
        'SELECT * FROM characters WHERE id = $1 FOR UPDATE',
        [snapshotHuntRow.character_id]
      );
      const lockedHuntRes = await client.query<HuntDbRow>(
        'SELECT * FROM hunts WHERE id = $1 FOR UPDATE',
        [snapshotHuntRow.id]
      );
      lockWaitMs += performance.now() - tLock0;

      if (input.faultInjection?.onAfterLockAcquired) {
        await input.faultInjection.onAfterLockAcquired();
      }

      const lockedChar = lockedCharRes.rows[0];
      const lockedHunt = lockedHuntRes.rows[0];
      if (!lockedChar || !lockedHunt) {
        await client.query('ROLLBACK');
        transactionMs += performance.now() - tTx0;
        return { ok: false, reason: 'HUNT_NOT_FOUND' };
      }

      // Check if duplicate segmentKey committed while we were simulating
      const lockedPriorSegRes = await client.query<HuntSegmentDbRow>(
        `SELECT * FROM hunt_segments
         WHERE hunt_id = $1 AND segment_key = $2
         LIMIT 1`,
        [lockedHunt.id, segmentKey]
      );
      const lockedPriorSeg = lockedPriorSegRes.rows[0];
      if (lockedPriorSeg) {
        const lockedCp = parseAndValidateStoredCheckpoint(
          lockedHunt.private_checkpoint,
          lockedHunt.simulation_version,
          lockedHunt.config_digest
        );
        await client.query('ROLLBACK');
        transactionMs += performance.now() - tTx0;
        return {
          ok: true,
          status: lockedPriorSeg.is_partial ? 'PARTIAL_SETTLED' : 'SETTLED',
          idempotentReplay: true,
          hunt: mapPublicHuntView(lockedHunt, lockedCp),
          segmentId: lockedPriorSeg.id,
          segmentKey: lockedPriorSeg.segment_key,
          rewards: lockedPriorSeg.rewards,
          character: mapExtendedCharacterDto(lockedChar),
          telemetry: {
            simulationMs: Number(simulationMs.toFixed(3)),
            lockWaitMs: Number(lockWaitMs.toFixed(3)),
            transactionMs: Number(transactionMs.toFixed(3)),
            totalMs: Number((performance.now() - tTotalStart).toFixed(3)),
            retries
          }
        };
      }

      if (lockedHunt.status === 'COMPLETED') {
        const lockedCp = parseAndValidateStoredCheckpoint(
          lockedHunt.private_checkpoint,
          lockedHunt.simulation_version,
          lockedHunt.config_digest
        );
        await client.query('ROLLBACK');
        transactionMs += performance.now() - tTx0;
        return {
          ok: true,
          status: 'ALREADY_COMPLETED',
          idempotentReplay: false,
          hunt: mapPublicHuntView(lockedHunt, lockedCp),
          segmentId: null,
          segmentKey,
          rewards: createZeroRewardsSummary(Number(lockedChar.level), Number(lockedChar.hp)),
          character: mapExtendedCharacterDto(lockedChar),
          telemetry: {
            simulationMs: Number(simulationMs.toFixed(3)),
            lockWaitMs: Number(lockWaitMs.toFixed(3)),
            transactionMs: Number(transactionMs.toFixed(3)),
            totalMs: Number((performance.now() - tTotalStart).toFixed(3)),
            retries
          }
        };
      }

      // If a concurrent stopHunt latched stop_requested_at while we simulated past it, retry with the stop cutoff
      if (
        lockedHunt.stop_requested_at !== null &&
        lockedHunt.settled_until.getTime() + simResult.deltaElapsedMs >
          lockedHunt.stop_requested_at.getTime()
      ) {
        retries += 1;
        await client.query('ROLLBACK');
        transactionMs += performance.now() - tTx0;
        continue;
      }

      // Optimistic concurrency check: if another settlement advanced row_version,
      // check if any unsettled time remains; if 0ms remains, settle 0ms immediately, else retry outside lock.
      if (Number(lockedHunt.row_version) !== Number(snapshotHuntRow.row_version)) {
        retries += 1;
        const lockedTargetNowMs =
          lockedHunt.stop_requested_at !== null
            ? Math.min(clock.nowMs(), lockedHunt.stop_requested_at.getTime())
            : clock.nowMs();
        const remainingAfterConcurrentMs = Math.max(
          0,
          lockedTargetNowMs - lockedHunt.settled_until.getTime()
        );
        if (remainingAfterConcurrentMs > 0) {
          await client.query('ROLLBACK');
          transactionMs += performance.now() - tTx0;
          continue;
        }
        const concurrentCp = parseAndValidateStoredCheckpoint(
          lockedHunt.private_checkpoint,
          lockedHunt.simulation_version,
          lockedHunt.config_digest
        );
        const concurrentFrozenConfig = reconstructSimulationConfigFromSnapshot(
          concurrentCp.snapshot,
          { maxEventsPerCall: effectiveConfig.maxEventsPerCall }
        );
        simResult = simulateHuntSegment({
          character: concurrentCp.snapshot.character,
          checkpoint: concurrentCp,
          durationMs: 0,
          resourcesConfig: concurrentCp.snapshot.resources,
          config: concurrentFrozenConfig
        });
      }

      // Safe BIGINT / Number.MAX_SAFE_INTEGER economy bounds check
      const currentXpBig = parseSafeBigIntField(lockedChar.xp);
      const currentGoldBig = parseSafeBigIntField(lockedChar.gold);
      if (!isSafeEconomyBigInt(currentXpBig) || !isSafeEconomyBigInt(currentGoldBig)) {
        await client.query('ROLLBACK');
        transactionMs += performance.now() - tTx0;
        return { ok: false, reason: 'ECONOMY_OVERFLOW' };
      }

      const nextXpBig = currentXpBig + BigInt(simResult.deltaXpGained);
      const nextGoldBig = currentGoldBig + BigInt(simResult.deltaGoldGained);
      if (!isSafeEconomyBigInt(nextXpBig) || !isSafeEconomyBigInt(nextGoldBig)) {
        await client.query('ROLLBACK');
        transactionMs += performance.now() - tTx0;
        return { ok: false, reason: 'ECONOMY_OVERFLOW' };
      }

      const nextXp = Number(nextXpBig);
      const nextGold = Number(nextGoldBig);
      const levelBefore = Number(lockedChar.level);
      const resolvedLevel = resolveLevelFromTotalXp(nextXp);
      const levelAfter = Math.max(levelBefore, resolvedLevel);

      const levelVitals = calculateCharacterVitalsForLevel(lockedChar.vocation, levelAfter);
      const nextMaxHp = Math.max(Number(lockedChar.max_hp), levelVitals.maxHp);
      const nextMaxMp = Math.max(Number(lockedChar.max_mp), levelVitals.maxMp);

      const huntTerminated =
        simResult.checkpoint.terminated ||
        simResult.stopReason === 'CHARACTER_DIED' ||
        simResult.stopReason === 'OUT_OF_HP_POTIONS_CRITICAL' ||
        simResult.stopReason === 'MAX_OFFLINE_CAP_REACHED';

      const nextHuntStatus: HuntStatus = huntTerminated ? 'COMPLETED' : 'ACTIVE';
      const nextStopReason: PersistedHuntStopReason | null = huntTerminated
        ? simResult.stopReason
        : null;

      const segmentFromIso = lockedHunt.settled_until.toISOString();
      const newSettledUntilMs = lockedHunt.settled_until.getTime() + simResult.deltaElapsedMs;
      const segmentToIso = new Date(newSettledUntilMs).toISOString();
      const completedAtIso = huntTerminated ? segmentToIso : null;

      const unusedHpPotionsReturned = huntTerminated
        ? simResult.checkpoint.hpPotionsRemaining
        : 0;
      const unusedMpPotionsReturned = huntTerminated
        ? simResult.checkpoint.mpPotionsRemaining
        : 0;
      const nextPotionsReturned = huntTerminated;

      // Death & camp revival rule: combat checkpoint preserves HP = 0 and CHARACTER_DIED,
      // while character row restores full camp HP/MP to satisfy CHECK (hp > 0) and allow future hunts.
      const combatEndHp = simResult.checkpoint.currentHp;
      const diedInCombat = combatEndHp <= 0 || simResult.stopReason === 'CHARACTER_DIED';
      const revivedAtCamp = diedInCombat;
      const nextCharHp = diedInCombat
        ? nextMaxHp
        : Math.min(nextMaxHp, Math.max(1, combatEndHp));
      const nextCharMp = diedInCombat
        ? nextMaxMp
        : Math.min(nextMaxMp, Math.max(0, simResult.checkpoint.currentMp));
      const campHpRestoredTo = diedInCombat ? nextCharHp : null;

      const rewardsSummary: SettlementSegmentRewardsSummary = {
        deltaElapsedMs: simResult.deltaElapsedMs,
        unprocessedDurationMs: simResult.unprocessedDurationMs,
        isPartialSettlement: simResult.isPartialSettlement,
        deltaKills: simResult.deltaKills,
        deltaKillsByMonster: simResult.deltaKillsByMonster,
        deltaXpGained: simResult.deltaXpGained,
        deltaGoldGained: simResult.deltaGoldGained,
        deltaLootByItem: simResult.deltaLootByItem,
        deltaDamageDealt: simResult.deltaDamageDealt,
        deltaDamageTaken: simResult.deltaDamageTaken,
        deltaHpPotionsUsed: simResult.deltaHpPotionsUsed,
        deltaMpPotionsUsed: simResult.deltaMpPotionsUsed,
        simulatedEvents: simResult.simulatedEvents,
        levelBefore,
        levelAfter,
        combatEndHp,
        revivedAtCamp,
        campHpRestoredTo,
        unusedHpPotionsReturned,
        unusedMpPotionsReturned
      };

      const startCheckpointVersion = Number(lockedHunt.row_version);
      const endCheckpointVersion = startCheckpointVersion + 1;
      const serializedNextCheckpoint = serializeCombatCheckpoint(simResult.checkpoint);

      // 1. Persist new checkpoint and hunt state first
      const updatedHuntRes = await client.query<HuntDbRow>(
        `UPDATE hunts
         SET status = $2,
             stop_reason = $3,
             settled_until = $4::timestamptz,
             completed_at = $5::timestamptz,
             private_checkpoint = $6::jsonb,
             potions_returned = $7,
             row_version = $8
         WHERE id = $1 AND row_version = $9
         RETURNING *`,
        [
          lockedHunt.id,
          nextHuntStatus,
          nextStopReason,
          segmentToIso,
          completedAtIso,
          serializedNextCheckpoint,
          nextPotionsReturned,
          endCheckpointVersion,
          startCheckpointVersion
        ]
      );
      const updatedHunt = updatedHuntRes.rows[0];
      if (!updatedHunt) {
        throw new Error('Failed to advance hunt checkpoint version');
      }

      // 2. Persist unique settlement segment record
      const segmentId = randomUUID();
      const committedAtIso = clock.nowIso();
      await client.query(
        `INSERT INTO hunt_segments (
           id, hunt_id, segment_key, start_checkpoint_version, end_checkpoint_version,
           segment_from, segment_to, processed_duration_ms, simulated_events,
           stop_reason, is_partial, rewards, committed_at
         )
         VALUES (
           $1, $2, $3, $4, $5,
           $6::timestamptz, $7::timestamptz, $8, $9,
           $10, $11, $12::jsonb, $13::timestamptz
         )`,
        [
          segmentId,
          lockedHunt.id,
          segmentKey,
          startCheckpointVersion,
          endCheckpointVersion,
          segmentFromIso,
          segmentToIso,
          simResult.deltaElapsedMs,
          simResult.simulatedEvents,
          simResult.stopReason,
          simResult.isPartialSettlement,
          JSON.stringify(rewardsSummary),
          committedAtIso
        ]
      );

      if (input.faultInjection?.failAtStage === 'AFTER_CHECKPOINT_UPDATE_BEFORE_COMMIT') {
        throw new Error('FAULT_INJECTION: AFTER_CHECKPOINT_UPDATE_BEFORE_COMMIT');
      }

      // 3. Update character progression, vitals, gold, and returned unused potions
      const updatedCharRes = await client.query<CharacterDbRow>(
        `UPDATE characters
         SET level = $2,
             xp = $3,
             hp = $4,
             max_hp = $5,
             mp = $6,
             max_mp = $7,
             gold = $8,
             hp_potions = hp_potions + $9,
             mp_potions = mp_potions + $10,
             row_version = row_version + 1
         WHERE id = $1
         RETURNING *`,
        [
          lockedChar.id,
          levelAfter,
          nextXp,
          nextCharHp,
          nextMaxHp,
          nextCharMp,
          nextMaxMp,
          nextGold,
          unusedHpPotionsReturned,
          unusedMpPotionsReturned
        ]
      );
      const updatedChar = updatedCharRes.rows[0];
      if (!updatedChar) {
        throw new Error('Failed to update character row during settlement');
      }

      // 4. Record gold credit in currency_ledger
      if (simResult.deltaGoldGained > 0) {
        await client.query(
          `INSERT INTO currency_ledger (
             id, character_id, source_type, source_id, amount, balance_after, transaction_type, created_at
           )
           VALUES ($1, $2, 'HUNT_SETTLEMENT', $3, $4, $5, 'CREDIT', $6::timestamptz)`,
          [
            randomUUID(),
            lockedChar.id,
            segmentId,
            simResult.deltaGoldGained,
            nextGold,
            committedAtIso
          ]
        );
      }

      if (input.faultInjection?.failAtStage === 'AFTER_GOLD_LEDGER_BEFORE_COMMIT') {
        throw new Error('FAULT_INJECTION: AFTER_GOLD_LEDGER_BEFORE_COMMIT');
      }

      // 5. Persist dropped loot items in hunt_reward_items inbox
      const droppedEntries = Object.entries(simResult.deltaLootByItem).sort(([a], [b]) =>
        a.localeCompare(b)
      );
      for (const [itemId, quantity] of droppedEntries) {
        if (!VALID_CATALOG_ITEM_IDS.has(itemId)) {
          throw new Error(`Invalid loot item_id '${itemId}' not found in catalog`);
        }
        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
          throw new Error(`Invalid loot quantity '${quantity}' for item '${itemId}'`);
        }
        await client.query(
          `INSERT INTO hunt_reward_items (
             id, hunt_id, hunt_segment_id, character_id, item_id, quantity,
             ownership_state, claimed_at, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, 'UNCLAIMED', NULL, $7::timestamptz)`,
          [
            randomUUID(),
            lockedHunt.id,
            segmentId,
            lockedChar.id,
            itemId,
            quantity,
            committedAtIso
          ]
        );
      }

      if (input.faultInjection?.failAtStage === 'AFTER_REWARD_ITEMS_BEFORE_COMMIT') {
        throw new Error('FAULT_INJECTION: AFTER_REWARD_ITEMS_BEFORE_COMMIT');
      }

      await client.query('COMMIT');
      transactionMs += performance.now() - tTx0;

      if (input.faultInjection?.failAtStage === 'AFTER_COMMIT_BEFORE_RESPONSE') {
        throw new Error('FAULT_INJECTION: AFTER_COMMIT_BEFORE_RESPONSE');
      }

      return {
        ok: true,
        status: simResult.isPartialSettlement ? 'PARTIAL_SETTLED' : 'SETTLED',
        idempotentReplay: false,
        hunt: mapPublicHuntView(updatedHunt, simResult.checkpoint),
        segmentId,
        segmentKey,
        rewards: rewardsSummary,
        character: mapExtendedCharacterDto(updatedChar),
        telemetry: {
          simulationMs: Number(simulationMs.toFixed(3)),
          lockWaitMs: Number(lockWaitMs.toFixed(3)),
          transactionMs: Number(transactionMs.toFixed(3)),
          totalMs: Number((performance.now() - tTotalStart).toFixed(3)),
          retries
        }
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      transactionMs += performance.now() - tTx0;
      throw err;
    } finally {
      client.release();
    }
  }

  throw new Error(`Exceeded maximum settlement concurrency retries (${MAX_SETTLEMENT_RETRIES})`);
}

/**
 * Stops an active hunt transactionally and returns any unused reserved potions exactly once.
 * Establishes a single server-authoritative stop cutoff (`hunts.stop_requested_at`),
 * drains unsettled offline time in a bounded loop (`maxDrainSegments`), and NEVER finalizes
 * the hunt or returns potions while unsettled time up to the cutoff remains
 * (`STOP_CONTINUATION_REQUIRED`).
 */
export async function stopHunt(
  pool: pg.Pool,
  input: StopHuntInput
): Promise<StopHuntResult> {
  const stopKey =
    typeof input.stopIdempotencyKey === 'string' ? input.stopIdempotencyKey.trim() : '';
  if (stopKey.length < 1 || stopKey.length > 100) {
    return { ok: false, reason: 'INVALID_IDEMPOTENCY_KEY' };
  }

  const maxDrainSegments = input.maxDrainSegments ?? DEFAULT_MAX_STOP_DRAIN_SEGMENTS;
  if (
    !Number.isSafeInteger(maxDrainSegments) ||
    maxDrainSegments < 1 ||
    maxDrainSegments > 10_000
  ) {
    return { ok: false, reason: 'INVALID_IDEMPOTENCY_KEY' };
  }

  if (input.config !== undefined) {
    try {
      validateCombatConfig(input.config);
    } catch {
      return { ok: false, reason: 'CONFIG_MISMATCH' };
    }
    if (!isSupportedSimulationVersion(input.config.version)) {
      return { ok: false, reason: 'CONFIG_MISMATCH' };
    }
  }

  const clock = input.clock ?? createSystemClock();

  // Step 1: Inspect hunt and transactionally latch a single authoritative stop_requested_at cutoff
  let stopCutoffMs = 0;
  const initClient = await pool.connect();
  try {
    await initClient.query('BEGIN');

    const huntCheck = await initClient.query<HuntDbRow & { owner_user_id: string }>(
      `SELECT h.*, c.user_id AS owner_user_id
       FROM hunts h
       INNER JOIN characters c ON c.id = h.character_id
       WHERE h.id = $1
       LIMIT 1`,
      [input.huntId]
    );
    const initialHunt = huntCheck.rows[0];
    if (!initialHunt) {
      await initClient.query('ROLLBACK');
      return { ok: false, reason: 'HUNT_NOT_FOUND' };
    }
    if (
      (input.characterId !== undefined && initialHunt.character_id !== input.characterId) ||
      (input.userId !== undefined && initialHunt.owner_user_id !== input.userId)
    ) {
      await initClient.query('ROLLBACK');
      return { ok: false, reason: 'FORBIDDEN_HUNT' };
    }

    const lockedCharRes = await initClient.query<CharacterDbRow>(
      'SELECT * FROM characters WHERE id = $1 FOR UPDATE',
      [initialHunt.character_id]
    );
    const lockedHuntRes = await initClient.query<HuntDbRow>(
      'SELECT * FROM hunts WHERE id = $1 FOR UPDATE',
      [initialHunt.id]
    );
    const lockedChar = lockedCharRes.rows[0];
    const lockedHunt = lockedHuntRes.rows[0];
    if (!lockedChar || !lockedHunt) {
      await initClient.query('ROLLBACK');
      return { ok: false, reason: 'HUNT_NOT_FOUND' };
    }
    if (!isSupportedSimulationVersion(lockedHunt.simulation_version)) {
      await initClient.query('ROLLBACK');
      return { ok: false, reason: 'CONFIG_MISMATCH' };
    }

    let initialCheckpoint: CombatCheckpointState;
    try {
      initialCheckpoint = parseAndValidateStoredCheckpoint(
        lockedHunt.private_checkpoint,
        lockedHunt.simulation_version,
        lockedHunt.config_digest
      );
    } catch {
      await initClient.query('ROLLBACK');
      return { ok: false, reason: 'CORRUPTED_CHECKPOINT' };
    }

    if (lockedHunt.status === 'COMPLETED') {
      await initClient.query('ROLLBACK');
      return {
        ok: true,
        status: 'ALREADY_COMPLETED',
        alreadyCompleted: true,
        continuationRequired: false,
        unprocessedDurationMs: 0,
        segmentsSettled: 0,
        stopCutoffIso: (
          lockedHunt.stop_requested_at ??
          lockedHunt.completed_at ??
          lockedHunt.settled_until
        ).toISOString(),
        hunt: mapPublicHuntView(lockedHunt, initialCheckpoint),
        character: mapExtendedCharacterDto(lockedChar),
        unusedHpPotionsReturned: 0,
        unusedMpPotionsReturned: 0
      };
    }

    if (lockedHunt.stop_requested_at !== null) {
      stopCutoffMs = lockedHunt.stop_requested_at.getTime();
    } else {
      if (input.settleBeforeStop === false) {
        stopCutoffMs = lockedHunt.settled_until.getTime();
      } else {
        const remainingCapMs = Math.max(
          0,
          initialCheckpoint.snapshot.timings.maxOfflineDurationMs - initialCheckpoint.elapsedMs
        );
        const maxCapTimestampMs = lockedHunt.settled_until.getTime() + remainingCapMs;
        stopCutoffMs = Math.min(
          Math.max(lockedHunt.settled_until.getTime(), clock.nowMs()),
          maxCapTimestampMs
        );
      }
      await initClient.query(
        'UPDATE hunts SET stop_requested_at = $2::timestamptz WHERE id = $1',
        [lockedHunt.id, new Date(stopCutoffMs).toISOString()]
      );
    }

    await initClient.query('COMMIT');
  } catch (err) {
    await initClient.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    initClient.release();
  }

  // Step 2: Bounded drain loop up to the single authoritative stopCutoffMs
  let segmentsSettled = 0;
  let drainIterations = 0;
  const maxDrainIterations = maxDrainSegments * 4;
  let lastSettleResult: SettleHuntResult | null = null;

  while (
    input.settleBeforeStop !== false &&
    segmentsSettled < maxDrainSegments &&
    drainIterations < maxDrainIterations
  ) {
    drainIterations += 1;
    const stateRes = await pool.query<{
      status: HuntStatus;
      settled_until: Date;
      stop_requested_at: Date | null;
      row_version: number;
    }>(
      'SELECT status, settled_until, stop_requested_at, row_version FROM hunts WHERE id = $1 LIMIT 1',
      [input.huntId]
    );
    const currentHunt = stateRes.rows[0];
    if (!currentHunt) {
      return { ok: false, reason: 'HUNT_NOT_FOUND' };
    }
    if (currentHunt.status === 'COMPLETED') {
      break;
    }

    const effectiveCutoffMs = currentHunt.stop_requested_at
      ? currentHunt.stop_requested_at.getTime()
      : stopCutoffMs;
    const remainingToCutoffMs = Math.max(
      0,
      effectiveCutoffMs - currentHunt.settled_until.getTime()
    );
    if (remainingToCutoffMs === 0) {
      break;
    }

    const stepSegmentKey = `${stopKey}:v${currentHunt.row_version}`;
    const settleRes = await settleHunt(pool, {
      huntId: input.huntId,
      characterId: input.characterId,
      userId: input.userId,
      segmentKey: stepSegmentKey,
      clock,
      config: input.config
    });
    if (!settleRes.ok) {
      return {
        ok: false,
        reason:
          settleRes.reason === 'INVALID_SEGMENT_KEY'
            ? 'INVALID_IDEMPOTENCY_KEY'
            : settleRes.reason
      };
    }

    lastSettleResult = settleRes;
    if (settleRes.status === 'ALREADY_COMPLETED') {
      break;
    }
    if (!settleRes.idempotentReplay) {
      segmentsSettled += 1;
    }

    if (
      input.faultInjection?.failAfterDrainSegments !== undefined &&
      segmentsSettled >= input.faultInjection.failAfterDrainSegments
    ) {
      throw new Error('FAULT_INJECTION: STOP_AFTER_DRAIN_SEGMENT_COMMIT');
    }

    if (settleRes.hunt.status === 'COMPLETED') {
      break;
    }
    if (Date.parse(settleRes.hunt.settledUntilIso) >= effectiveCutoffMs) {
      break;
    }
  }

  // Step 3: Atomic finalization OR safe continuation return if unsettled time remains
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const huntCheck = await client.query<HuntDbRow & { owner_user_id: string }>(
      `SELECT h.*, c.user_id AS owner_user_id
       FROM hunts h
       INNER JOIN characters c ON c.id = h.character_id
       WHERE h.id = $1
       LIMIT 1`,
      [input.huntId]
    );
    const initialHunt = huntCheck.rows[0];
    if (!initialHunt) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'HUNT_NOT_FOUND' };
    }
    if (
      (input.characterId !== undefined && initialHunt.character_id !== input.characterId) ||
      (input.userId !== undefined && initialHunt.owner_user_id !== input.userId)
    ) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'FORBIDDEN_HUNT' };
    }

    // Lock character then hunt in canonical order
    const lockedCharRes = await client.query<CharacterDbRow>(
      'SELECT * FROM characters WHERE id = $1 FOR UPDATE',
      [initialHunt.character_id]
    );
    const lockedHuntRes = await client.query<HuntDbRow>(
      'SELECT * FROM hunts WHERE id = $1 FOR UPDATE',
      [initialHunt.id]
    );
    const lockedChar = lockedCharRes.rows[0];
    const lockedHunt = lockedHuntRes.rows[0];
    if (!lockedChar || !lockedHunt) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'HUNT_NOT_FOUND' };
    }

    let checkpoint: CombatCheckpointState;
    try {
      checkpoint = parseAndValidateStoredCheckpoint(
        lockedHunt.private_checkpoint,
        lockedHunt.simulation_version,
        lockedHunt.config_digest
      );
    } catch {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'CORRUPTED_CHECKPOINT' };
    }

    const effectiveCutoffMs = lockedHunt.stop_requested_at
      ? lockedHunt.stop_requested_at.getTime()
      : stopCutoffMs;

    if (lockedHunt.status === 'COMPLETED') {
      await client.query('ROLLBACK');
      const drainCompletedRewards =
        lastSettleResult !== null &&
        lastSettleResult.ok &&
        !lastSettleResult.idempotentReplay &&
        lastSettleResult.hunt.status === 'COMPLETED'
          ? lastSettleResult.rewards
          : null;
      return {
        ok: true,
        status: drainCompletedRewards !== null ? 'COMPLETED' : 'ALREADY_COMPLETED',
        alreadyCompleted: drainCompletedRewards === null,
        continuationRequired: false,
        unprocessedDurationMs: 0,
        segmentsSettled,
        stopCutoffIso: (lockedHunt.completed_at ?? new Date(effectiveCutoffMs)).toISOString(),
        hunt: mapPublicHuntView(lockedHunt, checkpoint),
        character: mapExtendedCharacterDto(lockedChar),
        unusedHpPotionsReturned:
          drainCompletedRewards !== null ? drainCompletedRewards.unusedHpPotionsReturned : 0,
        unusedMpPotionsReturned:
          drainCompletedRewards !== null ? drainCompletedRewards.unusedMpPotionsReturned : 0
      };
    }

    // P0 Safety Guard: NEVER finalize hunt or return potions if unsettled time up to cutoff remains
    const remainingUnsettledMs = Math.max(
      0,
      effectiveCutoffMs - lockedHunt.settled_until.getTime()
    );
    if (remainingUnsettledMs > 0) {
      await client.query('ROLLBACK');
      return {
        ok: true,
        status: 'STOP_CONTINUATION_REQUIRED',
        alreadyCompleted: false,
        continuationRequired: true,
        unprocessedDurationMs: remainingUnsettledMs,
        segmentsSettled,
        stopCutoffIso: new Date(effectiveCutoffMs).toISOString(),
        hunt: mapPublicHuntView(lockedHunt, checkpoint),
        character: mapExtendedCharacterDto(lockedChar),
        unusedHpPotionsReturned: 0,
        unusedMpPotionsReturned: 0
      };
    }

    const unusedHp = lockedHunt.potions_returned ? 0 : checkpoint.hpPotionsRemaining;
    const unusedMp = lockedHunt.potions_returned ? 0 : checkpoint.mpPotionsRemaining;

    const stoppedCheckpoint: CombatCheckpointState = {
      ...checkpoint,
      terminated: true,
      stopReason: 'MANUAL_STOP'
    };
    const serializedStoppedCheckpoint = serializeCombatCheckpoint(stoppedCheckpoint);
    const completedAtIso = new Date(effectiveCutoffMs).toISOString();

    const updatedHuntRes = await client.query<HuntDbRow>(
      `UPDATE hunts
       SET status = 'COMPLETED',
           stop_reason = 'MANUAL_STOP',
           completed_at = $2::timestamptz,
           private_checkpoint = $3::jsonb,
           potions_returned = TRUE,
           row_version = row_version + 1
       WHERE id = $1 AND status = 'ACTIVE'
       RETURNING *`,
      [lockedHunt.id, completedAtIso, serializedStoppedCheckpoint]
    );
    const updatedHunt = updatedHuntRes.rows[0];
    if (!updatedHunt) {
      throw new Error('Failed to mark hunt as COMPLETED on stopHunt');
    }

    const updatedCharRes = await client.query<CharacterDbRow>(
      `UPDATE characters
       SET hp_potions = hp_potions + $2,
           mp_potions = mp_potions + $3,
           row_version = row_version + 1
       WHERE id = $1
       RETURNING *`,
      [lockedChar.id, unusedHp, unusedMp]
    );
    const updatedChar = updatedCharRes.rows[0];
    if (!updatedChar) {
      throw new Error('Failed to return unused potions to character on stopHunt');
    }

    await client.query('COMMIT');
    return {
      ok: true,
      status: 'COMPLETED',
      alreadyCompleted: false,
      continuationRequired: false,
      unprocessedDurationMs: 0,
      segmentsSettled,
      stopCutoffIso: completedAtIso,
      hunt: mapPublicHuntView(updatedHunt, stoppedCheckpoint),
      character: mapExtendedCharacterDto(updatedChar),
      unusedHpPotionsReturned: unusedHp,
      unusedMpPotionsReturned: unusedMp
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reconciles a character's gold balance against `currency_ledger`,
 * unclaimed reward inbox items against `hunt_segments` loot deltas,
 * and XP/level progression against settled segments.
 */
export async function reconcileCharacterEconomy(
  pool: pg.Pool,
  characterId: string
): Promise<ReconcileCharacterEconomyReport> {
  const charRes = await pool.query<CharacterDbRow>(
    'SELECT * FROM characters WHERE id = $1 LIMIT 1',
    [characterId]
  );
  const charRow = charRes.rows[0];
  if (!charRow) {
    throw new Error(`Character '${characterId}' not found for reconciliation`);
  }

  const ledgerRes = await pool.query<{
    amount: string | number;
    balance_after: string | number;
  }>(
    `SELECT amount, balance_after
     FROM currency_ledger
     WHERE character_id = $1
     ORDER BY created_at ASC, balance_after ASC, id ASC`,
    [characterId]
  );

  let ledgerGoldSum = 0;
  let latestLedgerBalanceAfter = 0;
  for (const row of ledgerRes.rows) {
    ledgerGoldSum += Number(row.amount);
    latestLedgerBalanceAfter = Number(row.balance_after);
  }

  const unclaimedItemsRes = await pool.query<{ item_id: string; total_qty: string | number }>(
    `SELECT item_id, SUM(quantity) AS total_qty
     FROM hunt_reward_items
     WHERE character_id = $1 AND ownership_state = 'UNCLAIMED'
     GROUP BY item_id`,
    [characterId]
  );
  const totalUnclaimedItemsByCode: Record<string, number> = {};
  for (const row of unclaimedItemsRes.rows) {
    totalUnclaimedItemsByCode[row.item_id] = Number(row.total_qty);
  }

  const claimedItemsRes = await pool.query<{ item_id: string; total_qty: string | number }>(
    `SELECT item_id, SUM(quantity) AS total_qty
     FROM hunt_reward_items
     WHERE character_id = $1 AND ownership_state = 'CLAIMED'
     GROUP BY item_id`,
    [characterId]
  );
  const totalClaimedItemsByCode: Record<string, number> = {};
  for (const row of claimedItemsRes.rows) {
    totalClaimedItemsByCode[row.item_id] = Number(row.total_qty);
  }

  const movementClaimedRes = await pool.query<{ item_id: string; total_qty: string | number }>(
    `SELECT item_id, SUM(quantity) AS total_qty
     FROM inventory_movements
     WHERE character_id = $1 AND operation_type = 'CLAIM_HUNT_REWARD'
     GROUP BY item_id`,
    [characterId]
  );
  const totalMovementClaimedItemsByCode: Record<string, number> = {};
  for (const row of movementClaimedRes.rows) {
    totalMovementClaimedItemsByCode[row.item_id] = Number(row.total_qty);
  }

  const segmentsRes = await pool.query<{ rewards: SettlementSegmentRewardsSummary }>(
    `SELECT hs.rewards
     FROM hunt_segments hs
     INNER JOIN hunts h ON h.id = hs.hunt_id
     WHERE h.character_id = $1
     ORDER BY hs.committed_at ASC`,
    [characterId]
  );

  let totalSettledXp = 0;
  const totalSettledItemsByCode: Record<string, number> = {};
  for (const seg of segmentsRes.rows) {
    totalSettledXp += Number(seg.rewards.deltaXpGained ?? 0);
    for (const [itemId, qty] of Object.entries(seg.rewards.deltaLootByItem ?? {})) {
      if (qty > 0) {
        totalSettledItemsByCode[itemId] = (totalSettledItemsByCode[itemId] ?? 0) + qty;
      }
    }
  }

  const firstHuntRes = await pool.query<{ private_checkpoint: unknown }>(
    `SELECT private_checkpoint
     FROM hunts
     WHERE character_id = $1
     ORDER BY started_at ASC
     LIMIT 1`,
    [characterId]
  );
  let initialXp = 0;
  let initialLevel = 1;
  const firstHuntCpRaw = firstHuntRes.rows[0]?.private_checkpoint as
    | { snapshot?: { character?: { xp?: number; level?: number } } }
    | undefined;
  if (firstHuntCpRaw?.snapshot?.character) {
    initialXp = Number(firstHuntCpRaw.snapshot.character.xp ?? 0);
    initialLevel = Number(firstHuntCpRaw.snapshot.character.level ?? 1);
  }

  const characterGold = Number(charRow.gold);
  const characterXp = Number(charRow.xp);
  const characterLevel = Number(charRow.level);
  const expectedXp = initialXp + totalSettledXp;
  const expectedLevel = Math.max(initialLevel, resolveLevelFromTotalXp(expectedXp));

  const isGoldReconciled =
    characterGold === ledgerGoldSum &&
    (ledgerRes.rows.length === 0 ? characterGold === 0 : characterGold === latestLedgerBalanceAfter);

  const allItemCodes = new Set([
    ...Object.keys(totalUnclaimedItemsByCode),
    ...Object.keys(totalClaimedItemsByCode),
    ...Object.keys(totalSettledItemsByCode),
    ...Object.keys(totalMovementClaimedItemsByCode)
  ]);
  let isLootReconciled = true;
  for (const code of allItemCodes) {
    const unclaimed = totalUnclaimedItemsByCode[code] ?? 0;
    const claimed = totalClaimedItemsByCode[code] ?? 0;
    const settled = totalSettledItemsByCode[code] ?? 0;
    const movementClaimed = totalMovementClaimedItemsByCode[code] ?? 0;

    if (settled !== unclaimed + claimed) {
      isLootReconciled = false;
      break;
    }
    if (claimed !== movementClaimed) {
      isLootReconciled = false;
      break;
    }
  }

  const isXpLevelReconciled =
    characterXp === expectedXp && characterLevel === expectedLevel;

  return {
    characterId,
    characterGold,
    ledgerGoldSum,
    latestLedgerBalanceAfter,
    isGoldReconciled,
    totalUnclaimedItemsByCode,
    totalClaimedItemsByCode,
    totalMovementClaimedItemsByCode,
    totalSettledItemsByCode,
    isLootReconciled,
    totalSettledXp,
    characterXp,
    characterLevel,
    expectedLevel,
    isXpLevelReconciled
  };
}

export function mapActiveHuntDto(
  huntView: PublicHuntSessionView,
  nowMs: number,
  checkpoint?: CombatCheckpointState | null,
  maxOfflineMs: number = MAX_OFFLINE_DURATION_MS
): ActiveHuntDto {
  const settledDurationMs = huntView.checkpointView.elapsedMs;
  const effectiveNowMs = huntView.stopRequestedAtIso
    ? Math.min(nowMs, Date.parse(huntView.stopRequestedAtIso))
    : nowMs;
  const settledUntilMs = Date.parse(huntView.settledUntilIso);
  const rawUnsettledMs = Math.max(0, effectiveNowMs - settledUntilMs);
  const remainingCapMs = Math.max(0, maxOfflineMs - settledDurationMs);
  const unsettledDurationMs =
    huntView.status === 'COMPLETED' ? 0 : Math.min(rawUnsettledMs, remainingCapMs);
  const isContinuationRequired =
    huntView.stopRequestedAtIso !== null &&
    huntView.status === 'ACTIVE' &&
    unsettledDurationMs > 0;

  // Use frozen authoritative snapshot maxHp/maxMp rather than computing level solely from hunt XP
  const snapshotChar = checkpoint?.snapshot.character;
  const snapshotLevel = snapshotChar?.level ?? huntView.snapshotLevel ?? 1;
  const fallbackVitals = calculateCharacterVitalsForLevel('knight', snapshotLevel);
  const maxHp = snapshotChar?.maxHp ?? huntView.snapshotMaxHp ?? fallbackVitals.maxHp;
  const maxMp = snapshotChar?.maxMp ?? huntView.snapshotMaxMp ?? fallbackVitals.maxMp;
  const hp = Math.min(huntView.checkpointView.currentHp, maxHp);
  const mp = Math.min(huntView.checkpointView.currentMp, maxMp);

  return {
    huntId: huntView.huntId,
    characterId: huntView.characterId,
    zoneId: huntView.zoneId,
    strategy: huntView.strategy,
    status: huntView.status,
    startedAtIso: huntView.startedAtIso,
    settledUntilIso: huntView.settledUntilIso,
    stopRequestedAtIso: huntView.stopRequestedAtIso,
    completedAtIso: huntView.completedAtIso,
    serverTimeIso: new Date(nowMs).toISOString(),
    settledDurationMs,
    unsettledDurationMs,
    maxOfflineDurationMs: maxOfflineMs,
    hp,
    maxHp,
    mp,
    maxMp,
    reservedHpPotions: huntView.reservedHpPotions,
    reservedMpPotions: huntView.reservedMpPotions,
    hpPotionsRemaining: huntView.checkpointView.hpPotionsRemaining,
    mpPotionsRemaining: huntView.checkpointView.mpPotionsRemaining,
    hpPotionsUsed: huntView.checkpointView.hpPotionsUsed,
    mpPotionsUsed: huntView.checkpointView.mpPotionsUsed,
    totalKills: huntView.checkpointView.totalKills,
    totalXpGained: huntView.checkpointView.totalXpGained,
    totalGoldGained: huntView.checkpointView.totalGoldGained,
    totalLootByItem: huntView.checkpointView.totalLootByItem,
    stopReason: huntView.stopReason,
    isContinuationRequired
  };
}

export async function getActiveHuntForCharacter(
  pool: pg.Pool,
  characterId: string,
  userId?: string,
  nowMs: number = Date.now()
): Promise<{
  active: boolean;
  hunt: ActiveHuntDto | null;
  latestCompletedHuntId: string | null;
  serverTimeIso: string;
} | null> {
  const charRes = await pool.query<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM characters WHERE id = $1 LIMIT 1',
    [characterId]
  );
  const charRow = charRes.rows[0];
  if (!charRow) {
    return null;
  }
  if (userId !== undefined && charRow.user_id !== userId) {
    return null;
  }

  const activeRes = await pool.query<HuntDbRow>(
    `SELECT * FROM hunts
     WHERE character_id = $1 AND status = 'ACTIVE'
     LIMIT 1`,
    [characterId]
  );
  const activeRow = activeRes.rows[0];
  if (activeRow) {
    const cp = parseAndValidateStoredCheckpoint(
      activeRow.private_checkpoint,
      activeRow.simulation_version,
      activeRow.config_digest
    );
    const huntView = mapPublicHuntView(activeRow, cp);
    const activeDto = mapActiveHuntDto(huntView, nowMs, cp);
    return {
      active: true,
      hunt: activeDto,
      latestCompletedHuntId: null,
      serverTimeIso: new Date(nowMs).toISOString()
    };
  }

  const latestRes = await pool.query<{ id: string }>(
    `SELECT id FROM hunts
     WHERE character_id = $1 AND status = 'COMPLETED'
     ORDER BY completed_at DESC NULLS LAST, started_at DESC
     LIMIT 1`,
    [characterId]
  );
  const latestCompletedHuntId = latestRes.rows[0]?.id ?? null;

  return {
    active: false,
    hunt: null,
    latestCompletedHuntId,
    serverTimeIso: new Date(nowMs).toISOString()
  };
}

export async function getHuntByIdForUser(
  pool: pg.Pool,
  huntId: string,
  userId?: string
): Promise<PublicHuntSessionView | null> {
  const huntRes = await pool.query<HuntDbRow & { owner_user_id: string }>(
    `SELECT h.*, c.user_id AS owner_user_id
     FROM hunts h
     INNER JOIN characters c ON c.id = h.character_id
     WHERE h.id = $1
     LIMIT 1`,
    [huntId]
  );
  const huntRow = huntRes.rows[0];
  if (!huntRow) {
    return null;
  }
  if (userId !== undefined && huntRow.owner_user_id !== userId) {
    return null;
  }

  const cp = parseAndValidateStoredCheckpoint(
    huntRow.private_checkpoint,
    huntRow.simulation_version,
    huntRow.config_digest
  );
  return mapPublicHuntView(huntRow, cp);
}

export async function getHuntSegmentsWithSummary(
  pool: pg.Pool,
  huntId: string,
  userId: string | undefined,
  pagination: { page?: number; limit?: number } = {}
): Promise<{
  huntId: string;
  segments: readonly HuntSegmentDto[];
  pagination: { page: number; limit: number; totalSegments: number; totalPages: number };
  summary: HuntSummaryDto;
} | null> {
  const huntView = await getHuntByIdForUser(pool, huntId, userId);
  if (!huntView) {
    return null;
  }

  const page = Math.max(1, pagination.page ?? 1);
  const limit = Math.min(100, Math.max(1, pagination.limit ?? 20));
  const offset = (page - 1) * limit;

  const countRes = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM hunt_segments WHERE hunt_id = $1',
    [huntId]
  );
  const totalSegments = Number(countRes.rows[0]?.count ?? 0);
  const totalPages = Math.ceil(totalSegments / limit);

  const segmentsRes = await pool.query<HuntSegmentDbRow>(
    `SELECT * FROM hunt_segments
     WHERE hunt_id = $1
     ORDER BY start_checkpoint_version ASC
     LIMIT $2 OFFSET $3`,
    [huntId, limit, offset]
  );

  const segments: HuntSegmentDto[] = segmentsRes.rows.map((row) => ({
    id: row.id,
    huntId: row.hunt_id,
    segmentKey: row.segment_key,
    startCheckpointVersion: Number(row.start_checkpoint_version),
    endCheckpointVersion: Number(row.end_checkpoint_version),
    segmentFromIso: row.segment_from.toISOString(),
    segmentToIso: row.segment_to.toISOString(),
    processedDurationMs: Number(row.processed_duration_ms),
    simulatedEvents: Number(row.simulated_events),
    stopReason: row.stop_reason,
    isPartial: Boolean(row.is_partial),
    rewards: row.rewards,
    committedAtIso: row.committed_at.toISOString()
  }));

  // Read all segments' rewards to aggregate summary accurately
  const allSegmentsRes = await pool.query<{
    processed_duration_ms: number;
    rewards: SettlementSegmentRewardsSummary;
  }>(
    `SELECT processed_duration_ms, rewards
     FROM hunt_segments
     WHERE hunt_id = $1
     ORDER BY start_checkpoint_version ASC`,
    [huntId]
  );

  let totalDurationMs = 0;
  let totalKills = 0;
  const totalKillsByMonster: Record<string, number> = {};
  let totalXpGained = 0;
  let totalGoldGained = 0;
  const totalLootByItem: Record<string, number> = {};
  let totalDamageDealt = 0;
  let totalDamageTaken = 0;
  let totalHpPotionsUsed = 0;
  let totalMpPotionsUsed = 0;
  let unusedHpPotionsReturned = 0;
  let unusedMpPotionsReturned = 0;
  let levelBefore = 1;
  let levelAfter = 1;

  for (let i = 0; i < allSegmentsRes.rows.length; i += 1) {
    const row = allSegmentsRes.rows[i];
    if (!row) continue;
    totalDurationMs += Number(row.processed_duration_ms);
    const rew = row.rewards;
    if (i === 0) {
      levelBefore = rew.levelBefore;
    }
    levelAfter = rew.levelAfter;
    totalKills += Number(rew.deltaKills ?? 0);
    totalXpGained += Number(rew.deltaXpGained ?? 0);
    totalGoldGained += Number(rew.deltaGoldGained ?? 0);
    totalDamageDealt += Number(rew.deltaDamageDealt ?? 0);
    totalDamageTaken += Number(rew.deltaDamageTaken ?? 0);
    totalHpPotionsUsed += Number(rew.deltaHpPotionsUsed ?? 0);
    totalMpPotionsUsed += Number(rew.deltaMpPotionsUsed ?? 0);
    unusedHpPotionsReturned += Number(rew.unusedHpPotionsReturned ?? 0);
    unusedMpPotionsReturned += Number(rew.unusedMpPotionsReturned ?? 0);

    for (const [mId, cnt] of Object.entries(rew.deltaKillsByMonster ?? {})) {
      totalKillsByMonster[mId] = (totalKillsByMonster[mId] ?? 0) + cnt;
    }
    for (const [itemId, qty] of Object.entries(rew.deltaLootByItem ?? {})) {
      totalLootByItem[itemId] = (totalLootByItem[itemId] ?? 0) + qty;
    }
  }

  // If hunt was manually stopped without a terminating combat event, unused potions were returned during stopHunt
  if (huntView.potionsReturned && unusedHpPotionsReturned === 0 && unusedMpPotionsReturned === 0) {
    unusedHpPotionsReturned = huntView.checkpointView.hpPotionsRemaining;
    unusedMpPotionsReturned = huntView.checkpointView.mpPotionsRemaining;
  }

  const summary: HuntSummaryDto = {
    zoneId: huntView.zoneId,
    strategy: huntView.strategy,
    status: huntView.status,
    stopReason: huntView.stopReason,
    startedAtIso: huntView.startedAtIso,
    completedAtIso: huntView.completedAtIso,
    totalDurationMs,
    totalKills,
    totalKillsByMonster,
    totalXpGained,
    totalGoldGained,
    totalLootByItem,
    totalDamageDealt,
    totalDamageTaken,
    totalHpPotionsUsed,
    totalMpPotionsUsed,
    unusedHpPotionsReturned,
    unusedMpPotionsReturned,
    levelBefore,
    levelAfter
  };

  return {
    huntId,
    segments,
    pagination: {
      page,
      limit,
      totalSegments,
      totalPages
    },
    summary
  };
}

export async function getCharacterHuntRewardItems(
  pool: pg.Pool,
  characterId: string,
  userId?: string
): Promise<readonly CharacterHuntRewardItemDto[]> {
  const charRes = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM characters WHERE id = $1 LIMIT 1',
    [characterId]
  );
  const char = charRes.rows[0];
  if (!char) {
    return [];
  }
  if (userId !== undefined && char.user_id !== userId) {
    return [];
  }

  const res = await pool.query<{
    id: string;
    hunt_id: string;
    hunt_segment_id: string;
    character_id: string;
    item_id: string;
    quantity: number;
    ownership_state: string;
    claimed_at: Date | null;
    created_at: Date;
  }>(
    `SELECT
       id, hunt_id, hunt_segment_id, character_id, item_id,
       quantity, ownership_state, claimed_at, created_at
     FROM hunt_reward_items
     WHERE character_id = $1
     ORDER BY created_at DESC, id ASC`,
    [characterId]
  );

  return res.rows.map((row) => {
    const catalogItem = CATALOG_ITEMS_MAP.get(row.item_id);
    return {
      id: row.id,
      huntId: row.hunt_id,
      huntSegmentId: row.hunt_segment_id,
      itemId: row.item_id,
      nameKey: catalogItem?.nameKey ?? `item.${row.item_id}`,
      rarity: catalogItem?.rarity ?? 'common',
      quantity: Number(row.quantity),
      ownershipState: row.ownership_state as 'UNCLAIMED' | 'CLAIMED',
      claimedAtIso: row.claimed_at ? row.claimed_at.toISOString() : null,
      createdAtIso: row.created_at.toISOString()
    };
  });
}
