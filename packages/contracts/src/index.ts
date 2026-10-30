import { SUPPORTED_LOCALES } from '@tibia-idle/i18n';
import { z } from 'zod';

export const CONTRACT_VERSION = '0.1.0' as const;

export const LocaleSchema = z.enum(SUPPORTED_LOCALES);
export type LocaleDto = z.infer<typeof LocaleSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('tibia-idle-api'),
  version: z.string().min(1),
  contractVersion: z.literal(CONTRACT_VERSION),
  simulationVersion: z.string().min(1),
  serverTimeIso: z.string().datetime()
});
export type HealthResponseDto = z.infer<typeof HealthResponseSchema>;

export const ReadinessResponseSchema = z.object({
  status: z.enum(['ready', 'degraded']),
  database: z.enum(['up', 'down', 'unconfigured']),
  serverTimeIso: z.string().datetime()
});
export type ReadinessResponseDto = z.infer<typeof ReadinessResponseSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    messageKey: z.string().min(1),
    correlationId: z.string().min(1)
  })
});
export type ApiErrorDto = z.infer<typeof ApiErrorSchema>;
