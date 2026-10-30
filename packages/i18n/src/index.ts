import en from '../locales/en.json' with { type: 'json' };
import pl from '../locales/pl.json' with { type: 'json' };

export const SUPPORTED_LOCALES = ['pl', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'pl';

export type TranslationKey = keyof typeof en;
export type TranslationDictionary = Record<TranslationKey, string>;

// Compile-time check that PL and EN have identical key sets
const _plCheck: TranslationDictionary = pl;
const _enCheck: TranslationDictionary = en;

const dictionaries: Record<SupportedLocale, TranslationDictionary> = {
  pl: _plCheck,
  en: _enCheck
};

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function getDictionary(locale: SupportedLocale): Readonly<TranslationDictionary> {
  return dictionaries[locale];
}

export function t(locale: SupportedLocale, key: TranslationKey): string {
  return dictionaries[locale][key];
}
