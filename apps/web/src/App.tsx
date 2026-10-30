import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  t,
  type TranslationKey
} from '@tibia-idle/i18n';
import { useState } from 'react';

const NAV_KEYS: readonly TranslationKey[] = [
  'nav.dashboard',
  'nav.hunts',
  'nav.character',
  'nav.inventory',
  'nav.more'
];

export interface AppProps {
  initialLocale?: SupportedLocale;
}

export function App({ initialLocale = DEFAULT_LOCALE }: AppProps) {
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);

  return (
    <div data-testid="app-shell" data-locale={locale}>
      <header>
        <h1 data-testid="app-title">{t(locale, 'app.title')}</h1>
        <div>
          <span data-testid="language-label">{t(locale, 'settings.language')}</span>
          {SUPPORTED_LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              data-testid={`lang-${code}`}
              aria-pressed={locale === code}
              onClick={() => setLocale(code)}
            >
              {t(locale, code === 'pl' ? 'settings.localePl' : 'settings.localeEn')}
            </button>
          ))}
        </div>
      </header>

      <nav aria-label={t(locale, 'app.title')}>
        <ul>
          {NAV_KEYS.map((navKey) => (
            <li key={navKey} data-testid={navKey}>
              {t(locale, navKey)}
            </li>
          ))}
        </ul>
      </nav>

      <main>
        <p data-testid="scaffold-notice">{t(locale, 'app.scaffoldNotice')}</p>
      </main>
    </div>
  );
}
