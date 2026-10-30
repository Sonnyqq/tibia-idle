# Session handoff (overwrite with newest factual state)

Updated: 2026-10-30
Repository: https://github.com/Sonnyqq/tibia-idle (private), branch `feat/idle-003-game-shell` (Draft PR #3 -> `main`)
Current phase: P01 — Responsive Game UI Shell (`IDLE-003`)
Current task: IDLE-003 — RESPONSIVE GAME UI SHELL (`GO-MANUAL` verified on clean HEAD, awaiting owner merge approval)
What exists: pnpm monorepo (`IDLE-001` PR #1 merged), PostgreSQL auth/sessions/characters (`IDLE-002` PR #2 merged), dark-fantasy M2Idle-style responsive PC & mobile game shell (`IDLE-003`): 5 screens (Dashboard, Hunts, Character, Inventory, Bestiary), read-only `/zones` catalog (3 zones, 6 creatures, 12 loot preview items, `simulationEnabled: false`), SVG vector icon registry with licensed sprite hook (`assetRegistry.tsx`), desktop sidebar + contextual panel + mobile bottom navigation (`320px`/`390px`/`768px`/`1280px` zero horizontal overflow), PL/EN parity, F5 reload state & session persistence
What does NOT exist: offline hunt simulation & reward settlement (`IDLE-004` / `P02`), item drops/equipping (`P04`), market/bosses (`P06`), production deploy
Blockers: remote GitHub Actions on private repo blocked by account Actions budget (verified via Manual Final Gate against live PostgreSQL 18.6); written IP permission required before any original Tibia assets
Next task: Owner approval to merge Draft PR #3 (`feat/idle-003-game-shell` -> `main`), then start `IDLE-004` (`P02` offline hunt engine)
Last verified test evidence: Manual Final Gate (`pnpm install --frozen-lockfile` + `REQUIRE_DB_TESTS=1 pnpm run ci:local`) on Node v26.8.1, pnpm 12.16.1, PostgreSQL 18.6 (UTF8) — docs 17/17 PASS, tooling 11/11 PASS, lint PASS, typecheck PASS, build PASS, unit 18/18 PASS, integration 5/5 PASS (0 skipped), E2E 2/2 PASS (0 FAIL, 0 SKIP)
