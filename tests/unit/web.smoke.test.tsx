import { type CharacterDto, type UserDto } from '@tibia-idle/contracts';
import { INITIAL_ZONES_CATALOG } from '@tibia-idle/domain';
import { App } from '@tibia-idle/web/App.js';
import { resolveAssetSource } from '@tibia-idle/web/assets/assetRegistry.js';
import {
  computeXpBarProgress,
  formatStatNumber,
  GAME_TABS,
  isGameTabId,
  resolveErrorMessageKey
} from '@tibia-idle/web/lib/format.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

const sampleUser: UserDto = {
  id: '00000000-0000-0000-0000-000000000001',
  email: 'hero@example.com',
  locale: 'pl',
  createdAt: '2026-10-30T20:00:00.000Z'
};

const sampleChar: CharacterDto = {
  id: '00000000-0000-0000-0000-000000000099',
  userId: sampleUser.id,
  slotNumber: 1,
  name: 'Valkor',
  vocation: 'knight',
  stats: {
    level: 1,
    xp: 0,
    hp: 185,
    maxHp: 185,
    mp: 40,
    maxMp: 40,
    gold: 100,
    melee: 15,
    distance: 10,
    magic: 1,
    shielding: 15
  },
  createdAt: '2026-10-30T20:00:00.000Z'
};

describe('@tibia-idle/web unit tests (navigation, formatting, assets, PL/EN views)', () => {
  it('validates navigation tabs, formatting helpers, and vector fallback asset resolution', () => {
    expect(GAME_TABS.map((t) => t.id)).toEqual([
      'dashboard',
      'hunts',
      'character',
      'inventory',
      'bestiary'
    ]);
    expect(isGameTabId('bestiary')).toBe(true);
    expect(isGameTabId('unknown')).toBe(false);

    expect(computeXpBarProgress(1, 50)).toEqual({
      currentXp: 50,
      nextLevelXp: 100,
      percent: 50
    });
    expect(formatStatNumber(1250, 'en')).toContain('1,250');
    expect(resolveErrorMessageKey('auth.invalidCredentials')).toBe('auth.invalidCredentials');
    expect(resolveErrorMessageKey('unknown.key')).toBe('common.error');

    const asset = resolveAssetSource({
      assetId: 'creature.cellar-stalker',
      category: 'creature',
      fallbackIconKey: 'beast'
    });
    expect(asset).toEqual({
      kind: 'vector',
      assetId: 'creature.cellar-stalker',
      iconKey: 'beast'
    });
  });

  it('renders unauthenticated shell in Polish and English without raw keys', () => {
    const htmlPl = renderToStaticMarkup(<App initialLocale="pl" />);
    expect(htmlPl).toContain('Polowania');
    expect(htmlPl).toContain('Ekwipunek');
    expect(htmlPl).toContain('Bestiariusz');
    expect(htmlPl).toContain('Zaloguj się na konto');

    const htmlEn = renderToStaticMarkup(<App initialLocale="en" />);
    expect(htmlEn).toContain('Hunts');
    expect(htmlEn).toContain('Inventory');
    expect(htmlEn).toContain('Bestiary');
    expect(htmlEn).toContain('Sign in to account');
  });

  it('renders all 5 game screens (Dashboard, Hunts, Character, Inventory, Bestiary) in PL and EN', () => {
    const dashPl = renderToStaticMarkup(
      <App
        initialLocale="pl"
        initialUser={sampleUser}
        initialCharacters={[sampleChar]}
        initialSelectedCharacterId={sampleChar.id}
        initialTab="dashboard"
        initialZones={INITIAL_ZONES_CATALOG}
      />
    );
    expect(dashPl).toContain('Valkor');
    expect(dashPl).toContain('Odpoczynek w obozie — brak aktywnego polowania');
    expect(dashPl).toContain('Brak rozliczonych zdarzeń bojowych.');

    const huntsEn = renderToStaticMarkup(
      <App
        initialLocale="en"
        initialUser={{ ...sampleUser, locale: 'en' }}
        initialCharacters={[sampleChar]}
        initialSelectedCharacterId={sampleChar.id}
        initialTab="hunts"
        initialZones={INITIAL_ZONES_CATALOG}
      />
    );
    expect(huntsEn).toContain('Damp Catacombs');
    expect(huntsEn).toContain('Sunken Crypts');
    expect(huntsEn).toContain('Ashwind Ridge');
    expect(huntsEn).toContain('Pending P02 simulation');
    expect(huntsEn).toContain('Hunt execution unlocks in IDLE-004');

    const charPl = renderToStaticMarkup(
      <App
        initialLocale="pl"
        initialUser={sampleUser}
        initialCharacters={[sampleChar]}
        initialSelectedCharacterId={sampleChar.id}
        initialTab="character"
      />
    );
    expect(charPl).toContain('Atrybuty główne i umiejętności bojowe');
    expect(charPl).toContain('Talenty i specjalizacje');

    const invEn = renderToStaticMarkup(
      <App
        initialLocale="en"
        initialUser={{ ...sampleUser, locale: 'en' }}
        initialCharacters={[sampleChar]}
        initialSelectedCharacterId={sampleChar.id}
        initialTab="inventory"
      />
    );
    expect(invEn).toContain('Equipped gear slots');
    expect(invEn).toContain('Main Hand');
    expect(invEn).toContain('Backpack is empty.');

    const bestiaryPl = renderToStaticMarkup(
      <App
        initialLocale="pl"
        initialUser={sampleUser}
        initialCharacters={[sampleChar]}
        initialSelectedCharacterId={sampleChar.id}
        initialTab="bestiary"
        initialZones={INITIAL_ZONES_CATALOG}
      />
    );
    expect(bestiaryPl).toContain('Bestiariusz i wiedza o potworach');
    expect(bestiaryPl).toContain('Piwniczny Prześladowca');
    expect(bestiaryPl).toContain('Próg zablokowany (0 / 100 zabójstw)');
  });
});
