# Prioritized initial issues (no implementation yet)

## IDLE-001 — scaffold TypeScript strict monorepo [P01]
**Acceptance:** repeatable pnpm install/build, format/lint/typecheck, test runner; `apps/web`, `apps/api`, domain/contracts/db/i18n packages; CI checks do not silently skip missing suites; documentation and map updated accurately.
**Tests:** smoke boot, typecheck, package dependency boundary test, CI local script.

## IDLE-002 — PostgreSQL test infra, migrations, auth [P01]
**Acceptance:** isolated integration DB seeded/reset each run; versioned migrations; register/login/logout; server-side role+ownership checks; credential/session security.
**Tests:** auth unit, DB integration, hostile inputs/IDOR/rate limits, concurrent login, migration up + recovery.

## IDLE-003 — localized responsive shell [P01]
**Acceptance:** PL/EN switch persists; mobile bottom nav and desktop shell; register/character/zone list UI; no hardcoded user-facing copy.
**Tests:** i18n parity, browser E2E in desktop/mobile, accessibility baseline.

## IDLE-004 — deterministic hunt engine [P02]
**Acceptance:** 1 class, 3 zones, 6 creatures, 12 items; stable seed produces same reward sequence; combat and stop cases testable without DB.
**Tests:** unit boundaries, property, replay, death/low potion, drop distribution expectations.

## IDLE-005 — checkpointed offline settlement [P02]
**Acceptance:** close browser and return; server timestamp; exactly-once rewards across concurrent requests/crashes; max 24h; persisted skill/loot/bestiary counters.
**Tests:** real-DB race x2 workers, SIGTERM/crash before/after commit, corrupted client timestamp, E2E reconnect.

## IDLE-006 — inventory and market transactional foundations [P04/P06]
**Acceptance:** single item owner, safe escrow, atomic purchases/refunds, balanced ledger; economy metrics.
**Tests:** cancel/buy races, double purchase, interrupted transaction, no gold negative, exact reconciliation.
