import { DEFAULT_LOCALE, getDictionary, isSupportedLocale, t } from '@tibia-idle/i18n';
import { describe, expect, it } from 'vitest';

describe('@tibia-idle/i18n smoke tests', () => {
  it('resolves PL and EN keys with PL as default locale', () => {
    expect(DEFAULT_LOCALE).toBe('pl');
    expect(t('pl', 'nav.hunts')).toBe('Polowania');
    expect(t('en', 'nav.hunts')).toBe('Hunts');
    expect(Object.keys(getDictionary('pl')).sort()).toEqual(Object.keys(getDictionary('en')).sort());
  });

  it('validates supported locale codes', () => {
    expect(isSupportedLocale('pl')).toBe(true);
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('es')).toBe(false);
    expect(isSupportedLocale(null)).toBe(false);
  });
});
