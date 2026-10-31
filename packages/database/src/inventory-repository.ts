import { randomUUID } from 'node:crypto';
import {
  type CharacterHuntRewardItemDto,
  type CharacterInventoryResponseDto,
  type InventoryContainerDto,
  type InventorySlotItemDto,
  type ItemRarityDto,
  type VocationDto
} from '@tibia-idle/contracts';
import {
  calculateCharacterMaxCapacity,
  calculateInventoryCapacity,
  calculateInventoryWeight,
  getItemDefinition
} from '@tibia-idle/domain';
import type pg from 'pg';

export interface InventoryContainerDbRow {
  id: string;
  character_id: string;
  container_type: 'backpack';
  slot_capacity: number;
  row_version: number;
  created_at: Date;
}

export interface InventoryInstanceDbRow {
  id: string;
  character_id: string;
  container_id: string;
  slot_index: number;
  item_id: string;
  quantity: number;
  metadata: Record<string, unknown>;
  item_version: number;
  row_version: number;
  created_at: Date;
}

export interface ClaimHuntRewardInput {
  readonly characterId: string;
  readonly rewardId: string;
  readonly idempotencyKey: string;
  readonly nowIso?: string;
  readonly faultHook?: (stage: 'BEFORE_COMMIT' | 'AFTER_COMMIT') => Promise<void>;
}

export type ClaimHuntRewardResult =
  | {
      readonly status: 'SUCCESS';
      readonly claimedItem: CharacterHuntRewardItemDto;
      readonly inventory: CharacterInventoryResponseDto;
      readonly idempotentReplay: boolean;
    }
  | { readonly status: 'REWARD_NOT_FOUND' }
  | { readonly status: 'REWARD_ALREADY_CLAIMED' }
  | { readonly status: 'INVENTORY_FULL' }
  | { readonly status: 'CAPACITY_EXCEEDED' }
  | { readonly status: 'FORBIDDEN' };

export interface MoveInventoryItemInput {
  readonly characterId: string;
  readonly fromSlot: number;
  readonly toSlot: number;
  readonly idempotencyKey: string;
  readonly containerId?: string | undefined;
}

export type MoveInventoryItemResult =
  | {
      readonly status: 'SUCCESS';
      readonly action: 'MOVED' | 'MERGED' | 'SWAPPED';
      readonly inventory: CharacterInventoryResponseDto;
      readonly idempotentReplay: boolean;
    }
  | { readonly status: 'ITEM_NOT_FOUND' }
  | { readonly status: 'INVENTORY_FULL' }
  | { readonly status: 'CAPACITY_EXCEEDED' }
  | { readonly status: 'FORBIDDEN' };

export interface SplitInventoryStackInput {
  readonly characterId: string;
  readonly fromSlot: number;
  readonly toSlot: number;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly containerId?: string | undefined;
}

export type SplitInventoryStackResult =
  | {
      readonly status: 'SUCCESS';
      readonly inventory: CharacterInventoryResponseDto;
      readonly idempotentReplay: boolean;
    }
  | { readonly status: 'ITEM_NOT_FOUND' }
  | { readonly status: 'INVALID_QUANTITY' }
  | { readonly status: 'STACK_INCOMPATIBLE' }
  | { readonly status: 'INVENTORY_FULL' }
  | { readonly status: 'FORBIDDEN' };

function mapSlotItemDto(row: InventoryInstanceDbRow): InventorySlotItemDto {
  const def = getItemDefinition(row.item_id);
  if (!def) {
    throw new Error(`Unknown item_id '${row.item_id}' in inventory instance '${row.id}'`);
  }
  return {
    id: row.id,
    containerId: row.container_id,
    slotIndex: row.slot_index,
    itemId: row.item_id,
    nameKey: def.nameKey,
    rarity: def.rarity,
    assetId: def.assetId,
    fallbackIconKey: def.fallbackIconKey,
    itemType: def.itemType,
    stackable: def.stackable,
    maxStackSize: def.maxStackSize,
    weightUnits: def.weightUnits,
    totalWeight: def.weightUnits * row.quantity,
    quantity: row.quantity,
    rowVersion: row.row_version
  };
}

async function getOrCreateBackpackContainer(
  client: pg.PoolClient | pg.Pool,
  characterId: string
): Promise<InventoryContainerDbRow> {
  const selectRes = await client.query<InventoryContainerDbRow>(
    `SELECT * FROM inventory_containers WHERE character_id = $1 AND container_type = 'backpack' LIMIT 1`,
    [characterId]
  );
  if (selectRes.rows[0]) {
    return selectRes.rows[0];
  }

  const insertRes = await client.query<InventoryContainerDbRow>(
    `INSERT INTO inventory_containers (
       id, character_id, container_type, slot_capacity, row_version, created_at
     )
     VALUES ($1, $2, 'backpack', 20, 1, NOW())
     ON CONFLICT (character_id, container_type) DO UPDATE
       SET row_version = inventory_containers.row_version
     RETURNING *`,
    [randomUUID(), characterId]
  );
  const row = insertRes.rows[0];
  if (!row) {
    throw new Error('Failed to create or retrieve backpack container');
  }
  return row;
}

export async function getCharacterContainers(
  pool: pg.Pool,
  characterId: string
): Promise<readonly InventoryContainerDto[]> {
  const container = await getOrCreateBackpackContainer(pool, characterId);
  const occupiedRes = await pool.query<{ count: string }>(
    `SELECT count(*) FROM inventory_instances WHERE character_id = $1 AND container_id = $2`,
    [characterId, container.id]
  );
  const occupiedSlots = Number(occupiedRes.rows[0]?.count ?? 0);

  return [
    {
      id: container.id,
      characterId: container.character_id,
      containerType: 'backpack',
      slotCapacity: container.slot_capacity,
      occupiedSlots,
      rowVersion: container.row_version
    }
  ];
}

export async function getCharacterInventory(
  pool: pg.Pool | pg.PoolClient,
  characterId: string
): Promise<CharacterInventoryResponseDto> {
  const charRes = await pool.query<{ vocation: VocationDto; level: number }>(
    `SELECT vocation, level FROM characters WHERE id = $1 LIMIT 1`,
    [characterId]
  );
  const charRow = charRes.rows[0];
  if (!charRow) {
    throw new Error(`Character '${characterId}' not found`);
  }

  const container = await getOrCreateBackpackContainer(pool, characterId);
  const itemsRes = await pool.query<InventoryInstanceDbRow>(
    `SELECT * FROM inventory_instances
     WHERE character_id = $1 AND container_id = $2
     ORDER BY slot_index ASC`,
    [characterId, container.id]
  );

  const slots = itemsRes.rows.map(mapSlotItemDto);
  const capacity = calculateInventoryCapacity(
    charRow.vocation,
    charRow.level,
    slots,
    container.slot_capacity
  );

  return {
    characterId,
    container: {
      id: container.id,
      characterId: container.character_id,
      containerType: 'backpack',
      slotCapacity: container.slot_capacity,
      occupiedSlots: slots.length,
      rowVersion: container.row_version
    },
    slots,
    capacity
  };
}

export async function claimHuntReward(
  pool: pg.Pool,
  input: ClaimHuntRewardInput
): Promise<ClaimHuntRewardResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Idempotency replay check
    const replayRes = await client.query<{ id: string; item_id: string; quantity: number }>(
      `SELECT id, item_id, quantity
       FROM inventory_movements
       WHERE character_id = $1 AND operation_type = 'CLAIM_HUNT_REWARD' AND operation_key = $2
       LIMIT 1`,
      [input.characterId, input.idempotencyKey]
    );

    if (replayRes.rows[0]) {
      // Already committed with this idempotencyKey
      const rewardRes = await client.query<{
        id: string;
        hunt_id: string;
        hunt_segment_id: string;
        character_id: string;
        item_id: string;
        quantity: number;
        ownership_state: 'UNCLAIMED' | 'CLAIMED';
        claimed_at: Date | null;
        created_at: Date;
      }>(
        `SELECT * FROM hunt_reward_items WHERE id = $1 AND character_id = $2 LIMIT 1`,
        [input.rewardId, input.characterId]
      );
      const rewardRow = rewardRes.rows[0];
      if (!rewardRow) {
        await client.query('ROLLBACK');
        return { status: 'REWARD_NOT_FOUND' };
      }

      const def = getItemDefinition(rewardRow.item_id);
      const claimedItem: CharacterHuntRewardItemDto = {
        id: rewardRow.id,
        huntId: rewardRow.hunt_id,
        huntSegmentId: rewardRow.hunt_segment_id,
        itemId: rewardRow.item_id,
        nameKey: def?.nameKey ?? `item.${rewardRow.item_id}`,
        rarity: (def?.rarity ?? 'common') as ItemRarityDto,
        quantity: rewardRow.quantity,
        ownershipState: 'CLAIMED',
        claimedAtIso: rewardRow.claimed_at ? rewardRow.claimed_at.toISOString() : new Date().toISOString(),
        createdAtIso: rewardRow.created_at.toISOString()
      };

      const inventory = await getCharacterInventory(client, input.characterId);
      await client.query('COMMIT');
      return {
        status: 'SUCCESS',
        claimedItem,
        inventory,
        idempotentReplay: true
      };
    }

    // 2. Lock hunt reward row
    const rewardRes = await client.query<{
      id: string;
      hunt_id: string;
      hunt_segment_id: string;
      character_id: string;
      item_id: string;
      quantity: number;
      ownership_state: 'UNCLAIMED' | 'CLAIMED';
      claimed_at: Date | null;
      created_at: Date;
    }>(
      `SELECT * FROM hunt_reward_items WHERE id = $1 AND character_id = $2 FOR UPDATE`,
      [input.rewardId, input.characterId]
    );

    const rewardRow = rewardRes.rows[0];
    if (!rewardRow) {
      await client.query('ROLLBACK');
      return { status: 'REWARD_NOT_FOUND' };
    }

    if (rewardRow.ownership_state === 'CLAIMED') {
      await client.query('ROLLBACK');
      return { status: 'REWARD_ALREADY_CLAIMED' };
    }

    // 3. Lock character & backpack container
    const charRes = await client.query<{ vocation: VocationDto; level: number }>(
      `SELECT vocation, level FROM characters WHERE id = $1 FOR UPDATE`,
      [input.characterId]
    );
    const charRow = charRes.rows[0];
    if (!charRow) {
      await client.query('ROLLBACK');
      return { status: 'FORBIDDEN' };
    }

    const container = await getOrCreateBackpackContainer(client, input.characterId);

    // 4. Lock current items in backpack
    const existingItemsRes = await client.query<InventoryInstanceDbRow>(
      `SELECT * FROM inventory_instances
       WHERE character_id = $1 AND container_id = $2
       ORDER BY slot_index ASC
       FOR UPDATE`,
      [input.characterId, container.id]
    );
    const existingItems = existingItemsRes.rows;

    const itemDef = getItemDefinition(rewardRow.item_id);
    if (!itemDef) {
      throw new RangeError(`Catalog item '${rewardRow.item_id}' not found in domain definitions`);
    }

    // 5. Weight & capacity verification
    const maxCapacity = calculateCharacterMaxCapacity(charRow.vocation, charRow.level);
    const currentWeight = calculateInventoryWeight(
      existingItems.map((i) => ({ itemId: i.item_id, quantity: i.quantity }))
    );
    const addedWeight = itemDef.weightUnits * rewardRow.quantity;

    if (currentWeight + addedWeight > maxCapacity) {
      await client.query('ROLLBACK');
      return { status: 'CAPACITY_EXCEEDED' };
    }

    // 6. Slots and stacking placement
    let remainingQuantity = rewardRow.quantity;
    const occupiedSlotMap = new Map<number, InventoryInstanceDbRow>();
    for (const item of existingItems) {
      occupiedSlotMap.set(item.slot_index, item);
    }

    // A. Check stackable partial merges first
    if (itemDef.stackable) {
      for (const item of existingItems) {
        if (item.item_id === rewardRow.item_id && item.quantity < itemDef.maxStackSize) {
          const space = itemDef.maxStackSize - item.quantity;
          const add = Math.min(remainingQuantity, space);
          const newQty = item.quantity + add;
          await client.query(
            `UPDATE inventory_instances
             SET quantity = $1, row_version = row_version + 1
             WHERE id = $2`,
            [newQty, item.id]
          );
          item.quantity = newQty;
          remainingQuantity -= add;
          if (remainingQuantity === 0) break;
        }
      }
    }

    // B. If remaining items exist, find free slots
    if (remainingQuantity > 0) {
      const freeSlots: number[] = [];
      for (let s = 0; s < container.slot_capacity; s++) {
        if (!occupiedSlotMap.has(s)) {
          freeSlots.push(s);
        }
      }

      const requiredSlots = itemDef.stackable
        ? Math.ceil(remainingQuantity / itemDef.maxStackSize)
        : remainingQuantity;

      if (freeSlots.length < requiredSlots) {
        await client.query('ROLLBACK');
        return { status: 'INVENTORY_FULL' };
      }

      if (itemDef.stackable) {
        let slotIdx = 0;
        while (remainingQuantity > 0 && slotIdx < freeSlots.length) {
          const targetSlot = freeSlots[slotIdx];
          if (targetSlot === undefined) {
            break;
          }
          const chunk = Math.min(remainingQuantity, itemDef.maxStackSize);
          await client.query(
            `INSERT INTO inventory_instances (
               id, character_id, container_id, slot_index, item_id, quantity, metadata, item_version, row_version, created_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, 1, 1, NOW())`,
            [randomUUID(), input.characterId, container.id, targetSlot, rewardRow.item_id, chunk]
          );
          remainingQuantity -= chunk;
          slotIdx++;
        }
      } else {
        // Non-stackable: 1 item per slot
        for (let i = 0; i < remainingQuantity; i++) {
          const targetSlot = freeSlots[i];
          if (targetSlot === undefined) {
            break;
          }
          await client.query(
            `INSERT INTO inventory_instances (
               id, character_id, container_id, slot_index, item_id, quantity, metadata, item_version, row_version, created_at
             )
             VALUES ($1, $2, $3, $4, $5, 1, '{}'::jsonb, 1, 1, NOW())`,
            [randomUUID(), input.characterId, container.id, targetSlot, rewardRow.item_id]
          );
        }
        remainingQuantity = 0;
      }
    }

    // 7. Record immutable audit movement
    await client.query(
      `INSERT INTO inventory_movements (
         id, character_id, operation_type, operation_key, source_reference, item_id, quantity, created_at
       )
       VALUES ($1, $2, 'CLAIM_HUNT_REWARD', $3, $4, $5, $6, NOW())`,
      [
        randomUUID(),
        input.characterId,
        input.idempotencyKey,
        input.rewardId,
        rewardRow.item_id,
        rewardRow.quantity
      ]
    );

    // 8. Mark reward as CLAIMED
    const nowIso = input.nowIso ?? new Date().toISOString();
    await client.query(
      `UPDATE hunt_reward_items
       SET ownership_state = 'CLAIMED', claimed_at = $1::timestamptz
       WHERE id = $2`,
      [nowIso, input.rewardId]
    );

    if (input.faultHook) {
      await input.faultHook('BEFORE_COMMIT');
    }

    await client.query('COMMIT');

    if (input.faultHook) {
      await input.faultHook('AFTER_COMMIT');
    }

    const claimedItem: CharacterHuntRewardItemDto = {
      id: rewardRow.id,
      huntId: rewardRow.hunt_id,
      huntSegmentId: rewardRow.hunt_segment_id,
      itemId: rewardRow.item_id,
      nameKey: itemDef.nameKey,
      rarity: itemDef.rarity,
      quantity: rewardRow.quantity,
      ownershipState: 'CLAIMED',
      claimedAtIso: nowIso,
      createdAtIso: rewardRow.created_at.toISOString()
    };

    const inventory = await getCharacterInventory(pool, input.characterId);

    return {
      status: 'SUCCESS',
      claimedItem,
      inventory,
      idempotentReplay: false
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback errors on broken connection
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function moveInventoryItem(
  pool: pg.Pool,
  input: MoveInventoryItemInput
): Promise<MoveInventoryItemResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Idempotency check
    const replayRes = await client.query<{ id: string }>(
      `SELECT id FROM inventory_movements
       WHERE character_id = $1 AND operation_type = 'MOVE_ITEM' AND operation_key = $2
       LIMIT 1`,
      [input.characterId, input.idempotencyKey]
    );
    if (replayRes.rows[0]) {
      const inventory = await getCharacterInventory(client, input.characterId);
      await client.query('COMMIT');
      return {
        status: 'SUCCESS',
        action: 'MOVED',
        inventory,
        idempotentReplay: true
      };
    }

    const container = await getOrCreateBackpackContainer(client, input.characterId);
    if (input.fromSlot < 0 || input.fromSlot >= container.slot_capacity) {
      await client.query('ROLLBACK');
      return { status: 'ITEM_NOT_FOUND' };
    }
    if (input.toSlot < 0 || input.toSlot >= container.slot_capacity) {
      await client.query('ROLLBACK');
      return { status: 'INVENTORY_FULL' };
    }

    if (input.fromSlot === input.toSlot) {
      const inventory = await getCharacterInventory(client, input.characterId);
      await client.query('COMMIT');
      return {
        status: 'SUCCESS',
        action: 'MOVED',
        inventory,
        idempotentReplay: false
      };
    }

    // 2. Lock items at fromSlot and toSlot
    const fromItemRes = await client.query<InventoryInstanceDbRow>(
      `SELECT * FROM inventory_instances
       WHERE character_id = $1 AND container_id = $2 AND slot_index = $3
       FOR UPDATE`,
      [input.characterId, container.id, input.fromSlot]
    );
    const fromItem = fromItemRes.rows[0];
    if (!fromItem) {
      await client.query('ROLLBACK');
      return { status: 'ITEM_NOT_FOUND' };
    }

    const toItemRes = await client.query<InventoryInstanceDbRow>(
      `SELECT * FROM inventory_instances
       WHERE character_id = $1 AND container_id = $2 AND slot_index = $3
       FOR UPDATE`,
      [input.characterId, container.id, input.toSlot]
    );
    const toItem = toItemRes.rows[0];

    let action: 'MOVED' | 'MERGED' | 'SWAPPED' = 'MOVED';

    if (!toItem) {
      // Empty target slot -> simple move
      await client.query(
        `UPDATE inventory_instances
         SET slot_index = $1, row_version = row_version + 1
         WHERE id = $2`,
        [input.toSlot, fromItem.id]
      );
      action = 'MOVED';
    } else {
      const def = getItemDefinition(fromItem.item_id);
      if (fromItem.item_id === toItem.item_id && def && def.stackable) {
        const space = def.maxStackSize - toItem.quantity;
        if (space > 0) {
          if (fromItem.quantity <= space) {
            // Full merge into toSlot!
            await client.query(
              `UPDATE inventory_instances
               SET quantity = quantity + $1, row_version = row_version + 1
               WHERE id = $2`,
              [fromItem.quantity, toItem.id]
            );
            await client.query(`DELETE FROM inventory_instances WHERE id = $1`, [fromItem.id]);
            action = 'MERGED';
          } else {
            // Partial merge: fill toSlot, leave remainder in fromSlot
            await client.query(
              `UPDATE inventory_instances
               SET quantity = $1, row_version = row_version + 1
               WHERE id = $2`,
              [def.maxStackSize, toItem.id]
            );
            await client.query(
              `UPDATE inventory_instances
               SET quantity = quantity - $1, row_version = row_version + 1
               WHERE id = $2`,
              [space, fromItem.id]
            );
            action = 'MERGED';
          }
        } else {
          // Target stack already full -> swap slots
          await client.query(
            `UPDATE inventory_instances SET slot_index = $1, row_version = row_version + 1 WHERE id = $2`,
            [input.toSlot, fromItem.id]
          );
          await client.query(
            `UPDATE inventory_instances SET slot_index = $1, row_version = row_version + 1 WHERE id = $2`,
            [input.fromSlot, toItem.id]
          );
          action = 'SWAPPED';
        }
      } else {
        // Different items or non-stackable -> swap slots
        await client.query(
          `UPDATE inventory_instances SET slot_index = $1, row_version = row_version + 1 WHERE id = $2`,
          [input.toSlot, fromItem.id]
        );
        await client.query(
          `UPDATE inventory_instances SET slot_index = $1, row_version = row_version + 1 WHERE id = $2`,
          [input.fromSlot, toItem.id]
        );
        action = 'SWAPPED';
      }
    }

    // Record movement in audit log
    await client.query(
      `INSERT INTO inventory_movements (
         id, character_id, operation_type, operation_key, source_reference, item_id, quantity, created_at
       )
       VALUES ($1, $2, 'MOVE_ITEM', $3, $4, $5, $6, NOW())`,
      [
        randomUUID(),
        input.characterId,
        input.idempotencyKey,
        `${input.fromSlot}->${input.toSlot}`,
        fromItem.item_id,
        fromItem.quantity
      ]
    );

    await client.query('COMMIT');

    const inventory = await getCharacterInventory(pool, input.characterId);
    return {
      status: 'SUCCESS',
      action,
      inventory,
      idempotentReplay: false
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function splitInventoryStack(
  pool: pg.Pool,
  input: SplitInventoryStackInput
): Promise<SplitInventoryStackResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Idempotency check
    const replayRes = await client.query<{ id: string }>(
      `SELECT id FROM inventory_movements
       WHERE character_id = $1 AND operation_type = 'SPLIT_STACK' AND operation_key = $2
       LIMIT 1`,
      [input.characterId, input.idempotencyKey]
    );
    if (replayRes.rows[0]) {
      const inventory = await getCharacterInventory(client, input.characterId);
      await client.query('COMMIT');
      return {
        status: 'SUCCESS',
        inventory,
        idempotentReplay: true
      };
    }

    const container = await getOrCreateBackpackContainer(client, input.characterId);
    if (input.fromSlot < 0 || input.fromSlot >= container.slot_capacity) {
      await client.query('ROLLBACK');
      return { status: 'ITEM_NOT_FOUND' };
    }
    if (input.toSlot < 0 || input.toSlot >= container.slot_capacity) {
      await client.query('ROLLBACK');
      return { status: 'INVENTORY_FULL' };
    }

    const fromItemRes = await client.query<InventoryInstanceDbRow>(
      `SELECT * FROM inventory_instances
       WHERE character_id = $1 AND container_id = $2 AND slot_index = $3
       FOR UPDATE`,
      [input.characterId, container.id, input.fromSlot]
    );
    const fromItem = fromItemRes.rows[0];
    if (!fromItem) {
      await client.query('ROLLBACK');
      return { status: 'ITEM_NOT_FOUND' };
    }

    const def = getItemDefinition(fromItem.item_id);
    if (!def || !def.stackable) {
      await client.query('ROLLBACK');
      return { status: 'STACK_INCOMPATIBLE' };
    }

    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity >= fromItem.quantity) {
      await client.query('ROLLBACK');
      return { status: 'INVALID_QUANTITY' };
    }

    const toItemRes = await client.query<InventoryInstanceDbRow>(
      `SELECT * FROM inventory_instances
       WHERE character_id = $1 AND container_id = $2 AND slot_index = $3
       FOR UPDATE`,
      [input.characterId, container.id, input.toSlot]
    );
    if (toItemRes.rows[0]) {
      await client.query('ROLLBACK');
      return { status: 'INVENTORY_FULL' };
    }

    // Split stack: decrease source quantity, create new row at toSlot
    await client.query(
      `UPDATE inventory_instances
       SET quantity = quantity - $1, row_version = row_version + 1
       WHERE id = $2`,
      [input.quantity, fromItem.id]
    );

    await client.query(
      `INSERT INTO inventory_instances (
         id, character_id, container_id, slot_index, item_id, quantity, metadata, item_version, row_version, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, 1, 1, NOW())`,
      [randomUUID(), input.characterId, container.id, input.toSlot, fromItem.item_id, input.quantity]
    );

    await client.query(
      `INSERT INTO inventory_movements (
         id, character_id, operation_type, operation_key, source_reference, item_id, quantity, created_at
       )
       VALUES ($1, $2, 'SPLIT_STACK', $3, $4, $5, $6, NOW())`,
      [
        randomUUID(),
        input.characterId,
        input.idempotencyKey,
        `${input.fromSlot}->${input.toSlot}`,
        fromItem.item_id,
        input.quantity
      ]
    );

    await client.query('COMMIT');

    const inventory = await getCharacterInventory(pool, input.characterId);
    return {
      status: 'SUCCESS',
      inventory,
      idempotentReplay: false
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore
    }
    throw err;
  } finally {
    client.release();
  }
}
