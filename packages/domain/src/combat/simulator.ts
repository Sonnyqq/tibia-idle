import {
  computeHuntSnapshotDigest,
   deepFreeze,
  DEFAULT_COMBAT_RESOURCES,
  DEFAULT_COMBAT_SIMULATION_CONFIG,
  DEFAULT_KNIGHT_EQUIPMENT,
  MAX_CHARACTER_LEVEL,
  MAX_CHARACTER_STAT,
  MAX_CHARACTER_VITAL,
  validateCombatConfig,
  validateCombatResources
} from './config.js';
import { resolveKnightAttack, resolveMonsterAttack } from './damage.js';
import { createEncounterState, selectZoneMonster } from './encounter.js';
import { rollMonsterKillLoot } from './loot.js';
import {
  createInitialRngState,
  createStatefulRng,
  validateRngCheckpointState
} from './rng.js';
import {
  type ActiveEncounterState,
  type CombatCharacterSnapshot,
  type CombatCheckpointState,
  type CombatResourceLoadout,
  type CombatSimulationConfig,
  HUNT_STOP_REASONS,
  type HuntConfigurationSnapshot,
  type HuntStopReason,
  type HuntStrategy,
  type MonsterCombatConfig,
  type SimulateHuntSegmentInput,
  type SimulateHuntSegmentResult,
  type ZoneAnalyticsSummary
} from './types.js';

export interface CreateInitialCheckpointInput {
  readonly character: CombatCharacterSnapshot;
  readonly zoneId: string;
  readonly strategy: HuntStrategy;
  readonly seed: number;
  readonly resources?: CombatResourceLoadout | undefined;
  readonly config?: CombatSimulationConfig | undefined;
}

export function validateCharacterSnapshot(character: CombatCharacterSnapshot): void {
  if (typeof character !== 'object' || character === null) {
    throw new RangeError('CombatCharacterSnapshot must be a non-null object');
  }
  if (typeof character.characterId !== 'string' || character.characterId.trim().length === 0) {
    throw new RangeError('CombatCharacterSnapshot.characterId must be a non-empty string');
  }
  if (character.vocation !== 'knight') {
    throw new RangeError(
      `Unsupported vocation '${character.vocation}' in IDLE-004A combat simulator; only 'knight' is enabled before P03`
    );
  }
  if (
    typeof character.equipment !== 'object' ||
    character.equipment === null ||
    !Number.isSafeInteger(character.level) ||
    character.level < 1 ||
    character.level > MAX_CHARACTER_LEVEL ||
    !Number.isSafeInteger(character.xp) ||
    character.xp < 0 ||
    !Number.isSafeInteger(character.maxHp) ||
    character.maxHp < 1 ||
    character.maxHp > MAX_CHARACTER_VITAL ||
    !Number.isSafeInteger(character.hp) ||
    character.hp < 0 ||
    character.hp > character.maxHp ||
    !Number.isSafeInteger(character.maxMp) ||
    character.maxMp < 0 ||
    character.maxMp > MAX_CHARACTER_VITAL ||
    !Number.isSafeInteger(character.mp) ||
    character.mp < 0 ||
    character.mp > character.maxMp ||
    !Number.isSafeInteger(character.melee) ||
    character.melee < 1 ||
    character.melee > MAX_CHARACTER_STAT ||
    !Number.isSafeInteger(character.shielding) ||
    character.shielding < 1 ||
    character.shielding > MAX_CHARACTER_STAT ||
    !Number.isSafeInteger(character.magic) ||
    character.magic < 0 ||
    character.magic > MAX_CHARACTER_STAT ||
    !Number.isSafeInteger(character.equipment.weaponAttack) ||
    character.equipment.weaponAttack < 1 ||
    character.equipment.weaponAttack > MAX_CHARACTER_STAT ||
    !Number.isSafeInteger(character.equipment.shieldDefense) ||
    character.equipment.shieldDefense < 0 ||
    character.equipment.shieldDefense > MAX_CHARACTER_STAT ||
    !Number.isSafeInteger(character.equipment.totalArmor) ||
    character.equipment.totalArmor < 0 ||
    character.equipment.totalArmor > MAX_CHARACTER_STAT ||
    !Number.isSafeInteger(character.equipment.critChancePermille) ||
    character.equipment.critChancePermille < 0 ||
    character.equipment.critChancePermille > 1000 ||
    !Number.isSafeInteger(character.equipment.critMultiplierPermille) ||
    character.equipment.critMultiplierPermille < 1000 ||
    character.equipment.critMultiplierPermille > 10_000
  ) {
    throw new RangeError('Invalid CombatCharacterSnapshot numeric bounds');
  }
}

/**
 * Builds an immutable, deeply-frozen snapshot of all parameters that govern a hunt.
 * Once a hunt starts, any change to character stats, equipment, strategy, zone,
 * resources/potions, or monster/combat balance requires starting a new hunt.
 */
export function createHuntConfigurationSnapshot(params: {
  readonly character: CombatCharacterSnapshot;
  readonly zoneId: string;
  readonly strategy: HuntStrategy;
  readonly resources?: CombatResourceLoadout | undefined;
  readonly config?: CombatSimulationConfig | undefined;
}): HuntConfigurationSnapshot {
  const config = params.config ?? DEFAULT_COMBAT_SIMULATION_CONFIG;
  validateCombatConfig(config);
  validateCharacterSnapshot(params.character);

  const resources = params.resources ?? DEFAULT_COMBAT_RESOURCES;
  validateCombatResources(resources);

  const zone = config.zones[params.zoneId];
  if (!zone) {
    throw new RangeError(`Unknown zone '${params.zoneId}'`);
  }
  const strategyProfile = config.strategies[params.strategy];
  if (!strategyProfile) {
    throw new RangeError(`Unknown strategy '${params.strategy}'`);
  }

  const zoneMonsters: Record<string, MonsterCombatConfig> = {};
  for (const monsterId of zone.monsterIds) {
    const monster = config.monsters[monsterId];
    if (!monster) {
      throw new RangeError(`Zone '${zone.id}' references unknown monster '${monsterId}'`);
    }
    zoneMonsters[monsterId] = {
      ...monster,
      lootTable: monster.lootTable.map((rule) => ({ ...rule }))
    };
  }

  const baseSnapshot: Omit<HuntConfigurationSnapshot, 'configDigest'> = {
    simulationVersion: config.version,
    zoneId: zone.id,
    strategy: strategyProfile.id,
    timings: {
      maxOfflineDurationMs: config.maxOfflineDurationMs,
      playerAttackIntervalMs: config.playerAttackIntervalMs,
      passiveRegenIntervalMs: config.passiveRegenIntervalMs,
      passiveHpRegenAmount: config.passiveHpRegenAmount,
      passiveMpRegenAmount: config.passiveMpRegenAmount
    },
    strategyProfile: { ...strategyProfile },
    zone: {
      ...zone,
      monsterIds: [...zone.monsterIds]
    },
    monsters: zoneMonsters,
    character: {
      ...params.character,
      equipment: { ...params.character.equipment }
    },
    resources: { ...resources }
  };

  const configDigest = computeHuntSnapshotDigest(baseSnapshot);
  return deepFreeze({
    ...baseSnapshot,
    configDigest
  });
}

export function validateCombatCheckpoint(checkpoint: CombatCheckpointState): void {
  if (typeof checkpoint !== 'object' || checkpoint === null) {
    throw new RangeError('CombatCheckpointState must be a non-null object');
  }
  if (typeof checkpoint.snapshot !== 'object' || checkpoint.snapshot === null) {
    throw new RangeError('CombatCheckpointState is missing immutable HuntConfigurationSnapshot');
  }

  const snap = checkpoint.snapshot;
  validateCharacterSnapshot(snap.character);
  validateCombatResources(snap.resources);

  const expectedDigest = computeHuntSnapshotDigest(snap);
  if (
    checkpoint.configDigest !== expectedDigest ||
    snap.configDigest !== expectedDigest ||
    checkpoint.simulationVersion !== snap.simulationVersion ||
    checkpoint.zoneId !== snap.zoneId ||
    checkpoint.strategy !== snap.strategy
  ) {
    throw new RangeError(
      'Checkpoint configuration digest or header mismatch (tampered or incompatible snapshot)'
    );
  }

  validateRngCheckpointState(checkpoint.rng);

  if (
    !Number.isSafeInteger(checkpoint.elapsedMs) ||
    checkpoint.elapsedMs < 0 ||
    checkpoint.elapsedMs > snap.timings.maxOfflineDurationMs ||
    !Number.isSafeInteger(checkpoint.currentHp) ||
    checkpoint.currentHp < 0 ||
    checkpoint.currentHp > snap.character.maxHp ||
    !Number.isSafeInteger(checkpoint.currentMp) ||
    checkpoint.currentMp < 0 ||
    checkpoint.currentMp > snap.character.maxMp ||
    !Number.isSafeInteger(checkpoint.hpPotionsRemaining) ||
    checkpoint.hpPotionsRemaining < 0 ||
    checkpoint.hpPotionsRemaining > snap.resources.hpPotions ||
    !Number.isSafeInteger(checkpoint.mpPotionsRemaining) ||
    checkpoint.mpPotionsRemaining < 0 ||
    checkpoint.mpPotionsRemaining > snap.resources.mpPotions ||
    !Number.isSafeInteger(checkpoint.hpPotionsUsed) ||
    checkpoint.hpPotionsUsed < 0 ||
    checkpoint.hpPotionsRemaining + checkpoint.hpPotionsUsed !== snap.resources.hpPotions ||
    !Number.isSafeInteger(checkpoint.mpPotionsUsed) ||
    checkpoint.mpPotionsUsed < 0 ||
    checkpoint.mpPotionsRemaining + checkpoint.mpPotionsUsed !== snap.resources.mpPotions ||
    !Number.isSafeInteger(checkpoint.nextPassiveRegenInMs) ||
    checkpoint.nextPassiveRegenInMs < 1 ||
    checkpoint.nextPassiveRegenInMs > snap.timings.passiveRegenIntervalMs ||
    !Number.isSafeInteger(checkpoint.respawnCooldownRemainingMs) ||
    checkpoint.respawnCooldownRemainingMs < 0 ||
    checkpoint.respawnCooldownRemainingMs > snap.zone.searchCooldownMs ||
    !Number.isSafeInteger(checkpoint.totalKills) ||
    checkpoint.totalKills < 0 ||
    !Number.isSafeInteger(checkpoint.totalXpGained) ||
    checkpoint.totalXpGained < 0 ||
    !Number.isSafeInteger(checkpoint.totalGoldGained) ||
    checkpoint.totalGoldGained < 0 ||
    !Number.isSafeInteger(checkpoint.totalDamageDealt) ||
    checkpoint.totalDamageDealt < 0 ||
    !Number.isSafeInteger(checkpoint.totalDamageTaken) ||
    checkpoint.totalDamageTaken < 0 ||
    !Number.isSafeInteger(checkpoint.brutalStrikesCast) ||
    checkpoint.brutalStrikesCast < 0 ||
    typeof checkpoint.terminated !== 'boolean' ||
    (checkpoint.stopReason !== null && !HUNT_STOP_REASONS.includes(checkpoint.stopReason))
  ) {
    throw new RangeError('Invalid numeric state or potion invariant in CombatCheckpointState');
  }

  if (checkpoint.activeEncounter !== null) {
    const enc = checkpoint.activeEncounter;
    const monster = snap.monsters[enc.monsterId];
    if (
      !monster ||
      !Number.isSafeInteger(enc.encounterSeq) ||
      enc.encounterSeq < 1 ||
      !Number.isSafeInteger(enc.monsterMaxHp) ||
      enc.monsterMaxHp !== monster.maxHp ||
      !Number.isSafeInteger(enc.monsterHp) ||
      enc.monsterHp < 1 ||
      enc.monsterHp > enc.monsterMaxHp ||
      !Number.isSafeInteger(enc.nextPlayerAttackInMs) ||
      enc.nextPlayerAttackInMs < 1 ||
      enc.nextPlayerAttackInMs > snap.timings.playerAttackIntervalMs ||
      !Number.isSafeInteger(enc.nextMonsterAttackInMs) ||
      enc.nextMonsterAttackInMs < 1 ||
      enc.nextMonsterAttackInMs > monster.attackIntervalMs
    ) {
      throw new RangeError('Invalid ActiveEncounterState in CombatCheckpointState');
    }
  }
}

export function serializeCombatCheckpoint(checkpoint: CombatCheckpointState): string {
  validateCombatCheckpoint(checkpoint);
  return JSON.stringify(checkpoint);
}

export function deserializeCombatCheckpoint(serialized: string): CombatCheckpointState {
  if (typeof serialized !== 'string' || serialized.trim().length === 0) {
    throw new RangeError('Serialized checkpoint must be a non-empty JSON string');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new RangeError('Failed to parse serialized CombatCheckpointState JSON');
  }
  const checkpoint = parsed as CombatCheckpointState;
  validateCombatCheckpoint(checkpoint);
  return deepFreeze(checkpoint);
}

export function createInitialCombatCheckpoint(
  input: CreateInitialCheckpointInput
): CombatCheckpointState {
  const config = input.config ?? DEFAULT_COMBAT_SIMULATION_CONFIG;
  const resources = input.resources ?? DEFAULT_COMBAT_RESOURCES;
  const snapshot = createHuntConfigurationSnapshot({
    character: input.character,
    zoneId: input.zoneId,
    strategy: input.strategy,
    resources,
    config
  });

  const initialHp = snapshot.character.hp;
  const terminated = initialHp <= 0;

  return deepFreeze({
    simulationVersion: snapshot.simulationVersion,
    configDigest: snapshot.configDigest,
    snapshot,
    zoneId: snapshot.zoneId,
    strategy: snapshot.strategy,
    elapsedMs: 0,
    currentHp: initialHp,
    currentMp: snapshot.character.mp,
    hpPotionsRemaining: snapshot.resources.hpPotions,
    mpPotionsRemaining: snapshot.resources.mpPotions,
    nextPassiveRegenInMs: snapshot.timings.passiveRegenIntervalMs,
    respawnCooldownRemainingMs: 0,
    activeEncounter: null,
    totalKills: 0,
    killsByMonster: {},
    totalXpGained: 0,
    totalGoldGained: 0,
    totalLootByItem: {},
    totalDamageDealt: 0,
    totalDamageTaken: 0,
    hpPotionsUsed: 0,
    mpPotionsUsed: 0,
    brutalStrikesCast: 0,
    terminated,
    stopReason: terminated ? 'CHARACTER_DIED' : null,
    rng: createInitialRngState(input.seed)
  });
}

/**
 * Advances an offline/idle hunt segment deterministically by `durationMs`.
 * Guarantees exact equivalence between single-pass, irregular time chunks,
 * and partial settlements interrupted by `maxEventsPerCall` (`EVENT_BUDGET_EXHAUSTED`).
 */
export function simulateHuntSegment(
  input: SimulateHuntSegmentInput & {
    readonly resourcesConfig?: CombatResourceLoadout | undefined;
  }
): SimulateHuntSegmentResult {
  const prev = input.checkpoint;
  validateCombatCheckpoint(prev);

  const config = input.config ?? DEFAULT_COMBAT_SIMULATION_CONFIG;
  validateCombatConfig(config);
  validateCharacterSnapshot(input.character);

  if (prev.simulationVersion !== config.version) {
    throw new RangeError(
      `Checkpoint version '${prev.simulationVersion}' does not match config version '${config.version}'`
    );
  }

  const resourcesConfig = input.resourcesConfig ?? prev.snapshot.resources;
  validateCombatResources(resourcesConfig);

  // Enforce mid-hunt configuration immutability: character, equipment, strategy, zone,
  // resources, and monster/balance rules cannot change after a hunt has started.
  const candidateSnapshot = createHuntConfigurationSnapshot({
    character: input.character,
    zoneId: prev.zoneId,
    strategy: prev.strategy,
    resources: resourcesConfig,
    config
  });
  if (candidateSnapshot.configDigest !== prev.configDigest) {
    throw new RangeError(
      'Hunt configuration mismatch: mid-hunt modification of character, equipment, resources, strategy, or combat balance is forbidden; start a new hunt instead'
    );
  }

  if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0) {
    throw new RangeError('durationMs must be a non-negative safe integer');
  }

  const snap = prev.snapshot;
  const zone = snap.zone;
  const strategy = snap.strategyProfile;

  if (prev.terminated) {
    return {
      checkpoint: prev,
      requestedDurationMs: input.durationMs,
      deltaElapsedMs: 0,
      unprocessedDurationMs: input.durationMs,
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
      stopReason: prev.stopReason ?? 'ALREADY_TERMINATED'
    };
  }

  const remainingCapMs = Math.max(0, snap.timings.maxOfflineDurationMs - prev.elapsedMs);
  const cappedByMaxOffline = input.durationMs > remainingCapMs;
  let remainingWindowMs = Math.min(input.durationMs, remainingCapMs);

  const rng = createStatefulRng(prev.rng);

  let elapsedMs = prev.elapsedMs;
  let currentHp = prev.currentHp;
  let currentMp = prev.currentMp;
  let hpPotionsRemaining = prev.hpPotionsRemaining;
  let mpPotionsRemaining = prev.mpPotionsRemaining;
  let nextPassiveRegenInMs = prev.nextPassiveRegenInMs;
  let respawnCooldownRemainingMs = prev.respawnCooldownRemainingMs;
  let activeEncounter: ActiveEncounterState | null = prev.activeEncounter
    ? { ...prev.activeEncounter }
    : null;

  let totalKills = prev.totalKills;
  const killsByMonster: Record<string, number> = { ...prev.killsByMonster };
  let totalXpGained = prev.totalXpGained;
  let totalGoldGained = prev.totalGoldGained;
  const totalLootByItem: Record<string, number> = { ...prev.totalLootByItem };
  let totalDamageDealt = prev.totalDamageDealt;
  let totalDamageTaken = prev.totalDamageTaken;
  let hpPotionsUsed = prev.hpPotionsUsed;
  let mpPotionsUsed = prev.mpPotionsUsed;
  let brutalStrikesCast = prev.brutalStrikesCast;
  let terminated: boolean = prev.terminated;
  let stopReason: HuntStopReason | null = prev.stopReason;

  const deltaKillsByMonster: Record<string, number> = {};
  const deltaLootByItem: Record<string, number> = {};
  let simulatedEvents = 0;
  let eventBudgetExhausted = false;

  let encounterCounter = activeEncounter ? activeEncounter.encounterSeq : totalKills;

  // O(1) closed-form potion consumption: prevents unbounded loops on large potion stacks
  const applyConsumablesAndRetreat = (): void => {
    if (terminated || currentHp <= 0) return;

    const maxHp = snap.character.maxHp;
    const hpThreshold = Math.floor((maxHp * strategy.hpPotionThresholdPermille) / 1000);
    if (currentHp <= hpThreshold && hpPotionsRemaining > 0 && currentHp < maxHp) {
      const healAmount = snap.resources.hpPotionHealAmount;
      const targetHp = Math.min(maxHp, hpThreshold + 1);
      const potionsNeeded = Math.ceil((targetHp - currentHp) / healAmount);
      const potionsToUse = Math.min(hpPotionsRemaining, Math.max(1, potionsNeeded));
      hpPotionsRemaining -= potionsToUse;
      hpPotionsUsed += potionsToUse;
      currentHp = Math.min(maxHp, currentHp + potionsToUse * healAmount);
    }

    const criticalRetreatHp = Math.floor(
      (maxHp * strategy.stopWhenOutOfHpPotionsBelowPermille) / 1000
    );
    if (hpPotionsRemaining === 0 && currentHp <= criticalRetreatHp && criticalRetreatHp > 0) {
      terminated = true;
      stopReason = 'OUT_OF_HP_POTIONS_CRITICAL';
      return;
    }

    const maxMp = snap.character.maxMp;
    const mpThreshold = Math.floor((maxMp * strategy.mpPotionThresholdPermille) / 1000);
    if (currentMp <= mpThreshold && mpPotionsRemaining > 0 && currentMp < maxMp) {
      const restoreAmount = snap.resources.mpPotionRestoreAmount;
      const targetMp = Math.min(maxMp, mpThreshold + 1);
      const potionsNeeded = Math.ceil((targetMp - currentMp) / restoreAmount);
      const potionsToUse = Math.min(mpPotionsRemaining, Math.max(1, potionsNeeded));
      mpPotionsRemaining -= potionsToUse;
      mpPotionsUsed += potionsToUse;
      currentMp = Math.min(maxMp, currentMp + potionsToUse * restoreAmount);
    }
  };

  const ensureEncounterSpawnedIfReady = (): void => {
    if (!terminated && activeEncounter === null && respawnCooldownRemainingMs === 0) {
      const monster = selectZoneMonster(zone, config, rng);
      encounterCounter += 1;
      activeEncounter = createEncounterState(
        encounterCounter,
        monster,
        snap.timings.playerAttackIntervalMs
      );
      simulatedEvents += 1;
    }
  };

  if (remainingWindowMs > 0) {
    applyConsumablesAndRetreat();
    ensureEncounterSpawnedIfReady();
  }

  while (remainingWindowMs > 0 && !terminated) {
    if (simulatedEvents >= config.maxEventsPerCall) {
      eventBudgetExhausted = true;
      break;
    }

    const nextEventInMs =
      activeEncounter !== null
        ? Math.min(
            nextPassiveRegenInMs,
            activeEncounter.nextPlayerAttackInMs,
            activeEncounter.nextMonsterAttackInMs
          )
        : Math.min(nextPassiveRegenInMs, respawnCooldownRemainingMs);

    const stepMs = Math.min(remainingWindowMs, Math.max(1, nextEventInMs));

    elapsedMs += stepMs;
    remainingWindowMs -= stepMs;
    nextPassiveRegenInMs -= stepMs;

    if (activeEncounter !== null) {
      activeEncounter = {
        ...activeEncounter,
        nextPlayerAttackInMs: activeEncounter.nextPlayerAttackInMs - stepMs,
        nextMonsterAttackInMs: activeEncounter.nextMonsterAttackInMs - stepMs
      };
    } else {
      respawnCooldownRemainingMs = Math.max(0, respawnCooldownRemainingMs - stepMs);
    }

    // If the requested window ended before the next scheduled discrete event, preserve exact timers
    if (
      nextPassiveRegenInMs > 0 &&
      (activeEncounter !== null
        ? activeEncounter.nextPlayerAttackInMs > 0 && activeEncounter.nextMonsterAttackInMs > 0
        : respawnCooldownRemainingMs > 0)
    ) {
      break;
    }

    // 1. Passive regeneration tick
    if (nextPassiveRegenInMs <= 0) {
      currentHp = Math.min(
        snap.character.maxHp,
        currentHp + snap.timings.passiveHpRegenAmount
      );
      currentMp = Math.min(
        snap.character.maxMp,
        currentMp + snap.timings.passiveMpRegenAmount
      );
      nextPassiveRegenInMs = snap.timings.passiveRegenIntervalMs;
      simulatedEvents += 1;
    }

    // 2. Respawn completion tick
    if (activeEncounter === null && respawnCooldownRemainingMs <= 0) {
      applyConsumablesAndRetreat();
      if (terminated) break;
      ensureEncounterSpawnedIfReady();
      continue;
    }

    // 3. Player attack tick
    if (activeEncounter !== null && activeEncounter.nextPlayerAttackInMs <= 0) {
      const monster = snap.monsters[activeEncounter.monsterId];
      if (!monster) {
        throw new Error(`Unknown monster '${activeEncounter.monsterId}' in active encounter`);
      }
      const attackRoll = resolveKnightAttack(
        snap.character,
        monster,
        strategy,
        currentMp,
        rng
      );

      currentMp = Math.max(0, currentMp - attackRoll.manaSpent);
      if (attackRoll.usedBrutalStrike) {
        brutalStrikesCast += 1;
      }

      const appliedDamage = Math.min(activeEncounter.monsterHp, attackRoll.damage);
      totalDamageDealt += appliedDamage;
      const newMonsterHp = activeEncounter.monsterHp - appliedDamage;
      simulatedEvents += 1;

      if (newMonsterHp <= 0) {
        // Monster defeated -> grant deterministic kill & roll loot exactly once
        totalKills += 1;
        killsByMonster[monster.id] = (killsByMonster[monster.id] ?? 0) + 1;
        deltaKillsByMonster[monster.id] = (deltaKillsByMonster[monster.id] ?? 0) + 1;

        const reward = rollMonsterKillLoot(monster, rng);
        totalXpGained += reward.xpGained;
        totalGoldGained += reward.goldGained;
        for (const [itemId, qty] of Object.entries(reward.itemsDropped)) {
          totalLootByItem[itemId] = (totalLootByItem[itemId] ?? 0) + qty;
          deltaLootByItem[itemId] = (deltaLootByItem[itemId] ?? 0) + qty;
        }

        activeEncounter = null;
        respawnCooldownRemainingMs = zone.searchCooldownMs;
        applyConsumablesAndRetreat();
        continue;
      } else {
        activeEncounter = {
          ...activeEncounter,
          monsterHp: newMonsterHp,
          nextPlayerAttackInMs: snap.timings.playerAttackIntervalMs
        };
      }
    }

    // 4. Monster attack tick (only if monster is still alive)
    if (activeEncounter !== null && activeEncounter.nextMonsterAttackInMs <= 0) {
      const monster = snap.monsters[activeEncounter.monsterId];
      if (!monster) {
        throw new Error(`Unknown monster '${activeEncounter.monsterId}' in active encounter`);
      }
      const incomingDamage = resolveMonsterAttack(
        monster,
        snap.character,
        strategy,
        rng
      );
      const appliedDamage = Math.min(currentHp, incomingDamage);
      currentHp = Math.max(0, currentHp - appliedDamage);
      totalDamageTaken += appliedDamage;
      simulatedEvents += 1;

      activeEncounter = {
        ...activeEncounter,
        nextMonsterAttackInMs: monster.attackIntervalMs
      };

      if (currentHp <= 0) {
        currentHp = 0;
        terminated = true;
        stopReason = 'CHARACTER_DIED';
        break;
      }
    }

    // 5. Post-exchange consumable & retreat check
    applyConsumablesAndRetreat();
  }

  let resolvedStopReason: HuntStopReason;
  if (terminated && stopReason) {
    resolvedStopReason = stopReason;
  } else if (eventBudgetExhausted) {
    resolvedStopReason = 'EVENT_BUDGET_EXHAUSTED';
  } else if (elapsedMs >= snap.timings.maxOfflineDurationMs || cappedByMaxOffline) {
    resolvedStopReason = 'MAX_OFFLINE_CAP_REACHED';
    if (elapsedMs >= snap.timings.maxOfflineDurationMs) {
      terminated = true;
      stopReason = 'MAX_OFFLINE_CAP_REACHED';
    }
  } else {
    resolvedStopReason = 'TIME_REACHED';
  }

  const deltaElapsedMs = elapsedMs - prev.elapsedMs;
  const unprocessedDurationMs = Math.max(0, input.durationMs - deltaElapsedMs);
  const isPartialSettlement = resolvedStopReason === 'EVENT_BUDGET_EXHAUSTED';

  const nextCheckpoint: CombatCheckpointState = deepFreeze({
    simulationVersion: snap.simulationVersion,
    configDigest: snap.configDigest,
    snapshot: snap,
    zoneId: prev.zoneId,
    strategy: prev.strategy,
    elapsedMs,
    currentHp,
    currentMp,
    hpPotionsRemaining,
    mpPotionsRemaining,
    nextPassiveRegenInMs,
    respawnCooldownRemainingMs,
    activeEncounter,
    totalKills,
    killsByMonster,
    totalXpGained,
    totalGoldGained,
    totalLootByItem,
    totalDamageDealt,
    totalDamageTaken,
    hpPotionsUsed,
    mpPotionsUsed,
    brutalStrikesCast,
    terminated,
    stopReason,
    rng: rng.getState()
  });

  return {
    checkpoint: nextCheckpoint,
    requestedDurationMs: input.durationMs,
    deltaElapsedMs,
    unprocessedDurationMs,
    isPartialSettlement,
    deltaKills: totalKills - prev.totalKills,
    deltaKillsByMonster,
    deltaXpGained: totalXpGained - prev.totalXpGained,
    deltaGoldGained: totalGoldGained - prev.totalGoldGained,
    deltaLootByItem,
    deltaDamageDealt: totalDamageDealt - prev.totalDamageDealt,
    deltaDamageTaken: totalDamageTaken - prev.totalDamageTaken,
    deltaHpPotionsUsed: hpPotionsUsed - prev.hpPotionsUsed,
    deltaMpPotionsUsed: mpPotionsUsed - prev.mpPotionsUsed,
    simulatedEvents,
    stopReason: resolvedStopReason
  };
}

/**
 * Computes analytical efficiency metrics (XP/h, Gold/h gross & net, Kills/h, Potions/h)
 * for a given character snapshot, zone, strategy, and sample window.
 */
export function analyzeZoneEfficiency(params: {
  readonly character: CombatCharacterSnapshot;
  readonly zoneId: string;
  readonly strategy: HuntStrategy;
  readonly seed?: number | undefined;
  readonly sampleDurationMs?: number | undefined;
  readonly resources?: CombatResourceLoadout | undefined;
  readonly config?: CombatSimulationConfig | undefined;
}): ZoneAnalyticsSummary {
  const config = params.config ?? DEFAULT_COMBAT_SIMULATION_CONFIG;
  const resources = params.resources ?? DEFAULT_COMBAT_RESOURCES;
  const sampleDurationMs = params.sampleDurationMs ?? 3_600_000; // Default 1 hour
  const seed = params.seed ?? 1337;

  const initialCheckpoint = createInitialCombatCheckpoint({
    character: params.character,
    zoneId: params.zoneId,
    strategy: params.strategy,
    seed,
    resources,
    config
  });

  const result = simulateHuntSegment({
    character: params.character,
    checkpoint: initialCheckpoint,
    durationMs: sampleDurationMs,
    resourcesConfig: resources,
    config
  });

  const finalState = result.checkpoint;
  const effectiveHours = Math.max(1 / 3600, finalState.elapsedMs / 3_600_000);

  // Compute NPC value of dropped items
  const itemNpcValueMap: Record<string, number> = {};
  for (const monster of Object.values(config.monsters)) {
    for (const drop of monster.lootTable) {
      itemNpcValueMap[drop.itemId] = drop.npcValueGold;
    }
  }

  let totalLootNpcGold = 0;
  for (const [itemId, count] of Object.entries(finalState.totalLootByItem)) {
    totalLootNpcGold += (itemNpcValueMap[itemId] ?? 0) * count;
  }

  const totalPotionCostGold =
    finalState.hpPotionsUsed * resources.hpPotionUnitCostGold +
    finalState.mpPotionsUsed * resources.mpPotionUnitCostGold;

  const grossGoldPerHour = Math.floor(finalState.totalGoldGained / effectiveHours);
  const lootValueGoldPerHour = Math.floor(totalLootNpcGold / effectiveHours);
  const potionCostGoldPerHour = Math.floor(totalPotionCostGold / effectiveHours);
  const netGoldPerHour = grossGoldPerHour + lootValueGoldPerHour - potionCostGoldPerHour;

  return {
    simulationVersion: config.version,
    zoneId: params.zoneId,
    strategy: params.strategy,
    simulatedDurationMs: finalState.elapsedMs,
    stopReason: result.stopReason,
    survivedFullWindow: !finalState.terminated && finalState.elapsedMs === sampleDurationMs,
    totalKills: finalState.totalKills,
    killsPerHour: Math.floor(finalState.totalKills / effectiveHours),
    xpPerHour: Math.floor(finalState.totalXpGained / effectiveHours),
    grossGoldPerHour,
    lootValueGoldPerHour,
    potionCostGoldPerHour,
    netGoldPerHour,
    hpPotionsPerHour: Math.floor(finalState.hpPotionsUsed / effectiveHours),
    mpPotionsPerHour: Math.floor(finalState.mpPotionsUsed / effectiveHours)
  };
}

export function createKnightCombatSnapshot(params: {
  readonly characterId?: string | undefined;
  readonly level: number;
  readonly melee: number;
  readonly shielding: number;
  readonly magic?: number | undefined;
  readonly hp?: number | undefined;
  readonly maxHp?: number | undefined;
  readonly mp?: number | undefined;
  readonly maxMp?: number | undefined;
  readonly equipment?: Partial<typeof DEFAULT_KNIGHT_EQUIPMENT> | undefined;
}): CombatCharacterSnapshot {
  const maxHp = params.maxHp ?? 170 + params.level * 15;
  const maxMp = params.maxMp ?? 35 + params.level * 5;
  return {
    characterId: params.characterId ?? '00000000-0000-0000-0000-000000000001',
    vocation: 'knight',
    level: params.level,
    xp: 0,
    hp: params.hp ?? maxHp,
    maxHp,
    mp: params.mp ?? maxMp,
    maxMp,
    melee: params.melee,
    shielding: params.shielding,
    magic: params.magic ?? 1,
    equipment: {
      ...DEFAULT_KNIGHT_EQUIPMENT,
      ...params.equipment
    }
  };
}
