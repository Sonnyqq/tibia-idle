import { SUPPORTED_LOCALES } from '@tibia-idle/i18n';
import { z } from 'zod';

export const CONTRACT_VERSION = '0.2.0' as const;

export const LocaleSchema = z.enum(SUPPORTED_LOCALES);
export type LocaleDto = z.infer<typeof LocaleSchema>;

export const VOCATIONS = ['knight', 'paladin', 'sorcerer', 'druid'] as const;
export const VocationSchema = z.enum(VOCATIONS);
export type VocationDto = z.infer<typeof VocationSchema>;

export const EmailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email()
  .transform((val) => val.toLowerCase());

export const PasswordSchema = z.string().min(8).max(128);

export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  locale: LocaleSchema.optional()
});
export type RegisterRequestDto = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema
});
export type LoginRequestDto = z.infer<typeof LoginRequestSchema>;

export const UpdateLocaleRequestSchema = z.object({
  locale: LocaleSchema
});
export type UpdateLocaleRequestDto = z.infer<typeof UpdateLocaleRequestSchema>;

export const CharacterNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(/^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/);

export const CreateCharacterRequestSchema = z.object({
  name: CharacterNameSchema,
  vocation: VocationSchema
});
export type CreateCharacterRequestDto = z.infer<typeof CreateCharacterRequestSchema>;

export const UserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  locale: LocaleSchema,
  createdAt: z.string().datetime()
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export const CharacterStatsDtoSchema = z.object({
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  hp: z.number().int().min(1),
  maxHp: z.number().int().min(1),
  mp: z.number().int().min(0),
  maxMp: z.number().int().min(0),
  gold: z.number().int().min(0),
  melee: z.number().int().min(1),
  distance: z.number().int().min(1),
  magic: z.number().int().min(0),
  shielding: z.number().int().min(1)
});
export type CharacterStatsDto = z.infer<typeof CharacterStatsDtoSchema>;

export const CharacterDtoSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  slotNumber: z.number().int().min(1).max(3),
  name: z.string().min(3).max(20),
  vocation: VocationSchema,
  stats: CharacterStatsDtoSchema,
  createdAt: z.string().datetime()
});
export type CharacterDto = z.infer<typeof CharacterDtoSchema>;

export const SessionMeResponseSchema = z.object({
  user: UserDtoSchema,
  csrfToken: z.string().min(16),
  characters: z.array(CharacterDtoSchema),
  maxCharacters: z.number().int().min(1)
});
export type SessionMeResponseDto = z.infer<typeof SessionMeResponseSchema>;

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
