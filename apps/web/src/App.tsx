import {
  type CharacterDto,
  EQUIPMENT_SLOTS,
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
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { GameIcon } from './assets/assetRegistry.js';
import { BestiaryView } from './components/BestiaryView.js';
import { CharacterView } from './components/CharacterView.js';
import { DashboardView } from './components/DashboardView.js';
import { HuntsView } from './components/HuntsView.js';
import { InventoryView } from './components/InventoryView.js';
import {
  GameButton,
  GameLog,
  type GameLogEntry,
  GameTabs,
  GameWindow,
  ItemSlot,
  ProgressBar,
  StatRow
} from './components/ui/GameUi.js';
import {
  computeXpBarProgress,
  EQUIPMENT_SLOT_KEY_MAP,
  formatStatNumber,
  GAME_TABS,
  type GameTabId,
  isGameTabId,
  resolveErrorMessageKey,
  VOCATION_ICON_MAP,
  VOCATION_KEY_MAP
} from './lib/format.js';

const SESSION_STORAGE_AUTH_FLAG = 'tibia_idle_has_session';
const SESSION_STORAGE_CHAR_KEY = 'tibia_idle_ui_char_id';
const SESSION_STORAGE_TAB_KEY = 'tibia_idle_ui_tab_id';

function hasActiveSessionHint(): boolean {
  if (typeof window === 'undefined' || !window.sessionStorage) return false;
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_AUTH_FLAG) === '1';
  } catch {
    return false;
  }
}

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
    window.sessionStorage.setItem(SESSION_STORAGE_AUTH_FLAG, '1');
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
    window.sessionStorage.removeItem(SESSION_STORAGE_AUTH_FLAG);
    window.sessionStorage.removeItem(SESSION_STORAGE_CHAR_KEY);
    window.sessionStorage.removeItem(SESSION_STORAGE_TAB_KEY);
  } catch {
    // Ignore storage errors
  }
}

const MINI_BACKPACK_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

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

  const activeCharacter = characters.find((c) => c.id === selectedCharacterId) ?? null;

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
      } else {
        writeSessionUiState(null, 'dashboard');
      }
      void loadZonesCatalog();
    },
    [loadZonesCatalog]
  );

  useEffect(() => {
    if (initialUser || !hasActiveSessionHint()) return;
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

  const logEntries = useMemo<readonly GameLogEntry[]>(() => {
    const list: GameLogEntry[] = [
      {
        id: 'sys-boot',
        time: '00:00',
        channel: 'system',
        tone: 'info',
        text: t(locale, 'log.systemBoot')
      },
      {
        id: 'sys-authority',
        time: '00:00',
        channel: 'system',
        tone: 'Authority',
        text: t(locale, 'dashboard.serverAuthorityNote')
      }
    ];
    if (activeCharacter) {
      list.push({
        id: `sys-char-${activeCharacter.id}`,
        time: '00:01',
        channel: 'system',
        tone: 'info',
        text: `${t(locale, 'log.systemCharacterReady')} [${activeCharacter.name} — ${t(locale, 'stats.level')} ${activeCharacter.stats.level}]`
      });
    }
    return list;
  }, [activeCharacter, locale]);

  const xpProgress = activeCharacter
    ? computeXpBarProgress(activeCharacter.stats.level, activeCharacter.stats.xp)
    : null;
  const hpPercent = activeCharacter
    ? Math.min(
        100,
        Math.max(0, Math.floor((activeCharacter.stats.hp / Math.max(1, activeCharacter.stats.maxHp)) * 100))
      )
    : 0;
  const mpPercent =
    activeCharacter && activeCharacter.stats.maxMp > 0
      ? Math.min(
          100,
          Math.max(0, Math.floor((activeCharacter.stats.mp / activeCharacter.stats.maxMp) * 100))
        )
      : 0;

  return (
    <div data-testid="app-shell" data-locale={locale} className="app-shell">
      <header className="client-topbar">
        <div className="client-brand">
          <GameIcon iconKey="crest" size={16} />
          <h1 data-testid="app-title" className="client-brand-title">
            {t(locale, 'app.title')}
          </h1>
          <span className="client-status-pill" data-testid="connection-status">
            <span className="status-dot" />
            {t(locale, 'status.online')}
          </span>
          {activeCharacter && (
            <span className="client-active-char-pill" data-testid="topbar-character-badge">
              <strong>{activeCharacter.name}</strong> • {t(locale, 'stats.level')}{' '}
              {activeCharacter.stats.level}
            </span>
          )}
        </div>

        <div className="client-topbar-controls">
          <span data-testid="language-label" className="topbar-lang-label">
            {t(locale, 'settings.language')}:
          </span>
          {SUPPORTED_LOCALES.map((code) => (
            <GameButton
              key={code}
              size="sm"
              active={locale === code}
              testId={`lang-${code}`}
              aria-pressed={locale === code}
              onClick={() => void handleLanguageSwitch(code)}
            >
              {t(locale, code === 'pl' ? 'settings.localePl' : 'settings.localeEn')}
            </GameButton>
          ))}
          {user && (
            <GameButton
              size="sm"
              variant="danger"
              testId="logout-button"
              disabled={isLoading}
              onClick={() => void handleLogout()}
            >
              {t(locale, 'auth.logout')}
            </GameButton>
          )}
        </div>
      </header>

      {!user ? (
        <main className="auth-stage">
          <div className="auth-window-container">
            <p data-testid="scaffold-notice" className="client-scaffold-line">
              {t(locale, 'app.scaffoldNotice')}
            </p>

            {isLoading && <p data-testid="loading-indicator">{t(locale, 'common.loading')}</p>}

            {errorKey && (
              <div role="alert" data-testid="error-banner" className="game-alert-box">
                {t(locale, errorKey)}
              </div>
            )}

            <GameWindow
              title={t(locale, 'app.title')}
              iconKey="shield"
              testId="auth-panel"
            >
              <h2 data-testid="auth-heading" className="auth-window-heading">
                {t(locale, authMode === 'login' ? 'auth.loginTitle' : 'auth.registerTitle')}
              </h2>
              <form onSubmit={(e) => void handleAuthSubmit(e)} className="client-form">
                <label className="client-form-field">
                  <span>{t(locale, 'auth.emailLabel')}</span>
                  <input
                    type="email"
                    required
                    className="client-input"
                    data-testid="auth-email-input"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                  />
                </label>
                <label className="client-form-field">
                  <span>{t(locale, 'auth.passwordLabel')}</span>
                  <input
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    className="client-input"
                    data-testid="auth-password-input"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                  />
                </label>
                <div className="client-form-actions">
                  <GameButton
                    type="submit"
                    variant="primary"
                    testId="auth-submit-button"
                    disabled={isLoading}
                  >
                    {t(locale, authMode === 'login' ? 'auth.submitLogin' : 'auth.submitRegister')}
                  </GameButton>
                  <GameButton
                    testId="auth-mode-toggle"
                    onClick={() => {
                      setErrorKey(null);
                      setAuthMode((prev) => (prev === 'login' ? 'register' : 'login'));
                    }}
                  >
                    {t(
                      locale,
                      authMode === 'login' ? 'auth.switchToRegister' : 'auth.switchToLogin'
                    )}
                  </GameButton>
                </div>
              </form>
            </GameWindow>
          </div>
        </main>
      ) : (
        <div className="client-main-frame">
          <div className="game-workspace">
            <aside className="desktop-sidebar" data-testid="desktop-sidebar">
              {activeCharacter && xpProgress && (
                <>
                  <GameWindow
                    title={t(locale, 'window.characterStatus')}
                    iconKey={VOCATION_ICON_MAP[activeCharacter.vocation]}
                    iconCategory="vocation"
                    collapsible
                    minimizeLabel={t(locale, 'window.minimize')}
                    expandLabel={t(locale, 'window.expand')}
                  >
                    <div className="sidebar-char-summary">
                      <strong>{activeCharacter.name}</strong>
                      <span>
                        {t(locale, VOCATION_KEY_MAP[activeCharacter.vocation])} •{' '}
                        {t(locale, 'stats.level')} {activeCharacter.stats.level}
                      </span>
                    </div>
                    <div className="sidebar-bars-stack">
                      <ProgressBar
                        variant="hp"
                        percent={hpPercent}
                        label="HP"
                        valueText={`${activeCharacter.stats.hp}/${activeCharacter.stats.maxHp}`}
                      />
                      <ProgressBar
                        variant="mana"
                        percent={mpPercent}
                        label="MP"
                        valueText={`${activeCharacter.stats.mp}/${activeCharacter.stats.maxMp}`}
                      />
                      <ProgressBar
                        variant="xp"
                        percent={xpProgress.percent}
                        label="EXP"
                        valueText={`${xpProgress.percent}%`}
                      />
                    </div>
                  </GameWindow>

                  <GameWindow
                    title={t(locale, 'window.skills')}
                    iconKey="swords"
                    collapsible
                    minimizeLabel={t(locale, 'window.minimize')}
                    expandLabel={t(locale, 'window.expand')}
                  >
                    <dl className="mmo-stat-list">
                      <StatRow
                        label={t(locale, 'stats.magic')}
                        value={activeCharacter.stats.magic}
                      />
                      <StatRow
                        label={t(locale, 'stats.melee')}
                        value={activeCharacter.stats.melee}
                      />
                      <StatRow
                        label={t(locale, 'stats.distance')}
                        value={activeCharacter.stats.distance}
                      />
                      <StatRow
                        label={t(locale, 'stats.shielding')}
                        value={activeCharacter.stats.shielding}
                      />
                      <StatRow
                        label={t(locale, 'stats.gold')}
                        value={formatStatNumber(activeCharacter.stats.gold, locale)}
                        highlight
                      />
                    </dl>
                  </GameWindow>
                </>
              )}

              <GameWindow
                title={t(locale, 'window.navigation')}
                iconKey="crest"
                collapsible
                minimizeLabel={t(locale, 'window.minimize')}
                expandLabel={t(locale, 'window.expand')}
              >
                <nav aria-label={t(locale, 'app.title')}>
                  <ul className="sidebar-nav-list">
                    {GAME_TABS.map((tab) => (
                      <li key={tab.id}>
                        <button
                          type="button"
                          className={`sidebar-nav-btn ${activeTab === tab.id ? 'is-active' : ''}`.trim()}
                          data-testid={tab.navTestId}
                          aria-pressed={activeTab === tab.id}
                          aria-current={activeTab === tab.id ? 'page' : undefined}
                          onClick={() => navigateTab(tab.id)}
                        >
                          <GameIcon iconKey={tab.iconKey} size={15} />
                          <span>{t(locale, tab.labelKey)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              </GameWindow>
            </aside>

            <main className="center-panel">
              <div className="center-status-strip">
                <span data-testid="scaffold-notice" className="client-scaffold-line">
                  {t(locale, 'app.scaffoldNotice')}
                </span>
                {activeCharacter && (
                  <GameTabs
                    tabs={GAME_TABS.map((tab) => ({
                      id: tab.id,
                      label: t(locale, tab.labelKey),
                      iconKey: tab.iconKey
                    }))}
                    activeTab={activeTab}
                    onSelectTab={navigateTab}
                    ariaLabel={t(locale, 'window.navigation')}
                    testId="center-module-tabs"
                  />
                )}
              </div>

              {isLoading && <p data-testid="loading-indicator">{t(locale, 'common.loading')}</p>}

              {errorKey && (
                <div role="alert" data-testid="error-banner" className="game-alert-box">
                  {t(locale, errorKey)}
                </div>
              )}

              {!activeCharacter ? (
                <div data-testid="character-management" className="character-lobby-grid">
                  <GameWindow
                    title={t(locale, 'character.selectTitle')}
                    iconKey="helmet"
                    testId="character-select-panel"
                  >
                    <p data-testid="character-slots-indicator" className="window-muted-note">
                      {t(locale, 'character.slotsUsed')}: {characters.length} / {maxCharacters}
                    </p>
                    {characters.length === 0 ? (
                      <p data-testid="no-characters-message" className="window-muted-note">
                        {t(locale, 'character.noCharacters')}
                      </p>
                    ) : (
                      <ul className="character-roster-list">
                        {characters.map((char) => (
                          <li
                            key={char.id}
                            data-testid={`character-item-${char.name}`}
                            className="character-roster-row"
                          >
                            <div className="character-roster-info">
                              <GameIcon
                                iconKey={VOCATION_ICON_MAP[char.vocation]}
                                category="vocation"
                                size={16}
                              />
                              <span>
                                <strong>{char.name}</strong> (
                                {t(locale, VOCATION_KEY_MAP[char.vocation])} —{' '}
                                {t(locale, 'stats.level')} {char.stats.level})
                              </span>
                            </div>
                            <GameButton
                              variant="primary"
                              size="sm"
                              testId={`select-character-${char.name}`}
                              onClick={() => selectCharacter(char.id)}
                            >
                              {t(locale, 'character.selectAction')}
                            </GameButton>
                          </li>
                        ))}
                      </ul>
                    )}
                  </GameWindow>

                  {characters.length < maxCharacters && (
                    <GameWindow
                      title={t(locale, 'character.createTitle')}
                      iconKey="sword"
                      testId="character-create-panel"
                    >
                      <form onSubmit={(e) => void handleCreateCharacter(e)} className="client-form">
                        <label className="client-form-field">
                          <span>{t(locale, 'character.nameLabel')}</span>
                          <input
                            type="text"
                            required
                            minLength={3}
                            maxLength={20}
                            className="client-input"
                            data-testid="character-name-input"
                            value={charNameInput}
                            onChange={(e) => setCharNameInput(e.target.value)}
                          />
                        </label>
                        <label className="client-form-field">
                          <span>{t(locale, 'character.vocationLabel')}</span>
                          <select
                            className="client-input"
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
                        <GameButton
                          type="submit"
                          variant="primary"
                          testId="character-create-submit"
                          disabled={isLoading}
                        >
                          {t(locale, 'character.createSubmit')}
                        </GameButton>
                      </form>
                    </GameWindow>
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
              <GameWindow
                title={t(locale, 'window.equipment')}
                iconKey="armor"
                iconCategory="equipment"
                collapsible
                minimizeLabel={t(locale, 'window.minimize')}
                expandLabel={t(locale, 'window.expand')}
              >
                <div className="dock-paperdoll-grid">
                  {EQUIPMENT_SLOTS.map((slot) => (
                    <ItemSlot
                      key={slot}
                      slotId={`dock-${slot}`}
                      label={t(locale, EQUIPMENT_SLOT_KEY_MAP[slot])}
                      iconKey={slot}
                      category="equipment"
                      state="empty"
                      onSelect={() => navigateTab('inventory')}
                    />
                  ))}
                </div>
              </GameWindow>

              <GameWindow
                title={t(locale, 'window.backpack')}
                iconKey="chest"
                iconCategory="equipment"
                collapsible
                minimizeLabel={t(locale, 'window.minimize')}
                expandLabel={t(locale, 'window.expand')}
              >
                <div className="dock-backpack-grid">
                  {MINI_BACKPACK_SLOTS.map((idx) => (
                    <ItemSlot
                      key={idx}
                      slotId={`dock-bp-${idx}`}
                      label={`${t(locale, 'inventory.slotEmpty')} #${idx}`}
                      iconKey="chest"
                      category="equipment"
                      state="empty"
                      onSelect={() => navigateTab('inventory')}
                    />
                  ))}
                </div>
              </GameWindow>

              <GameWindow
                title={t(locale, 'dashboard.contextTitle')}
                iconKey="crest"
                collapsible
                minimizeLabel={t(locale, 'window.minimize')}
                expandLabel={t(locale, 'window.expand')}
              >
                {activeCharacter && (
                  <div className="dock-status-box" data-testid="context-character-summary">
                    <div>
                      <strong>{activeCharacter.name}</strong> ({t(locale, 'stats.level')}{' '}
                      {activeCharacter.stats.level})
                    </div>
                    <small>{t(locale, 'dashboard.idleStatus')}</small>
                  </div>
                )}
                <p className="window-muted-note">{t(locale, 'dashboard.serverAuthorityNote')}</p>
              </GameWindow>
            </aside>
          </div>

          <GameLog locale={locale} entries={logEntries} />
        </div>
      )}

      {user && (
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
                  <GameIcon iconKey={tab.iconKey} size={16} />
                  <span className="mobile-nav-label">{t(locale, tab.labelKey)}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
