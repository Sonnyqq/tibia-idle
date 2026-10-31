import {
  calculateCharacterMaxCapacity,
  calculateCharacterVitalsForLevel,
  calculateInventoryCapacity,
  calculateInventoryWeight,
  calculateLevelXpProgress,
  calculateTotalXpForLevel,
  createFixedClock,
  createInitialCharacterStats,
  createSeededRng,
  getItemDefinition,
  INITIAL_ZONES_CATALOG,
  ITEM_DEFINITIONS,
  MAX_CHARACTERS_PER_ACCOUNT,
  normalizeEmail,
  resolveLevelFromTotalXp,
  SIMULATION_VERSION,
  validateCharacterNameDomain,
  VOCATION_STARTING_CONFIG
} from '@tibia-idle/domain';
import { describe, expect, it } from 'vitest';

describe('@tibia-idle/domain smoke & unit tests', () => {
  it('exposes simulation version and deterministic fixed clock', () => {
    expect(SIMULATION_VERSION).toBe('0.1.0');
    const clock = createFixedClock(1_700_000_000_000);
    expect(clock.nowMs()).toBe(1_700_000_000_000);
    clock.advanceMs(5_000);
    expect(clock.nowMs()).toBe(1_700_000_005_000);
    expect(() => clock.advanceMs(-1)).toThrow(RangeError);
  });

  it('produces identical RNG sequences for identical seeds', () => {
    const rngA = createSeededRng(42);
    const rngB = createSeededRng(42);
    const rngC = createSeededRng(43);

    const seqA = Array.from({ length: 10 }, () => rngA.nextInt(1, 100));
    const seqB = Array.from({ length: 10 }, () => rngB.nextInt(1, 100));
    const seqC = Array.from({ length: 10 }, () => rngC.nextInt(1, 100));

    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('normalizes emails and validates character names including boundaries and reserved words', () => {
    expect(normalizeEmail('  Hero.Player@Example.COM ')).toBe('hero.player@example.com');
    expect(MAX_CHARACTERS_PER_ACCOUNT).toBe(3);

    const valid = validateCharacterNameDomain('  Sir   Knight-One ');
    expect(valid).toEqual({
      ok: true,
      displayName: 'Sir Knight-One',
      normalizedKey: 'sir knight-one'
    });

    expect(validateCharacterNameDomain('Abc').ok).toBe(true);
    expect(validateCharacterNameDomain('A'.repeat(20)).ok).toBe(true);
    expect(validateCharacterNameDomain('Ab')).toEqual({ ok: false, reason: 'INVALID_FORMAT' });
    expect(validateCharacterNameDomain('A'.repeat(21))).toEqual({
      ok: false,
      reason: 'INVALID_FORMAT'
    });
    expect(validateCharacterNameDomain('Hero123')).toEqual({
      ok: false,
      reason: 'INVALID_FORMAT'
    });

    for (const reserved of ['Admin', 'GameMaster', 'GM', 'God', 'CipSoft', 'Tibia', 'Support Hero']) {
      expect(validateCharacterNameDomain(reserved)).toEqual({
        ok: false,
        reason: 'RESERVED_NAME'
      });
    }
  });

  it('creates initial Level 1 character stats for all 4 vocations from configuration', () => {
    const knightStats = createInitialCharacterStats('knight');
    expect(knightStats).toEqual({
      level: 1,
      xp: 0,
      hp: VOCATION_STARTING_CONFIG.knight.hp,
      maxHp: VOCATION_STARTING_CONFIG.knight.hp,
      mp: VOCATION_STARTING_CONFIG.knight.mp,
      maxMp: VOCATION_STARTING_CONFIG.knight.mp,
      gold: 100,
      melee: 15,
      distance: 10,
      magic: 1,
      shielding: 15
    });

    expect(createInitialCharacterStats('paladin').distance).toBe(15);
    expect(createInitialCharacterStats('sorcerer').magic).toBe(10);
    expect(createInitialCharacterStats('druid').magic).toBe(10);
  });

  it('exposes static zone catalog without fake reward rates and computes level XP progress', () => {
    expect(INITIAL_ZONES_CATALOG).toHaveLength(3);
    const creatures = INITIAL_ZONES_CATALOG.flatMap((z) => z.creatures);
    expect(creatures).toHaveLength(6);
    const lootItems = creatures.flatMap((c) => c.lootPreview);
    expect(lootItems).toHaveLength(12);

    for (const zone of INITIAL_ZONES_CATALOG) {
      expect(zone.expPerHourEstimate).toBeNull();
      expect(zone.goldPerHourEstimate).toBeNull();
    }

    expect(calculateTotalXpForLevel(1)).toBe(0);
    expect(calculateTotalXpForLevel(2)).toBe(100);
    expect(calculateTotalXpForLevel(3)).toBe(300);
    const progress = calculateLevelXpProgress(1, 45);
    expect(progress.nextLevelXp).toBe(100);
    expect(progress.progressPercent).toBe(45);

    expect(resolveLevelFromTotalXp(0)).toBe(1);
    expect(resolveLevelFromTotalXp(99)).toBe(1);
    expect(resolveLevelFromTotalXp(100)).toBe(2);
    expect(resolveLevelFromTotalXp(299)).toBe(2);
    expect(resolveLevelFromTotalXp(300)).toBe(3);
    expect(resolveLevelFromTotalXp(calculateTotalXpForLevel(25))).toBe(25);
    expect(() => resolveLevelFromTotalXp(-1)).toThrow(RangeError);
    expect(() => resolveLevelFromTotalXp(Number.NaN)).toThrow(RangeError);

    expect(calculateCharacterVitalsForLevel('knight', 1)).toEqual({ maxHp: 185, maxMp: 40 });
    expect(calculateCharacterVitalsForLevel('knight', 5)).toEqual({ maxHp: 245, maxMp: 60 });
  });

  it('validates server-authoritative item catalog definitions for all 12 items and capacity formulas', () => {
    const all12CatalogIds = [
      'copper-coin',
      'rat-pelt',
      'chitin-plate',
      'glow-moss',
      'ancient-bone',
      'rusted-blade',
      'wraith-essence',
      'silver-ring',
      'drake-scale',
      'ash-talon',
      'ember-scroll',
      'ritual-amulet'
    ];

    expect(ITEM_DEFINITIONS).toHaveLength(12);
    for (const id of all12CatalogIds) {
      const def = getItemDefinition(id);
      expect(def).toBeDefined();
      if (!def) throw new Error(`Missing item definition: ${id}`);
      expect(def.itemId).toBe(id);
      expect(Number.isSafeInteger(def.weightUnits)).toBe(true);
      expect(def.weightUnits).toBeGreaterThanOrEqual(1);
      expect(Number.isSafeInteger(def.maxStackSize)).toBe(true);
      expect(def.maxStackSize).toBeGreaterThanOrEqual(1);

      if (def?.stackable) {
        expect(def.maxStackSize).toBe(100);
      } else {
        expect(def?.maxStackSize).toBe(1);
        expect(def?.equipmentSlot).toBeDefined();
      }
    }

    // Capacity scaling per vocation
    expect(calculateCharacterMaxCapacity('knight', 1)).toBe(5000);
    expect(calculateCharacterMaxCapacity('knight', 2)).toBe(5250);
    expect(calculateCharacterMaxCapacity('paladin', 1)).toBe(4000);
    expect(calculateCharacterMaxCapacity('paladin', 3)).toBe(4400);
    expect(calculateCharacterMaxCapacity('sorcerer', 1)).toBe(3000);
    expect(calculateCharacterMaxCapacity('druid', 1)).toBe(3000);

    // Inventory weight calculation
    const testItems = [
      { itemId: 'copper-coin', quantity: 100 }, // 100 * 1 = 100
      { itemId: 'rusted-blade', quantity: 1 },  // 1 * 250 = 250
      { itemId: 'rat-pelt', quantity: 20 }      // 20 * 5 = 100
    ];
    const weight = calculateInventoryWeight(testItems);
    expect(weight).toBe(450);

    const cap = calculateInventoryCapacity('knight', 1, testItems, 20);
    expect(cap).toEqual({
      currentWeight: 450,
      maxWeight: 5000,
      remainingCapacity: 4550,
      occupiedSlots: 3,
      maxSlots: 20
    });
  });
});
