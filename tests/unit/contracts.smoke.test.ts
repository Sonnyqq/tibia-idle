import {
  ApiErrorSchema,
  CONTRACT_VERSION,
  HealthResponseSchema,
  LocaleSchema,
  ReadinessResponseSchema
} from '@tibia-idle/contracts';
import { describe, expect, it } from 'vitest';

describe('@tibia-idle/contracts smoke tests', () => {
  it('validates supported locales and rejects unknown locales', () => {
    expect(LocaleSchema.parse('pl')).toBe('pl');
    expect(LocaleSchema.parse('en')).toBe('en');
    expect(LocaleSchema.safeParse('de').success).toBe(false);
  });

  it('validates health, readiness, and error envelopes', () => {
    const health = HealthResponseSchema.parse({
      status: 'ok',
      service: 'tibia-idle-api',
      version: '0.1.0',
      contractVersion: CONTRACT_VERSION,
      simulationVersion: '0.1.0',
      serverTimeIso: '2026-10-30T19:00:00.000Z'
    });
    expect(health.status).toBe('ok');

    const readiness = ReadinessResponseSchema.parse({
      status: 'ready',
      database: 'up',
      serverTimeIso: '2026-10-30T19:00:00.000Z'
    });
    expect(readiness.database).toBe('up');

    const apiError = ApiErrorSchema.parse({
      error: {
        code: 'INVALID_LOCALE',
        messageKey: 'common.error',
        correlationId: 'req-123'
      }
    });
    expect(apiError.error.code).toBe('INVALID_LOCALE');
  });
});
