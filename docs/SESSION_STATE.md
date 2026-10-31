# Session handoff (overwrite with newest factual state)

Updated: 2026-10-31
Repository: https://github.com/Sonnyqq/tibia-idle (private), branch `feat/idle-004a-combat-engine` (Draft PR #4 -> `main`)
Current phase: P02 — Deterministic Idle Combat Engine (`IDLE-004A`)
Current task: IDLE-004A — DETERMINISTIC IDLE COMBAT ENGINE (`GO` verified on clean HEAD, awaiting owner merge approval)
What exists: P01 complete (`IDLE-001` PR #1, `IDLE-002` PR #2, `IDLE-003`/`IDLE-003B` PR #3 merged into `main @ 9617742`); P02 domain combat foundation (`IDLE-004A` in `packages/domain/src/combat/`): versioned deterministic Knight combat engine (`COMBAT_SIMULATION_VERSION = '1.0.0'`), stateful Mulberry32 PRNG (`{ seed, state, cursor }`), discrete-event simulator (`simulateHuntSegment`) with exact chunk equivalence (`60m == 30m + 30m`) and mid-encounter checkpointing, 3 strategies (`safe`, `balanced`, `aggressive`), 3 zones / 6 monsters / 12 loot items aligned with `INITIAL_ZONES_CATALOG`, 24h cap (`MAX_OFFLINE_DURATION_MS`), `analyzeZoneEfficiency` metrics, unit/golden/property tests (`tests/unit/combat.unit.test.ts`), and 100/1000-session + 24h domain benchmark (`tests/perf/combat.bench.test.ts`)
What does NOT exist: persistent hunt sessions in PostgreSQL, transactional reward settlement, `/hunts` start/settle/stop API endpoints, active hunt UI (`IDLE-004B`), other vocations (`P03`), production deploy
Blockers: written IP permission required before any original Tibia assets
Next task: Owner approval to merge Draft PR #4 (`feat/idle-004a-combat-engine` -> `main`), then start `IDLE-004B` (persistent offline hunts, transactional settlement, idempotency & UI integration)
Last verified test evidence: Full Local CI (`REQUIRE_DB_TESTS=1 pnpm run ci:local` with PostgreSQL 18.6) + GitHub Actions (`postgres:16-alpine`) — docs 17/17 PASS, tooling 11/11 PASS, lint PASS, typecheck PASS, build PASS, unit+perf 29/29 PASS, integration 5/5 PASS, E2E 1/1 PASS (0 FAIL, 0 SKIP)
