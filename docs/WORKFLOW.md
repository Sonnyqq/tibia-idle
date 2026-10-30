# Development workflow — no surprise merges/deploys

## Issue and PR scope
- Each issue ID describes one measurable feature or fix, e.g. `IDLE-002`. Branch naming: `feat/idle-002-settlement`.
- PR body: problem, acceptance criteria, module boundary, migrations, tests+proof, runtime metrics if sensitive, rollback/feature flag, screenshots for UI, PL/EN review.
- Normal flow: draft PR -> focused tests -> full CI -> independent review for sensitive changes -> owner says merge -> explicit staging/prod deploy approval.
- Never force-push shared branch without coordination. Never edit Grimvane or its databases.

## Definition of done
- All acceptance criteria done, current code and docs match, versioned migrations, no unhandled security errors, both languages present.
- Unit/integration/e2e at appropriate layer (see tests strategy), all required CI gates pass; no unexplained flakiness.
- High-risk (economy, hunt, auth) has rollback plan and race/recovery tests.
- Status in report reflects reality: `NOT STARTED`, `DRAFT`, `READY WITH RISKS`, `GO`, `MERGED`, `DEPLOYED`.

## Safe report (mobile copy/paste)
```text
TASK: IDLE-XXX
STATUS: DRAFT / READY WITH RISKS / GO
BRANCH/SHA: ...
CHANGED: ...
TESTS: unit X/Y, integration X/Y, E2E X/Y, FULL PASS/FAIL/NOT RUN
RISKS: ...
MIGRATION: ...
NEXT: ...
MERGE: NOT DONE
DEPLOY: NOT DONE
```

## Documentation update policy
- `PROJECT_MAP.md`: paths/ownership changed only.
- `ROADMAP.md`: milestone/task status changed only.
- `SESSION_STATE.md`: once at handoff or end of session.
- `DECISIONS.md`: only architectural/long-term changes.
- Avoid writing duplicate changelogs, daily summaries and huge retroactive reports.
