import { INITIAL_ZONES_CATALOG } from '../index.js';
import {
  type CombatResourceLoadout,
  type CombatSimulationConfig,
  HUNT_STRATEGIES,
  type HuntConfigurationSnapshot,
  type KnightEquipmentLoadout,
  type MonsterCombatConfig,
  type StrategyProfileConfig,
  type ZoneCombatConfig
} from './types.js';

export const COMBAT_SIMULATION_VERSION = '1.0.0' as const;
export const SUPPORTED_SIMULATION_ENGINE_MAJOR = 1 as const;
export const MAX_OFFLINE_DURATION_MS = 86_400_000 as const; // 24 hours in ms
export const DEFAULT_MAX_EVENTS_PER_CALL = 500_000 as const;

/**
 * Checks whether a simulation version string belongs to the supported v1.x deterministic
 * combat simulation engine family (e.g. '1.0.0', '1.1.0', '1.2.0-balance.1').
 * Balance/config changes within 1.x execute against the hunt's frozen HuntConfigurationSnapshot,
 * whereas breaking 2.x+ algorithm changes require a dedicated versioned engine runner.
 */
export function isSupportedSimulationVersion(version: string): boolean {
  return typeof version === 'string' && /^1\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);
}

export const MAX_POTION_STACK_COUNT = 1_000_000 as const;
export const MIN_POTION_HEAL_AMOUNT = 1 as const;
export const MAX_POTION_HEAL_AMOUNT = 1_000_000 as const;
export const MAX_POTION_UNIT_COST_GOLD = 1_000_000 as const;
export const MAX_CHARACTER_LEVEL = 10_000 as const;
export const MAX_CHARACTER_STAT = 1_000_000 as const;
export const MAX_CHARACTER_VITAL = 10_000_000 as const;

export const DEFAULT_KNIGHT_EQUIPMENT: KnightEquipmentLoadout = {
  weaponAttack: 18,
  shieldDefense: 16,
  totalArmor: 10,
  critChancePermille: 50, // 5.0%
  critMultiplierPermille: 1250 // 1.25x
} as const;

export const DEFAULT_COMBAT_RESOURCES: CombatResourceLoadout = {
  hpPotions: 250,
  mpPotions: 150,
  hpPotionHealAmount: 95,
  mpPotionRestoreAmount: 55,
  hpPotionUnitCostGold: 22,
  mpPotionUnitCostGold: 25
} as const;

export const DEFAULT_STRATEGIES_CONFIG: Readonly<
  Record<(typeof HUNT_STRATEGIES)[number], StrategyProfileConfig>
> = {
  safe: {
    id: 'safe',
    attackFactorPermille: 850, // Cautious stance: 85% attack power
    defenseFactorPermille: 1280, // +28% shield/defense mitigation
    hpPotionThresholdPermille: 650, // Heal early at 65% HP
    mpPotionThresholdPermille: 450,
    stopWhenOutOfHpPotionsBelowPermille: 450, // Retreat early if out of HP potions below 45% HP
    useBrutalStrike: false,
    brutalStrikeManaCost: 20,
    brutalStrikeBonusPermille: 1300
  },
  balanced: {
    id: 'balanced',
    attackFactorPermille: 1000, // Standard stance: 100% attack power
    defenseFactorPermille: 1000, // Standard defense
    hpPotionThresholdPermille: 480, // Heal at 48% HP
    mpPotionThresholdPermille: 350,
    stopWhenOutOfHpPotionsBelowPermille: 250, // Retreat if out of HP potions below 25% HP
    useBrutalStrike: true,
    brutalStrikeManaCost: 20,
    brutalStrikeBonusPermille: 1250
  },
  aggressive: {
    id: 'aggressive',
    attackFactorPermille: 1220, // Reckless stance: +22% attack power
    defenseFactorPermille: 740, // -26% shield/defense mitigation
    hpPotionThresholdPermille: 300, // Heal late at 30% HP
    mpPotionThresholdPermille: 550, // Keep mana ready for offensive strikes
    stopWhenOutOfHpPotionsBelowPermille: 0, // Fight to the end even without potions
    useBrutalStrike: true,
    brutalStrikeManaCost: 18,
    brutalStrikeBonusPermille: 1420
  }
} as const;

export const DEFAULT_ZONES_COMBAT_CONFIG: Readonly<Record<string, ZoneCombatConfig>> = {
  'damp-catacombs': {
    id: 'damp-catacombs',
    minLevel: 1,
    searchCooldownMs: 3000,
    monsterIds: ['cellar-stalker', 'mire-carapace']
  },
  'sunken-crypts': {
    id: 'sunken-crypts',
    minLevel: 8,
    searchCooldownMs: 4000,
    monsterIds: ['bone-sentinel', 'crypt-wraith']
  },
  'ashwind-ridge': {
    id: 'ashwind-ridge',
    minLevel: 20,
    searchCooldownMs: 5000,
    monsterIds: ['ashwind-drake', 'ember-acolyte']
  }
} as const;

export const DEFAULT_MONSTERS_COMBAT_CONFIG: Readonly<Record<string, MonsterCombatConfig>> = {
  'cellar-stalker': {
    id: 'cellar-stalker',
    zoneId: 'damp-catacombs',
    minLevel: 1,
    dangerTier: 'low',
    spawnWeight: 65,
    maxHp: 52,
    attack: 13,
    defense: 5,
    armor: 3,
    attackIntervalMs: 2000,
    armorPenetrationPermille: 0,
    xpReward: 28,
    goldMin: 2,
    goldMax: 8,
    lootTable: [
      {
        itemId: 'copper-coin',
        rarity: 'common',
        chancePermille: 650,
        minQuantity: 1,
        maxQuantity: 4,
        npcValueGold: 2
      },
      {
        itemId: 'rat-pelt',
        rarity: 'common',
        chancePermille: 220,
        minQuantity: 1,
        maxQuantity: 2,
        npcValueGold: 9
      }
    ]
  },
  'mire-carapace': {
    id: 'mire-carapace',
    zoneId: 'damp-catacombs',
    minLevel: 3,
    dangerTier: 'low',
    spawnWeight: 35,
    maxHp: 90,
    attack: 19,
    defense: 11,
    armor: 7,
    attackIntervalMs: 2200,
    armorPenetrationPermille: 80,
    xpReward: 52,
    goldMin: 4,
    goldMax: 14,
    lootTable: [
      {
        itemId: 'chitin-plate',
        rarity: 'common',
        chancePermille: 260,
        minQuantity: 1,
        maxQuantity: 2,
        npcValueGold: 15
      },
      {
        itemId: 'glow-moss',
        rarity: 'uncommon',
        chancePermille: 95,
        minQuantity: 1,
        maxQuantity: 1,
        npcValueGold: 36
      }
    ]
  },
  'bone-sentinel': {
    id: 'bone-sentinel',
    zoneId: 'sunken-crypts',
    minLevel: 8,
    dangerTier: 'medium',
    spawnWeight: 60,
    maxHp: 190,
    attack: 34,
    defense: 18,
    armor: 12,
    attackIntervalMs: 2000,
    armorPenetrationPermille: 120,
    xpReward: 135,
    goldMin: 10,
    goldMax: 28,
    lootTable: [
      {
        itemId: 'ancient-bone',
        rarity: 'common',
        chancePermille: 310,
        minQuantity: 1,
        maxQuantity: 2,
        npcValueGold: 24
      },
      {
        itemId: 'rusted-blade',
        rarity: 'uncommon',
        chancePermille: 110,
        minQuantity: 1,
        maxQuantity: 1,
        npcValueGold: 68
      }
    ]
  },
  'crypt-wraith': {
    id: 'crypt-wraith',
    zoneId: 'sunken-crypts',
    minLevel: 14,
    dangerTier: 'medium',
    spawnWeight: 40,
    maxHp: 260,
    attack: 46,
    defense: 14,
    armor: 9,
    attackIntervalMs: 1800,
    armorPenetrationPermille: 300, // Spectral attacks bypass 30% armor
    xpReward: 230,
    goldMin: 16,
    goldMax: 44,
    lootTable: [
      {
        itemId: 'wraith-essence',
        rarity: 'uncommon',
        chancePermille: 160,
        minQuantity: 1,
        maxQuantity: 2,
        npcValueGold: 62
      },
      {
        itemId: 'silver-ring',
        rarity: 'rare',
        chancePermille: 35,
        minQuantity: 1,
        maxQuantity: 1,
        npcValueGold: 240
      }
    ]
  },
  'ashwind-drake': {
    id: 'ashwind-drake',
    zoneId: 'ashwind-ridge',
    minLevel: 22,
    dangerTier: 'high',
    spawnWeight: 55,
    maxHp: 520,
    attack: 74,
    defense: 28,
    armor: 20,
    attackIntervalMs: 2000,
    armorPenetrationPermille: 220,
    xpReward: 540,
    goldMin: 32,
    goldMax: 85,
    lootTable: [
      {
        itemId: 'drake-scale',
        rarity: 'uncommon',
        chancePermille: 185,
        minQuantity: 1,
        maxQuantity: 2,
        npcValueGold: 110
      },
      {
        itemId: 'ash-talon',
        rarity: 'rare',
        chancePermille: 45,
        minQuantity: 1,
        maxQuantity: 1,
        npcValueGold: 420
      }
    ]
  },
  'ember-acolyte': {
    id: 'ember-acolyte',
    zoneId: 'ashwind-ridge',
    minLevel: 26,
    dangerTier: 'high',
    spawnWeight: 45,
    maxHp: 440,
    attack: 86,
    defense: 20,
    armor: 14,
    attackIntervalMs: 1800,
    armorPenetrationPermille: 380,
    xpReward: 640,
    goldMin: 40,
    goldMax: 105,
    lootTable: [
      {
        itemId: 'ember-scroll',
        rarity: 'uncommon',
        chancePermille: 150,
        minQuantity: 1,
        maxQuantity: 1,
        npcValueGold: 145
      },
      {
        itemId: 'ritual-amulet',
        rarity: 'rare',
        chancePermille: 30,
        minQuantity: 1,
        maxQuantity: 1,
        npcValueGold: 560
      }
    ]
  }
} as const;

export const DEFAULT_COMBAT_SIMULATION_CONFIG: CombatSimulationConfig = {
  version: COMBAT_SIMULATION_VERSION,
  maxOfflineDurationMs: MAX_OFFLINE_DURATION_MS,
  maxEventsPerCall: DEFAULT_MAX_EVENTS_PER_CALL,
  playerAttackIntervalMs: 2000,
  passiveRegenIntervalMs: 6000,
  passiveHpRegenAmount: 4,
  passiveMpRegenAmount: 3,
  strategies: DEFAULT_STRATEGIES_CONFIG,
  zones: DEFAULT_ZONES_COMBAT_CONFIG,
  monsters: DEFAULT_MONSTERS_COMBAT_CONFIG
} as const;

export function validateCombatResources(resources: CombatResourceLoadout): void {
  if (typeof resources !== 'object' || resources === null) {
    throw new RangeError('CombatResourceLoadout must be a non-null object');
  }
  if (
    !Number.isSafeInteger(resources.hpPotions) ||
    resources.hpPotions < 0 ||
    resources.hpPotions > MAX_POTION_STACK_COUNT ||
    !Number.isSafeInteger(resources.mpPotions) ||
    resources.mpPotions < 0 ||
    resources.mpPotions > MAX_POTION_STACK_COUNT
  ) {
    throw new RangeError(
      `Potion counts must be safe integers in [0, ${MAX_POTION_STACK_COUNT}]`
    );
  }
  if (
    !Number.isSafeInteger(resources.hpPotionHealAmount) ||
    resources.hpPotionHealAmount < MIN_POTION_HEAL_AMOUNT ||
    resources.hpPotionHealAmount > MAX_POTION_HEAL_AMOUNT ||
    !Number.isSafeInteger(resources.mpPotionRestoreAmount) ||
    resources.mpPotionRestoreAmount < MIN_POTION_HEAL_AMOUNT ||
    resources.mpPotionRestoreAmount > MAX_POTION_HEAL_AMOUNT
  ) {
    throw new RangeError(
      `Potion heal/restore amounts must be safe integers in [${MIN_POTION_HEAL_AMOUNT}, ${MAX_POTION_HEAL_AMOUNT}]`
    );
  }
  if (
    !Number.isSafeInteger(resources.hpPotionUnitCostGold) ||
    resources.hpPotionUnitCostGold < 0 ||
    resources.hpPotionUnitCostGold > MAX_POTION_UNIT_COST_GOLD ||
    !Number.isSafeInteger(resources.mpPotionUnitCostGold) ||
    resources.mpPotionUnitCostGold < 0 ||
    resources.mpPotionUnitCostGold > MAX_POTION_UNIT_COST_GOLD ||
    !Number.isSafeInteger(
      resources.hpPotions * resources.hpPotionUnitCostGold +
        resources.mpPotions * resources.mpPotionUnitCostGold
    )
  ) {
    throw new RangeError(
      `Potion unit costs must be safe integers in [0, ${MAX_POTION_UNIT_COST_GOLD}] without total cost overflow`
    );
  }
}

export function validateCombatConfig(config: CombatSimulationConfig): void {
  if (!config || !config.version || typeof config.version !== 'string') {
    throw new RangeError('CombatSimulationConfig.version must be a non-empty string');
  }
  if (
    !Number.isSafeInteger(config.maxOfflineDurationMs) ||
    config.maxOfflineDurationMs <= 0 ||
    config.maxOfflineDurationMs > MAX_OFFLINE_DURATION_MS * 7 ||
    !Number.isSafeInteger(config.maxEventsPerCall) ||
    config.maxEventsPerCall <= 0 ||
    !Number.isSafeInteger(config.playerAttackIntervalMs) ||
    config.playerAttackIntervalMs < 200 ||
    !Number.isSafeInteger(config.passiveRegenIntervalMs) ||
    config.passiveRegenIntervalMs < 500 ||
    !Number.isSafeInteger(config.passiveHpRegenAmount) ||
    config.passiveHpRegenAmount < 0 ||
    config.passiveHpRegenAmount > MAX_CHARACTER_VITAL ||
    !Number.isSafeInteger(config.passiveMpRegenAmount) ||
    config.passiveMpRegenAmount < 0 ||
    config.passiveMpRegenAmount > MAX_CHARACTER_VITAL
  ) {
    throw new RangeError('Invalid simulation timing or regeneration bounds in CombatSimulationConfig');
  }

  for (const strategyId of HUNT_STRATEGIES) {
    const strat = config.strategies[strategyId];
    if (
      !strat ||
      strat.id !== strategyId ||
      typeof strat.useBrutalStrike !== 'boolean' ||
      !Number.isSafeInteger(strat.attackFactorPermille) ||
      strat.attackFactorPermille <= 0 ||
      strat.attackFactorPermille > 10_000 ||
      !Number.isSafeInteger(strat.defenseFactorPermille) ||
      strat.defenseFactorPermille <= 0 ||
      strat.defenseFactorPermille > 10_000 ||
      !Number.isSafeInteger(strat.hpPotionThresholdPermille) ||
      strat.hpPotionThresholdPermille < 0 ||
      strat.hpPotionThresholdPermille > 1000 ||
      !Number.isSafeInteger(strat.mpPotionThresholdPermille) ||
      strat.mpPotionThresholdPermille < 0 ||
      strat.mpPotionThresholdPermille > 1000 ||
      !Number.isSafeInteger(strat.stopWhenOutOfHpPotionsBelowPermille) ||
      strat.stopWhenOutOfHpPotionsBelowPermille < 0 ||
      strat.stopWhenOutOfHpPotionsBelowPermille > 1000 ||
      !Number.isSafeInteger(strat.brutalStrikeManaCost) ||
      strat.brutalStrikeManaCost < 0 ||
      strat.brutalStrikeManaCost > MAX_CHARACTER_VITAL ||
      !Number.isSafeInteger(strat.brutalStrikeBonusPermille) ||
      strat.brutalStrikeBonusPermille < 1000 ||
      strat.brutalStrikeBonusPermille > 10_000
    ) {
      throw new RangeError(`Invalid strategy configuration for '${strategyId}'`);
    }
  }

  const zonesList = Object.values(config.zones);
  if (zonesList.length === 0) {
    throw new RangeError('CombatSimulationConfig must define at least one zone');
  }

  for (const zone of zonesList) {
    if (
      !zone.id ||
      !Number.isSafeInteger(zone.minLevel) ||
      zone.minLevel < 1 ||
      !Number.isSafeInteger(zone.searchCooldownMs) ||
      zone.searchCooldownMs < 100 ||
      zone.monsterIds.length === 0
    ) {
      throw new RangeError(`Invalid zone combat configuration for '${zone.id}'`);
    }
    let weightSum = 0;
    for (const monsterId of zone.monsterIds) {
      const monster = config.monsters[monsterId];
      if (!monster) {
        throw new RangeError(`Zone '${zone.id}' references unknown monster '${monsterId}'`);
      }
      if (
        !Number.isSafeInteger(monster.maxHp) ||
        monster.maxHp <= 0 ||
        !Number.isSafeInteger(monster.attack) ||
        monster.attack < 0 ||
        !Number.isSafeInteger(monster.defense) ||
        monster.defense < 0 ||
        !Number.isSafeInteger(monster.armor) ||
        monster.armor < 0 ||
        !Number.isSafeInteger(monster.attackIntervalMs) ||
        monster.attackIntervalMs < 200 ||
        !Number.isSafeInteger(monster.armorPenetrationPermille) ||
        monster.armorPenetrationPermille < 0 ||
        monster.armorPenetrationPermille > 1000 ||
        !Number.isSafeInteger(monster.xpReward) ||
        monster.xpReward < 0 ||
        !Number.isSafeInteger(monster.goldMin) ||
        !Number.isSafeInteger(monster.goldMax) ||
        monster.goldMin < 0 ||
        monster.goldMax < monster.goldMin ||
        !Number.isSafeInteger(monster.spawnWeight) ||
        monster.spawnWeight <= 0
      ) {
        throw new RangeError(`Invalid monster combat stats for '${monster.id}'`);
      }
      weightSum += monster.spawnWeight;
      for (const drop of monster.lootTable) {
        if (
          !drop.itemId ||
          !Number.isSafeInteger(drop.chancePermille) ||
          drop.chancePermille < 0 ||
          drop.chancePermille > 1000 ||
          !Number.isSafeInteger(drop.minQuantity) ||
          !Number.isSafeInteger(drop.maxQuantity) ||
          drop.minQuantity <= 0 ||
          drop.maxQuantity < drop.minQuantity ||
          !Number.isSafeInteger(drop.npcValueGold) ||
          drop.npcValueGold < 0
        ) {
          throw new RangeError(
            `Invalid loot drop rule '${drop.itemId}' on monster '${monster.id}'`
          );
        }
      }
    }
    if (weightSum <= 0) {
      throw new RangeError(`Zone '${zone.id}' must have positive total monster spawnWeight`);
    }
  }
}

/**
 * Deterministic 64-bit (dual 32-bit FNV-1a) fingerprint over canonical JSON.
 * Environment-independent (works identically across Node.js, V8, and browsers).
 */
export function computeDeterministicDigest(canonicalPayload: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonicalPayload.length; i += 1) {
    const code = canonicalPayload.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= code ^ ((i & 0xff) + 1);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `v1:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function canonicalizeJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  const record = value as Record<string, unknown>;
  const sortedKeys = Object.keys(record).sort();
  const normalized: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    normalized[key] = canonicalizeJsonValue(record[key]);
  }
  return normalized;
}

export function canonicalizeHuntSnapshotPayload(
  snapshot: Omit<HuntConfigurationSnapshot, 'configDigest'>
): string {
  return JSON.stringify(
    canonicalizeJsonValue({
      simulationVersion: snapshot.simulationVersion,
      zoneId: snapshot.zoneId,
      strategy: snapshot.strategy,
      timings: snapshot.timings,
      strategyProfile: snapshot.strategyProfile,
      zone: snapshot.zone,
      monsters: snapshot.monsters,
      character: snapshot.character,
      resources: snapshot.resources
    })
  );
}

export function computeHuntSnapshotDigest(
  snapshot: Omit<HuntConfigurationSnapshot, 'configDigest'>
): string {
  const canonical = canonicalizeHuntSnapshotPayload(snapshot);
  return computeDeterministicDigest(canonical);
}

/**
 * Full structural equality check over canonicalized HuntConfigurationSnapshot payloads.
 * Guarantees that configuration integrity checks never rely solely on the 64-bit FNV-1a digest.
 */
export function areHuntSnapshotsStructurallyEqual(
  a: Omit<HuntConfigurationSnapshot, 'configDigest'>,
  b: Omit<HuntConfigurationSnapshot, 'configDigest'>
): boolean {
  return canonicalizeHuntSnapshotPayload(a) === canonicalizeHuntSnapshotPayload(b);
}

/**
 * Reconstructs an immutable CombatSimulationConfig from a hunt's frozen HuntConfigurationSnapshot
 * so that hunts started under an older 1.x balance configuration continue settling with their
 * exact original balance parameters after a server config rollover, while respecting runtime
 * execution budgets (`maxEventsPerCall`).
 */
export function reconstructSimulationConfigFromSnapshot(
  snapshot: HuntConfigurationSnapshot,
  options?: { readonly maxEventsPerCall?: number | undefined }
): CombatSimulationConfig {
  if (!isSupportedSimulationVersion(snapshot.simulationVersion)) {
    throw new RangeError(
      `Unsupported simulation engine version '${snapshot.simulationVersion}' in hunt snapshot`
    );
  }
  const reconstructed: CombatSimulationConfig = {
    version: snapshot.simulationVersion,
    maxOfflineDurationMs: snapshot.timings.maxOfflineDurationMs,
    maxEventsPerCall: options?.maxEventsPerCall ?? DEFAULT_MAX_EVENTS_PER_CALL,
    playerAttackIntervalMs: snapshot.timings.playerAttackIntervalMs,
    passiveRegenIntervalMs: snapshot.timings.passiveRegenIntervalMs,
    passiveHpRegenAmount: snapshot.timings.passiveHpRegenAmount,
    passiveMpRegenAmount: snapshot.timings.passiveMpRegenAmount,
    strategies: {
      ...DEFAULT_STRATEGIES_CONFIG,
      [snapshot.strategy]: snapshot.strategyProfile
    },
    zones: {
      [snapshot.zoneId]: snapshot.zone
    },
    monsters: snapshot.monsters
  };
  validateCombatConfig(reconstructed);
  return deepFreeze(reconstructed);
}

export function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const prop of Object.values(value as Record<string, unknown>)) {
      if (prop !== null && typeof prop === 'object') {
        deepFreeze(prop);
      }
    }
  }
  return value;
}

export function assertCatalogAlignmentWithCombatConfig(
  config: CombatSimulationConfig = DEFAULT_COMBAT_SIMULATION_CONFIG
): void {
  for (const catalogZone of INITIAL_ZONES_CATALOG) {
    const combatZone = config.zones[catalogZone.id];
    if (!combatZone) {
      throw new Error(`Missing combat zone config for catalog zone '${catalogZone.id}'`);
    }
    for (const catalogCreature of catalogZone.creatures) {
      const combatMonster = config.monsters[catalogCreature.id];
      if (!combatMonster) {
        throw new Error(`Missing combat monster config for creature '${catalogCreature.id}'`);
      }
      const lootIds = new Set(combatMonster.lootTable.map((d) => d.itemId));
      for (const previewItem of catalogCreature.lootPreview) {
        if (!lootIds.has(previewItem.id)) {
          throw new Error(
            `Missing loot drop rule for catalog item '${previewItem.id}' on '${catalogCreature.id}'`
          );
        }
      }
    }
  }
}
