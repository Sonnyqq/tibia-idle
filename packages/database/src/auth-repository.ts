import { randomUUID } from 'node:crypto';
import { type CharacterDto, type LocaleDto, type UserDto, type VocationDto } from '@tibia-idle/contracts';
import {
  createInitialCharacterStats,
  MAX_CHARACTERS_PER_ACCOUNT,
  normalizeEmail,
  validateCharacterNameDomain
} from '@tibia-idle/domain';
import type pg from 'pg';

export interface StoredUserRecord {
  id: string;
  email: string;
  emailNormalized: string;
  passwordHash: string;
  locale: LocaleDto;
  createdAtIso: string;
}

export interface ActiveSessionRecord {
  sessionId: string;
  userId: string;
  csrfToken: string;
  expiresAtIso: string;
  user: UserDto;
}

interface UserRow {
  id: string;
  email: string;
  email_normalized: string;
  password_hash: string;
  locale: LocaleDto;
  created_at: Date;
}

interface CharacterRow {
  id: string;
  user_id: string;
  slot_number: number;
  name: string;
  vocation: VocationDto;
  level: number;
  xp: string | number;
  hp: number;
  max_hp: number;
  mp: number;
  max_mp: number;
  gold: string | number;
  skill_melee: number;
  skill_distance: number;
  skill_magic: number;
  skill_shielding: number;
  created_at: Date;
}

function mapUserDto(row: Pick<UserRow, 'id' | 'email' | 'locale' | 'created_at'>): UserDto {
  return {
    id: row.id,
    email: row.email,
    locale: row.locale,
    createdAt: row.created_at.toISOString()
  };
}

function mapCharacterDto(row: CharacterRow): CharacterDto {
  return {
    id: row.id,
    userId: row.user_id,
    slotNumber: Number(row.slot_number),
    name: row.name,
    vocation: row.vocation,
    stats: {
      level: Number(row.level),
      xp: Number(row.xp),
      hp: Number(row.hp),
      maxHp: Number(row.max_hp),
      mp: Number(row.mp),
      maxMp: Number(row.max_mp),
      gold: Number(row.gold),
      melee: Number(row.skill_melee),
      distance: Number(row.skill_distance),
      magic: Number(row.skill_magic),
      shielding: Number(row.skill_shielding)
    },
    createdAt: row.created_at.toISOString()
  };
}

function isPgUniqueViolation(err: unknown): err is { code: string; constraint?: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

export async function createUserAccount(
  pool: pg.Pool,
  params: {
    email: string;
    passwordHash: string;
    locale: LocaleDto;
    nowIso: string;
  }
): Promise<{ ok: true; user: UserDto } | { ok: false; reason: 'EMAIL_TAKEN' }> {
  const emailNormalized = normalizeEmail(params.email);
  const id = randomUUID();
  try {
    const res = await pool.query<UserRow>(
      `INSERT INTO users (id, email, email_normalized, password_hash, locale, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
       RETURNING id, email, email_normalized, password_hash, locale, created_at`,
      [id, emailNormalized, emailNormalized, params.passwordHash, params.locale, params.nowIso]
    );
    const row = res.rows[0];
    if (!row) {
      throw new Error('Failed to insert user row');
    }
    return { ok: true, user: mapUserDto(row) };
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      return { ok: false, reason: 'EMAIL_TAKEN' };
    }
    throw err;
  }
}

export async function findUserByEmail(
  pool: pg.Pool,
  rawEmail: string
): Promise<StoredUserRecord | null> {
  const emailNormalized = normalizeEmail(rawEmail);
  const res = await pool.query<UserRow>(
    `SELECT id, email, email_normalized, password_hash, locale, created_at
     FROM users
     WHERE email_normalized = $1
     LIMIT 1`,
    [emailNormalized]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    emailNormalized: row.email_normalized,
    passwordHash: row.password_hash,
    locale: row.locale,
    createdAtIso: row.created_at.toISOString()
  };
}

export async function updateUserLocale(
  pool: pg.Pool,
  userId: string,
  locale: LocaleDto
): Promise<UserDto | null> {
  const res = await pool.query<UserRow>(
    `UPDATE users
     SET locale = $2
     WHERE id = $1
     RETURNING id, email, locale, created_at`,
    [userId, locale]
  );
  const row = res.rows[0];
  return row ? mapUserDto(row) : null;
}

export async function createSessionRecord(
  pool: pg.Pool,
  params: {
    userId: string;
    tokenHash: string;
    csrfToken: string;
    nowIso: string;
    expiresAtIso: string;
  }
): Promise<string> {
  const sessionId = randomUUID();
  await pool.query(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
    [sessionId, params.userId, params.tokenHash, params.csrfToken, params.expiresAtIso, params.nowIso]
  );
  return sessionId;
}

export async function findActiveSessionByTokenHash(
  pool: pg.Pool,
  tokenHash: string,
  nowIso: string
): Promise<ActiveSessionRecord | null> {
  const res = await pool.query<{
    session_id: string;
    user_id: string;
    csrf_token: string;
    expires_at: Date;
    email: string;
    locale: LocaleDto;
    user_created_at: Date;
  }>(
    `SELECT
       s.id AS session_id,
       s.user_id,
       s.csrf_token,
       s.expires_at,
       u.email,
       u.locale,
       u.created_at AS user_created_at
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > $2::timestamptz
     LIMIT 1`,
    [tokenHash, nowIso]
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    csrfToken: row.csrf_token,
    expiresAtIso: row.expires_at.toISOString(),
    user: {
      id: row.user_id,
      email: row.email,
      locale: row.locale,
      createdAt: row.user_created_at.toISOString()
    }
  };
}

export async function revokeSessionByTokenHash(
  pool: pg.Pool,
  tokenHash: string,
  nowIso: string
): Promise<boolean> {
  const res = await pool.query(
    `UPDATE sessions
     SET revoked_at = $2::timestamptz
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash, nowIso]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listCharactersForUser(
  pool: pg.Pool,
  userId: string
): Promise<CharacterDto[]> {
  const res = await pool.query<CharacterRow>(
    `SELECT
       id, user_id, slot_number, name, vocation, level, xp,
       hp, max_hp, mp, max_mp, gold,
       skill_melee, skill_distance, skill_magic, skill_shielding, created_at
     FROM characters
     WHERE user_id = $1
     ORDER BY slot_number ASC`,
    [userId]
  );
  return res.rows.map(mapCharacterDto);
}

export async function findCharacterByIdForUser(
  pool: pg.Pool,
  characterId: string,
  userId: string
): Promise<CharacterDto | null> {
  const res = await pool.query<CharacterRow>(
    `SELECT
       id, user_id, slot_number, name, vocation, level, xp,
       hp, max_hp, mp, max_mp, gold,
       skill_melee, skill_distance, skill_magic, skill_shielding, created_at
     FROM characters
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [characterId, userId]
  );
  const row = res.rows[0];
  return row ? mapCharacterDto(row) : null;
}

export type CreateCharacterDbResult =
  | { ok: true; character: CharacterDto }
  | {
      ok: false;
      reason:
        | 'INVALID_NAME'
        | 'RESERVED_NAME'
        | 'CHARACTER_LIMIT_REACHED'
        | 'CHARACTER_NAME_TAKEN'
        | 'USER_NOT_FOUND';
    };

export async function createCharacterTransactional(
  pool: pg.Pool,
  params: {
    userId: string;
    name: string;
    vocation: VocationDto;
    nowIso: string;
  }
): Promise<CreateCharacterDbResult> {
  const nameValidation = validateCharacterNameDomain(params.name);
  if (!nameValidation.ok) {
    return {
      ok: false,
      reason: nameValidation.reason === 'RESERVED_NAME' ? 'RESERVED_NAME' : 'INVALID_NAME'
    };
  }

  const stats = createInitialCharacterStats(params.vocation);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock parent account row to serialize concurrent character creation for this account
    const userLock = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE id = $1 FOR UPDATE',
      [params.userId]
    );
    if (userLock.rowCount === 0) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'USER_NOT_FOUND' };
    }

    const existingSlots = await client.query<{ slot_number: number }>(
      'SELECT slot_number FROM characters WHERE user_id = $1 ORDER BY slot_number ASC',
      [params.userId]
    );
    if (existingSlots.rows.length >= MAX_CHARACTERS_PER_ACCOUNT) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'CHARACTER_LIMIT_REACHED' };
    }

    const used = new Set(existingSlots.rows.map((r) => Number(r.slot_number)));
    let nextSlot = 1;
    while (used.has(nextSlot) && nextSlot <= MAX_CHARACTERS_PER_ACCOUNT) {
      nextSlot += 1;
    }
    if (nextSlot > MAX_CHARACTERS_PER_ACCOUNT) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'CHARACTER_LIMIT_REACHED' };
    }

    const characterId = randomUUID();
    const insertRes = await client.query<CharacterRow>(
      `INSERT INTO characters (
         id, user_id, slot_number, name, name_normalized, vocation,
         level, xp, hp, max_hp, mp, max_mp, gold,
         skill_melee, skill_distance, skill_magic, skill_shielding, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::timestamptz)
       RETURNING
         id, user_id, slot_number, name, vocation, level, xp,
         hp, max_hp, mp, max_mp, gold,
         skill_melee, skill_distance, skill_magic, skill_shielding, created_at`,
      [
        characterId,
        params.userId,
        nextSlot,
        nameValidation.displayName,
        nameValidation.normalizedKey,
        params.vocation,
        stats.level,
        stats.xp,
        stats.hp,
        stats.maxHp,
        stats.mp,
        stats.maxMp,
        stats.gold,
        stats.melee,
        stats.distance,
        stats.magic,
        stats.shielding,
        params.nowIso
      ]
    );

    const row = insertRes.rows[0];
    if (!row) {
      throw new Error('Failed to insert character');
    }

    if (stats.gold > 0) {
      await client.query(
        `INSERT INTO currency_ledger (
           id, character_id, source_type, source_id, amount, balance_after, transaction_type, created_at
         )
         VALUES ($1, $2, 'CHARACTER_INITIAL_GRANT', $2, $3, $3, 'CREDIT', $4::timestamptz)
         ON CONFLICT (character_id, source_type, source_id) DO NOTHING`,
        [randomUUID(), characterId, stats.gold, params.nowIso]
      );
    }

    await client.query('COMMIT');
    return { ok: true, character: mapCharacterDto(row) };
  } catch (err) {
    await client.query('ROLLBACK');
    if (isPgUniqueViolation(err)) {
      if (err.constraint === 'uq_characters_user_slot') {
        return { ok: false, reason: 'CHARACTER_LIMIT_REACHED' };
      }
      return { ok: false, reason: 'CHARACTER_NAME_TAKEN' };
    }
    throw err;
  } finally {
    client.release();
  }
}
