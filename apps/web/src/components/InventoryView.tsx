import { type EquipmentSlotDto } from '@tibia-idle/contracts';
import { type SupportedLocale, t } from '@tibia-idle/i18n';
import { useState } from 'react';
import { EQUIPMENT_SLOT_KEY_MAP } from '../lib/format.js';
import { GameTooltip, GameWindow, ItemSlot } from './ui/GameUi.js';

export interface InventoryViewProps {
  locale: SupportedLocale;
}

/**
 * 3x3 classic Tibia paperdoll arrangement using the exact 9 contract slots:
 * Row 1: Amulet (Neck) | Helmet (Head) | Ammunition (Quiver/Relic)
 * Row 2: Weapon (Main Hand) | Armor (Torso) | Shield (Off Hand)
 * Row 3: Ring (Finger) | Legs | Boots (Feet)
 */
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

const BACKPACK_SLOT_INDICES = Array.from({ length: 20 }, (_, idx) => idx + 1);

export function InventoryView({ locale }: InventoryViewProps) {
  const [selectedSlot, setSelectedSlot] = useState<EquipmentSlotDto>('weapon');

  const slotLabel = t(locale, EQUIPMENT_SLOT_KEY_MAP[selectedSlot]);
  const emptyText = t(locale, 'inventory.slotEmpty');

  return (
    <div data-testid="inventory-view" className="workspace-stack">
      <div className="inventory-split-layout">
        <GameWindow
          title={t(locale, 'inventory.equipmentTitle')}
          iconKey="armor"
          iconCategory="equipment"
          collapsible
          minimizeLabel={t(locale, 'window.minimize')}
          expandLabel={t(locale, 'window.expand')}
        >
          <div className="subwindow-title">{t(locale, 'inventory.paperdollTitle')}</div>
          <div className="paperdoll-frame">
            <div className="paperdoll-grid" role="group" aria-label={t(locale, 'inventory.equipmentTitle')}>
              {PAPERDOLL_GRID_ORDER.map((slot) => {
                const label = t(locale, EQUIPMENT_SLOT_KEY_MAP[slot]);
                return (
                  <div key={slot} className={`paperdoll-cell slot-${slot}`}>
                    <ItemSlot
                      testId={`equip-slot-${slot}`}
                      slotId={slot}
                      label={`${label} — ${emptyText}`}
                      iconKey={slot}
                      category="equipment"
                      state="empty"
                      selected={selectedSlot === slot}
                      onSelect={() => setSelectedSlot(slot)}
                    />
                    <span className="paperdoll-slot-name">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div data-testid="inventory-slot-tooltip" className="slot-inspector-wrapper">
            <GameTooltip
              data={{
                title: slotLabel,
                subtitle: emptyText,
                description: t(locale, 'inventory.slotTooltipHint'),
                source: t(locale, 'inventory.catalogNote')
              }}
              closeLabel={t(locale, 'tooltip.close')}
            />
          </div>
        </GameWindow>

        <GameWindow
          title={t(locale, 'inventory.backpackTitle')}
          iconKey="chest"
          iconCategory="equipment"
          collapsible
          minimizeLabel={t(locale, 'window.minimize')}
          expandLabel={t(locale, 'window.expand')}
          testId="inventory-backpack-panel"
        >
          <div className="subwindow-title">{t(locale, 'inventory.backpackSlotsTitle')}</div>
          <div className="backpack-slots-grid">
            {BACKPACK_SLOT_INDICES.map((index) => (
              <ItemSlot
                key={index}
                testId={`backpack-slot-${index}`}
                slotId={`backpack-${index}`}
                label={`${t(locale, 'inventory.slotEmpty')} #${index}`}
                iconKey="chest"
                category="equipment"
                state="empty"
              />
            ))}
          </div>
          <p data-testid="inventory-backpack-empty" className="window-muted-note">
            {t(locale, 'inventory.backpackEmptyNotice')}
          </p>
        </GameWindow>
      </div>
    </div>
  );
}
