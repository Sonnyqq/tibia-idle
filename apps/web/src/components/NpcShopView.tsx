import {
  type CharacterInventoryResponseDto,
  type InventorySlotItemDto,
  type NpcTransactionDto
} from '@tibia-idle/contracts';
import {
  calculateNpcBuyCost,
  calculateNpcSellPayout,
  DEFAULT_NPC_MERCHANT,
  getItemDefinition,
  getNpcSellOffer,
  isItemSellable
} from '@tibia-idle/domain';
import { type SupportedLocale, t } from '@tibia-idle/i18n';
import { useMemo, useState } from 'react';
import { GameIcon } from '../assets/assetRegistry.js';
import {
  GameButton,
  GameTabs,
  GameWindow,
  ItemSlot
} from './ui/GameUi.js';

export interface NpcShopViewProps {
  locale: SupportedLocale;
  characterGold: number;
  hpPotions: number;
  mpPotions: number;
  inventory: CharacterInventoryResponseDto | null;
  isActiveHunt: boolean;
  history?: readonly NpcTransactionDto[] | undefined;
  onBuyProduct: (offerId: string, quantity: number) => Promise<void>;
  onSellItem: (itemId: string, quantity: number, slotIndex?: number) => Promise<void>;
  actionLoading?: boolean | undefined;
}

type ShopSubTab = 'buy' | 'sell' | 'history';

export function NpcShopView({
  locale,
  characterGold,
  hpPotions,
  mpPotions,
  inventory,
  isActiveHunt,
  history = [],
  onBuyProduct,
  onSellItem,
  actionLoading = false
}: NpcShopViewProps) {
  const [activeTab, setActiveTab] = useState<ShopSubTab>('buy');

  // Buy quantities
  const [hpBuyQty, setHpBuyQty] = useState<number>(10);
  const [mpBuyQty, setMpBuyQty] = useState<number>(10);

  // Sell quantities per slot index
  const [sellQuantities, setSellQuantities] = useState<Record<number, number>>({});

  // 1. Calculations for Buy offers
  const hpCostRes = calculateNpcBuyCost('offer-buy-health-potion', hpBuyQty);
  const hpTotalCost = hpCostRes.ok ? hpCostRes.totalCostGold : 0;
  const hpCanAfford = hpCostRes.ok && characterGold >= hpTotalCost && hpBuyQty > 0;
  const maxHpBuy = Math.max(1, Math.min(1000, Math.floor(characterGold / 45)));

  const mpCostRes = calculateNpcBuyCost('offer-buy-mana-potion', mpBuyQty);
  const mpTotalCost = mpCostRes.ok ? mpCostRes.totalCostGold : 0;
  const mpCanAfford = mpCostRes.ok && characterGold >= mpTotalCost && mpBuyQty > 0;
  const maxMpBuy = Math.max(1, Math.min(1000, Math.floor(characterGold / 50)));

  // 2. Calculations for Sell items from backpack
  const sellableItems = useMemo(() => {
    if (!inventory) return [];
    return inventory.slots
      .filter((slot) => isItemSellable(slot.itemId))
      .map((slot) => {
        const offer = getNpcSellOffer(slot.itemId);
        return {
          slotIndex: slot.slotIndex,
          item: slot,
          offer
        };
      });
  }, [inventory]);

  const handleSetSellQty = (slotIndex: number, qty: number, maxQty: number) => {
    const clamped = Math.max(1, Math.min(maxQty, Math.floor(qty) || 1));
    setSellQuantities((prev) => ({ ...prev, [slotIndex]: clamped }));
  };

  const getSellQty = (slotIndex: number, maxQty: number) => {
    return sellQuantities[slotIndex] ?? Math.min(1, maxQty);
  };

  return (
    <div className="game-shop-view" data-testid="npc-shop-view">
      <GameWindow
        title={t(locale, 'shop.title')}
        iconKey="potion"
        className="game-shop-window"
        headerRight={
          <div className="game-shop-balance-badge" data-testid="shop-character-gold">
            <span className="game-shop-gold-amount">{characterGold} gp</span>
          </div>
        }
      >
        {/* Merchant dialogue intro */}
        <div className="game-shop-merchant-card" data-testid="shop-merchant-card">
          <div className="game-shop-merchant-avatar">
            <GameIcon iconKey="crest" size={32} />
          </div>
          <div className="game-shop-merchant-details">
            <h3 className="game-shop-merchant-name">{t(locale, 'shop.merchantName')}</h3>
            <p className="game-shop-merchant-greeting">{t(locale, 'shop.greeting')}</p>
          </div>
        </div>

        {/* Active Hunt Notice */}
        {isActiveHunt && (
          <div
            className="game-status-callout is-warning shop-hunt-warning"
            data-testid="shop-hunt-locked-notice"
            role="alert"
          >
            <GameIcon iconKey="swords" size={16} />
            <span>{t(locale, 'shop.activeHuntNotice')}</span>
          </div>
        )}

        {/* Navigation tabs */}
        <GameTabs
          ariaLabel={t(locale, 'shop.title')}
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          tabs={[
            {
              id: 'buy',
              label: t(locale, 'shop.tabBuy'),
              iconKey: 'potion',
              testId: 'shop-tab-buy'
            },
            {
              id: 'sell',
              label: t(locale, 'shop.tabSell'),
              iconKey: 'chest',
              testId: 'shop-tab-sell'
            },
            {
              id: 'history',
              label: t(locale, 'shop.tabHistory'),
              iconKey: 'swords',
              testId: 'shop-tab-history'
            }
          ]}
        />

        {/* Tab 1: BUY */}
        {activeTab === 'buy' && (
          <div className="game-shop-tab-content" data-testid="shop-buy-panel">
            <div className="game-shop-offers-grid">
              {/* Health Potion Offer */}
              <div className="game-shop-card" data-testid="shop-buy-health-potion">
                <div className="game-shop-card-header">
                  <div className="game-shop-item-icon">
                    <GameIcon iconKey="potion" size={24} />
                  </div>
                  <div className="game-shop-card-info">
                    <h4 className="game-shop-card-title">{t(locale, 'shop.healthPotion')}</h4>
                    <span className="game-shop-stock">
                      {t(locale, 'shop.currentPotions', { count: hpPotions })}
                    </span>
                  </div>
                  <div className="game-shop-unit-price">
                    <span className="game-shop-price-tag">45 gp</span>
                  </div>
                </div>

                <div className="game-shop-controls">
                  <div className="game-shop-qty-row">
                    <label className="game-shop-qty-label">{t(locale, 'shop.quantity')}:</label>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={hpBuyQty}
                      onChange={(e) => setHpBuyQty(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 1)))}
                      className="game-shop-qty-input"
                      data-testid="input-buy-hp-qty"
                      disabled={isActiveHunt || actionLoading}
                    />
                    <div className="game-shop-quick-btns">
                      <GameButton
                        size="sm"
                        onClick={() => setHpBuyQty((prev) => Math.min(1000, prev + 1))}
                        disabled={isActiveHunt || actionLoading}
                      >
                        +1
                      </GameButton>
                      <GameButton
                        size="sm"
                        onClick={() => setHpBuyQty((prev) => Math.min(1000, prev + 10))}
                        disabled={isActiveHunt || actionLoading}
                      >
                        +10
                      </GameButton>
                      <GameButton
                        size="sm"
                        onClick={() => setHpBuyQty((prev) => Math.min(1000, prev + 100))}
                        disabled={isActiveHunt || actionLoading}
                      >
                        +100
                      </GameButton>
                      <GameButton
                        size="sm"
                        onClick={() => setHpBuyQty(maxHpBuy)}
                        disabled={isActiveHunt || actionLoading}
                        data-testid="btn-buy-hp-max"
                      >
                        {t(locale, 'shop.quickSelectMax')}
                      </GameButton>
                    </div>
                  </div>

                  <div className="game-shop-summary-row">
                    <span className="game-shop-total-label">
                      {t(locale, 'shop.totalCost')}: <strong>{hpTotalCost} gp</strong>
                    </span>
                    <GameButton
                      variant="primary"
                      onClick={() => onBuyProduct('offer-buy-health-potion', hpBuyQty)}
                      disabled={!hpCanAfford || isActiveHunt || actionLoading}
                      data-testid="btn-buy-health-potion"
                    >
                      {t(locale, 'shop.buyButton')}
                    </GameButton>
                  </div>
                </div>
              </div>

              {/* Mana Potion Offer */}
              <div className="game-shop-card" data-testid="shop-buy-mana-potion">
                <div className="game-shop-card-header">
                  <div className="game-shop-item-icon">
                    <GameIcon iconKey="potion" size={24} />
                  </div>
                  <div className="game-shop-card-info">
                    <h4 className="game-shop-card-title">{t(locale, 'shop.manaPotion')}</h4>
                    <span className="game-shop-stock">
                      {t(locale, 'shop.currentPotions', { count: mpPotions })}
                    </span>
                  </div>
                  <div className="game-shop-unit-price">
                    <span className="game-shop-price-tag">50 gp</span>
                  </div>
                </div>

                <div className="game-shop-controls">
                  <div className="game-shop-qty-row">
                    <label className="game-shop-qty-label">{t(locale, 'shop.quantity')}:</label>
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={mpBuyQty}
                      onChange={(e) => setMpBuyQty(Math.max(1, Math.min(1000, parseInt(e.target.value, 10) || 1)))}
                      className="game-shop-qty-input"
                      data-testid="input-buy-mp-qty"
                      disabled={isActiveHunt || actionLoading}
                    />
                    <div className="game-shop-quick-btns">
                      <GameButton
                        size="sm"
                        onClick={() => setMpBuyQty((prev) => Math.min(1000, prev + 1))}
                        disabled={isActiveHunt || actionLoading}
                      >
                        +1
                      </GameButton>
                      <GameButton
                        size="sm"
                        onClick={() => setMpBuyQty((prev) => Math.min(1000, prev + 10))}
                        disabled={isActiveHunt || actionLoading}
                      >
                        +10
                      </GameButton>
                      <GameButton
                        size="sm"
                        onClick={() => setMpBuyQty((prev) => Math.min(1000, prev + 100))}
                        disabled={isActiveHunt || actionLoading}
                      >
                        +100
                      </GameButton>
                      <GameButton
                        size="sm"
                        onClick={() => setMpBuyQty(maxMpBuy)}
                        disabled={isActiveHunt || actionLoading}
                        data-testid="btn-buy-mp-max"
                      >
                        {t(locale, 'shop.quickSelectMax')}
                      </GameButton>
                    </div>
                  </div>

                  <div className="game-shop-summary-row">
                    <span className="game-shop-total-label">
                      {t(locale, 'shop.totalCost')}: <strong>{mpTotalCost} gp</strong>
                    </span>
                    <GameButton
                      variant="primary"
                      onClick={() => onBuyProduct('offer-buy-mana-potion', mpBuyQty)}
                      disabled={!mpCanAfford || isActiveHunt || actionLoading}
                      data-testid="btn-buy-mana-potion"
                    >
                      {t(locale, 'shop.buyButton')}
                    </GameButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: SELL */}
        {activeTab === 'sell' && (
          <div className="game-shop-tab-content" data-testid="shop-sell-panel">
            {sellableItems.length === 0 ? (
              <div className="game-shop-empty-state" data-testid="shop-sell-empty">
                <GameIcon iconKey="chest" size={32} />
                <p>{t(locale, 'shop.noSellableItems')}</p>
              </div>
            ) : (
              <div className="game-shop-sell-list">
                {sellableItems.map(({ slotIndex, item, offer }) => {
                  const itemDef = getItemDefinition(item.itemId);
                  const itemName = itemDef ? t(locale, itemDef.nameKey as any) : item.itemId;
                  const unitPrice = offer ? offer.unitPriceGold : 0;
                  const currentQty = getSellQty(slotIndex, item.quantity);
                  const payoutRes = calculateNpcSellPayout(item.itemId, currentQty);
                  const totalPayout = payoutRes.ok ? payoutRes.totalPayoutGold : 0;

                  return (
                    <div
                      key={`sell-${slotIndex}-${item.itemId}`}
                      className="game-shop-sell-card"
                      data-testid={`shop-sell-item-${item.itemId}`}
                    >
                      <div className="game-shop-sell-item-header">
                        <ItemSlot
                          slotId={`shop-sell-slot-${slotIndex}`}
                          asset={
                            itemDef
                              ? {
                                  assetId: itemDef.assetId,
                                  category: 'item',
                                  fallbackIconKey: itemDef.fallbackIconKey
                                }
                              : undefined
                          }
                          iconKey={itemDef?.fallbackIconKey ?? 'chest'}
                          stackCount={item.quantity}
                          rarity={itemDef?.rarity ?? 'common'}
                          label={itemName}
                        />
                        <div className="game-shop-sell-item-info">
                          <h4 className="game-shop-sell-item-name">{itemName}</h4>
                          <span className="game-shop-stock">
                            {t(locale, 'shop.inventoryStock', { count: item.quantity })}
                          </span>
                        </div>
                        <div className="game-shop-unit-price">
                          <span className="game-shop-price-tag">{unitPrice} gp / szt.</span>
                        </div>
                      </div>

                      <div className="game-shop-sell-controls">
                        <div className="game-shop-qty-row">
                          <input
                            type="number"
                            min={1}
                            max={item.quantity}
                            value={currentQty}
                            onChange={(e) =>
                              handleSetSellQty(slotIndex, parseInt(e.target.value, 10), item.quantity)
                            }
                            className="game-shop-qty-input"
                            data-testid={`input-sell-qty-${item.itemId}`}
                            disabled={isActiveHunt || actionLoading}
                          />
                          <div className="game-shop-quick-btns">
                            <GameButton
                              size="sm"
                              onClick={() => handleSetSellQty(slotIndex, 1, item.quantity)}
                              disabled={isActiveHunt || actionLoading}
                            >
                              1
                            </GameButton>
                            <GameButton
                              size="sm"
                              onClick={() => handleSetSellQty(slotIndex, 10, item.quantity)}
                              disabled={isActiveHunt || actionLoading || item.quantity < 10}
                            >
                              10
                            </GameButton>
                            <GameButton
                              size="sm"
                              onClick={() => handleSetSellQty(slotIndex, item.quantity, item.quantity)}
                              disabled={isActiveHunt || actionLoading}
                              data-testid={`btn-sell-all-${item.itemId}`}
                            >
                              {t(locale, 'shop.quickSelectAll')}
                            </GameButton>
                          </div>
                        </div>

                        <div className="game-shop-summary-row">
                          <span className="game-shop-total-label">
                            {t(locale, 'shop.totalPayout')}: <strong>+{totalPayout} gp</strong>
                          </span>
                          <GameButton
                            variant="primary"
                            onClick={() => onSellItem(item.itemId, currentQty, slotIndex)}
                            disabled={currentQty <= 0 || isActiveHunt || actionLoading}
                            data-testid={`btn-sell-submit-${item.itemId}`}
                          >
                            {t(locale, 'shop.sellButton')}
                          </GameButton>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: HISTORY */}
        {activeTab === 'history' && (
          <div className="game-shop-tab-content" data-testid="shop-history-panel">
            {history.length === 0 ? (
              <div className="game-shop-empty-state" data-testid="shop-history-empty">
                <GameIcon iconKey="swords" size={32} />
                <p>{t(locale, 'shop.noHistory')}</p>
              </div>
            ) : (
              <div className="game-shop-history-list">
                {history.map((tx) => (
                  <div key={tx.id} className="game-shop-history-row" data-testid={`shop-history-${tx.id}`}>
                    <span className={`game-shop-badge ${tx.operationType === 'BUY' ? 'is-buy' : 'is-sell'}`}>
                      {tx.operationType}
                    </span>
                    <div className="game-shop-history-info">
                      <span className="game-shop-history-product">
                        {tx.quantity}x {tx.productId}
                      </span>
                      <span className="game-shop-history-date">
                        {new Date(tx.createdAt).toLocaleTimeString(locale === 'pl' ? 'pl-PL' : 'en-US')}
                      </span>
                    </div>
                    <span
                      className={`game-shop-history-amount ${
                        tx.operationType === 'BUY' ? 'is-debit' : 'is-credit'
                      }`}
                    >
                      {tx.operationType === 'BUY' ? `-${tx.totalGold}` : `+${tx.totalGold}`} gp
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </GameWindow>
    </div>
  );
}
