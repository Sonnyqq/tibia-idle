import { randomUUID } from 'node:crypto';
import {
  type BuyNpcProductResponseDto,
  type CharacterInventoryResponseDto,
  type NpcTransactionDto,
  type SellNpcItemResponseDto
} from '@tibia-idle/contracts';
import {
  calculateNpcBuyCost,
  calculateNpcSellPayout,
  DEFAULT_NPC_MERCHANT,
  getNpcBuyOffer,
  getNpcSellOffer,
  MAX_POTIONS_PER_CHARACTER,
  MAX_POTIONS_PER_TRANSACTION,
  MAX_SAFE_GOLD_TRANSACTION
} from '@tibia-idle/domain';
import type pg from 'pg';
import { getCharacterInventory } from './inventory-repository.js';

export class NpcShopError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'NpcShopError';
  }
}

export interface BuyNpcProductInput {
  readonly characterId: string;
  readonly npcId?: string | undefined;
  readonly offerId: string;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly nowIso?: string | undefined;
}

export interface SellNpcItemInput {
  readonly characterId: string;
  readonly npcId?: string | undefined;
  readonly itemId: string;
  readonly instanceId?: string | undefined;
  readonly slotIndex?: number | undefined;
  readonly quantity: number;
  readonly idempotencyKey: string;
  readonly nowIso?: string | undefined;
}

interface CharacterRow {
  id: string;
  user_id: string;
  gold: string | number;
  hp_potions: number;
  mp_potions: number;
}

interface NpcTransactionDbRow {
  id: string;
  character_id: string;
  npc_id: string;
  operation_type: 'BUY' | 'SELL';
  operation_key: string;
  canonical_payload: Record<string, unknown>;
  product_id: string;
  quantity: number;
  unit_price: number;
  total_gold: string | number;
  created_at: Date;
}

interface InventoryInstanceDbRow {
  id: string;
  character_id: string;
  container_id: string;
  slot_index: number;
  item_id: string;
  quantity: number;
  row_version: number;
}

interface ContainerDbRow {
  id: string;
  slot_capacity: number;
}

export async function buyNpcProduct(
  pool: pg.Pool,
  input: BuyNpcProductInput
): Promise<BuyNpcProductResponseDto> {
  if (!input.characterId || !input.offerId || !input.idempotencyKey) {
    throw new NpcShopError('INVALID_INPUT', 'Missing required buy fields', 400);
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new NpcShopError('INVALID_QUANTITY', 'Quantity must be a positive integer', 400);
  }
  if (input.quantity > MAX_POTIONS_PER_TRANSACTION) {
    throw new NpcShopError(
      'POTION_LIMIT_EXCEEDED',
      `Quantity exceeds max potions per transaction (${MAX_POTIONS_PER_TRANSACTION})`,
      400
    );
  }

  const buyOffer = getNpcBuyOffer(input.offerId);
  if (!buyOffer || !buyOffer.enabled) {
    throw new NpcShopError('NPC_OFFER_NOT_FOUND', `Buy offer '${input.offerId}' not found`, 404);
  }

  const npcId = input.npcId ?? DEFAULT_NPC_MERCHANT.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock character
    const charRes = await client.query<CharacterRow>(
      `SELECT id, user_id, gold, hp_potions, mp_potions
       FROM characters
       WHERE id = $1
       FOR UPDATE`,
      [input.characterId]
    );
    const charRow = charRes.rows[0];
    if (!charRow) {
      throw new NpcShopError('CHARACTER_NOT_FOUND', `Character '${input.characterId}' not found`, 404);
    }

    // 2. Idempotency check against npc_transactions
    const existingTxRes = await client.query<NpcTransactionDbRow>(
      `SELECT * FROM npc_transactions WHERE character_id = $1 AND operation_key = $2 LIMIT 1`,
      [input.characterId, input.idempotencyKey]
    );
    const existingTx = existingTxRes.rows[0];
    if (existingTx) {
      if (
        existingTx.operation_type !== 'BUY' ||
        existingTx.product_id !== buyOffer.productId ||
        Number(existingTx.quantity) !== input.quantity
      ) {
        throw new NpcShopError(
          'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
          `Idempotency key '${input.idempotencyKey}' was already used for a different shop transaction`,
          409
        );
      }

      await client.query('COMMIT');
      const currentPotionCount =
        buyOffer.productId === 'health-potion'
          ? Number(charRow.hp_potions)
          : Number(charRow.mp_potions);

      return {
        characterId: input.characterId,
        productId: buyOffer.productId,
        quantity: Number(existingTx.quantity),
        unitPriceGold: Number(existingTx.unit_price),
        totalCostGold: Number(existingTx.total_gold),
        newGoldBalance: Number(charRow.gold),
        newPotionCount: currentPotionCount,
        idempotentReplay: true
      };
    }

    // 3. Active hunt check
    const activeHuntRes = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM hunts
       WHERE character_id = $1 AND status IN ('ACTIVE', 'STOP_CONTINUATION_REQUIRED')
       LIMIT 1`,
      [input.characterId]
    );
    if (activeHuntRes.rows.length > 0) {
      throw new NpcShopError(
        'ACTIVE_HUNT_LOCKED',
        'Shop operations are locked while a hunt is in progress',
        409
      );
    }

    // 4. Capacity and limits check
    const currentPotions =
      buyOffer.productId === 'health-potion'
        ? Number(charRow.hp_potions)
        : Number(charRow.mp_potions);
    if (currentPotions + input.quantity > MAX_POTIONS_PER_CHARACTER) {
      throw new NpcShopError(
        'POTION_LIMIT_EXCEEDED',
        `Potion capacity would exceed maximum allowed (${MAX_POTIONS_PER_CHARACTER})`,
        400
      );
    }

    // 5. Total cost and gold check
    const costResult = calculateNpcBuyCost(buyOffer.offerId, input.quantity);
    if (!costResult.ok) {
      throw new NpcShopError(costResult.reason, `Failed to calculate buy cost: ${costResult.reason}`, 400);
    }
    const totalCost = costResult.totalCostGold;
    const currentGold = Number(charRow.gold);
    if (currentGold < totalCost) {
      throw new NpcShopError(
        'INSUFFICIENT_GOLD',
        `Insufficient gold: required ${totalCost}, character has ${currentGold}`,
        400
      );
    }

    const newGold = currentGold - totalCost;
    const newHpPotions =
      buyOffer.productId === 'health-potion' ? currentPotions + input.quantity : Number(charRow.hp_potions);
    const newMpPotions =
      buyOffer.productId === 'mana-potion' ? currentPotions + input.quantity : Number(charRow.mp_potions);

    // 6. Update character
    await client.query(
      `UPDATE characters
       SET gold = $1,
           hp_potions = $2,
           mp_potions = $3,
           row_version = row_version + 1
       WHERE id = $4`,
      [newGold, newHpPotions, newMpPotions, input.characterId]
    );

    // 7. Record transaction and lines
    const txId = randomUUID();
    const lineId = randomUUID();
    const ledgerId = randomUUID();
    const createdAtIso = input.nowIso ?? new Date().toISOString();
    const canonicalPayload = {
      characterId: input.characterId,
      npcId,
      offerId: buyOffer.offerId,
      productId: buyOffer.productId,
      quantity: input.quantity,
      unitPriceGold: buyOffer.unitPriceGold,
      totalCostGold: totalCost
    };

    await client.query(
      `INSERT INTO npc_transactions (
         id, character_id, npc_id, operation_type, operation_key,
         canonical_payload, product_id, quantity, unit_price, total_gold, created_at
       )
       VALUES ($1, $2, $3, 'BUY', $4, $5, $6, $7, $8, $9, $10::timestamptz)`,
      [
        txId,
        input.characterId,
        npcId,
        input.idempotencyKey,
        JSON.stringify(canonicalPayload),
        buyOffer.productId,
        input.quantity,
        buyOffer.unitPriceGold,
        totalCost,
        createdAtIso
      ]
    );

    await client.query(
      `INSERT INTO npc_transaction_lines (
         id, transaction_id, line_index, product_id, quantity, unit_price, total_gold, created_at
       )
       VALUES ($1, $2, 0, $3, $4, $5, $6, $7::timestamptz)`,
      [lineId, txId, buyOffer.productId, input.quantity, buyOffer.unitPriceGold, totalCost, createdAtIso]
    );

    // 8. Record currency ledger DEBIT
    await client.query(
      `INSERT INTO currency_ledger (
         id, character_id, source_type, source_id, amount, balance_after, transaction_type, created_at
       )
       VALUES ($1, $2, 'NPC_PURCHASE', $3, $4, $5, 'DEBIT', $6::timestamptz)`,
      [ledgerId, input.characterId, txId, -totalCost, newGold, createdAtIso]
    );

    await client.query('COMMIT');

    return {
      characterId: input.characterId,
      productId: buyOffer.productId,
      quantity: input.quantity,
      unitPriceGold: buyOffer.unitPriceGold,
      totalCostGold: totalCost,
      newGoldBalance: newGold,
      newPotionCount: buyOffer.productId === 'health-potion' ? newHpPotions : newMpPotions,
      idempotentReplay: false
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function sellNpcInventoryItem(
  pool: pg.Pool,
  input: SellNpcItemInput
): Promise<SellNpcItemResponseDto> {
  if (!input.characterId || !input.itemId || !input.idempotencyKey) {
    throw new NpcShopError('INVALID_INPUT', 'Missing required sell fields', 400);
  }
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new NpcShopError('INVALID_QUANTITY', 'Quantity must be a positive integer', 400);
  }
  if (input.quantity > 1_000_000) {
    throw new NpcShopError('INVALID_QUANTITY', 'Quantity exceeds maximum allowable stack', 400);
  }

  const sellOffer = getNpcSellOffer(input.itemId);
  if (!sellOffer || !sellOffer.enabled) {
    throw new NpcShopError('ITEM_NOT_SELLABLE', `Item '${input.itemId}' cannot be sold to NPC`, 400);
  }

  const npcId = input.npcId ?? DEFAULT_NPC_MERCHANT.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock character
    const charRes = await client.query<CharacterRow>(
      `SELECT id, user_id, gold, hp_potions, mp_potions
       FROM characters
       WHERE id = $1
       FOR UPDATE`,
      [input.characterId]
    );
    const charRow = charRes.rows[0];
    if (!charRow) {
      throw new NpcShopError('CHARACTER_NOT_FOUND', `Character '${input.characterId}' not found`, 404);
    }

    // 2. Idempotency check against npc_transactions
    const existingTxRes = await client.query<NpcTransactionDbRow>(
      `SELECT * FROM npc_transactions WHERE character_id = $1 AND operation_key = $2 LIMIT 1`,
      [input.characterId, input.idempotencyKey]
    );
    const existingTx = existingTxRes.rows[0];
    if (existingTx) {
      if (
        existingTx.operation_type !== 'SELL' ||
        existingTx.product_id !== input.itemId ||
        Number(existingTx.quantity) !== input.quantity
      ) {
        throw new NpcShopError(
          'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD',
          `Idempotency key '${input.idempotencyKey}' was already used for a different shop transaction`,
          409
        );
      }

      const inventory = await getCharacterInventory(client, input.characterId);
      await client.query('COMMIT');

      return {
        characterId: input.characterId,
        itemId: input.itemId,
        quantitySold: Number(existingTx.quantity),
        unitPriceGold: Number(existingTx.unit_price),
        totalPayoutGold: Number(existingTx.total_gold),
        newGoldBalance: Number(charRow.gold),
        inventory,
        idempotentReplay: true
      };
    }

    // 3. Active hunt check
    const activeHuntRes = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM hunts
       WHERE character_id = $1 AND status IN ('ACTIVE', 'STOP_CONTINUATION_REQUIRED')
       LIMIT 1`,
      [input.characterId]
    );
    if (activeHuntRes.rows.length > 0) {
      throw new NpcShopError(
        'ACTIVE_HUNT_LOCKED',
        'Shop operations are locked while a hunt is in progress',
        409
      );
    }

    // 4. Lock backpack container
    const backpackRes = await client.query<ContainerDbRow>(
      `SELECT id, slot_capacity FROM inventory_containers
       WHERE character_id = $1 AND container_type = 'backpack'
       FOR UPDATE LIMIT 1`,
      [input.characterId]
    );
    const backpack = backpackRes.rows[0];
    if (!backpack) {
      throw new NpcShopError('BACKPACK_NOT_FOUND', 'Backpack container not found', 404);
    }

    if (input.slotIndex !== undefined) {
      if (input.slotIndex < 0 || input.slotIndex >= backpack.slot_capacity) {
        throw new NpcShopError(
          'SLOT_INDEX_OUT_OF_BOUNDS',
          `Slot index ${input.slotIndex} is outside backpack bounds (0-${backpack.slot_capacity - 1})`,
          400
        );
      }
    }

    // 5. Find matching items strictly in backpack (paperdoll excluded)
    let instancesQuery = `SELECT * FROM inventory_instances WHERE character_id = $1 AND container_id = $2 AND item_id = $3`;
    const instancesParams: unknown[] = [input.characterId, backpack.id, input.itemId];

    if (input.instanceId) {
      instancesParams.push(input.instanceId);
      instancesQuery += ` AND id = $${instancesParams.length}`;
    } else if (input.slotIndex !== undefined) {
      instancesParams.push(input.slotIndex);
      instancesQuery += ` AND slot_index = $${instancesParams.length}`;
    }

    instancesQuery += ` ORDER BY slot_index ASC FOR UPDATE`;
    const instancesRes = await client.query<InventoryInstanceDbRow>(instancesQuery, instancesParams);
    const matchingInstances = instancesRes.rows;

    const totalAvailable = matchingInstances.reduce((sum, inst) => sum + Number(inst.quantity), 0);
    if (totalAvailable < input.quantity) {
      throw new NpcShopError(
        'INSUFFICIENT_ITEMS',
        `Insufficient items in backpack: required ${input.quantity}, available ${totalAvailable}`,
        400
      );
    }

    // 6. Calculate payout
    const payoutResult = calculateNpcSellPayout(input.itemId, input.quantity);
    if (!payoutResult.ok) {
      throw new NpcShopError(payoutResult.reason, `Failed to calculate sell payout: ${payoutResult.reason}`, 400);
    }
    const totalPayout = payoutResult.totalPayoutGold;
    const currentGold = Number(charRow.gold);
    if (currentGold + totalPayout > MAX_SAFE_GOLD_TRANSACTION) {
      throw new NpcShopError('MAX_SAFE_GOLD_EXCEEDED', 'Gold balance would exceed maximum safe limit', 400);
    }
    const newGold = currentGold + totalPayout;

    // 7. Deduct items from backpack
    let needed = input.quantity;
    for (const inst of matchingInstances) {
      if (needed <= 0) break;
      const instQty = Number(inst.quantity);
      const take = Math.min(instQty, needed);

      if (take === instQty) {
        await client.query(`DELETE FROM inventory_instances WHERE id = $1`, [inst.id]);
      } else {
        await client.query(
          `UPDATE inventory_instances
           SET quantity = quantity - $1,
               row_version = row_version + 1
           WHERE id = $2`,
          [take, inst.id]
        );
      }
      needed -= take;
    }

    // 8. Update character gold
    await client.query(
      `UPDATE characters
       SET gold = $1,
           row_version = row_version + 1
       WHERE id = $2`,
      [newGold, input.characterId]
    );

    // 9. Record transaction and lines
    const txId = randomUUID();
    const lineId = randomUUID();
    const ledgerId = randomUUID();
    const movementId = randomUUID();
    const createdAtIso = input.nowIso ?? new Date().toISOString();
    const canonicalPayload = {
      characterId: input.characterId,
      npcId,
      itemId: input.itemId,
      instanceId: input.instanceId,
      slotIndex: input.slotIndex,
      quantity: input.quantity,
      unitPriceGold: sellOffer.unitPriceGold,
      totalPayoutGold: totalPayout
    };

    await client.query(
      `INSERT INTO npc_transactions (
         id, character_id, npc_id, operation_type, operation_key,
         canonical_payload, product_id, quantity, unit_price, total_gold, created_at
       )
       VALUES ($1, $2, $3, 'SELL', $4, $5, $6, $7, $8, $9, $10::timestamptz)`,
      [
        txId,
        input.characterId,
        npcId,
        input.idempotencyKey,
        JSON.stringify(canonicalPayload),
        input.itemId,
        input.quantity,
        sellOffer.unitPriceGold,
        totalPayout,
        createdAtIso
      ]
    );

    await client.query(
      `INSERT INTO npc_transaction_lines (
         id, transaction_id, line_index, product_id, quantity, unit_price, total_gold, created_at
       )
       VALUES ($1, $2, 0, $3, $4, $5, $6, $7::timestamptz)`,
      [lineId, txId, input.itemId, input.quantity, sellOffer.unitPriceGold, totalPayout, createdAtIso]
    );

    // 10. Record currency ledger CREDIT
    await client.query(
      `INSERT INTO currency_ledger (
         id, character_id, source_type, source_id, amount, balance_after, transaction_type, created_at
       )
       VALUES ($1, $2, 'NPC_SALE', $3, $4, $5, 'CREDIT', $6::timestamptz)`,
      [ledgerId, input.characterId, txId, totalPayout, newGold, createdAtIso]
    );

    // 11. Record inventory movement NPC_SALE
    await client.query(
      `INSERT INTO inventory_movements (
         id, character_id, operation_type, operation_key, source_reference, item_id, quantity, created_at
       )
       VALUES ($1, $2, 'NPC_SALE', $3, $4, $5, $6, $7::timestamptz)`,
      [movementId, input.characterId, input.idempotencyKey, txId, input.itemId, input.quantity, createdAtIso]
    );

    const inventory = await getCharacterInventory(client, input.characterId);

    await client.query('COMMIT');

    return {
      characterId: input.characterId,
      itemId: input.itemId,
      quantitySold: input.quantity,
      unitPriceGold: sellOffer.unitPriceGold,
      totalPayoutGold: totalPayout,
      newGoldBalance: newGold,
      inventory,
      idempotentReplay: false
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getNpcTransactionsForCharacter(
  pool: pg.Pool,
  characterId: string,
  limit = 50
): Promise<readonly NpcTransactionDto[]> {
  const safeLimit = Math.max(1, Math.min(100, limit));
  const res = await pool.query<NpcTransactionDbRow>(
    `SELECT id, character_id, npc_id, operation_type, product_id, quantity, unit_price, total_gold, created_at
     FROM npc_transactions
     WHERE character_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [characterId, safeLimit]
  );

  return res.rows.map((row) => ({
    id: row.id,
    characterId: row.character_id,
    npcId: row.npc_id,
    operationType: row.operation_type,
    productId: row.product_id,
    quantity: Number(row.quantity),
    unitPriceGold: Number(row.unit_price),
    totalGold: Number(row.total_gold),
    createdAt: row.created_at.toISOString()
  }));
}
