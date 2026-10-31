import {
  type CombatCheckpointState,
  type PublicHuntCheckpointView,
  type RngCheckpointState
} from './types.js';

export interface StatefulDeterministicRng {
  nextUint32(): number;
  nextFloat01(): number;
  nextInt(minInclusive: number, maxInclusive: number): number;
  nextPermilleRoll(): number;
  getState(): RngCheckpointState;
}

const FORBIDDEN_PUBLIC_RNG_KEYS = new Set(['rng', 'seed', 'cursor', 'rngState']);

/**
 * Generates a server-authoritative 32-bit unsigned seed from a cryptographic source
 * (defaults to Web Crypto `globalThis.crypto.getRandomValues`).
 * Never accept a seed from client requests in production endpoints.
 */
export function generateCryptographicHuntSeed(
  randomBytesSource?: ((byteLength: number) => Uint8Array) | undefined
): number {
  let bytes: Uint8Array;
  if (randomBytesSource !== undefined) {
    bytes = randomBytesSource(4);
  } else if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  ) {
    bytes = new Uint8Array(4);
    globalThis.crypto.getRandomValues(bytes);
  } else {
    throw new Error('Cryptographic random source is unavailable for server seed generation');
  }

  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) {
    throw new RangeError('Cryptographic seed source must return at least 4 bytes');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
  return view.getUint32(0, false) >>> 0;
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
    typeof rng !== 'object' ||
    rng === null ||
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
 * Projects an internal server checkpoint into a public DTO view that strips
 * private RNG state (`seed`, `state`, `cursor`) and internal snapshot internals.
 */
export function toPublicHuntCheckpointView(
  checkpoint: CombatCheckpointState
): PublicHuntCheckpointView {
  return {
    simulationVersion: checkpoint.simulationVersion,
    configDigest: checkpoint.configDigest,
    zoneId: checkpoint.zoneId,
    strategy: checkpoint.strategy,
    elapsedMs: checkpoint.elapsedMs,
    currentHp: checkpoint.currentHp,
    currentMp: checkpoint.currentMp,
    hpPotionsRemaining: checkpoint.hpPotionsRemaining,
    mpPotionsRemaining: checkpoint.mpPotionsRemaining,
    nextPassiveRegenInMs: checkpoint.nextPassiveRegenInMs,
    respawnCooldownRemainingMs: checkpoint.respawnCooldownRemainingMs,
    activeEncounter: checkpoint.activeEncounter ? { ...checkpoint.activeEncounter } : null,
    totalKills: checkpoint.totalKills,
    killsByMonster: { ...checkpoint.killsByMonster },
    totalXpGained: checkpoint.totalXpGained,
    totalGoldGained: checkpoint.totalGoldGained,
    totalLootByItem: { ...checkpoint.totalLootByItem },
    totalDamageDealt: checkpoint.totalDamageDealt,
    totalDamageTaken: checkpoint.totalDamageTaken,
    hpPotionsUsed: checkpoint.hpPotionsUsed,
    mpPotionsUsed: checkpoint.mpPotionsUsed,
    brutalStrikesCast: checkpoint.brutalStrikesCast,
    terminated: checkpoint.terminated,
    stopReason: checkpoint.stopReason
  };
}

/**
 * Guard verifying that no private RNG state (`rng`, `seed`, `cursor`, `rngState`)
 * leaks in any public API payload.
 */
export function assertNoRngLeakInPublicPayload(payload: unknown): void {
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_PUBLIC_RNG_KEYS.has(key)) {
        throw new Error(`Security boundary violation: private RNG field '${key}' leaked in payload`);
      }
      visit(value);
    }
  };
  visit(payload);
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
