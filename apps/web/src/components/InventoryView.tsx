import {
  type CharacterEquipmentResponseDto,
  type CharacterHuntRewardItemDto,
  type CharacterInventoryResponseDto,
  type EquipmentSlotDto,
  type InventorySlotItemDto
} from '@tibia-idle/contracts';
import { type SupportedLocale, t, type TranslationKey } from '@tibia-idle/i18n';
import { useRef, useState } from 'react';
import { EQUIPMENT_SLOT_KEY_MAP, RARITY_KEY_MAP } from '../lib/format.js';
import { GameButton, GameTooltip, GameWindow, ItemSlot } from './ui/GameUi.js';

export interface InventoryViewProps {
  locale: SupportedLocale;
  inventory: CharacterInventoryResponseDto | null;
  equipment: CharacterEquipmentResponseDto | null;
  rewardItems: readonly CharacterHuntRewardItemDto[];
  onClaimReward: (rewardId: string) => Promise<void>;
  claimingRewardId?: string | null | undefined;
  onMoveItem: (fromSlot: number, toSlot: number) => Promise<void>;
  onSplitStack: (fromSlot: number, toSlot: number, quantity: number) => Promise<void>;
  onEquipItem: (backpackSlot: number, equipmentSlot: EquipmentSlotDto) => Promise<void>;
  onUnequipItem: (equipmentSlot: EquipmentSlotDto) => Promise<void>;
  actionLoading?: boolean | undefined;
}

const PAPERDOLL_GRID_ORDER: readonly EquipmentSlotDto[] = [
  'amulet',
  'helmet',
  'ammunition',
  'weapon',
  'armor',
  'shield',
  'ring',
  'legs',
  'boots'
];

export function InventoryView({
  locale,
  inventory,
  equipment,
  rewardItems,
  onClaimReward,
  claimingRewardId,
  onMoveItem,
  onSplitStack,
  onEquipItem,
  onUnequipItem,
  actionLoading = false
}: InventoryViewProps) {
  const [selectedPaperdollSlot, setSelectedPaperdollSlot] =
    useState<EquipmentSlotDto>('weapon');
  const [selectedBackpackSlot, setSelectedBackpackSlot] = useState<number | null>(null);
  const [splitQuantity, setSplitQuantity] = useState<number>(1);
  const [isSplitting, setIsSplitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);

  const emptyText = t(locale, 'inventory.slotEmpty');

  const containerSlots = Array.from({ length: 20 }, (_, idx) => idx);
  const slotMap = new Map<number, InventorySlotItemDto>();
  if (inventory?.slots) {
    for (const slot of inventory.slots) {
      slotMap.set(slot.slotIndex, slot);
    }
  }

  const selectedItem =
    selectedBackpackSlot !== null ? (slotMap.get(selectedBackpackSlot) ?? null) : null;
  const equippedInSelectedSlot = equipment?.slots[selectedPaperdollSlot] ?? null;

  const handleBackpackSlotClick = async (slotIndex: number) => {
    if (actionLoading || isSubmittingRef.current) return;

    if (isSplitting) {
      if (selectedBackpackSlot !== null && slotIndex !== selectedBackpackSlot) {
        // Target slot selected for split
        if (!slotMap.has(slotIndex)) {
          isSubmittingRef.current = true;
          try {
            await onSplitStack(selectedBackpackSlot, slotIndex, splitQuantity);
            setIsSplitting(false);
            setSelectedBackpackSlot(null);
          } finally {
            isSubmittingRef.current = false;
          }
        }
      }
      return;
    }

    if (selectedBackpackSlot === null) {
      // First click: select if occupied
      if (slotMap.has(slotIndex)) {
        setSelectedBackpackSlot(slotIndex);
        setSplitQuantity(1);
      }
    } else {
      // Second click: if clicking same slot, deselect
      if (selectedBackpackSlot === slotIndex) {
        setSelectedBackpackSlot(null);
      } else {
        // Different slot -> Move or swap!
        isSubmittingRef.current = true;
        try {
          await onMoveItem(selectedBackpackSlot, slotIndex);
          setSelectedBackpackSlot(null);
        } finally {
          isSubmittingRef.current = false;
        }
      }
    }
  };

  const handleStartSplit = () => {
    if (!selectedItem || !selectedItem.stackable || selectedItem.quantity <= 1) return;
    setSplitQuantity(Math.floor(selectedItem.quantity / 2) || 1);
    setIsSplitting(true);
  };

  const handleAutoSplitToFirstFree = async () => {
    if (actionLoading || isSubmittingRef.current) return;
    if (!selectedItem || selectedBackpackSlot === null) return;
    const firstFree = containerSlots.find((s) => !slotMap.has(s));
    if (firstFree !== undefined) {
      isSubmittingRef.current = true;
      try {
        await onSplitStack(selectedBackpackSlot, firstFree, splitQuantity);
        setIsSplitting(false);
        setSelectedBackpackSlot(null);
      } finally {
        isSubmittingRef.current = false;
      }
    }
  };

  const handleEquipClick = async (backpackSlot: number, slot: EquipmentSlotDto) => {
    if (actionLoading || isSubmittingRef.current || equipment?.activeHuntLocked) return;
    isSubmittingRef.current = true;
    try {
      await onEquipItem(backpackSlot, slot);
      setSelectedBackpackSlot(null);
      setSelectedPaperdollSlot(slot);
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const handleUnequipClick = async (slot: EquipmentSlotDto) => {
    if (actionLoading || isSubmittingRef.current || equipment?.activeHuntLocked) return;
    isSubmittingRef.current = true;
    try {
      await onUnequipItem(slot);
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const unclaimedRewards = rewardItems.filter((r) => r.ownershipState === 'UNCLAIMED');

  const cap = inventory?.capacity ?? {
    currentWeight: 0,
    maxWeight: 5000,
    remainingCapacity: 5000,
    occupiedSlots: 0,
    maxSlots: 20
  };

  return (
    <div data-testid="inventory-view" className="workspace-stack">
      {/* 1. Main split layout: Paperdoll Equipment & Backpack */}
      <div className="inventory-split-layout">
        {/* Left: Paperdoll equipment */}
        <GameWindow
          title={t(locale, 'inventory.equipmentTitle')}
          iconKey="armor"
          iconCategory="equipment"
          collapsible
          minimizeLabel={t(locale, 'window.minimize')}
          expandLabel={t(locale, 'window.expand')}
        >
          <div className="subwindow-title">{t(locale, 'inventory.paperdollTitle')}</div>

          {equipment?.activeHuntLocked && (
            <div className="active-hunt-lock-notice" data-testid="active-hunt-equipment-locked">
              {t(locale, 'inventory.activeHuntLocked')}
            </div>
          )}

          <div className="paperdoll-frame">
            <div
              className="paperdoll-grid"
              data-testid="paperdoll-grid"
              role="group"
              aria-label={t(locale, 'inventory.equipmentTitle')}
            >
              {PAPERDOLL_GRID_ORDER.map((slot) => {
                const label = t(locale, EQUIPMENT_SLOT_KEY_MAP[slot]);
                const equipped = equipment?.slots[slot] ?? null;
                const isSelected = selectedPaperdollSlot === slot && selectedBackpackSlot === null;

                return (
                  <div key={slot} className={`paperdoll-cell slot-${slot}`}>
                    <ItemSlot
                      testId={`equip-slot-${slot}`}
                      slotId={slot}
                      label={
                        equipped
                          ? `${label} — ${t(locale, equipped.nameKey as TranslationKey)}`
                          : `${label} — ${emptyText}`
                      }
                      iconKey={equipped ? equipped.fallbackIconKey : slot}
                      category={equipped ? 'item' : 'equipment'}
                      state={equipped ? (isSelected ? 'selected' : 'occupied') : (isSelected ? 'selected' : 'empty')}
                      {...(equipped ? { rarity: equipped.rarity } : {})}
                      selected={isSelected}
                      onSelect={() => {
                        setSelectedPaperdollSlot(slot);
                        setSelectedBackpackSlot(null);
                      }}
                    />
                    <span className="paperdoll-slot-name">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Paperdoll Slot Inspector */}
          <div data-testid="inventory-slot-tooltip" className="slot-inspector-wrapper">
            {equippedInSelectedSlot ? (
              <div className="equipped-slot-inspector" data-testid="equipped-slot-inspector">
                <GameTooltip
                  data={{
                    title: t(locale, equippedInSelectedSlot.nameKey as TranslationKey),
                    subtitle: `${t(locale, EQUIPMENT_SLOT_KEY_MAP[selectedPaperdollSlot])} • ${t(
                      locale,
                      RARITY_KEY_MAP[equippedInSelectedSlot.rarity]
                    )}`,
                    description: `${t(locale, 'inventory.weightLabel')}: ${
                      equippedInSelectedSlot.totalWeight
                    } ${t(locale, 'inventory.weightUnit')}${
                      equippedInSelectedSlot.requiredLevel
                        ? ` • ${t(locale, 'tooltip.requiredLevel')}: ${equippedInSelectedSlot.requiredLevel}`
                        : ''
                    }`,
                    source: t(locale, 'tooltip.equipped')
                  }}
                  closeLabel={t(locale, 'tooltip.close')}
                />
                <div className="equipped-item-actions">
                  <GameButton
                    variant="default"
                    onClick={() => void handleUnequipClick(selectedPaperdollSlot)}
                    disabled={actionLoading || equipment?.activeHuntLocked}
                    testId="unequip-item-btn"
                  >
                    {t(locale, 'inventory.unequip')}
                  </GameButton>
                </div>
              </div>
            ) : (
              <GameTooltip
                data={{
                  title: t(locale, EQUIPMENT_SLOT_KEY_MAP[selectedPaperdollSlot]),
                  subtitle: emptyText,
                  description: t(locale, 'inventory.slotTooltipHint'),
                  source: t(locale, 'inventory.equipment')
                }}
                closeLabel={t(locale, 'tooltip.close')}
              />
            )}
          </div>
        </GameWindow>

        {/* Right: Backpack Container */}
        <GameWindow
          title={t(locale, 'inventory.backpackTitle')}
          iconKey="chest"
          iconCategory="equipment"
          collapsible
          minimizeLabel={t(locale, 'window.minimize')}
          expandLabel={t(locale, 'window.expand')}
          testId="inventory-backpack-panel"
          headerRight={
            <div className="inventory-header-stats">
              <span className="game-tag" data-testid="inventory-capacity-tag">
                {t(locale, 'inventory.capacityLabel')}: {cap.currentWeight} / {cap.maxWeight}{' '}
                {t(locale, 'inventory.weightUnit')}
              </span>
              <span className="game-tag" data-testid="inventory-slots-tag">
                {t(locale, 'inventory.slotsLabel')}: {cap.occupiedSlots} / {cap.maxSlots}
              </span>
            </div>
          }
        >
          <div className="subwindow-title">{t(locale, 'inventory.backpackSlotsTitle')}</div>

          <div className="backpack-slots-grid" data-testid="backpack-slots-grid">
            {containerSlots.map((slotIndex) => {
              const item = slotMap.get(slotIndex);
              const isSelected = selectedBackpackSlot === slotIndex;
              const isTargetPrompt = isSplitting && !item && selectedBackpackSlot !== null;

              return (
                <div
                  key={slotIndex}
                  className={`backpack-slot-cell ${isSelected ? 'slot-cell-selected' : ''} ${
                    isTargetPrompt ? 'slot-cell-target' : ''
                  }`}
                >
                  <ItemSlot
                    testId={`backpack-slot-${slotIndex}`}
                    slotId={`backpack-${slotIndex}`}
                    label={
                      item
                        ? `${t(locale, item.nameKey as TranslationKey)} (x${item.quantity})`
                        : `${emptyText} #${slotIndex + 1}`
                    }
                    iconKey={item ? item.fallbackIconKey : 'chest'}
                    category={item ? 'item' : 'equipment'}
                    state={item ? (isSelected ? 'selected' : 'occupied') : 'empty'}
                    {...(item ? { rarity: item.rarity, stackCount: item.quantity } : {})}
                    selected={isSelected}
                    onSelect={() => void handleBackpackSlotClick(slotIndex)}
                  />
                </div>
              );
            })}
          </div>

          {/* Item action controls & inspector */}
          <div className="inventory-action-panel" data-testid="inventory-action-panel">
            {selectedItem ? (
              <div className="selected-item-box" data-testid="selected-item-box">
                <div className="selected-item-header">
                  <strong>{t(locale, selectedItem.nameKey as TranslationKey)}</strong>
                  <span className={`game-tag rarity-${selectedItem.rarity}`}>
                    {t(locale, RARITY_KEY_MAP[selectedItem.rarity])}
                  </span>
                  <span className="game-tag">
                    {t(locale, 'inventory.weightLabel')}: {selectedItem.totalWeight}{' '}
                    {t(locale, 'inventory.weightUnit')}
                  </span>
                  {selectedItem.equipmentSlot && (
                    <span className="game-tag">
                      {t(locale, EQUIPMENT_SLOT_KEY_MAP[selectedItem.equipmentSlot])}
                    </span>
                  )}
                </div>

                {/* Stat comparison when equippable */}
                {selectedItem.itemType === 'equipment' && selectedItem.equipmentSlot && (
                  <div className="stat-comparison-box" data-testid="stat-comparison-box">
                    {(() => {
                      const curEquipped = equipment?.slots[selectedItem.equipmentSlot];
                      const curAtk = curEquipped?.combatBonuses?.weaponAttack ?? 0;
                      const newAtk = selectedItem.combatBonuses?.weaponAttack ?? 0;
                      const diffAtk = newAtk - curAtk;

                      const curDef = curEquipped?.combatBonuses?.shieldDefense ?? 0;
                      const newDef = selectedItem.combatBonuses?.shieldDefense ?? 0;
                      const diffDef = newDef - curDef;

                      const curArm = curEquipped?.combatBonuses?.totalArmor ?? 0;
                      const newArm = selectedItem.combatBonuses?.totalArmor ?? 0;
                      const diffArm = newArm - curArm;

                      const curCrit = curEquipped?.combatBonuses?.critChancePermille ?? 0;
                      const newCrit = selectedItem.combatBonuses?.critChancePermille ?? 0;
                      const diffCrit = newCrit - curCrit;

                      return (
                        <div className="stat-diff-row">
                          {diffAtk !== 0 && (
                            <span
                              className={diffAtk > 0 ? 'stat-diff-positive' : 'stat-diff-negative'}
                              data-testid="stat-diff-attack"
                            >
                              {t(locale, 'character.attack')} {diffAtk > 0 ? `+${diffAtk}` : diffAtk}
                            </span>
                          )}
                          {diffDef !== 0 && (
                            <span className={diffDef > 0 ? 'stat-diff-positive' : 'stat-diff-negative'}>
                              {t(locale, 'character.defense')} {diffDef > 0 ? `+${diffDef}` : diffDef}
                            </span>
                          )}
                          {diffArm !== 0 && (
                            <span className={diffArm > 0 ? 'stat-diff-positive' : 'stat-diff-negative'}>
                              {t(locale, 'character.armor')} {diffArm > 0 ? `+${diffArm}` : diffArm}
                            </span>
                          )}
                          {diffCrit !== 0 && (
                            <span className={diffCrit > 0 ? 'stat-diff-positive' : 'stat-diff-negative'}>
                              {t(locale, 'character.critChance')} {diffCrit > 0 ? `+${(diffCrit / 10).toFixed(1)}%` : `${(diffCrit / 10).toFixed(1)}%`}
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {isSplitting ? (
                  <div className="split-controls-box" data-testid="split-controls-box">
                    <label className="split-label">
                      {t(locale, 'inventory.splitQuantityLabel')}: {splitQuantity}
                      <input
                        type="range"
                        min="1"
                        max={selectedItem.quantity - 1}
                        value={splitQuantity}
                        onChange={(e) => setSplitQuantity(Number(e.target.value))}
                        className="split-slider"
                        data-testid="split-slider"
                      />
                    </label>
                    <div className="split-buttons-row">
                      <GameButton
                        variant="primary"
                        onClick={() => void handleAutoSplitToFirstFree()}
                        disabled={actionLoading}
                        testId="confirm-split-auto-btn"
                      >
                        {t(locale, 'inventory.confirm')}
                      </GameButton>
                      <GameButton
                        variant="default"
                        onClick={() => setIsSplitting(false)}
                        testId="cancel-split-btn"
                      >
                        {t(locale, 'inventory.cancel')}
                      </GameButton>
                    </div>
                    <span className="window-muted-note">
                      {t(locale, 'inventory.selectTargetSlotPrompt')}
                    </span>
                  </div>
                ) : (
                  <div className="selected-item-actions">
                    <div className="selected-buttons-row">
                      {selectedItem.itemType === 'equipment' &&
                        selectedItem.equipmentSlot &&
                        selectedBackpackSlot !== null && (
                          <GameButton
                            variant="primary"
                            onClick={() => {
                              if (selectedBackpackSlot !== null && selectedItem.equipmentSlot) {
                                void handleEquipClick(selectedBackpackSlot, selectedItem.equipmentSlot);
                              }
                            }}
                            disabled={actionLoading || equipment?.activeHuntLocked}
                            testId="equip-item-btn"
                          >
                            {t(locale, 'inventory.equip')}
                          </GameButton>
                        )}
                      {selectedItem.stackable && selectedItem.quantity > 1 && (
                        <GameButton
                          variant="default"
                          onClick={handleStartSplit}
                          disabled={actionLoading}
                          testId="split-stack-btn"
                        >
                          {t(locale, 'inventory.splitStack')}
                        </GameButton>
                      )}
                      <GameButton
                        variant="default"
                        onClick={() => setSelectedBackpackSlot(null)}
                        testId="cancel-selection-btn"
                      >
                        {t(locale, 'inventory.cancel')}
                      </GameButton>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p
                className="window-muted-note"
                data-testid={
                  cap.occupiedSlots === 0 ? 'inventory-backpack-empty' : 'no-item-selected-note'
                }
              >
                {cap.occupiedSlots === 0
                  ? t(locale, 'inventory.emptyBackpack')
                  : t(locale, 'inventory.noItemSelected')}
              </p>
            )}
          </div>
        </GameWindow>
      </div>

      {/* 2. AFK Reward Inbox Window */}
      <GameWindow
        title={t(locale, 'inventory.rewardInboxTitle')}
        iconKey="chest"
        collapsible
        testId="reward-inbox-window"
        headerRight={
          <span className="game-tag" data-testid="reward-inbox-count">
            {unclaimedRewards.length} {t(locale, 'hunt.summaryLoot').toLowerCase()}
          </span>
        }
      >
        <div className="reward-inbox-content" data-testid="reward-inbox-panel">
          {unclaimedRewards.length === 0 ? (
            <p className="window-muted-note" data-testid="reward-inbox-empty">
              {t(locale, 'inventory.emptyInbox')}
            </p>
          ) : (
            <div className="reward-inbox-grid" data-testid="reward-inbox-grid">
              {unclaimedRewards.map((item) => (
                <div
                  key={item.id}
                  className="reward-inbox-card"
                  data-testid={`reward-item-${item.id}`}
                >
                  <ItemSlot
                    slotId={item.itemId}
                    label={`${t(locale, item.nameKey as TranslationKey)} (x${item.quantity})`}
                    category="item"
                    state="occupied"
                    rarity={item.rarity}
                    stackCount={item.quantity}
                  />
                  <div className="reward-item-details">
                    <strong className="reward-item-name">
                      {t(locale, item.nameKey as TranslationKey)}
                    </strong>
                    <div className="reward-item-badges">
                      <span className={`game-tag rarity-${item.rarity}`}>
                        {t(locale, RARITY_KEY_MAP[item.rarity])}
                      </span>
                      <span className="game-tag game-tag-unclaimed">
                        {t(locale, 'inventory.unclaimedBadge')}
                      </span>
                    </div>
                  </div>
                  <div className="reward-item-actions">
                    <GameButton
                      variant="primary"
                      onClick={() => void onClaimReward(item.id)}
                      disabled={actionLoading || claimingRewardId === item.id}
                      testId={`claim-reward-btn-${item.id}`}
                    >
                      {claimingRewardId === item.id
                        ? t(locale, 'inventory.claiming')
                        : t(locale, 'inventory.claimReward')}
                    </GameButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </GameWindow>
    </div>
  );
}
