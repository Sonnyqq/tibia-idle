import {
  type CreatureCatalogDto,
  type LootPreviewItemDto,
  type ZoneCatalogDto
} from '@tibia-idle/contracts';
import { type SupportedLocale, t, type TranslationKey } from '@tibia-idle/i18n';
import { useState } from 'react';
import { GameIcon } from '../assets/assetRegistry.js';
import { DANGER_TIER_KEY_MAP, RARITY_KEY_MAP } from '../lib/format.js';
import {
  GameButton,
  GameTooltip,
  type GameTooltipData,
  GameWindow,
  ItemSlot,
  ProgressBar,
  StatRow
} from './ui/GameUi.js';

export interface BestiaryViewProps {
  locale: SupportedLocale;
  zones: readonly ZoneCatalogDto[];
  isLoading: boolean;
  errorKey: TranslationKey | null;
  onRetry: () => void;
}

export function BestiaryView({
  locale,
  zones,
  isLoading,
  errorKey,
  onRetry
}: BestiaryViewProps) {
  const allCreatures: readonly CreatureCatalogDto[] = zones.flatMap((z) => z.creatures);
  const [selectedCreatureId, setSelectedCreatureId] = useState<string | null>(null);
  const [selectedLootItem, setSelectedLootItem] = useState<LootPreviewItemDto | null>(null);

  const activeCreature =
    allCreatures.find((c) => c.id === selectedCreatureId) ?? allCreatures[0] ?? null;

  const activeCreatureName = activeCreature
    ? t(locale, activeCreature.nameKey as TranslationKey)
    : '';

  const lootTooltip: GameTooltipData | null = selectedLootItem
    ? {
        title: t(locale, selectedLootItem.nameKey as TranslationKey),
        subtitle: t(locale, RARITY_KEY_MAP[selectedLootItem.rarity]),
        rarityLabel: `${t(locale, 'tooltip.rarity')}: ${t(locale, RARITY_KEY_MAP[selectedLootItem.rarity])}`,
        description: t(locale, 'tooltip.catalogPreview'),
        source: `${t(locale, 'tooltip.source')}: ${activeCreatureName}`
      }
    : null;

  return (
    <div data-testid="bestiary-view" className="workspace-stack">
      <GameWindow
        title={t(locale, 'bestiary.title')}
        iconKey="skull"
        iconCategory="monster"
        collapsible
        minimizeLabel={t(locale, 'window.minimize')}
        expandLabel={t(locale, 'window.expand')}
      >
        {isLoading && <p data-testid="bestiary-loading">{t(locale, 'common.loading')}</p>}

        {errorKey && (
          <div role="alert" data-testid="bestiary-error" className="game-alert-box">
            <span>{t(locale, errorKey)}</span>
            <GameButton size="sm" onClick={onRetry}>
              {t(locale, 'common.retry')}
            </GameButton>
          </div>
        )}

        {!isLoading && !errorKey && allCreatures.length === 0 && (
          <p data-testid="bestiary-empty" className="window-muted-note">
            {t(locale, 'bestiary.emptyList')}
          </p>
        )}

        {!isLoading && !errorKey && allCreatures.length > 0 && (
          <div className="bestiary-master-detail">
            <div className="bestiary-list-pane">
              <div className="subwindow-title">{t(locale, 'hunt.creaturesInZone')}</div>
              <ul className="bestiary-creature-list" data-testid="bestiary-creature-list">
                {allCreatures.map((creature) => {
                  const isSelected = activeCreature?.id === creature.id;
                  return (
                    <li key={creature.id}>
                      <button
                        type="button"
                        className={`bestiary-creature-btn ${isSelected ? 'is-selected' : ''}`.trim()}
                        data-testid={`bestiary-select-${creature.id}`}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setSelectedCreatureId(creature.id);
                          setSelectedLootItem(null);
                        }}
                      >
                        <GameIcon asset={creature.asset} category="monster" size={16} />
                        <span className="bestiary-creature-name">
                          {t(locale, creature.nameKey as TranslationKey)}
                        </span>
                        <span className="bestiary-creature-lvl">
                          {t(locale, 'stats.level')} {creature.minLevel}+
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {activeCreature ? (
              <div className="bestiary-inspector-pane" data-testid="bestiary-detail-panel">
                <div className="bestiary-portrait-header">
                  <div className="bestiary-portrait-box">
                    <GameIcon asset={activeCreature.asset} category="monster" size={36} />
                  </div>
                  <div className="bestiary-header-meta">
                    <div className="bestiary-title-row">
                      <h3 data-testid="bestiary-detail-name" className="bestiary-creature-heading">
                        {activeCreatureName}
                      </h3>
                      <span className={`game-tag game-tag-danger-${activeCreature.dangerTier}`}>
                        {t(locale, DANGER_TIER_KEY_MAP[activeCreature.dangerTier])}
                      </span>
                    </div>
                    <div className="bestiary-sub-line">
                      {t(locale, 'stats.level')} {activeCreature.minLevel}+ •{' '}
                      {t(locale, 'bestiary.discoveryStatus')}
                    </div>
                    <ProgressBar
                      variant="skill"
                      percent={0}
                      valueText={t(locale, 'bestiary.stageLocked')}
                    />
                  </div>
                </div>

                <dl className="mmo-stat-list">
                  <StatRow
                    testId="bestiary-kill-count"
                    label={t(locale, 'bestiary.killCountLabel')}
                    value="0"
                  />
                  <StatRow
                    testId="bestiary-stage-status"
                    label={t(locale, 'bestiary.charmsTitle')}
                    value={t(locale, 'bestiary.stageLocked')}
                    muted
                  />
                </dl>

                <div className="subwindow-section">
                  <div className="subwindow-title">{t(locale, 'hunt.potentialLoot')}</div>
                  <div className="loot-slots-row">
                    {activeCreature.lootPreview.map((item) => {
                      const itemName = t(locale, item.nameKey as TranslationKey);
                      return (
                        <div
                          key={item.id}
                          data-testid={`bestiary-loot-${item.id}`}
                          className="loot-slot-cell"
                        >
                          <ItemSlot
                            slotId={item.id}
                            label={`${itemName} (${t(locale, RARITY_KEY_MAP[item.rarity])})`}
                            asset={item.asset}
                            category="item"
                            state="occupied"
                            rarity={item.rarity}
                            selected={selectedLootItem?.id === item.id}
                            onSelect={() => setSelectedLootItem(item)}
                          />
                          <span className="loot-slot-inline-name">{itemName}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {lootTooltip && (
                  <GameTooltip
                    data={lootTooltip}
                    closeLabel={t(locale, 'tooltip.close')}
                    onClose={() => setSelectedLootItem(null)}
                    testId="bestiary-loot-tooltip"
                  />
                )}

                <div className="subwindow-section" data-testid="bestiary-charms-box">
                  <div className="subwindow-title">{t(locale, 'bestiary.charmsTitle')}</div>
                  <p className="window-muted-note">{t(locale, 'bestiary.charmsNotice')}</p>
                  <p className="window-muted-note">{t(locale, 'bestiary.loreNotice')}</p>
                </div>
              </div>
            ) : (
              <p className="window-muted-note">{t(locale, 'bestiary.selectPrompt')}</p>
            )}
          </div>
        )}
      </GameWindow>
    </div>
  );
}
