# Tibia-like Idle — professional starter kit

**Status: architecture and quality-gate starter, NOT a playable game.** Proposed product: a two-language (Polish + English), purely browser-based, text-and-icons idle MMORPG aimed at Tibia fans. No moving a character on a map and no downloadable client.

## First commands (Node.js 24 recommended)

```bash
npm run verify
```

The only runnable checks today validate documentation and PL/EN localization parity. Game unit/integration/E2E suites will be implemented with each feature; they are not yet present. No dependency installation is needed to run these first checks.

## Quick navigation
- [`AGENTS.md`](AGENTS.md): one canonical short instruction set for coding agents
- [`CLAUDE.md`](CLAUDE.md): Claude Code pointer
- [`PROJECT_MAP.md`](PROJECT_MAP.md): current / planned paths and context lookup
- [`docs/ROADMAP.md`](docs/ROADMAP.md): build order, IDs and definition of done
- [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md): product and mechanics
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): technical choices and server invariants
- [`docs/TEST_STRATEGY.md`](docs/TEST_STRATEGY.md): test plan and PR gates
- [`docs/AI_EFFICIENCY.md`](docs/AI_EFFICIENCY.md): reduce repeated token consumption
- [`docs/START_PROMPT.md`](docs/START_PROMPT.md): first prompt to Claude/Codex

## Scope and licensing
No Tibia graphics or other protected assets are shipped. Before including original sprites, obtain appropriate written permission from the rights holder; see [`docs/LEGAL_ASSETS.md`](docs/LEGAL_ASSETS.md).

## Workflow
Each task uses an issue ID, small branch/PR and acceptance tests. The user approves merge and production deployment separately. See [`docs/WORKFLOW.md`](docs/WORKFLOW.md).
