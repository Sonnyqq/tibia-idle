import { type CreatureCatalogDto, type ZoneCatalogDto } from '@tibia-idle/contracts';
import { type SupportedLocale, t, type TranslationKey } from '@tibia-idle/i18n';
import { useState } from 'react';
import { GameIcon } from '../assets/assetRegistry.js';
import { DANGER_TIER_KEY_MAP, RARITY_KEY_MAP } from '../lib/format.js';

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

  const activeCreature =
    allCreatures.find((c) => c.id === selectedCreatureId) ?? allCreatures[0] ?? null;

  return (
    <section data-testid="bestiary-view" className="center-panel">
      <div className="panel-card">
        <h2>{t(locale, 'bestiary.title')}</h2>

        {isLoading && <p data-testid="bestiary-loading">{t(locale, 'common.loading')}</p>}

        {errorKey && (
          <div role="alert" data-testid="bestiary-error" className="sub-card">
            <p>{t(locale, errorKey)}</p>
            <button type="button" className="btn" onClick={onRetry}>
              {t(locale, 'common.retry')}
            </button>
          </div>
        )}

        {!isLoading && !errorKey && allCreatures.length === 0 && (
          <p data-testid="bestiary-empty">{t(locale, 'bestiary.emptyList')}</p>
        )}

        {!isLoading && !errorKey && allCreatures.length > 0 && (
          <div className="bestiary-layout">
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'grid',
                gap: '0.4rem'
              }}
              data-testid="bestiary-creature-list"
            >
              {allCreatures.map((creature) => (
                <li key={creature.id}>
                  <button
                    type="button"
                    className="btn sidebar-nav-btn"
                    data-testid={`bestiary-select-${creature.id}`}
                    aria-pressed={activeCreature?.id === creature.id}
                    onClick={() => setSelectedCreatureId(creature.id)}
                  >
                    <GameIcon asset={creature.asset} size={18} />
                    <span>{t(locale, creature.nameKey as TranslationKey)}</span>
                  </button>
                </li>
              ))}
            </ul>

            {activeCreature ? (
              <div className="sub-card" data-testid="bestiary-detail-panel">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.75rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <GameIcon asset={activeCreature.asset} size={24} />
                    <div>
                      <h3 data-testid="bestiary-detail-name" style={{ margin: 0 }}>
                        {t(locale, activeCreature.nameKey as TranslationKey)}
                      </h3>
                      <small style={{ color: 'var(--text-muted)' }}>
                        {t(locale, 'stats.level')} {activeCreature.minLevel}+
                      </small>
                    </div>
                  </div>
                  <span className={`badge badge-danger-${activeCreature.dangerTier}`}>
                    {t(locale, DANGER_TIER_KEY_MAP[activeCreature.dangerTier])}
                  </span>
                </div>

                <div className="stats-grid" style={{ marginBottom: '0.75rem' }}>
                  <div className="stat-box" data-testid="bestiary-kill-count">
                    <dt>{t(locale, 'bestiary.killCountLabel')}</dt>
                    <dd>0</dd>
                  </div>
                  <div className="stat-box" data-testid="bestiary-stage-status">
                    <dt>{t(locale, 'bestiary.charmsTitle')}</dt>
                    <dd>{t(locale, 'bestiary.stageLocked')}</dd>
                  </div>
                </div>

                <div style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ fontSize: '0.85rem' }}>{t(locale, 'hunt.potentialLoot')}</strong>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.35rem',
                      marginTop: '0.4rem'
                    }}
                  >
                    {activeCreature.lootPreview.map((item) => (
                      <span
                        key={item.id}
                        className={`badge badge-rarity-${item.rarity}`}
                        data-testid={`bestiary-loot-${item.id}`}
                      >
                        <GameIcon asset={item.asset} size={14} />
                        <span>{t(locale, item.nameKey as TranslationKey)}</span>
                        <small>({t(locale, RARITY_KEY_MAP[item.rarity])})</small>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="stat-box" data-testid="bestiary-charms-box">
                  <dt>{t(locale, 'bestiary.charmsTitle')}</dt>
                  <dd style={{ fontSize: '0.85rem', fontWeight: 400 }}>
                    {t(locale, 'bestiary.charmsNotice')}
                  </dd>
                </div>
              </div>
            ) : (
              <p>{t(locale, 'bestiary.selectPrompt')}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
