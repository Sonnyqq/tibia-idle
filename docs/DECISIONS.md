# Architecture decision record (brief log)

| ID | Status | Decision | Reason | Revisit |
|---|---|---|---|---|
| ADR-001 | PROPOSED | New isolated repository; do not share production DB with Grimvane | Independent releases and economy safety | after setup |
| ADR-002 | PROPOSED | TypeScript strict modular monolith; React+Vite, Node API | Reduce accidental complexity / future migration | P01 |
| ADR-003 | PROPOSED | PostgreSQL from start of persisted gameplay | Atomic trades and concurrency without later SQLite migration | P01 |
| ADR-004 | REQUIRED | Server-authoritative deterministic and checkpointed offline settlement | Avoid dupes, abuse and regression | P02 |
| ADR-005 | REQUIRED | PL/EN i18n keys and parity gates since first UI | No localization retrofit | P01 |
| ADR-006 | REQUIRED | No unauthorized Tibia sprites/assets | Legal and product release risk | before public asset usage |

Record new meaningful decisions as new small ADRs only if their impact is lasting (schema, API, security, deployment). Don't append routine coding details here.
