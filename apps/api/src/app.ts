import { randomUUID } from 'node:crypto';
import {
  ApiErrorSchema,
  CONTRACT_VERSION,
  HealthResponseSchema,
  LocaleSchema,
  ReadinessResponseSchema
} from '@tibia-idle/contracts';
import { type Clock, createSystemClock, SIMULATION_VERSION } from '@tibia-idle/domain';
import { getDictionary } from '@tibia-idle/i18n';
import Fastify, { type FastifyInstance } from 'fastify';

export interface ApiServerOptions {
  clock?: Clock;
  checkDatabaseReady?: () => Promise<'up' | 'down' | 'unconfigured'>;
  logger?: boolean;
}

export function buildApiServer(options: ApiServerOptions = {}): FastifyInstance {
  const clock = options.clock ?? createSystemClock();
  const checkDatabaseReady =
    options.checkDatabaseReady ?? (async () => 'unconfigured' as const);

  const app = Fastify({
    logger: options.logger ?? false,
    genReqId: () => randomUUID()
  });

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
      const errorBody = ApiErrorSchema.parse({
        error: {
          code: 'INVALID_LOCALE',
          messageKey: 'common.error',
          correlationId: String(request.id)
        }
      });
      return reply.code(400).send(errorBody);
    }
    return {
      locale: parsed.data,
      dictionary: getDictionary(parsed.data)
    };
  });

  return app;
}
