import { type LootPreviewItemDto, type ZoneCatalogDto } from '@tibia-idle/contracts';
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
  MonsterRow,
  StatRow
} from './ui/GameUi.js';

export interface HuntsViewProps {
  locale: SupportedLocale;
  zones: readonly ZoneCatalogDto[];
  isLoading: boolean;
  errorKey: TranslationKey | null;
  onRetry: () => void;
}

export function HuntsView({ locale, zones, isLoading, errorKey, onRetry }: HuntsViewProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedLootItem, setSelectedLootItem] = useState<{
    item: LootPreviewItemDto;
    creatureName: string;
  } | null>(null);

  const activeZone = zones.find((z) => z.id === selectedZoneId) ?? zones[0] ?? null;

  const tooltipData: GameTooltipData | null = selectedLootItem
    ? {
        title: t(locale, selectedLootItem.item.nameKey as TranslationKey),
        subtitle: t(locale, RARITY_KEY_MAP[selectedLootItem.item.rarity]),
        rarityLabel: `${t(locale, 'tooltip.rarity')}: ${t(locale, RARITY_KEY_MAP[selectedLootItem.item.rarity])}`,
        description: t(locale, 'tooltip.catalogPreview'),
        source: `${t(locale, 'tooltip.source')}: ${selectedLootItem.creatureName}`
      }
    : null;

  return (
    <div data-testid="hunts-view" className="workspace-stack">
      <GameWindow
        title={t(locale, 'nav.hunts')}
        iconKey="swords"
        collapsible
        minimizeLabel={t(locale, 'window.minimize')}
        expandLabel={t(locale, 'window.expand')}
      >
        {isLoading && <p data-testid="hunts-loading">{t(locale, 'common.loading')}</p>}
        {errorKey && (
          <div role="alert" data-testid="hunts-error" className="game-alert-box">
            <span>{t(locale, errorKey)}</span>
            <GameButton size="sm" onClick={onRetry}>
              {t(locale, 'common.retry')}
            </GameButton>
          </div>
        )}
        {!isLoading && !errorKey && zones.length === 0 && (
          <p data-testid="hunts-empty" className="window-muted-note">
            {t(locale, 'hunt.emptyZones')}
          </p>
        )}

        {!isLoading && !errorKey && zones.length > 0 && (
          <div className="hunts-master-detail">
            <div className="hunts-zone-list">
              <div className="subwindow-title">{t(locale, 'hunt.zoneListTitle')}</div>
              {zones.map((zone) => {
                const isSelected = activeZone?.id === zone.id;
                const highestDanger = zone.creatures.some((c) => c.dangerTier === 'high')
                  ? 'high'
                  : zone.creatures.some((c) => c.dangerTier === 'medium')
                    ? 'medium'
                    : 'low';

                return (
                  <article
                    key={zone.id}
                    data-testid={`zone-card-${zone.id}`}
                    className={`zone-list-row ${isSelected ? 'is-selected' : ''}`.trim()}
                  >
                    <div
                      className="zone-row-select"
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedZoneId(zone.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedZoneId(zone.id);
                        }
                      }}
                    >
                      <div className="zone-row-icon">
                        <GameIcon asset={zone.asset} category="zone" size={18} />
                      </div>
                      <div className="zone-row-info">
                        <div className="zone-row-title-line">
                          <strong className="zone-row-name">
                            {t(locale, zone.nameKey as TranslationKey)}
                          </strong>
                          <span className={`game-tag game-tag-danger-${highestDanger}`}>
                            {t(locale, 'stats.level')} {zone.recommendedLevelRange}
                          </span>
                        </div>
                        <div className="zone-row-sub">
                          {t(locale, 'hunt.enemyTypes')}:{' '}
                          {t(locale, zone.enemyTypesKey as TranslationKey)}
                        </div>
                      </div>
                    </div>

                    <dl className="zone-row-rates">
                      <div className="zone-rate-cell" data-testid={`zone-xp-rate-${zone.id}`}>
                        <dt>{t(locale, 'hunt.xpPerHour')}</dt>
                        <dd>
                          {zone.expPerHourEstimate !== null
                            ? zone.expPerHourEstimate
                            : t(locale, 'hunt.estimatePending')}
                        </dd>
                      </div>
                      <div className="zone-rate-cell" data-testid={`zone-gold-rate-${zone.id}`}>
                        <dt>{t(locale, 'hunt.goldPerHour')}</dt>
                        <dd>
                          {zone.goldPerHourEstimate !== null
                            ? zone.goldPerHourEstimate
                            : t(locale, 'hunt.estimatePending')}
                        </dd>
                      </div>
                    </dl>

                    <div className="zone-row-footer">
                      <GameButton
                        size="sm"
                        disabled
                        aria-disabled="true"
                        testId={`start-hunt-${zone.id}`}
                        title={t(locale, 'hunt.lockedUntilP02')}
                      >
                        {t(locale, 'hunt.lockedUntilP02')}
                      </GameButton>
                    </div>

                    {!isSelected && (
                      <div className="sr-only" aria-hidden="true">
                        {zone.creatures.map((creature) => (
                          <div key={creature.id} data-testid={`zone-creature-${creature.id}`}>
                            {t(locale, creature.nameKey as TranslationKey)}
                            {creature.lootPreview.map((item) => (
                              <span key={item.id} data-testid={`loot-preview-${item.id}`}>
                                {t(locale, item.nameKey as TranslationKey)}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {activeZone && (
              <div className="hunts-zone-inspector" data-testid="zone-inspector-panel">
                <div className="subwindow-title">
                  {t(locale, 'hunt.zoneDetailsTitle')}:{' '}
                  {t(locale, activeZone.nameKey as TranslationKey)}
                </div>

                <dl className="mmo-stat-list">
                  <StatRow
                    label={t(locale, 'hunt.recommendedLevel')}
                    value={activeZone.recommendedLevelRange}
                    highlight
                  />
                  <StatRow
                    label={t(locale, 'hunt.enemyTypes')}
                    value={t(locale, activeZone.enemyTypesKey as TranslationKey)}
                  />
                  <StatRow
                    label={t(locale, 'hunt.xpPerHour')}
                    value={t(locale, 'hunt.estimatePending')}
                    muted
                  />
                  <StatRow
                    label={t(locale, 'hunt.goldPerHour')}
                    value={t(locale, 'hunt.estimatePending')}
                    muted
                  />
                </dl>

                <div className="subwindow-section">
                  <div className="subwindow-title">{t(locale, 'hunt.creaturesInZone')}</div>
                  <div className="monster-rows-stack">
                    {activeZone.creatures.map((creature) => {
                      const creatureName = t(locale, creature.nameKey as TranslationKey);
                      return (
                        <MonsterRow
                          key={creature.id}
                          testId={`zone-creature-${creature.id}`}
                          creatureId={creature.id}
                          name={creatureName}
                          levelText={`${t(locale, 'stats.level')} ${creature.minLevel}+`}
                          dangerTier={creature.dangerTier}
                          dangerLabel={t(locale, DANGER_TIER_KEY_MAP[creature.dangerTier])}
                          asset={creature.asset}
                        >
                          <div className="loot-slots-strip">
                            <span className="loot-strip-label">
                              {t(locale, 'hunt.potentialLoot')}:
                            </span>
                            <div className="loot-slots-row">
                              {creature.lootPreview.map((item) => {
                                const itemName = t(locale, item.nameKey as TranslationKey);
                                const isSelectedItem = selectedLootItem?.item.id === item.id;
                                return (
                                  <div
                                    key={item.id}
                                    data-testid={`loot-preview-${item.id}`}
                                    className="loot-slot-cell"
                                  >
                                    <ItemSlot
                                      slotId={item.id}
                                      label={`${itemName} (${t(locale, RARITY_KEY_MAP[item.rarity])})`}
                                      asset={item.asset}
                                      category="item"
                                      state="occupied"
                                      rarity={item.rarity}
                                      selected={isSelectedItem}
                                      onSelect={() =>
                                        setSelectedLootItem({ item, creatureName })
                                      }
                                    />
                                    <span className="loot-slot-inline-name">{itemName}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </MonsterRow>
                      );
                    })}
                  </div>
                </div>

                {tooltipData ? (
                  <GameTooltip
                    data={tooltipData}
                    closeLabel={t(locale, 'tooltip.close')}
                    onClose={() => setSelectedLootItem(null)}
                    testId="hunt-loot-tooltip"
                  />
                ) : (
                  <p className="window-muted-note">{t(locale, 'hunt.lootSlotHint')}</p>
                )}

                <div className="subwindow-section">
                  <div className="subwindow-title">{t(locale, 'hunt.strategyTitle')}</div>
                  <p className="window-muted-note">{t(locale, 'hunt.strategyPending')}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </GameWindow>
    </div>
  );
}
