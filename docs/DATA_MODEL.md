# Data model — planned relational schema (PostgreSQL)

This is a **design checklist**, not a migration that has already been implemented. Build schema incrementally by roadmap milestone.

| Entity | Main fields / integrity |
|---|---|
| `accounts` | UUID, email unique, password hash, locale, created_at, status |
| `sessions` | account FK, securely hashed refresh token, expiry, revocation |
| `characters` | UUID, account FK, class, level, xp, gold balance, row version |
| `skills` | character FK, skill code, experience, level, unique(character, skill) |
| `zones`, `creatures`, `items_catalog` | stable versioned IDs, balance-data version, localized display keys |
| `inventory_instances` | instance UUID, item code, owner character, properties, stack count, version |
| `hunts` | hunt UUID, character, zone, start, settled_until, stop, seed, simulation version, status |
| `hunt_segments` | hunt FK, deterministic segment ID unique, input digest, result digest, committed_at |
| `loot_events` | unique event ID, hunt segment FK, item instance/ref, quantity |
| `currency_ledger` | immutable transfer ID, source/sink/ref, amount, reason, committed_at |
| `bestiary_progress` | character + creature unique, confirmed kill count, unlocked tiers |
| `tasks_progress` | character/task unique, last accepted event or waterline |
| `market_offers` | item instance escrow, seller, price, status, buyer, version |
| `audit_events` | category, correlation id, actor, purpose, safely redacted payload |

## Hard DB invariants
- `hunts` partial unique index: only one `status='ACTIVE'` per character.
- `hunt_segments(hunt_id, segment_id)` unique; payout checkpoint and rewards in one transaction; retry same segment returns prior result.
- Market listing moves item to escrow atomically; purchase transfers currency and item ownership atomically; canceled listing returns item once.
- Foreign keys, CHECK constraints (positive quantities, nonnegative balances where stored), unique item instance ownership, version checks for conflicting writes.
- Index query hot paths: `hunts(character_id,status)`, `market_offers(status,item_code,price)`, item owner, bestiary character and ledger correlation.
- Economy journal must support reconciliation from immutable records; document fees, system mints and sinks.
- Migrations require up test + smoke + rollback/forward recovery plan; never fake existing schema in tests.
