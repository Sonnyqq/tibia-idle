# PROJECT_MAP.md — fast index (keep <= ~180 lines)

**Status key:** EXISTS = files currently in repository; PLANNED = implement in milestone; DO NOT read empty directories looking for code.

| Area | Path | Status | Read next | Dependencies |
|---|---|---|---|---|
| Agent policy | `AGENTS.md`, `CLAUDE.md` | EXISTS | `docs/AI_EFFICIENCY.md` | all |
| Project phases | `docs/ROADMAP.md` | EXISTS | `docs/tasks/BACKLOG.md` | all |
| Product rules | `docs/GAME_DESIGN.md` | EXISTS | `docs/DATA_MODEL.md` | domain |
| Architecture | `docs/ARCHITECTURE.md` | EXISTS | `docs/DECISIONS.md` | all |
| Test gates | `docs/TEST_STRATEGY.md` | EXISTS | `docs/WORKFLOW.md` | all |
| Locales & i18n | `packages/i18n/` | EXISTS (PL/EN auth, characters, 5-screen game shell, zones/bestiary) | `tests/tooling/i18n.test.mjs` | none |
| Documentation checks | `scripts/check-docs.mjs` | EXISTS | `tests/tooling/guardrails.test.mjs` | CI |
| Architecture boundaries | `tests/tooling/boundaries.test.mjs` | EXISTS | `tsconfig.base.json` | CI |
| Web UI | `apps/web/` | EXISTS (responsive PC/mobile shell: Dashboard, Hunts, Character, Inventory, Bestiary + SVG asset registry) | game design: UI | contracts/i18n |
| API/auth | `apps/api/` | EXISTS (Argon2id auth, HttpOnly sessions, CSRF, characters, read-only `/zones` catalog) | architecture: auth/API | domain/db/contracts/i18n |
| Domain engine | `packages/domain/` | EXISTS (vocation stats, XP/level progress, catalog, deterministic Knight combat simulator `src/combat/`) | game design: hunts | contracts |
| Database/migrations | `packages/database/` | EXISTS (`0001`–`0003` migrations, `auth-repository.ts`, `hunt-repository.ts` persistent hunts/segments/rewards/ledger) | data model | domain/contracts |
| DTO/contracts | `packages/contracts/` | EXISTS (auth, session, character, zone/creature/loot catalog & equipment slot schemas) | architecture: API | i18n |
| Unit tests | `tests/unit/` | EXISTS (domain, combat engine + property tests, contracts, security, db, web 5-screen SSR, i18n) | `vitest.unit.config.ts` | packages/web/api |
| Backend integration | `tests/integration/` | EXISTS (API, Postgres migrations `0001`–`0003`, auth/security/race, `/zones`, persistent hunts/settlement/fault-injection/DB perf) | `vitest.integration.config.ts` | api/db |
| Browser E2E | `tests/e2e/` | EXISTS (5 screens, PC/mobile 320/390/768/1280/1440px, PL/EN switch, F5 reload, auth) | `playwright.config.ts` | web/api/db |
| Load and recovery | `tests/perf/` | EXISTS (`combat.bench.test.ts` domain 100/1000/24h; `tests/integration/hunts.perf.integration.test.ts` DB 100/1000 & race) | test strategy | api/db/domain |
| Licensed art registry | `assets/` | EXISTS (rules only) | `docs/LEGAL_ASSETS.md` | web |
| CI verification | `.github/workflows/verify.yml` | EXISTS | `docs/TEST_STRATEGY.md` | all tests |

## Feature ownership and blast radius
- **Hunts/offline settlement:** `packages/domain/hunt`, `apps/api/hunts`, `packages/database/hunts` [PLANNED]; affects XP, skills, loot, potions, task counters, bestiary. Require recovery/idempotency tests.
- **Inventory/items:** `packages/domain/inventory`, DB inventory; affects loot, market, upgrades and capacity. Require atomic ownership and overflow tests.
- **Gold/market:** `packages/domain/economy`, API market, DB ledger; affects balance and trade. Require concurrent buyer/seller transaction tests.
- **Bestiary/charms:** domain progression; consumes kill events from trusted settlement, never client events.
- **Translations:** `packages/i18n/locales/en.json`, `pl.json`; update both together and test parity.
- **UI:** web route/component only; cannot calculate authoritative loot, XP, costs or success chance.

## Search hints for agents
1. Resolve subsystem from rows above; use `rg --files <path>` or `rg -n '<symbol>' <path>`.
2. Read only changed domain invariants and their tests; check shared contracts when public shapes change.
3. For code reviews use `git diff --stat` followed by targeted `git diff -- <paths>`.
4. Do not dump full project tree, entire large files, all tests or logs to the conversation.
5. Update this map only if a path/contract/dependency actually changes.
