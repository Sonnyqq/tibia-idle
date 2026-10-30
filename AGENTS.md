# AGENTS.md — Tibia-like Browser Idle (canonical instructions)

Mission: build an independent **PL/EN**, 100%-browser, text/UI-driven idle MMORPG. No manual character movement; server-authoritative offline hunts, loot, skills, bestiary, market. This is a NEW repository, separate from Grimvane.

## Start of every task (token-light)
1. Read `PROJECT_MAP.md` (index), then only the relevant subsystem docs and code. Do **not** scan the entire repository by default.
2. Read `docs/SESSION_STATE.md` only if continuing unfinished work; read `docs/ROADMAP.md` when choosing a new milestone.
3. State task ID, scope, affected files, risks, tests in <=8 lines. If the user already gave scope, proceed; do not repeatedly ask.
4. Search with paths/symbols first; open specific ranges. No repeated whole-file dumps, no huge logs, no unnecessary web research.

## Non-negotiable engineering rules
- Keep a TypeScript `strict` modular monolith: `apps/web`, `apps/api`, `packages/domain`, `packages/database`, `packages/contracts`, `packages/i18n` (see architecture).
- Gameplay calculations, drops, XP, skills, resource consumption, market transfers and offline duration are **server authoritative**. Never trust client timestamps, prices, quantities or RNG.
- Domain logic must be deterministic/testable, independent of HTTP, DB, sockets or UI. Use injected clock/RNG and versioned simulation rules.
- Persist offline hunt checkpoints transactionally with idempotency keys; never grant the same rewards twice. Test reconnects, crashes and concurrent settlements.
- For item/gold movement: atomic DB transaction, consistent ledger/audit, no partial writes or negative balances.
- PL/EN parity from the first feature; all UI labels and player-facing messages use translation keys, never hard-coded language strings.
- Security: validate inputs, authorize ownership server-side, rate-limit writes, protect auth/session tokens, redact personal data in logs.
- Asset policy: **no bundled copyrighted Tibia sprites, names, music or client resources without documented permission**. See `docs/LEGAL_ASSETS.md`. References in design are not licenses.
- No silent gameplay/economy rebalance, breaking schema changes, main branch pushes or production deploys. Use migration, rollout plan and approval.
- No unnecessary abstraction/dependency/large refactor. Prefer simple existing patterns and small changes.

## Tests and gates
- New behavior: failing or clearly specified test first; unit + relevant integration/contract cases; E2E for player flows; i18n for new texts.
- FAST while editing: tests scoped to changed module and `npm run verify` for the current starter. Use targeted test outputs, not full pasted logs.
- BEFORE marking PR READY: typecheck, lint, all impacted tests, schema migration up/down, full regression CI, security/abuse checks for sensitive features. Do not call GO with unverified gates.
- Critical areas (hunt settlement, inventory, currency, marketplace) require concurrency/idempotency/property and restart/recovery tests. See `docs/TEST_STRATEGY.md`.
- The initial kit contains tooling/i18n tests only: do not claim gameplay tests exist before gameplay implementation.

## Work protocol (low token usage)
- One task/PR = one bounded goal; no opportunistic changes. Branch: `feat/<id>-slug` / `fix/<id>-slug`.
- Read **only** `PROJECT_MAP.md` and related subsystem files; use symbols and short diffs, not entire directories.
- After edits: run targeted tests; summarize failing cases in <=10 lines. Full tests run in CI at PR gate, not after every tiny edit.
- Update `PROJECT_MAP.md` **only when paths/interfaces change**, `docs/DECISIONS.md` only for material design decisions, `docs/SESSION_STATE.md` at task handoff, and `docs/ROADMAP.md` when milestone state changes. No daily doc rewriting.
- Avoid unnecessary parallel subagents and long chain-of-thought reports. Ask a second agent only for isolated substantial work/review.
- End with a **single copyable fenced code block** in Polish, <=25 lines: `TASK`, `BRANCH/SHA`, `CHANGED`, `TESTS PASS/FAIL/SKIPPED`, `RISKS`, `NEXT`, `MERGE/DEPLOY: NOT DONE or explicit status`. Never invent test results or claim deployment.

## Documentation routing
- `PROJECT_MAP.md` — where to look, dependencies, ownership
- `docs/ARCHITECTURE.md` — constraints, transactions and event flow
- `docs/GAME_DESIGN.md` — gameplay rules and content limits
- `docs/DATA_MODEL.md` — proposed persistent entities and invariants
- `docs/TEST_STRATEGY.md` — acceptance, test matrix and execution gates
- `docs/AI_EFFICIENCY.md` — search/context budgets and session handoffs
- `docs/ROADMAP.md` — tasks, sequence, completion criteria
- `docs/LEGAL_ASSETS.md` — licensing and original IP guardrails
