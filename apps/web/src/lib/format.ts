import {
  type DangerTierDto,
  type EquipmentSlotDto,
  type ItemRarityDto,
  type VocationDto
} from '@tibia-idle/contracts';
import { type SupportedLocale, type TranslationKey } from '@tibia-idle/i18n';

export type GameTabId = 'dashboard' | 'hunts' | 'character' | 'inventory' | 'bestiary';

export interface GameTabDefinition {
  readonly id: GameTabId;
  readonly navTestId: string;
  readonly mobileTestId: string;
  readonly labelKey: TranslationKey;
  readonly iconKey: string;
}

export const GAME_TABS: readonly GameTabDefinition[] = [
  {
    id: 'dashboard',
    navTestId: 'nav.dashboard',
    mobileTestId: 'mobile-nav-dashboard',
    labelKey: 'nav.dashboard',
    iconKey: 'crest'
  },
  {
    id: 'hunts',
    navTestId: 'nav.hunts',
    mobileTestId: 'mobile-nav-hunts',
    labelKey: 'nav.hunts',
    iconKey: 'swords'
  },
  {
    id: 'character',
    navTestId: 'nav.character',
    mobileTestId: 'mobile-nav-character',
    labelKey: 'nav.character',
    iconKey: 'helmet'
  },
  {
    id: 'inventory',
    navTestId: 'nav.inventory',
    mobileTestId: 'mobile-nav-inventory',
    labelKey: 'nav.inventory',
    iconKey: 'chest'
  },
  {
    id: 'bestiary',
    navTestId: 'nav.bestiary',
    mobileTestId: 'mobile-nav-bestiary',
    labelKey: 'nav.bestiary',
    iconKey: 'skull'
  }
] as const;

export function isGameTabId(value: unknown): value is GameTabId {
  return (
    typeof value === 'string' &&
    GAME_TABS.some((tab) => tab.id === value)
  );
}

export const VOCATION_KEY_MAP: Readonly<Record<VocationDto, TranslationKey>> = {
  knight: 'vocation.knight',
  paladin: 'vocation.paladin',
  sorcerer: 'vocation.sorcerer',
  druid: 'vocation.druid'
};

export const VOCATION_ICON_MAP: Readonly<Record<VocationDto, string>> = {
  knight: 'sword',
  paladin: 'bow',
  sorcerer: 'orb',
  druid: 'staff'
};

export const EQUIPMENT_SLOT_KEY_MAP: Readonly<Record<EquipmentSlotDto, TranslationKey>> = {
  helmet: 'slot.helmet',
  amulet: 'slot.amulet',
  weapon: 'slot.weapon',
  armor: 'slot.armor',
  shield: 'slot.shield',
  ring: 'slot.ring',
  legs: 'slot.legs',
  boots: 'slot.boots',
  ammunition: 'slot.ammunition'
};

export const DANGER_TIER_KEY_MAP: Readonly<Record<DangerTierDto, TranslationKey>> = {
  low: 'danger.low',
  medium: 'danger.medium',
  high: 'danger.high'
};

export const RARITY_KEY_MAP: Readonly<Record<ItemRarityDto, TranslationKey>> = {
  common: 'rarity.common',
  uncommon: 'rarity.uncommon',
  rare: 'rarity.rare'
};

const KNOWN_ERROR_KEYS: ReadonlySet<string> = new Set<TranslationKey>([
  'common.error',
  'auth.invalidCredentials',
  'auth.emailTaken',
  'auth.rateLimited',
  'auth.unauthorized',
  'auth.csrfInvalid',
  'auth.validationError',
  'character.limitReached',
  'character.nameTaken',
  'character.nameReserved',
  'character.nameInvalid',
  'character.notFound'
]);

export function resolveErrorMessageKey(rawKey: unknown): TranslationKey {
  if (typeof rawKey === 'string' && KNOWN_ERROR_KEYS.has(rawKey)) {
    return rawKey as TranslationKey;
  }
  return 'common.error';
}

export function formatStatNumber(value: number, locale: SupportedLocale): string {
  const intlLocale = locale === 'pl' ? 'pl-PL' : 'en-US';
  return new Intl.NumberFormat(intlLocale).format(value);
}

export function computeXpBarProgress(
  level: number,
  xp: number
): { currentXp: number; nextLevelXp: number; percent: number } {
  const safeLevel = Math.max(1, Math.floor(level));
  const safeXp = Math.max(0, Math.floor(xp));
  const totalForLevel = (lvl: number): number => {
    if (lvl <= 1) return 0;
    const n = lvl - 1;
    return Math.floor((50 * n * (n * n + 5)) / 3);
  };
  const floorXp = totalForLevel(safeLevel);
  const nextLevelXp = totalForLevel(safeLevel + 1);
  const span = Math.max(1, nextLevelXp - floorXp);
  const earned = Math.max(0, safeXp - floorXp);
  const percent = Math.min(100, Math.max(0, Math.floor((earned / span) * 100)));
  return {
    currentXp: safeXp,
    nextLevelXp,
    percent
  };
}
