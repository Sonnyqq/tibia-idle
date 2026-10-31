# Data model — planned relational schema (PostgreSQL)

This is a **design checklist**, not a migration that has already been implemented. Build schema incrementally by roadmap milestone.

| Entity | Main fields / integrity |
|---|---|
| `accounts` | UUID, email unique, password hash, locale, created_at, status |
| `sessions` | account FK, securely hashed refresh token, expiry, revocation |
| `characters` | UUID, account FK, class, level, xp (`<= 9007199254740991`), gold balance (`<= 9007199254740991`), `hp_potions`, `mp_potions`, `starter_supplies_granted_at`, `row_version` (`0002`+`0003`) |
| `skills` | character FK, skill code, experience, level, unique(character, skill) |
| `zones`, `creatures`, `items_catalog` | stable versioned IDs, balance-data version, localized display keys |
| `inventory_containers` | UUID, `character_id` FK, `container_type` (`backpack`/`equipment`), `slot_capacity` (20 for starting backpack, 9 for equipment paperdoll), `row_version`, `created_at` (`0004`+`0005`) |
| `inventory_instances` | instance UUID, `character_id` FK, `container_id` FK, `item_id`, `quantity` (`CHECK quantity > 0 AND quantity <= 100`), `slot_index` (`CHECK slot_index >= 0`), `UNIQUE (container_id, slot_index) DEFERRABLE INITIALLY DEFERRED`, `row_version`, `created_at`, `updated_at` (`0004`+`0005`) |
| `inventory_movements` | immutable audit UUID, `character_id` FK, `movement_type` (`CLAIM_HUNT_REWARD`/`MOVE_ITEM`/`SPLIT_STACK`/`MERGE_STACK`/`SWAP_SLOTS`/`EQUIP_ITEM`/`UNEQUIP_ITEM`/`SWAP_EQUIPMENT`), `item_id`, `quantity`, `source_container_id`, `source_slot`, `target_container_id`, `target_slot`, `idempotency_key` (`UNIQUE (character_id, movement_type, idempotency_key)`), `created_at` (`0004`+`0005`) |
| `hunts` | hunt UUID, `character_id`, `start_idempotency_key`, `zone_id`, `strategy`, `status` (`ACTIVE`/`COMPLETED`), `stop_reason`, `started_at`, `settled_until`, `completed_at`, `simulation_version`, `config_digest`, `private_checkpoint` JSONB, `reserved_hp_potions`, `reserved_mp_potions`, `potions_returned`, `row_version` (`0003`) |
| `hunt_segments` | segment UUID, `hunt_id` FK, `segment_key` (`UNIQUE (hunt_id, segment_key)`), `start_checkpoint_version` (`UNIQUE (hunt_id, start_checkpoint_version)`), `end_checkpoint_version`, `segment_from`, `segment_to`, `processed_duration_ms`, `simulated_events`, `stop_reason`, `is_partial`, `rewards` JSONB, `committed_at` (`0003`) |
| `hunt_reward_items` | reward UUID, `hunt_id` FK, `hunt_segment_id` FK, `character_id` FK, `item_id` (`UNIQUE (hunt_segment_id, item_id)`), `quantity`, `ownership_state` (`UNCLAIMED`/`CLAIMED`), `claimed_at`, `created_at` (`0003`) |
| `currency_ledger` | immutable transfer UUID, `character_id` FK, `source_type` (`CHARACTER_INITIAL_GRANT`/`HUNT_SETTLEMENT`), `source_id` (`UNIQUE (character_id, source_type, source_id)`), `amount`, `balance_after`, `transaction_type` (`CREDIT`/`DEBIT`), `created_at` (`0003`) |
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
