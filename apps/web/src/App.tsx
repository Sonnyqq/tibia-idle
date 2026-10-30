import {
  type CharacterDto,
  type SessionMeResponseDto,
  type UserDto,
  VOCATIONS,
  type VocationDto
} from '@tibia-idle/contracts';
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  t,
  type TranslationKey
} from '@tibia-idle/i18n';
import { type FormEvent, useEffect, useState } from 'react';

const NAV_KEYS: readonly TranslationKey[] = [
  'nav.dashboard',
  'nav.hunts',
  'nav.character',
  'nav.inventory',
  'nav.more'
];

const VOCATION_KEY_MAP: Readonly<Record<VocationDto, TranslationKey>> = {
  knight: 'vocation.knight',
  paladin: 'vocation.paladin',
  sorcerer: 'vocation.sorcerer',
  druid: 'vocation.druid'
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

function resolveErrorMessageKey(rawKey: unknown): TranslationKey {
  if (typeof rawKey === 'string' && KNOWN_ERROR_KEYS.has(rawKey)) {
    return rawKey as TranslationKey;
  }
  return 'common.error';
}

export interface AppProps {
  initialLocale?: SupportedLocale;
  apiBaseUrl?: string;
}

export function App({ initialLocale = DEFAULT_LOCALE, apiBaseUrl = '/api' }: AppProps) {
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [user, setUser] = useState<UserDto | null>(null);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [characters, setCharacters] = useState<CharacterDto[]>([]);
  const [maxCharacters, setMaxCharacters] = useState<number>(3);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);

  const [emailInput, setEmailInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [charNameInput, setCharNameInput] = useState<string>('');
  const [charVocationInput, setCharVocationInput] = useState<VocationDto>('knight');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const applySessionPayload = (payload: SessionMeResponseDto) => {
    setUser(payload.user);
    setCsrfToken(payload.csrfToken);
    setCharacters(payload.characters);
    setMaxCharacters(payload.maxCharacters);
    if (isSupportedLocale(payload.user.locale)) {
      setLocale(payload.user.locale);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const checkExistingSession = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/me`, {
          method: 'GET',
          credentials: 'include'
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as SessionMeResponseDto;
        if (!cancelled) {
          applySessionPayload(data);
        }
      } catch {
        // Unauthenticated or offline during initial boot
      }
    };
    void checkExistingSession();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  const handleLanguageSwitch = async (nextLocale: SupportedLocale) => {
    setLocale(nextLocale);
    if (user && csrfToken) {
      try {
        const res = await fetch(`${apiBaseUrl}/me/locale`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify({ locale: nextLocale })
        });
        if (res.ok) {
          const updatedUser = (await res.json()) as UserDto;
          setUser(updatedUser);
        }
      } catch {
        // Keep local UI language even if network fails
      }
    }
  };

  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorKey(null);
    setIsLoading(true);
    try {
      const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login';
      const payload =
        authMode === 'register'
          ? { email: emailInput, password: passwordInput, locale }
          : { email: emailInput, password: passwordInput };

      const res = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as {
          error?: { messageKey?: string };
        } | null;
        setErrorKey(resolveErrorMessageKey(errBody?.error?.messageKey));
        return;
      }

      const sessionData = (await res.json()) as SessionMeResponseDto;
      applySessionPayload(sessionData);
      setPasswordInput('');
      setSelectedCharacterId(null);
    } catch {
      setErrorKey('common.error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateCharacter = async (e: FormEvent) => {
    e.preventDefault();
    setErrorKey(null);
    setIsLoading(true);
    try {
      const res = await fetch(`${apiBaseUrl}/characters`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({
          name: charNameInput,
          vocation: charVocationInput
        })
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as {
          error?: { messageKey?: string };
        } | null;
        setErrorKey(resolveErrorMessageKey(errBody?.error?.messageKey));
        return;
      }

      const createdChar = (await res.json()) as CharacterDto;
      setCharacters((prev) => [...prev, createdChar]);
      setCharNameInput('');
      setSelectedCharacterId(createdChar.id);
    } catch {
      setErrorKey('common.error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    setErrorKey(null);
    setIsLoading(true);
    try {
      await fetch(`${apiBaseUrl}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'x-csrf-token': csrfToken
        }
      });
    } finally {
      setUser(null);
      setCsrfToken('');
      setCharacters([]);
      setSelectedCharacterId(null);
      setIsLoading(false);
    }
  };

  const activeCharacter = characters.find((c) => c.id === selectedCharacterId) ?? null;

  return (
    <div
      data-testid="app-shell"
      data-locale={locale}
      style={{
        maxWidth: '960px',
        margin: '0 auto',
        padding: '1rem',
        fontFamily: 'system-ui, sans-serif'
      }}
    >
      <header
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          borderBottom: '1px solid #334155',
          paddingBottom: '0.75rem'
        }}
      >
        <h1 data-testid="app-title" style={{ margin: 0 }}>
          {t(locale, 'app.title')}
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span data-testid="language-label">{t(locale, 'settings.language')}</span>
          {SUPPORTED_LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              data-testid={`lang-${code}`}
              aria-pressed={locale === code}
              onClick={() => void handleLanguageSwitch(code)}
            >
              {t(locale, code === 'pl' ? 'settings.localePl' : 'settings.localeEn')}
            </button>
          ))}
          {user && (
            <button
              type="button"
              data-testid="logout-button"
              disabled={isLoading}
              onClick={() => void handleLogout()}
            >
              {t(locale, 'auth.logout')}
            </button>
          )}
        </div>
      </header>

      <nav aria-label={t(locale, 'app.title')} style={{ margin: '0.75rem 0' }}>
        <ul
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1rem',
            listStyle: 'none',
            padding: 0,
            margin: 0
          }}
        >
          {NAV_KEYS.map((navKey) => (
            <li key={navKey} data-testid={navKey}>
              {t(locale, navKey)}
            </li>
          ))}
        </ul>
      </nav>

      <main>
        <p data-testid="scaffold-notice">{t(locale, 'app.scaffoldNotice')}</p>

        {isLoading && <p data-testid="loading-indicator">{t(locale, 'common.loading')}</p>}

        {errorKey && (
          <div
            role="alert"
            data-testid="error-banner"
            style={{
              padding: '0.75rem',
              marginBottom: '1rem',
              border: '1px solid #dc2626',
              color: '#dc2626'
            }}
          >
            {t(locale, errorKey)}
          </div>
        )}

        {!user ? (
          <section data-testid="auth-panel" style={{ maxWidth: '420px' }}>
            <h2 data-testid="auth-heading">
              {t(locale, authMode === 'login' ? 'auth.loginTitle' : 'auth.registerTitle')}
            </h2>
            <form onSubmit={(e) => void handleAuthSubmit(e)} style={{ display: 'grid', gap: '0.75rem' }}>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span>{t(locale, 'auth.emailLabel')}</span>
                <input
                  type="email"
                  required
                  data-testid="auth-email-input"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.25rem' }}>
                <span>{t(locale, 'auth.passwordLabel')}</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  maxLength={128}
                  data-testid="auth-password-input"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                />
              </label>
              <button type="submit" data-testid="auth-submit-button" disabled={isLoading}>
                {t(locale, authMode === 'login' ? 'auth.submitLogin' : 'auth.submitRegister')}
              </button>
            </form>
            <div style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                data-testid="auth-mode-toggle"
                onClick={() => {
                  setErrorKey(null);
                  setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'));
                }}
              >
                {t(locale, authMode === 'login' ? 'auth.switchToRegister' : 'auth.switchToLogin')}
              </button>
            </div>
          </section>
        ) : activeCharacter ? (
          <section data-testid="character-dashboard">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 data-testid="dashboard-character-name">{activeCharacter.name}</h2>
              <button
                type="button"
                data-testid="back-to-characters-button"
                onClick={() => setSelectedCharacterId(null)}
              >
                {t(locale, 'character.backToList')}
              </button>
            </div>
            <p data-testid="dashboard-vocation">
              {t(locale, 'character.vocationLabel')}:{' '}
              <strong>{t(locale, VOCATION_KEY_MAP[activeCharacter.vocation])}</strong>
            </p>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: '0.75rem'
              }}
            >
              <div data-testid="stat-level">
                <dt>{t(locale, 'stats.level')}</dt>
                <dd>{activeCharacter.stats.level}</dd>
              </div>
              <div data-testid="stat-xp">
                <dt>{t(locale, 'stats.xp')}</dt>
                <dd>{activeCharacter.stats.xp}</dd>
              </div>
              <div data-testid="stat-hp">
                <dt>{t(locale, 'stats.hp')}</dt>
                <dd>
                  {activeCharacter.stats.hp} / {activeCharacter.stats.maxHp}
                </dd>
              </div>
              <div data-testid="stat-mp">
                <dt>{t(locale, 'stats.mp')}</dt>
                <dd>
                  {activeCharacter.stats.mp} / {activeCharacter.stats.maxMp}
                </dd>
              </div>
              <div data-testid="stat-gold">
                <dt>{t(locale, 'stats.gold')}</dt>
                <dd>{activeCharacter.stats.gold}</dd>
              </div>
              <div data-testid="stat-melee">
                <dt>{t(locale, 'stats.melee')}</dt>
                <dd>{activeCharacter.stats.melee}</dd>
              </div>
              <div data-testid="stat-distance">
                <dt>{t(locale, 'stats.distance')}</dt>
                <dd>{activeCharacter.stats.distance}</dd>
              </div>
              <div data-testid="stat-magic">
                <dt>{t(locale, 'stats.magic')}</dt>
                <dd>{activeCharacter.stats.magic}</dd>
              </div>
              <div data-testid="stat-shielding">
                <dt>{t(locale, 'stats.shielding')}</dt>
                <dd>{activeCharacter.stats.shielding}</dd>
              </div>
            </dl>
          </section>
        ) : (
          <div
            data-testid="character-management"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.5rem'
            }}
          >
            <section data-testid="character-select-panel">
              <h2>{t(locale, 'character.selectTitle')}</h2>
              <p data-testid="character-slots-indicator">
                {t(locale, 'character.slotsUsed')}: {characters.length} / {maxCharacters}
              </p>
              {characters.length === 0 ? (
                <p data-testid="no-characters-message">{t(locale, 'character.noCharacters')}</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
                  {characters.map((char) => (
                    <li
                      key={char.id}
                      data-testid={`character-item-${char.name}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.5rem',
                        border: '1px solid #475569'
                      }}
                    >
                      <span>
                        <strong>{char.name}</strong> ({t(locale, VOCATION_KEY_MAP[char.vocation])} —{' '}
                        {t(locale, 'stats.level')} {char.stats.level})
                      </span>
                      <button
                        type="button"
                        data-testid={`select-character-${char.name}`}
                        onClick={() => setSelectedCharacterId(char.id)}
                      >
                        {t(locale, 'character.selectAction')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {characters.length < maxCharacters && (
              <section data-testid="character-create-panel">
                <h2>{t(locale, 'character.createTitle')}</h2>
                <form
                  onSubmit={(e) => void handleCreateCharacter(e)}
                  style={{ display: 'grid', gap: '0.75rem' }}
                >
                  <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span>{t(locale, 'character.nameLabel')}</span>
                    <input
                      type="text"
                      required
                      minLength={3}
                      maxLength={20}
                      data-testid="character-name-input"
                      value={charNameInput}
                      onChange={(e) => setCharNameInput(e.target.value)}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: '0.25rem' }}>
                    <span>{t(locale, 'character.vocationLabel')}</span>
                    <select
                      data-testid="character-vocation-select"
                      value={charVocationInput}
                      onChange={(e) => setCharVocationInput(e.target.value as VocationDto)}
                    >
                      {VOCATIONS.map((voc) => (
                        <option key={voc} value={voc}>
                          {t(locale, VOCATION_KEY_MAP[voc])}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    data-testid="character-create-submit"
                    disabled={isLoading}
                  >
                    {t(locale, 'character.createSubmit')}
                  </button>
                </form>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
