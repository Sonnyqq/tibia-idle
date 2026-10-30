import { randomUUID } from 'node:crypto';
import {
  ApiErrorSchema,
  CharacterDtoSchema,
  CONTRACT_VERSION,
  CreateCharacterRequestSchema,
  HealthResponseSchema,
  LocaleSchema,
  LoginRequestSchema,
  ReadinessResponseSchema,
  RegisterRequestSchema,
  SessionMeResponseSchema,
  UpdateLocaleRequestSchema,
  UserDtoSchema,
  ZonesCatalogResponseSchema
} from '@tibia-idle/contracts';
import {
  type ActiveSessionRecord,
  createCharacterTransactional,
  createSessionRecord,
  createUserAccount,
  findActiveSessionByTokenHash,
  findCharacterByIdForUser,
  findUserByEmail,
  listCharactersForUser,
  revokeSessionByTokenHash,
  updateUserLocale
} from '@tibia-idle/database';
import {
  type Clock,
  createSystemClock,
  INITIAL_ZONES_CATALOG,
  MAX_CHARACTERS_PER_ACCOUNT,
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
  forceSecureCookies?: boolean;
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

  return app;
}
