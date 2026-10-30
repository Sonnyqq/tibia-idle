# Session handoff (overwrite with newest factual state)

Updated: 2026-10-30
Repository: https://github.com/Sonnyqq/tibia-idle (private), Draft PR #1 (`feat/idle-001-scaffold` -> `main`)
Current phase: P01 — TypeScript strict monorepo scaffold (`IDLE-001`)
Current task: IDLE-001 (all local gates + live PostgreSQL PASS; remote GitHub Actions blocked by account Actions budget for private repos)
What exists: pnpm workspace (`apps/web`, `apps/api`, `packages/domain`, `packages/contracts`, `packages/database`, `packages/i18n`), strict TS, ESLint, Fastify health/readiness/i18n API, React+Vite PL/EN scaffold UI, PostgreSQL pool + `0001_schema_migrations.sql` runner with SHA-256 checksum & rollback verification, tooling/unit/integration/E2E tests, CI workflow with Postgres 16
What does NOT exist: auth/accounts/characters (`IDLE-002`), gameplay mechanics (`P02+`), production deploy
Blockers: GitHub Actions on private repo `Sonnyqq/tibia-idle` failed to start job (`The job was not started because an Actions budget is preventing further use`); written IP permission required before any original Tibia assets
Next task: Unblock GitHub Actions budget/runner for private repo to turn remote CI green, then owner approval to merge PR #1 and start `IDLE-002`
Last verified test evidence: local `REQUIRE_DB_TESTS=1 pnpm run ci:local` against live PostgreSQL 18.6 — docs 17/17 PASS, tooling 11/11 PASS, lint PASS, typecheck PASS, build PASS, unit 9/9 PASS, integration 2/2 PASS (0 skipped), E2E 1/1 PASS
