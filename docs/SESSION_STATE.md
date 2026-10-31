# Session handoff (overwrite with newest factual state)

Updated: 2026-10-31
Repository: https://github.com/Sonnyqq/tibia-idle (private), branch `feat/idle-005c-npc-shop-economy`
Current phase: P04 — Inventory and Economy Foundation (`IDLE-005C`)
Current task: IDLE-005C — NPC SHOP, POTION RESTOCK & GOLD ECONOMY (Draft PR #9 updated and ready for review)
What exists: P01 complete (PR #1-#3); P02 complete (PR #4-#6); P04 Inventory & Economy Foundation (`IDLE-005A` PR #7, `IDLE-005B` PR #8, `IDLE-005C` PR #9):
  - Database schema migration `0007_npc_shop_economy.sql`: adds `npc_transactions`, `npc_transaction_lines`, `sequence_id` to `currency_ledger`, expands `source_type` with `NPC_PURCHASE` and `NPC_SALE`, and expands `inventory_movements` with `NPC_SALE`.
  - Shared contracts & prices in `packages/contracts/src/npc-shop.ts`: canonical merchant `merchant-garrick` ("Garrick Zaopatrzeniowiec"), 2 potion products (HP 45 gp, MP 50 gp), 12 canonical sell offers strictly aligned with monster loot tables, `calculateNpcBuyCost`, `calculateNpcSellPayout`, `getNpcSellOffer`, `isItemSellable`.
  - Re-exported domain bindings in `packages/domain/src/npc-shop.ts`.
  - Repository in `packages/database/src/npc-shop-repository.ts`: `buyNpcProduct`, `sellNpcInventoryItem`, `getNpcTransactionsForCharacter` with `FOR UPDATE` transaction locks, idempotency, strict gold ledger tracking, potion counters replenish without instance duplication, active hunt lock guard, and paperdoll equipment lock.
  - Extended economy reconciliation in `packages/database/src/hunt-repository.ts`: `reconcileCharacterEconomy` reconciles gold ledger balance, potion supplies accounting, and item instances ledger.
  - Fastify endpoints in `apps/api`: `GET /npc-shop/catalog`, `GET /characters/:id/npc-shop/history`, `POST /characters/:id/npc-shop/buy`, `POST /characters/:id/npc-shop/sell` with CSRF, rate-limiting, and error translation mapping.
  - Responsive Web UI in `apps/web`: compact NPC Shop window in `NpcShopView.tsx` with KUP / SPRZEDAJ / HISTORIA tabs, live cost previews, quick quantity buttons (+1/+10/+100/MAX/WSZYSTKO), active hunt trade lock, gold badge sync, and client console log messages.
  - Complete PL/EN localization parity with `shop.` translation namespace.
  - Full automated test coverage: `tests/integration/npc-shop.api.integration.test.ts` (13 tests: catalog, buy, sell, active hunt block, equipped item block, 20 concurrent buys, 20 concurrent sells, pool=1, history), `tests/e2e/npc-shop.e2e.spec.ts` (full lifecycle, F5 persistence, hunt lock, mobile 390px/320px, 6 visual QA screenshots).
What does NOT exist: player market (P06), crafting, production deploy.
Blockers: written IP permission required before any original Tibia assets.
Next task: Owner review & merge of Draft PR #9 (`IDLE-005C`).
