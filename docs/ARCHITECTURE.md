# Architecture — modular monolith, scale by measurement

## Stack decisions (proposed before dependency install)
- Monorepo TypeScript strict, Node.js 24 LTS, React + Vite web, Node API framework (choose in ADR during P01), PostgreSQL from the first feature that persists data.
- Prefer **one backend deployable** over microservices. API and background settlement workers share a domain package and database; use queue/lease locking only if measured needs justify it.
- Socket.IO optional for online notifications; ordinary REST/HTTP endpoints must work independently. Never require a WebSocket connection for offline progress.
- Hosted on VPS, environment-based secrets. Migrations versioned, reversible when feasible, tested against real PostgreSQL (not mocked SQL).

## Ownership layers
- `apps/web`: UI/routing; sends intents only and shows authoritative snapshot/estimates; translations.
- `apps/api`: authentication, authorization, validation, rate limiting, orchestration; no gameplay equations in routes.
- `packages/contracts`: API payloads, schema validation, event types and version compatibility.
- `packages/domain`: pure functions for combat, XP, loot, skills, bestiary, pricing and stop conditions. Inject clock/RNG and balance config.
- `packages/database`: SQL/migrations, optimistic version/locking, transactions, ledger and persistence.
- `packages/i18n`: shared translation keys/locales; no gameplay rule duplication per locale.

## Invariants
1. Server time only; session start, checkpoint and stop dates are server-defined.
2. At most one active hunt per character; enforce DB uniqueness and concurrency tests.
3. Settlement idempotency: unique `(hunt_id, segment_key)`, transactional checkpoint advance with rewards. Never grant before recording the checkpoint.
4. Single atomic transfer for item/gold trades; balances cannot become negative. Full provenance on valuable assets.
5. Backend validates character ownership, zone requirements, quantity bounds, balance config version, random seed state, and market quote.
6. Readable snapshots and short-lived transactions; no unbounded lock inside combat simulation. Compute tentative event data outside lock using versioned immutable snapshot; compare-and-swap state inside transaction or retry with fresh state.
7. Configuration versions allow deterministic replay. Record enough compact audit information to explain changed balances; cap retention with privacy plan.
8. Kill event counters for tasks, bestiary and loot derive from the same settled event stream, avoiding double count.
9. On crash/restart, unfinished work is safely retried from last committed checkpoint, without double rewards.

## API sketch (contracts only, not implemented)
- `POST /auth/register`, `/auth/login`, `/auth/logout`
- `GET /me`, `GET /characters/:id`, `GET /zones`
- `POST /characters/:id/hunts` (start) ; `POST /hunts/:id/settle` (idempotent client retry safe) ; `POST /hunts/:id/stop` ; `GET /hunts/:id`
- `GET /inventory`, `POST /equipment/equip`; `GET /bestiary`, `GET /tasks`
- `GET /market/offers`, `POST /market/offers`, `POST /market/offers/:id/buy`
- Implement request-id / idempotency-key semantics in sensitive POST actions; authorization is mandatory.

## Operational requirements
- Health/readiness separate from HTTP socket availability, graceful SIGTERM + scheduled settlement recovery, PostgreSQL backup+restore drills, schema compatibility across rollouts, feature flags for risky mechanics.
- Observability: error rate, API p95, DB lock p95, settlement retries/duplication attempts, p95 settlement duration, economy imbalance indicators, scriptable smoke checks.
- No absolute perf SLA claimed without measuring actual deployment. Establish baselines P02 and enforce regression budgets.

## Asset/legal boundary
No Tibia graphic/audio client resources committed, served or downloaded by the app without written rights confirmation. See `LEGAL_ASSETS.md`.
