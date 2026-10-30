import { buildApiServer } from '@tibia-idle/api';
import { ApiErrorSchema, HealthResponseSchema, ReadinessResponseSchema } from '@tibia-idle/contracts';
import { createFixedClock } from '@tibia-idle/domain';
import { describe, expect, it } from 'vitest';

describe('API HTTP integration smoke tests', () => {
  it('serves /health, /ready, and /i18n/:locale over real HTTP', async () => {
    const clock = createFixedClock(Date.parse('2026-10-30T20:00:00.000Z'));
    let dbState: 'up' | 'down' = 'up';

    const server = buildApiServer({
      clock,
      checkDatabaseReady: async () => dbState
    });

    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
    try {
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
      const healthJson = HealthResponseSchema.parse(await healthRes.json());
      expect(healthJson.serverTimeIso).toBe('2026-10-30T20:00:00.000Z');

      const readyRes = await fetch(`${baseUrl}/ready`);
      expect(readyRes.status).toBe(200);
      const readyJson = ReadinessResponseSchema.parse(await readyRes.json());
      expect(readyJson.status).toBe('ready');

      dbState = 'down';
      const degradedRes = await fetch(`${baseUrl}/ready`);
      expect(degradedRes.status).toBe(503);
      const degradedJson = ReadinessResponseSchema.parse(await degradedRes.json());
      expect(degradedJson.status).toBe('degraded');

      const plRes = await fetch(`${baseUrl}/i18n/pl`);
      expect(plRes.status).toBe(200);
      const plBody = (await plRes.json()) as { locale: string; dictionary: Record<string, string> };
      expect(plBody.locale).toBe('pl');
      expect(plBody.dictionary['nav.hunts']).toBe('Polowania');

      const badLocaleRes = await fetch(`${baseUrl}/i18n/de`);
      expect(badLocaleRes.status).toBe(400);
      const badLocaleJson = ApiErrorSchema.parse(await badLocaleRes.json());
      expect(badLocaleJson.error.code).toBe('INVALID_LOCALE');
    } finally {
      await server.close();
    }
  });
});
