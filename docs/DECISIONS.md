# Architecture decision record (brief log)

| ID | Status | Decision | Reason | Revisit |
|---|---|---|---|---|
| ADR-001 | ACCEPTED | New isolated repository; do not share production DB with Grimvane | Independent releases and economy safety | after setup |
| ADR-002 | ACCEPTED | TypeScript strict modular monolith (`pnpm` workspaces); React+Vite, Fastify API | Reduce accidental complexity / enforce strict layer boundaries | P02 |
| ADR-003 | ACCEPTED | PostgreSQL (`pg` + versioned SQL migrations with SHA-256 ledger) from start | Atomic trades and concurrency without later SQLite migration | P02 |
| ADR-004 | REQUIRED | Server-authoritative deterministic and checkpointed offline settlement | Avoid dupes, abuse and regression | P02 |
| ADR-005 | ACCEPTED | PL/EN i18n keys (`@tibia-idle/i18n`) and parity gates since first UI | No localization retrofit | P02 |
| ADR-006 | REQUIRED | No unauthorized Tibia sprites/assets | Legal and product release risk | before public asset usage |
| ADR-007 | ACCEPTED | Fastify for `apps/api`, `zod` for `packages/contracts`, Vitest + Playwright for test gates | Fast schema validation, non-noop unit/integration/E2E gates | P02 |
| ADR-008 | ACCEPTED | Out-of-transaction combat simulation + short `FOR UPDATE` / `row_version` PostgreSQL settlement commit (`0003`) | Avoid long DB locks during 24h simulations while guaranteeing zero double rewards, atomic ledger/loot/XP, and camp revival (`HP=0 -> max_hp`) | P03 |

Record new meaningful decisions as new small ADRs only if their impact is lasting (schema, API, security, deployment). Don't append routine coding details here.
