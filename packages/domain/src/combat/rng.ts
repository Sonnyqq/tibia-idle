import { type RngCheckpointState } from './types.js';

export interface StatefulDeterministicRng {
  nextUint32(): number;
  nextFloat01(): number;
  nextInt(minInclusive: number, maxInclusive: number): number;
  nextPermilleRoll(): number;
  getState(): RngCheckpointState;
}

export function createInitialRngState(seed: number): RngCheckpointState {
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError('RNG seed must be a safe integer');
  }
  const normalized = seed >>> 0;
  return {
    seed: normalized,
    state: normalized,
    cursor: 0
  };
}

export function validateRngCheckpointState(rng: RngCheckpointState): void {
  if (
    !Number.isSafeInteger(rng.seed) ||
    rng.seed < 0 ||
    rng.seed > 0xffffffff ||
    !Number.isSafeInteger(rng.state) ||
    rng.state < 0 ||
    rng.state > 0xffffffff ||
    !Number.isSafeInteger(rng.cursor) ||
    rng.cursor < 0
  ) {
    throw new RangeError('Invalid RngCheckpointState');
  }
}

/**
 * Mulberry32 deterministic 32-bit PRNG with explicit state & cursor tracking.
 * Given identical (seed, state, cursor), produces 100% identical sequences across platforms.
 */
export function createStatefulRng(checkpoint: RngCheckpointState): StatefulDeterministicRng {
  validateRngCheckpointState(checkpoint);
  const seed = checkpoint.seed >>> 0;
  let state = checkpoint.state >>> 0;
  let cursor = checkpoint.cursor;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    cursor += 1;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };

  const nextFloat01 = (): number => nextUint32() / 0x100000000;

  const nextInt = (minInclusive: number, maxInclusive: number): number => {
    if (
      !Number.isSafeInteger(minInclusive) ||
      !Number.isSafeInteger(maxInclusive) ||
      maxInclusive < minInclusive
    ) {
      throw new RangeError(`Invalid integer bounds [${minInclusive}, ${maxInclusive}]`);
    }
    if (minInclusive === maxInclusive) {
      // Still advance RNG cursor so call order remains strictly deterministic
      nextUint32();
      return minInclusive;
    }
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + Math.floor(nextFloat01() * span);
  };

  const nextPermilleRoll = (): number => {
    // Returns an integer in [0, 999]
    return Math.floor(nextFloat01() * 1000);
  };

  const getState = (): RngCheckpointState => ({
    seed,
    state,
    cursor
  });

  return {
    nextUint32,
    nextFloat01,
    nextInt,
    nextPermilleRoll,
    getState
  };
}
