# Session handoff (overwrite with newest factual state)

Updated: 2026-10-31
Repository: https://github.com/Sonnyqq/tibia-idle (private), branch `feat/idle-004b2-playable-hunts` (Draft PR -> `main`)
Current phase: P02 — First Playable Vertical Slice of Idle Hunts (`IDLE-004B-2`)
Current task: IDLE-004B-2 — PLAYABLE OFFLINE HUNT API + UI (`GO` verified on clean HEAD, ready for Draft PR)
What exists: P01 complete (`IDLE-001` PR #1, `IDLE-002` PR #2, `IDLE-003`/`IDLE-003B` PR #3 merged); P02 domain combat engine (`IDLE-004A` PR #4 merged); P02 PostgreSQL hunt persistence (`IDLE-004B-1` PR #5 merged into `main @ a1fbbd0`); P02 Playable API & Web UI (`IDLE-004B-2`):
  - Fastify endpoints in `apps/api`: `POST /hunts/start` (strict validation, knight vocation check, potion checks, rate limiting, idempotent replay), `GET /hunts/active`, `GET /hunts/:id`, `POST /hunts/:id/settle` (0ms spam guard `< 1000ms`), `POST /hunts/:id/stop` (settle before stop, potion return), `GET /hunts/:id/segments`, `GET /characters/:id/hunt-rewards`.
  - Responsive Tibia-like Web UI in `apps/web`: `HuntsView` with zone selector, strategy selection (Safe, Balanced, Aggressive), potion reserve controls, "Rozpocznij polowanie" action, live-ticking "Aktywne polowanie" window with vitis/combat progress/potions/loot, "Rozlicz teraz" and "Zatrzymaj polowanie" buttons, "Raport z polowania" summary window, and "Magazyn nagród AFK" inbox window.
  - Complete PL/EN localization parity with stable `hunt.` translation keys.
  - Full automated test coverage: `tests/integration/hunts.api.integration.test.ts` (401/403/IDOR/strict validation/rate limiting/idempotency/settle spam guard), `tests/e2e/hunts.e2e.spec.ts` (start -> live monitoring -> settle -> stop -> report -> reward inbox -> F5 persistence -> mobile 390x844).
What does NOT exist: other vocations (P03 - paladin/sorcerer/druid combat systems), full inventory P04, production deploy.
Blockers: written IP permission required before any original Tibia assets.
Next task: Owner review & approval of PR for `IDLE-004B-2`, then proceed to P03 (combat & class progression for other vocations and skill training).
Last verified test evidence: Full Local CI (`REQUIRE_DB_TESTS=1 pnpm run ci:local` with PostgreSQL 18.6) — docs 17/17 PASS, tooling 11/11 PASS, lint PASS, typecheck PASS, build PASS, unit+perf 35/35 PASS, integration+DB-perf 22/22 PASS, Playwright E2E 2/2 PASS (14 screenshots captured, 0 FAIL, 0 SKIP).
