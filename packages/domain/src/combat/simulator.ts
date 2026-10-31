import {
  DEFAULT_COMBAT_RESOURCES,
  DEFAULT_COMBAT_SIMULATION_CONFIG,
  DEFAULT_KNIGHT_EQUIPMENT,
  validateCombatConfig
} from './config.js';
import { resolveKnightAttack, resolveMonsterAttack } from './damage.js';
import { createEncounterState, selectZoneMonster } from './encounter.js';
import { rollMonsterKillLoot } from './loot.js';
import { createInitialRngState, createStatefulRng } from './rng.js';
import {
  type ActiveEncounterState,
  type CombatCharacterSnapshot,
  type CombatCheckpointState,
  type CombatResourceLoadout,
  type CombatSimulationConfig,
  type HuntStopReason,
  type HuntStrategy,
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
  if (character.vocation !== 'knight') {
    throw new RangeError(
      `Unsupported vocation '${character.vocation}' in IDLE-004A combat simulator; only 'knight' is enabled before P03`
    );
  }
  if (
    !Number.isSafeInteger(character.level) ||
    character.level < 1 ||
    !Number.isSafeInteger(character.maxHp) ||
    character.maxHp < 1 ||
    !Number.isSafeInteger(character.hp) ||
    character.hp < 0 ||
    character.hp > character.maxHp ||
    !Number.isSafeInteger(character.maxMp) ||
    character.maxMp < 0 ||
    !Number.isSafeInteger(character.mp) ||
    character.mp < 0 ||
    character.mp > character.maxMp ||
    !Number.isSafeInteger(character.melee) ||
    character.melee < 1 ||
    !Number.isSafeInteger(character.shielding) ||
    character.shielding < 1 ||
    !Number.isSafeInteger(character.equipment.weaponAttack) ||
    character.equipment.weaponAttack < 1 ||
    !Number.isSafeInteger(character.equipment.shieldDefense) ||
    character.equipment.shieldDefense < 0 ||
    !Number.isSafeInteger(character.equipment.totalArmor) ||
    character.equipment.totalArmor < 0
  ) {
    throw new RangeError('Invalid CombatCharacterSnapshot numeric bounds');
  }
}

export function createInitialCombatCheckpoint(
  input: CreateInitialCheckpointInput
): CombatCheckpointState {
  const config = input.config ?? DEFAULT_COMBAT_SIMULATION_CONFIG;
  validateCombatConfig(config);
  validateCharacterSnapshot(input.character);

  const zone = config.zones[input.zoneId];
  if (!zone) {
    throw new RangeError(`Unknown zone '${input.zoneId}'`);
  }
  const strategy = config.strategies[input.strategy];
  if (!strategy) {
    throw new RangeError(`Unknown strategy '${input.strategy}'`);
  }

  const resources = input.resources ?? DEFAULT_COMBAT_RESOURCES;
  if (
    !Number.isSafeInteger(resources.hpPotions) ||
    resources.hpPotions < 0 ||
    !Number.isSafeInteger(resources.mpPotions) ||
    resources.mpPotions < 0
  ) {
    throw new RangeError('Initial potion counts must be non-negative safe integers');
  }

  const initialHp = input.character.hp;
  const terminated = initialHp <= 0;

  return {
    simulationVersion: config.version,
    zoneId: zone.id,
    strategy: strategy.id,
    elapsedMs: 0,
    currentHp: initialHp,
    currentMp: input.character.mp,
    hpPotionsRemaining: resources.hpPotions,
    mpPotionsRemaining: resources.mpPotions,
    nextPassiveRegenInMs: config.passiveRegenIntervalMs,
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
  };
}

/**
 * Advances an offline/idle hunt segment deterministically by `durationMs`.
 * Guarantees exact equivalence between single-pass and multi-chunk execution.
 */
export function simulateHuntSegment(
  input: SimulateHuntSegmentInput & {
    readonly resourcesConfig?: CombatResourceLoadout | undefined;
  }
): SimulateHuntSegmentResult {
  const config = input.config ?? DEFAULT_COMBAT_SIMULATION_CONFIG;
  validateCombatConfig(config);
  validateCharacterSnapshot(input.character);

  const prev = input.checkpoint;
  if (prev.simulationVersion !== config.version) {
    throw new RangeError(
      `Checkpoint version '${prev.simulationVersion}' does not match config version '${config.version}'`
    );
  }

  const zone = config.zones[prev.zoneId];
  if (!zone) {
    throw new RangeError(`Unknown zone '${prev.zoneId}' in checkpoint`);
  }
  const strategy = config.strategies[prev.strategy];
  if (!strategy) {
    throw new RangeError(`Unknown strategy '${prev.strategy}' in checkpoint`);
  }

  if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0) {
    throw new RangeError('durationMs must be a non-negative safe integer');
  }

  const resourcesConfig = input.resourcesConfig ?? DEFAULT_COMBAT_RESOURCES;

  if (prev.terminated) {
    return {
      checkpoint: prev,
      deltaElapsedMs: 0,
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

  const remainingCapMs = Math.max(0, config.maxOfflineDurationMs - prev.elapsedMs);
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

  let encounterCounter = activeEncounter ? activeEncounter.encounterSeq : totalKills;

  const applyConsumablesAndRetreat = (): void => {
    if (terminated || currentHp <= 0) return;

    const hpThreshold = Math.floor(
      (input.character.maxHp * strategy.hpPotionThresholdPermille) / 1000
    );
    while (
      currentHp <= hpThreshold &&
      hpPotionsRemaining > 0 &&
      currentHp < input.character.maxHp
    ) {
      hpPotionsRemaining -= 1;
      hpPotionsUsed += 1;
      currentHp = Math.min(
        input.character.maxHp,
        currentHp + resourcesConfig.hpPotionHealAmount
      );
    }

    const criticalRetreatHp = Math.floor(
      (input.character.maxHp * strategy.stopWhenOutOfHpPotionsBelowPermille) / 1000
    );
    if (hpPotionsRemaining === 0 && currentHp <= criticalRetreatHp && criticalRetreatHp > 0) {
      terminated = true;
      stopReason = 'OUT_OF_HP_POTIONS_CRITICAL';
      return;
    }

    const mpThreshold = Math.floor(
      (input.character.maxMp * strategy.mpPotionThresholdPermille) / 1000
    );
    while (
      currentMp <= mpThreshold &&
      mpPotionsRemaining > 0 &&
      currentMp < input.character.maxMp
    ) {
      mpPotionsRemaining -= 1;
      mpPotionsUsed += 1;
      currentMp = Math.min(
        input.character.maxMp,
        currentMp + resourcesConfig.mpPotionRestoreAmount
      );
    }
  };

  const ensureEncounterSpawnedIfReady = (): void => {
    if (!terminated && activeEncounter === null && respawnCooldownRemainingMs === 0) {
      const monster = selectZoneMonster(zone, config, rng);
      encounterCounter += 1;
      activeEncounter = createEncounterState(
        encounterCounter,
        monster,
        config.playerAttackIntervalMs
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
      currentHp = Math.min(input.character.maxHp, currentHp + config.passiveHpRegenAmount);
      currentMp = Math.min(input.character.maxMp, currentMp + config.passiveMpRegenAmount);
      nextPassiveRegenInMs = config.passiveRegenIntervalMs;
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
      const monster = config.monsters[activeEncounter.monsterId];
      if (!monster) {
        throw new Error(`Unknown monster '${activeEncounter.monsterId}' in active encounter`);
      }
      const attackRoll = resolveKnightAttack(
        input.character,
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
          nextPlayerAttackInMs: config.playerAttackIntervalMs
        };
      }
    }

    // 4. Monster attack tick (only if monster is still alive)
    if (activeEncounter !== null && activeEncounter.nextMonsterAttackInMs <= 0) {
      const monster = config.monsters[activeEncounter.monsterId];
      if (!monster) {
        throw new Error(`Unknown monster '${activeEncounter.monsterId}' in active encounter`);
      }
      const incomingDamage = resolveMonsterAttack(
        monster,
        input.character,
        strategy,
        rng
      );
      const appliedDamage = Math.min(currentHp, incomingDamage);
      currentHp = Math.max(0, currentHp - appliedDamage);
      totalDamageTaken += appliedDamage;
      simulatedEvents += 1;

      if (currentHp <= 0) {
        currentHp = 0;
        terminated = true;
        stopReason = 'CHARACTER_DIED';
        break;
      }

      activeEncounter = {
        ...activeEncounter,
        nextMonsterAttackInMs: monster.attackIntervalMs
      };
    }

    // 5. Post-exchange consumable & retreat check
    applyConsumablesAndRetreat();
  }

  let resolvedStopReason: HuntStopReason;
  if (terminated && stopReason) {
    resolvedStopReason = stopReason;
  } else if (elapsedMs >= config.maxOfflineDurationMs || cappedByMaxOffline) {
    resolvedStopReason = 'MAX_OFFLINE_CAP_REACHED';
    if (elapsedMs >= config.maxOfflineDurationMs) {
      terminated = true;
      stopReason = 'MAX_OFFLINE_CAP_REACHED';
    }
  } else {
    resolvedStopReason = 'TIME_REACHED';
  }

  const nextCheckpoint: CombatCheckpointState = {
    simulationVersion: config.version,
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
  };

  return {
    checkpoint: nextCheckpoint,
    deltaElapsedMs: elapsedMs - prev.elapsedMs,
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
