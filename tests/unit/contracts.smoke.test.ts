import {
  ApiErrorSchema,
  CONTRACT_VERSION,
  CreateCharacterRequestSchema,
  HealthResponseSchema,
  LocaleSchema,
  LoginRequestSchema,
  ReadinessResponseSchema,
  RegisterRequestSchema
} from '@tibia-idle/contracts';
import { describe, expect, it } from 'vitest';

describe('@tibia-idle/contracts smoke & validation tests', () => {
  it('validates supported locales and rejects unknown locales', () => {
    expect(LocaleSchema.parse('pl')).toBe('pl');
    expect(LocaleSchema.parse('en')).toBe('en');
    expect(LocaleSchema.safeParse('de').success).toBe(false);
  });

  it('validates register, login, and character creation contracts with boundary checks', () => {
    const reg = RegisterRequestSchema.parse({
      email: '  Test.User@Example.com ',
      password: 'StrongPassword123!',
      locale: 'pl'
    });
    expect(reg.email).toBe('test.user@example.com');

    expect(
      RegisterRequestSchema.safeParse({
        email: 'not-an-email',
        password: 'StrongPassword123!'
      }).success
    ).toBe(false);

    expect(
      LoginRequestSchema.safeParse({
        email: 'user@example.com',
        password: 'short'
      }).success
    ).toBe(false);

    expect(
      CreateCharacterRequestSchema.parse({
        name: 'Aldorius',
        vocation: 'paladin'
      })
    ).toEqual({
      name: 'Aldorius',
      vocation: 'paladin'
    });

    expect(
      CreateCharacterRequestSchema.safeParse({
        name: 'Aldorius',
        vocation: 'necromancer'
      }).success
    ).toBe(false);
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
