import { type ZoneCatalogDto } from '@tibia-idle/contracts';
import { type SupportedLocale, t, type TranslationKey } from '@tibia-idle/i18n';
import { GameIcon } from '../assets/assetRegistry.js';
import { DANGER_TIER_KEY_MAP, RARITY_KEY_MAP } from '../lib/format.js';

export interface HuntsViewProps {
  locale: SupportedLocale;
  zones: readonly ZoneCatalogDto[];
  isLoading: boolean;
  errorKey: TranslationKey | null;
  onRetry: () => void;
}

export function HuntsView({ locale, zones, isLoading, errorKey, onRetry }: HuntsViewProps) {
  return (
    <section data-testid="hunts-view" className="center-panel">
      <div className="panel-card">
        <h2>{t(locale, 'nav.hunts')}</h2>
        {isLoading && <p data-testid="hunts-loading">{t(locale, 'common.loading')}</p>}
        {errorKey && (
          <div role="alert" data-testid="hunts-error" className="sub-card">
            <p>{t(locale, errorKey)}</p>
            <button type="button" className="btn" onClick={onRetry}>
              {t(locale, 'common.retry')}
            </button>
          </div>
        )}
        {!isLoading && !errorKey && zones.length === 0 && (
          <p data-testid="hunts-empty">{t(locale, 'hunt.emptyZones')}</p>
        )}

        <div className="zones-grid">
          {zones.map((zone) => (
            <article
              key={zone.id}
              data-testid={`zone-card-${zone.id}`}
              className="sub-card"
              style={{ display: 'grid', gap: '0.65rem' }}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <GameIcon asset={zone.asset} size={22} />
                  <div>
                    <h3 style={{ margin: 0 }}>{t(locale, zone.nameKey as TranslationKey)}</h3>
                    <small style={{ color: 'var(--text-muted)' }}>
                      {t(locale, 'hunt.recommendedLevel')}: {zone.recommendedLevelRange} •{' '}
                      {t(locale, 'hunt.enemyTypes')}:{' '}
                      {t(locale, zone.enemyTypesKey as TranslationKey)}
                    </small>
                  </div>
                </div>

                <button
                  type="button"
                  className="btn"
                  disabled
                  aria-disabled="true"
                  data-testid={`start-hunt-${zone.id}`}
                  title={t(locale, 'hunt.lockedUntilP02')}
                >
                  {t(locale, 'hunt.lockedUntilP02')}
                </button>
              </div>

              <div className="stats-grid">
                <div className="stat-box" data-testid={`zone-xp-rate-${zone.id}`}>
                  <dt>{t(locale, 'hunt.xpPerHour')}</dt>
                  <dd>
                    {zone.expPerHourEstimate !== null
                      ? zone.expPerHourEstimate
                      : t(locale, 'hunt.estimatePending')}
                  </dd>
                </div>
                <div className="stat-box" data-testid={`zone-gold-rate-${zone.id}`}>
                  <dt>{t(locale, 'hunt.goldPerHour')}</dt>
                  <dd>
                    {zone.goldPerHourEstimate !== null
                      ? zone.goldPerHourEstimate
                      : t(locale, 'hunt.estimatePending')}
                  </dd>
                </div>
              </div>

              <div>
                <strong style={{ fontSize: '0.85rem' }}>{t(locale, 'hunt.creaturesInZone')}</strong>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                    gap: '0.5rem',
                    marginTop: '0.4rem'
                  }}
                >
                  {zone.creatures.map((creature) => (
                    <div
                      key={creature.id}
                      data-testid={`zone-creature-${creature.id}`}
                      className="stat-box"
                      style={{ display: 'grid', gap: '0.35rem' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.35rem'
                        }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          <GameIcon asset={creature.asset} size={18} />
                          <strong>{t(locale, creature.nameKey as TranslationKey)}</strong>
                        </span>
                        <span className={`badge badge-danger-${creature.dangerTier}`}>
                          {t(locale, DANGER_TIER_KEY_MAP[creature.dangerTier])}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {t(locale, 'hunt.potentialLoot')}:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                        {creature.lootPreview.map((item) => (
                          <span
                            key={item.id}
                            data-testid={`loot-preview-${item.id}`}
                            className={`badge badge-rarity-${item.rarity}`}
                          >
                            <GameIcon asset={item.asset} size={14} />
                            <span>{t(locale, item.nameKey as TranslationKey)}</span>
                            <small>({t(locale, RARITY_KEY_MAP[item.rarity])})</small>
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
