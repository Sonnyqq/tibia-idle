import {
  createFixedClock,
  createInitialCharacterStats,
  createSeededRng,
  MAX_CHARACTERS_PER_ACCOUNT,
  normalizeEmail,
  SIMULATION_VERSION,
  validateCharacterNameDomain,
  VOCATION_STARTING_CONFIG
} from '@tibia-idle/domain';
import { describe, expect, it } from 'vitest';

describe('@tibia-idle/domain smoke &IDLE-002 unit tests', () => {
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

    // Boundary: 3 chars valid, 20 chars valid, 2 chars invalid, 21 chars invalid
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

    // Reserved names
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

    const paladinStats = createInitialCharacterStats('paladin');
    expect(paladinStats.distance).toBe(15);
    expect(paladinStats.hp).toBe(155);

    const sorcererStats = createInitialCharacterStats('sorcerer');
    expect(sorcererStats.magic).toBe(10);
    expect(sorcererStats.mp).toBe(125);

    const druidStats = createInitialCharacterStats('druid');
    expect(druidStats.magic).toBe(10);
    expect(druidStats.mp).toBe(125);
  });
});
