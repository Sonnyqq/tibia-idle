import { type CharacterCombatStatsDto, type CharacterDto } from '@tibia-idle/contracts';
import { type SupportedLocale, t } from '@tibia-idle/i18n';
import { GameIcon } from '../assets/assetRegistry.js';
import {
  computeXpBarProgress,
  formatStatNumber,
  VOCATION_ICON_MAP,
  VOCATION_KEY_MAP
} from '../lib/format.js';
import { GameWindow, StatRow } from './ui/GameUi.js';

export interface CharacterViewProps {
  locale: SupportedLocale;
  character: CharacterDto;
  combatStats?: CharacterCombatStatsDto | undefined;
}

export function CharacterView({ locale, character, combatStats }: CharacterViewProps) {
  const xpProgress = computeXpBarProgress(character.stats.level, character.stats.xp);
  const sharedMeleeHint = t(locale, 'stats.skillSharedNote');

  return (
    <div data-testid="character-view" className="workspace-stack">
      <GameWindow
        title={`${t(locale, 'window.skills')} — ${character.name}`}
        iconKey={VOCATION_ICON_MAP[character.vocation]}
        iconCategory="vocation"
        collapsible
        minimizeLabel={t(locale, 'window.minimize')}
        expandLabel={t(locale, 'window.expand')}
      >
        <div className="char-banner-bar">
          <div className="char-avatar-box">
            <GameIcon
              iconKey={VOCATION_ICON_MAP[character.vocation]}
              category="vocation"
              size={20}
            />
          </div>
          <div className="char-banner-meta">
            <h2 className="char-banner-name">{character.name}</h2>
            <p className="char-banner-sub">
              {t(locale, VOCATION_KEY_MAP[character.vocation])} • {t(locale, 'stats.level')}{' '}
              {character.stats.level}
            </p>
          </div>
        </div>

        <div className="skills-two-col">
          <div>
            <div className="subwindow-title">{t(locale, 'character.attributesTitle')}</div>
            <dl className="mmo-stat-list">
              <StatRow
                testId="char-sheet-level"
                label={t(locale, 'stats.level')}
                value={character.stats.level}
                subBarVariant="xp"
                subBarPercent={xpProgress.percent}
                highlight
              />
              <StatRow
                testId="char-sheet-xp"
                label={t(locale, 'stats.xp')}
                value={formatStatNumber(character.stats.xp, locale)}
              />
              <StatRow
                testId="char-sheet-hp"
                label={t(locale, 'stats.hp')}
                value={`${character.stats.hp} / ${character.stats.maxHp}`}
              />
              <StatRow
                testId="char-sheet-mp"
                label={t(locale, 'stats.mp')}
                value={`${character.stats.mp} / ${character.stats.maxMp}`}
              />
              <StatRow
                testId="char-sheet-gold"
                label={t(locale, 'stats.gold')}
                value={formatStatNumber(character.stats.gold, locale)}
                highlight
              />
              <StatRow
                testId="char-sheet-capacity"
                label={t(locale, 'stats.capacity')}
                value={t(locale, 'stats.unavailable')}
                muted
              />
              <StatRow
                testId="char-sheet-speed"
                label={t(locale, 'stats.speed')}
                value={t(locale, 'stats.unavailable')}
                muted
              />
            </dl>
          </div>

          <div>
            <div className="subwindow-title">{t(locale, 'window.skills')}</div>
            <dl className="mmo-stat-list">
              <StatRow
                testId="char-sheet-magic"
                label={t(locale, 'stats.magic')}
                value={character.stats.magic}
                subBarVariant="skill"
                subBarPercent={0}
              />
              <StatRow
                testId="char-sheet-melee"
                label={t(locale, 'stats.melee')}
                value={character.stats.melee}
                subBarVariant="skill"
                subBarPercent={0}
              />
              <StatRow
                testId="char-sheet-sword"
                label={t(locale, 'stats.sword')}
                value={character.stats.melee}
                subBarVariant="skill"
                subBarPercent={0}
                title={sharedMeleeHint}
              />
              <StatRow
                testId="char-sheet-axe"
                label={t(locale, 'stats.axe')}
                value={character.stats.melee}
                subBarVariant="skill"
                subBarPercent={0}
                title={sharedMeleeHint}
              />
              <StatRow
                testId="char-sheet-club"
                label={t(locale, 'stats.club')}
                value={character.stats.melee}
                subBarVariant="skill"
                subBarPercent={0}
                title={sharedMeleeHint}
              />
              <StatRow
                testId="char-sheet-distance"
                label={t(locale, 'stats.distance')}
                value={character.stats.distance}
                subBarVariant="skill"
                subBarPercent={0}
              />
              <StatRow
                testId="char-sheet-shielding"
                label={t(locale, 'stats.shielding')}
                value={character.stats.shielding}
                subBarVariant="skill"
                subBarPercent={0}
              />
            </dl>
            <p className="window-muted-note">{sharedMeleeHint}</p>
          </div>
        </div>
      </GameWindow>

      {combatStats && (
        <GameWindow
          title={t(locale, 'character.combatStats')}
          iconKey="swords"
          iconCategory="equipment"
          collapsible
          minimizeLabel={t(locale, 'window.minimize')}
          expandLabel={t(locale, 'window.expand')}
          testId="character-combat-stats-panel"
        >
          <div className="subwindow-title">{t(locale, 'character.combatStats')}</div>
          <dl className="mmo-stat-list">
            <StatRow
              testId="combat-stat-attack"
              label={t(locale, 'character.attack')}
              value={
                combatStats.weaponAttack.bonus > 0 ? (
                  <span>
                    {combatStats.weaponAttack.base}{' '}
                    <span className="stat-bonus-positive">+{combatStats.weaponAttack.bonus}</span> ={' '}
                    <strong>{combatStats.weaponAttack.effective}</strong>
                  </span>
                ) : (
                  combatStats.weaponAttack.effective
                )
              }
              highlight={combatStats.weaponAttack.bonus > 0}
            />
            <StatRow
              testId="combat-stat-defense"
              label={t(locale, 'character.defense')}
              value={
                combatStats.shieldDefense.bonus > 0 ? (
                  <span>
                    {combatStats.shieldDefense.base}{' '}
                    <span className="stat-bonus-positive">+{combatStats.shieldDefense.bonus}</span> ={' '}
                    <strong>{combatStats.shieldDefense.effective}</strong>
                  </span>
                ) : (
                  combatStats.shieldDefense.effective
                )
              }
              highlight={combatStats.shieldDefense.bonus > 0}
            />
            <StatRow
              testId="combat-stat-armor"
              label={t(locale, 'character.armor')}
              value={
                combatStats.totalArmor.bonus > 0 ? (
                  <span>
                    {combatStats.totalArmor.base}{' '}
                    <span className="stat-bonus-positive">+{combatStats.totalArmor.bonus}</span> ={' '}
                    <strong>{combatStats.totalArmor.effective}</strong>
                  </span>
                ) : (
                  combatStats.totalArmor.effective
                )
              }
              highlight={combatStats.totalArmor.bonus > 0}
            />
            <StatRow
              testId="combat-stat-crit-chance"
              label={t(locale, 'character.critChance')}
              value={
                combatStats.critChancePermille.bonus > 0 ? (
                  <span>
                    {(combatStats.critChancePermille.base / 10).toFixed(1)}%{' '}
                    <span className="stat-bonus-positive">
                      +{(combatStats.critChancePermille.bonus / 10).toFixed(1)}%
                    </span>{' '}
                    = <strong>{(combatStats.critChancePermille.effective / 10).toFixed(1)}%</strong>
                  </span>
                ) : (
                  `${(combatStats.critChancePermille.effective / 10).toFixed(1)}%`
                )
              }
              highlight={combatStats.critChancePermille.bonus > 0}
            />
            <StatRow
              testId="combat-stat-crit-mult"
              label={t(locale, 'character.critMultiplier')}
              value={`${(combatStats.critMultiplierPermille.effective / 1000).toFixed(2)}x`}
            />
          </dl>
        </GameWindow>
      )}

      <GameWindow
        title={t(locale, 'character.talentsTitle')}
        iconKey="orb"
        collapsible
        minimizeLabel={t(locale, 'window.minimize')}
        expandLabel={t(locale, 'window.expand')}
        testId="character-talents-panel"
      >
        <p className="window-muted-note">{t(locale, 'character.talentsPendingNotice')}</p>
        <div className="talents-row">
          <div className="talent-slot-box" data-testid="talent-slot-1">
            <GameIcon iconKey="shield" size={14} />
            <strong>{t(locale, 'character.talentSlotTier1')}</strong>
          </div>
          <div className="talent-slot-box" data-testid="talent-slot-2">
            <GameIcon iconKey="swords" size={14} />
            <strong>{t(locale, 'character.talentSlotTier2')}</strong>
          </div>
          <div className="talent-slot-box" data-testid="talent-slot-3">
            <GameIcon iconKey="orb" size={14} />
            <strong>{t(locale, 'character.talentSlotTier3')}</strong>
          </div>
        </div>
      </GameWindow>
    </div>
  );
}
