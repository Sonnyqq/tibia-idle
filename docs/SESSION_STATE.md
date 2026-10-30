# Session handoff (overwrite with newest factual state)

Updated: 2026-10-30
Repository: local git repo (`d:\tibia idle`), branch `feat/idle-001-scaffold` (remote origin not yet configured)
Current phase: P01 — TypeScript strict monorepo scaffold (`IDLE-001`)
Current task: IDLE-001 (implemented on `feat/idle-001-scaffold`, ready for Draft PR)
What exists: pnpm workspace (`apps/web`, `apps/api`, `packages/domain`, `packages/contracts`, `packages/database`, `packages/i18n`), strict TS, ESLint, Fastify health/readiness/i18n API, React+Vite PL/EN scaffold UI, PostgreSQL pool + `0001_schema_migrations.sql` runner, tooling/unit/integration/E2E tests, CI with Postgres 16
What does NOT exist: auth/accounts/characters (`IDLE-002`), gameplay mechanics (`P02+`), local PostgreSQL/Docker service on host, remote GitHub push/deploy
Blockers: local PostgreSQL or Docker installation required for local live-DB test execution; remote GitHub repository URL needed to push Draft PR; written IP permission required before any Tibia assets
Next task: IDLE-002 — PostgreSQL test infra, migrations, auth (`docs/tasks/BACKLOG.md`)
Last verified test evidence: `pnpm run ci:local` — docs PASS, tooling 10/10 PASS, lint PASS, typecheck PASS, unit 9/9 PASS, integration 1/2 PASS (1 skipped without local Postgres), E2E 1/1 PASS
