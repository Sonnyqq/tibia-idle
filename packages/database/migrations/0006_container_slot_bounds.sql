-- 0006_container_slot_bounds.sql
-- Enforce inventory instance slot_index bounds against parent container slot_capacity.

CREATE OR REPLACE FUNCTION check_inventory_instance_slot_bounds()
RETURNS TRIGGER AS $$
DECLARE
  v_capacity INTEGER;
BEGIN
  SELECT slot_capacity INTO v_capacity
  FROM inventory_containers
  WHERE id = NEW.container_id;

  IF v_capacity IS NULL THEN
    RAISE EXCEPTION 'Container % not found for inventory instance %', NEW.container_id, NEW.id;
  END IF;

  IF NEW.slot_index < 0 OR NEW.slot_index >= v_capacity THEN
    RAISE EXCEPTION 'Slot index % out of bounds for container % with capacity %',
      NEW.slot_index, NEW.container_id, v_capacity;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_inventory_instance_slot_bounds ON inventory_instances;

CREATE TRIGGER trg_check_inventory_instance_slot_bounds
BEFORE INSERT OR UPDATE OF slot_index, container_id
ON inventory_instances
FOR EACH ROW
EXECUTE FUNCTION check_inventory_instance_slot_bounds();
