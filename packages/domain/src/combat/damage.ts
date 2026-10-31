import { type StatefulDeterministicRng } from './rng.js';
import {
  type CombatCharacterSnapshot,
  type MonsterCombatConfig,
  type StrategyProfileConfig
} from './types.js';

export interface PlayerAttackRollResult {
  readonly damage: number;
  readonly isCritical: boolean;
  readonly usedBrutalStrike: boolean;
  readonly manaSpent: number;
}

/**
 * Calculates deterministic Knight attack damage against a monster.
 * Uses an original genre-inspired formula controlled by versioned parameters.
 */
export function resolveKnightAttack(
  character: CombatCharacterSnapshot,
  monster: MonsterCombatConfig,
  strategy: StrategyProfileConfig,
  currentMp: number,
  rng: StatefulDeterministicRng
): PlayerAttackRollResult {
  const canUseBrutalStrike =
    strategy.useBrutalStrike &&
    strategy.brutalStrikeManaCost > 0 &&
    currentMp >= strategy.brutalStrikeManaCost;

  const manaSpent = canUseBrutalStrike ? strategy.brutalStrikeManaCost : 0;

  // Base power scales with melee skill, weapon attack, and level
  const baseAttackPower =
    Math.floor((character.melee * character.equipment.weaponAttack) / 9) +
    Math.floor(character.level / 2) +
    4;

  const stanceAdjustedMax = Math.max(
    2,
    Math.floor((baseAttackPower * strategy.attackFactorPermille) / 1000)
  );
  const stanceAdjustedMin = Math.max(1, Math.floor(stanceAdjustedMax * 0.35));

  let rawHit = rng.nextInt(stanceAdjustedMin, stanceAdjustedMax);

  if (canUseBrutalStrike) {
    rawHit = Math.floor((rawHit * strategy.brutalStrikeBonusPermille) / 1000);
  }

  const critRoll = rng.nextPermilleRoll();
  const isCritical = critRoll < character.equipment.critChancePermille;
  if (isCritical) {
    rawHit = Math.floor((rawHit * character.equipment.critMultiplierPermille) / 1000);
  }

  // Monster defense & armor mitigation
  const defenseBlock = rng.nextInt(
    Math.floor(monster.defense / 3),
    Math.max(Math.floor(monster.defense / 3), monster.defense)
  );
  const armorReduction = Math.floor(monster.armor * 0.65);

  const mitigated = rawHit - defenseBlock - armorReduction;
  // Minimum glancing blow of 1 damage if rawHit > monster.armor / 2
  const minGlance = rawHit > Math.floor(monster.armor / 2) ? 1 : 0;
  const finalDamage = Math.max(minGlance, mitigated);

  return {
    damage: Number.isSafeInteger(finalDamage) && finalDamage >= 0 ? finalDamage : 0,
    isCritical,
    usedBrutalStrike: canUseBrutalStrike,
    manaSpent
  };
}

/**
 * Calculates deterministic monster attack damage against a Knight.
 * Accounts for monster attack, armor penetration, Knight shielding (scaled by strategy), and armor.
 */
export function resolveMonsterAttack(
  monster: MonsterCombatConfig,
  character: CombatCharacterSnapshot,
  strategy: StrategyProfileConfig,
  rng: StatefulDeterministicRng
): number {
  if (monster.attack <= 0) {
    rng.nextUint32();
    rng.nextUint32();
    return 0;
  }

  const rawMin = Math.max(1, Math.floor(monster.attack * 0.4));
  const rawMax = Math.max(rawMin, monster.attack);
  const rawAttack = rng.nextInt(rawMin, rawMax);

  // Shielding block scaled by strategy defense factor
  const baseShieldCapacity = Math.floor(
    (character.shielding * character.equipment.shieldDefense) / 13
  );
  const effectiveShieldMax = Math.max(
    1,
    Math.floor((baseShieldCapacity * strategy.defenseFactorPermille) / 1000)
  );
  const effectiveShieldMin = Math.floor(effectiveShieldMax * 0.35);
  const shieldBlocked = rng.nextInt(effectiveShieldMin, effectiveShieldMax);

  // Effective armor after monster armor penetration
  const effectiveArmor = Math.max(
    0,
    Math.floor(
      (character.equipment.totalArmor * (1000 - monster.armorPenetrationPermille)) / 1000
    )
  );
  const armorMitigation = Math.floor(effectiveArmor * 0.75);

  const netDamage = Math.max(0, rawAttack - shieldBlocked - armorMitigation);
  return Number.isSafeInteger(netDamage) ? netDamage : 0;
}
