import { type StatefulDeterministicRng } from './rng.js';
import {
  type ActiveEncounterState,
  type CombatSimulationConfig,
  type MonsterCombatConfig,
  type ZoneCombatConfig
} from './types.js';

/**
 * Deterministically selects the next monster in a zone using weighted spawn table.
 */
export function selectZoneMonster(
  zone: ZoneCombatConfig,
  config: CombatSimulationConfig,
  rng: StatefulDeterministicRng
): MonsterCombatConfig {
  let totalWeight = 0;
  for (const monsterId of zone.monsterIds) {
    const monster = config.monsters[monsterId];
    if (!monster) {
      throw new Error(`Unknown monster '${monsterId}' in zone '${zone.id}'`);
    }
    totalWeight += monster.spawnWeight;
  }

  const roll = rng.nextInt(1, totalWeight);
  let cumulative = 0;
  let lastMonster: MonsterCombatConfig | null = null;
  for (const monsterId of zone.monsterIds) {
    const monster = config.monsters[monsterId];
    if (!monster) {
      throw new Error(`Unknown monster '${monsterId}' in zone '${zone.id}'`);
    }
    lastMonster = monster;
    cumulative += monster.spawnWeight;
    if (roll <= cumulative) {
      return monster;
    }
  }

  if (!lastMonster) {
    throw new Error(`Zone '${zone.id}' has no monsters configured`);
  }
  return lastMonster;
}

export function createEncounterState(
  encounterSeq: number,
  monster: MonsterCombatConfig,
  playerAttackIntervalMs: number
): ActiveEncounterState {
  return {
    encounterSeq,
    monsterId: monster.id,
    monsterHp: monster.maxHp,
    monsterMaxHp: monster.maxHp,
    nextPlayerAttackInMs: playerAttackIntervalMs,
    nextMonsterAttackInMs: monster.attackIntervalMs
  };
}
