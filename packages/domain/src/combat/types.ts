import { type DangerTierDto, type ItemRarityDto, type VocationDto } from '@tibia-idle/contracts';

export const HUNT_STRATEGIES = ['safe', 'balanced', 'aggressive'] as const;
export type HuntStrategy = (typeof HUNT_STRATEGIES)[number];

export const HUNT_STOP_REASONS = [
  'TIME_REACHED',
  'EVENT_BUDGET_EXHAUSTED',
  'MAX_OFFLINE_CAP_REACHED',
  'CHARACTER_DIED',
  'OUT_OF_HP_POTIONS_CRITICAL',
  'ALREADY_TERMINATED'
] as const;
export type HuntStopReason = (typeof HUNT_STOP_REASONS)[number];

export interface RngCheckpointState {
  readonly seed: number;
  readonly state: number;
  readonly cursor: number;
}

export interface KnightEquipmentLoadout {
  readonly weaponAttack: number;
  readonly shieldDefense: number;
  readonly totalArmor: number;
  readonly critChancePermille: number;
  readonly critMultiplierPermille: number;
}

export interface CombatResourceLoadout {
  readonly hpPotions: number;
  readonly mpPotions: number;
  readonly hpPotionHealAmount: number;
  readonly mpPotionRestoreAmount: number;
  readonly hpPotionUnitCostGold: number;
  readonly mpPotionUnitCostGold: number;
}

export interface CombatCharacterSnapshot {
  readonly characterId: string;
  readonly vocation: VocationDto;
  readonly level: number;
  readonly xp: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number;
  readonly maxMp: number;
  readonly melee: number;
  readonly shielding: number;
  readonly magic: number;
  readonly equipment: KnightEquipmentLoadout;
}

export interface StrategyProfileConfig {
  readonly id: HuntStrategy;
  readonly attackFactorPermille: number;
  readonly defenseFactorPermille: number;
  readonly hpPotionThresholdPermille: number;
  readonly mpPotionThresholdPermille: number;
  readonly stopWhenOutOfHpPotionsBelowPermille: number;
  readonly useBrutalStrike: boolean;
  readonly brutalStrikeManaCost: number;
  readonly brutalStrikeBonusPermille: number;
}

export interface LootDropRuleConfig {
  readonly itemId: string;
  readonly rarity: ItemRarityDto;
  readonly chancePermille: number;
  readonly minQuantity: number;
  readonly maxQuantity: number;
  readonly npcValueGold: number;
}

export interface MonsterCombatConfig {
  readonly id: string;
  readonly zoneId: string;
  readonly minLevel: number;
  readonly dangerTier: DangerTierDto;
  readonly spawnWeight: number;
  readonly maxHp: number;
  readonly attack: number;
  readonly defense: number;
  readonly armor: number;
  readonly attackIntervalMs: number;
  readonly armorPenetrationPermille: number;
  readonly xpReward: number;
  readonly goldMin: number;
  readonly goldMax: number;
  readonly lootTable: readonly LootDropRuleConfig[];
}

export interface ZoneCombatConfig {
  readonly id: string;
  readonly minLevel: number;
  readonly searchCooldownMs: number;
  readonly monsterIds: readonly string[];
}

export interface CombatSimulationConfig {
  readonly version: string;
  readonly maxOfflineDurationMs: number;
  readonly maxEventsPerCall: number;
  readonly playerAttackIntervalMs: number;
  readonly passiveRegenIntervalMs: number;
  readonly passiveHpRegenAmount: number;
  readonly passiveMpRegenAmount: number;
  readonly strategies: Readonly<Record<HuntStrategy, StrategyProfileConfig>>;
  readonly zones: Readonly<Record<string, ZoneCombatConfig>>;
  readonly monsters: Readonly<Record<string, MonsterCombatConfig>>;
}

export interface HuntTimingRulesSnapshot {
  readonly maxOfflineDurationMs: number;
  readonly playerAttackIntervalMs: number;
  readonly passiveRegenIntervalMs: number;
  readonly passiveHpRegenAmount: number;
  readonly passiveMpRegenAmount: number;
}

/**
 * Immutable snapshot of all balance, character, equipment, resource, strategy, zone,
 * and monster parameters frozen when a hunt begins.
 * Any modification to these parameters requires stopping the current hunt and starting a new one.
 */
export interface HuntConfigurationSnapshot {
  readonly simulationVersion: string;
  readonly configDigest: string;
  readonly zoneId: string;
  readonly strategy: HuntStrategy;
  readonly timings: HuntTimingRulesSnapshot;
  readonly strategyProfile: StrategyProfileConfig;
  readonly zone: ZoneCombatConfig;
  readonly monsters: Readonly<Record<string, MonsterCombatConfig>>;
  readonly character: CombatCharacterSnapshot;
  readonly resources: CombatResourceLoadout;
}

export interface ActiveEncounterState {
  readonly encounterSeq: number;
  readonly monsterId: string;
  readonly monsterHp: number;
  readonly monsterMaxHp: number;
  readonly nextPlayerAttackInMs: number;
  readonly nextMonsterAttackInMs: number;
}

export interface CombatCheckpointState {
  readonly simulationVersion: string;
  readonly configDigest: string;
  readonly snapshot: HuntConfigurationSnapshot;
  readonly zoneId: string;
  readonly strategy: HuntStrategy;
  readonly elapsedMs: number;
  readonly currentHp: number;
  readonly currentMp: number;
  readonly hpPotionsRemaining: number;
  readonly mpPotionsRemaining: number;
  readonly nextPassiveRegenInMs: number;
  readonly respawnCooldownRemainingMs: number;
  readonly activeEncounter: ActiveEncounterState | null;
  readonly totalKills: number;
  readonly killsByMonster: Readonly<Record<string, number>>;
  readonly totalXpGained: number;
  readonly totalGoldGained: number;
  readonly totalLootByItem: Readonly<Record<string, number>>;
  readonly totalDamageDealt: number;
  readonly totalDamageTaken: number;
  readonly hpPotionsUsed: number;
  readonly mpPotionsUsed: number;
  readonly brutalStrikesCast: number;
  readonly terminated: boolean;
  readonly stopReason: HuntStopReason | null;
  readonly rng: RngCheckpointState;
}

/**
 * Safe public projection of a hunt checkpoint for API/UI consumption.
 * Explicitly excludes `rng` (`seed`, `state`, `cursor`) and raw internal snapshot
 * so clients can never inspect or predict upcoming RNG rolls or farm seeds.
 */
export type PublicHuntCheckpointView = Omit<CombatCheckpointState, 'rng' | 'snapshot'>;

export interface SimulateHuntSegmentInput {
  readonly character: CombatCharacterSnapshot;
  readonly checkpoint: CombatCheckpointState;
  readonly durationMs: number;
  readonly config?: CombatSimulationConfig | undefined;
}

export interface SimulateHuntSegmentResult {
  readonly checkpoint: CombatCheckpointState;
  readonly requestedDurationMs: number;
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
  readonly stopReason: HuntStopReason;
}

export interface ZoneAnalyticsSummary {
  readonly simulationVersion: string;
  readonly zoneId: string;
  readonly strategy: HuntStrategy;
  readonly simulatedDurationMs: number;
  readonly stopReason: HuntStopReason;
  readonly survivedFullWindow: boolean;
  readonly totalKills: number;
  readonly killsPerHour: number;
  readonly xpPerHour: number;
  readonly grossGoldPerHour: number;
  readonly lootValueGoldPerHour: number;
  readonly potionCostGoldPerHour: number;
  readonly netGoldPerHour: number;
  readonly hpPotionsPerHour: number;
  readonly mpPotionsPerHour: number;
}
