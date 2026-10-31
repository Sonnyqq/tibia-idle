import {
  type ActiveHuntDto,
  type ActiveHuntResponseDto,
  type BuyNpcProductResponseDto,
  type CharacterDto,
  type CharacterEquipmentResponseDto,
  type CharacterHuntRewardItemDto,
  type CharacterHuntRewardsResponseDto,
  type CharacterInventoryResponseDto,
  type ClaimHuntRewardResponseDto,
  EQUIPMENT_SLOTS,
  type EquipmentSlot,
  type EquipItemResponseDto,
  type HuntSegmentsResponseDto,
  type HuntStrategyDto,
  type MoveInventoryItemResponseDto,
  type NpcShopHistoryResponseDto,
  type NpcTransactionDto,
  type SellNpcItemResponseDto,
  type SessionMeResponseDto,
  type SettleHuntResponseDto,
  type SplitInventoryStackResponseDto,
  type StartHuntResponseDto,
  type StopHuntResponseDto,
  type UnequipItemResponseDto,
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
import { NpcShopView } from './components/NpcShopView.js';
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

function generateClientUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const memoryPendingKeys = new Map<string, string>();

export function getPendingHuntKey(
  characterId: string,
  op: 'start' | 'settle' | 'stop' | 'claim' | 'move' | 'split' | 'equip' | 'unequip' | 'shopBuy' | 'shopSell',
  huntId?: string
): string | null {
  const storageKey = `tibia_idle_pending_op:${characterId}:${op}${huntId ? `:${huntId}` : ''}`;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      return window.sessionStorage.getItem(storageKey);
    } catch {
      // Fallback to memory
    }
  }
  return memoryPendingKeys.get(storageKey) ?? null;
}

export function setPendingHuntKey(
  characterId: string,
  op: 'start' | 'settle' | 'stop' | 'claim' | 'move' | 'split' | 'equip' | 'unequip' | 'shopBuy' | 'shopSell',
  idempotencyKey: string,
  huntId?: string
): void {
  const storageKey = `tibia_idle_pending_op:${characterId}:${op}${huntId ? `:${huntId}` : ''}`;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(storageKey, idempotencyKey);
    } catch {
      // Ignore storage quota
    }
  }
  memoryPendingKeys.set(storageKey, idempotencyKey);
}

export function clearPendingHuntKey(
  characterId: string,
  op: 'start' | 'settle' | 'stop' | 'claim' | 'move' | 'split' | 'equip' | 'unequip' | 'shopBuy' | 'shopSell',
  huntId?: string
): void {
  const storageKey = `tibia_idle_pending_op:${characterId}:${op}${huntId ? `:${huntId}` : ''}`;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore storage errors
    }
  }
  memoryPendingKeys.delete(storageKey);
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

  const [activeHunt, setActiveHunt] = useState<ActiveHuntDto | null>(null);
  const [activeHuntLoading, setActiveHuntLoading] = useState<boolean>(false);
  const [huntActionLoading, setHuntActionLoading] = useState<boolean>(false);
  const [huntReport, setHuntReport] = useState<HuntSegmentsResponseDto | null>(null);
  const [latestCompletedHuntId, setLatestCompletedHuntId] = useState<string | null>(null);
  const [rewardItems, setRewardItems] = useState<readonly CharacterHuntRewardItemDto[]>([]);
  const [inventory, setInventory] = useState<CharacterInventoryResponseDto | null>(null);
  const [equipment, setEquipment] = useState<CharacterEquipmentResponseDto | null>(null);
  const [claimingRewardId, setClaimingRewardId] = useState<string | null>(null);
  const [inventoryActionLoading, setInventoryActionLoading] = useState<boolean>(false);
  const [shopHistory, setShopHistory] = useState<readonly NpcTransactionDto[]>([]);
  const [dynamicLogEntries, setDynamicLogEntries] = useState<GameLogEntry[]>([]);

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
        const foundChar =
          payload.characters.find((c) => c.id === saved.charId) ?? payload.characters[0] ?? null;
        if (foundChar) {
          setSelectedCharacterId(foundChar.id);
          setActiveTab(saved.charId ? saved.tab : 'dashboard');
        }
      } else {
        writeSessionUiState(null, 'dashboard');
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
      setActiveHunt(null);
      setRewardItems([]);
      setInventory(null);
      setEquipment(null);
      setHuntReport(null);
      setIsLoading(false);
    }
  };

  const fetchActiveHunt = useCallback(
    async (charId: string) => {
      setActiveHuntLoading(true);
      try {
        const res = await fetch(`${apiBaseUrl}/hunts/active?characterId=${charId}`, {
          method: 'GET',
          credentials: 'include'
        });
        if (res.ok) {
          const data = (await res.json()) as ActiveHuntResponseDto;
          setActiveHunt(data.hunt);
          setLatestCompletedHuntId(data.latestCompletedHuntId);
          if (data.active && data.hunt) {
            clearPendingHuntKey(charId, 'start');
          }
          return data;
        }
      } catch {
        // Network or offline
      } finally {
        setActiveHuntLoading(false);
      }
      return null;
    },
    [apiBaseUrl]
  );

  const fetchRewardItems = useCallback(
    async (charId: string) => {
      try {
        const res = await fetch(`${apiBaseUrl}/characters/${charId}/hunt-rewards`, {
          method: 'GET',
          credentials: 'include'
        });
        if (res.ok) {
          const data = (await res.json()) as CharacterHuntRewardsResponseDto;
          setRewardItems(data.items);
        }
      } catch {
        // Network error
      }
    },
    [apiBaseUrl]
  );

  const fetchInventory = useCallback(
    async (charId: string) => {
      try {
        const res = await fetch(`${apiBaseUrl}/characters/${charId}/inventory`, {
          method: 'GET',
          credentials: 'include'
        });
        if (res.ok) {
          const data = (await res.json()) as CharacterInventoryResponseDto;
          setInventory(data);
          return data;
        }
      } catch {
        // Network error
      }
      return null;
    },
    [apiBaseUrl]
  );

  const fetchEquipment = useCallback(
    async (charId: string) => {
      try {
        const res = await fetch(`${apiBaseUrl}/characters/${charId}/equipment`, {
          method: 'GET',
          credentials: 'include'
        });
        if (res.ok) {
          const data = (await res.json()) as CharacterEquipmentResponseDto;
          setEquipment(data);
          return data;
        }
      } catch {
        // Network error
      }
      return null;
    },
    [apiBaseUrl]
  );

  const fetchShopHistory = useCallback(
    async (charId: string) => {
      try {
        const res = await fetch(`${apiBaseUrl}/characters/${charId}/npc-shop/history`, {
          credentials: 'include'
        });
        if (res.ok) {
          const data = (await res.json()) as NpcShopHistoryResponseDto;
          setShopHistory(data.transactions);
        }
      } catch {
        // ignore
      }
    },
    [apiBaseUrl]
  );

  const handleOpenLatestReport = useCallback(async () => {
    if (!latestCompletedHuntId) return;
    setHuntActionLoading(true);
    try {
      const repRes = await fetch(`${apiBaseUrl}/hunts/${latestCompletedHuntId}/segments`, {
        method: 'GET',
        credentials: 'include'
      });
      if (repRes.ok) {
        const repData = (await repRes.json()) as HuntSegmentsResponseDto;
        setHuntReport(repData);
      }
    } catch {
      setErrorKey('common.error');
    } finally {
      setHuntActionLoading(false);
    }
  }, [apiBaseUrl, latestCompletedHuntId]);

  useEffect(() => {
    if (!activeCharacter) {
      setActiveHunt(null);
      setLatestCompletedHuntId(null);
      setRewardItems([]);
      setInventory(null);
      setEquipment(null);
      return;
    }
    void fetchActiveHunt(activeCharacter.id);
    void fetchRewardItems(activeCharacter.id);
    void fetchInventory(activeCharacter.id);
    void fetchEquipment(activeCharacter.id);
    void fetchShopHistory(activeCharacter.id);
  }, [activeCharacter?.id, fetchActiveHunt, fetchRewardItems, fetchInventory, fetchEquipment, fetchShopHistory]);

  useEffect(() => {
    if (!activeCharacter) return;
    if (activeTab === 'inventory' || activeTab === 'character') {
      void fetchInventory(activeCharacter.id);
      void fetchRewardItems(activeCharacter.id);
      void fetchEquipment(activeCharacter.id);
    } else if (activeTab === 'shop') {
      void fetchShopHistory(activeCharacter.id);
      void fetchInventory(activeCharacter.id);
    } else if (activeTab === 'hunts') {
      void fetchActiveHunt(activeCharacter.id);
      void fetchRewardItems(activeCharacter.id);
    }
  }, [activeTab, activeCharacter?.id, fetchInventory, fetchRewardItems, fetchActiveHunt, fetchEquipment, fetchShopHistory]);

  useEffect(() => {
    if (!activeCharacter) return;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void fetchActiveHunt(activeCharacter.id);
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, [activeCharacter?.id, fetchActiveHunt]);

  const handleStartHunt = async (params: {
    zoneId: string;
    strategy: HuntStrategyDto;
    hpPotions: number;
    mpPotions: number;
  }) => {
    if (!activeCharacter || !csrfToken || huntActionLoading) return;
    setHuntActionLoading(true);
    setErrorKey(null);
    try {
      if (activeHunt) {
        setHuntActionLoading(false);
        return;
      }

      const key =
        getPendingHuntKey(activeCharacter.id, 'start') || generateClientUUID();
      setPendingHuntKey(activeCharacter.id, 'start', key);

      const res = await fetch(`${apiBaseUrl}/hunts/start`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({
          characterId: activeCharacter.id,
          zoneId: params.zoneId,
          strategy: params.strategy,
          hpPotions: params.hpPotions,
          mpPotions: params.mpPotions,
          idempotencyKey: key
        })
      });

      if (!res.ok) {
        // Recovery check: if 409 conflict, check if hunt was actually created on server
        if (res.status === 409) {
          const activeCheck = await fetchActiveHunt(activeCharacter.id);
          if (activeCheck?.active && activeCheck.hunt) {
            clearPendingHuntKey(activeCharacter.id, 'start');
            await fetchRewardItems(activeCharacter.id);
            return;
          }
        }
        const errBody = (await res.json().catch(() => null)) as {
          error?: { messageKey?: string };
        } | null;
        setErrorKey(resolveErrorMessageKey(errBody?.error?.messageKey));
        return;
      }

      const data = (await res.json()) as StartHuntResponseDto;
      setCharacters((prev) =>
        prev.map((c) => (c.id === data.character.id ? data.character : c))
      );
      await fetchActiveHunt(activeCharacter.id);
      await fetchRewardItems(activeCharacter.id);

      // ONLY after successful response parsing and state application: clear pending start key
      clearPendingHuntKey(activeCharacter.id, 'start');

      if (!data.idempotentReplay) {
        const nowTime = new Date().toLocaleTimeString(locale === 'pl' ? 'pl-PL' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit'
        });
        setDynamicLogEntries((prev) => [
          ...prev,
          {
            id: `hunt-start-${Date.now()}`,
            time: nowTime,
            channel: 'hunt',
            tone: 'info',
            text: t(locale, 'hunt.logStarted')
          }
        ]);
      }
    } catch {
      // Network drop recovery: probe server before displaying error
      try {
        const activeCheck = await fetchActiveHunt(activeCharacter.id);
        if (activeCheck?.active && activeCheck.hunt) {
          clearPendingHuntKey(activeCharacter.id, 'start');
          await fetchRewardItems(activeCharacter.id);
          return;
        }
      } catch {
        // Server unreachable
      }
      setErrorKey('common.error');
    } finally {
      setHuntActionLoading(false);
    }
  };

  const handleSettleHunt = async () => {
    if (!activeHunt || !csrfToken || !activeCharacter || huntActionLoading) return;
    setHuntActionLoading(true);
    setErrorKey(null);
    try {
      const key =
        getPendingHuntKey(activeCharacter.id, 'settle', activeHunt.huntId) || generateClientUUID();
      setPendingHuntKey(activeCharacter.id, 'settle', key, activeHunt.huntId);

      const res = await fetch(`${apiBaseUrl}/hunts/${activeHunt.huntId}/settle`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({
          idempotencyKey: key
        })
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as {
          error?: { messageKey?: string };
        } | null;
        setErrorKey(resolveErrorMessageKey(errBody?.error?.messageKey));
        return;
      }

      const data = (await res.json()) as SettleHuntResponseDto;
      setCharacters((prev) =>
        prev.map((c) => (c.id === data.character.id ? data.character : c))
      );
      await fetchActiveHunt(activeCharacter.id);
      await fetchRewardItems(activeCharacter.id);

      // ONLY after successful response parsing and state application: clear the pending key!
      clearPendingHuntKey(activeCharacter.id, 'settle', activeHunt.huntId);

      // Idempotent replay NEVER adds duplicate rewards log entries
      if (!data.idempotentReplay) {
        const nowTime = new Date().toLocaleTimeString(locale === 'pl' ? 'pl-PL' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit'
        });
        setDynamicLogEntries((prev) => [
          ...prev,
          {
            id: `hunt-settle-${data.segmentId ?? Date.now()}`,
            time: nowTime,
            channel: 'hunt',
            tone: 'info',
            text: `${t(locale, 'hunt.logSettled')} (+${data.rewards.deltaXpGained} XP, +${data.rewards.deltaGoldGained} G, ${data.rewards.deltaKills} kills)`
          }
        ]);
      }
    } catch {
      setErrorKey('common.error');
    } finally {
      setHuntActionLoading(false);
    }
  };

  const handleStopHunt = async () => {
    if (!activeHunt || !csrfToken || !activeCharacter || huntActionLoading) return;
    setHuntActionLoading(true);
    setErrorKey(null);
    try {
      const huntId = activeHunt.huntId;
      const key =
        getPendingHuntKey(activeCharacter.id, 'stop', huntId) || generateClientUUID();
      setPendingHuntKey(activeCharacter.id, 'stop', key, huntId);

      const res = await fetch(`${apiBaseUrl}/hunts/${huntId}/stop`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({
          idempotencyKey: key
        })
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as {
          error?: { messageKey?: string };
        } | null;
        setErrorKey(resolveErrorMessageKey(errBody?.error?.messageKey));
        return;
      }

      const data = (await res.json()) as StopHuntResponseDto;
      setCharacters((prev) =>
        prev.map((c) => (c.id === data.character.id ? data.character : c))
      );

      // ONLY after successful response parsing: clear pending key for this stop step
      clearPendingHuntKey(activeCharacter.id, 'stop', huntId);

      if (data.status === 'STOP_CONTINUATION_REQUIRED' || data.continuationRequired) {
        // P0: Do NOT clear active hunt; do NOT open completed report; show stopping in progress
        await fetchActiveHunt(activeCharacter.id);
        const nowTime = new Date().toLocaleTimeString(locale === 'pl' ? 'pl-PL' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit'
        });
        setDynamicLogEntries((prev) => [
          ...prev,
          {
            id: `hunt-stopping-${Date.now()}`,
            time: nowTime,
            channel: 'hunt',
            tone: 'info',
            text: t(locale, 'hunt.stoppingInProgress')
          }
        ]);
        return;
      }

      // Final stop succeeded (COMPLETED or ALREADY_COMPLETED)
      setActiveHunt(null);
      setLatestCompletedHuntId(huntId);

      // Fetch summary segments for report window
      const repRes = await fetch(`${apiBaseUrl}/hunts/${huntId}/segments`, {
        method: 'GET',
        credentials: 'include'
      });
      if (repRes.ok) {
        const repData = (await repRes.json()) as HuntSegmentsResponseDto;
        setHuntReport(repData);
      }

      await fetchRewardItems(activeCharacter.id);

      if (!data.alreadyCompleted) {
        const nowTime = new Date().toLocaleTimeString(locale === 'pl' ? 'pl-PL' : 'en-US', {
          hour: '2-digit',
          minute: '2-digit'
        });
        setDynamicLogEntries((prev) => [
          ...prev,
          {
            id: `hunt-stop-${Date.now()}`,
            time: nowTime,
            channel: 'hunt',
            tone: 'info',
            text: t(locale, 'hunt.logCompleted')
          }
        ]);
      }
    } catch {
      setErrorKey('common.error');
    } finally {
      setHuntActionLoading(false);
    }
  };

  const handleClaimReward = useCallback(
    async (rewardId: string) => {
      if (!activeCharacter || !csrfToken || claimingRewardId) return;
      setClaimingRewardId(rewardId);
      setErrorKey(null);

      const idempotencyKey =
        getPendingHuntKey(activeCharacter.id, 'claim', rewardId) || generateClientUUID();
      setPendingHuntKey(activeCharacter.id, 'claim', idempotencyKey, rewardId);

      try {
        const res = await fetch(
          `${apiBaseUrl}/characters/${activeCharacter.id}/hunt-rewards/${rewardId}/claim`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': csrfToken
            },
            body: JSON.stringify({ idempotencyKey })
          }
        );

        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as {
            error?: { messageKey?: string };
          } | null;
          setErrorKey((errBody?.error?.messageKey as TranslationKey) ?? 'common.error');
          return;
        }

        const data = (await res.json()) as ClaimHuntRewardResponseDto;
        clearPendingHuntKey(activeCharacter.id, 'claim', rewardId);
        setInventory(data.inventory);
        await fetchRewardItems(activeCharacter.id);

        if (!data.idempotentReplay) {
          const nowTime = new Date().toLocaleTimeString(locale === 'pl' ? 'pl-PL' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit'
          });
          const itemName = t(locale, data.claimedItem.nameKey as TranslationKey);
          setDynamicLogEntries((prev) => [
            ...prev,
            {
              id: `claim-${Date.now()}-${data.claimedItem.id}`,
              time: nowTime,
              channel: 'loot',
              tone: 'info',
              text: `${t(locale, 'inventory.rewardClaimedSuccess')}: ${itemName} (x${data.claimedItem.quantity})`
            }
          ]);
        }
      } catch {
        setErrorKey('common.error');
      } finally {
        setClaimingRewardId(null);
      }
    },
    [activeCharacter, csrfToken, claimingRewardId, apiBaseUrl, locale, fetchRewardItems]
  );

  const handleMoveItem = useCallback(
    async (fromSlot: number, toSlot: number) => {
      if (!activeCharacter || !csrfToken || inventoryActionLoading) return;
      setInventoryActionLoading(true);
      setErrorKey(null);

      const opKey = `${fromSlot}->${toSlot}`;
      const idempotencyKey =
        getPendingHuntKey(activeCharacter.id, 'move', opKey) || generateClientUUID();
      setPendingHuntKey(activeCharacter.id, 'move', idempotencyKey, opKey);

      try {
        const res = await fetch(`${apiBaseUrl}/characters/${activeCharacter.id}/inventory/move`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify({ fromSlot, toSlot, idempotencyKey })
        });

        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as {
            error?: { messageKey?: string };
          } | null;
          setErrorKey((errBody?.error?.messageKey as TranslationKey) ?? 'common.error');
          return;
        }

        const data = (await res.json()) as MoveInventoryItemResponseDto;
        clearPendingHuntKey(activeCharacter.id, 'move', opKey);
        setInventory(data.inventory);
      } catch {
        setErrorKey('common.error');
      } finally {
        setInventoryActionLoading(false);
      }
    },
    [activeCharacter, csrfToken, inventoryActionLoading, apiBaseUrl]
  );

  const handleSplitStack = useCallback(
    async (fromSlot: number, toSlot: number, quantity: number) => {
      if (!activeCharacter || !csrfToken || inventoryActionLoading) return;
      setInventoryActionLoading(true);
      setErrorKey(null);

      const opKey = `${fromSlot}->${toSlot}:${quantity}`;
      const idempotencyKey =
        getPendingHuntKey(activeCharacter.id, 'split', opKey) || generateClientUUID();
      setPendingHuntKey(activeCharacter.id, 'split', idempotencyKey, opKey);

      try {
        const res = await fetch(`${apiBaseUrl}/characters/${activeCharacter.id}/inventory/split`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify({ fromSlot, toSlot, quantity, idempotencyKey })
        });

        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as {
            error?: { messageKey?: string };
          } | null;
          setErrorKey((errBody?.error?.messageKey as TranslationKey) ?? 'common.error');
          return;
        }

        const data = (await res.json()) as SplitInventoryStackResponseDto;
        clearPendingHuntKey(activeCharacter.id, 'split', opKey);
        setInventory(data.inventory);
      } catch {
        setErrorKey('common.error');
      } finally {
        setInventoryActionLoading(false);
      }
    },
    [activeCharacter, csrfToken, inventoryActionLoading, apiBaseUrl]
  );

  const handleEquipItem = useCallback(
    async (backpackSlot: number, equipmentSlot?: EquipmentSlot) => {
      if (!activeCharacter || !csrfToken || inventoryActionLoading) return;
      setInventoryActionLoading(true);
      setErrorKey(null);

      const opKey = `${backpackSlot}->${equipmentSlot ?? 'auto'}`;
      const idempotencyKey =
        getPendingHuntKey(activeCharacter.id, 'equip', opKey) || generateClientUUID();
      setPendingHuntKey(activeCharacter.id, 'equip', idempotencyKey, opKey);

      try {
        const res = await fetch(`${apiBaseUrl}/characters/${activeCharacter.id}/equipment/equip`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify({ backpackSlot, equipmentSlot, idempotencyKey })
        });

        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as {
            error?: { messageKey?: string };
          } | null;
          setErrorKey((errBody?.error?.messageKey as TranslationKey) ?? 'common.error');
          return;
        }

        const data = (await res.json()) as EquipItemResponseDto;
        clearPendingHuntKey(activeCharacter.id, 'equip', opKey);
        setInventory(data.inventory);
        setEquipment(data.equipment);
      } catch {
        setErrorKey('common.error');
      } finally {
        setInventoryActionLoading(false);
      }
    },
    [activeCharacter, csrfToken, inventoryActionLoading, apiBaseUrl]
  );

  const handleUnequipItem = useCallback(
    async (equipmentSlot: EquipmentSlot, targetBackpackSlot?: number) => {
      if (!activeCharacter || !csrfToken || inventoryActionLoading) return;
      setInventoryActionLoading(true);
      setErrorKey(null);

      const opKey = `${equipmentSlot}->${targetBackpackSlot ?? 'auto'}`;
      const idempotencyKey =
        getPendingHuntKey(activeCharacter.id, 'unequip', opKey) || generateClientUUID();
      setPendingHuntKey(activeCharacter.id, 'unequip', idempotencyKey, opKey);

      try {
        const res = await fetch(
          `${apiBaseUrl}/characters/${activeCharacter.id}/equipment/unequip`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': csrfToken
            },
            body: JSON.stringify({ equipmentSlot, targetBackpackSlot, idempotencyKey })
          }
        );

        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as {
            error?: { messageKey?: string };
          } | null;
          setErrorKey((errBody?.error?.messageKey as TranslationKey) ?? 'common.error');
          return;
        }

        const data = (await res.json()) as UnequipItemResponseDto;
        clearPendingHuntKey(activeCharacter.id, 'unequip', opKey);
        setInventory(data.inventory);
        setEquipment(data.equipment);
      } catch {
        setErrorKey('common.error');
      } finally {
        setInventoryActionLoading(false);
      }
    },
    [activeCharacter, csrfToken, inventoryActionLoading, apiBaseUrl]
  );

  const handleBuyShopProduct = useCallback(
    async (offerId: string, quantity: number) => {
      if (!activeCharacter || !csrfToken || inventoryActionLoading) return;
      setInventoryActionLoading(true);
      setErrorKey(null);

      const opKey = `${offerId}:${quantity}`;
      const idempotencyKey =
        getPendingHuntKey(activeCharacter.id, 'shopBuy', opKey) || generateClientUUID();
      setPendingHuntKey(activeCharacter.id, 'shopBuy', idempotencyKey, opKey);

      try {
        const res = await fetch(
          `${apiBaseUrl}/characters/${activeCharacter.id}/npc-shop/buy`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': csrfToken
            },
            body: JSON.stringify({ offerId, quantity, idempotencyKey })
          }
        );

        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as {
            error?: { messageKey?: string };
          } | null;
          setErrorKey((errBody?.error?.messageKey as TranslationKey) ?? 'common.error');
          return;
        }

        const data = (await res.json()) as BuyNpcProductResponseDto;
        clearPendingHuntKey(activeCharacter.id, 'shopBuy', opKey);

        setCharacters((prev) =>
          prev.map((c) =>
            c.id === activeCharacter.id
              ? {
                  ...c,
                  hpPotions: data.productId === 'health-potion' ? data.newPotionCount : c.hpPotions,
                  mpPotions: data.productId === 'mana-potion' ? data.newPotionCount : c.mpPotions,
                  stats: {
                    ...c.stats,
                    gold: data.newGoldBalance
                  }
                }
              : c
          )
        );

        if (!data.idempotentReplay) {
          const nowTime = new Date().toLocaleTimeString(locale === 'pl' ? 'pl-PL' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
          const itemName = t(
            locale,
            data.productId === 'health-potion' ? 'shop.healthPotion' : 'shop.manaPotion'
          );
          setDynamicLogEntries((prev) => [
            ...prev,
            {
              id: `shop-buy-${Date.now()}`,
              time: nowTime,
              channel: 'system',
              tone: 'info',
              text: t(locale, 'shop.successBuy', {
                quantity: data.quantity,
                item: itemName,
                gold: data.totalCostGold
              })
            }
          ]);
        }

        void fetchShopHistory(activeCharacter.id);
      } catch {
        setErrorKey('common.error');
      } finally {
        setInventoryActionLoading(false);
      }
    },
    [activeCharacter, csrfToken, inventoryActionLoading, apiBaseUrl, locale, fetchShopHistory]
  );

  const handleSellShopItem = useCallback(
    async (itemId: string, quantity: number, slotIndex?: number) => {
      if (!activeCharacter || !csrfToken || inventoryActionLoading) return;
      setInventoryActionLoading(true);
      setErrorKey(null);

      const opKey = `${itemId}:${quantity}:${slotIndex ?? 'auto'}`;
      const idempotencyKey =
        getPendingHuntKey(activeCharacter.id, 'shopSell', opKey) || generateClientUUID();
      setPendingHuntKey(activeCharacter.id, 'shopSell', idempotencyKey, opKey);

      try {
        const res = await fetch(
          `${apiBaseUrl}/characters/${activeCharacter.id}/npc-shop/sell`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': csrfToken
            },
            body: JSON.stringify({ itemId, quantity, slotIndex, idempotencyKey })
          }
        );

        if (!res.ok) {
          const errBody = (await res.json().catch(() => null)) as {
            error?: { messageKey?: string };
          } | null;
          setErrorKey((errBody?.error?.messageKey as TranslationKey) ?? 'common.error');
          return;
        }

        const data = (await res.json()) as SellNpcItemResponseDto;
        clearPendingHuntKey(activeCharacter.id, 'shopSell', opKey);

        setInventory(data.inventory);

        setCharacters((prev) =>
          prev.map((c) =>
            c.id === activeCharacter.id
              ? {
                  ...c,
                  stats: {
                    ...c.stats,
                    gold: data.newGoldBalance
                  }
                }
              : c
          )
        );

        if (!data.idempotentReplay) {
          const nowTime = new Date().toLocaleTimeString(locale === 'pl' ? 'pl-PL' : 'en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
          const itemSlot = inventory?.slots.find((s) => s.itemId === data.itemId);
          const itemName = itemSlot ? t(locale, itemSlot.nameKey as TranslationKey) : data.itemId;
          setDynamicLogEntries((prev) => [
            ...prev,
            {
              id: `shop-sell-${Date.now()}`,
              time: nowTime,
              channel: 'system',
              tone: 'info',
              text: t(locale, 'shop.successSell', {
                quantity: data.quantitySold,
                item: itemName,
                gold: data.totalPayoutGold
              })
            }
          ]);
        }

        void fetchShopHistory(activeCharacter.id);
      } catch {
        setErrorKey('common.error');
      } finally {
        setInventoryActionLoading(false);
      }
    },
    [activeCharacter, csrfToken, inventoryActionLoading, apiBaseUrl, locale, fetchShopHistory]
  );

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
    return [...list, ...dynamicLogEntries.slice(-30)];
  }, [activeCharacter, dynamicLogEntries, locale]);

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
                  activeCharacter={activeCharacter}
                  activeHunt={activeHunt}
                  activeHuntLoading={activeHuntLoading}
                  onStartHunt={handleStartHunt}
                  onSettleHunt={handleSettleHunt}
                  onStopHunt={handleStopHunt}
                  huntActionLoading={huntActionLoading}
                  huntReport={huntReport}
                  onCloseHuntReport={() => setHuntReport(null)}
                  rewardItems={rewardItems}
                  onRefreshRewardItems={() =>
                    activeCharacter ? fetchRewardItems(activeCharacter.id) : Promise.resolve()
                  }
                  latestCompletedHuntId={latestCompletedHuntId}
                  onOpenLatestReport={handleOpenLatestReport}
                  onClaimReward={handleClaimReward}
                  claimingRewardId={claimingRewardId}
                />
              ) : activeTab === 'character' ? (
                <CharacterView
                  locale={locale}
                  character={activeCharacter}
                  combatStats={equipment?.stats}
                />
              ) : activeTab === 'inventory' ? (
                <InventoryView
                  locale={locale}
                  inventory={inventory}
                  equipment={equipment}
                  rewardItems={rewardItems}
                  onClaimReward={handleClaimReward}
                  claimingRewardId={claimingRewardId}
                  onMoveItem={handleMoveItem}
                  onSplitStack={handleSplitStack}
                  onEquipItem={handleEquipItem}
                  onUnequipItem={handleUnequipItem}
                  actionLoading={inventoryActionLoading}
                />
              ) : activeTab === 'shop' ? (
                <NpcShopView
                  locale={locale}
                  characterGold={activeCharacter.stats.gold}
                  hpPotions={activeCharacter.hpPotions}
                  mpPotions={activeCharacter.mpPotions}
                  inventory={inventory}
                  isActiveHunt={Boolean(activeHunt && activeHunt.status === 'ACTIVE')}
                  history={shopHistory}
                  onBuyProduct={handleBuyShopProduct}
                  onSellItem={handleSellShopItem}
                  actionLoading={inventoryActionLoading}
                />
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
                  activeHunt={activeHunt}
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
                  {EQUIPMENT_SLOTS.map((slot) => {
                    const equipped = equipment?.slots[slot] ?? null;
                    return (
                      <ItemSlot
                        key={slot}
                        slotId={`dock-${slot}`}
                        label={
                          equipped
                            ? t(locale, equipped.nameKey as TranslationKey)
                            : t(locale, EQUIPMENT_SLOT_KEY_MAP[slot])
                        }
                        iconKey={equipped?.fallbackIconKey ?? slot}
                        category="equipment"
                        state={equipped ? 'occupied' : 'empty'}
                        onSelect={() => navigateTab('inventory')}
                      />
                    );
                  })}
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
