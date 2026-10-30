import { EQUIPMENT_SLOTS, type EquipmentSlotDto } from '@tibia-idle/contracts';
import { type SupportedLocale, t } from '@tibia-idle/i18n';
import { useState } from 'react';
import { GameIcon } from '../assets/assetRegistry.js';
import { EQUIPMENT_SLOT_KEY_MAP } from '../lib/format.js';

export interface InventoryViewProps {
  locale: SupportedLocale;
}

export function InventoryView({ locale }: InventoryViewProps) {
  const [selectedSlot, setSelectedSlot] = useState<EquipmentSlotDto>('weapon');

  return (
    <section data-testid="inventory-view" className="center-panel">
      <div className="panel-card">
        <h2>{t(locale, 'inventory.equipmentTitle')}</h2>
        <div className="equipment-grid">
          {EQUIPMENT_SLOTS.map((slot) => (
            <button
              key={slot}
              type="button"
              className="slot-button"
              data-testid={`equip-slot-${slot}`}
              aria-pressed={selectedSlot === slot}
              onClick={() => setSelectedSlot(slot)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <GameIcon iconKey={slot} size={20} />
                <strong>{t(locale, EQUIPMENT_SLOT_KEY_MAP[slot])}</strong>
              </div>
              <small style={{ color: 'var(--text-muted)' }}>
                {t(locale, 'inventory.slotEmpty')}
              </small>
            </button>
          ))}
        </div>

        <div
          className="sub-card"
          style={{ marginTop: '0.75rem' }}
          data-testid="inventory-slot-tooltip"
        >
          <strong>{t(locale, EQUIPMENT_SLOT_KEY_MAP[selectedSlot])}</strong> —{' '}
          <span>{t(locale, 'inventory.slotEmpty')}</span>
          <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {t(locale, 'inventory.slotTooltipHint')}
          </p>
        </div>
      </div>

      <div className="panel-card" data-testid="inventory-backpack-panel">
        <h3>{t(locale, 'inventory.backpackTitle')}</h3>
        <p data-testid="inventory-backpack-empty" style={{ margin: 0, color: 'var(--text-muted)' }}>
          {t(locale, 'inventory.backpackEmptyNotice')}
        </p>
      </div>
    </section>
  );
}
