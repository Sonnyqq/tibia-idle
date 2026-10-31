# ROADMAP — ordered engineering plan (source of truth)

All stages start **NOT STARTED**; a roadmap line is not evidence of code. No merge or production deployment without explicit user approval. Each step is one or several bounded PRs and must meet `TEST_STRATEGY.md`.

## P00 — repository governance (starter kit)
- [x] Agent rules (`AGENTS.md`, `CLAUDE.md`), map, roadmap, architecture, test strategy, workflow, copyright notes.
- [x] Runnable documentation and PL/EN key-parity checks; initial CI for these checks.
- [x] Initialize separate Git repository (`Sonnyqq/tibia-idle`).
- [ ] User decision: legal permission for third-party assets. No protected assets before written permission.
**Exit:** rules, docs and docs/i18n CI pass on new repo.

## P01 — TypeScript skeleton + auth + localized UI
- [x] Create pnpm workspace, pinned Node/package-manager, typecheck, lint, test commands (`IDLE-001`, merged in PR #1).
- [x] Real PostgreSQL schema (`0002_auth_sessions_characters.sql`), versioned migrations, test DB reset (`IDLE-002`, merged in PR #2).
- [x] Account registration/login/logout (Argon2id, hashed HttpOnly sessions, CSRF, rate limits), character create/read (max 3, 4 vocations), locale persisted (`IDLE-002`, merged in PR #2).
- [x] React responsive shell: bottom mobile nav, desktop layout, PL/EN switch, empty hunt panel, 5 views: Dashboard, Hunts, Character, Inventory, Bestiary (`IDLE-003`).
- [x] Unit, contract, DB integration, E2E register/login/character + 5-screen responsive shell (`320px`/`390px`/`768px`/`1280px`), auth abuse & concurrency tests (`IDLE-002`, `IDLE-003`).
**Exit:** one user can register, change language and create a character; real CI regression.

## P02 — first vertical slice of idle hunts (HIGHEST RISK)
- [x] Domain: versioned deterministic combat, RNG, clock, resources, XP and loot (`IDLE-004A`, `packages/domain/src/combat/`, merged in PR #4).
- [x] 1 class, 3 zones, 6 monsters, 12 items; display estimates and settled outcomes (`IDLE-004A` domain + `IDLE-004B-1` DB persistence + `IDLE-004B-2` Fastify API/React UI slice).
- [x] One active hunt; offline checkpoint and idempotent claim; stop/death/potions/24h cap (`IDLE-004B-1`, `packages/database/src/hunt-repository.ts`).
- [x] DB atomicity, double-settlement, concurrent workers, restart/SIGTERM crash tests (`IDLE-004B-1`, `tests/integration/hunts.integration.test.ts`).
- [x] Browser E2E: start -> close -> return -> see loot; mobile and network loss (`IDLE-004B-2`, `tests/e2e/hunts.e2e.spec.ts`).
- [x] Establish baseline for 100/1000 ongoing hunts and concurrent settlements (domain baseline in `IDLE-004A`; PostgreSQL 100/1000 & race baseline in `IDLE-004B-1` `tests/integration/hunts.perf.integration.test.ts`).
**Exit:** 0 double rewards in race suite, replay deterministic, full CI passing.

## P03 — combat and class progression
- [ ] Extend to four distinct class archetypes and meaningful strategies.
- [ ] Skill training via authoritative actions; spell rules, level and skill curves.
- [ ] Potion profiles, stop conditions, balancing tools and combat simulation reports.
- [ ] Tests: balance, boundaries, class mechanics, regression and mobile UX.
**Exit:** class strengths vary by zone, consistent XP/hour and cost explanations.

## P04 — inventory and economy foundation
- [x] Persistent inventory, 20-slot starting backpack, integer capacity/weight, item stacking, empty moves, slot swaps, stack splitting, AFK reward inbox atomic claim (`IDLE-005A`).
- [ ] Equipped items (paperdoll equipment stats & weapon requirements P04B), loot filter, provenance.
- [ ] Gold ledger, purchase/sell to NPC, atomic transactions; abuse/race tests.
- [ ] 120 base items target reached incrementally; versioned loot tables.
**Exit:** zero dupes in crash/race test harness, reconciled economy.

## P05 — bestiary, tasks and upgrades
- [ ] Bestiary tiers/counters from settled kills; 3 basic charms.
- [ ] Tasks, achievements, upgrades +0..+5 with sink and tests.
- [ ] Exhaustion/balance and repeat-settle counters tested.
**Exit:** repeat settle never increments any progression twice.

## P06 — solo bosses and market
- [ ] Three solo bosses, combat phase rules and cooldowns.
- [ ] Fixed-price market with escrow, fees and single-owner inventory.
- [ ] Race/cancel/buy, ledger reconciliation, anti-abuse and migration tests.
- [ ] Migration up/down tests.
**Exit:** no double spend/dupe, authorized trades only.

## P07 — social and administration
- [ ] Chat with moderation/rate limits, rankings, staff tools, audit events.
- [ ] Toggle features, versioned balance config and rollout/rollback.
- [ ] Operational alerts/telemetry, backup-restore drills, readiness/warmup.
**Exit:** operational runbooks and verified restore.

## P08 — closed test and public beta
- [ ] PL/EN complete, mobile/desktop accessibility, compliance/content licensing approved.
- [ ] Economy, exploits, multi-user concurrency, load, browser matrix, incident drills.
- [ ] Staging canary and owner-approved production deploy; post-deploy smoke.
**Exit:** beta decision documented; known unresolved risks accepted explicitly.

## Not MVP
Guilds, parties, group bosses, seasonal PvP, large destiny wheel, imbuements, prey, elaborate crafting, pets. Do not implement early without explicit reprioritization.
