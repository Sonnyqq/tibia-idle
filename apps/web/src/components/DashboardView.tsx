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
    <section data-testid="character-dashboard" className="center-panel">
      <div className="panel-card">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.5rem',
            marginBottom: '0.75rem'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <GameIcon iconKey={VOCATION_ICON_MAP[character.vocation]} size={24} />
            <div>
              <h2 data-testid="dashboard-character-name" style={{ margin: 0 }}>
                {character.name}
              </h2>
              <p data-testid="dashboard-vocation" style={{ margin: 0, fontSize: '0.85rem' }}>
                {t(locale, 'character.vocationLabel')}:{' '}
                <strong>{t(locale, VOCATION_KEY_MAP[character.vocation])}</strong>
              </p>
            </div>
          </div>

          <button
            type="button"
            className="btn"
            data-testid="back-to-characters-button"
            onClick={onSwitchCharacter}
          >
            {t(locale, 'character.backToList')}
          </button>
        </div>

        <div className="sub-card" style={{ marginBottom: '0.75rem' }} data-testid="xp-progress-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
            <span>
              {t(locale, 'stats.level')} <strong>{character.stats.level}</strong> —{' '}
              {t(locale, 'stats.xpProgress')}
            </span>
            <span data-testid="xp-progress-label">
              {formatStatNumber(xpProgress.currentXp, locale)} /{' '}
              {formatStatNumber(xpProgress.nextLevelXp, locale)} ({xpProgress.percent}%)
            </span>
          </div>
          <div className="progress-track" role="progressbar" aria-valuenow={xpProgress.percent}>
            <div className="progress-fill-xp" style={{ width: `${xpProgress.percent}%` }} />
          </div>
        </div>

        <dl className="stats-grid">
          <div className="stat-box" data-testid="stat-level">
            <dt>{t(locale, 'stats.level')}</dt>
            <dd>{character.stats.level}</dd>
          </div>
          <div className="stat-box" data-testid="stat-xp">
            <dt>{t(locale, 'stats.xp')}</dt>
            <dd>{formatStatNumber(character.stats.xp, locale)}</dd>
          </div>
          <div className="stat-box" data-testid="stat-hp">
            <dt>{t(locale, 'stats.hp')}</dt>
            <dd>
              {character.stats.hp} / {character.stats.maxHp}
              <div className="progress-track">
                <div className="progress-fill-hp" style={{ width: `${hpPercent}%` }} />
              </div>
            </dd>
          </div>
          <div className="stat-box" data-testid="stat-mp">
            <dt>{t(locale, 'stats.mp')}</dt>
            <dd>
              {character.stats.mp} / {character.stats.maxMp}
              <div className="progress-track">
                <div className="progress-fill-mp" style={{ width: `${mpPercent}%` }} />
              </div>
            </dd>
          </div>
          <div className="stat-box" data-testid="stat-gold">
            <dt>{t(locale, 'stats.gold')}</dt>
            <dd>{formatStatNumber(character.stats.gold, locale)}</dd>
          </div>
          <div className="stat-box" data-testid="stat-melee">
            <dt>{t(locale, 'stats.melee')}</dt>
            <dd>{character.stats.melee}</dd>
          </div>
          <div className="stat-box" data-testid="stat-distance">
            <dt>{t(locale, 'stats.distance')}</dt>
            <dd>{character.stats.distance}</dd>
          </div>
          <div className="stat-box" data-testid="stat-magic">
            <dt>{t(locale, 'stats.magic')}</dt>
            <dd>{character.stats.magic}</dd>
          </div>
          <div className="stat-box" data-testid="stat-shielding">
            <dt>{t(locale, 'stats.shielding')}</dt>
            <dd>{character.stats.shielding}</dd>
          </div>
        </dl>
      </div>

      <div className="panel-card" data-testid="dashboard-activity-card">
        <h3>{t(locale, 'dashboard.activityTitle')}</h3>
        <p data-testid="dashboard-activity-status" style={{ margin: '0 0 0.75rem 0' }}>
          {t(locale, 'dashboard.idleStatus')}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="quick-goto-hunts"
            onClick={() => onNavigateTab('hunts')}
          >
            <GameIcon iconKey="swords" size={16} />
            <span>{t(locale, 'dashboard.goToHunts')}</span>
          </button>
          <button
            type="button"
            className="btn"
            data-testid="quick-goto-inventory"
            onClick={() => onNavigateTab('inventory')}
          >
            <GameIcon iconKey="chest" size={16} />
            <span>{t(locale, 'dashboard.goToInventory')}</span>
          </button>
        </div>
      </div>

      <div className="panel-card" data-testid="dashboard-events-card">
        <h3>{t(locale, 'dashboard.recentEvents')}</h3>
        <p data-testid="dashboard-no-events" style={{ margin: 0, color: 'var(--text-muted)' }}>
          {t(locale, 'dashboard.noEventsYet')}
        </p>
      </div>
    </section>
  );
}
