import { randomUUID } from 'node:crypto';
import {
  type CharacterEquipmentResponseDto,
  type CharacterHuntRewardItemDto,
  type CharacterInventoryResponseDto,
  type EquipmentSlotDto,
  type EquippedItemSlotDto,
  type InventoryContainerDto,
  type InventorySlotItemDto,
  type ItemRarityDto,
  type VocationDto
} from '@tibia-idle/contracts';
import {
  calculateCharacterCarriedWeight,
  calculateCharacterMaxCapacity,
  calculateEffectiveCombatStats,
  calculateInventoryCapacity,
  EQUIPMENT_INDEX_TO_SLOT,
  EQUIPMENT_SLOT_INDICES,
  getItemDefinition
} from '@tibia-idle/domain';
import type pg from 'pg';

export interface InventoryContainerDbRow {
  id: string;
  character_id: string;
  container_type: 'backpack' | 'equipment';
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
  | { readonly status: 'IDEMPOTENCY_KEY_CONFLICT' }
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
  | { readonly status: 'SLOT_OUT_OF_BOUNDS' }
  | { readonly status: 'CAPACITY_EXCEEDED' }
  | { readonly status: 'IDEMPOTENCY_KEY_CONFLICT' }
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
  | { readonly status: 'SLOT_OUT_OF_BOUNDS' }
  | { readonly status: 'IDEMPOTENCY_KEY_CONFLICT' }
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
    equipmentSlot: def.equipmentSlot,
    requiredLevel: def.requiredLevel,
    allowedVocations: def.allowedVocations ? [...def.allowedVocations] : undefined,
    combatBonuses: def.combatBonuses,
    rowVersion: row.row_version
  };
}

async function withTransactionRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: unknown) {
      attempt++;
      const code = (err as { code?: string } | null)?.code;
      if (attempt <= maxRetries && (code === '40P01' || code === '40001')) {
        await new Promise((resolve) =>
          setTimeout(resolve, 10 * attempt + Math.floor(Math.random() * 20))
        );
        continue;
      }
      throw err;
    }
  }
}

async function getOrCreateBackpackContainer(
  client: pg.PoolClient | pg.Pool,
  characterId: string,
  forUpdate = false
): Promise<InventoryContainerDbRow> {
  const query = `SELECT * FROM inventory_containers WHERE character_id = $1 AND container_type = 'backpack' ${
    forUpdate ? 'FOR UPDATE' : ''
  } LIMIT 1`;
  const selectRes = await client.query<InventoryContainerDbRow>(query, [characterId]);
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

export async function getOrCreateEquipmentContainer(
  client: pg.PoolClient | pg.Pool,
  characterId: string,
  forUpdate = false
): Promise<InventoryContainerDbRow> {
  const query = `SELECT * FROM inventory_containers WHERE character_id = $1 AND container_type = 'equipment' ${
    forUpdate ? 'FOR UPDATE' : ''
  } LIMIT 1`;
  const selectRes = await client.query<InventoryContainerDbRow>(query, [characterId]);
  if (selectRes.rows[0]) {
    return selectRes.rows[0];
  }

  const insertRes = await client.query<InventoryContainerDbRow>(
    `INSERT INTO inventory_containers (
       id, character_id, container_type, slot_capacity, row_version, created_at
     )
     VALUES ($1, $2, 'equipment', 9, 1, NOW())
     ON CONFLICT (character_id, container_type) DO UPDATE
       SET row_version = inventory_containers.row_version
     RETURNING *`,
    [randomUUID(), characterId]
  );
  const row = insertRes.rows[0];
  if (!row) {
    throw new Error('Failed to create or retrieve equipment container');
  }
  return row;
}

export async function getCharacterContainers(
  pool: pg.Pool,
  characterId: string
): Promise<readonly InventoryContainerDto[]> {
  const backpack = await getOrCreateBackpackContainer(pool, characterId);
  const equipment = await getOrCreateEquipmentContainer(pool, characterId);

  const countsRes = await pool.query<{ container_id: string; count: string }>(
    `SELECT container_id, count(*) FROM inventory_instances WHERE character_id = $1 GROUP BY container_id`,
    [characterId]
  );
  const countsMap = new Map<string, number>();
  for (const row of countsRes.rows) {
    countsMap.set(row.container_id, Number(row.count));
  }

  return [
    {
      id: backpack.id,
      characterId: backpack.character_id,
      containerType: 'backpack',
      slotCapacity: backpack.slot_capacity,
      occupiedSlots: countsMap.get(backpack.id) ?? 0,
      rowVersion: backpack.row_version
    },
    {
      id: equipment.id,
      characterId: equipment.character_id,
      containerType: 'equipment',
      slotCapacity: equipment.slot_capacity,
      occupiedSlots: countsMap.get(equipment.id) ?? 0,
      rowVersion: equipment.row_version
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

  const eqContainer = await getOrCreateEquipmentContainer(pool, characterId);
  const eqItemsRes = await pool.query<{ item_id: string; quantity: number }>(
    `SELECT item_id, quantity FROM inventory_instances
     WHERE character_id = $1 AND container_id = $2`,
    [characterId, eqContainer.id]
  );
  const equippedItems = eqItemsRes.rows.map((r) => ({ itemId: r.item_id, quantity: r.quantity }));

  const capacity = calculateInventoryCapacity(
    charRow.vocation,
    charRow.level,
    slots,
    equippedItems,
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

export async function getCharacterEquipment(
  pool: pg.Pool | pg.PoolClient,
  characterId: string
): Promise<CharacterEquipmentResponseDto> {
  const charRes = await pool.query<{ vocation: VocationDto; level: number }>(
    `SELECT vocation, level FROM characters WHERE id = $1 LIMIT 1`,
    [characterId]
  );
  const charRow = charRes.rows[0];
  if (!charRow) {
    throw new Error(`Character '${characterId}' not found`);
  }

  const activeHuntRes = await pool.query<{ id: string }>(
    `SELECT id FROM hunts WHERE character_id = $1 AND status IN ('ACTIVE', 'STOP_CONTINUATION_REQUIRED') LIMIT 1`,
    [characterId]
  );
  const activeHuntLocked = (activeHuntRes.rowCount ?? 0) > 0;

  const container = await getOrCreateEquipmentContainer(pool, characterId);
  const itemsRes = await pool.query<InventoryInstanceDbRow>(
    `SELECT * FROM inventory_instances
     WHERE character_id = $1 AND container_id = $2
     ORDER BY slot_index ASC`,
    [characterId, container.id]
  );

  const slotMap: Record<EquipmentSlotDto, EquippedItemSlotDto | null> = {
    helmet: null,
    amulet: null,
    weapon: null,
    armor: null,
    shield: null,
    ring: null,
    legs: null,
    boots: null,
    ammunition: null
  };

  const equippedItemsList: { itemId: string; quantity: number }[] = [];
  let totalEquipmentWeight = 0;

  for (const row of itemsRes.rows) {
    const slotName = EQUIPMENT_INDEX_TO_SLOT[row.slot_index];
    if (!slotName) continue;
    const def = getItemDefinition(row.item_id);
    if (!def) continue;

    const slotDto: EquippedItemSlotDto = {
      slot: slotName,
      instanceId: row.id,
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
      equipmentSlot: slotName,
      requiredLevel: def.requiredLevel,
      allowedVocations: def.allowedVocations ? [...def.allowedVocations] : undefined,
      combatBonuses: def.combatBonuses,
      rowVersion: row.row_version
    };

    slotMap[slotName] = slotDto;
    equippedItemsList.push({ itemId: row.item_id, quantity: row.quantity });
    totalEquipmentWeight += slotDto.totalWeight;
  }

  const stats = calculateEffectiveCombatStats(charRow, equippedItemsList);

  return {
    characterId,
    slots: slotMap,
    stats,
    activeHuntLocked,
    totalEquipmentWeight
  };
}

export async function claimHuntReward(
  pool: pg.Pool,
  input: ClaimHuntRewardInput
): Promise<ClaimHuntRewardResult> {
  return withTransactionRetry(async () => {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');

      // 1. Uniform lock order: Lock character first
      const charRes = await client.query<{ vocation: VocationDto; level: number }>(
        `SELECT vocation, level FROM characters WHERE id = $1 FOR UPDATE`,
        [input.characterId]
      );
      const charRow = charRes.rows[0];
      if (!charRow) {
        await client.query('ROLLBACK');
        return { status: 'FORBIDDEN' };
      }

      // 2. Lock backpack container
      const container = await getOrCreateBackpackContainer(client, input.characterId, true);

      // 3. Idempotency replay check with canonical payload validation
      const replayRes = await client.query<{
        id: string;
        item_id: string;
        quantity: number;
        source_reference: string | null;
      }>(
        `SELECT id, item_id, quantity, source_reference
         FROM inventory_movements
         WHERE character_id = $1 AND operation_type = 'CLAIM_HUNT_REWARD' AND operation_key = $2
         LIMIT 1`,
        [input.characterId, input.idempotencyKey]
      );

      if (replayRes.rows[0]) {
        const movement = replayRes.rows[0];
        // Canonical payload validation: does this movement refer to the exact same rewardId?
        if (movement.source_reference !== input.rewardId) {
          await client.query('ROLLBACK');
          return { status: 'IDEMPOTENCY_KEY_CONFLICT' };
        }

        // Fetch the actual claimed reward row
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
        if (!rewardRow || rewardRow.ownership_state !== 'CLAIMED') {
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
          claimedAtIso: rewardRow.claimed_at
            ? rewardRow.claimed_at.toISOString()
            : new Date().toISOString(),
          createdAtIso: rewardRow.created_at.toISOString()
        };

        const inventory = await getCharacterInventory(client, input.characterId);
        await client.query('COMMIT');
        committed = true;
        return {
          status: 'SUCCESS',
          claimedItem,
          inventory,
          idempotentReplay: true
        };
      }

      // 4. Lock hunt reward row FOR UPDATE
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

      // 5. Lock current items in backpack in slot_index ASC order
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

    // 5. Weight & capacity verification (including equipment)
    const eqContainer = await getOrCreateEquipmentContainer(client, input.characterId);
    const eqItemsRes = await client.query<{ item_id: string; quantity: number }>(
      `SELECT item_id, quantity FROM inventory_instances
       WHERE character_id = $1 AND container_id = $2`,
      [input.characterId, eqContainer.id]
    );
    const maxCapacity = calculateCharacterMaxCapacity(charRow.vocation, charRow.level);
    const currentWeight = calculateCharacterCarriedWeight(
      existingItems.map((i) => ({ itemId: i.item_id, quantity: i.quantity })),
      eqItemsRes.rows.map((r) => ({ itemId: r.item_id, quantity: r.quantity }))
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
      committed = true;

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

      // Pool size 1 safe: use client after COMMIT
      const inventory = await getCharacterInventory(client, input.characterId);

      return {
        status: 'SUCCESS',
        claimedItem,
        inventory,
        idempotentReplay: false
      };
    } catch (err) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore rollback errors on broken connection
        }
      }
      throw err;
    } finally {
      client.release();
    }
  });
}

export async function moveInventoryItem(
  pool: pg.Pool,
  input: MoveInventoryItemInput
): Promise<MoveInventoryItemResult> {
  return withTransactionRetry(async () => {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');

      // 1. Uniform lock order: Lock character first
      const charRes = await client.query<{ id: string }>(
        `SELECT id FROM characters WHERE id = $1 FOR UPDATE`,
        [input.characterId]
      );
      if (!charRes.rows[0]) {
        await client.query('ROLLBACK');
        return { status: 'FORBIDDEN' };
      }

      // 2. Lock container
      const container = await getOrCreateBackpackContainer(client, input.characterId, true);
      if (input.containerId && input.containerId !== container.id) {
        await client.query('ROLLBACK');
        return { status: 'FORBIDDEN' };
      }

      // 3. Idempotency check with canonical payload validation
      const replayRes = await client.query<{
        id: string;
        source_reference: string | null;
        item_id: string;
        quantity: number;
      }>(
        `SELECT id, source_reference, item_id, quantity
         FROM inventory_movements
         WHERE character_id = $1 AND operation_type = 'MOVE_ITEM' AND operation_key = $2
         LIMIT 1`,
        [input.characterId, input.idempotencyKey]
      );

      if (replayRes.rows[0]) {
        const rawRef = replayRes.rows[0].source_reference ?? '';
        let matches = false;
        let action: 'MOVED' | 'MERGED' | 'SWAPPED' = 'MOVED';

        if (rawRef.startsWith('{')) {
          try {
            const payload = JSON.parse(rawRef) as {
              containerId?: string;
              fromSlot?: number;
              toSlot?: number;
              action?: 'MOVED' | 'MERGED' | 'SWAPPED';
            };
            if (
              payload.fromSlot === input.fromSlot &&
              payload.toSlot === input.toSlot &&
              (!input.containerId || payload.containerId === input.containerId)
            ) {
              matches = true;
              if (payload.action) {
                action = payload.action;
              }
            }
          } catch {
            matches = false;
          }
        } else if (rawRef === `${input.fromSlot}->${input.toSlot}`) {
          // Legacy string format
          matches = true;
          action = 'MOVED';
        }

        if (!matches) {
          await client.query('ROLLBACK');
          return { status: 'IDEMPOTENCY_KEY_CONFLICT' };
        }

        const inventory = await getCharacterInventory(client, input.characterId);
        await client.query('COMMIT');
        committed = true;
        return {
          status: 'SUCCESS',
          action,
          inventory,
          idempotentReplay: true
        };
      }

      // Slot bounds check
      if (input.fromSlot < 0 || input.fromSlot >= container.slot_capacity) {
        await client.query('ROLLBACK');
        return { status: 'SLOT_OUT_OF_BOUNDS' };
      }
      if (input.toSlot < 0 || input.toSlot >= container.slot_capacity) {
        await client.query('ROLLBACK');
        return { status: 'SLOT_OUT_OF_BOUNDS' };
      }

      if (input.fromSlot === input.toSlot) {
        const inventory = await getCharacterInventory(client, input.characterId);
        await client.query('COMMIT');
        committed = true;
        return {
          status: 'SUCCESS',
          action: 'MOVED',
          inventory,
          idempotentReplay: false
        };
      }

      // 4. Deterministic lock: lock both slots in slot_index ASC order
      const itemsRes = await client.query<InventoryInstanceDbRow>(
        `SELECT * FROM inventory_instances
         WHERE character_id = $1 AND container_id = $2 AND slot_index IN ($3, $4)
         ORDER BY slot_index ASC
         FOR UPDATE`,
        [input.characterId, container.id, input.fromSlot, input.toSlot]
      );

      const fromItem = itemsRes.rows.find((i) => i.slot_index === input.fromSlot);
      const toItem = itemsRes.rows.find((i) => i.slot_index === input.toSlot);

      if (!fromItem) {
        await client.query('ROLLBACK');
        return { status: 'ITEM_NOT_FOUND' };
      }

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

      // Record movement in audit log with canonical JSON payload including action
      await client.query(
        `INSERT INTO inventory_movements (
           id, character_id, operation_type, operation_key, source_reference, item_id, quantity, created_at
         )
         VALUES ($1, $2, 'MOVE_ITEM', $3, $4, $5, $6, NOW())`,
        [
          randomUUID(),
          input.characterId,
          input.idempotencyKey,
          JSON.stringify({
            containerId: container.id,
            fromSlot: input.fromSlot,
            toSlot: input.toSlot,
            action
          }),
          fromItem.item_id,
          fromItem.quantity
        ]
      );

      await client.query('COMMIT');
      committed = true;

      // Pool size 1 safe: use client after COMMIT
      const inventory = await getCharacterInventory(client, input.characterId);
      return {
        status: 'SUCCESS',
        action,
        inventory,
        idempotentReplay: false
      };
    } catch (err) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore
        }
      }
      throw err;
    } finally {
      client.release();
    }
  });
}

export async function splitInventoryStack(
  pool: pg.Pool,
  input: SplitInventoryStackInput
): Promise<SplitInventoryStackResult> {
  return withTransactionRetry(async () => {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');

      // 1. Uniform lock order: Lock character first
      const charRes = await client.query<{ id: string }>(
        `SELECT id FROM characters WHERE id = $1 FOR UPDATE`,
        [input.characterId]
      );
      if (!charRes.rows[0]) {
        await client.query('ROLLBACK');
        return { status: 'FORBIDDEN' };
      }

      // 2. Lock container
      const container = await getOrCreateBackpackContainer(client, input.characterId, true);
      if (input.containerId && input.containerId !== container.id) {
        await client.query('ROLLBACK');
        return { status: 'FORBIDDEN' };
      }

      // 3. Idempotency check with canonical payload validation
      const replayRes = await client.query<{
        id: string;
        source_reference: string | null;
        quantity: number;
      }>(
        `SELECT id, source_reference, quantity
         FROM inventory_movements
         WHERE character_id = $1 AND operation_type = 'SPLIT_STACK' AND operation_key = $2
         LIMIT 1`,
        [input.characterId, input.idempotencyKey]
      );

      if (replayRes.rows[0]) {
        const rawRef = replayRes.rows[0].source_reference ?? '';
        let matches = false;

        if (rawRef.startsWith('{')) {
          try {
            const payload = JSON.parse(rawRef) as {
              containerId?: string;
              fromSlot?: number;
              toSlot?: number;
              quantity?: number;
            };
            if (
              payload.fromSlot === input.fromSlot &&
              payload.toSlot === input.toSlot &&
              payload.quantity === input.quantity &&
              (!input.containerId || payload.containerId === input.containerId)
            ) {
              matches = true;
            }
          } catch {
            matches = false;
          }
        } else if (
          rawRef === `${input.fromSlot}->${input.toSlot}` &&
          replayRes.rows[0].quantity === input.quantity
        ) {
          // Legacy string format
          matches = true;
        }

        if (!matches) {
          await client.query('ROLLBACK');
          return { status: 'IDEMPOTENCY_KEY_CONFLICT' };
        }

        const inventory = await getCharacterInventory(client, input.characterId);
        await client.query('COMMIT');
        committed = true;
        return {
          status: 'SUCCESS',
          inventory,
          idempotentReplay: true
        };
      }

      // Slot bounds check
      if (input.fromSlot < 0 || input.fromSlot >= container.slot_capacity) {
        await client.query('ROLLBACK');
        return { status: 'SLOT_OUT_OF_BOUNDS' };
      }
      if (input.toSlot < 0 || input.toSlot >= container.slot_capacity) {
        await client.query('ROLLBACK');
        return { status: 'SLOT_OUT_OF_BOUNDS' };
      }
      if (input.fromSlot === input.toSlot) {
        await client.query('ROLLBACK');
        return { status: 'INVALID_QUANTITY' };
      }
      if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
        await client.query('ROLLBACK');
        return { status: 'INVALID_QUANTITY' };
      }

      // 4. Deterministic lock: lock both slots in slot_index ASC order
      const itemsRes = await client.query<InventoryInstanceDbRow>(
        `SELECT * FROM inventory_instances
         WHERE character_id = $1 AND container_id = $2 AND slot_index IN ($3, $4)
         ORDER BY slot_index ASC
         FOR UPDATE`,
        [input.characterId, container.id, input.fromSlot, input.toSlot]
      );

      const fromItem = itemsRes.rows.find((i) => i.slot_index === input.fromSlot);
      const toItem = itemsRes.rows.find((i) => i.slot_index === input.toSlot);

      if (!fromItem) {
        await client.query('ROLLBACK');
        return { status: 'ITEM_NOT_FOUND' };
      }

      if (toItem) {
        await client.query('ROLLBACK');
        return { status: 'INVENTORY_FULL' };
      }

      const itemDef = getItemDefinition(fromItem.item_id);
      if (!itemDef || !itemDef.stackable) {
        await client.query('ROLLBACK');
        return { status: 'STACK_INCOMPATIBLE' };
      }

      if (input.quantity >= fromItem.quantity) {
        await client.query('ROLLBACK');
        return { status: 'INVALID_QUANTITY' };
      }

      // Deduct from source stack
      const newSourceQty = fromItem.quantity - input.quantity;
      await client.query(
        `UPDATE inventory_instances
         SET quantity = $1, row_version = row_version + 1
         WHERE id = $2`,
        [newSourceQty, fromItem.id]
      );

      // Create new instance at target slot
      await client.query(
        `INSERT INTO inventory_instances (
           id, character_id, container_id, slot_index, item_id, quantity, metadata, item_version, row_version, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, 1, 1, NOW())`,
        [
          randomUUID(),
          input.characterId,
          container.id,
          input.toSlot,
          fromItem.item_id,
          input.quantity
        ]
      );

      // Record movement in audit log with canonical JSON payload
      await client.query(
        `INSERT INTO inventory_movements (
           id, character_id, operation_type, operation_key, source_reference, item_id, quantity, created_at
         )
         VALUES ($1, $2, 'SPLIT_STACK', $3, $4, $5, $6, NOW())`,
        [
          randomUUID(),
          input.characterId,
          input.idempotencyKey,
          JSON.stringify({
            containerId: container.id,
            fromSlot: input.fromSlot,
            toSlot: input.toSlot,
            quantity: input.quantity
          }),
          fromItem.item_id,
          input.quantity
        ]
      );

      await client.query('COMMIT');
      committed = true;

      // Pool size 1 safe: use client after COMMIT
      const inventory = await getCharacterInventory(client, input.characterId);
      return {
        status: 'SUCCESS',
        inventory,
        idempotentReplay: false
      };
    } catch (err) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore
        }
      }
      throw err;
    } finally {
      client.release();
    }
  });
}

export interface EquipInventoryItemInput {
  readonly characterId: string;
  readonly backpackSlot: number;
  readonly equipmentSlot: EquipmentSlotDto;
  readonly idempotencyKey: string;
}

export type EquipInventoryItemResult =
  | {
      readonly status: 'SUCCESS';
      readonly action: 'EQUIPPED' | 'SWAPPED';
      readonly equipment: CharacterEquipmentResponseDto;
      readonly inventory: CharacterInventoryResponseDto;
      readonly idempotentReplay: boolean;
    }
  | {
      readonly status:
        | 'CHARACTER_NOT_FOUND'
        | 'ACTIVE_HUNT_LOCKED'
        | 'SLOT_EMPTY'
        | 'NOT_EQUIPMENT'
        | 'SLOT_MISMATCH'
        | 'LEVEL_TOO_LOW'
        | 'VOCATION_INCOMPATIBLE'
        | 'SLOT_OUT_OF_BOUNDS'
        | 'IDEMPOTENCY_KEY_CONFLICT';
    };

export async function equipInventoryItem(
  pool: pg.Pool,
  input: EquipInventoryItemInput
): Promise<EquipInventoryItemResult> {
  return withTransactionRetry(async () => {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');

      // 1. Lock character
      const charRes = await client.query<{ id: string; vocation: VocationDto; level: number }>(
        `SELECT id, vocation, level FROM characters WHERE id = $1 FOR UPDATE`,
        [input.characterId]
      );
      const charRow = charRes.rows[0];
      if (!charRow) {
        await client.query('ROLLBACK');
        return { status: 'CHARACTER_NOT_FOUND' };
      }

      // 2. Idempotency check with canonical payload
      const expectedPayload = JSON.stringify({
        backpackSlot: input.backpackSlot,
        equipmentSlot: input.equipmentSlot
      });

      const movementRes = await client.query<{
        id: string;
        operation_type: 'EQUIP_ITEM' | 'SWAP_EQUIPMENT';
        source_reference: string | null;
      }>(
        `SELECT id, operation_type, source_reference FROM inventory_movements
         WHERE character_id = $1 AND operation_type IN ('EQUIP_ITEM', 'SWAP_EQUIPMENT') AND operation_key = $2`,
        [input.characterId, input.idempotencyKey]
      );

      const existingMovement = movementRes.rows[0];
      if (existingMovement) {
        const payloadMatch = existingMovement.source_reference === expectedPayload;
        if (!payloadMatch) {
          await client.query('ROLLBACK');
          return { status: 'IDEMPOTENCY_KEY_CONFLICT' };
        }

        await client.query('COMMIT');
        committed = true;
        const equipment = await getCharacterEquipment(client, input.characterId);
        const inventory = await getCharacterInventory(client, input.characterId);
        return {
          status: 'SUCCESS',
          action: existingMovement.operation_type === 'SWAP_EQUIPMENT' ? 'SWAPPED' : 'EQUIPPED',
          equipment,
          inventory,
          idempotentReplay: true
        };
      }

      // 3. Active hunt safety: only block NEW equip operations during ACTIVE or STOP_CONTINUATION_REQUIRED
      const activeHuntRes = await client.query<{ id: string }>(
        `SELECT id FROM hunts WHERE character_id = $1 AND status IN ('ACTIVE', 'STOP_CONTINUATION_REQUIRED') LIMIT 1`,
        [input.characterId]
      );
      if ((activeHuntRes.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return { status: 'ACTIVE_HUNT_LOCKED' };
      }

      // 4. Lock containers
      const backpack = await getOrCreateBackpackContainer(client, input.characterId, true);
      const equipment = await getOrCreateEquipmentContainer(client, input.characterId, true);

      // Validate backpackSlot bounds against container slot_capacity
      if (input.backpackSlot < 0 || input.backpackSlot >= backpack.slot_capacity) {
        await client.query('ROLLBACK');
        return { status: 'SLOT_OUT_OF_BOUNDS' };
      }

      // 5. Lock source item in backpack
      const sourceItemRes = await client.query<InventoryInstanceDbRow>(
        `SELECT * FROM inventory_instances
         WHERE character_id = $1 AND container_id = $2 AND slot_index = $3
         FOR UPDATE`,
        [input.characterId, backpack.id, input.backpackSlot]
      );
      const sourceItem = sourceItemRes.rows[0];
      if (!sourceItem) {
        await client.query('ROLLBACK');
        return { status: 'SLOT_EMPTY' };
      }

      const itemDef = getItemDefinition(sourceItem.item_id);
      if (!itemDef || itemDef.itemType !== 'equipment') {
        await client.query('ROLLBACK');
        return { status: 'NOT_EQUIPMENT' };
      }

      if (itemDef.equipmentSlot !== input.equipmentSlot) {
        await client.query('ROLLBACK');
        return { status: 'SLOT_MISMATCH' };
      }

      const reqLevel = itemDef.requiredLevel ?? 1;
      if (charRow.level < reqLevel) {
        await client.query('ROLLBACK');
        return { status: 'LEVEL_TOO_LOW' };
      }

      if (itemDef.allowedVocations && !itemDef.allowedVocations.includes(charRow.vocation)) {
        await client.query('ROLLBACK');
        return { status: 'VOCATION_INCOMPATIBLE' };
      }

      // 6. Lock target slot in equipment
      const targetEqIndex = EQUIPMENT_SLOT_INDICES[input.equipmentSlot];
      const targetItemRes = await client.query<InventoryInstanceDbRow>(
        `SELECT * FROM inventory_instances
         WHERE character_id = $1 AND container_id = $2 AND slot_index = $3
         FOR UPDATE`,
        [input.characterId, equipment.id, targetEqIndex]
      );
      const existingEqItem = targetItemRes.rows[0];

      let action: 'EQUIPPED' | 'SWAPPED';

      if (!existingEqItem) {
        // Move instance from backpack to equipment
        await client.query(
          `UPDATE inventory_instances
           SET container_id = $1, slot_index = $2, row_version = row_version + 1
           WHERE id = $3`,
          [equipment.id, targetEqIndex, sourceItem.id]
        );

        await client.query(
          `INSERT INTO inventory_movements (
             id, character_id, operation_type, operation_key, source_reference, item_id, quantity, created_at
           )
           VALUES ($1, $2, 'EQUIP_ITEM', $3, $4, $5, 1, NOW())`,
          [randomUUID(), input.characterId, input.idempotencyKey, expectedPayload, sourceItem.item_id]
        );
        action = 'EQUIPPED';
      } else {
        // Swap: move existing item to backpackSlot, and source item to targetEqIndex
        await client.query(
          `UPDATE inventory_instances
           SET container_id = $1, slot_index = $2, row_version = row_version + 1
           WHERE id = $3`,
          [backpack.id, input.backpackSlot, existingEqItem.id]
        );

        await client.query(
          `UPDATE inventory_instances
           SET container_id = $1, slot_index = $2, row_version = row_version + 1
           WHERE id = $3`,
          [equipment.id, targetEqIndex, sourceItem.id]
        );

        await client.query(
          `INSERT INTO inventory_movements (
             id, character_id, operation_type, operation_key, source_reference, item_id, quantity, created_at
           )
           VALUES ($1, $2, 'SWAP_EQUIPMENT', $3, $4, $5, 1, NOW())`,
          [randomUUID(), input.characterId, input.idempotencyKey, expectedPayload, sourceItem.item_id]
        );
        action = 'SWAPPED';
      }

      await client.query('COMMIT');
      committed = true;

      const updatedEquipment = await getCharacterEquipment(client, input.characterId);
      const updatedInventory = await getCharacterInventory(client, input.characterId);

      return {
        status: 'SUCCESS',
        action,
        equipment: updatedEquipment,
        inventory: updatedInventory,
        idempotentReplay: false
      };
    } catch (err) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore
        }
      }
      throw err;
    } finally {
      client.release();
    }
  });
}

export interface UnequipInventoryItemInput {
  readonly characterId: string;
  readonly equipmentSlot: EquipmentSlotDto;
  readonly targetBackpackSlot?: number | undefined;
  readonly idempotencyKey: string;
}

export type UnequipInventoryItemResult =
  | {
      readonly status: 'SUCCESS';
      readonly action: 'UNEQUIPPED';
      readonly equipment: CharacterEquipmentResponseDto;
      readonly inventory: CharacterInventoryResponseDto;
      readonly idempotentReplay: boolean;
    }
  | {
      readonly status:
        | 'CHARACTER_NOT_FOUND'
        | 'ACTIVE_HUNT_LOCKED'
        | 'SLOT_EMPTY'
        | 'BACKPACK_FULL'
        | 'TARGET_SLOT_OCCUPIED'
        | 'SLOT_OUT_OF_BOUNDS'
        | 'IDEMPOTENCY_KEY_CONFLICT';
    };

export async function unequipInventoryItem(
  pool: pg.Pool,
  input: UnequipInventoryItemInput
): Promise<UnequipInventoryItemResult> {
  return withTransactionRetry(async () => {
    const client = await pool.connect();
    let committed = false;
    try {
      await client.query('BEGIN');

      // 1. Lock character
      const charRes = await client.query<{ id: string; vocation: VocationDto; level: number }>(
        `SELECT id, vocation, level FROM characters WHERE id = $1 FOR UPDATE`,
        [input.characterId]
      );
      const charRow = charRes.rows[0];
      if (!charRow) {
        await client.query('ROLLBACK');
        return { status: 'CHARACTER_NOT_FOUND' };
      }

      // 2. Idempotency check with canonical payload
      const expectedPayload = JSON.stringify({
        equipmentSlot: input.equipmentSlot,
        targetBackpackSlot: input.targetBackpackSlot
      });

      const movementRes = await client.query<{
        id: string;
        operation_type: 'UNEQUIP_ITEM';
        source_reference: string | null;
      }>(
        `SELECT id, operation_type, source_reference FROM inventory_movements
         WHERE character_id = $1 AND operation_type = 'UNEQUIP_ITEM' AND operation_key = $2`,
        [input.characterId, input.idempotencyKey]
      );

      const existingMovement = movementRes.rows[0];
      if (existingMovement) {
        const payloadMatch = existingMovement.source_reference === expectedPayload;
        if (!payloadMatch) {
          await client.query('ROLLBACK');
          return { status: 'IDEMPOTENCY_KEY_CONFLICT' };
        }

        await client.query('COMMIT');
        committed = true;
        const equipment = await getCharacterEquipment(client, input.characterId);
        const inventory = await getCharacterInventory(client, input.characterId);
        return {
          status: 'SUCCESS',
          action: 'UNEQUIPPED',
          equipment,
          inventory,
          idempotentReplay: true
        };
      }

      // 3. Active hunt safety: only block NEW unequip operations during ACTIVE or STOP_CONTINUATION_REQUIRED
      const activeHuntRes = await client.query<{ id: string }>(
        `SELECT id FROM hunts WHERE character_id = $1 AND status IN ('ACTIVE', 'STOP_CONTINUATION_REQUIRED') LIMIT 1`,
        [input.characterId]
      );
      if ((activeHuntRes.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return { status: 'ACTIVE_HUNT_LOCKED' };
      }

      // 4. Lock containers
      const backpack = await getOrCreateBackpackContainer(client, input.characterId, true);
      const equipment = await getOrCreateEquipmentContainer(client, input.characterId, true);

      // Validate targetBackpackSlot bounds against container slot_capacity
      if (input.targetBackpackSlot !== undefined) {
        if (input.targetBackpackSlot < 0 || input.targetBackpackSlot >= backpack.slot_capacity) {
          await client.query('ROLLBACK');
          return { status: 'SLOT_OUT_OF_BOUNDS' };
        }
      }

      // 5. Lock item in equipment container
      const eqIndex = EQUIPMENT_SLOT_INDICES[input.equipmentSlot];
      const eqItemRes = await client.query<InventoryInstanceDbRow>(
        `SELECT * FROM inventory_instances
         WHERE character_id = $1 AND container_id = $2 AND slot_index = $3
         FOR UPDATE`,
        [input.characterId, equipment.id, eqIndex]
      );
      const eqItem = eqItemRes.rows[0];
      if (!eqItem) {
        await client.query('ROLLBACK');
        return { status: 'SLOT_EMPTY' };
      }

      // 6. Find target backpack slot
      let targetSlot: number;
      if (input.targetBackpackSlot !== undefined) {
        const occupiedRes = await client.query<{ id: string }>(
          `SELECT id FROM inventory_instances
           WHERE character_id = $1 AND container_id = $2 AND slot_index = $3
           FOR UPDATE`,
          [input.characterId, backpack.id, input.targetBackpackSlot]
        );
        if (occupiedRes.rows[0]) {
          await client.query('ROLLBACK');
          return { status: 'TARGET_SLOT_OCCUPIED' };
        }
        targetSlot = input.targetBackpackSlot;
      } else {
        const occupiedSlotsRes = await client.query<{ slot_index: number }>(
          `SELECT slot_index FROM inventory_instances
           WHERE character_id = $1 AND container_id = $2
           ORDER BY slot_index ASC
           FOR UPDATE`,
          [input.characterId, backpack.id]
        );
        const occupiedSet = new Set(occupiedSlotsRes.rows.map((r) => r.slot_index));
        let freeSlot = -1;
        for (let i = 0; i < backpack.slot_capacity; i++) {
          if (!occupiedSet.has(i)) {
            freeSlot = i;
            break;
          }
        }
        if (freeSlot === -1) {
          await client.query('ROLLBACK');
          return { status: 'BACKPACK_FULL' };
        }
        targetSlot = freeSlot;
      }

      // 7. Move instance from equipment to backpack
      await client.query(
        `UPDATE inventory_instances
         SET container_id = $1, slot_index = $2, row_version = row_version + 1
         WHERE id = $3`,
        [backpack.id, targetSlot, eqItem.id]
      );

      // 8. Record movement
      await client.query(
        `INSERT INTO inventory_movements (
           id, character_id, operation_type, operation_key, source_reference, item_id, quantity, created_at
         )
         VALUES ($1, $2, 'UNEQUIP_ITEM', $3, $4, $5, 1, NOW())`,
        [randomUUID(), input.characterId, input.idempotencyKey, expectedPayload, eqItem.item_id]
      );

      await client.query('COMMIT');
      committed = true;

      const updatedEquipment = await getCharacterEquipment(client, input.characterId);
      const updatedInventory = await getCharacterInventory(client, input.characterId);

      return {
        status: 'SUCCESS',
        action: 'UNEQUIPPED',
        equipment: updatedEquipment,
        inventory: updatedInventory,
        idempotentReplay: false
      };
    } catch (err) {
      if (!committed) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore
        }
      }
      throw err;
    } finally {
      client.release();
    }
  });
}
