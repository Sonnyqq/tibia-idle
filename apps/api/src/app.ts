import { randomUUID } from 'node:crypto';
import {
  ActiveHuntResponseSchema,
  ApiErrorSchema,
  BuyNpcProductRequestSchema,
  BuyNpcProductResponseSchema,
  CharacterContainersResponseSchema,
  CharacterDtoSchema,
  CharacterEquipmentResponseSchema,
  CharacterHuntRewardsResponseSchema,
  CharacterInventoryResponseSchema,
  ClaimHuntRewardRequestSchema,
  ClaimHuntRewardResponseSchema,
  CONTRACT_VERSION,
  CreateCharacterRequestSchema,
  EquipItemRequestSchema,
  EquipItemResponseSchema,
  HealthResponseSchema,
  HuntSegmentsResponseSchema,
  LocaleSchema,
  LoginRequestSchema,
  MoveInventoryItemRequestSchema,
  MoveInventoryItemResponseSchema,
  NpcShopCatalogResponseSchema,
  NpcShopHistoryResponseSchema,
  PublicHuntSessionViewSchema,
  ReadinessResponseSchema,
  RegisterRequestSchema,
  SellNpcItemRequestSchema,
  SellNpcItemResponseSchema,
  SessionMeResponseSchema,
  SettleHuntRequestSchema,
  SettleHuntResponseSchema,
  SplitInventoryStackRequestSchema,
  SplitInventoryStackResponseSchema,
  StartHuntRequestSchema,
  StartHuntResponseSchema,
  StopHuntRequestSchema,
  StopHuntResponseSchema,
  UnequipItemRequestSchema,
  UnequipItemResponseSchema,
  UpdateLocaleRequestSchema,
  UserDtoSchema,
  ZonesCatalogResponseSchema
} from '@tibia-idle/contracts';
import {
  type ActiveSessionRecord,
  buyNpcProduct,
  claimHuntReward,
  createCharacterTransactional,
  createSessionRecord,
  createUserAccount,
  equipInventoryItem,
  findActiveSessionByTokenHash,
  findCharacterByIdForUser,
  findUserByEmail,
  getActiveHuntForCharacter,
  getCharacterContainers,
  getCharacterEquipment,
  getCharacterHuntRewardItems,
  getCharacterInventory,
  getHuntByIdForUser,
  getHuntSegmentsWithSummary,
  getNpcTransactionsForCharacter,
  listCharactersForUser,
  moveInventoryItem,
  NpcShopError,
  revokeSessionByTokenHash,
  sellNpcInventoryItem,
  settleHunt,
  splitInventoryStack,
  startHunt,
  stopHunt,
  unequipInventoryItem,
  updateUserLocale
} from '@tibia-idle/database';
import {
  type Clock,
  type CombatSimulationConfig,
  createSystemClock,
  DEFAULT_NPC_MERCHANT,
  INITIAL_ZONES_CATALOG,
  MAX_CHARACTERS_PER_ACCOUNT,
  NPC_BUY_OFFERS,
  NPC_SELL_OFFERS,
  NPC_SHOP_CATALOG_VERSION,
  SIMULATION_VERSION
} from '@tibia-idle/domain';
import { DEFAULT_LOCALE, getDictionary } from '@tibia-idle/i18n';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type pg from 'pg';
import {
  constantTimeEqualStrings,
  generateOpaqueToken,
  hashPasswordArgon2id,
  hashSessionToken,
  parseCookieHeader,
  serializeClearSessionCookie,
  serializeSessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  SlidingWindowRateLimiter,
  verifyPasswordArgon2id
} from './security.js';

export interface ApiServerOptions {
  clock?: Clock;
  dbPool?: pg.Pool | null;
  checkDatabaseReady?: () => Promise<'up' | 'down' | 'unconfigured'>;
  logger?: boolean;
  authRateLimitMax?: number;
  authRateLimitWindowMs?: number;
  huntRateLimitMax?: number;
  huntRateLimitWindowMs?: number;
  inventoryRateLimitMax?: number;
  inventoryRateLimitWindowMs?: number;
  forceSecureCookies?: boolean;
  simulationConfig?: CombatSimulationConfig;
  maxDrainSegments?: number;
}

const DUMMY_PASSWORD_HASH_PROMISE = hashPasswordArgon2id('dummy-password-for-timing-defense');

function isRequestHttps(request: FastifyRequest, forceSecure?: boolean): boolean {
  if (forceSecure !== undefined) {
    return forceSecure;
  }
  if (process.env['NODE_ENV'] === 'production') {
    return true;
  }
  const forwardedProto = request.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string' && forwardedProto.split(',')[0]?.trim() === 'https') {
    return true;
  }
  return request.protocol === 'https';
}

function sendApiError(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  code: string,
  messageKey: string
) {
  const payload = ApiErrorSchema.parse({
    error: {
      code,
      messageKey,
      correlationId: String(request.id)
    }
  });
  return reply.code(statusCode).send(payload);
}

export function buildApiServer(options: ApiServerOptions = {}): FastifyInstance {
  const clock = options.clock ?? createSystemClock();
  const dbPool = options.dbPool ?? null;
  const checkDatabaseReady =
    options.checkDatabaseReady ?? (async () => (dbPool ? 'up' : 'unconfigured'));

  const authRateLimiter = new SlidingWindowRateLimiter({
    maxAttempts: options.authRateLimitMax ?? 10,
    windowMs: options.authRateLimitWindowMs ?? 60_000
  });

  const huntRateLimiter = new SlidingWindowRateLimiter({
    maxAttempts: options.huntRateLimitMax ?? 120,
    windowMs: options.huntRateLimitWindowMs ?? 60_000
  });

  const inventoryRateLimiter = new SlidingWindowRateLimiter({
    maxAttempts: options.inventoryRateLimitMax ?? 120,
    windowMs: options.inventoryRateLimitWindowMs ?? 60_000
  });

  const npcShopRateLimiter = new SlidingWindowRateLimiter({
    maxAttempts: 120,
    windowMs: 60_000
  });

  const app = Fastify({
    logger: options.logger
      ? {
          redact: {
            paths: [
              'req.headers.cookie',
              'req.headers.authorization',
              'req.headers["x-csrf-token"]',
              'body.password',
              '*.password',
              '*.passwordHash',
              '*.token',
              '*.csrfToken'
            ],
            censor: '[REDACTED]'
          }
        }
      : false,
    genReqId: () => randomUUID()
  });

  const requirePool = (request: FastifyRequest, reply: FastifyReply): pg.Pool | null => {
    if (!dbPool) {
      void sendApiError(reply, request, 503, 'DATABASE_UNCONFIGURED', 'common.error');
      return null;
    }
    return dbPool;
  };

  const resolveActiveSession = async (
    request: FastifyRequest,
    pool: pg.Pool
  ): Promise<{ rawToken: string; tokenHash: string; session: ActiveSessionRecord } | null> => {
    const cookies = parseCookieHeader(request.headers.cookie);
    const rawToken = cookies[SESSION_COOKIE_NAME];
    if (!rawToken || rawToken.length < 16) {
      return null;
    }
    const tokenHash = hashSessionToken(rawToken);
    const session = await findActiveSessionByTokenHash(pool, tokenHash, clock.nowIso());
    if (!session) {
      return null;
    }
    return { rawToken, tokenHash, session };
  };

  const verifyCsrfProtection = (
    request: FastifyRequest,
    session: ActiveSessionRecord
  ): boolean => {
    const secFetchSite = request.headers['sec-fetch-site'];
    if (secFetchSite === 'cross-site') {
      return false;
    }
    const headerToken = request.headers['x-csrf-token'];
    if (typeof headerToken !== 'string' || !headerToken) {
      return false;
    }
    return constantTimeEqualStrings(headerToken, session.csrfToken);
  };

  app.get('/health', async () => {
    return HealthResponseSchema.parse({
      status: 'ok',
      service: 'tibia-idle-api',
      version: '0.1.0',
      contractVersion: CONTRACT_VERSION,
      simulationVersion: SIMULATION_VERSION,
      serverTimeIso: clock.nowIso()
    });
  });

  app.get('/ready', async (_request, reply) => {
    const dbStatus = await checkDatabaseReady();
    const isReady = dbStatus === 'up' || dbStatus === 'unconfigured';
    const payload = ReadinessResponseSchema.parse({
      status: isReady ? 'ready' : 'degraded',
      database: dbStatus,
      serverTimeIso: clock.nowIso()
    });
    return reply.code(isReady ? 200 : 503).send(payload);
  });

  app.get<{ Params: { locale: string } }>('/i18n/:locale', async (request, reply) => {
    const parsed = LocaleSchema.safeParse(request.params.locale);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'INVALID_LOCALE', 'common.error');
    }
    return {
      locale: parsed.data,
      dictionary: getDictionary(parsed.data)
    };
  });

  app.get('/zones', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }

    const payload = ZonesCatalogResponseSchema.parse({
      zones: INITIAL_ZONES_CATALOG,
      simulationEnabled: false
    });
    return reply.code(200).send(payload);
  });

  app.post('/auth/register', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const ipKey = `register:ip:${request.ip}`;
    if (!authRateLimiter.checkAndRecord(ipKey, clock.nowMs())) {
      return sendApiError(reply, request, 429, 'RATE_LIMITED', 'auth.rateLimited');
    }

    const parsed = RegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
    }

    const nowMs = clock.nowMs();
    const nowIso = new Date(nowMs).toISOString();
    const passwordHash = await hashPasswordArgon2id(parsed.data.password);
    const locale = parsed.data.locale ?? DEFAULT_LOCALE;

    const created = await createUserAccount(pool, {
      email: parsed.data.email,
      passwordHash,
      locale,
      nowIso
    });

    if (!created.ok) {
      return sendApiError(reply, request, 409, 'EMAIL_TAKEN', 'auth.emailTaken');
    }

    const existingCookies = parseCookieHeader(request.headers.cookie);
    const oldToken = existingCookies[SESSION_COOKIE_NAME];
    if (oldToken) {
      await revokeSessionByTokenHash(pool, hashSessionToken(oldToken), nowIso);
    }

    const rawSessionToken = generateOpaqueToken(32);
    const tokenHash = hashSessionToken(rawSessionToken);
    const csrfToken = generateOpaqueToken(24);
    const expiresAtIso = new Date(nowMs + SESSION_TTL_MS).toISOString();

    await createSessionRecord(pool, {
      userId: created.user.id,
      tokenHash,
      csrfToken,
      nowIso,
      expiresAtIso
    });

    const isSecure = isRequestHttps(request, options.forceSecureCookies);
    reply.header(
      'Set-Cookie',
      serializeSessionCookie(rawSessionToken, SESSION_TTL_MS / 1000, isSecure)
    );

    const payload = SessionMeResponseSchema.parse({
      user: created.user,
      csrfToken,
      characters: [],
      maxCharacters: MAX_CHARACTERS_PER_ACCOUNT
    });
    return reply.code(201).send(payload);
  });

  app.post('/auth/login', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const parsed = LoginRequestSchema.safeParse(request.body);
    const ipKey = `login:ip:${request.ip}`;
    const accountKey = parsed.success ? `login:acct:${parsed.data.email}` : null;

    if (
      !authRateLimiter.checkAndRecord(ipKey, clock.nowMs()) ||
      (accountKey && !authRateLimiter.checkAndRecord(accountKey, clock.nowMs()))
    ) {
      return sendApiError(reply, request, 429, 'RATE_LIMITED', 'auth.rateLimited');
    }

    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
    }

    const userRecord = await findUserByEmail(pool, parsed.data.email);
    const dummyHash = await DUMMY_PASSWORD_HASH_PROMISE;
    const passwordValid = await verifyPasswordArgon2id(
      parsed.data.password,
      userRecord ? userRecord.passwordHash : dummyHash
    );

    if (!userRecord || !passwordValid) {
      return sendApiError(reply, request, 401, 'INVALID_CREDENTIALS', 'auth.invalidCredentials');
    }

    const nowMs = clock.nowMs();
    const nowIso = new Date(nowMs).toISOString();

    const existingCookies = parseCookieHeader(request.headers.cookie);
    const oldToken = existingCookies[SESSION_COOKIE_NAME];
    if (oldToken) {
      await revokeSessionByTokenHash(pool, hashSessionToken(oldToken), nowIso);
    }

    const rawSessionToken = generateOpaqueToken(32);
    const tokenHash = hashSessionToken(rawSessionToken);
    const csrfToken = generateOpaqueToken(24);
    const expiresAtIso = new Date(nowMs + SESSION_TTL_MS).toISOString();

    await createSessionRecord(pool, {
      userId: userRecord.id,
      tokenHash,
      csrfToken,
      nowIso,
      expiresAtIso
    });

    const characters = await listCharactersForUser(pool, userRecord.id);
    const isSecure = isRequestHttps(request, options.forceSecureCookies);
    reply.header(
      'Set-Cookie',
      serializeSessionCookie(rawSessionToken, SESSION_TTL_MS / 1000, isSecure)
    );

    const payload = SessionMeResponseSchema.parse({
      user: {
        id: userRecord.id,
        email: userRecord.email,
        locale: userRecord.locale,
        createdAt: userRecord.createdAtIso
      },
      csrfToken,
      characters,
      maxCharacters: MAX_CHARACTERS_PER_ACCOUNT
    });
    return reply.code(200).send(payload);
  });

  app.post('/auth/logout', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    await revokeSessionByTokenHash(pool, resolved.tokenHash, clock.nowIso());
    const isSecure = isRequestHttps(request, options.forceSecureCookies);
    reply.header('Set-Cookie', serializeClearSessionCookie(isSecure));
    return reply.code(204).send();
  });

  app.get('/me', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }

    const characters = await listCharactersForUser(pool, resolved.session.userId);
    const payload = SessionMeResponseSchema.parse({
      user: resolved.session.user,
      csrfToken: resolved.session.csrfToken,
      characters,
      maxCharacters: MAX_CHARACTERS_PER_ACCOUNT
    });
    return reply.code(200).send(payload);
  });

  app.post('/me/locale', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    const parsed = UpdateLocaleRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
    }

    const updated = await updateUserLocale(pool, resolved.session.userId, parsed.data.locale);
    if (!updated) {
      return sendApiError(reply, request, 404, 'USER_NOT_FOUND', 'auth.unauthorized');
    }
    return reply.code(200).send(UserDtoSchema.parse(updated));
  });

  app.get('/characters', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }

    const characters = await listCharactersForUser(pool, resolved.session.userId);
    return reply.code(200).send({ characters });
  });

  app.post('/characters', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    if (
      typeof request.body !== 'object' ||
      request.body === null ||
      typeof (request.body as Record<string, unknown>)['name'] !== 'string' ||
      typeof (request.body as Record<string, unknown>)['vocation'] !== 'string'
    ) {
      return sendApiError(reply, request, 400, 'CHARACTER_NAME_INVALID', 'character.nameInvalid');
    }

    const rawBody = request.body as { name: string; vocation: string };
    const parsedVocation = CreateCharacterRequestSchema.shape.vocation.safeParse(rawBody.vocation);
    if (!parsedVocation.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
    }

    const created = await createCharacterTransactional(pool, {
      userId: resolved.session.userId,
      name: rawBody.name,
      vocation: parsedVocation.data,
      nowIso: clock.nowIso()
    });

    if (!created.ok) {
      switch (created.reason) {
        case 'INVALID_NAME':
          return sendApiError(reply, request, 400, 'CHARACTER_NAME_INVALID', 'character.nameInvalid');
        case 'RESERVED_NAME':
          return sendApiError(
            reply,
            request,
            400,
            'CHARACTER_NAME_RESERVED',
            'character.nameReserved'
          );
        case 'CHARACTER_LIMIT_REACHED':
          return sendApiError(
            reply,
            request,
            409,
            'CHARACTER_LIMIT_REACHED',
            'character.limitReached'
          );
        case 'CHARACTER_NAME_TAKEN':
          return sendApiError(reply, request, 409, 'CHARACTER_NAME_TAKEN', 'character.nameTaken');
        case 'USER_NOT_FOUND':
          return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
      }
    }

    const parsedDto = CharacterDtoSchema.parse(created.character);
    return reply.code(201).send(parsedDto);
  });

  app.get<{ Params: { id: string } }>('/characters/:id', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'character.notFound');
    }

    const character = await findCharacterByIdForUser(
      pool,
      request.params.id,
      resolved.session.userId
    );
    if (!character) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'character.notFound');
    }

    return reply.code(200).send(CharacterDtoSchema.parse(character));
  });

  app.post('/hunts/start', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    const userRateKey = `hunt:user:${resolved.session.userId}`;
    if (!huntRateLimiter.checkAndRecord(userRateKey, clock.nowMs())) {
      return sendApiError(reply, request, 429, 'RATE_LIMITED', 'hunt.rateLimited');
    }

    const parsed = StartHuntRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
    }

    const character = await findCharacterByIdForUser(
      pool,
      parsed.data.characterId,
      resolved.session.userId
    );
    if (!character) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'character.notFound');
    }

    if (character.vocation !== 'knight') {
      return sendApiError(
        reply,
        request,
        400,
        'UNSUPPORTED_VOCATION',
        'hunt.knightOnlyVocation'
      );
    }

    const zone = INITIAL_ZONES_CATALOG.find((z) => z.id === parsed.data.zoneId);
    if (!zone) {
      return sendApiError(reply, request, 400, 'UNKNOWN_ZONE', 'hunt.unknownZone');
    }

    if (character.stats.level < zone.minLevel) {
      return sendApiError(reply, request, 400, 'LEVEL_TOO_LOW', 'hunt.levelTooLow');
    }

    const hpReserve = parsed.data.hpPotions ?? 0;
    const mpReserve = parsed.data.mpPotions ?? 0;
    if (hpReserve > (character.hpPotions ?? 0) || mpReserve > (character.mpPotions ?? 0)) {
      return sendApiError(
        reply,
        request,
        400,
        'INSUFFICIENT_POTIONS',
        'hunt.insufficientPotions'
      );
    }

    const huntResult = await startHunt(pool, {
      characterId: character.id,
      userId: resolved.session.userId,
      zoneId: parsed.data.zoneId,
      strategy: parsed.data.strategy,
      idempotencyKey: parsed.data.idempotencyKey,
      requestedHpPotions: hpReserve,
      requestedMpPotions: mpReserve,
      clock
    });

    if (!huntResult.ok) {
      switch (huntResult.reason) {
        case 'ACTIVE_HUNT_ALREADY_EXISTS':
          return sendApiError(
            reply,
            request,
            409,
            'ACTIVE_HUNT_ALREADY_EXISTS',
            'hunt.activeAlreadyExists'
          );
        case 'IDEMPOTENCY_KEY_CONFLICT':
          return sendApiError(
            reply,
            request,
            409,
            'IDEMPOTENCY_KEY_CONFLICT',
            'hunt.activeAlreadyExists'
          );
        case 'LEVEL_TOO_LOW':
          return sendApiError(reply, request, 400, 'LEVEL_TOO_LOW', 'hunt.levelTooLow');
        case 'UNKNOWN_ZONE':
          return sendApiError(reply, request, 400, 'UNKNOWN_ZONE', 'hunt.unknownZone');
        case 'UNSUPPORTED_VOCATION':
          return sendApiError(
            reply,
            request,
            400,
            'UNSUPPORTED_VOCATION',
            'hunt.knightOnlyVocation'
          );
        case 'INSUFFICIENT_RESOURCES':
          return sendApiError(
            reply,
            request,
            400,
            'INSUFFICIENT_POTIONS',
            'hunt.insufficientPotions'
          );
        default:
          return sendApiError(reply, request, 400, 'START_HUNT_FAILED', 'common.error');
      }
    }

    const payload = StartHuntResponseSchema.parse({
      ok: true,
      hunt: huntResult.hunt,
      character: huntResult.character,
      idempotentReplay: huntResult.idempotentReplay,
      serverTimeIso: clock.nowIso()
    });
    return reply.code(huntResult.idempotentReplay ? 200 : 201).send(payload);
  });

  app.get<{ Querystring: { characterId?: string } }>('/hunts/active', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }

    const characterId = request.query.characterId;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!characterId || !uuidRegex.test(characterId)) {
      return sendApiError(reply, request, 400, 'INVALID_CHARACTER_ID', 'character.notFound');
    }

    const char = await findCharacterByIdForUser(pool, characterId, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'character.notFound');
    }

    const activeInfo = await getActiveHuntForCharacter(
      pool,
      characterId,
      resolved.session.userId,
      clock.nowMs()
    );

    return reply.code(200).send(ActiveHuntResponseSchema.parse(activeInfo));
  });

  app.get<{ Params: { id: string } }>('/hunts/:id', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'HUNT_NOT_FOUND', 'hunt.notFound');
    }

    const hunt = await getHuntByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!hunt) {
      return sendApiError(reply, request, 404, 'HUNT_NOT_FOUND', 'hunt.notFound');
    }

    return reply.code(200).send(PublicHuntSessionViewSchema.parse(hunt));
  });

  app.post<{ Params: { id: string } }>('/hunts/:id/settle', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    const userRateKey = `hunt:user:${resolved.session.userId}`;
    if (!huntRateLimiter.checkAndRecord(userRateKey, clock.nowMs())) {
      return sendApiError(reply, request, 429, 'RATE_LIMITED', 'hunt.rateLimited');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'HUNT_NOT_FOUND', 'hunt.notFound');
    }

    const parsed = SettleHuntRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
    }

    const existingHunt = await getHuntByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!existingHunt) {
      return sendApiError(reply, request, 404, 'HUNT_NOT_FOUND', 'hunt.notFound');
    }

    // Check first whether this idempotency key was ALREADY committed in hunt_segments
    // If it was already committed, delegate directly to settleHunt so it replays the canonical rewards and segmentId
    const priorSegmentCheck = await pool.query<{ id: string }>(
      `SELECT id FROM hunt_segments WHERE hunt_id = $1 AND segment_key = $2 LIMIT 1`,
      [existingHunt.huntId, parsed.data.idempotencyKey]
    );

    // 0ms spam guard: For a NEW key, if hunt is active and <1000ms has elapsed since settledUntil, return no-op SETTLED
    const nowMs = clock.nowMs();
    const settledUntilMs = new Date(existingHunt.settledUntilIso).getTime();
    if (priorSegmentCheck.rows.length === 0 && existingHunt.status === 'ACTIVE' && nowMs - settledUntilMs < 1000) {
      const char = await findCharacterByIdForUser(
        pool,
        existingHunt.characterId,
        resolved.session.userId
      );
      if (!char) {
        return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'character.notFound');
      }
      const payload = SettleHuntResponseSchema.parse({
        ok: true,
        status: 'SETTLED',
        idempotentReplay: true,
        hunt: existingHunt,
        segmentId: null,
        segmentKey: parsed.data.idempotencyKey,
        rewards: {
          deltaElapsedMs: 0,
          unprocessedDurationMs: Math.max(0, nowMs - settledUntilMs),
          isPartialSettlement: false,
          deltaKills: 0,
          deltaKillsByMonster: {},
          deltaXpGained: 0,
          deltaGoldGained: 0,
          deltaLootByItem: {},
          deltaDamageDealt: 0,
          deltaDamageTaken: 0,
          deltaHpPotionsUsed: 0,
          deltaMpPotionsUsed: 0,
          simulatedEvents: 0,
          levelBefore: char.stats.level,
          levelAfter: char.stats.level,
          combatEndHp: existingHunt.checkpointView.currentHp,
          revivedAtCamp: false,
          campHpRestoredTo: null,
          unusedHpPotionsReturned: 0,
          unusedMpPotionsReturned: 0
        },
        character: char,
        serverTimeIso: clock.nowIso()
      });
      return reply.code(200).send(payload);
    }

    const settleResult = await settleHunt(pool, {
      huntId: existingHunt.huntId,
      characterId: existingHunt.characterId,
      userId: resolved.session.userId,
      segmentKey: parsed.data.idempotencyKey,
      clock,
      config: options.simulationConfig
    });

    if (!settleResult.ok) {
      return sendApiError(reply, request, 400, 'SETTLE_FAILED', 'common.error');
    }

    const payload = SettleHuntResponseSchema.parse({
      ok: true,
      status: settleResult.status,
      idempotentReplay: settleResult.idempotentReplay,
      hunt: settleResult.hunt,
      segmentId: settleResult.segmentId,
      segmentKey: settleResult.segmentKey,
      rewards: settleResult.rewards,
      character: settleResult.character,
      serverTimeIso: clock.nowIso()
    });
    return reply.code(200).send(payload);
  });

  app.post<{ Params: { id: string } }>('/hunts/:id/stop', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    const userRateKey = `hunt:user:${resolved.session.userId}`;
    if (!huntRateLimiter.checkAndRecord(userRateKey, clock.nowMs())) {
      return sendApiError(reply, request, 429, 'RATE_LIMITED', 'hunt.rateLimited');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'HUNT_NOT_FOUND', 'hunt.notFound');
    }

    const parsed = StopHuntRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
    }

    const existingHunt = await getHuntByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!existingHunt) {
      return sendApiError(reply, request, 404, 'HUNT_NOT_FOUND', 'hunt.notFound');
    }

    const stopResult = await stopHunt(pool, {
      huntId: existingHunt.huntId,
      characterId: existingHunt.characterId,
      userId: resolved.session.userId,
      stopIdempotencyKey: parsed.data.idempotencyKey,
      settleBeforeStop: true,
      clock,
      config: options.simulationConfig,
      maxDrainSegments: options.maxDrainSegments
    });

    if (!stopResult.ok) {
      return sendApiError(reply, request, 400, 'STOP_FAILED', 'common.error');
    }

    const payload = StopHuntResponseSchema.parse({
      ok: true,
      status: stopResult.status,
      alreadyCompleted: stopResult.alreadyCompleted,
      continuationRequired: stopResult.continuationRequired,
      unprocessedDurationMs: stopResult.unprocessedDurationMs,
      segmentsSettled: stopResult.segmentsSettled,
      stopCutoffIso: stopResult.stopCutoffIso,
      hunt: stopResult.hunt,
      character: stopResult.character,
      unusedHpPotionsReturned: stopResult.unusedHpPotionsReturned,
      unusedMpPotionsReturned: stopResult.unusedMpPotionsReturned,
      serverTimeIso: clock.nowIso()
    });
    return reply.code(200).send(payload);
  });

  app.get<{ Params: { id: string }; Querystring: { page?: string; limit?: string } }>(
    '/hunts/:id/segments',
    async (request, reply) => {
      const pool = requirePool(request, reply);
      if (!pool) return;

      const resolved = await resolveActiveSession(request, pool);
      if (!resolved) {
        return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
      }

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(request.params.id)) {
        return sendApiError(reply, request, 404, 'HUNT_NOT_FOUND', 'hunt.notFound');
      }

      const page = request.query.page ? parseInt(request.query.page, 10) : 1;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;

      const segmentsData = await getHuntSegmentsWithSummary(
        pool,
        request.params.id,
        resolved.session.userId,
        {
          page: Number.isFinite(page) ? page : 1,
          limit: Number.isFinite(limit) ? limit : 20
        }
      );

      if (!segmentsData) {
        return sendApiError(reply, request, 404, 'HUNT_NOT_FOUND', 'hunt.notFound');
      }

      return reply.code(200).send(HuntSegmentsResponseSchema.parse(segmentsData));
    }
  );

  app.get<{ Params: { id: string } }>('/characters/:id/hunt-rewards', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'character.notFound');
    }

    const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'character.notFound');
    }

    const items = await getCharacterHuntRewardItems(
      pool,
      request.params.id,
      resolved.session.userId
    );
    return reply.code(200).send(
      CharacterHuntRewardsResponseSchema.parse({
        characterId: char.id,
        items,
        totalItemsCount: items.length
      })
    );
  });

  // ==========================================
  // P04 / IDLE-005A: Inventory & Rewards Endpoints
  // ==========================================

  app.get<{ Params: { id: string } }>('/characters/:id/inventory', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const inventory = await getCharacterInventory(pool, char.id);
    return reply.code(200).send(CharacterInventoryResponseSchema.parse(inventory));
  });

  app.get<{ Params: { id: string } }>('/characters/:id/inventory/containers', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const containers = await getCharacterContainers(pool, char.id);
    return reply.code(200).send(
      CharacterContainersResponseSchema.parse({
        characterId: char.id,
        containers
      })
    );
  });

  app.post<{ Params: { id: string } }>('/characters/:id/inventory/move', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    const userRateKey = `inventory:user:${resolved.session.userId}`;
    if (!inventoryRateLimiter.checkAndRecord(userRateKey, clock.nowMs())) {
      return sendApiError(reply, request, 429, 'RATE_LIMITED', 'hunt.rateLimited');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const parsed = MoveInventoryItemRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
    }

    const result = await moveInventoryItem(pool, {
      characterId: char.id,
      fromSlot: parsed.data.fromSlot,
      toSlot: parsed.data.toSlot,
      idempotencyKey: parsed.data.idempotencyKey,
      containerId: parsed.data.containerId
    });

    if (result.status === 'ITEM_NOT_FOUND') {
      return sendApiError(reply, request, 404, 'ITEM_NOT_FOUND', 'error.itemNotFound');
    }
    if (result.status === 'IDEMPOTENCY_KEY_CONFLICT') {
      return sendApiError(
        reply,
        request,
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'error.idempotencyConflict'
      );
    }
    if (result.status === 'INVENTORY_FULL') {
      return sendApiError(reply, request, 400, 'INVENTORY_FULL', 'error.inventoryFull');
    }
    if (result.status === 'SLOT_OUT_OF_BOUNDS') {
      return sendApiError(reply, request, 400, 'SLOT_OUT_OF_BOUNDS', 'error.slotOutOfBounds');
    }
    if (result.status === 'CAPACITY_EXCEEDED') {
      return sendApiError(reply, request, 400, 'CAPACITY_EXCEEDED', 'error.capacityExceeded');
    }
    if (result.status === 'FORBIDDEN') {
      return sendApiError(reply, request, 403, 'FORBIDDEN', 'error.forbidden');
    }

    return reply.code(200).send(
      MoveInventoryItemResponseSchema.parse({
        characterId: char.id,
        action: result.action,
        inventory: result.inventory,
        idempotentReplay: result.idempotentReplay
      })
    );
  });

  app.post<{ Params: { id: string } }>('/characters/:id/inventory/split', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    const userRateKey = `inventory:user:${resolved.session.userId}`;
    if (!inventoryRateLimiter.checkAndRecord(userRateKey, clock.nowMs())) {
      return sendApiError(reply, request, 429, 'RATE_LIMITED', 'hunt.rateLimited');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const parsed = SplitInventoryStackRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
    }

    const result = await splitInventoryStack(pool, {
      characterId: char.id,
      fromSlot: parsed.data.fromSlot,
      toSlot: parsed.data.toSlot,
      quantity: parsed.data.quantity,
      idempotencyKey: parsed.data.idempotencyKey,
      containerId: parsed.data.containerId
    });

    if (result.status === 'ITEM_NOT_FOUND') {
      return sendApiError(reply, request, 404, 'ITEM_NOT_FOUND', 'error.itemNotFound');
    }
    if (result.status === 'IDEMPOTENCY_KEY_CONFLICT') {
      return sendApiError(
        reply,
        request,
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'error.idempotencyConflict'
      );
    }
    if (result.status === 'INVALID_QUANTITY') {
      return sendApiError(reply, request, 400, 'INVALID_QUANTITY', 'error.invalidQuantity');
    }
    if (result.status === 'STACK_INCOMPATIBLE') {
      return sendApiError(reply, request, 400, 'STACK_INCOMPATIBLE', 'error.stackIncompatible');
    }
    if (result.status === 'INVENTORY_FULL') {
      return sendApiError(reply, request, 400, 'INVENTORY_FULL', 'error.inventoryFull');
    }
    if (result.status === 'SLOT_OUT_OF_BOUNDS') {
      return sendApiError(reply, request, 400, 'SLOT_OUT_OF_BOUNDS', 'error.slotOutOfBounds');
    }
    if (result.status === 'FORBIDDEN') {
      return sendApiError(reply, request, 403, 'FORBIDDEN', 'error.forbidden');
    }

    return reply.code(200).send(
      SplitInventoryStackResponseSchema.parse({
        characterId: char.id,
        inventory: result.inventory,
        idempotentReplay: result.idempotentReplay
      })
    );
  });

  app.post<{ Params: { id: string; rewardId: string } }>(
    '/characters/:id/hunt-rewards/:rewardId/claim',
    async (request, reply) => {
      const pool = requirePool(request, reply);
      if (!pool) return;

      const resolved = await resolveActiveSession(request, pool);
      if (!resolved) {
        return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
      }
      if (!verifyCsrfProtection(request, resolved.session)) {
        return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
      }

      const userRateKey = `inventory:user:${resolved.session.userId}`;
      if (!inventoryRateLimiter.checkAndRecord(userRateKey, clock.nowMs())) {
        return sendApiError(reply, request, 429, 'RATE_LIMITED', 'hunt.rateLimited');
      }

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(request.params.id)) {
        return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
      }
      if (!uuidRegex.test(request.params.rewardId)) {
        return sendApiError(reply, request, 404, 'REWARD_NOT_FOUND', 'error.rewardNotFound');
      }

      const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
      if (!char) {
        return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
      }

      const parsed = ClaimHuntRewardRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
      }

      const result = await claimHuntReward(pool, {
        characterId: char.id,
        rewardId: request.params.rewardId,
        idempotencyKey: parsed.data.idempotencyKey
      });

      if (result.status === 'REWARD_NOT_FOUND') {
        return sendApiError(reply, request, 404, 'REWARD_NOT_FOUND', 'error.rewardNotFound');
      }
      if (result.status === 'IDEMPOTENCY_KEY_CONFLICT') {
        return sendApiError(
          reply,
          request,
          409,
          'IDEMPOTENCY_KEY_CONFLICT',
          'error.idempotencyConflict'
        );
      }
      if (result.status === 'REWARD_ALREADY_CLAIMED') {
        return sendApiError(reply, request, 409, 'REWARD_ALREADY_CLAIMED', 'error.rewardAlreadyClaimed');
      }
      if (result.status === 'INVENTORY_FULL') {
        return sendApiError(reply, request, 400, 'INVENTORY_FULL', 'error.inventoryFull');
      }
      if (result.status === 'CAPACITY_EXCEEDED') {
        return sendApiError(reply, request, 400, 'CAPACITY_EXCEEDED', 'error.capacityExceeded');
      }
      if (result.status === 'FORBIDDEN') {
        return sendApiError(reply, request, 403, 'FORBIDDEN', 'error.forbidden');
      }

      return reply.code(200).send(
        ClaimHuntRewardResponseSchema.parse({
          characterId: char.id,
          rewardId: result.claimedItem.id,
          claimedItem: result.claimedItem,
          inventory: result.inventory,
          idempotentReplay: result.idempotentReplay
        })
      );
    }
  );

  app.get<{ Params: { id: string } }>('/characters/:id/equipment', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const equipment = await getCharacterEquipment(pool, char.id);
    return reply.code(200).send(CharacterEquipmentResponseSchema.parse(equipment));
  });

  app.post<{ Params: { id: string } }>('/characters/:id/equipment/equip', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    const userRateKey = `equipment:user:${resolved.session.userId}`;
    if (!inventoryRateLimiter.checkAndRecord(userRateKey, clock.nowMs())) {
      return sendApiError(reply, request, 429, 'RATE_LIMITED', 'hunt.rateLimited');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const parsed = EquipItemRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_FAILED', 'auth.validationFailed');
    }

    const result = await equipInventoryItem(pool, {
      characterId: char.id,
      backpackSlot: parsed.data.backpackSlot,
      equipmentSlot: parsed.data.equipmentSlot,
      idempotencyKey: parsed.data.idempotencyKey
    });

    if (result.status === 'SUCCESS') {
      return reply.code(200).send(
        EquipItemResponseSchema.parse({
          characterId: char.id,
          action: result.action,
          equipment: result.equipment,
          inventory: result.inventory,
          idempotentReplay: result.idempotentReplay
        })
      );
    }

    if (result.status === 'ACTIVE_HUNT_LOCKED') {
      return sendApiError(
        reply,
        request,
        409,
        'ACTIVE_HUNT_LOCKED',
        'error.activeHuntEquipmentLocked'
      );
    }
    if (result.status === 'IDEMPOTENCY_KEY_CONFLICT') {
      return sendApiError(
        reply,
        request,
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'error.idempotencyConflict'
      );
    }
    if (result.status === 'SLOT_EMPTY') {
      return sendApiError(reply, request, 400, 'SLOT_EMPTY', 'error.slotEmpty');
    }
    if (result.status === 'SLOT_OUT_OF_BOUNDS') {
      return sendApiError(reply, request, 400, 'SLOT_OUT_OF_BOUNDS', 'error.slotOutOfBounds');
    }
    if (result.status === 'NOT_EQUIPMENT') {
      return sendApiError(reply, request, 400, 'NOT_EQUIPMENT', 'error.notEquipment');
    }
    if (result.status === 'SLOT_MISMATCH') {
      return sendApiError(reply, request, 400, 'SLOT_MISMATCH', 'error.slotMismatch');
    }
    if (result.status === 'LEVEL_TOO_LOW') {
      return sendApiError(reply, request, 400, 'LEVEL_TOO_LOW', 'error.levelTooLow');
    }
    if (result.status === 'VOCATION_INCOMPATIBLE') {
      return sendApiError(reply, request, 400, 'VOCATION_INCOMPATIBLE', 'error.vocationIncompatible');
    }
    return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
  });

  app.post<{ Params: { id: string } }>('/characters/:id/equipment/unequip', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    const userRateKey = `equipment:user:${resolved.session.userId}`;
    if (!inventoryRateLimiter.checkAndRecord(userRateKey, clock.nowMs())) {
      return sendApiError(reply, request, 429, 'RATE_LIMITED', 'hunt.rateLimited');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const parsed = UnequipItemRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_FAILED', 'auth.validationFailed');
    }

    const result = await unequipInventoryItem(pool, {
      characterId: char.id,
      equipmentSlot: parsed.data.equipmentSlot,
      targetBackpackSlot: parsed.data.targetBackpackSlot,
      idempotencyKey: parsed.data.idempotencyKey
    });

    if (result.status === 'SUCCESS') {
      return reply.code(200).send(
        UnequipItemResponseSchema.parse({
          characterId: char.id,
          action: result.action,
          equipment: result.equipment,
          inventory: result.inventory,
          idempotentReplay: result.idempotentReplay
        })
      );
    }

    if (result.status === 'ACTIVE_HUNT_LOCKED') {
      return sendApiError(
        reply,
        request,
        409,
        'ACTIVE_HUNT_LOCKED',
        'error.activeHuntEquipmentLocked'
      );
    }
    if (result.status === 'IDEMPOTENCY_KEY_CONFLICT') {
      return sendApiError(
        reply,
        request,
        409,
        'IDEMPOTENCY_KEY_CONFLICT',
        'error.idempotencyConflict'
      );
    }
    if (result.status === 'SLOT_EMPTY') {
      return sendApiError(reply, request, 400, 'SLOT_EMPTY', 'error.slotEmpty');
    }
    if (result.status === 'SLOT_OUT_OF_BOUNDS') {
      return sendApiError(reply, request, 400, 'SLOT_OUT_OF_BOUNDS', 'error.slotOutOfBounds');
    }
    if (result.status === 'BACKPACK_FULL') {
      return sendApiError(reply, request, 400, 'BACKPACK_FULL', 'error.inventoryFull');
    }
    if (result.status === 'TARGET_SLOT_OCCUPIED') {
      return sendApiError(reply, request, 400, 'TARGET_SLOT_OCCUPIED', 'error.targetSlotOccupied');
    }
    return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
  });

  function mapNpcShopErrorCodeToMessageKey(code: string): string {
    switch (code) {
      case 'INSUFFICIENT_GOLD':
        return 'error.insufficientGold';
      case 'POTION_LIMIT_EXCEEDED':
        return 'error.potionLimitExceeded';
      case 'ITEM_NOT_SELLABLE':
        return 'error.itemNotSellable';
      case 'INSUFFICIENT_ITEMS':
        return 'error.insufficientItems';
      case 'NPC_OFFER_NOT_FOUND':
        return 'error.npcOfferNotFound';
      case 'ACTIVE_HUNT_LOCKED':
        return 'error.activeHuntShopLocked';
      case 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD':
        return 'error.idempotencyConflict';
      case 'SLOT_INDEX_OUT_OF_BOUNDS':
        return 'error.slotOutOfBounds';
      case 'INSTANCE_SLOT_MISMATCH':
      case 'ITEM_TYPE_MISMATCH':
        return 'error.slotMismatch';
      case 'BACKPACK_NOT_FOUND':
        return 'error.inventoryFull';
      case 'CHARACTER_NOT_FOUND':
        return 'error.characterNotFound';
      default:
        return 'auth.validationError';
    }
  }

  app.get('/npc-shop/catalog', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return reply.code(200).send(
      NpcShopCatalogResponseSchema.parse({
        merchant: {
          id: DEFAULT_NPC_MERCHANT.id,
          nameKey: DEFAULT_NPC_MERCHANT.nameKey,
          greetingKey: DEFAULT_NPC_MERCHANT.greetingKey
        },
        buyOffers: NPC_BUY_OFFERS,
        sellOffers: NPC_SELL_OFFERS,
        catalogVersion: NPC_SHOP_CATALOG_VERSION
      })
    );
  });

  app.get<{ Params: { id: string } }>('/characters/:id/npc-shop/history', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const transactions = await getNpcTransactionsForCharacter(pool, char.id, 50);
    return reply.code(200).send(
      NpcShopHistoryResponseSchema.parse({
        characterId: char.id,
        transactions
      })
    );
  });

  app.post<{ Params: { id: string } }>('/characters/:id/npc-shop/buy', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    const userRateKey = `shop:user:${resolved.session.userId}`;
    if (!npcShopRateLimiter.checkAndRecord(userRateKey, clock.nowMs())) {
      return sendApiError(reply, request, 429, 'RATE_LIMITED', 'hunt.rateLimited');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const parsed = BuyNpcProductRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
    }

    try {
      const result = await buyNpcProduct(pool, {
        characterId: char.id,
        offerId: parsed.data.offerId,
        quantity: parsed.data.quantity,
        idempotencyKey: parsed.data.idempotencyKey,
        nowIso: clock.nowIso()
      });

      return reply.code(200).send(BuyNpcProductResponseSchema.parse(result));
    } catch (err) {
      if (err instanceof NpcShopError) {
        const messageKey = mapNpcShopErrorCodeToMessageKey(err.code);
        return sendApiError(reply, request, err.statusCode, err.code, messageKey);
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>('/characters/:id/npc-shop/sell', async (request, reply) => {
    const pool = requirePool(request, reply);
    if (!pool) return;

    const resolved = await resolveActiveSession(request, pool);
    if (!resolved) {
      return sendApiError(reply, request, 401, 'UNAUTHORIZED', 'auth.unauthorized');
    }
    if (!verifyCsrfProtection(request, resolved.session)) {
      return sendApiError(reply, request, 403, 'CSRF_INVALID', 'auth.csrfInvalid');
    }

    const userRateKey = `shop:user:${resolved.session.userId}`;
    if (!npcShopRateLimiter.checkAndRecord(userRateKey, clock.nowMs())) {
      return sendApiError(reply, request, 429, 'RATE_LIMITED', 'hunt.rateLimited');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(request.params.id)) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const char = await findCharacterByIdForUser(pool, request.params.id, resolved.session.userId);
    if (!char) {
      return sendApiError(reply, request, 404, 'CHARACTER_NOT_FOUND', 'error.characterNotFound');
    }

    const parsed = SellNpcItemRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(reply, request, 400, 'VALIDATION_ERROR', 'auth.validationError');
    }

    try {
      const result = await sellNpcInventoryItem(pool, {
        characterId: char.id,
        itemId: parsed.data.itemId,
        instanceId: parsed.data.instanceId,
        slotIndex: parsed.data.slotIndex,
        quantity: parsed.data.quantity,
        idempotencyKey: parsed.data.idempotencyKey,
        nowIso: clock.nowIso()
      });

      return reply.code(200).send(SellNpcItemResponseSchema.parse(result));
    } catch (err) {
      if (err instanceof NpcShopError) {
        const messageKey = mapNpcShopErrorCodeToMessageKey(err.code);
        return sendApiError(reply, request, err.statusCode, err.code, messageKey);
      }
      throw err;
    }
  });

  return app;
}
