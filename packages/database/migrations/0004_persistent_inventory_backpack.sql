-- 0004_persistent_inventory_backpack.sql
-- Persistent character inventory, starting backpack container, item instances, and transfer movements audit.

CREATE TABLE IF NOT EXISTS inventory_containers (
  id UUID PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  container_type TEXT NOT NULL CHECK (container_type IN ('backpack')),
  slot_capacity INTEGER NOT NULL DEFAULT 20 CHECK (slot_capacity >= 1 AND slot_capacity <= 100),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_inventory_containers_char_type UNIQUE (character_id, container_type)
);

CREATE INDEX IF NOT EXISTS idx_inventory_containers_character
  ON inventory_containers(character_id);

CREATE TABLE IF NOT EXISTS inventory_instances (
  id UUID PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  container_id UUID NOT NULL REFERENCES inventory_containers(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL CHECK (slot_index >= 0 AND slot_index < 100),
  item_id TEXT NOT NULL CHECK (char_length(item_id) BETWEEN 1 AND 64),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  item_version INTEGER NOT NULL DEFAULT 1 CHECK (item_version >= 1),
  row_version INTEGER NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_inventory_instances_container_slot UNIQUE (container_id, slot_index) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_inventory_instances_character_container
  ON inventory_instances(character_id, container_id, slot_index ASC);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id UUID PRIMARY KEY,
  character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK (
    operation_type IN ('CLAIM_HUNT_REWARD', 'MOVE_ITEM', 'SPLIT_STACK', 'MERGE_STACK', 'SWAP_SLOTS')
  ),
  operation_key TEXT NOT NULL CHECK (char_length(operation_key) BETWEEN 1 AND 128),
  source_reference TEXT NULL,
  item_id TEXT NOT NULL CHECK (char_length(item_id) BETWEEN 1 AND 64),
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_inventory_movements_char_op UNIQUE (character_id, operation_type, operation_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_character_created
  ON inventory_movements(character_id, created_at ASC);

-- Ensure all pre-existing characters receive their starting 20-slot backpack
INSERT INTO inventory_containers (
  id,
  character_id,
  container_type,
  slot_capacity,
  row_version,
  created_at
)
SELECT
  gen_random_uuid(),
  c.id,
  'backpack',
  20,
  1,
  c.created_at
FROM characters c
ON CONFLICT (character_id, container_type) DO NOTHING;
