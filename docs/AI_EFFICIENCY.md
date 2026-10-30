# Agent efficiency — fewer tokens without weakening quality

## Context budget
- Root `AGENTS.md`: brief permanent constraints; `CLAUDE.md`: short entrypoint. Do not copy large architecture docs into auto-loaded instruction files.
- `PROJECT_MAP.md` is the **routing index**, not the entire project history. Keep it short, updated only when code layout changes.
- Each task begins with its task ID and affected subsystem; read only 1–3 relevant docs and files rather than broad repo dumps.
- Use `rg --files path`, `rg -n 'symbol' path`, `git diff --stat`, targeted `git diff -- path`, `sed -n 'start,endp' file` when appropriate.
- Prefer per-command output capped to significant failures + summary; write logs to local artifacts, inspect only failing sections.
- Do not paste successful full test logs, giant stack traces, base64/images or unfiltered git history into prompts.

## Agent work cadence
1. **PLAN (tiny):** issue ID, path references, risks, one measurable acceptance criterion.
2. **IMPLEMENT:** one small cohesive PR. Use existing patterns, no speculative refactoring.
3. **VERIFY:** targeted tests on changed modules, then CI complete gate once per ready PR.
4. **HANDOFF:** single Polish code block of <=25 lines; update `SESSION_STATE.md` once per session.
5. **NEXT SESSION:** new conversation; start from short handoff/issue, not prior full transcript. With Claude Code, clearing context between unrelated tasks may reduce irrelevant history.

## Avoid false economies
- Do not avoid DB/race/recovery tests to save tokens. Savings come from targeted exploration and automated checks, not skipping quality gates.
- Do not summarize away real failures; give failing test ID + exact error excerpt + path to full log.
- Do not introduce recursive documentation requirements that consume more tokens than feature code.
- Never claim deterministic identical results from approximate batched simulation without explicit equivalence tests.

## Suggested prompt format (cheap)
```
TASK: IDLE-002 — idempotent settlement
SCOPE: domain/hunt, api/hunts, database/hunts
READ: PROJECT_MAP.md and linked hunt invariants only
ACCEPT: concurrency+crash+repeat-settle tests PASS
LIMITS: no production deploy, no unrelated code changes
REPORT: one Polish fenced code block, <=25 lines
```

## Multiple agent usage
Use one primary implementer. Additional reviewer only for security-critical transfers or independent high-risk correctness review; no redundant full-repo audits by multiple agents.
