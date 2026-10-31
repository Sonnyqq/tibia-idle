// packages/domain/src/npc-shop.ts
// Canonical versioned NPC merchant catalog, offers, and validation.

export const NPC_SHOP_CATALOG_VERSION = 1;

export const MAX_POTIONS_PER_CHARACTER = 1_000_000;
export const MAX_POTIONS_PER_TRANSACTION = 1_000;
export const MAX_SAFE_GOLD_TRANSACTION = 9_007_199_254_740_991;

export interface NpcMerchantInfo {
  readonly id: string;
  readonly nameKey: string;
  readonly greetingKey: string;
}

export interface NpcBuyOffer {
  readonly offerId: string;
  readonly operationType: 'BUY';
  readonly productId: 'health-potion' | 'mana-potion';
  readonly unitPriceGold: number;
  readonly maxQuantity: number;
  readonly enabled: boolean;
  readonly catalogVersion: number;
}

export interface NpcSellOffer {
  readonly offerId: string;
  readonly operationType: 'SELL';
  readonly productId: string;
  readonly unitPriceGold: number;
  readonly maxQuantity: number;
  readonly enabled: boolean;
  readonly catalogVersion: number;
}

export type NpcOffer = NpcBuyOffer | NpcSellOffer;

export const DEFAULT_NPC_MERCHANT: NpcMerchantInfo = {
  id: 'merchant-garrick',
  nameKey: 'shop.merchantName',
  greetingKey: 'shop.greeting'
};

/**
 * Buy offers: potions replenish character health and mana reserves.
 * Prices match authoritative simulation costs (hpPotionUnitCostGold=45, mpPotionUnitCostGold=50).
 */
export const NPC_BUY_OFFERS: readonly NpcBuyOffer[] = [
  {
    offerId: 'offer-buy-health-potion',
    operationType: 'BUY',
    productId: 'health-potion',
    unitPriceGold: 45,
    maxQuantity: MAX_POTIONS_PER_TRANSACTION,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-buy-mana-potion',
    operationType: 'BUY',
    productId: 'mana-potion',
    unitPriceGold: 50,
    maxQuantity: MAX_POTIONS_PER_TRANSACTION,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  }
];

/**
 * Sell offers: canonical NPC purchase prices for creature loot, materials and equipment.
 * Values are strictly aligned with monster loot tables in packages/domain/src/combat/config.ts.
 */
export const NPC_SELL_OFFERS: readonly NpcSellOffer[] = [
  {
    offerId: 'offer-sell-copper-coin',
    operationType: 'SELL',
    productId: 'copper-coin',
    unitPriceGold: 2,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-sell-rat-pelt',
    operationType: 'SELL',
    productId: 'rat-pelt',
    unitPriceGold: 9,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-sell-chitin-plate',
    operationType: 'SELL',
    productId: 'chitin-plate',
    unitPriceGold: 15,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-sell-ancient-bone',
    operationType: 'SELL',
    productId: 'ancient-bone',
    unitPriceGold: 24,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-sell-glow-moss',
    operationType: 'SELL',
    productId: 'glow-moss',
    unitPriceGold: 36,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-sell-wraith-essence',
    operationType: 'SELL',
    productId: 'wraith-essence',
    unitPriceGold: 62,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-sell-rusted-blade',
    operationType: 'SELL',
    productId: 'rusted-blade',
    unitPriceGold: 68,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-sell-drake-scale',
    operationType: 'SELL',
    productId: 'drake-scale',
    unitPriceGold: 110,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-sell-ember-scroll',
    operationType: 'SELL',
    productId: 'ember-scroll',
    unitPriceGold: 145,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-sell-silver-ring',
    operationType: 'SELL',
    productId: 'silver-ring',
    unitPriceGold: 240,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-sell-ash-talon',
    operationType: 'SELL',
    productId: 'ash-talon',
    unitPriceGold: 420,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  },
  {
    offerId: 'offer-sell-ritual-amulet',
    operationType: 'SELL',
    productId: 'ritual-amulet',
    unitPriceGold: 560,
    maxQuantity: 100_000,
    enabled: true,
    catalogVersion: NPC_SHOP_CATALOG_VERSION
  }
];

const BUY_OFFER_MAP: ReadonlyMap<string, NpcBuyOffer> = new Map(
  NPC_BUY_OFFERS.map((o) => [o.offerId, o])
);

const BUY_OFFER_BY_PRODUCT_MAP: ReadonlyMap<string, NpcBuyOffer> = new Map(
  NPC_BUY_OFFERS.map((o) => [o.productId, o])
);

const SELL_OFFER_MAP: ReadonlyMap<string, NpcSellOffer> = new Map(
  NPC_SELL_OFFERS.map((o) => [o.offerId, o])
);

const SELL_OFFER_BY_PRODUCT_MAP: ReadonlyMap<string, NpcSellOffer> = new Map(
  NPC_SELL_OFFERS.map((o) => [o.productId, o])
);

export function getNpcBuyOffer(offerIdOrProductId: string): NpcBuyOffer | undefined {
  return BUY_OFFER_MAP.get(offerIdOrProductId) ?? BUY_OFFER_BY_PRODUCT_MAP.get(offerIdOrProductId);
}

export function getNpcSellOffer(offerIdOrProductId: string): NpcSellOffer | undefined {
  return SELL_OFFER_MAP.get(offerIdOrProductId) ?? SELL_OFFER_BY_PRODUCT_MAP.get(offerIdOrProductId);
}

export function isItemSellable(itemId: string): boolean {
  const offer = SELL_OFFER_BY_PRODUCT_MAP.get(itemId);
  return offer !== undefined && offer.enabled;
}

export function calculateNpcBuyCost(
  offerId: string,
  quantity: number
): { ok: true; totalCostGold: number; offer: NpcBuyOffer } | { ok: false; reason: string } {
  const offer = getNpcBuyOffer(offerId);
  if (!offer || !offer.enabled) {
    return { ok: false, reason: 'NPC_OFFER_NOT_FOUND' };
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return { ok: false, reason: 'INVALID_QUANTITY' };
  }
  if (quantity > offer.maxQuantity) {
    return { ok: false, reason: 'MAX_QUANTITY_EXCEEDED' };
  }
  const totalCost = offer.unitPriceGold * quantity;
  if (!Number.isSafeInteger(totalCost) || totalCost > MAX_SAFE_GOLD_TRANSACTION) {
    return { ok: false, reason: 'OVERFLOW' };
  }
  return { ok: true, totalCostGold: totalCost, offer };
}

export function calculateNpcSellPayout(
  productId: string,
  quantity: number
): { ok: true; totalPayoutGold: number; offer: NpcSellOffer } | { ok: false; reason: string } {
  const offer = getNpcSellOffer(productId);
  if (!offer || !offer.enabled) {
    return { ok: false, reason: 'ITEM_NOT_SELLABLE' };
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return { ok: false, reason: 'INVALID_QUANTITY' };
  }
  if (quantity > offer.maxQuantity) {
    return { ok: false, reason: 'MAX_QUANTITY_EXCEEDED' };
  }
  const totalPayout = offer.unitPriceGold * quantity;
  if (!Number.isSafeInteger(totalPayout) || totalPayout > MAX_SAFE_GOLD_TRANSACTION) {
    return { ok: false, reason: 'OVERFLOW' };
  }
  return { ok: true, totalPayoutGold: totalPayout, offer };
}
