-- 0002_auth_sessions_characters.sql
-- Accounts (users), server-side sessions (hashed tokens), and characters (max 3 slots per user).

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'pl' CHECK (locale IN ('pl', 'en')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash_active ON sessions(token_hash) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS characters (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot_number SMALLINT NOT NULL CHECK (slot_number BETWEEN 1 AND 3),
  name TEXT NOT NULL,
  name_normalized TEXT NOT NULL UNIQUE,
  vocation TEXT NOT NULL CHECK (vocation IN ('knight', 'paladin', 'sorcerer', 'druid')),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
  hp INTEGER NOT NULL CHECK (hp > 0),
  max_hp INTEGER NOT NULL CHECK (max_hp > 0),
  mp INTEGER NOT NULL CHECK (mp >= 0),
  max_mp INTEGER NOT NULL CHECK (max_mp >= 0),
  gold BIGINT NOT NULL DEFAULT 0 CHECK (gold >= 0),
  skill_melee INTEGER NOT NULL CHECK (skill_melee >= 1),
  skill_distance INTEGER NOT NULL CHECK (skill_distance >= 1),
  skill_magic INTEGER NOT NULL CHECK (skill_magic >= 0),
  skill_shielding INTEGER NOT NULL CHECK (skill_shielding >= 1),
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_characters_user_slot UNIQUE (user_id, slot_number)
);

CREATE INDEX IF NOT EXISTS idx_characters_user_id ON characters(user_id);
