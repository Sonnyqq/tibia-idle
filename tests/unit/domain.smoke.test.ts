import { createFixedClock, createSeededRng, SIMULATION_VERSION } from '@tibia-idle/domain';
import { describe, expect, it } from 'vitest';

describe('@tibia-idle/domain smoke tests', () => {
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
});
