import {
  type CharacterInventoryCapacityDto,
  type ItemDefinitionDto,
  type VocationDto
} from '@tibia-idle/contracts';

export const ITEM_METADATA_VERSION = '1.0.0' as const;

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

export function calculateInventoryCapacity(
  vocation: VocationDto,
  level: number,
  items: readonly { readonly itemId: string; readonly quantity: number }[],
  slotCapacity = 20
): CharacterInventoryCapacityDto {
  const maxWeight = calculateCharacterMaxCapacity(vocation, level);
  const currentWeight = calculateInventoryWeight(items);
  const remainingCapacity = Math.max(0, maxWeight - currentWeight);
  const occupiedSlots = items.length;
  return {
    currentWeight,
    maxWeight,
    remainingCapacity,
    occupiedSlots,
    maxSlots: slotCapacity
  };
}
