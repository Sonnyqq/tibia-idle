-- 0005_equipment_paperdoll.sql
-- Equipment paperdoll container, 9 equipment slots, expanded movements and character equipment backfill.

-- 1. Alter inventory_containers to allow 'equipment' with slot_capacity = 9
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'inventory_containers'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%container_type%'
  ) LOOP
    EXECUTE 'ALTER TABLE inventory_containers DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;

  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'inventory_containers'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%slot_capacity%'
  ) LOOP
    EXECUTE 'ALTER TABLE inventory_containers DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE inventory_containers
  ADD CONSTRAINT chk_inventory_containers_type
  CHECK (container_type IN ('backpack', 'equipment'));

ALTER TABLE inventory_containers
  ADD CONSTRAINT chk_inventory_containers_capacity
  CHECK (
    (container_type = 'backpack' AND slot_capacity = 20) OR
    (container_type = 'equipment' AND slot_capacity = 9)
  );

-- 2. Alter inventory_movements to support EQUIP_ITEM, UNEQUIP_ITEM, SWAP_EQUIPMENT
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
      'SWAP_EQUIPMENT'
    )
  );

-- 3. Backfill 9-slot equipment container for all existing characters
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
  'equipment',
  9,
  1,
  NOW()
FROM characters c
WHERE NOT EXISTS (
  SELECT 1
  FROM inventory_containers ic
  WHERE ic.character_id = c.id
    AND ic.container_type = 'equipment'
);
