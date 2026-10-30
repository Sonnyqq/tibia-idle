# Test strategy — feature-by-feature TDD + release gates

## Honest current status
In P01 (`IDLE-001`, `IDLE-002`, `IDLE-003` / `IDLE-003B`), repository guardrails, PL/EN parity checks, strict TypeScript/ESLint checks, unit tests (`packages/domain`, `packages/contracts`, `packages/database`, `packages/i18n`, `apps/api` security, `apps/web` Tibia-client UI components & SSR), live PostgreSQL integration tests (migrations `0001`+`0002`, Argon2id auth, hashed HttpOnly sessions, CSRF, character slot limits & concurrency races, read-only `/zones`), and Playwright browser E2E tests (desktop `1440x900`/`1280x800` & mobile `768px`/`390px`/`320px`, 10 visual QA screenshots in `test-results/screenshots/`) are active. **Combat simulation, offline hunt settlement, inventory item movement, and market tests do not exist until P02+.** Never report FULL PASS for code that does not exist.

## Test ladder
| Layer | When | Real dependencies | Examples |
|---|---|---|---|
| Unit (domain) | Every gameplay change / FAST | none | combat, XP, loot, skills, resource use, stop rules, deterministic RNG |
| Property/invariants | Critical mechanics / FAST or PR | none | never negative resources, bounded drop outcomes, replay equivalence |
| Integration (DB/API) | Every stateful feature / PR | real isolated PostgreSQL | auth, hunt checkpoint, inventory, market, migrations |
| Contract + i18n | Every public endpoint or copy change | schemas / locales | DTO compatibility, PL/EN key and plural parity |
| E2E browser | Each player journey / PR | API + DB + Chrome | register, character, start hunt, log out, return, settle, equip, sell |
| Concurrency/recovery | Hunt, inventory, market / PR | real DB, 2+ workers | double settle, simultaneous buys, SIGTERM, retry after crash |
| Load/performance | Baseline and risky changes / release | staging-like deployment | N simultaneous settlements, DB locks, API p95, background jobs |
| Security/abuse | Every relevant feature / PR | API + DB | broken auth, IDOR, tampered timestamps/price, rate limit, CSRF/XSS |
| Backup/migration | Migration or release | temporary DB and backup | upgrade, restore, compatible rollback |

## New feature minimum test checklist
1. Happy path and boundary checks; invalid/unauthorized input.
2. Multilingual UX labels PL/EN, including missing keys and number formatting.
3. Persist/reload without losing state; no duplicate events on retries.
4. Feature interactions: XP+skills+loot+bestiary+tasks+inventory capacity where applicable.
5. One regression that reproduces original bug before fix (for defect tasks).
6. User-observable E2E for changed journey; mobile viewport when UI changes.
7. Evidence: exact commands, passed/failed/skipped, environment and commit SHA.

## Release gates and cost controls
**DEV FAST:** run targeted unit/contract and touched integrations after edits; only short failure snippets.
**PR READY:** CI runs lint + typecheck + unit + DB integration + contracts + E2E smoke, plus relevant recovery/security tests, migration testing. Sensitive systems require race tests. Do not merge on FAIL or uninvestigated flakes.
**NIGHTLY / PRE-RELEASE FULL:** all test suites, concurrency+recovery+load, browser desktop/mobile, backup/restore and migration drills. Manual approval before deploy.
**POST DEPLOY:** health/readiness + core smoke + metrics comparison; rollback documented and tested.

## Critical test matrices

### Offline hunts
- start -> close browser -> return, never requiring the client to stay online
- 0 elapsed, 1s, 24h cap, 24h+; server clock not browser clock
- exhaustion potions, death, full bag, stop pressed concurrently with settle
- 2 parallel settle calls, 2 workers, process crash before/after COMMIT
- equal seed/config/snapshot produces same results; config version changes are controlled
- payout and bestiary/task progress occur exactly once; restart resumes checkpoint

### Market and inventory
- simultaneous buyers of last item; listing while equipping; cancel vs buy race
- insufficient gold, invalid price, fee math rounding, malicious quantities
- payment success but item transfer failure rolled back as one transaction
- one unique owner for each item; escrow cannot be spent twice; ledger reconciles

### XP and progression
- level thresholds, overflow, max skill bounds, no client kill spoofing
- skill progress determined by authoritative actions and consistent after replay

### Performance and acceptance (targets to validate)
- Define measured performance targets in P02 after baseline, before implementation optimization. Do not invent a stable p95 or promise 5000 active sessions without tests.
- Store profiling artifacts and a compact pass/fail summary, not megabytes of raw logs in PR comments.

## Current P01 verification commands
- `pnpm run check:docs` — project documentation, references and instruction size budgets
- `pnpm run test:tooling` — node built-in tests for guardrails, layer boundaries and PL/EN locale parity
- `pnpm run lint` & `pnpm run typecheck` — strict ESLint and TypeScript build/typecheck across all workspaces
- `pnpm run test:unit` — Vitest unit & SSR component suites
- `REQUIRE_DB_TESTS=1 pnpm run test:integration` — Vitest integration, security & race suites against live PostgreSQL
- `pnpm run test:e2e` — Playwright browser E2E & visual QA screenshots (`test-results/screenshots/`)
- `REQUIRE_DB_TESTS=1 pnpm run ci:local` — full local quality gate (`verify` + `test:e2e`)
