import { type StatefulDeterministicRng } from './rng.js';
import { type MonsterCombatConfig } from './types.js';

export interface MonsterKillRewardRoll {
  readonly xpGained: number;
  readonly goldGained: number;
  readonly itemsDropped: Readonly<Record<string, number>>;
}

/**
 * Rolls gold and item drops for a single confirmed monster kill.
 * Never produces negative numbers, NaN, or Infinity.
 */
export function rollMonsterKillLoot(
  monster: MonsterCombatConfig,
  rng: StatefulDeterministicRng
): MonsterKillRewardRoll {
  const goldGained = Math.max(0, rng.nextInt(monster.goldMin, monster.goldMax));
  const itemsDropped: Record<string, number> = {};

  for (const dropRule of monster.lootTable) {
    const roll = rng.nextPermilleRoll();
    if (roll < dropRule.chancePermille) {
      const qty = Math.max(1, rng.nextInt(dropRule.minQuantity, dropRule.maxQuantity));
      itemsDropped[dropRule.itemId] = (itemsDropped[dropRule.itemId] ?? 0) + qty;
    }
  }

  return {
    xpGained: Math.max(0, monster.xpReward),
    goldGained,
    itemsDropped
  };
}
