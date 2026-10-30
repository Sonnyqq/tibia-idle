import { type CharacterDto, type UserDto } from '@tibia-idle/contracts';
import { INITIAL_ZONES_CATALOG } from '@tibia-idle/domain';
import { App } from '@tibia-idle/web/App.js';
import { inferAssetCategory, resolveAssetSource } from '@tibia-idle/web/assets/assetRegistry.js';
import {
  GameButton,
  GameLog,
  GameTabs,
  GameTooltip,
  GameWindow,
  ItemSlot,
  MonsterRow,
  ProgressBar,
  StatRow
} from '@tibia-idle/web/components/ui/GameUi.js';
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

describe('@tibia-idle/web unit tests (Tibia client components, navigation, assets, PL/EN views)', () => {
  it('validates navigation tabs, formatting helpers, and categorized asset resolution', () => {
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

    expect(inferAssetCategory('creature.cellar-stalker', 'rat')).toBe('monster');
    expect(inferAssetCategory('item.copper-coin', 'coin')).toBe('item');
    expect(inferAssetCategory('zone.damp-catacombs', 'sewers')).toBe('zone');
    expect(inferAssetCategory('', 'helmet')).toBe('equipment');

    const asset = resolveAssetSource({
      assetId: 'creature.cellar-stalker',
      category: 'creature',
      fallbackIconKey: 'rat'
    });
    expect(asset).toEqual({
      kind: 'vector',
      assetId: 'creature.cellar-stalker',
      category: 'monster',
      iconKey: 'rat'
    });
  });

  it('renders base Tibia UI components (GameWindow, GameButton, ItemSlot, ProgressBar, StatRow, MonsterRow, GameTabs, GameTooltip, GameLog)', () => {
    const html = renderToStaticMarkup(
      <div>
        <GameWindow title="Skills Window" iconKey="swords" collapsible testId="unit-window">
          <StatRow label="Magic Level" value={5} subBarVariant="skill" subBarPercent={40} />
          <ProgressBar variant="hp" percent={80} label="HP" valueText="148/185" />
          <ItemSlot
            slotId="weapon"
            label="Main Hand"
            iconKey="weapon"
            state="occupied"
            rarity="rare"
            stackCount={5}
            selected
          />
          <MonsterRow
            creatureId="cellar-stalker"
            name="Cellar Stalker"
            levelText="Level 1+"
            dangerTier="low"
            dangerLabel="Low threat"
            progressPercent={0}
            progressText="0/100"
          />
          <GameTabs
            tabs={[
              { id: 'a', label: 'Tab A' },
              { id: 'b', label: 'Tab B' }
            ]}
            activeTab="a"
            onSelectTab={() => undefined}
            ariaLabel="Unit Tabs"
          />
          <GameTooltip
            data={{
              title: 'Runed Bone',
              subtitle: 'Common',
              description: 'Read-only catalog preview',
              source: 'Bone Sentinel'
            }}
            closeLabel="Close"
          />
          <GameButton variant="primary" active>
            Confirm
          </GameButton>
        </GameWindow>
        <GameLog
          locale="en"
          entries={[
            {
              id: '1',
              time: '00:00',
              channel: 'system',
              tone: 'info',
              text: 'Client initialized.'
            }
          ]}
        />
      </div>
    );

    expect(html).toContain('Skills Window');
    expect(html).toContain('Magic Level');
    expect(html).toContain('148/185');
    expect(html).toContain('data-slot-state="selected"');
    expect(html).toContain('Cellar Stalker');
    expect(html).toContain('Runed Bone');
    expect(html).toContain('Client initialized.');
  });

  it('renders unauthenticated login window in Polish and English without decorative empty sidebars', () => {
    const htmlPl = renderToStaticMarkup(<App initialLocale="pl" />);
    expect(htmlPl).toContain('Zaloguj się na konto');
    expect(htmlPl).not.toContain('data-testid="desktop-sidebar"');

    const htmlEn = renderToStaticMarkup(<App initialLocale="en" />);
    expect(htmlEn).toContain('Sign in to account');
    expect(htmlEn).not.toContain('data-testid="desktop-sidebar"');
  });

  it('renders all 5 game screens (Dashboard, Hunts, Character, Inventory, Bestiary) and empty states in PL and EN', () => {
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
    expect(dashPl).toContain('Konsola klienta');

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

    const huntsEmptyEn = renderToStaticMarkup(
      <App
        initialLocale="en"
        initialUser={{ ...sampleUser, locale: 'en' }}
        initialCharacters={[sampleChar]}
        initialSelectedCharacterId={sampleChar.id}
        initialTab="hunts"
        initialZones={[]}
      />
    );
    expect(huntsEmptyEn).toContain('No hunting zones available');

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
    expect(charPl).toContain('Walka mieczem');
    expect(charPl).toContain('Niedostępne (P04)');
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
    expect(invEn).toContain('Container slots (20 slots — empty)');
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
