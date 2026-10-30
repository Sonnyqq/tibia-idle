import {
  constantTimeEqualStrings,
  generateOpaqueToken,
  hashPasswordArgon2id,
  hashSessionToken,
  parseCookieHeader,
  serializeClearSessionCookie,
  serializeSessionCookie,
  SESSION_COOKIE_NAME,
  SlidingWindowRateLimiter,
  verifyPasswordArgon2id
} from '@tibia-idle/api';
import { describe, expect, it } from 'vitest';

describe('API security primitives (Argon2id, session tokens, cookies, rate limiter)', () => {
  it('hashes and verifies passwords with Argon2id and rejects wrong or malformed hashes', async () => {
    const hash = await hashPasswordArgon2id('MySecretPass!99');
    expect(hash.startsWith('$argon2id$v=19$')).toBe(true);
    expect(await verifyPasswordArgon2id('MySecretPass!99', hash)).toBe(true);
    expect(await verifyPasswordArgon2id('WrongPassword!99', hash)).toBe(false);
    expect(await verifyPasswordArgon2id('MySecretPass!99', 'invalid-hash')).toBe(false);
  });

  it('generates high-entropy opaque tokens, SHA-256 digests, and HttpOnly cookies', () => {
    const tokenA = generateOpaqueToken(32);
    const tokenB = generateOpaqueToken(32);
    expect(tokenA).not.toBe(tokenB);
    expect(tokenA.length).toBeGreaterThanOrEqual(40);

    const digest = hashSessionToken(tokenA);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(tokenA);

    const cookieHttp = serializeSessionCookie(tokenA, 3600, false);
    expect(cookieHttp).toContain(`${SESSION_COOKIE_NAME}=${tokenA}`);
    expect(cookieHttp).toContain('HttpOnly');
    expect(cookieHttp).toContain('SameSite=Lax');
    expect(cookieHttp).not.toContain('Secure');

    const cookieHttps = serializeSessionCookie(tokenA, 3600, true);
    expect(cookieHttps).toContain('Secure');

    const clearCookie = serializeClearSessionCookie(true);
    expect(clearCookie).toContain('Max-Age=0');
    expect(clearCookie).toContain('Secure');

    const parsed = parseCookieHeader(`foo=bar; ${SESSION_COOKIE_NAME}=${tokenA}; theme=dark`);
    expect(parsed[SESSION_COOKIE_NAME]).toBe(tokenA);
    expect(constantTimeEqualStrings('abc', 'abc')).toBe(true);
    expect(constantTimeEqualStrings('abc', 'abd')).toBe(false);
  });

  it('enforces sliding window rate limits and recovers after window expiry', () => {
    const limiter = new SlidingWindowRateLimiter({ maxAttempts: 2, windowMs: 1000 });
    expect(limiter.checkAndRecord('ip:1', 100)).toBe(true);
    expect(limiter.checkAndRecord('ip:1', 200)).toBe(true);
    expect(limiter.checkAndRecord('ip:1', 300)).toBe(false);
    expect(limiter.checkAndRecord('ip:1', 1150)).toBe(true);
  });
});
