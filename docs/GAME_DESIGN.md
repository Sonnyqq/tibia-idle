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
1. Server validates character ownership, equipment, resources, active session, and zone availability.
2. Snapshot hunt configuration, progression/equipment and **simulation version**; start immutable run and checkpoint.
3. On `settle`: lock character/session, advance from `settled_until` to min(serverNow, stop window), apply time/kill/resource rules and deterministic seeded RNG, record kill event aggregates and transfers.
4. Persist net XP/gold/items/resources/bestiary deltas and checkpoint in **one transaction**, with unique settlement id.
5. Return structured summary and update UI. Refresh/retry must not duplicate rewards.
6. Buff/potion expiry, deaths, full inventory, end of maximum offline time terminate a segment deterministically.

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

## Localization
Use keys, pluralization, locale-aware numbers and dates; avoid embedding English or Polish text in logic. Players can change locale anytime; account/global content IDs remain language-neutral. Initial locales `pl-PL`, `en-US`.

## Later (not MVP)
Full raid guilds, party mechanics, seasonal worlds, extensive charm matrix, imbuements/forge, personalized housing, advanced crafting, custom mobile notifications, multiple simultaneous activity slots.

## Unresolved decisions
Legal access to original Tibia assets/names; final content balance; premium model; maintenance and season policy; social moderation capacity. No protected assets in shipping bundle until written license.
