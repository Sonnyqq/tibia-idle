import {
  type CharacterCombatStatsDto,
  type CharacterInventoryCapacityDto,
  type EquipmentSlotDto,
  type ItemDefinitionDto,
  type VocationDto
} from '@tibia-idle/contracts';

export const ITEM_METADATA_VERSION = '1.1.0' as const;

export const EQUIPMENT_SLOT_INDICES: Readonly<Record<EquipmentSlotDto, number>> = {
  helmet: 0,
  amulet: 1,
  weapon: 2,
  armor: 3,
  shield: 4,
  ring: 5,
  legs: 6,
  boots: 7,
  ammunition: 8
};

export const EQUIPMENT_INDEX_TO_SLOT: Readonly<Record<number, EquipmentSlotDto>> = {
  0: 'helmet',
  1: 'amulet',
  2: 'weapon',
  3: 'armor',
  4: 'shield',
  5: 'ring',
  6: 'legs',
  7: 'boots',
  8: 'ammunition'
};

export const ITEM_DEFINITIONS: readonly ItemDefinitionDto[] = [
  {
    itemId: 'copper-coin',
    nameKey: 'item.copperCoin',
    rarity: 'common',
    assetId: 'item.copper-coin',
    fallbackIconKey: 'coin',
    itemType: 'currency',
    stackable: true,
    maxStackSize: 100,
    weightUnits: 1,
    metadataVersion: ITEM_METADATA_VERSION
  },
  {
    itemId: 'rat-pelt',
    nameKey: 'item.ratPelt',
    rarity: 'common',
    assetId: 'item.rat-pelt',
    fallbackIconKey: 'pelt',
    itemType: 'material',
    stackable: true,
    maxStackSize: 100,
    weightUnits: 5,
    metadataVersion: ITEM_METADATA_VERSION
  },
  {
    itemId: 'chitin-plate',
    nameKey: 'item.chitinPlate',
    rarity: 'common',
    assetId: 'item.chitin-plate',
    fallbackIconKey: 'shield',
    itemType: 'material',
    stackable: true,
    maxStackSize: 100,
    weightUnits: 20,
    metadataVersion: ITEM_METADATA_VERSION
  },
  {
    itemId: 'glow-moss',
    nameKey: 'item.glowMoss',
    rarity: 'uncommon',
    assetId: 'item.glow-moss',
    fallbackIconKey: 'herb',
    itemType: 'material',
    stackable: true,
    maxStackSize: 100,
    weightUnits: 2,
    metadataVersion: ITEM_METADATA_VERSION
  },
  {
    itemId: 'ancient-bone',
    nameKey: 'item.ancientBone',
    rarity: 'common',
    assetId: 'item.ancient-bone',
    fallbackIconKey: 'bone',
    itemType: 'material',
    stackable: true,
    maxStackSize: 100,
    weightUnits: 15,
    metadataVersion: ITEM_METADATA_VERSION
  },
  {
    itemId: 'rusted-blade',
    nameKey: 'item.rustedBlade',
    rarity: 'uncommon',
    assetId: 'item.rusted-blade',
    fallbackIconKey: 'sword',
    itemType: 'equipment',
    stackable: false,
    maxStackSize: 1,
    weightUnits: 250,
    equipmentSlot: 'weapon',
    requiredLevel: 1,
    allowedVocations: ['knight'],
    combatBonuses: {
      weaponAttack: 4
    },
    metadataVersion: ITEM_METADATA_VERSION
  },
  {
    itemId: 'wraith-essence',
    nameKey: 'item.wraithEssence',
    rarity: 'uncommon',
    assetId: 'item.wraith-essence',
    fallbackIconKey: 'orb',
    itemType: 'material',
    stackable: true,
    maxStackSize: 100,
    weightUnits: 5,
    metadataVersion: ITEM_METADATA_VERSION
  },
  {
    itemId: 'silver-ring',
    nameKey: 'item.silverRing',
    rarity: 'rare',
    assetId: 'item.silver-ring',
    fallbackIconKey: 'ring',
    itemType: 'equipment',
    stackable: false,
    maxStackSize: 1,
    weightUnits: 10,
    equipmentSlot: 'ring',
    requiredLevel: 1,
    allowedVocations: ['knight', 'paladin', 'sorcerer', 'druid'],
    combatBonuses: {
      critChancePermille: 20
    },
    metadataVersion: ITEM_METADATA_VERSION
  },
  {
    itemId: 'drake-scale',
    nameKey: 'item.drakeScale',
    rarity: 'uncommon',
    assetId: 'item.drake-scale',
    fallbackIconKey: 'armor',
    itemType: 'material',
    stackable: true,
    maxStackSize: 100,
    weightUnits: 30,
    metadataVersion: ITEM_METADATA_VERSION
  },
  {
    itemId: 'ash-talon',
    nameKey: 'item.ashTalon',
    rarity: 'rare',
    assetId: 'item.ash-talon',
    fallbackIconKey: 'claw',
    itemType: 'material',
    stackable: true,
    maxStackSize: 100,
    weightUnits: 40,
    metadataVersion: ITEM_METADATA_VERSION
  },
  {
    itemId: 'ember-scroll',
    nameKey: 'item.emberScroll',
    rarity: 'uncommon',
    assetId: 'item.ember-scroll',
    fallbackIconKey: 'scroll',
    itemType: 'consumable',
    stackable: true,
    maxStackSize: 100,
    weightUnits: 8,
    metadataVersion: ITEM_METADATA_VERSION
  },
  {
    itemId: 'ritual-amulet',
    nameKey: 'item.ritualAmulet',
    rarity: 'rare',
    assetId: 'item.ritual-amulet',
    fallbackIconKey: 'amulet',
    itemType: 'equipment',
    stackable: false,
    maxStackSize: 1,
    weightUnits: 25,
    equipmentSlot: 'amulet',
    requiredLevel: 1,
    allowedVocations: ['knight', 'paladin', 'sorcerer', 'druid'],
    combatBonuses: {
      totalArmor: 3
    },
    metadataVersion: ITEM_METADATA_VERSION
  }
];

export const ITEM_DEFINITIONS_MAP: ReadonlyMap<string, ItemDefinitionDto> = new Map(
  ITEM_DEFINITIONS.map((def) => [def.itemId, def] as const)
);

export function getItemDefinition(itemId: string): ItemDefinitionDto | null {
  return ITEM_DEFINITIONS_MAP.get(itemId) ?? null;
}

export const VOCATION_CAPACITY_CONFIG: Readonly<
  Record<VocationDto, { readonly baseCapacity: number; readonly capacityPerLevel: number }>
> = {
  knight: { baseCapacity: 5000, capacityPerLevel: 250 },
  paladin: { baseCapacity: 4000, capacityPerLevel: 200 },
  sorcerer: { baseCapacity: 3000, capacityPerLevel: 100 },
  druid: { baseCapacity: 3000, capacityPerLevel: 100 }
} as const;

export function calculateCharacterMaxCapacity(vocation: VocationDto, level: number): number {
  if (!Number.isSafeInteger(level) || level < 1 || level > 10_000) {
    throw new RangeError(`Invalid character level '${level}' for capacity calculation`);
  }
  const config = VOCATION_CAPACITY_CONFIG[vocation];
  const extraLevels = level - 1;
  return config.baseCapacity + extraLevels * config.capacityPerLevel;
}

export function calculateInventoryWeight(
  items: readonly { readonly itemId: string; readonly quantity: number }[]
): number {
  let total = 0;
  for (const item of items) {
    const def = getItemDefinition(item.itemId);
    if (def) {
      total += def.weightUnits * item.quantity;
    }
  }
  return total;
}

export const BASE_KNIGHT_COMBAT_STATS = {
  weaponAttack: 18,
  shieldDefense: 16,
  totalArmor: 10,
  critChancePermille: 50,
  critMultiplierPermille: 1250
} as const;

export function calculateEffectiveCombatStats(
  character: { readonly vocation: VocationDto; readonly level: number },
  equippedItems: readonly { readonly itemId: string }[]
): CharacterCombatStatsDto {
  const isKnight = character.vocation === 'knight';
  const base = isKnight
    ? BASE_KNIGHT_COMBAT_STATS
    : {
        weaponAttack: 10,
        shieldDefense: 10,
        totalArmor: 5,
        critChancePermille: 50,
        critMultiplierPermille: 1250
      };

  let bonusWeaponAttack = 0;
  let bonusShieldDefense = 0;
  let bonusTotalArmor = 0;
  let bonusCritChancePermille = 0;
  let bonusCritMultiplierPermille = 0;

  // Stable sort by itemId so calculation order is independent of input order
  const sortedItems = [...equippedItems].sort((a, b) => a.itemId.localeCompare(b.itemId));

  for (const item of sortedItems) {
    const def = getItemDefinition(item.itemId);
    if (!def || !def.combatBonuses) continue;

    // Check level & vocation requirement
    const requiredLevel = def.requiredLevel ?? 1;
    if (character.level < requiredLevel) continue;
    if (def.allowedVocations && !def.allowedVocations.includes(character.vocation)) continue;

    // For non-knight vocations, do not show unhandled combat bonuses as active
    if (!isKnight) continue;

    bonusWeaponAttack += def.combatBonuses.weaponAttack ?? 0;
    bonusShieldDefense += def.combatBonuses.shieldDefense ?? 0;
    bonusTotalArmor += def.combatBonuses.totalArmor ?? 0;
    bonusCritChancePermille += def.combatBonuses.critChancePermille ?? 0;
    bonusCritMultiplierPermille += def.combatBonuses.critMultiplierPermille ?? 0;
  }

  const effectiveWeaponAttack = Math.min(1_000_000, Math.max(1, base.weaponAttack + bonusWeaponAttack));
  const effectiveShieldDefense = Math.min(1_000_000, Math.max(0, base.shieldDefense + bonusShieldDefense));
  const effectiveTotalArmor = Math.min(1_000_000, Math.max(0, base.totalArmor + bonusTotalArmor));
  const effectiveCritChancePermille = Math.min(1000, Math.max(0, base.critChancePermille + bonusCritChancePermille));
  const effectiveCritMultiplierPermille = Math.min(
    10_000,
    Math.max(1000, base.critMultiplierPermille + bonusCritMultiplierPermille)
  );

  return {
    weaponAttack: {
      base: base.weaponAttack,
      bonus: bonusWeaponAttack,
      effective: effectiveWeaponAttack
    },
    shieldDefense: {
      base: base.shieldDefense,
      bonus: bonusShieldDefense,
      effective: effectiveShieldDefense
    },
    totalArmor: {
      base: base.totalArmor,
      bonus: bonusTotalArmor,
      effective: effectiveTotalArmor
    },
    critChancePermille: {
      base: base.critChancePermille,
      bonus: bonusCritChancePermille,
      effective: effectiveCritChancePermille
    },
    critMultiplierPermille: {
      base: base.critMultiplierPermille,
      bonus: bonusCritMultiplierPermille,
      effective: effectiveCritMultiplierPermille
    }
  };
}

export function calculateCharacterCarriedWeight(
  backpackItems: readonly { readonly itemId: string; readonly quantity: number }[],
  equippedItems: readonly { readonly itemId: string; readonly quantity?: number | undefined }[] = []
): number {
  const backpackWeight = calculateInventoryWeight(backpackItems);
  const equippedWeight = calculateInventoryWeight(
    equippedItems.map((e) => ({ itemId: e.itemId, quantity: e.quantity ?? 1 }))
  );
  return backpackWeight + equippedWeight;
}

export function calculateInventoryCapacity(
  vocation: VocationDto,
  level: number,
  backpackItems: readonly { readonly itemId: string; readonly quantity: number }[],
  equippedItemsOrSlotCapacity:
    | readonly { readonly itemId: string; readonly quantity?: number | undefined }[]
    | number = [],
  slotCapacity = 20
): CharacterInventoryCapacityDto {
  const equippedItems = Array.isArray(equippedItemsOrSlotCapacity)
    ? equippedItemsOrSlotCapacity
    : [];
  const maxSlots =
    typeof equippedItemsOrSlotCapacity === 'number'
      ? equippedItemsOrSlotCapacity
      : slotCapacity;
  const maxWeight = calculateCharacterMaxCapacity(vocation, level);
  const currentWeight = calculateCharacterCarriedWeight(backpackItems, equippedItems);
  const remainingCapacity = Math.max(0, maxWeight - currentWeight);
  const occupiedSlots = backpackItems.length;
  return {
    currentWeight,
    maxWeight,
    remainingCapacity,
    occupiedSlots,
    maxSlots
  };
}
