export const SIMULATION_VERSION = '0.1.0' as const;

export interface Clock {
  nowMs(): number;
  nowIso(): string;
}

export interface DeterministicRng {
  nextUint32(): number;
  nextFloat(): number;
  nextInt(minInclusive: number, maxInclusive: number): number;
}

export function createSystemClock(): Clock {
  return {
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString()
  };
}

export function createFixedClock(initialEpochMs: number): Clock & { advanceMs(deltaMs: number): void } {
  if (!Number.isSafeInteger(initialEpochMs) || initialEpochMs < 0) {
    throw new RangeError('initialEpochMs must be a non-negative safe integer');
  }
  let currentMs = initialEpochMs;
  return {
    nowMs: () => currentMs,
    nowIso: () => new Date(currentMs).toISOString(),
    advanceMs: (deltaMs: number) => {
      if (!Number.isSafeInteger(deltaMs) || deltaMs < 0) {
        throw new RangeError('deltaMs must be a non-negative safe integer');
      }
      currentMs += deltaMs;
    }
  };
}

/**
 * Deterministic Mulberry32 PRNG for reproducible server-side simulations (P02+).
 * No gameplay equations are implemented in P01 scaffold.
 */
export function createSeededRng(seed: number): DeterministicRng {
  if (!Number.isInteger(seed)) {
    throw new RangeError('seed must be an integer');
  }
  let state = seed >>> 0;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };

  const nextFloat = (): number => nextUint32() / 0x100000000;

  const nextInt = (minInclusive: number, maxInclusive: number): number => {
    if (!Number.isSafeInteger(minInclusive) || !Number.isSafeInteger(maxInclusive) || maxInclusive < minInclusive) {
      throw new RangeError('Invalid integer bounds for nextInt');
    }
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + Math.floor(nextFloat() * span);
  };

  return {
    nextUint32,
    nextFloat,
    nextInt
  };
}
