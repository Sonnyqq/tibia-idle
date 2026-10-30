import { type CharacterDto } from '@tibia-idle/contracts';
import { type SupportedLocale, t } from '@tibia-idle/i18n';
import { GameIcon } from '../assets/assetRegistry.js';
import { formatStatNumber, VOCATION_ICON_MAP, VOCATION_KEY_MAP } from '../lib/format.js';

export interface CharacterViewProps {
  locale: SupportedLocale;
  character: CharacterDto;
}

export function CharacterView({ locale, character }: CharacterViewProps) {
  return (
    <section data-testid="character-view" className="center-panel">
      <div className="panel-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
          <GameIcon iconKey={VOCATION_ICON_MAP[character.vocation]} size={26} />
          <div>
            <h2 style={{ margin: 0 }}>{character.name}</h2>
            <small style={{ color: 'var(--text-muted)' }}>
              {t(locale, VOCATION_KEY_MAP[character.vocation])} • {t(locale, 'stats.level')}{' '}
              {character.stats.level}
            </small>
          </div>
        </div>

        <h3>{t(locale, 'character.attributesTitle')}</h3>
        <dl className="stats-grid">
          <div className="stat-box" data-testid="char-sheet-level">
            <dt>{t(locale, 'stats.level')}</dt>
            <dd>{character.stats.level}</dd>
          </div>
          <div className="stat-box" data-testid="char-sheet-xp">
            <dt>{t(locale, 'stats.xp')}</dt>
            <dd>{formatStatNumber(character.stats.xp, locale)}</dd>
          </div>
          <div className="stat-box" data-testid="char-sheet-hp">
            <dt>{t(locale, 'stats.hp')}</dt>
            <dd>
              {character.stats.hp} / {character.stats.maxHp}
            </dd>
          </div>
          <div className="stat-box" data-testid="char-sheet-mp">
            <dt>{t(locale, 'stats.mp')}</dt>
            <dd>
              {character.stats.mp} / {character.stats.maxMp}
            </dd>
          </div>
          <div className="stat-box" data-testid="char-sheet-gold">
            <dt>{t(locale, 'stats.gold')}</dt>
            <dd>{formatStatNumber(character.stats.gold, locale)}</dd>
          </div>
          <div className="stat-box" data-testid="char-sheet-melee">
            <dt>{t(locale, 'stats.melee')}</dt>
            <dd>{character.stats.melee}</dd>
          </div>
          <div className="stat-box" data-testid="char-sheet-distance">
            <dt>{t(locale, 'stats.distance')}</dt>
            <dd>{character.stats.distance}</dd>
          </div>
          <div className="stat-box" data-testid="char-sheet-magic">
            <dt>{t(locale, 'stats.magic')}</dt>
            <dd>{character.stats.magic}</dd>
          </div>
          <div className="stat-box" data-testid="char-sheet-shielding">
            <dt>{t(locale, 'stats.shielding')}</dt>
            <dd>{character.stats.shielding}</dd>
          </div>
        </dl>
      </div>

      <div className="panel-card" data-testid="character-talents-panel">
        <h3>{t(locale, 'character.talentsTitle')}</h3>
        <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>
          {t(locale, 'character.talentsPendingNotice')}
        </p>
        <div className="stats-grid">
          <div className="sub-card" data-testid="talent-slot-1">
            <strong>{t(locale, 'character.talentSlotTier1')}</strong>
          </div>
          <div className="sub-card" data-testid="talent-slot-2">
            <strong>{t(locale, 'character.talentSlotTier2')}</strong>
          </div>
          <div className="sub-card" data-testid="talent-slot-3">
            <strong>{t(locale, 'character.talentSlotTier3')}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}
