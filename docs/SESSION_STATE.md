# Session handoff (overwrite with newest factual state)

Updated: 2026-10-30
Repository: https://github.com/Sonnyqq/tibia-idle (private), branch `feat/idle-003-game-shell` (Draft PR #3 -> `main`)
Current phase: P01 — Tibia-Style Responsive Game UI Shell (`IDLE-003B`)
Current task: IDLE-003B — COMPLETE TIBIA-STYLE UI REDESIGN (`GO-MANUAL` verified on clean HEAD, awaiting owner merge approval)
What exists: pnpm monorepo (`IDLE-001` PR #1 merged), PostgreSQL auth/sessions/characters (`IDLE-002` PR #2 merged), Tibia 8.x/10+ / OTClient / M2Idle browser client UI (`IDLE-003B`): shared `GameWindow`/`GameButton`/`ItemSlot`/`ProgressBar`/`StatRow`/`MonsterRow`/`GameTabs`/`GameTooltip`/`GameLog` components (`components/ui/GameUi.tsx`), stone/olive-metal palette (`#222321`/`#343630`/`#41433d`), 5 screens (Dashboard, Hunts master-detail, Character & Skills, 9-slot Paperdoll Equipment + 20-slot Backpack, Bestiary encyclopedia), desktop 3-column workspace (`1440x900` / `1280x800`) + bottom Console Log, mobile layout (`768px` / `390px` / `320px`, zero horizontal overflow), categorized pixel-crisp SVG/sprite registry (`assetRegistry.tsx`), PL/EN parity, F5 reload persistence
What does NOT exist: offline hunt simulation & reward settlement (`IDLE-004` / `P02`), item drops/equipping (`P04`), market/bosses (`P06`), production deploy
Blockers: remote GitHub Actions on private repo blocked by account Actions budget (verified via Manual Final Gate against live PostgreSQL 18.6); written IP permission required before any original Tibia assets
Next task: Owner approval to merge Draft PR #3 (`feat/idle-003-game-shell` -> `main`), then start `IDLE-004` (`P02` offline hunt engine)
Last verified test evidence: Manual Final Gate (`pnpm install --frozen-lockfile` + `REQUIRE_DB_TESTS=1 pnpm run ci:local`) on Node v26.8.1, pnpm 12.16.1, PostgreSQL 18.6 (UTF8) — docs 17/17 PASS, tooling 11/11 PASS, lint PASS, typecheck PASS, build PASS, unit 19/19 PASS, integration 5/5 PASS (0 skipped), E2E 1/1 PASS + 10/10 visual QA screenshots (0 FAIL, 0 SKIP)
