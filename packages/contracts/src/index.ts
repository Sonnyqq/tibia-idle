import { SUPPORTED_LOCALES } from '@tibia-idle/i18n';
import { z } from 'zod';

export const CONTRACT_VERSION = '0.4.0' as const;

export const LocaleSchema = z.enum(SUPPORTED_LOCALES);
export type LocaleDto = z.infer<typeof LocaleSchema>;

export const VOCATIONS = ['knight', 'paladin', 'sorcerer', 'druid'] as const;
export const VocationSchema = z.enum(VOCATIONS);
export type VocationDto = z.infer<typeof VocationSchema>;

export const EQUIPMENT_SLOTS = [
  'helmet',
  'amulet',
  'weapon',
  'armor',
  'shield',
  'ring',
  'legs',
  'boots',
  'ammunition'
] as const;
export const EquipmentSlotSchema = z.enum(EQUIPMENT_SLOTS);
export type EquipmentSlotDto = z.infer<typeof EquipmentSlotSchema>;
export type EquipmentSlot = EquipmentSlotDto;

export const AssetCategorySchema = z.enum([
  'vocation',
  'zone',
  'creature',
  'item',
  'slot',
  'ui'
]);
export type AssetCategoryDto = z.infer<typeof AssetCategorySchema>;

export const AssetRefDtoSchema = z.object({
  assetId: z.string().min(1),
  category: AssetCategorySchema,
  fallbackIconKey: z.string().min(1)
});
export type AssetRefDto = z.infer<typeof AssetRefDtoSchema>;

export const ItemRaritySchema = z.enum(['common', 'uncommon', 'rare']);
export type ItemRarityDto = z.infer<typeof ItemRaritySchema>;

export const DangerTierSchema = z.enum(['low', 'medium', 'high']);
export type DangerTierDto = z.infer<typeof DangerTierSchema>;

export const LootPreviewItemDtoSchema = z.object({
  id: z.string().min(1),
  nameKey: z.string().min(1),
  rarity: ItemRaritySchema,
  asset: AssetRefDtoSchema
});
export type LootPreviewItemDto = z.infer<typeof LootPreviewItemDtoSchema>;

export const CreatureCatalogDtoSchema = z.object({
  id: z.string().min(1),
  nameKey: z.string().min(1),
  minLevel: z.number().int().min(1),
  dangerTier: DangerTierSchema,
  asset: AssetRefDtoSchema,
  lootPreview: z.array(LootPreviewItemDtoSchema)
});
export type CreatureCatalogDto = z.infer<typeof CreatureCatalogDtoSchema>;

export const ZoneCatalogDtoSchema = z.object({
  id: z.string().min(1),
  nameKey: z.string().min(1),
  enemyTypesKey: z.string().min(1),
  minLevel: z.number().int().min(1),
  recommendedLevelRange: z.string().min(1),
  expPerHourEstimate: z.number().nullable(),
  goldPerHourEstimate: z.number().nullable(),
  asset: AssetRefDtoSchema,
  creatures: z.array(CreatureCatalogDtoSchema)
});
export type ZoneCatalogDto = z.infer<typeof ZoneCatalogDtoSchema>;

export const ZonesCatalogResponseSchema = z.object({
  zones: z.array(ZoneCatalogDtoSchema),
  simulationEnabled: z.boolean()
});
export type ZonesCatalogResponseDto = z.infer<typeof ZonesCatalogResponseSchema>;

export const EmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((val) => val.toLowerCase());

export const PasswordSchema = z.string().min(8).max(128);

export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  locale: LocaleSchema.optional()
});
export type RegisterRequestDto = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema
});
export type LoginRequestDto = z.infer<typeof LoginRequestSchema>;

export const UpdateLocaleRequestSchema = z.object({
  locale: LocaleSchema
});
export type UpdateLocaleRequestDto = z.infer<typeof UpdateLocaleRequestSchema>;

export const CharacterNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/);

export const CreateCharacterRequestSchema = z.object({
  name: CharacterNameSchema,
  vocation: VocationSchema
});
export type CreateCharacterRequestDto = z.infer<typeof CreateCharacterRequestSchema>;

export const UserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  locale: LocaleSchema,
  createdAt: z.string().datetime()
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export const CharacterStatsDtoSchema = z.object({
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  hp: z.number().int().min(1),
  maxHp: z.number().int().min(1),
  mp: z.number().int().min(0),
  maxMp: z.number().int().min(0),
  gold: z.number().int().min(0),
  melee: z.number().int().min(1),
  distance: z.number().int().min(1),
  magic: z.number().int().min(0),
  shielding: z.number().int().min(1)
});
export type CharacterStatsDto = z.infer<typeof CharacterStatsDtoSchema>;

export const CharacterDtoSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  slotNumber: z.number().int().min(1).max(3),
  name: z.string().min(3).max(20),
  vocation: VocationSchema,
  stats: CharacterStatsDtoSchema,
  hpPotions: z.number().int().min(0).default(250),
  mpPotions: z.number().int().min(0).default(150),
  createdAt: z.string().datetime()
});
export type CharacterDto = z.infer<typeof CharacterDtoSchema>;

export const HuntStrategySchema = z.enum(['safe', 'balanced', 'aggressive']);
export type HuntStrategyDto = z.infer<typeof HuntStrategySchema>;

export const HuntStatusSchema = z.enum(['ACTIVE', 'COMPLETED']);
export type HuntStatusDto = z.infer<typeof HuntStatusSchema>;

export const PersistedHuntStopReasonSchema = z.enum([
  'TIME_REACHED',
  'EVENT_BUDGET_EXHAUSTED',
  'MAX_OFFLINE_CAP_REACHED',
  'CHARACTER_DIED',
  'OUT_OF_HP_POTIONS_CRITICAL',
  'MANUAL_STOP',
  'ALREADY_TERMINATED'
]);
export type PersistedHuntStopReasonDto = z.infer<typeof PersistedHuntStopReasonSchema>;

export const ActiveEncounterDtoSchema = z.object({
  encounterSeq: z.number().int().min(1),
  monsterId: z.string().min(1),
  monsterHp: z.number().int().min(0),
  monsterMaxHp: z.number().int().min(1),
  nextPlayerAttackInMs: z.number().int().min(0),
  nextMonsterAttackInMs: z.number().int().min(0)
});
export type ActiveEncounterDto = z.infer<typeof ActiveEncounterDtoSchema>;

export const PublicHuntCheckpointViewSchema = z.object({
  simulationVersion: z.string().min(1),
  configDigest: z.string().min(1),
  zoneId: z.string().min(1),
  strategy: HuntStrategySchema,
  elapsedMs: z.number().int().min(0),
  currentHp: z.number().int().min(0),
  currentMp: z.number().int().min(0),
  hpPotionsRemaining: z.number().int().min(0),
  mpPotionsRemaining: z.number().int().min(0),
  nextPassiveRegenInMs: z.number().int().min(0),
  respawnCooldownRemainingMs: z.number().int().min(0),
  activeEncounter: ActiveEncounterDtoSchema.nullable(),
  totalKills: z.number().int().min(0),
  killsByMonster: z.record(z.string(), z.number().int().min(0)),
  totalXpGained: z.number().int().min(0),
  totalGoldGained: z.number().int().min(0),
  totalLootByItem: z.record(z.string(), z.number().int().min(0)),
  totalDamageDealt: z.number().int().min(0),
  totalDamageTaken: z.number().int().min(0),
  hpPotionsUsed: z.number().int().min(0),
  mpPotionsUsed: z.number().int().min(0),
  brutalStrikesCast: z.number().int().min(0),
  terminated: z.boolean(),
  stopReason: PersistedHuntStopReasonSchema.nullable()
});
export type PublicHuntCheckpointViewDto = z.infer<typeof PublicHuntCheckpointViewSchema>;

export const PublicHuntSessionViewSchema = z.object({
  huntId: z.string().uuid(),
  characterId: z.string().uuid(),
  zoneId: z.string().min(1),
  strategy: HuntStrategySchema,
  status: HuntStatusSchema,
  stopReason: PersistedHuntStopReasonSchema.nullable(),
  startedAtIso: z.string().datetime(),
  settledUntilIso: z.string().datetime(),
  stopRequestedAtIso: z.string().datetime().nullable(),
  completedAtIso: z.string().datetime().nullable(),
  simulationVersion: z.string().min(1),
  configDigest: z.string().min(1),
  reservedHpPotions: z.number().int().min(0),
  reservedMpPotions: z.number().int().min(0),
  potionsReturned: z.boolean(),
  rowVersion: z.number().int().min(1),
  snapshotMaxHp: z.number().int().min(1).optional(),
  snapshotMaxMp: z.number().int().min(0).optional(),
  snapshotLevel: z.number().int().min(1).optional(),
  checkpointView: PublicHuntCheckpointViewSchema
});
export type PublicHuntSessionViewDto = z.infer<typeof PublicHuntSessionViewSchema>;

export const SettlementSegmentRewardsSummarySchema = z.object({
  deltaElapsedMs: z.number().int().min(0),
  unprocessedDurationMs: z.number().int().min(0),
  isPartialSettlement: z.boolean(),
  deltaKills: z.number().int().min(0),
  deltaKillsByMonster: z.record(z.string(), z.number().int().min(0)),
  deltaXpGained: z.number().int().min(0),
  deltaGoldGained: z.number().int().min(0),
  deltaLootByItem: z.record(z.string(), z.number().int().min(0)),
  deltaDamageDealt: z.number().int().min(0),
  deltaDamageTaken: z.number().int().min(0),
  deltaHpPotionsUsed: z.number().int().min(0),
  deltaMpPotionsUsed: z.number().int().min(0),
  simulatedEvents: z.number().int().min(0),
  levelBefore: z.number().int().min(1),
  levelAfter: z.number().int().min(1),
  combatEndHp: z.number().int().min(0),
  revivedAtCamp: z.boolean(),
  campHpRestoredTo: z.number().int().nullable(),
  unusedHpPotionsReturned: z.number().int().min(0),
  unusedMpPotionsReturned: z.number().int().min(0)
});
export type SettlementSegmentRewardsSummaryDto = z.infer<
  typeof SettlementSegmentRewardsSummarySchema
>;

export const StartHuntRequestSchema = z
  .object({
    characterId: z.string().uuid(),
    zoneId: z.string().trim().min(1).max(64),
    strategy: HuntStrategySchema,
    hpPotions: z.number().int().min(0).max(1_000_000).default(0),
    mpPotions: z.number().int().min(0).max(1_000_000).default(0),
    idempotencyKey: z.string().trim().min(1).max(128)
  })
  .strict();
export type StartHuntRequestDto = z.infer<typeof StartHuntRequestSchema>;

export const StartHuntResponseSchema = z.object({
  ok: z.literal(true),
  hunt: PublicHuntSessionViewSchema,
  character: CharacterDtoSchema,
  idempotentReplay: z.boolean(),
  serverTimeIso: z.string().datetime()
});
export type StartHuntResponseDto = z.infer<typeof StartHuntResponseSchema>;

export const ActiveHuntDtoSchema = z.object({
  huntId: z.string().uuid(),
  characterId: z.string().uuid(),
  zoneId: z.string().min(1),
  strategy: HuntStrategySchema,
  status: HuntStatusSchema,
  startedAtIso: z.string().datetime(),
  settledUntilIso: z.string().datetime(),
  stopRequestedAtIso: z.string().datetime().nullable(),
  completedAtIso: z.string().datetime().nullable(),
  serverTimeIso: z.string().datetime(),
  settledDurationMs: z.number().int().min(0),
  unsettledDurationMs: z.number().int().min(0),
  maxOfflineDurationMs: z.number().int().min(0),
  hp: z.number().int().min(0),
  maxHp: z.number().int().min(1),
  mp: z.number().int().min(0),
  maxMp: z.number().int().min(0),
  reservedHpPotions: z.number().int().min(0),
  reservedMpPotions: z.number().int().min(0),
  hpPotionsRemaining: z.number().int().min(0),
  mpPotionsRemaining: z.number().int().min(0),
  hpPotionsUsed: z.number().int().min(0),
  mpPotionsUsed: z.number().int().min(0),
  totalKills: z.number().int().min(0),
  totalXpGained: z.number().int().min(0),
  totalGoldGained: z.number().int().min(0),
  totalLootByItem: z.record(z.string(), z.number().int().min(0)),
  stopReason: PersistedHuntStopReasonSchema.nullable(),
  isContinuationRequired: z.boolean()
});
export type ActiveHuntDto = z.infer<typeof ActiveHuntDtoSchema>;

export const ActiveHuntResponseSchema = z.object({
  active: z.boolean(),
  hunt: ActiveHuntDtoSchema.nullable(),
  latestCompletedHuntId: z.string().uuid().nullable(),
  serverTimeIso: z.string().datetime()
});
export type ActiveHuntResponseDto = z.infer<typeof ActiveHuntResponseSchema>;

export const SettleHuntRequestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(128)
  })
  .strict();
export type SettleHuntRequestDto = z.infer<typeof SettleHuntRequestSchema>;

export const SettleHuntResponseSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['SETTLED', 'PARTIAL_SETTLED', 'ALREADY_COMPLETED']),
  idempotentReplay: z.boolean(),
  hunt: PublicHuntSessionViewSchema,
  segmentId: z.string().uuid().nullable(),
  segmentKey: z.string(),
  rewards: SettlementSegmentRewardsSummarySchema,
  character: CharacterDtoSchema,
  serverTimeIso: z.string().datetime()
});
export type SettleHuntResponseDto = z.infer<typeof SettleHuntResponseSchema>;

export const StopHuntRequestSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(128)
  })
  .strict();
export type StopHuntRequestDto = z.infer<typeof StopHuntRequestSchema>;

export const StopHuntResponseSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['COMPLETED', 'ALREADY_COMPLETED', 'STOP_CONTINUATION_REQUIRED']),
  alreadyCompleted: z.boolean(),
  continuationRequired: z.boolean(),
  unprocessedDurationMs: z.number().int().min(0),
  segmentsSettled: z.number().int().min(0),
  stopCutoffIso: z.string().datetime(),
  hunt: PublicHuntSessionViewSchema,
  character: CharacterDtoSchema,
  unusedHpPotionsReturned: z.number().int().min(0),
  unusedMpPotionsReturned: z.number().int().min(0),
  serverTimeIso: z.string().datetime()
});
export type StopHuntResponseDto = z.infer<typeof StopHuntResponseSchema>;

export const HuntSegmentDtoSchema = z.object({
  id: z.string().uuid(),
  huntId: z.string().uuid(),
  segmentKey: z.string(),
  startCheckpointVersion: z.number().int().min(1),
  endCheckpointVersion: z.number().int().min(2),
  segmentFromIso: z.string().datetime(),
  segmentToIso: z.string().datetime(),
  processedDurationMs: z.number().int().min(0),
  simulatedEvents: z.number().int().min(0),
  stopReason: PersistedHuntStopReasonSchema,
  isPartial: z.boolean(),
  rewards: SettlementSegmentRewardsSummarySchema,
  committedAtIso: z.string().datetime()
});
export type HuntSegmentDto = z.infer<typeof HuntSegmentDtoSchema>;

export const HuntSummaryDtoSchema = z.object({
  zoneId: z.string().min(1),
  strategy: HuntStrategySchema,
  status: HuntStatusSchema,
  stopReason: PersistedHuntStopReasonSchema.nullable(),
  startedAtIso: z.string().datetime(),
  completedAtIso: z.string().datetime().nullable(),
  totalDurationMs: z.number().int().min(0),
  totalKills: z.number().int().min(0),
  totalKillsByMonster: z.record(z.string(), z.number().int().min(0)),
  totalXpGained: z.number().int().min(0),
  totalGoldGained: z.number().int().min(0),
  totalLootByItem: z.record(z.string(), z.number().int().min(0)),
  totalDamageDealt: z.number().int().min(0),
  totalDamageTaken: z.number().int().min(0),
  totalHpPotionsUsed: z.number().int().min(0),
  totalMpPotionsUsed: z.number().int().min(0),
  unusedHpPotionsReturned: z.number().int().min(0),
  unusedMpPotionsReturned: z.number().int().min(0),
  levelBefore: z.number().int().min(1),
  levelAfter: z.number().int().min(1)
});
export type HuntSummaryDto = z.infer<typeof HuntSummaryDtoSchema>;

export const HuntSegmentsResponseSchema = z.object({
  huntId: z.string().uuid(),
  segments: z.array(HuntSegmentDtoSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    totalSegments: z.number().int().min(0),
    totalPages: z.number().int().min(0)
  }),
  summary: HuntSummaryDtoSchema
});
export type HuntSegmentsResponseDto = z.infer<typeof HuntSegmentsResponseSchema>;

export const CharacterHuntRewardItemDtoSchema = z.object({
  id: z.string().uuid(),
  huntId: z.string().uuid(),
  huntSegmentId: z.string().uuid(),
  itemId: z.string().min(1),
  nameKey: z.string().min(1),
  rarity: ItemRaritySchema,
  quantity: z.number().int().min(1),
  ownershipState: z.enum(['UNCLAIMED', 'CLAIMED']),
  claimedAtIso: z.string().datetime().nullable(),
  createdAtIso: z.string().datetime()
});
export type CharacterHuntRewardItemDto = z.infer<typeof CharacterHuntRewardItemDtoSchema>;

export const CharacterHuntRewardsResponseSchema = z.object({
  characterId: z.string().uuid(),
  items: z.array(CharacterHuntRewardItemDtoSchema),
  totalItemsCount: z.number().int().min(0)
});
export type CharacterHuntRewardsResponseDto = z.infer<
  typeof CharacterHuntRewardsResponseSchema
>;

export const SessionMeResponseSchema = z.object({
  user: UserDtoSchema,
  csrfToken: z.string().min(16),
  characters: z.array(CharacterDtoSchema),
  maxCharacters: z.number().int().min(1)
});
export type SessionMeResponseDto = z.infer<typeof SessionMeResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('tibia-idle-api'),
  version: z.string().min(1),
  contractVersion: z.literal(CONTRACT_VERSION),
  simulationVersion: z.string().min(1),
  serverTimeIso: z.string().datetime()
});
export type HealthResponseDto = z.infer<typeof HealthResponseSchema>;

export const ReadinessResponseSchema = z.object({
  status: z.enum(['ready', 'degraded']),
  database: z.enum(['up', 'down', 'unconfigured']),
  serverTimeIso: z.string().datetime()
});
export type ReadinessResponseDto = z.infer<typeof ReadinessResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    messageKey: z.string().min(1),
    correlationId: z.string().min(1)
  })
});
export type ApiErrorDto = z.infer<typeof ApiErrorSchema>;

// ==========================================
// P04 / IDLE-005A: Inventory & Item Contracts
// ==========================================

export const ItemTypeSchema = z.enum(['material', 'loot', 'equipment', 'consumable', 'currency']);
export type ItemTypeDto = z.infer<typeof ItemTypeSchema>;

export const ItemCombatBonusesSchema = z.object({
  weaponAttack: z.number().int().min(0).optional(),
  shieldDefense: z.number().int().min(0).optional(),
  totalArmor: z.number().int().min(0).optional(),
  critChancePermille: z.number().int().min(0).max(1000).optional(),
  critMultiplierPermille: z.number().int().min(0).max(10_000).optional(),
  meleeBonus: z.number().int().min(0).optional(),
  shieldingBonus: z.number().int().min(0).optional(),
  maxHpBonus: z.number().int().min(0).optional(),
  maxMpBonus: z.number().int().min(0).optional()
});
export type ItemCombatBonusesDto = z.infer<typeof ItemCombatBonusesSchema>;

export const ItemDefinitionSchema = z.object({
  itemId: z.string().min(1),
  nameKey: z.string().min(1),
  rarity: ItemRaritySchema,
  assetId: z.string().min(1),
  fallbackIconKey: z.string().min(1),
  itemType: ItemTypeSchema,
  stackable: z.boolean(),
  maxStackSize: z.number().int().min(1),
  weightUnits: z.number().int().min(0),
  equipmentSlot: EquipmentSlotSchema.optional(),
  requiredLevel: z.number().int().min(1).max(10_000).optional(),
  allowedVocations: z.array(VocationSchema).optional(),
  combatBonuses: ItemCombatBonusesSchema.optional(),
  metadataVersion: z.string().min(1)
});
export type ItemDefinitionDto = z.infer<typeof ItemDefinitionSchema>;

export const InventorySlotItemSchema = z.object({
  id: z.string().uuid(),
  containerId: z.string().uuid(),
  slotIndex: z.number().int().min(0).max(99),
  itemId: z.string().min(1),
  nameKey: z.string().min(1),
  rarity: ItemRaritySchema,
  assetId: z.string().min(1),
  fallbackIconKey: z.string().min(1),
  itemType: ItemTypeSchema,
  stackable: z.boolean(),
  maxStackSize: z.number().int().min(1),
  weightUnits: z.number().int().min(0),
  totalWeight: z.number().int().min(0),
  quantity: z.number().int().min(1),
  equipmentSlot: EquipmentSlotSchema.optional(),
  requiredLevel: z.number().int().min(1).max(10_000).optional(),
  allowedVocations: z.array(VocationSchema).optional(),
  combatBonuses: ItemCombatBonusesSchema.optional(),
  rowVersion: z.number().int().min(1)
});
export type InventorySlotItemDto = z.infer<typeof InventorySlotItemSchema>;

export const InventoryContainerSchema = z.object({
  id: z.string().uuid(),
  characterId: z.string().uuid(),
  containerType: z.enum(['backpack', 'equipment']),
  slotCapacity: z.number().int().min(1).max(100),
  occupiedSlots: z.number().int().min(0),
  rowVersion: z.number().int().min(1)
});
export type InventoryContainerDto = z.infer<typeof InventoryContainerSchema>;

export const CharacterInventoryCapacitySchema = z.object({
  currentWeight: z.number().int().min(0),
  maxWeight: z.number().int().min(0),
  remainingCapacity: z.number().int().min(0),
  occupiedSlots: z.number().int().min(0),
  maxSlots: z.number().int().min(1)
});
export type CharacterInventoryCapacityDto = z.infer<typeof CharacterInventoryCapacitySchema>;

export const CharacterInventoryResponseSchema = z.object({
  characterId: z.string().uuid(),
  container: InventoryContainerSchema,
  slots: z.array(InventorySlotItemSchema),
  capacity: CharacterInventoryCapacitySchema
});
export type CharacterInventoryResponseDto = z.infer<typeof CharacterInventoryResponseSchema>;

export const CharacterContainersResponseSchema = z.object({
  characterId: z.string().uuid(),
  containers: z.array(InventoryContainerSchema)
});
export type CharacterContainersResponseDto = z.infer<typeof CharacterContainersResponseSchema>;

export const MoveInventoryItemRequestSchema = z.object({
  containerId: z.string().uuid().optional(),
  fromSlot: z.number().int().min(0).max(99),
  toSlot: z.number().int().min(0).max(99),
  idempotencyKey: z.string().min(1).max(128)
});
export type MoveInventoryItemRequestDto = z.infer<typeof MoveInventoryItemRequestSchema>;

export const MoveInventoryItemResponseSchema = z.object({
  characterId: z.string().uuid(),
  action: z.enum(['MOVED', 'MERGED', 'SWAPPED']),
  inventory: CharacterInventoryResponseSchema,
  idempotentReplay: z.boolean()
});
export type MoveInventoryItemResponseDto = z.infer<typeof MoveInventoryItemResponseSchema>;

export const SplitInventoryStackRequestSchema = z.object({
  containerId: z.string().uuid().optional(),
  fromSlot: z.number().int().min(0).max(99),
  toSlot: z.number().int().min(0).max(99),
  quantity: z.number().int().min(1),
  idempotencyKey: z.string().min(1).max(128)
});
export type SplitInventoryStackRequestDto = z.infer<typeof SplitInventoryStackRequestSchema>;

export const SplitInventoryStackResponseSchema = z.object({
  characterId: z.string().uuid(),
  inventory: CharacterInventoryResponseSchema,
  idempotentReplay: z.boolean()
});
export type SplitInventoryStackResponseDto = z.infer<typeof SplitInventoryStackResponseSchema>;

export const ClaimHuntRewardRequestSchema = z.object({
  idempotencyKey: z.string().min(1).max(128)
});
export type ClaimHuntRewardRequestDto = z.infer<typeof ClaimHuntRewardRequestSchema>;

export const ClaimHuntRewardResponseSchema = z.object({
  characterId: z.string().uuid(),
  rewardId: z.string().uuid(),
  claimedItem: CharacterHuntRewardItemDtoSchema,
  inventory: CharacterInventoryResponseSchema,
  idempotentReplay: z.boolean()
});
export type ClaimHuntRewardResponseDto = z.infer<typeof ClaimHuntRewardResponseSchema>;

// ==========================================
// P04B / IDLE-005B: Equipment & Combat Stats
// ==========================================

export const CombatStatBreakdownSchema = z.object({
  base: z.number().int(),
  bonus: z.number().int(),
  effective: z.number().int()
});
export type CombatStatBreakdownDto = z.infer<typeof CombatStatBreakdownSchema>;

export const CharacterCombatStatsSchema = z.object({
  weaponAttack: CombatStatBreakdownSchema,
  shieldDefense: CombatStatBreakdownSchema,
  totalArmor: CombatStatBreakdownSchema,
  critChancePermille: CombatStatBreakdownSchema,
  critMultiplierPermille: CombatStatBreakdownSchema
});
export type CharacterCombatStatsDto = z.infer<typeof CharacterCombatStatsSchema>;

export const EquippedItemSlotSchema = z.object({
  slot: EquipmentSlotSchema,
  instanceId: z.string().uuid(),
  itemId: z.string().min(1),
  nameKey: z.string().min(1),
  rarity: ItemRaritySchema,
  assetId: z.string().min(1),
  fallbackIconKey: z.string().min(1),
  itemType: ItemTypeSchema,
  stackable: z.boolean(),
  maxStackSize: z.number().int().min(1),
  weightUnits: z.number().int().min(0),
  totalWeight: z.number().int().min(0),
  quantity: z.number().int().min(1),
  equipmentSlot: EquipmentSlotSchema,
  requiredLevel: z.number().int().min(1).max(10_000).optional(),
  allowedVocations: z.array(VocationSchema).optional(),
  combatBonuses: ItemCombatBonusesSchema.optional(),
  rowVersion: z.number().int().min(1)
});
export type EquippedItemSlotDto = z.infer<typeof EquippedItemSlotSchema>;

export const CharacterEquipmentResponseSchema = z.object({
  characterId: z.string().uuid(),
  slots: z.record(EquipmentSlotSchema, EquippedItemSlotSchema.nullable()),
  stats: CharacterCombatStatsSchema,
  activeHuntLocked: z.boolean(),
  totalEquipmentWeight: z.number().int().min(0)
});
export type CharacterEquipmentResponseDto = z.infer<typeof CharacterEquipmentResponseSchema>;

export const EquipItemRequestSchema = z.object({
  backpackSlot: z.number().int().min(0).max(99),
  equipmentSlot: EquipmentSlotSchema,
  idempotencyKey: z.string().min(1).max(128)
});
export type EquipItemRequestDto = z.infer<typeof EquipItemRequestSchema>;

export const EquipItemResponseSchema = z.object({
  characterId: z.string().uuid(),
  action: z.enum(['EQUIPPED', 'SWAPPED']),
  equipment: CharacterEquipmentResponseSchema,
  inventory: CharacterInventoryResponseSchema,
  idempotentReplay: z.boolean()
});
export type EquipItemResponseDto = z.infer<typeof EquipItemResponseSchema>;

export const UnequipItemRequestSchema = z.object({
  equipmentSlot: EquipmentSlotSchema,
  targetBackpackSlot: z.number().int().min(0).max(99).optional(),
  idempotencyKey: z.string().min(1).max(128)
});
export type UnequipItemRequestDto = z.infer<typeof UnequipItemRequestSchema>;

export const UnequipItemResponseSchema = z.object({
  characterId: z.string().uuid(),
  action: z.literal('UNEQUIPPED'),
  equipment: CharacterEquipmentResponseSchema,
  inventory: CharacterInventoryResponseSchema,
  idempotentReplay: z.boolean()
});
export type UnequipItemResponseDto = z.infer<typeof UnequipItemResponseSchema>;
