import {
  type CharacterStatsDto,
  type VocationDto,
  VOCATIONS,
  type ZoneCatalogDto
} from '@tibia-idle/contracts';

export const SIMULATION_VERSION = '0.1.0' as const;

export const MAX_CHARACTERS_PER_ACCOUNT = 3 as const;
export const STARTING_LEVEL = 1 as const;
export const STARTING_XP = 0 as const;
export const STARTING_GOLD = 100 as const;

export interface VocationStartingTemplate {
  readonly hp: number;
  readonly mp: number;
  readonly melee: number;
  readonly distance: number;
  readonly magic: number;
  readonly shielding: number;
}

export const VOCATION_STARTING_CONFIG: Readonly<Record<VocationDto, VocationStartingTemplate>> = {
  knight: {
    hp: 185,
    mp: 40,
    melee: 15,
    distance: 10,
    magic: 1,
    shielding: 15
  },
  paladin: {
    hp: 155,
    mp: 75,
    melee: 10,
    distance: 15,
    magic: 3,
    shielding: 12
  },
  sorcerer: {
    hp: 130,
    mp: 125,
    melee: 10,
    distance: 10,
    magic: 10,
    shielding: 10
  },
  druid: {
    hp: 130,
    mp: 125,
    melee: 10,
    distance: 10,
    magic: 10,
    shielding: 10
  }
} as const;

export const INITIAL_ZONES_CATALOG: readonly ZoneCatalogDto[] = [
  {
    id: 'damp-catacombs',
    nameKey: 'zone.sewersTitle',
    enemyTypesKey: 'zone.sewersEnemies',
    minLevel: 1,
    recommendedLevelRange: '1 - 8',
    expPerHourEstimate: null,
    goldPerHourEstimate: null,
    asset: {
      assetId: 'zone.damp-catacombs',
      category: 'zone',
      fallbackIconKey: 'dungeon'
    },
    creatures: [
      {
        id: 'cellar-stalker',
        nameKey: 'creature.cellarRat',
        minLevel: 1,
        dangerTier: 'low',
        asset: {
          assetId: 'creature.cellar-stalker',
          category: 'creature',
          fallbackIconKey: 'beast'
        },
        lootPreview: [
          {
            id: 'copper-coin',
            nameKey: 'item.copperCoin',
            rarity: 'common',
            asset: { assetId: 'item.copper-coin', category: 'item', fallbackIconKey: 'coin' }
          },
          {
            id: 'rat-pelt',
            nameKey: 'item.ratPelt',
            rarity: 'common',
            asset: { assetId: 'item.rat-pelt', category: 'item', fallbackIconKey: 'pelt' }
          }
        ]
      },
      {
        id: 'mire-carapace',
        nameKey: 'creature.mireBeetle',
        minLevel: 3,
        dangerTier: 'low',
        asset: {
          assetId: 'creature.mire-carapace',
          category: 'creature',
          fallbackIconKey: 'carapace'
        },
        lootPreview: [
          {
            id: 'chitin-plate',
            nameKey: 'item.chitinPlate',
            rarity: 'common',
            asset: { assetId: 'item.chitin-plate', category: 'item', fallbackIconKey: 'shield' }
          },
          {
            id: 'glow-moss',
            nameKey: 'item.glowMoss',
            rarity: 'uncommon',
            asset: { assetId: 'item.glow-moss', category: 'item', fallbackIconKey: 'herb' }
          }
        ]
      }
    ]
  },
  {
    id: 'sunken-crypts',
    nameKey: 'zone.cryptTitle',
    enemyTypesKey: 'zone.cryptEnemies',
    minLevel: 8,
    recommendedLevelRange: '8 - 20',
    expPerHourEstimate: null,
    goldPerHourEstimate: null,
    asset: {
      assetId: 'zone.sunken-crypts',
      category: 'zone',
      fallbackIconKey: 'crypt'
    },
    creatures: [
      {
        id: 'bone-sentinel',
        nameKey: 'creature.boneSentinel',
        minLevel: 8,
        dangerTier: 'medium',
        asset: {
          assetId: 'creature.bone-sentinel',
          category: 'creature',
          fallbackIconKey: 'skull'
        },
        lootPreview: [
          {
            id: 'ancient-bone',
            nameKey: 'item.ancientBone',
            rarity: 'common',
            asset: { assetId: 'item.ancient-bone', category: 'item', fallbackIconKey: 'bone' }
          },
          {
            id: 'rusted-blade',
            nameKey: 'item.rustedBlade',
            rarity: 'uncommon',
            asset: { assetId: 'item.rusted-blade', category: 'item', fallbackIconKey: 'sword' }
          }
        ]
      },
      {
        id: 'crypt-wraith',
        nameKey: 'creature.cryptWraith',
        minLevel: 14,
        dangerTier: 'medium',
        asset: {
          assetId: 'creature.crypt-wraith',
          category: 'creature',
          fallbackIconKey: 'wraith'
        },
        lootPreview: [
          {
            id: 'wraith-essence',
            nameKey: 'item.wraithEssence',
            rarity: 'uncommon',
            asset: { assetId: 'item.wraith-essence', category: 'item', fallbackIconKey: 'orb' }
          },
          {
            id: 'silver-ring',
            nameKey: 'item.silverRing',
            rarity: 'rare',
            asset: { assetId: 'item.silver-ring', category: 'item', fallbackIconKey: 'ring' }
          }
        ]
      }
    ]
  },
  {
    id: 'ashwind-ridge',
    nameKey: 'zone.ridgeTitle',
    enemyTypesKey: 'zone.ridgeEnemies',
    minLevel: 20,
    recommendedLevelRange: '20 - 40',
    expPerHourEstimate: null,
    goldPerHourEstimate: null,
    asset: {
      assetId: 'zone.ashwind-ridge',
      category: 'zone',
      fallbackIconKey: 'mountain'
    },
    creatures: [
      {
        id: 'ashwind-drake',
        nameKey: 'creature.ashDrake',
        minLevel: 22,
        dangerTier: 'high',
        asset: {
          assetId: 'creature.ashwind-drake',
          category: 'creature',
          fallbackIconKey: 'dragon'
        },
        lootPreview: [
          {
            id: 'drake-scale',
            nameKey: 'item.drakeScale',
            rarity: 'uncommon',
            asset: { assetId: 'item.drake-scale', category: 'item', fallbackIconKey: 'armor' }
          },
          {
            id: 'ash-talon',
            nameKey: 'item.ashTalon',
            rarity: 'rare',
            asset: { assetId: 'item.ash-talon', category: 'item', fallbackIconKey: 'claw' }
          }
        ]
      },
      {
        id: 'ember-acolyte',
        nameKey: 'creature.emberAcolyte',
        minLevel: 26,
        dangerTier: 'high',
        asset: {
          assetId: 'creature.ember-acolyte',
          category: 'creature',
          fallbackIconKey: 'staff'
        },
        lootPreview: [
          {
            id: 'ember-scroll',
            nameKey: 'item.emberScroll',
            rarity: 'uncommon',
            asset: { assetId: 'item.ember-scroll', category: 'item', fallbackIconKey: 'scroll' }
          },
          {
            id: 'ritual-amulet',
            nameKey: 'item.ritualAmulet',
            rarity: 'rare',
            asset: { assetId: 'item.ritual-amulet', category: 'item', fallbackIconKey: 'amulet' }
          }
        ]
      }
    ]
  }
];

export interface LevelXpProgress {
  readonly level: number;
  readonly currentXp: number;
  readonly levelFloorXp: number;
  readonly nextLevelXp: number;
  readonly progressPercent: number;
}

export function calculateTotalXpForLevel(level: number): number {
  if (!Number.isSafeInteger(level) || level <= 1) {
    return 0;
  }
  const n = level - 1;
  return Math.floor((50 * n * (n * n + 5)) / 3);
}

export function calculateLevelXpProgress(level: number, currentXp: number): LevelXpProgress {
  const safeLevel = Math.max(1, Math.floor(level));
  const safeXp = Math.max(0, Math.floor(currentXp));
  const levelFloorXp = calculateTotalXpForLevel(safeLevel);
  const nextLevelXp = calculateTotalXpForLevel(safeLevel + 1);
  const span = Math.max(1, nextLevelXp - levelFloorXp);
  const earnedInLevel = Math.max(0, safeXp - levelFloorXp);
  const progressPercent = Math.min(100, Math.max(0, Math.floor((earnedInLevel / span) * 100)));

  return {
    level: safeLevel,
    currentXp: safeXp,
    levelFloorXp,
    nextLevelXp,
    progressPercent
  };
}

export const RESERVED_CHARACTER_NAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'gm',
  'gamemaster',
  'cm',
  'god',
  'system',
  'root',
  'support',
  'moderator',
  'mod',
  'cipsoft',
  'tibia',
  'null',
  'undefined',
  'owner',
  'staff',
  'bot',
  'server'
]);

const CHARACTER_NAME_PATTERN = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeCharacterNameKey(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function formatCharacterDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export type CharacterNameValidationResult =
  | {
      readonly ok: true;
      readonly displayName: string;
      readonly normalizedKey: string;
    }
  | {
      readonly ok: false;
      readonly reason: 'INVALID_FORMAT' | 'RESERVED_NAME';
    };

export function validateCharacterNameDomain(raw: string): CharacterNameValidationResult {
  const displayName = formatCharacterDisplayName(raw);
  if (!displayName || !CHARACTER_NAME_PATTERN.test(displayName)) {
    return { ok: false, reason: 'INVALID_FORMAT' };
  }

  const normalizedKey = normalizeCharacterNameKey(displayName);
  const compactKey = normalizedKey.replace(/[^a-z]/g, '');
  const tokens = normalizedKey.split(/[ '-]+/);

  if (
    RESERVED_CHARACTER_NAMES.has(normalizedKey) ||
    RESERVED_CHARACTER_NAMES.has(compactKey) ||
    tokens.some((tok) => RESERVED_CHARACTER_NAMES.has(tok))
  ) {
    return { ok: false, reason: 'RESERVED_NAME' };
  }

  if (displayName.length < 3 || displayName.length > 20) {
    return { ok: false, reason: 'INVALID_FORMAT' };
  }

  return {
    ok: true,
    displayName,
    normalizedKey
  };
}

export function isSupportedVocation(value: unknown): value is VocationDto {
  return typeof value === 'string' && (VOCATIONS as readonly string[]).includes(value);
}

export function createInitialCharacterStats(vocation: VocationDto): CharacterStatsDto {
  const tpl = VOCATION_STARTING_CONFIG[vocation];
  return {
    level: STARTING_LEVEL,
    xp: STARTING_XP,
    hp: tpl.hp,
    maxHp: tpl.hp,
    mp: tpl.mp,
    maxMp: tpl.mp,
    gold: STARTING_GOLD,
    melee: tpl.melee,
    distance: tpl.distance,
    magic: tpl.magic,
    shielding: tpl.shielding
  };
}

export interface Clock {
  nowMs(): number;
  nowIso(): string;
}

export interface DeterministicRng {
  nextUint32(): number;
  nextFloat(): number;
  nextInt(minInclusive: number, maxInclusive: number): number;
}

export function createSystemClock(): Clock {
  return {
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString()
  };
}

export function createFixedClock(
  initialEpochMs: number
): Clock & { advanceMs(deltaMs: number): void } {
  if (!Number.isSafeInteger(initialEpochMs) || initialEpochMs < 0) {
    throw new RangeError('initialEpochMs must be a non-negative safe integer');
  }
  let currentMs = initialEpochMs;
  return {
    nowMs: () => currentMs,
    nowIso: () => new Date(currentMs).toISOString(),
    advanceMs: (deltaMs: number) => {
      if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) {
        throw new RangeError('deltaMs must be a non-negative safe integer');
      }
      currentMs += deltaMs;
    }
  };
}

export function createSeededRng(seed: number): DeterministicRng {
  if (!Number.isInteger(seed)) {
    throw new RangeError('seed must be an integer');
  }
  let state = seed >>> 0;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };

  const nextFloat = (): number => nextUint32() / 0x100000000;

  const nextInt = (minInclusive: number, maxInclusive: number): number => {
    if (
      !Number.isSafeInteger(minInclusive) ||
      !Number.isSafeInteger(maxInclusive) ||
      maxInclusive < minInclusive
    ) {
      throw new RangeError('Invalid integer bounds for nextInt');
    }
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + Math.floor(nextFloat() * span);
  };

  return {
    nextUint32,
    nextFloat,
    nextInt
  };
}

export * from './combat/index.js';

