-- 0003_persistent_offline_hunts.sql
-- Persistent offline hunts, settlement segments, reward inbox items, currency ledger,
-- and one-time starter potion supplies on characters.

ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS hp_potions INTEGER NOT NULL DEFAULT 250
    CHECK (hp_potions >= 0 AND hp_potions <= 1000000),
  ADD COLUMN IF NOT EXISTS mp_potions INTEGER NOT NULL DEFAULT 150
    CHECK (mp_potions >= 0 AND mp_potions <= 1000000),
  ADD COLUMN IF NOT EXISTS starter_supplies_granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_characters_safe_xp_gold'
  ) THEN
    ALTER TABLE characters
      ADD CONSTRAINT chk_characters_safe_xp_gold
      CHECK (
        xp >= 0 AND xp <= 9007199254740991 AND
        gold >= 0 AND gold <= 9007199254740991
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hunts (
  id UUID PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  start_idempotency_key TEXT NOT NULL CHECK (char_length(start_idempotency_key) BETWEEN 1 AND 128),
  zone_id TEXT NOT NULL CHECK (char_length(zone_id) BETWEEN 1 AND 64),
  strategy TEXT NOT NULL CHECK (strategy IN ('safe', 'balanced', 'aggressive')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'COMPLETED')),
  stop_reason TEXT NULL CHECK (
    stop_reason IS NULL OR stop_reason IN (
      'TIME_REACHED',
      'EVENT_BUDGET_EXHAUSTED',
      'MAX_OFFLINE_CAP_REACHED',
      'CHARACTER_DIED',
      'OUT_OF_HP_POTIONS_CRITICAL',
      'ALREADY_TERMINATED',
      'MANUAL_STOP'
    )
  ),
  started_at TIMESTAMPTZ NOT NULL,
  settled_until TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  simulation_version TEXT NOT NULL CHECK (char_length(simulation_version) BETWEEN 1 AND 32),
  config_digest TEXT NOT NULL CHECK (char_length(config_digest) BETWEEN 1 AND 64),
  private_checkpoint JSONB NOT NULL,
  reserved_hp_potions INTEGER NOT NULL CHECK (reserved_hp_potions >= 0 AND reserved_hp_potions <= 1000000),
  reserved_mp_potions INTEGER NOT NULL CHECK (reserved_mp_potions >= 0 AND reserved_mp_potions <= 1000000),
  potions_returned BOOLEAN NOT NULL DEFAULT FALSE,
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  CONSTRAINT chk_hunts_settled_timeline CHECK (settled_until >= started_at),
  CONSTRAINT chk_hunts_status_lifecycle CHECK (
    (status = 'ACTIVE' AND completed_at IS NULL AND potions_returned = FALSE) OR
    (status = 'COMPLETED' AND completed_at IS NOT NULL AND potions_returned = TRUE)
  ),
  CONSTRAINT uq_hunts_character_start_idempotency UNIQUE (character_id, start_idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hunts_one_active_per_character
  ON hunts(character_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_hunts_character_status
  ON hunts(character_id, status, started_at DESC);

CREATE TABLE IF NOT EXISTS hunt_segments (
  id UUID PRIMARY KEY,
  hunt_id UUID NOT NULL REFERENCES hunts(id) ON DELETE CASCADE,
  segment_key TEXT NOT NULL CHECK (char_length(segment_key) BETWEEN 1 AND 128),
  start_checkpoint_version INTEGER NOT NULL CHECK (start_checkpoint_version >= 1),
  end_checkpoint_version INTEGER NOT NULL CHECK (end_checkpoint_version = start_checkpoint_version + 1),
  segment_from TIMESTAMPTZ NOT NULL,
  segment_to TIMESTAMPTZ NOT NULL,
  processed_duration_ms INTEGER NOT NULL CHECK (processed_duration_ms >= 0 AND processed_duration_ms <= 86400000),
  simulated_events INTEGER NOT NULL CHECK (simulated_events >= 0),
  stop_reason TEXT NOT NULL CHECK (
    stop_reason IN (
      'TIME_REACHED',
      'EVENT_BUDGET_EXHAUSTED',
      'MAX_OFFLINE_CAP_REACHED',
      'CHARACTER_DIED',
      'OUT_OF_HP_POTIONS_CRITICAL',
      'ALREADY_TERMINATED',
      'MANUAL_STOP'
    )
  ),
  is_partial BOOLEAN NOT NULL DEFAULT FALSE,
  rewards JSONB NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_hunt_segments_window CHECK (segment_to >= segment_from),
  CONSTRAINT uq_hunt_segments_hunt_segment_key UNIQUE (hunt_id, segment_key),
  CONSTRAINT uq_hunt_segments_hunt_start_version UNIQUE (hunt_id, start_checkpoint_version)
);

CREATE INDEX IF NOT EXISTS idx_hunt_segments_hunt_id
  ON hunt_segments(hunt_id, start_checkpoint_version ASC);

CREATE TABLE IF NOT EXISTS hunt_reward_items (
  id UUID PRIMARY KEY,
  hunt_id UUID NOT NULL REFERENCES hunts(id) ON DELETE CASCADE,
  hunt_segment_id UUID NOT NULL REFERENCES hunt_segments(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL CHECK (char_length(item_id) BETWEEN 1 AND 64),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  ownership_state TEXT NOT NULL DEFAULT 'UNCLAIMED' CHECK (ownership_state IN ('UNCLAIMED', 'CLAIMED')),
  claimed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_hunt_reward_items_claim_state CHECK (
    (ownership_state = 'UNCLAIMED' AND claimed_at IS NULL) OR
    (ownership_state = 'CLAIMED' AND claimed_at IS NOT NULL)
  ),
  CONSTRAINT uq_hunt_reward_items_segment_item UNIQUE (hunt_segment_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_hunt_reward_items_character
  ON hunt_reward_items(character_id, ownership_state, created_at ASC);

CREATE TABLE IF NOT EXISTS currency_ledger (
  id UUID PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('CHARACTER_INITIAL_GRANT', 'HUNT_SETTLEMENT')),
  source_id UUID NOT NULL,
  amount BIGINT NOT NULL CHECK (
    amount <> 0 AND amount >= -9007199254740991 AND amount <= 9007199254740991
  ),
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0 AND balance_after <= 9007199254740991),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('CREDIT', 'DEBIT')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_currency_ledger_sign CHECK (
    (transaction_type = 'CREDIT' AND amount > 0) OR
    (transaction_type = 'DEBIT' AND amount < 0)
  ),
  CONSTRAINT uq_currency_ledger_source UNIQUE (character_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_currency_ledger_character_created
  ON currency_ledger(character_id, created_at ASC);

-- Backfill initial starting gold ledger entry for any pre-existing characters
INSERT INTO currency_ledger (
  id,
  character_id,
  source_type,
  source_id,
  amount,
  balance_after,
  transaction_type,
  created_at
)
SELECT
  c.id,
  c.id,
  'CHARACTER_INITIAL_GRANT',
  c.id,
  c.gold,
  c.gold,
  'CREDIT',
  c.created_at
FROM characters c
WHERE c.gold > 0
ON CONFLICT (character_id, source_type, source_id) DO NOTHING;
