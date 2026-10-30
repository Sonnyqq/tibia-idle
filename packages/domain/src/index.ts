import { type CharacterStatsDto, type VocationDto, VOCATIONS } from '@tibia-idle/contracts';

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
  if (
    displayName.length < 3 ||
    displayName.length > 20 ||
    !CHARACTER_NAME_PATTERN.test(displayName)
  ) {
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
