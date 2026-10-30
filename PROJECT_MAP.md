# PROJECT_MAP.md — fast index (keep <= ~180 lines)

**Status key:** EXISTS = files currently in starter; PLANNED = implement in milestone; DO NOT read empty directories looking for code.

| Area | Path | Status | Read next | Dependencies |
|---|---|---|---|---|
| Agent policy | `AGENTS.md`, `CLAUDE.md` | EXISTS | `docs/AI_EFFICIENCY.md` | all |
| Project phases | `docs/ROADMAP.md` | EXISTS | `docs/tasks/BACKLOG.md` | all |
| Product rules | `docs/GAME_DESIGN.md` | EXISTS | `docs/DATA_MODEL.md` | domain |
| Architecture | `docs/ARCHITECTURE.md` | EXISTS | `docs/DECISIONS.md` | all |
| Test gates | `docs/TEST_STRATEGY.md` | EXISTS | `docs/WORKFLOW.md` | all |
| Locales | `packages/i18n/locales/*.json` | EXISTS | `tests/tooling/i18n.test.mjs` | web/api |
| Documentation checks | `scripts/check-docs.mjs` | EXISTS | `tests/tooling/guardrails.test.mjs` | CI |
| Web UI | `apps/web/` | PLANNED (P01) | game design: UI | contracts/i18n |
| API/auth | `apps/api/` | PLANNED (P01) | architecture: auth/API | domain/db/contracts |
| Domain engine | `packages/domain/` | PLANNED (P02+) | game design: hunts | contracts |
| Database/migrations | `packages/database/` | PLANNED (P01) | data model | domain/contracts |
| DTO/contracts | `packages/contracts/` | PLANNED (P01) | architecture: API | i18n/web/api |
| Backend integration | `tests/integration/` | PLANNED (P01+) | test strategy | api/db |
| Browser E2E | `tests/e2e/` | PLANNED (P01+) | test strategy | web/api |
| Load and recovery | `tests/perf/` | PLANNED (P02+) | test strategy | api/db/domain |
| Licensed art registry | `assets/` | EXISTS (rules only) | `docs/LEGAL_ASSETS.md` | web |
| CI initial verification | `.github/workflows/verify.yml` | EXISTS | `docs/TEST_STRATEGY.md` | tests/tooling |

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
