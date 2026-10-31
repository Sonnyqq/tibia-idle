import {
  type ActiveHuntDto,
  type CharacterDto,
  type CharacterHuntRewardItemDto,
  type HuntSegmentsResponseDto,
  type HuntStrategyDto,
  type LootPreviewItemDto,
  type ZoneCatalogDto
} from '@tibia-idle/contracts';
import { type SupportedLocale, t, type TranslationKey } from '@tibia-idle/i18n';
import { useEffect, useState } from 'react';
import { GameIcon } from '../assets/assetRegistry.js';
import {
  DANGER_TIER_KEY_MAP,
  formatDuration,
  formatStatNumber,
  HUNT_STRATEGY_DESC_MAP,
  HUNT_STRATEGY_KEY_MAP,
  RARITY_KEY_MAP,
  STOP_REASON_KEY_MAP
} from '../lib/format.js';
import {
  GameButton,
  GameTooltip,
  type GameTooltipData,
  GameWindow,
  ItemSlot,
  MonsterRow,
  ProgressBar,
  StatRow
} from './ui/GameUi.js';

export interface HuntsViewProps {
  locale: SupportedLocale;
  zones: readonly ZoneCatalogDto[];
  isLoading: boolean;
  errorKey: TranslationKey | null;
  onRetry: () => void;
  activeCharacter: CharacterDto | null;
  activeHunt: ActiveHuntDto | null;
  activeHuntLoading: boolean;
  onStartHunt: (params: {
    zoneId: string;
    strategy: HuntStrategyDto;
    hpPotions: number;
    mpPotions: number;
  }) => Promise<void>;
  onSettleHunt: () => Promise<void>;
  onStopHunt: () => Promise<void>;
  huntActionLoading: boolean;
  huntReport: HuntSegmentsResponseDto | null;
  onCloseHuntReport: () => void;
  rewardItems: readonly CharacterHuntRewardItemDto[];
  onRefreshRewardItems: () => Promise<void>;
  latestCompletedHuntId?: string | null;
  onOpenLatestReport?: () => Promise<void>;
}

export function HuntsView({
  locale,
  zones,
  isLoading,
  errorKey,
  onRetry,
  activeCharacter,
  activeHunt,
  activeHuntLoading: _activeHuntLoading,
  onStartHunt,
  onSettleHunt,
  onStopHunt,
  huntActionLoading,
  huntReport,
  onCloseHuntReport,
  rewardItems,
  latestCompletedHuntId,
  onOpenLatestReport
}: HuntsViewProps) {
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<HuntStrategyDto>('balanced');
  const [hpPotionsReserve, setHpPotionsReserve] = useState<number>(10);
  const [mpPotionsReserve, setMpPotionsReserve] = useState<number>(5);
  const [selectedLootItem, setSelectedLootItem] = useState<{
    item: LootPreviewItemDto;
    creatureName: string;
  } | null>(null);

  // Live timer tick for active hunt display
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!activeHunt) return;
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [activeHunt]);

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

  const isKnight = activeCharacter?.vocation === 'knight';
  const availableHpPotions = activeCharacter?.hpPotions ?? 0;
  const availableMpPotions = activeCharacter?.mpPotions ?? 0;

  // Determine active hunt live durations
  const huntStartedAtMs = activeHunt ? new Date(activeHunt.startedAtIso).getTime() : 0;
  const huntSettledUntilMs = activeHunt ? new Date(activeHunt.settledUntilIso).getTime() : 0;
  const effectiveCutoffMs = activeHunt?.stopRequestedAtIso
    ? new Date(activeHunt.stopRequestedAtIso).getTime()
    : nowMs;
  const liveElapsedMs = activeHunt ? Math.max(0, effectiveCutoffMs - huntStartedAtMs) : 0;
  const liveUnsettledMs = activeHunt ? Math.max(0, effectiveCutoffMs - huntSettledUntilMs) : 0;

  const canStartHunt =
    !activeHunt &&
    activeZone !== null &&
    isKnight &&
    (activeCharacter?.stats.level ?? 1) >= (activeZone?.minLevel ?? 1) &&
    hpPotionsReserve <= availableHpPotions &&
    mpPotionsReserve <= availableMpPotions;

  return (
    <div data-testid="hunts-view" className="workspace-stack">
      {/* 1. Active Hunt Window (when a hunt is currently running) */}
      {activeHunt && (
        <GameWindow
          title={t(locale, 'hunt.activeTitle')}
          iconKey="swords"
          testId="active-hunt-window"
          headerRight={
            <span className="client-status-pill" data-testid="active-hunt-status-pill">
              <span className="status-dot" />
              {t(locale, 'hunt.statusActive')}
            </span>
          }
        >
          <div className="active-hunt-content" data-testid="active-hunt-panel">
            <div className="active-hunt-header-banner">
              <div className="active-hunt-zone-info">
                <span className="subwindow-title">
                  {(() => {
                    const found = zones.find((z) => z.id === activeHunt.zoneId);
                    return found
                      ? t(locale, found.nameKey as TranslationKey)
                      : activeHunt.zoneId;
                  })()}
                </span>
                <span className="game-tag game-tag-danger-low">
                  {t(locale, HUNT_STRATEGY_KEY_MAP[activeHunt.strategy] ?? 'hunt.strategyBalanced')}
                </span>
              </div>
              <div className="active-hunt-time-stats">
                <div className="time-stat-pill" data-testid="hunt-elapsed-time">
                  <span className="time-stat-label">{t(locale, 'hunt.elapsedTime')}:</span>
                  <strong className="time-stat-val">{formatDuration(liveElapsedMs)}</strong>
                </div>
                <div className="time-stat-pill" data-testid="hunt-settled-time">
                  <span className="time-stat-label">{t(locale, 'hunt.settledTime')}:</span>
                  <span className="time-stat-val">
                    {formatDuration(activeHunt.settledDurationMs)}
                  </span>
                </div>
                <div className="time-stat-pill" data-testid="hunt-unsettled-time">
                  <span className="time-stat-label">{t(locale, 'hunt.unsettledEstimate')}:</span>
                  <span className="time-stat-val">{formatDuration(liveUnsettledMs)}</span>
                </div>
              </div>
            </div>

            {/* Vitals during combat */}
            <div className="active-hunt-vitals-box">
              <div className="vitals-bar-cell">
                <div className="vitals-bar-label">
                  <span>{t(locale, 'stats.hp')}</span>
                  <span>
                    {activeHunt.hp} / {activeHunt.maxHp}
                  </span>
                </div>
                <ProgressBar
                  variant="hp"
                  percent={Math.min(
                    100,
                    Math.max(0, Math.floor((activeHunt.hp / Math.max(1, activeHunt.maxHp)) * 100))
                  )}
                />
              </div>
              <div className="vitals-bar-cell">
                <div className="vitals-bar-label">
                  <span>{t(locale, 'stats.mp')}</span>
                  <span>
                    {activeHunt.mp} / {activeHunt.maxMp}
                  </span>
                </div>
                <ProgressBar
                  variant="mana"
                  percent={
                    activeHunt.maxMp > 0
                      ? Math.min(
                          100,
                          Math.max(0, Math.floor((activeHunt.mp / activeHunt.maxMp) * 100))
                        )
                      : 0
                  }
                />
              </div>
            </div>

            {/* Combat Stats Grid */}
            <dl className="active-hunt-stats-grid">
              <div className="stat-grid-cell" data-testid="hunt-total-kills">
                <dt>{t(locale, 'hunt.summaryKills')}</dt>
                <dd>{formatStatNumber(activeHunt.totalKills, locale)}</dd>
              </div>
              <div className="stat-grid-cell" data-testid="hunt-total-xp">
                <dt>{t(locale, 'hunt.summaryXp')}</dt>
                <dd>+{formatStatNumber(activeHunt.totalXpGained, locale)} XP</dd>
              </div>
              <div className="stat-grid-cell" data-testid="hunt-total-gold">
                <dt>{t(locale, 'hunt.summaryGold')}</dt>
                <dd>+{formatStatNumber(activeHunt.totalGoldGained, locale)} G</dd>
              </div>
              <div className="stat-grid-cell" data-testid="hunt-potions-hp">
                <dt>{t(locale, 'hunt.hpPotionsReserve')}</dt>
                <dd>
                  {activeHunt.hpPotionsRemaining} / {activeHunt.reservedHpPotions} (
                  {activeHunt.hpPotionsUsed} {t(locale, 'hunt.potionsUsed').toLowerCase()})
                </dd>
              </div>
              <div className="stat-grid-cell" data-testid="hunt-potions-mp">
                <dt>{t(locale, 'hunt.mpPotionsReserve')}</dt>
                <dd>
                  {activeHunt.mpPotionsRemaining} / {activeHunt.reservedMpPotions} (
                  {activeHunt.mpPotionsUsed} {t(locale, 'hunt.potionsUsed').toLowerCase()})
                </dd>
              </div>
            </dl>

            {/* Loot collected preview */}
            {Object.keys(activeHunt.totalLootByItem).length > 0 && (
              <div className="subwindow-section">
                <div className="subwindow-title">{t(locale, 'hunt.summaryLoot')}</div>
                <div className="active-hunt-loot-row" data-testid="active-hunt-loot-strip">
                  {Object.entries(activeHunt.totalLootByItem).map(([itemId, qty]) => (
                    <div
                      key={itemId}
                      className="hunt-loot-token"
                      data-testid={`active-loot-${itemId}`}
                    >
                      <ItemSlot
                        slotId={itemId}
                        label={`${itemId} (x${qty})`}
                        category="item"
                        state="occupied"
                        stackCount={qty}
                      />
                      <span className="loot-token-count">x{qty}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Continuation warning if server stopped under low budget */}
            {activeHunt.isContinuationRequired && (
              <div role="alert" className="game-alert-box" data-testid="continuation-required-alert">
                <span>
                  {t(locale, 'hunt.stoppingInProgress')} ({formatDuration(liveUnsettledMs)}{' '}
                  {t(locale, 'hunt.unsettledRemaining').toLowerCase()})
                </span>
              </div>
            )}

            {/* Actions: Settle and Stop buttons */}
            <div className="active-hunt-action-strip">
              <GameButton
                variant="primary"
                size="md"
                testId="settle-hunt-button"
                disabled={huntActionLoading}
                onClick={onSettleHunt}
              >
                {t(locale, 'hunt.settleNow')}
              </GameButton>
              <GameButton
                variant="danger"
                size="md"
                testId="stop-hunt-button"
                disabled={huntActionLoading}
                onClick={onStopHunt}
              >
                {activeHunt.isContinuationRequired
                  ? t(locale, 'hunt.continueStop')
                  : t(locale, 'hunt.stopHunt')}
              </GameButton>
            </div>
          </div>
        </GameWindow>
      )}

      {/* Persistent Hunt Report trigger button if not hunting and previous report exists */}
      {!activeHunt && latestCompletedHuntId && onOpenLatestReport && (
        <div className="latest-report-action-strip" style={{ marginBottom: '8px' }}>
          <GameButton
            variant="default"
            size="md"
            testId="open-latest-report-button"
            disabled={huntActionLoading}
            onClick={onOpenLatestReport}
          >
            {t(locale, 'hunt.lastHunt')}
          </GameButton>
        </div>
      )}

      {/* 2. Hunt Report Window (displayed after hunt stops/completes) */}
      {huntReport && (
        <GameWindow
          title={t(locale, 'hunt.reportTitle')}
          iconKey="scroll"
          testId="hunt-report-window"
          headerRight={
            <GameButton size="sm" testId="close-report-button" onClick={onCloseHuntReport}>
              {t(locale, 'hunt.closeReport')}
            </GameButton>
          }
        >
          <div className="hunt-report-content" data-testid="hunt-report-panel">
            <div className="report-summary-header">
              <strong>
                {(() => {
                  const found = zones.find((z) => z.id === huntReport.summary.zoneId);
                  return found
                    ? t(locale, found.nameKey as TranslationKey)
                    : huntReport.summary.zoneId;
                })()}
              </strong>
              <span className="game-tag">
                {huntReport.summary.stopReason
                  ? t(
                      locale,
                      STOP_REASON_KEY_MAP[huntReport.summary.stopReason] ??
                        'hunt.statusCompleted'
                    )
                  : t(locale, 'hunt.statusCompleted')}
              </span>
            </div>

            <dl className="active-hunt-stats-grid">
              <div className="stat-grid-cell" data-testid="report-total-duration">
                <dt>{t(locale, 'hunt.elapsedTime')}</dt>
                <dd>{formatDuration(huntReport.summary.totalDurationMs)}</dd>
              </div>
              <div className="stat-grid-cell" data-testid="report-total-kills">
                <dt>{t(locale, 'hunt.summaryKills')}</dt>
                <dd>{formatStatNumber(huntReport.summary.totalKills, locale)}</dd>
              </div>
              <div className="stat-grid-cell" data-testid="report-total-xp">
                <dt>{t(locale, 'hunt.summaryXp')}</dt>
                <dd>+{formatStatNumber(huntReport.summary.totalXpGained, locale)} XP</dd>
              </div>
              <div className="stat-grid-cell" data-testid="report-total-gold">
                <dt>{t(locale, 'hunt.summaryGold')}</dt>
                <dd>+{formatStatNumber(huntReport.summary.totalGoldGained, locale)} G</dd>
              </div>
              <div className="stat-grid-cell" data-testid="report-returned-potions">
                <dt>{t(locale, 'hunt.potionsRemaining')}</dt>
                <dd>
                  {huntReport.summary.unusedHpPotionsReturned} HP,{' '}
                  {huntReport.summary.unusedMpPotionsReturned} MP
                </dd>
              </div>
            </dl>

            {Object.keys(huntReport.summary.totalLootByItem).length > 0 && (
              <div className="subwindow-section">
                <div className="subwindow-title">{t(locale, 'hunt.summaryLoot')}</div>
                <div className="active-hunt-loot-row">
                  {Object.entries(huntReport.summary.totalLootByItem).map(([itemId, qty]) => (
                    <div
                      key={itemId}
                      className="hunt-loot-token"
                      data-testid={`report-loot-${itemId}`}
                    >
                      <ItemSlot
                        slotId={itemId}
                        label={`${itemId} (x${qty})`}
                        category="item"
                        state="occupied"
                        stackCount={qty}
                      />
                      <span className="loot-token-count">x{qty}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </GameWindow>
      )}

      {/* 3. Hunting Grounds Catalog & Strategy Inspector */}
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
            {/* Zone List Column */}
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

            {/* Zone Inspector Column */}
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
                </dl>

                {/* Strategy Configuration */}
                <div className="subwindow-section" data-testid="hunt-strategy-section">
                  <div className="subwindow-title">{t(locale, 'hunt.strategyTitle')}</div>
                  <div className="hunt-strategy-options">
                    {(['safe', 'balanced', 'aggressive'] as const).map((strat) => {
                      const isChosen = selectedStrategy === strat;
                      return (
                        <label
                          key={strat}
                          className={`strategy-option-card ${isChosen ? 'is-selected' : ''}`}
                          data-testid={`strategy-option-${strat}`}
                        >
                          <input
                            type="radio"
                            name="huntStrategy"
                            value={strat}
                            checked={isChosen}
                            onChange={() => setSelectedStrategy(strat)}
                            disabled={Boolean(activeHunt) || huntActionLoading}
                          />
                          <div className="strategy-option-details">
                            <strong className="strategy-title">
                              {t(locale, HUNT_STRATEGY_KEY_MAP[strat] ?? 'hunt.strategyBalanced')}
                            </strong>
                            <span className="strategy-desc">
                              {t(locale, HUNT_STRATEGY_DESC_MAP[strat] ?? 'hunt.strategyBalancedDesc')}
                            </span>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Potions Reservation Controls */}
                <div className="subwindow-section" data-testid="hunt-potions-section">
                  <div className="subwindow-title">
                    {t(locale, 'hunt.hpPotionsReserve')} &amp; {t(locale, 'hunt.mpPotionsReserve')}
                  </div>
                  <div className="hunt-potion-controls">
                    <div className="potion-input-group">
                      <label htmlFor="hp-potions-reserve-input" className="potion-input-label">
                        {t(locale, 'hunt.hpPotionsReserve')} (max {availableHpPotions})
                      </label>
                      <input
                        id="hp-potions-reserve-input"
                        type="number"
                        min={0}
                        max={availableHpPotions}
                        value={hpPotionsReserve}
                        disabled={Boolean(activeHunt) || huntActionLoading}
                        data-testid="hp-potions-input"
                        className="client-input"
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setHpPotionsReserve(
                            Number.isFinite(val)
                              ? Math.max(0, Math.min(availableHpPotions, val))
                              : 0
                          );
                        }}
                      />
                    </div>
                    <div className="potion-input-group">
                      <label htmlFor="mp-potions-reserve-input" className="potion-input-label">
                        {t(locale, 'hunt.mpPotionsReserve')} (max {availableMpPotions})
                      </label>
                      <input
                        id="mp-potions-reserve-input"
                        type="number"
                        min={0}
                        max={availableMpPotions}
                        value={mpPotionsReserve}
                        disabled={Boolean(activeHunt) || huntActionLoading}
                        data-testid="mp-potions-input"
                        className="client-input"
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setMpPotionsReserve(
                            Number.isFinite(val)
                              ? Math.max(0, Math.min(availableMpPotions, val))
                              : 0
                          );
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Start Hunt Button / Gate notes */}
                <div className="hunt-start-action-row">
                  {!isKnight ? (
                    <div
                      role="note"
                      className="game-alert-box"
                      data-testid="knight-vocation-restriction-note"
                    >
                      {t(locale, 'hunt.knightOnlyVocation')}
                    </div>
                  ) : (activeCharacter?.stats.level ?? 1) < activeZone.minLevel ? (
                    <div role="note" className="game-alert-box" data-testid="level-restriction-note">
                      {t(locale, 'hunt.levelTooLow')}
                    </div>
                  ) : activeHunt ? (
                    <div role="note" className="window-muted-note" data-testid="active-hunt-notice">
                      {t(locale, 'hunt.activeAlreadyExists')}
                    </div>
                  ) : (
                    <GameButton
                      variant="primary"
                      size="md"
                      testId="start-hunt-button"
                      disabled={!canStartHunt || huntActionLoading}
                      onClick={() =>
                        onStartHunt({
                          zoneId: activeZone.id,
                          strategy: selectedStrategy,
                          hpPotions: hpPotionsReserve,
                          mpPotions: mpPotionsReserve
                        })
                      }
                    >
                      {huntActionLoading
                        ? t(locale, 'common.loading')
                        : t(locale, 'hunt.startHunt')}
                    </GameButton>
                  )}
                </div>

                {/* Creatures in Zone list */}
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
              </div>
            )}
          </div>
        )}
      </GameWindow>

      {/* 4. AFK Reward Inbox Window */}
      <GameWindow
        title={t(locale, 'hunt.rewardInboxTitle')}
        iconKey="chest"
        collapsible
        testId="reward-inbox-window"
        headerRight={
          <span className="game-tag" data-testid="reward-inbox-count">
            {rewardItems.length} {t(locale, 'hunt.summaryLoot').toLowerCase()}
          </span>
        }
      >
        <div className="reward-inbox-content" data-testid="reward-inbox-panel">
          {rewardItems.length === 0 ? (
            <p className="window-muted-note" data-testid="reward-inbox-empty">
              {t(locale, 'hunt.noRewards')}
            </p>
          ) : (
            <div className="reward-inbox-grid" data-testid="reward-inbox-grid">
              {rewardItems.map((item) => (
                <div
                  key={item.id}
                  className="reward-inbox-card"
                  data-testid={`reward-item-${item.id}`}
                >
                  <ItemSlot
                    slotId={item.itemId}
                    label={`${t(locale, item.nameKey as TranslationKey)} (x${item.quantity})`}
                    category="item"
                    state="occupied"
                    rarity={item.rarity}
                    stackCount={item.quantity}
                  />
                  <div className="reward-item-details">
                    <strong className="reward-item-name">
                      {t(locale, item.nameKey as TranslationKey)}
                    </strong>
                    <div className="reward-item-badges">
                      <span className={`game-tag rarity-${item.rarity}`}>
                        {t(locale, RARITY_KEY_MAP[item.rarity])}
                      </span>
                      <span className="game-tag game-tag-unclaimed">
                        {t(locale, 'hunt.unclaimed')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </GameWindow>
    </div>
  );
}
