# Game design — modern Tibia-inspired browser idle

## Vision and audience
Text/UI-first idle MMORPG aimed at the classic Tibia community worldwide: **PL and EN from the first day**. One persistent character per active hunt. No character walking, keyboard control or game client download. Sessions are 1–5 minutes of decision-making, while hunts settle on the server even when logged out.

## Product principles
1. Player controls build, location, risk and economy; not frame-by-frame combat.
2. Both languages have identical mechanics and content.
3. No purchasable XP/drop boosts in MVP. No mandatory paid AFK duration.
4. Make hunts distinct: XP, profit, bestiary, rare drops and materials compete.
5. Visible reasons for efficiency changes: damage, resistances, potions, deaths.
6. Clearly mark estimates versus settled results. No hidden arbitrary online bonus.

## MVP gameplay (P01–P08)
- Four **archetypes**: melee defender, ranged specialist, offensive mage, sustain mage. Class names, skills, lore and presentation remain original unless license authorizes references.
- XP/level; melee weapon mastery, distance, shielding and magic progression based on actions; bounds and curves controlled by versioned configuration.
- 12 zones (goal), 36 creatures (goal), curated per-species loot, 120 base items (goal). Initial vertical slice has **1 class / 3 zones / 6 creatures / 12 items**, not 120 items at day one.
- Single active hunt; location with threat type, reward focus and required defensive preparation.
- Three strategies: safe / balanced / aggressive; strategy affects cast/defend/heal priorities and cost, not a free XP multiplier.
- HP/MP resources and auto-potion thresholds; stop conditions: death, insufficient consumables, requested stop, max idle window, loot handling limit.
- Offline progression must settle server-side, without browser/network; capped at 24h initially, 100% mechanical efficiency while resources last.
- Per-item ownership, rarity, equipment compare, inventory, loot filter; upgrades +0…+5 planned by P05.
- Bestiary kill stages and 3 starting charm archetypes; count only confirmed kills.
- Simple tasks and 3 solo bosses; marketplace with fixed-price offers and ledger-backed purchases; chat and leaderboards.

## Hunt flow
1. Server validates character ownership, equipment, resources, active session, and zone availability (`startHunt` in `packages/database/src/hunt-repository.ts`).
2. Snapshot hunt configuration, progression/equipment and **simulation version**; reserve real character potions (`hp_potions`, `mp_potions`), generate a server CSPRNG seed, and start an immutable run and checkpoint. One-time starter supplies (`250` HP / `150` MP potions) are granted once per character and never replenished for free on hunt restart.
3. On `settle` (`settleHunt`): read checkpoint, run deterministic simulation outside DB locks, then open a short transaction locking `characters` and `hunts` (`FOR UPDATE`), verify `row_version` and `(hunt_id, segment_key)` / `(hunt_id, start_checkpoint_version)` uniqueness, advance `settled_until` strictly by `deltaElapsedMs` (supporting partial settlement on `EVENT_BUDGET_EXHAUSTED` without losing remaining time), and persist XP/level, `currency_ledger`, `hunt_reward_items`, and the new checkpoint in **one transaction**.
4. Level-up rule: XP and character level update transactionally on settlement (`resolveLevelFromTotalXp`), while the active hunt's combat snapshot remains frozen until the next hunt starts so replay stays 100% deterministic.
5. Death & camp revival rule: if a character dies in combat (`CHARACTER_DIED`), the combat checkpoint records `currentHp = 0` and ends the hunt, while the character row revives at camp with full `max_hp`/`max_mp` (preserving `characters.hp > 0`) and returns any unused reserved potions once.
6. Refresh/retry, concurrent settlements, or pre/post-COMMIT crashes never duplicate rewards or potions.

## Balance model
Show estimates as ranges until sufficient events. Use controlled data and review balance tables separately from code. Specify per-zone expected XP/hour, net gold/hour after potions, deaths/24h, resource drain and loot distribution. Avoid tuning production mid-running session silently: change config/version with explicit cutover.

## Deterministic combat & replay engine (`IDLE-004A`)
- **Location:** `packages/domain/src/combat/` (`COMBAT_SIMULATION_VERSION = '1.0.0'`). Pure TypeScript domain functions with zero DB, HTTP, or `Math.random()` / `Date.now()` usage.
- **Stateful PRNG & security boundary:** 32-bit Mulberry32 (`createStatefulRng`) storing `{ seed, state, cursor }`. Server seeds are generated exclusively via cryptographic randomness (`generateCryptographicHuntSeed`); clients can never supply seeds, and public API projections (`toPublicHuntCheckpointView`, `assertNoRngLeakInPublicPayload`) strip `rng`/`seed`/`cursor` to prevent drop farming.
- **Immutable hunt configuration snapshot (`HuntConfigurationSnapshot`):** At hunt start ($t_0$), `createHuntConfigurationSnapshot` deeply freezes and fingerprints (`configDigest`) `simulationVersion`, `zoneId`, `strategy`, `timings`, `strategyProfile`, `zone`, `monsters`, `character` (with `equipment`), and `resources`. Any change to these parameters mid-hunt is rejected by `simulateHuntSegment` and requires starting a new hunt.
- **Discrete-event simulation, chunk equivalence & partial settlement:** `simulateHuntSegment` advances exact millisecond timers (`nextPassiveRegenInMs`, `activeEncounter.nextPlayerAttackInMs`, `activeEncounter.nextMonsterAttackInMs`, or `respawnCooldownRemainingMs`). Splitting a window at any boundary (`60m == 30m + 30m == irregular ms chunks`) or interrupting via `maxEventsPerCall` (`stopReason: 'EVENT_BUDGET_EXHAUSTED'`, `isPartialSettlement: true`, `unprocessedDurationMs`) preserves mid-encounter state and resumes to 100% bit-exact equivalence without losing time or duplicating rewards.
- **Resource validation & $O(1)$ consumables:** `validateCombatResources` enforces safe integer bounds (`hpPotionHealAmount >= 1`, `mpPotionRestoreAmount >= 1`, stacks in `[0, 1_000_000]`), rejecting zero/negative heals, `NaN`, or `Infinity`, while potion consumption uses $O(1)$ closed-form calculation to prevent loops.
- **Combat & strategy model (Knight vertical slice):**
  - Knight damage scales with `melee`, `weaponAttack`, `level`, strategy `attackFactorPermille`, optional `Brutal Strike` mana ability, and critical hit roll, mitigated by monster `defense` and `armor`.
  - Monster damage scales with `attack` and `armorPenetrationPermille`, mitigated by Knight `shielding * shieldDefense` (scaled by strategy `defenseFactorPermille`) and `totalArmor`.
  - Strategies (`safe`, `balanced`, `aggressive`) govern attack/defense stance, auto-potion thresholds, mana strike usage, and critical retreat when out of HP potions. No artificial XP or drop rate multipliers exist.
  - Per-kill loot (`rollMonsterKillLoot`) rolls gold `[goldMin, goldMax]` and per-item `chancePermille` strictly once upon confirmed monster death (`newMonsterHp <= 0`).

## Persistent inventory, backpack & AFK loot claim (`IDLE-005A`)
- **Capacity & Weight System:** Server-authoritative integer weight model (`1 oz = 1 integer weight unit`).
  - Base capacity and level progression per vocation:
    - **Knight:** `5000 + (level - 1) * 250` oz
    - **Paladin:** `4000 + (level - 1) * 200` oz
    - **Mage (Offensive / Sustain):** `3000 + (level - 1) * 100` oz
  - Every item definition has a fixed integer weight (e.g. `copper-coin: 1`, `rat-pelt: 5`, `chitin-plate: 20`, `rusted-blade: 250`, `silver-ring: 10`, `ritual-amulet: 25`). Note: `rusted-blade` is balanced at 250 oz.
- **Starting Backpack & Slots:** Characters are created with a 20-slot starting backpack container (`BACKPACK_STARTING_SLOTS = 20`, `slot_index` 0 to 19).
- **Stacking, Moving & Splitting:**
  - Stackable items stack up to `maxStackSize = 100` per slot. Non-stackable items occupy 1 item per slot.
  - Moving to an empty slot updates `slot_index`.
  - Moving to a matching stackable slot merges quantities up to `maxStackSize` (overflow stays in source).
  - Moving to a non-matching or full slot atomically swaps slot indices (using deferred database constraints).
  - Splitting a stack (`splitInventoryStack`) removes `splitQuantity` from the source slot and creates or adds to a target slot.
- **AFK Reward Inbox & Atomic Claims:**
  - Hunt loot settles into `hunt_reward_items` in state `UNCLAIMED`.
  - Players claim rewards individually into their backpack via `POST /characters/:id/hunt-rewards/:rewardId/claim`.
  - Server transaction locks the character and reward item (`FOR UPDATE`), verifies character ownership, checks weight capacity (`currentWeight + itemWeight <= maxWeight`) and slot availability, marks the reward `CLAIMED`, inserts/merges into `inventory_instances`, and records an immutable audit record in `inventory_movements` (`movement_type = CLAIM_HUNT_REWARD`).
  - Claim requests require client idempotency keys, guaranteeing zero item duplication across retries, reloads, and network drops.

## Equipment paperdoll & combat stats (`IDLE-005B`)
- **9 Paperdoll Equipment Slots:**
  - `helmet`, `amulet`, `weapon`, `armor`, `shield`, `ring`, `legs`, `boots`, `ammunition`.
  - Stored in persistent `equipment` container (`slot_capacity = 9`, `slot_index` 0 to 8).
- **Equipment & Weight Model:**
  - Total carried weight includes both backpack items and equipped items:
    $$\text{Total Carried Weight} = \sum \text{backpack item weights} + \sum \text{equipped item weights}$$
  - Equipping an item moves it between containers without changing total carried weight.
  - Claiming AFK rewards accounts for combined carried weight, preventing reward exploitation with heavy gear.
- **Combat Stats Calculation (`calculateEffectiveCombatStats`):**
  - Knight unequipped baseline: Weapon Attack `18`, Shield Defense `16`, Total Armor `10`, Crit Chance `50` permille (5.0%), Crit Multiplier `1250` permille (1.25x).
  - Equipped items contribute additive bonuses:
    - `rusted-blade`: Weapon Attack `+4` (req level 1, knight) $\rightarrow$ Effective Attack `22`.
    - `silver-ring`: Crit Chance `+20` permille (+2.0%) $\rightarrow$ Effective Crit Chance `70` permille (7.0%).
    - `ritual-amulet`: Total Armor `+3` $\rightarrow$ Effective Total Armor `13`.
  - Stat comparison in UI displays exact diffs (`+4 Attack`, etc.) when inspecting equippable items.
- **Active Hunt Safety Lock:**
  - Starting a hunt freezes equipment stats into `CombatCharacterSnapshot`.
  - Equip, unequip, and slot swap operations are strictly rejected (`ACTIVE_HUNT_LOCKED`, HTTP 409) while a character has an active hunt session.
  - Stopping the hunt completely restores the ability to modify equipment for the next hunt.

## Localization
Use keys, pluralization, locale-aware numbers and dates; avoid embedding English or Polish text in logic. Players can change locale anytime; account/global content IDs remain language-neutral. Initial locales `pl-PL`, `en-US`.

## Later (not MVP)
Full raid guilds, party mechanics, seasonal worlds, extensive charm matrix, imbuements/forge, personalized housing, advanced crafting, custom mobile notifications, multiple simultaneous activity slots.

## Unresolved decisions
Legal access to original Tibia assets/names; final content balance; premium model; maintenance and season policy; social moderation capacity. No protected assets in shipping bundle until written license.
