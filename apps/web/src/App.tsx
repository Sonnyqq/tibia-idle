import {
  type CharacterDto,
  type SessionMeResponseDto,
  type UserDto,
  VOCATIONS,
  type VocationDto,
  type ZoneCatalogDto,
  type ZonesCatalogResponseDto
} from '@tibia-idle/contracts';
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  t,
  type TranslationKey
} from '@tibia-idle/i18n';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { GameIcon } from './assets/assetRegistry.js';
import { BestiaryView } from './components/BestiaryView.js';
import { CharacterView } from './components/CharacterView.js';
import { DashboardView } from './components/DashboardView.js';
import { HuntsView } from './components/HuntsView.js';
import { InventoryView } from './components/InventoryView.js';
import {
  GAME_TABS,
  type GameTabId,
  isGameTabId,
  resolveErrorMessageKey,
  VOCATION_KEY_MAP
} from './lib/format.js';

const SESSION_STORAGE_CHAR_KEY = 'tibia_idle_ui_char_id';
const SESSION_STORAGE_TAB_KEY = 'tibia_idle_ui_tab_id';

function readSessionUiState(): { charId: string | null; tab: GameTabId } {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return { charId: null, tab: 'dashboard' };
  }
  try {
    const charId = window.sessionStorage.getItem(SESSION_STORAGE_CHAR_KEY);
    const rawTab = window.sessionStorage.getItem(SESSION_STORAGE_TAB_KEY);
    return {
      charId: charId || null,
      tab: isGameTabId(rawTab) ? rawTab : 'dashboard'
    };
  } catch {
    return { charId: null, tab: 'dashboard' };
  }
}

function writeSessionUiState(charId: string | null, tab: GameTabId): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    if (charId) {
      window.sessionStorage.setItem(SESSION_STORAGE_CHAR_KEY, charId);
    } else {
      window.sessionStorage.removeItem(SESSION_STORAGE_CHAR_KEY);
    }
    window.sessionStorage.setItem(SESSION_STORAGE_TAB_KEY, tab);
  } catch {
    // Ignore storage quota errors
  }
}

function clearSessionUiState(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_CHAR_KEY);
    window.sessionStorage.removeItem(SESSION_STORAGE_TAB_KEY);
  } catch {
    // Ignore storage errors
  }
}

export interface AppProps {
  initialLocale?: SupportedLocale;
  apiBaseUrl?: string;
  initialUser?: UserDto | null;
  initialCharacters?: readonly CharacterDto[];
  initialSelectedCharacterId?: string | null;
  initialTab?: GameTabId;
  initialZones?: readonly ZoneCatalogDto[];
}

export function App({
  initialLocale = DEFAULT_LOCALE,
  apiBaseUrl = '/api',
  initialUser = null,
  initialCharacters = [],
  initialSelectedCharacterId = null,
  initialTab = 'dashboard',
  initialZones = []
}: AppProps) {
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [user, setUser] = useState<UserDto | null>(initialUser);
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [characters, setCharacters] = useState<CharacterDto[]>([...initialCharacters]);
  const [maxCharacters, setMaxCharacters] = useState<number>(3);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    initialSelectedCharacterId
  );
  const [activeTab, setActiveTab] = useState<GameTabId>(initialTab);

  const [zones, setZones] = useState<readonly ZoneCatalogDto[]>(initialZones);
  const [zonesLoading, setZonesLoading] = useState<boolean>(false);
  const [zonesErrorKey, setZonesErrorKey] = useState<TranslationKey | null>(null);

  const [emailInput, setEmailInput] = useState<string>('');
  const [passwordInput, setPasswordInput] = useState<string>('');
  const [charNameInput, setCharNameInput] = useState<string>('');
  const [charVocationInput, setCharVocationInput] = useState<VocationDto>('knight');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  const selectCharacter = (charId: string | null) => {
    setSelectedCharacterId(charId);
    writeSessionUiState(charId, activeTab);
  };

  const navigateTab = (tab: GameTabId) => {
    setActiveTab(tab);
    writeSessionUiState(selectedCharacterId, tab);
  };

  const loadZonesCatalog = useCallback(async () => {
    setZonesLoading(true);
    setZonesErrorKey(null);
    try {
      const res = await fetch(`${apiBaseUrl}/zones`, {
        method: 'GET',
        credentials: 'include'
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as {
          error?: { messageKey?: string };
        } | null;
        setZonesErrorKey(resolveErrorMessageKey(errBody?.error?.messageKey));
        return;
      }
      const data = (await res.json()) as ZonesCatalogResponseDto;
      setZones(data.zones);
    } catch {
      setZonesErrorKey('common.error');
    } finally {
      setZonesLoading(false);
    }
  }, [apiBaseUrl]);

  const applySessionPayload = useCallback(
    (payload: SessionMeResponseDto, restoreUiSelection: boolean) => {
      setUser(payload.user);
      setCsrfToken(payload.csrfToken);
      setCharacters(payload.characters);
      setMaxCharacters(payload.maxCharacters);
      if (isSupportedLocale(payload.user.locale)) {
        setLocale(payload.user.locale);
      }

      if (restoreUiSelection) {
        const saved = readSessionUiState();
        const foundChar = payload.characters.find((c) => c.id === saved.charId);
        if (foundChar) {
          setSelectedCharacterId(foundChar.id);
          setActiveTab(saved.tab);
        }
      }
      void loadZonesCatalog();
    },
    [loadZonesCatalog]
  );

  useEffect(() => {
    if (initialUser) return;
    let cancelled = false;
    const checkExistingSession = async () => {
      try {
        const res = await fetch(`${apiBaseUrl}/me`, {
          method: 'GET',
          credentials: 'include'
        });
        if (!res.ok || cancelled) {
          if (res.status === 401) {
            clearSessionUiState();
          }
          return;
        }
        const data = (await res.json()) as SessionMeResponseDto;
        if (!cancelled) {
          applySessionPayload(data, true);
        }
      } catch {
        // Unauthenticated or offline during initial boot
      }
    };
    void checkExistingSession();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, applySessionPayload, initialUser]);

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
      setPasswordInput('');
      setSelectedCharacterId(null);
      setActiveTab('dashboard');
      clearSessionUiState();
      applySessionPayload(sessionData, false);
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
      setActiveTab('dashboard');
      setSelectedCharacterId(createdChar.id);
      writeSessionUiState(createdChar.id, 'dashboard');
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
      clearSessionUiState();
      setUser(null);
      setCsrfToken('');
      setCharacters([]);
      setSelectedCharacterId(null);
      setActiveTab('dashboard');
      setZones([]);
      setIsLoading(false);
    }
  };

  const activeCharacter = characters.find((c) => c.id === selectedCharacterId) ?? null;

  return (
    <div data-testid="app-shell" data-locale={locale} className="app-shell">
      <header className="top-bar">
        <div className="brand-group">
          <GameIcon iconKey="crest" size={24} />
          <h1 data-testid="app-title" className="brand-title">
            {t(locale, 'app.title')}
          </h1>
        </div>

        <div className="top-actions">
          <span data-testid="language-label" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {t(locale, 'settings.language')}
          </span>
          {SUPPORTED_LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              className="btn"
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
              className="btn"
              data-testid="logout-button"
              disabled={isLoading}
              onClick={() => void handleLogout()}
            >
              {t(locale, 'auth.logout')}
            </button>
          )}
        </div>
      </header>

      <div className="game-workspace">
        <aside className="desktop-sidebar" data-testid="desktop-sidebar">
          <nav aria-label={t(locale, 'app.title')}>
            <ul className="sidebar-nav-list">
              {GAME_TABS.map((tab) => (
                <li key={tab.id}>
                  <button
                    type="button"
                    className="btn sidebar-nav-btn"
                    data-testid={tab.navTestId}
                    aria-pressed={activeTab === tab.id}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    onClick={() => navigateTab(tab.id)}
                  >
                    <GameIcon iconKey={tab.iconKey} size={18} />
                    <span>{t(locale, tab.labelKey)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <main className="center-panel">
          <p
            data-testid="scaffold-notice"
            style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}
          >
            {t(locale, 'app.scaffoldNotice')}
          </p>

          {isLoading && <p data-testid="loading-indicator">{t(locale, 'common.loading')}</p>}

          {errorKey && (
            <div
              role="alert"
              data-testid="error-banner"
              className="panel-card"
              style={{ borderColor: 'var(--hp-red)', color: '#fca5a5' }}
            >
              {t(locale, errorKey)}
            </div>
          )}

          {!user ? (
            <section data-testid="auth-panel" className="panel-card" style={{ maxWidth: '440px' }}>
              <h2 data-testid="auth-heading">
                {t(locale, authMode === 'login' ? 'auth.loginTitle' : 'auth.registerTitle')}
              </h2>
              <form
                onSubmit={(e) => void handleAuthSubmit(e)}
                style={{ display: 'grid', gap: '0.75rem' }}
              >
                <label className="form-field">
                  <span>{t(locale, 'auth.emailLabel')}</span>
                  <input
                    type="email"
                    required
                    className="form-input"
                    data-testid="auth-email-input"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                  />
                </label>
                <label className="form-field">
                  <span>{t(locale, 'auth.passwordLabel')}</span>
                  <input
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    className="form-input"
                    data-testid="auth-password-input"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="btn btn-primary"
                  data-testid="auth-submit-button"
                  disabled={isLoading}
                >
                  {t(locale, authMode === 'login' ? 'auth.submitLogin' : 'auth.submitRegister')}
                </button>
              </form>
              <div style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn"
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
          ) : !activeCharacter ? (
            <div
              data-testid="character-management"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '0.85rem'
              }}
            >
              <section data-testid="character-select-panel" className="panel-card">
                <h2>{t(locale, 'character.selectTitle')}</h2>
                <p data-testid="character-slots-indicator">
                  {t(locale, 'character.slotsUsed')}: {characters.length} / {maxCharacters}
                </p>
                {characters.length === 0 ? (
                  <p data-testid="no-characters-message">{t(locale, 'character.noCharacters')}</p>
                ) : (
                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: 0,
                      display: 'grid',
                      gap: '0.5rem'
                    }}
                  >
                    {characters.map((char) => (
                      <li
                        key={char.id}
                        data-testid={`character-item-${char.name}`}
                        className="sub-card"
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}
                      >
                        <span>
                          <strong>{char.name}</strong> (
                          {t(locale, VOCATION_KEY_MAP[char.vocation])} — {t(locale, 'stats.level')}{' '}
                          {char.stats.level})
                        </span>
                        <button
                          type="button"
                          className="btn btn-primary"
                          data-testid={`select-character-${char.name}`}
                          onClick={() => selectCharacter(char.id)}
                        >
                          {t(locale, 'character.selectAction')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {characters.length < maxCharacters && (
                <section data-testid="character-create-panel" className="panel-card">
                  <h2>{t(locale, 'character.createTitle')}</h2>
                  <form
                    onSubmit={(e) => void handleCreateCharacter(e)}
                    style={{ display: 'grid', gap: '0.75rem' }}
                  >
                    <label className="form-field">
                      <span>{t(locale, 'character.nameLabel')}</span>
                      <input
                        type="text"
                        required
                        minLength={3}
                        maxLength={20}
                        className="form-input"
                        data-testid="character-name-input"
                        value={charNameInput}
                        onChange={(e) => setCharNameInput(e.target.value)}
                      />
                    </label>
                    <label className="form-field">
                      <span>{t(locale, 'character.vocationLabel')}</span>
                      <select
                        className="form-input"
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
                      className="btn btn-primary"
                      data-testid="character-create-submit"
                      disabled={isLoading}
                    >
                      {t(locale, 'character.createSubmit')}
                    </button>
                  </form>
                </section>
              )}
            </div>
          ) : activeTab === 'hunts' ? (
            <HuntsView
              locale={locale}
              zones={zones}
              isLoading={zonesLoading}
              errorKey={zonesErrorKey}
              onRetry={() => void loadZonesCatalog()}
            />
          ) : activeTab === 'character' ? (
            <CharacterView locale={locale} character={activeCharacter} />
          ) : activeTab === 'inventory' ? (
            <InventoryView locale={locale} />
          ) : activeTab === 'bestiary' ? (
            <BestiaryView
              locale={locale}
              zones={zones}
              isLoading={zonesLoading}
              errorKey={zonesErrorKey}
              onRetry={() => void loadZonesCatalog()}
            />
          ) : (
            <DashboardView
              locale={locale}
              character={activeCharacter}
              onNavigateTab={navigateTab}
              onSwitchCharacter={() => selectCharacter(null)}
            />
          )}
        </main>

        <aside className="context-aside" data-testid="context-aside">
          <strong style={{ color: 'var(--accent-gold)', fontSize: '0.9rem' }}>
            {t(locale, 'dashboard.contextTitle')}
          </strong>
          {activeCharacter && (
            <div className="sub-card" data-testid="context-character-summary">
              <div>
                <strong>{activeCharacter.name}</strong> ({t(locale, 'stats.level')}{' '}
                {activeCharacter.stats.level})
              </div>
              <small style={{ color: 'var(--text-muted)' }}>
                {t(locale, 'dashboard.idleStatus')}
              </small>
            </div>
          )}
          <small style={{ color: 'var(--text-muted)' }}>
            {t(locale, 'dashboard.serverAuthorityNote')}
          </small>
        </aside>
      </div>

      <nav
        className="mobile-bottom-nav"
        aria-label={t(locale, 'app.title')}
        data-testid="mobile-bottom-nav"
      >
        <ul className="mobile-nav-list">
          {GAME_TABS.map((tab) => (
            <li key={tab.id}>
              <button
                type="button"
                className="mobile-nav-btn"
                data-testid={tab.mobileTestId}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                onClick={() => navigateTab(tab.id)}
              >
                <GameIcon iconKey={tab.iconKey} size={18} />
                <span className="mobile-nav-label">{t(locale, tab.labelKey)}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
