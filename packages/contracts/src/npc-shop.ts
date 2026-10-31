// packages/contracts/src/npc-shop.ts
// Shared NPC shop offers, prices, and client calculation helpers.

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
 * Values are strictly aligned with monster loot tables.
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

export const NPC_POTION_PRODUCTS = [
  {
    id: 'health-potion' as const,
    nameKey: 'shop.healthPotion',
    descriptionKey: 'shop.healthPotionDesc',
    unitPriceGold: 45,
    offerId: 'offer-buy-health-potion',
    iconKey: 'potion'
  },
  {
    id: 'mana-potion' as const,
    nameKey: 'shop.manaPotion',
    descriptionKey: 'shop.manaPotionDesc',
    unitPriceGold: 50,
    offerId: 'offer-buy-mana-potion',
    iconKey: 'potion'
  }
] as const;

export function getNpcBuyOffer(productIdOrOfferId: string): NpcBuyOffer | undefined {
  return NPC_BUY_OFFERS.find(
    (o) => o.offerId === productIdOrOfferId || o.productId === productIdOrOfferId
  );
}

export function getNpcSellOffer(itemIdOrOfferId: string): NpcSellOffer | undefined {
  return NPC_SELL_OFFERS.find(
    (o) => o.offerId === itemIdOrOfferId || o.productId === itemIdOrOfferId
  );
}

export function isItemSellable(itemId: string): boolean {
  const offer = getNpcSellOffer(itemId);
  return Boolean(offer && offer.enabled);
}

export function calculateNpcBuyCost(
  productIdOrOfferId: string,
  quantity: number
): { ok: true; totalCostGold: number; offer: NpcBuyOffer } | { ok: false; reason: string } {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, reason: 'INVALID_QUANTITY' };
  }
  const offer = getNpcBuyOffer(productIdOrOfferId);
  if (!offer || !offer.enabled) {
    return { ok: false, reason: 'OFFER_NOT_AVAILABLE' };
  }
  if (quantity > offer.maxQuantity) {
    return { ok: false, reason: 'MAX_QUANTITY_EXCEEDED' };
  }
  const totalCostGold = offer.unitPriceGold * quantity;
  if (!Number.isSafeInteger(totalCostGold) || totalCostGold > MAX_SAFE_GOLD_TRANSACTION) {
    return { ok: false, reason: 'GOLD_OVERFLOW' };
  }
  return { ok: true, totalCostGold, offer };
}

export function calculateNpcSellPayout(
  itemIdOrOfferId: string,
  quantity: number
): { ok: true; totalPayoutGold: number; offer: NpcSellOffer } | { ok: false; reason: string } {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, reason: 'INVALID_QUANTITY' };
  }
  const offer = getNpcSellOffer(itemIdOrOfferId);
  if (!offer || !offer.enabled) {
    return { ok: false, reason: 'ITEM_NOT_SELLABLE' };
  }
  if (quantity > offer.maxQuantity) {
    return { ok: false, reason: 'MAX_QUANTITY_EXCEEDED' };
  }
  const totalPayoutGold = offer.unitPriceGold * quantity;
  if (!Number.isSafeInteger(totalPayoutGold) || totalPayoutGold > MAX_SAFE_GOLD_TRANSACTION) {
    return { ok: false, reason: 'GOLD_OVERFLOW' };
  }
  return { ok: true, totalPayoutGold, offer };
}
