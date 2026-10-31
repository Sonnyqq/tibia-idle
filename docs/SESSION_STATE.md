# Session handoff (overwrite with newest factual state)

Updated: 2026-10-31
Repository: https://github.com/Sonnyqq/tibia-idle (private), branch `feat/idle-005b-equipment-combat-stats`
Current phase: P04 — Inventory and Economy Foundation (`IDLE-005B`)
Current task: IDLE-005B — EQUIPMENT PAPERDOLL & COMBAT STATS (Draft PR #8 updated and ready for review)
What exists: P01 complete (PR #1-#3); P02 complete (PR #4-#6); P04 Inventory & Economy Foundation (`IDLE-005A` PR #7, `IDLE-005B` PR #8):
  - Database schema migration `0005_equipment_paperdoll.sql`: alters `inventory_containers` (`container_type IN ('backpack', 'equipment')`, `slot_capacity IN (20, 9)`), `inventory_movements` (added `EQUIP_ITEM`, `UNEQUIP_ITEM`, `SWAP_EQUIPMENT`), and backfills 9-slot `equipment` container for existing characters.
  - Domain rules in `packages/domain/src/items.ts`: 9 equipment slots, `calculateEffectiveCombatStats` (Knight baseline: 18 attack, 16 defense, 10 armor, 50 critChance, 1250 critMultiplier), item bonuses (`rusted-blade` +4 weaponAttack, `silver-ring` +20 critChance, `ritual-amulet` +3 totalArmor), `calculateCharacterCarriedWeight` (backpack weight + equipment weight).
  - Repositories in `packages/database`: `inventory-repository.ts` (`getCharacterEquipment`, `equipInventoryItem`, `unequipInventoryItem` with `FOR UPDATE` transaction locks, idempotency, level/vocation/slot checks, swap support), `hunt-repository.ts` (`startHunt` dynamically incorporates equipped item combat stats into frozen `CombatCharacterSnapshot`).
  - Fastify endpoints in `apps/api`: `GET /characters/:id/equipment`, `POST /characters/:id/equipment/equip`, `POST /characters/:id/equipment/unequip` with full CSRF, auth, IDOR validation, and HTTP 409 active hunt lock protection.
  - Responsive Web UI in `apps/web`: interactive 9-slot paperdoll in `InventoryView` with real equipped items, slot selection, unequip action, equip action from backpack with real-time stat comparison diffs (`+4 Attack`, etc.), active hunt lock banner, character sheet combat stats panel in `CharacterView` (`Base + Bonus = Effective`), and live dock paperdoll reflection.
  - Complete PL/EN localization parity with stable `inventory.`, `character.`, `tooltip.`, and `error.` translation keys.
  - Full automated test coverage: `tests/unit/domain.smoke.test.ts` (domain stats & capacity), `tests/unit/combat.unit.test.ts` (equipment combat scaling determinism & snapshot freeze), `tests/integration/equipment.api.integration.test.ts` (10 tests: equip, unequip, swap, active hunt locks, idempotency, full backpack reject, IDOR, weight check, 20 concurrent race), `tests/integration/equipment.perf.integration.test.ts` (100 & 1000 reads, 100 cycles, 20 concurrent race, startHunt with/without equipment), `tests/e2e/equipment.e2e.spec.ts` (full flow + 8 visual QA screenshots).
What does NOT exist: NPC shop buy/sell, market (P06), crafting, production deploy.
Blockers: written IP permission required before any original Tibia assets.
Next task: Owner review & merge of Draft PR #8 (`IDLE-005B`), then proceed to P04C (NPC shop buy/sell or gold ledger enhancements).
