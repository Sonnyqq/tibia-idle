// packages/domain/src/npc-shop.ts
// Re-export canonical versioned NPC merchant catalog, offers, and validation.

export {
  NPC_SHOP_CATALOG_VERSION,
  MAX_POTIONS_PER_CHARACTER,
  MAX_POTIONS_PER_TRANSACTION,
  MAX_SAFE_GOLD_TRANSACTION,
  type NpcMerchantInfo,
  type NpcBuyOffer,
  type NpcSellOffer,
  type NpcOffer,
  DEFAULT_NPC_MERCHANT,
  NPC_BUY_OFFERS,
  NPC_SELL_OFFERS,
  NPC_POTION_PRODUCTS,
  getNpcBuyOffer,
  getNpcSellOffer,
  isItemSellable,
  calculateNpcBuyCost,
  calculateNpcSellPayout
} from '@tibia-idle/contracts';
