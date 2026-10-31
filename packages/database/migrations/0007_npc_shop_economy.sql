-- 0007_npc_shop_economy.sql
-- NPC transactions, potion restock, item sale, sequence_id in currency_ledger and expanded movement types.

-- 1. Alter currency_ledger to add sequence_id and expand source_type check
ALTER TABLE currency_ledger
  ADD COLUMN IF NOT EXISTS sequence_id BIGSERIAL;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'currency_ledger'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%source_type%'
  ) LOOP
    EXECUTE 'ALTER TABLE currency_ledger DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE currency_ledger
  ADD CONSTRAINT chk_currency_ledger_source_type
  CHECK (source_type IN ('CHARACTER_INITIAL_GRANT', 'HUNT_SETTLEMENT', 'NPC_PURCHASE', 'NPC_SALE'));

CREATE INDEX IF NOT EXISTS idx_currency_ledger_char_seq
  ON currency_ledger(character_id, sequence_id ASC);

-- 2. Alter inventory_movements to support NPC_SALE
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'inventory_movements'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%operation_type%'
  ) LOOP
    EXECUTE 'ALTER TABLE inventory_movements DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE inventory_movements
  ADD CONSTRAINT chk_inventory_movements_operation_type
  CHECK (
    operation_type IN (
      'CLAIM_HUNT_REWARD',
      'MOVE_ITEM',
      'SPLIT_STACK',
      'MERGE_STACK',
      'SWAP_SLOTS',
      'EQUIP_ITEM',
      'UNEQUIP_ITEM',
      'SWAP_EQUIPMENT',
      'NPC_SALE'
    )
  );

-- 3. Create npc_transactions table
CREATE TABLE IF NOT EXISTS npc_transactions (
  id UUID PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  npc_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('BUY', 'SELL')),
  operation_key TEXT NOT NULL CHECK (char_length(operation_key) BETWEEN 1 AND 128),
  canonical_payload JSONB NOT NULL,
  product_id TEXT NOT NULL CHECK (char_length(product_id) BETWEEN 1 AND 64),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  total_gold BIGINT NOT NULL CHECK (total_gold > 0 AND total_gold <= 9007199254740991),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_npc_transactions_char_key UNIQUE (character_id, operation_key)
);

CREATE INDEX IF NOT EXISTS idx_npc_transactions_character_created
  ON npc_transactions(character_id, created_at DESC);

-- 4. Create npc_transaction_lines table
CREATE TABLE IF NOT EXISTS npc_transaction_lines (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES npc_transactions(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL CHECK (line_index >= 0),
  product_id TEXT NOT NULL CHECK (char_length(product_id) BETWEEN 1 AND 64),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  total_gold BIGINT NOT NULL CHECK (total_gold > 0 AND total_gold <= 9007199254740991),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_npc_transaction_lines_tx_line UNIQUE (transaction_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_npc_transaction_lines_tx
  ON npc_transaction_lines(transaction_id, line_index ASC);
