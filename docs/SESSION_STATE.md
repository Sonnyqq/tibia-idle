# Session handoff (overwrite with newest factual state)

Updated: 2026-10-30
Repository: https://github.com/Sonnyqq/tibia-idle (private), branch `feat/idle-001-scaffold`
Current phase: P01 — TypeScript strict monorepo scaffold (`IDLE-001`)
Current task: IDLE-001 (Draft PR open against `main`, awaiting merge approval)
What exists: pnpm workspace (`apps/web`, `apps/api`, `packages/domain`, `packages/contracts`, `packages/database`, `packages/i18n`), strict TS, ESLint, Fastify health/readiness/i18n API, React+Vite PL/EN scaffold UI, PostgreSQL pool + `0001_schema_migrations.sql` runner with SHA-256 checksum & rollback verification, tooling/unit/integration/E2E tests, CI with Postgres 16
What does NOT exist: auth/accounts/characters (`IDLE-002`), gameplay mechanics (`P02+`), production deploy
Blockers: written IP permission required before any original Tibia assets; owner approval required before merging `IDLE-001` Draft PR
Next task: IDLE-002 — PostgreSQL test infra, migrations, auth (`docs/tasks/BACKLOG.md`)
Last verified test evidence: `REQUIRE_DB_TESTS=1 pnpm run ci:local` — docs PASS (17/17), tooling 11/11 PASS, lint PASS, typecheck PASS, build PASS, unit 9/9 PASS, integration 2/2 PASS (0 skipped, live PostgreSQL), E2E 1/1 PASS
