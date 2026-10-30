import * as nodeCrypto from 'node:crypto';

const { createHash, randomBytes, timingSafeEqual } = nodeCrypto;

interface Argon2Parameters {
  message: Buffer;
  nonce: Buffer;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
}

type Argon2Callback = (err: Error | null, derivedKey: Buffer) => void;

type CryptoWithArgon2 = typeof nodeCrypto & {
  argon2: (
    algorithm: 'argon2d' | 'argon2i' | 'argon2id',
    parameters: Argon2Parameters,
    callback: Argon2Callback
  ) => void;
};

const { argon2 } = nodeCrypto as CryptoWithArgon2;

const ARGON2_MEMORY = 19456;
const ARGON2_PASSES = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_TAG_LENGTH = 32;

export const SESSION_COOKIE_NAME = 'tibia_idle_sid' as const;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function runArgon2id(
  password: string,
  nonce: Buffer,
  memory: number,
  passes: number,
  parallelism: number,
  tagLength: number
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(password, 'utf8'),
        nonce,
        memory,
        passes,
        parallelism,
        tagLength
      },
      (err: Error | null, derivedKey: Buffer) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(derivedKey);
      }
    );
  });
}

export async function hashPasswordArgon2id(password: string): Promise<string> {
  const salt = randomBytes(16);
  const tag = await runArgon2id(
    password,
    salt,
    ARGON2_MEMORY,
    ARGON2_PASSES,
    ARGON2_PARALLELISM,
    ARGON2_TAG_LENGTH
  );
  const saltB64 = salt.toString('base64').replace(/=+$/, '');
  const tagB64 = tag.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${ARGON2_MEMORY},t=${ARGON2_PASSES},p=${ARGON2_PARALLELISM}$${saltB64}$${tagB64}`;
}

export async function verifyPasswordArgon2id(
  password: string,
  encodedHash: string
): Promise<boolean> {
  const parts = encodedHash.split('$');
  if (parts.length !== 6 || parts[1] !== 'argon2id' || parts[2] !== 'v=19') {
    return false;
  }
  const paramsPart = parts[3] ?? '';
  const saltPart = parts[4] ?? '';
  const tagPart = parts[5] ?? '';

  const paramMatch = /^m=(\d+),t=(\d+),p=(\d+)$/.exec(paramsPart);
  if (!paramMatch) {
    return false;
  }
  const memory = Number(paramMatch[1]);
  const passes = Number(paramMatch[2]);
  const parallelism = Number(paramMatch[3]);

  if (
    !Number.isSafeInteger(memory) ||
    !Number.isSafeInteger(passes) ||
    !Number.isSafeInteger(parallelism) ||
    memory < 1024 ||
    passes < 1 ||
    parallelism < 1
  ) {
    return false;
  }

  const salt = Buffer.from(saltPart, 'base64');
  const expectedTag = Buffer.from(tagPart, 'base64');
  if (salt.length < 8 || expectedTag.length < 16) {
    return false;
  }

  try {
    const computedTag = await runArgon2id(
      password,
      salt,
      memory,
      passes,
      parallelism,
      expectedTag.length
    );
    if (computedTag.length !== expectedTag.length) {
      return false;
    }
    return timingSafeEqual(computedTag, expectedTag);
  } catch {
    return false;
  }
}

export function generateOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function constantTimeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) {
    return result;
  }
  for (const pair of cookieHeader.split(';')) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = pair.slice(0, eqIdx).trim();
    const rawVal = pair.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }
  return result;
}

export function serializeSessionCookie(
  rawToken: string,
  maxAgeSeconds: number,
  isSecure: boolean
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function serializeClearSessionCookie(isSecure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  ];
  if (isSecure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export interface RateLimitOptions {
  windowMs: number;
  maxAttempts: number;
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxAttempts: number;

  constructor(options: RateLimitOptions) {
    this.windowMs = options.windowMs;
    this.maxAttempts = options.maxAttempts;
  }

  checkAndRecord(key: string, nowMs: number): boolean {
    const cutoff = nowMs - this.windowMs;
    const existing = this.buckets.get(key) ?? [];
    const active = existing.filter((ts) => ts > cutoff);
    if (active.length >= this.maxAttempts) {
      this.buckets.set(key, active);
      return false;
    }
    active.push(nowMs);
    this.buckets.set(key, active);
    return true;
  }
}
