# Session handoff (overwrite with newest factual state)

Updated: 2026-10-31
Repository: https://github.com/Sonnyqq/tibia-idle (private), branch `feat/idle-005a-persistent-inventory`
Current phase: P04 — Inventory and Economy Foundation (`IDLE-005A`)
Current task: IDLE-005A — PERSISTENT INVENTORY, BACKPACK & AFK LOOT CLAIM (`GO` verified on clean HEAD, ready for Draft PR)
What exists: P01 complete (PR #1-#3); P02 complete (PR #4-#6); P04 Inventory & Economy Foundation (`IDLE-005A`):
  - Database schema migration `0004_persistent_inventory_backpack.sql`: `inventory_containers` (starting backpack 20 slots), `inventory_instances` (slot indexing with deferred uniqueness constraint), `inventory_movements` (immutable ledger of claims, moves, splits).
  - Domain rules in `packages/domain/src/items.ts`: 12 item catalog definitions, integer weight system (oz), vocation capacity formula (Knight 5000+250/lvl, Paladin 4000+200/lvl, Mages 3000+100/lvl).
  - Repositories in `packages/database`: `auth-repository.ts` (backpack creation on character creation), `inventory-repository.ts` (`getCharacterInventory`, `getCharacterContainers`, `claimHuntReward` with FOR UPDATE locks & idempotency, `moveInventoryItem` with empty/merge/swap handling, `splitInventoryStack`), `hunt-repository.ts` (economy reconciliation updated to verify inventory claims).
  - Fastify endpoints in `apps/api`: `GET /characters/:id/inventory`, `GET /characters/:id/inventory/containers`, `POST /characters/:id/inventory/move`, `POST /characters/:id/inventory/split`, `POST /characters/:id/hunt-rewards/:rewardId/claim`.
  - Responsive Web UI in `apps/web`: Tibia window-style layout in `InventoryView`, read-only paperdoll equipment (9 slots), 20-slot backpack grid with item icons, stack badges, capacity/slot counter, slot selection, move/swap on click/tap, split stack modal/slider, and AFK Reward Inbox with `[ Odbierz ]` (Claim) buttons.
  - Complete PL/EN localization parity with stable `inventory.` and `error.` translation keys.
  - Full automated test coverage: `tests/unit/items.unit.test.ts` (14 tests), `tests/integration/inventory.api.integration.test.ts` (9 tests), `tests/integration/inventory.perf.integration.test.ts` (5 benchmarks), `tests/e2e/inventory.e2e.spec.ts` (full flow + 7 visual QA screenshots).
What does NOT exist: equipped paperdoll combat stats/weapon requirements (P04B), NPC shop buy/sell, market, production deploy.
Blockers: written IP permission required before any original Tibia assets.
Next task: Owner review & merge of PR for `IDLE-005A`, then proceed to P04B (equipped paperdoll weapon & armor combat stats).
