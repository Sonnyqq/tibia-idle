import {
  buildApiServer,
  parseCookieHeader,
  SESSION_COOKIE_NAME
} from '@tibia-idle/api';
import {
  ActiveHuntResponseSchema,
  ApiErrorSchema,
  CharacterDtoSchema,
  CharacterHuntRewardsResponseSchema,
  HuntSegmentsResponseSchema,
  SessionMeResponseSchema,
  SettleHuntResponseSchema,
  StartHuntResponseSchema,
  StopHuntResponseSchema
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

describe('Hunts API Integration, Security, Knight Gate & Idempotency', () => {
  const dbConfig = resolveTestDatabaseConfig(process.env);
  const pool = createDatabasePool(dbConfig);

  beforeAll(async () => {
    await pool.query(
      'DROP TABLE IF EXISTS currency_ledger, hunt_reward_items, hunt_segments, hunts, characters, sessions, users, schema_migrations CASCADE'
    );
    const migrations = loadMigrationsFromDir();
    await applyMigrations(pool, migrations);
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE currency_ledger, hunt_reward_items, hunt_segments, hunts, characters, sessions, users RESTART IDENTITY CASCADE'
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('enforces 401 Unauthorized across all hunt routes without active session', async () => {
    const server = buildApiServer({ dbPool: pool });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });

    try {
      const dummyId = '00000000-0000-0000-0000-000000000001';

      const res1 = await fetch(`${baseUrl}/hunts/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: dummyId,
          zoneId: 'sewers',
          strategy: 'safe',
          idempotencyKey: 'key-1'
        })
      });
      expect(res1.status).toBe(401);
      const json1 = ApiErrorSchema.parse(await res1.json());
      expect(json1.error.code).toBe('UNAUTHORIZED');

      const res2 = await fetch(`${baseUrl}/hunts/active?characterId=${dummyId}`);
      expect(res2.status).toBe(401);

      const res3 = await fetch(`${baseUrl}/hunts/${dummyId}`);
      expect(res3.status).toBe(401);

      const res4 = await fetch(`${baseUrl}/hunts/${dummyId}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: 'key-2' })
      });
      expect(res4.status).toBe(401);

      const res5 = await fetch(`${baseUrl}/hunts/${dummyId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: 'key-3' })
      });
      expect(res5.status).toBe(401);

      const res6 = await fetch(`${baseUrl}/hunts/${dummyId}/segments`);
      expect(res6.status).toBe(401);

      const res7 = await fetch(`${baseUrl}/characters/${dummyId}/hunt-rewards`);
      expect(res7.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('enforces 403 CSRF defense on mutation routes', async () => {
    const clock = createFixedClock(Date.parse('2026-10-31T12:00:00.000Z'));
    const server = buildApiServer({ clock, dbPool: pool });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });

    try {
      const regRes = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'csrf-tester@example.com',
          password: 'Password123!',
          locale: 'en'
        })
      });
      expect(regRes.status).toBe(201);
      const regToken = extractCookieToken(regRes.headers.get('set-cookie'));
      const cookieHeader = `${SESSION_COOKIE_NAME}=${regToken}`;

      // Start hunt without x-csrf-token
      const startRes = await fetch(`${baseUrl}/hunts/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookieHeader
        },
        body: JSON.stringify({
          characterId: '00000000-0000-0000-0000-000000000001',
          zoneId: 'sewers',
          strategy: 'safe',
          idempotencyKey: 'key-1'
        })
      });
      expect(startRes.status).toBe(403);
      const startErr = ApiErrorSchema.parse(await startRes.json());
      expect(startErr.error.code).toBe('CSRF_INVALID');
    } finally {
      await server.close();
    }
  });

  it('rejects cheat payload properties (.strict()) and enforces knight-only vocation gate', async () => {
    const clock = createFixedClock(Date.parse('2026-10-31T12:00:00.000Z'));
    const server = buildApiServer({ clock, dbPool: pool });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });

    try {
      const regRes = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'sorcerer-test@example.com',
          password: 'Password123!',
          locale: 'en'
        })
      });
      const regJson = SessionMeResponseSchema.parse(await regRes.json());
      const rawToken = extractCookieToken(regRes.headers.get('set-cookie'));
      const authHeaders = {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
        'x-csrf-token': regJson.csrfToken
      };

      // Create a sorcerer
      const charRes = await fetch(`${baseUrl}/characters`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'MysticSorcerer',
          vocation: 'sorcerer'
        })
      });
      expect(charRes.status).toBe(201);
      const sorcerer = CharacterDtoSchema.parse(await charRes.json());

      // Attempt to start hunt with sorcerer -> 400 UNSUPPORTED_VOCATION
      const huntRes = await fetch(`${baseUrl}/hunts/start`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          characterId: sorcerer.id,
          zoneId: 'sewers',
          strategy: 'safe',
          idempotencyKey: 'hunt-sorc-1'
        })
      });
      expect(huntRes.status).toBe(400);
      const huntErr = ApiErrorSchema.parse(await huntRes.json());
      expect(huntErr.error.code).toBe('UNSUPPORTED_VOCATION');
      expect(huntErr.error.messageKey).toBe('hunt.knightOnlyVocation');

      // Create a knight
      const knightRes = await fetch(`${baseUrl}/characters`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'ValiantKnight',
          vocation: 'knight'
        })
      });
      expect(knightRes.status).toBe(201);
      const knight = CharacterDtoSchema.parse(await knightRes.json());

      // Attempt to send cheat payload (.strict() rejection)
      const cheatRes = await fetch(`${baseUrl}/hunts/start`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          characterId: knight.id,
          zoneId: 'damp-catacombs',
          strategy: 'safe',
          idempotencyKey: 'hunt-cheat-1',
          cheatGoldMultiplier: 9999,
          clientSeedOverride: 42
        })
      });
      expect(cheatRes.status).toBe(400);
      const cheatErr = ApiErrorSchema.parse(await cheatRes.json());
      expect(cheatErr.error.code).toBe('VALIDATION_ERROR');

      // Attempt to request more potions than character has (knight has 250 hp, 100 mp)
      const excessPotRes = await fetch(`${baseUrl}/hunts/start`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          characterId: knight.id,
          zoneId: 'damp-catacombs',
          strategy: 'safe',
          hpPotions: 500,
          mpPotions: 5,
          idempotencyKey: 'hunt-pot-excess'
        })
      });
      expect(excessPotRes.status).toBe(400);
      const excessPotErr = ApiErrorSchema.parse(await excessPotRes.json());
      expect(excessPotErr.error.code).toBe('INSUFFICIENT_POTIONS');
      expect(excessPotErr.error.messageKey).toBe('hunt.insufficientPotions');
    } finally {
      await server.close();
    }
  });

  it('runs complete vertical slice: start, idempotent replay, settle spam guard, time settle, stop, summary and inbox', async () => {
    let currentTime = Date.parse('2026-10-31T12:00:00.000Z');
    const clock = {
      nowMs: () => currentTime,
      nowIso: () => new Date(currentTime).toISOString()
    };
    const server = buildApiServer({ clock, dbPool: pool });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });

    try {
      const regRes = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'hero.knight@example.com',
          password: 'Password123!',
          locale: 'pl'
        })
      });
      const regJson = SessionMeResponseSchema.parse(await regRes.json());
      const rawToken = extractCookieToken(regRes.headers.get('set-cookie'));
      const authHeaders = {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
        'x-csrf-token': regJson.csrfToken
      };

      // Create knight
      const charRes = await fetch(`${baseUrl}/characters`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'SirRoland',
          vocation: 'knight'
        })
      });
      const knight = CharacterDtoSchema.parse(await charRes.json());
      expect(knight.hpPotions).toBe(250);
      expect(knight.mpPotions).toBe(150);

      // Check active hunt before starting: should be active: false
      const preActiveRes = await fetch(`${baseUrl}/hunts/active?characterId=${knight.id}`, {
        headers: authHeaders
      });
      expect(preActiveRes.status).toBe(200);
      const preActiveJson = ActiveHuntResponseSchema.parse(await preActiveRes.json());
      expect(preActiveJson.active).toBe(false);
      expect(preActiveJson.hunt).toBeNull();

      // 1. Start Hunt
      const startRes = await fetch(`${baseUrl}/hunts/start`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          characterId: knight.id,
          zoneId: 'damp-catacombs',
          strategy: 'balanced',
          hpPotions: 10,
          mpPotions: 5,
          idempotencyKey: 'slice-start-key-1'
        })
      });
      expect(startRes.status).toBe(201);
      const startJson = StartHuntResponseSchema.parse(await startRes.json());
      expect(startJson.idempotentReplay).toBe(false);
      expect(startJson.hunt.status).toBe('ACTIVE');
      expect(startJson.hunt.strategy).toBe('balanced');
      expect(startJson.character.hpPotions).toBe(240); // 250 - 10
      expect(startJson.character.mpPotions).toBe(145); // 150 - 5
      const huntId = startJson.hunt.huntId;

      // Idempotent start replay with same idempotencyKey returns 200
      const replayStartRes = await fetch(`${baseUrl}/hunts/start`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          characterId: knight.id,
          zoneId: 'damp-catacombs',
          strategy: 'balanced',
          hpPotions: 10,
          mpPotions: 5,
          idempotencyKey: 'slice-start-key-1'
        })
      });
      expect(replayStartRes.status).toBe(200);
      const replayStartJson = StartHuntResponseSchema.parse(await replayStartRes.json());
      expect(replayStartJson.idempotentReplay).toBe(true);
      expect(replayStartJson.hunt.huntId).toBe(huntId);

      // Starting a different hunt while active returns 409
      const secondStartRes = await fetch(`${baseUrl}/hunts/start`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          characterId: knight.id,
          zoneId: 'damp-catacombs',
          strategy: 'safe',
          hpPotions: 0,
          mpPotions: 0,
          idempotencyKey: 'slice-start-key-2'
        })
      });
      expect(secondStartRes.status).toBe(409);
      const secondStartErr = ApiErrorSchema.parse(await secondStartRes.json());
      expect(secondStartErr.error.code).toBe('ACTIVE_HUNT_ALREADY_EXISTS');

      // 2. Poll Active Hunt
      const activeRes = await fetch(`${baseUrl}/hunts/active?characterId=${knight.id}`, {
        headers: authHeaders
      });
      expect(activeRes.status).toBe(200);
      const activeJson = ActiveHuntResponseSchema.parse(await activeRes.json());
      expect(activeJson.active).toBe(true);
      expect(activeJson.hunt).not.toBeNull();
      expect(activeJson.hunt?.huntId).toBe(huntId);
      expect(activeJson.hunt?.reservedHpPotions).toBe(10);
      expect(activeJson.hunt?.reservedMpPotions).toBe(5);

      // 3. Settle spam guard: Settle immediately (< 1000ms) returns 0 delta rewards
      const spamSettleRes = await fetch(`${baseUrl}/hunts/${huntId}/settle`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ idempotencyKey: 'slice-settle-spam-1' })
      });
      expect(spamSettleRes.status).toBe(200);
      const spamSettleJson = SettleHuntResponseSchema.parse(await spamSettleRes.json());
      expect(spamSettleJson.idempotentReplay).toBe(true);
      expect(spamSettleJson.rewards.deltaElapsedMs).toBe(0);

      // 4. Advance time by 45 seconds and settle
      currentTime += 45_000;
      const settleRes = await fetch(`${baseUrl}/hunts/${huntId}/settle`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ idempotencyKey: 'slice-settle-real-1' })
      });
      expect(settleRes.status).toBe(200);
      const settleJson = SettleHuntResponseSchema.parse(await settleRes.json());
      expect(settleJson.status).toBe('SETTLED');
      expect(settleJson.rewards.deltaElapsedMs).toBe(45_000);
      expect(settleJson.rewards.deltaXpGained).toBeGreaterThan(0);
      expect(settleJson.rewards.deltaKills).toBeGreaterThan(0);
      expect(settleJson.character.stats.xp).toBeGreaterThan(0);

      // 5. Advance time by another 30 seconds and stop hunt
      currentTime += 30_000;
      const stopRes = await fetch(`${baseUrl}/hunts/${huntId}/stop`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ idempotencyKey: 'slice-stop-1' })
      });
      expect(stopRes.status).toBe(200);
      const stopJson = StopHuntResponseSchema.parse(await stopRes.json());
      expect(stopJson.status).toBe('COMPLETED');
      expect(stopJson.hunt.status).toBe('COMPLETED');
      expect(stopJson.hunt.stopReason).toBe('MANUAL_STOP');
      expect(stopJson.unusedHpPotionsReturned).toBeGreaterThanOrEqual(0);
      // Verify character received returned potions (started with 250, reserved 10 -> 240 remained + returned)
      expect(stopJson.character.hpPotions).toBe(240 + stopJson.unusedHpPotionsReturned);

      // Re-stopping already completed hunt returns 200 alreadyCompleted: true
      const secondStopRes = await fetch(`${baseUrl}/hunts/${huntId}/stop`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ idempotencyKey: 'slice-stop-2' })
      });
      expect(secondStopRes.status).toBe(200);
      const secondStopJson = StopHuntResponseSchema.parse(await secondStopRes.json());
      expect(secondStopJson.alreadyCompleted).toBe(true);

      // Active hunt now reports active: false and latestCompletedHuntId
      const postActiveRes = await fetch(`${baseUrl}/hunts/active?characterId=${knight.id}`, {
        headers: authHeaders
      });
      const postActiveJson = ActiveHuntResponseSchema.parse(await postActiveRes.json());
      expect(postActiveJson.active).toBe(false);
      expect(postActiveJson.hunt).toBeNull();
      expect(postActiveJson.latestCompletedHuntId).toBe(huntId);

      // 6. Inspect Hunt Segments & Summary
      const segmentsRes = await fetch(`${baseUrl}/hunts/${huntId}/segments`, {
        headers: authHeaders
      });
      expect(segmentsRes.status).toBe(200);
      const segmentsJson = HuntSegmentsResponseSchema.parse(await segmentsRes.json());
      expect(segmentsJson.huntId).toBe(huntId);
      expect(segmentsJson.segments.length).toBeGreaterThanOrEqual(1);
      expect(segmentsJson.summary.totalKills).toBeGreaterThan(0);
      expect(segmentsJson.summary.totalXpGained).toBeGreaterThan(0);
      expect(segmentsJson.summary.status).toBe('COMPLETED');
      expect(segmentsJson.summary.stopReason).toBe('MANUAL_STOP');

      // 7. Check Character Reward Inbox
      const rewardsRes = await fetch(`${baseUrl}/characters/${knight.id}/hunt-rewards`, {
        headers: authHeaders
      });
      expect(rewardsRes.status).toBe(200);
      const rewardsJson = CharacterHuntRewardsResponseSchema.parse(await rewardsRes.json());
      expect(rewardsJson.characterId).toBe(knight.id);
      expect(Array.isArray(rewardsJson.items)).toBe(true);
      for (const item of rewardsJson.items) {
        expect(item.ownershipState).toBe('UNCLAIMED');
        expect(item.huntId).toBe(huntId);
        expect(item.quantity).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await server.close();
    }
  });

  it('enforces rate limiting on hunt mutations when threshold is exceeded', async () => {
    const clock = createFixedClock(Date.parse('2026-10-31T12:00:00.000Z'));
    const server = buildApiServer({
      clock,
      dbPool: pool,
      huntRateLimitMax: 2,
      huntRateLimitWindowMs: 60_000
    });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });

    try {
      const regRes = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ratelimit-knight@example.com',
          password: 'Password123!',
          locale: 'en'
        })
      });
      const regJson = SessionMeResponseSchema.parse(await regRes.json());
      const rawToken = extractCookieToken(regRes.headers.get('set-cookie'));
      const authHeaders = {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${rawToken}`,
        'x-csrf-token': regJson.csrfToken
      };

      const charRes = await fetch(`${baseUrl}/characters`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: 'SpeedyKnight',
          vocation: 'knight'
        })
      });
      const knight = CharacterDtoSchema.parse(await charRes.json());

      // Attempt 1: Start hunt (allowed)
      const res1 = await fetch(`${baseUrl}/hunts/start`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          characterId: knight.id,
          zoneId: 'damp-catacombs',
          strategy: 'safe',
          idempotencyKey: 'rl-key-1'
        })
      });
      expect(res1.status).toBe(201);

      // Attempt 2: Settle hunt (allowed)
      const _res2 = await fetch(`${baseUrl}/hunts/${knight.id}/settle`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ idempotencyKey: 'rl-key-2' })
      });
      // (Even if 404 because hunt id differs, the rate limiter recorded attempt 2)

      // Attempt 3: Exceeds maxAttempts 2 -> 429 RATE_LIMITED
      const res3 = await fetch(`${baseUrl}/hunts/start`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          characterId: knight.id,
          zoneId: 'damp-catacombs',
          strategy: 'safe',
          idempotencyKey: 'rl-key-3'
        })
      });
      expect(res3.status).toBe(429);
      const json3 = ApiErrorSchema.parse(await res3.json());
      expect(json3.error.code).toBe('RATE_LIMITED');
    } finally {
      await server.close();
    }
  });

  it('protects against cross-user IDOR access', async () => {
    const clock = createFixedClock(Date.parse('2026-10-31T12:00:00.000Z'));
    const server = buildApiServer({ clock, dbPool: pool });
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });

    try {
      // User 1
      const user1Reg = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user1@example.com',
          password: 'Password123!',
          locale: 'en'
        })
      });
      const user1Session = SessionMeResponseSchema.parse(await user1Reg.json());
      const user1Token = extractCookieToken(user1Reg.headers.get('set-cookie'));
      const user1Headers = {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${user1Token}`,
        'x-csrf-token': user1Session.csrfToken
      };

      const char1Res = await fetch(`${baseUrl}/characters`, {
        method: 'POST',
        headers: user1Headers,
        body: JSON.stringify({ name: 'KnightOne', vocation: 'knight' })
      });
      const knight1 = CharacterDtoSchema.parse(await char1Res.json());

      const hunt1Res = await fetch(`${baseUrl}/hunts/start`, {
        method: 'POST',
        headers: user1Headers,
        body: JSON.stringify({
          characterId: knight1.id,
          zoneId: 'damp-catacombs',
          strategy: 'safe',
          idempotencyKey: 'u1-hunt-1'
        })
      });
      expect(hunt1Res.status).toBe(201);
      const hunt1 = StartHuntResponseSchema.parse(await hunt1Res.json());

      // User 2
      const user2Reg = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'user2@example.com',
          password: 'Password123!',
          locale: 'en'
        })
      });
      const user2Session = SessionMeResponseSchema.parse(await user2Reg.json());
      const user2Token = extractCookieToken(user2Reg.headers.get('set-cookie'));
      const user2Headers = {
        'Content-Type': 'application/json',
        Cookie: `${SESSION_COOKIE_NAME}=${user2Token}`,
        'x-csrf-token': user2Session.csrfToken
      };

      // User 2 tries to access User 1's active hunt -> 404
      const idorActive = await fetch(`${baseUrl}/hunts/active?characterId=${knight1.id}`, {
        headers: user2Headers
      });
      expect(idorActive.status).toBe(404);

      // User 2 tries to access User 1's hunt by ID -> 404
      const idorHunt = await fetch(`${baseUrl}/hunts/${hunt1.hunt.huntId}`, {
        headers: user2Headers
      });
      expect(idorHunt.status).toBe(404);

      // User 2 tries to settle User 1's hunt -> 404
      const idorSettle = await fetch(`${baseUrl}/hunts/${hunt1.hunt.huntId}/settle`, {
        method: 'POST',
        headers: user2Headers,
        body: JSON.stringify({ idempotencyKey: 'idor-settle' })
      });
      expect(idorSettle.status).toBe(404);

      // User 2 tries to stop User 1's hunt -> 404
      const idorStop = await fetch(`${baseUrl}/hunts/${hunt1.hunt.huntId}/stop`, {
        method: 'POST',
        headers: user2Headers,
        body: JSON.stringify({ idempotencyKey: 'idor-stop' })
      });
      expect(idorStop.status).toBe(404);

      // User 2 tries to read User 1's segments -> 404
      const idorSegments = await fetch(`${baseUrl}/hunts/${hunt1.hunt.huntId}/segments`, {
        headers: user2Headers
      });
      expect(idorSegments.status).toBe(404);

      // User 2 tries to read User 1's reward inbox -> 404
      const idorRewards = await fetch(`${baseUrl}/characters/${knight1.id}/hunt-rewards`, {
        headers: user2Headers
      });
      expect(idorRewards.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
