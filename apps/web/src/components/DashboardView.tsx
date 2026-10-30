import { type CharacterDto } from '@tibia-idle/contracts';
import { type SupportedLocale, t } from '@tibia-idle/i18n';
import { GameIcon } from '../assets/assetRegistry.js';
import {
  computeXpBarProgress,
  formatStatNumber,
  type GameTabId,
  VOCATION_ICON_MAP,
  VOCATION_KEY_MAP
} from '../lib/format.js';
import { GameButton, GameWindow, ProgressBar, StatRow } from './ui/GameUi.js';

export interface DashboardViewProps {
  locale: SupportedLocale;
  character: CharacterDto;
  onNavigateTab: (tab: GameTabId) => void;
  onSwitchCharacter: () => void;
}

export function DashboardView({
  locale,
  character,
  onNavigateTab,
  onSwitchCharacter
}: DashboardViewProps) {
  const xpProgress = computeXpBarProgress(character.stats.level, character.stats.xp);
  const hpPercent = Math.min(
    100,
    Math.max(0, Math.floor((character.stats.hp / Math.max(1, character.stats.maxHp)) * 100))
  );
  const mpPercent =
    character.stats.maxMp > 0
      ? Math.min(100, Math.max(0, Math.floor((character.stats.mp / character.stats.maxMp) * 100)))
      : 0;

  return (
    <div data-testid="character-dashboard" className="workspace-stack">
      <GameWindow
        title={t(locale, 'window.characterStatus')}
        iconKey={VOCATION_ICON_MAP[character.vocation]}
        iconCategory="vocation"
        collapsible
        minimizeLabel={t(locale, 'window.minimize')}
        expandLabel={t(locale, 'window.expand')}
        headerRight={
          <GameButton
            size="sm"
            testId="back-to-characters-button"
            onClick={onSwitchCharacter}
          >
            {t(locale, 'character.backToList')}
          </GameButton>
        }
      >
        <div className="char-banner-bar">
          <div className="char-avatar-box">
            <GameIcon
              iconKey={VOCATION_ICON_MAP[character.vocation]}
              category="vocation"
              size={22}
            />
          </div>
          <div className="char-banner-meta">
            <h2 data-testid="dashboard-character-name" className="char-banner-name">
              {character.name}
            </h2>
            <p data-testid="dashboard-vocation" className="char-banner-sub">
              {t(locale, 'character.vocationLabel')}:{' '}
              <strong>{t(locale, VOCATION_KEY_MAP[character.vocation])}</strong> •{' '}
              {t(locale, 'stats.level')} <strong>{character.stats.level}</strong>
            </p>
          </div>
        </div>

        <div className="vitals-bars-panel" data-testid="xp-progress-card">
          <ProgressBar
            variant="hp"
            percent={hpPercent}
            label={t(locale, 'stats.hp')}
            valueText={`${character.stats.hp} / ${character.stats.maxHp}`}
          />
          <ProgressBar
            variant="mana"
            percent={mpPercent}
            label={t(locale, 'stats.mp')}
            valueText={`${character.stats.mp} / ${character.stats.maxMp}`}
          />
          <div className="xp-bar-wrapper">
            <div className="game-progress-meta">
              <span className="game-progress-label">
                {t(locale, 'stats.level')} {character.stats.level} — {t(locale, 'stats.xpProgress')}
              </span>
              <span className="game-progress-value" data-testid="xp-progress-label">
                {formatStatNumber(xpProgress.currentXp, locale)} /{' '}
                {formatStatNumber(xpProgress.nextLevelXp, locale)} ({xpProgress.percent}%)
              </span>
            </div>
            <ProgressBar variant="xp" percent={xpProgress.percent} />
          </div>
        </div>

        <dl className="mmo-stat-columns">
          <StatRow
            testId="stat-level"
            label={t(locale, 'stats.level')}
            value={character.stats.level}
            highlight
          />
          <StatRow
            testId="stat-xp"
            label={t(locale, 'stats.xp')}
            value={formatStatNumber(character.stats.xp, locale)}
          />
          <StatRow
            testId="stat-hp"
            label={t(locale, 'stats.hp')}
            value={`${character.stats.hp} / ${character.stats.maxHp}`}
          />
          <StatRow
            testId="stat-mp"
            label={t(locale, 'stats.mp')}
            value={`${character.stats.mp} / ${character.stats.maxMp}`}
          />
          <StatRow
            testId="stat-gold"
            label={t(locale, 'stats.gold')}
            value={formatStatNumber(character.stats.gold, locale)}
            highlight
          />
          <StatRow
            testId="stat-melee"
            label={t(locale, 'stats.melee')}
            value={character.stats.melee}
          />
          <StatRow
            testId="stat-distance"
            label={t(locale, 'stats.distance')}
            value={character.stats.distance}
          />
          <StatRow
            testId="stat-magic"
            label={t(locale, 'stats.magic')}
            value={character.stats.magic}
          />
          <StatRow
            testId="stat-shielding"
            label={t(locale, 'stats.shielding')}
            value={character.stats.shielding}
          />
        </dl>
      </GameWindow>

      <div className="dashboard-split-windows">
        <GameWindow
          title={t(locale, 'dashboard.activityTitle')}
          iconKey="swords"
          collapsible
          minimizeLabel={t(locale, 'window.minimize')}
          expandLabel={t(locale, 'window.expand')}
          testId="dashboard-activity-card"
        >
          <dl className="mmo-stat-list">
            <StatRow
              label={t(locale, 'dashboard.activityTitle')}
              value={
                <span data-testid="dashboard-activity-status">{t(locale, 'dashboard.idleStatus')}</span>
              }
            />
            <StatRow
              label={t(locale, 'nav.hunts')}
              value={t(locale, 'status.enginePending')}
              muted
            />
          </dl>
          <div className="window-action-strip">
            <GameButton
              variant="primary"
              testId="quick-goto-hunts"
              onClick={() => onNavigateTab('hunts')}
            >
              <GameIcon iconKey="swords" size={14} />
              <span>{t(locale, 'dashboard.goToHunts')}</span>
            </GameButton>
            <GameButton
              testId="quick-goto-inventory"
              onClick={() => onNavigateTab('inventory')}
            >
              <GameIcon iconKey="chest" size={14} />
              <span>{t(locale, 'dashboard.goToInventory')}</span>
            </GameButton>
            <GameButton
              testId="quick-goto-bestiary"
              onClick={() => onNavigateTab('bestiary')}
            >
              <GameIcon iconKey="skull" size={14} />
              <span>{t(locale, 'dashboard.goToBestiary')}</span>
            </GameButton>
          </div>
        </GameWindow>

        <GameWindow
          title={t(locale, 'dashboard.recentEvents')}
          iconKey="crest"
          collapsible
          minimizeLabel={t(locale, 'window.minimize')}
          expandLabel={t(locale, 'window.expand')}
          testId="dashboard-events-card"
        >
          <p data-testid="dashboard-no-events" className="window-muted-note">
            {t(locale, 'dashboard.noEventsYet')}
          </p>
          <p className="window-muted-note">{t(locale, 'dashboard.serverAuthorityNote')}</p>
        </GameWindow>
      </div>
    </div>
  );
}
