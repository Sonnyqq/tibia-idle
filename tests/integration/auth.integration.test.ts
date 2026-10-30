import {
  buildApiServer,
  hashSessionToken,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS
} from '@tibia-idle/api';
import {
  ApiErrorSchema,
  CharacterDtoSchema,
  SessionMeResponseSchema,
  ZonesCatalogResponseSchema
} from '@tibia-idle/contracts';
import {
  applyMigrations,
  createDatabasePool,
  loadMigrationsFromDir,
  resolveTestDatabaseConfig
} from '@tibia-idle/database';
import { createFixedClock } from '@tibia-idle/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

function extractCookieToken(setCookieHeader: string | null): string {
  expect(setCookieHeader).toBeTruthy();
  const firstPair = (setCookieHeader ?? '').split(';')[0] ?? '';
  const parsed = parseCookieHeader(firstPair);
  const raw = parsed[SESSION_COOKIE_NAME];
  expect(raw).toBeTruthy();
  return raw ?? '';
}

describe('Auth, Sessions & Characters PostgreSQL Integration, Security & Concurrency', () => {
  const dbConfig = resolveTestDatabaseConfig(process.env);
  const pool = createDatabasePool(dbConfig);

  beforeAll(async () => {
    const migrations = loadMigrationsFromDir();
    await applyMigrations(pool, migrations);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE characters, sessions, users RESTART IDENTITY CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('registers, hashes password with Argon2id, stores only hashed session token, rotates on login (session fixation defense), and revokes on logout', async () => {
    const clock = createFixedClock(Date.parse('2026-10-30T20:00:00.000Z'));
    const server = buildApiServer({ clock, dbPool: pool, authRateLimitMax: 50 });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });

    try {
      const regRes = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: '  Knight.Player@Example.COM ',
          password: 'SecurePassword!2026',
          locale: 'pl'
        })
      });
      expect(regRes.status).toBe(201);
      const setCookie = regRes.headers.get('set-cookie');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('SameSite=Lax');

      const rawToken1 = extractCookieToken(setCookie);
      const regBody = SessionMeResponseSchema.parse(await regRes.json());
      expect(regBody.user.email).toBe('knight.player@example.com');
      expect(regBody.user.locale).toBe('pl');

      // Verify DB stores Argon2id hash and SHA-256 session token digest, never plaintext
      const userDb = await pool.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [regBody.user.id]
      );
      expect(userDb.rows[0]?.password_hash.startsWith('$argon2id$v=19$')).toBe(true);
      expect(userDb.rows[0]?.password_hash).not.toContain('SecurePassword!2026');

      const sessionDb = await pool.query<{ token_hash: string }>(
        'SELECT token_hash FROM sessions WHERE user_id = $1',
        [regBody.user.id]
      );
      expect(sessionDb.rows[0]?.token_hash).toBe(hashSessionToken(rawToken1));
      expect(sessionDb.rows[0]?.token_hash).not.toBe(rawToken1);

      // Session fixation defense: login with existing cookie revokes rawToken1 and issues rawToken2
      const loginRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${rawToken1}`
        },
        body: JSON.stringify({
          email: 'knight.player@example.com',
          password: 'SecurePassword!2026'
        })
      });
      expect(loginRes.status).toBe(200);
      const rawToken2 = extractCookieToken(loginRes.headers.get('set-cookie'));
      expect(rawToken2).not.toBe(rawToken1);
      const loginBody = SessionMeResponseSchema.parse(await loginRes.json());

      // Old token must now be rejected (revoked)
      const oldMeRes = await fetch(`${baseUrl}/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${rawToken1}` }
      });
      expect(oldMeRes.status).toBe(401);

      // Update locale with valid CSRF
      const localeRes = await fetch(`${baseUrl}/me/locale`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${rawToken2}`,
          'x-csrf-token': loginBody.csrfToken
        },
        body: JSON.stringify({ locale: 'en' })
      });
      expect(localeRes.status).toBe(200);

      // Logout revokes token2 on server
      const logoutRes = await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: `${SESSION_COOKIE_NAME}=${rawToken2}`,
          'x-csrf-token': loginBody.csrfToken
        }
      });
      expect(logoutRes.status).toBe(204);

      const afterLogoutMe = await fetch(`${baseUrl}/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${rawToken2}` }
      });
      expect(afterLogoutMe.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('enforces session expiration, CSRF validation, IDOR character isolation, SQLi immunity, and rate limiting', async () => {
    const clock = createFixedClock(Date.parse('2026-10-30T20:00:00.000Z'));
    const server = buildApiServer({ clock, dbPool: pool, authRateLimitMax: 4 });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });

    try {
      // Register User A
      const regA = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'usera@example.com', password: 'PasswordA!123' })
      });
      const tokenA = extractCookieToken(regA.headers.get('set-cookie'));
      const bodyA = SessionMeResponseSchema.parse(await regA.json());

      // Register User B
      const regB = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'userb@example.com', password: 'PasswordB!123' })
      });
      const tokenB = extractCookieToken(regB.headers.get('set-cookie'));
      const bodyB = SessionMeResponseSchema.parse(await regB.json());

      // CSRF rejection: missing token, wrong token, or cross-site header
      const noCsrfRes = await fetch(`${baseUrl}/characters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${tokenA}`
        },
        body: JSON.stringify({ name: 'Arthos', vocation: 'knight' })
      });
      expect(noCsrfRes.status).toBe(403);
      expect(ApiErrorSchema.parse(await noCsrfRes.json()).error.code).toBe('CSRF_INVALID');

      const crossSiteRes = await fetch(`${baseUrl}/characters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${tokenA}`,
          'x-csrf-token': bodyA.csrfToken,
          'Sec-Fetch-Site': 'cross-site'
        },
        body: JSON.stringify({ name: 'Arthos', vocation: 'knight' })
      });
      expect(crossSiteRes.status).toBe(403);

      // User A creates character legitimately
      const createCharA = await fetch(`${baseUrl}/characters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${tokenA}`,
          'x-csrf-token': bodyA.csrfToken
        },
        body: JSON.stringify({ name: 'Arthos', vocation: 'knight' })
      });
      expect(createCharA.status).toBe(201);
      const charA = CharacterDtoSchema.parse(await createCharA.json());
      expect(charA.stats.level).toBe(1);
      expect(charA.stats.hp).toBe(185);
      expect(charA.stats.melee).toBe(15);

      // User A can read own character and zones catalog; unauthenticated /zones returns 401
      const ownCharRes = await fetch(`${baseUrl}/characters/${charA.id}`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${tokenA}` }
      });
      expect(ownCharRes.status).toBe(200);
      expect(CharacterDtoSchema.parse(await ownCharRes.json()).name).toBe('Arthos');

      const unauthZonesRes = await fetch(`${baseUrl}/zones`);
      expect(unauthZonesRes.status).toBe(401);

      const authZonesRes = await fetch(`${baseUrl}/zones`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${tokenA}` }
      });
      expect(authZonesRes.status).toBe(200);
      const zonesPayload = ZonesCatalogResponseSchema.parse(await authZonesRes.json());
      expect(zonesPayload.simulationEnabled).toBe(false);
      expect(zonesPayload.zones).toHaveLength(3);

      // IDOR check: User B must NOT access User A's character
      const idorRes = await fetch(`${baseUrl}/characters/${charA.id}`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${tokenB}` }
      });
      expect(idorRes.status).toBe(404);

      // SQL injection payload in character name & login email must be rejected safely
      const sqliCharRes = await fetch(`${baseUrl}/characters`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${tokenB}`,
          'x-csrf-token': bodyB.csrfToken
        },
        body: JSON.stringify({
          name: "Robert'); DROP TABLE characters;--",
          vocation: 'sorcerer'
        })
      });
      expect(sqliCharRes.status).toBe(400);

      // Neutral login error messages for non-existent email vs wrong password
      const badEmailLogin = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@example.com', password: 'WrongPassword123' })
      });
      const badPassLogin = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'usera@example.com', password: 'WrongPassword123' })
      });
      expect(badEmailLogin.status).toBe(401);
      expect(badPassLogin.status).toBe(401);
      const err1 = ApiErrorSchema.parse(await badEmailLogin.json());
      const err2 = ApiErrorSchema.parse(await badPassLogin.json());
      expect(err1.error.code).toBe('INVALID_CREDENTIALS');
      expect(err2.error.code).toBe('INVALID_CREDENTIALS');
      expect(err1.error.messageKey).toBe(err2.error.messageKey);

      // Brute-force rate limit kicks in after 4 login attempts in window
      await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'usera@example.com', password: 'WrongPassword123' })
      });
      await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'usera@example.com', password: 'WrongPassword123' })
      });
      const rateLimitedRes = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'usera@example.com', password: 'WrongPassword123' })
      });
      expect(rateLimitedRes.status).toBe(429);
      expect(ApiErrorSchema.parse(await rateLimitedRes.json()).error.code).toBe('RATE_LIMITED');

      // Advance clock past session TTL -> session expires
      clock.advanceMs(SESSION_TTL_MS + 1000);
      const expiredMe = await fetch(`${baseUrl}/me`, {
        headers: { Cookie: `${SESSION_COOKIE_NAME}=${tokenA}` }
      });
      expect(expiredMe.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('prevents duplicate registration and >3 character slot overflow under concurrent race conditions', async () => {
    const clock = createFixedClock(Date.parse('2026-10-30T20:00:00.000Z'));
    const server = buildApiServer({ clock, dbPool: pool, authRateLimitMax: 100 });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });

    try {
      // 1. Concurrent registration race with same email (different casing/whitespace)
      const regAttempts = [
        'race@example.com',
        'RACE@example.com',
        '  Race@Example.com ',
        'race@EXAMPLE.COM',
        'Race@example.com'
      ].map((email) =>
        fetch(`${baseUrl}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'RacePassword!123' })
        })
      );

      const regResponses = await Promise.all(regAttempts);
      const statuses = regResponses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(4);

      const winnerIdx = regResponses.findIndex((r) => r.status === 201);
      const winnerRes = regResponses[winnerIdx];
      expect(winnerRes).toBeDefined();
      const token = extractCookieToken(winnerRes?.headers.get('set-cookie') ?? null);
      const sessionBody = SessionMeResponseSchema.parse(await winnerRes?.json());

      // 2. Concurrent character creation race: 6 simultaneous requests for 3 slots
      const charNames = ['HeroOne', 'HeroTwo', 'HeroThree', 'HeroFour', 'HeroFive', 'HeroSix'];
      const vocations = ['knight', 'paladin', 'sorcerer', 'druid', 'knight', 'paladin'] as const;

      const charRequests = charNames.map((name, idx) =>
        fetch(`${baseUrl}/characters`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `${SESSION_COOKIE_NAME}=${token}`,
            'x-csrf-token': sessionBody.csrfToken
          },
          body: JSON.stringify({ name, vocation: vocations[idx] })
        })
      );

      const charResponses = await Promise.all(charRequests);
      const charStatuses = charResponses.map((r) => r.status);
      expect(charStatuses.filter((s) => s === 201)).toHaveLength(3);
      expect(charStatuses.filter((s) => s === 409)).toHaveLength(3);

      const dbCount = await pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM characters WHERE user_id = $1',
        [sessionBody.user.id]
      );
      expect(Number(dbCount.rows[0]?.count)).toBe(3);
    } finally {
      await server.close();
    }
  });
});
