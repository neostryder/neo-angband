# W1 — effect handler adjudication

Oracle: Angband 4.2.6 under `reference/` (read-only).
Scope: the Lane B symbol list in `w1-effects.tsv`.

## Scope accounting

The supplied TSV has 74 rows, not 72: 72 non-static `effect_handler_*`
functions (15 from `effect-handler-attack.c`, 57 from
`effect-handler-general.c`) plus the two static helpers `enchant2` and
`tval_is_not_money`.  The required 72-row handler table is below; the two
helpers are adjudicated separately.

## Mechanical completeness result

`packages/core/src/game/effect-coverage.test.ts` now parses
`reference/src/list-effects.h` and both `effect-handler-*.c` files itself.  It
also assembles an actual `EffectRegistry` with the same ten production
registration functions used by `session/game.ts`, rather than trusting only
the generated enum or exported `*_HANDLER_CODES`.

| Set | Count |
|---|---:|
| `EFFECT(...)` rows in `list-effects.h` | 112 |
| `bool effect_handler_*` definitions in the two C files | 112 |
| numeric effects in the assembled port registry | 112 |
| C enumeration minus C definitions | 0 |
| C definitions minus C enumeration | 0 |
| C enumeration minus port registry | 0 |
| port registry minus C enumeration | 0 |
| runtime effects left on a base stub/partial | 0 |

The older test on master already checked the generated `EFFECT_ENTRIES` against
the nine subject registries.  The extension is not a duplicate: it directly
checks the oracle files, the C definition set, and the assembled runtime
handlers.  Removing `BOLT_OR_BEAM` from `ATTACK_HANDLERS` makes both the new
runtime assertion and the older structural assertion fail.

## The 72 assigned handlers

`REGISTERED` means the named C effect has a concrete production registration
at the cited line.  It does **not** claim a body-level semantic audit unless the
handler also appears in the ten-handler deep-diff table.

| C symbol | Verdict | Port counterpart |
|---|---|---|
| `effect_handler_BOLT_OR_BEAM` | REGISTERED | `packages/core/src/game/effect-attack.ts:704` |
| `effect_handler_HEAL_HP` | REGISTERED | `packages/core/src/effects/handlers.ts:385` |
| `effect_handler_MON_HEAL_HP` | REGISTERED | `packages/core/src/game/effect-monster.ts:273` |
| `effect_handler_MON_HEAL_KIN` | REGISTERED | `packages/core/src/game/effect-monster.ts:275` |
| `effect_handler_BOLT_STATUS` | REGISTERED | `packages/core/src/game/effect-attack.ts:706` |
| `effect_handler_BOLT_STATUS_DAM` | REGISTERED | `packages/core/src/game/effect-attack.ts:708` |
| `effect_handler_BOLT_AWARE` | REGISTERED | `packages/core/src/game/effect-attack.ts:710` |
| `effect_handler_TOUCH_AWARE` | REGISTERED | `packages/core/src/game/effect-attack.ts:726` |
| `effect_handler_PROJECT_LOS_AWARE` | REGISTERED | `packages/core/src/game/effect-attack.ts:729` |
| `effect_handler_DESTRUCTION` | REGISTERED | `packages/core/src/game/effect-terrain.ts:772` |
| `effect_handler_TAP_UNLIFE` | REGISTERED | `packages/core/src/game/effect-melee.ts:497` |
| `effect_handler_JUMP_AND_BITE` | REGISTERED | `packages/core/src/game/effect-melee.ts:502` |
| `effect_handler_MOVE_ATTACK` | REGISTERED | `packages/core/src/game/effect-melee.ts:504` |
| `effect_handler_SINGLE_COMBAT` | REGISTERED | `packages/core/src/game/effect-melee.ts:499` |
| `effect_handler_MELEE_BLOWS` | REGISTERED | `packages/core/src/game/effect-melee.ts:506` |
| `effect_handler_NOURISH` | REGISTERED | `packages/core/src/effects/handlers.ts:388` |
| `effect_handler_CRUNCH` | REGISTERED | `packages/core/src/effects/handlers.ts:390` |
| `effect_handler_CURE` | REGISTERED | `packages/core/src/effects/handlers.ts:392` |
| `effect_handler_TIMED_SET` | REGISTERED | `packages/core/src/effects/handlers.ts:394` |
| `effect_handler_TIMED_INC` | REGISTERED | `packages/core/src/game/effect-general.ts:1023` |
| `effect_handler_TIMED_INC_NO_RES` | REGISTERED | `packages/core/src/effects/handlers.ts:396` |
| `effect_handler_TIMED_DEC` | REGISTERED | `packages/core/src/effects/handlers.ts:398` |
| `effect_handler_WEB` | REGISTERED | `packages/core/src/game/effect-general.ts:998` |
| `effect_handler_RESTORE_STAT` | REGISTERED | `packages/core/src/game/effect-general.ts:1004` |
| `effect_handler_LOSE_RANDOM_STAT` | REGISTERED | `packages/core/src/game/effect-general.ts:1007` |
| `effect_handler_GAIN_STAT` | REGISTERED | `packages/core/src/game/effect-general.ts:1009` |
| `effect_handler_RESTORE_EXP` | REGISTERED | `packages/core/src/game/effect-general.ts:1011` |
| `effect_handler_GAIN_EXP` | REGISTERED | `packages/core/src/game/effect-general.ts:1013` |
| `effect_handler_DRAIN_LIGHT` | REGISTERED | `packages/core/src/game/effect-general.ts:1015` |
| `effect_handler_DRAIN_MANA` | REGISTERED | `packages/core/src/game/effect-general.ts:1017` |
| `effect_handler_DEEP_DESCENT` | REGISTERED | `packages/core/src/game/effect-general.ts:1002` |
| `effect_handler_ALTER_REALITY` | REGISTERED | `packages/core/src/game/effect-teleport.ts:601` |
| `effect_handler_READ_MINDS` | REGISTERED | `packages/core/src/game/effect-detect.ts:460` |
| `effect_handler_DETECT_TRAPS` | REGISTERED | `packages/core/src/game/effect-detect.ts:462` |
| `effect_handler_DETECT_DOORS` | REGISTERED | `packages/core/src/game/effect-detect.ts:464` |
| `effect_handler_DETECT_STAIRS` | REGISTERED | `packages/core/src/game/effect-detect.ts:466` |
| `effect_handler_DETECT_ORE` | REGISTERED | `packages/core/src/game/effect-detect.ts:468` |
| `effect_handler_SENSE_GOLD` | REGISTERED | `packages/core/src/game/effect-detect.ts:470` |
| `effect_handler_DETECT_GOLD` | REGISTERED | `packages/core/src/game/effect-detect.ts:472` |
| `effect_handler_SENSE_OBJECTS` | REGISTERED | `packages/core/src/game/effect-detect.ts:474` |
| `effect_handler_DETECT_OBJECTS` | REGISTERED | `packages/core/src/game/effect-detect.ts:476` |
| `effect_handler_DETECT_LIVING_MONSTERS` | REGISTERED | `packages/core/src/game/effect-detect.ts:478` |
| `effect_handler_DETECT_VISIBLE_MONSTERS` | REGISTERED | `packages/core/src/game/effect-detect.ts:483` |
| `effect_handler_DETECT_INVISIBLE_MONSTERS` | REGISTERED | `packages/core/src/game/effect-detect.ts:492` |
| `effect_handler_DETECT_FEARFUL_MONSTERS` | REGISTERED | `packages/core/src/game/effect-detect.ts:501` |
| `effect_handler_DETECT_EVIL` | REGISTERED | `packages/core/src/game/effect-detect.ts:510` |
| `effect_handler_DETECT_SOUL` | REGISTERED | `packages/core/src/game/effect-detect.ts:519` |
| `effect_handler_IDENTIFY` | REGISTERED | `packages/core/src/game/effect-item.ts:972` |
| `effect_handler_CREATE_STAIRS` | REGISTERED | `packages/core/src/game/effect-terrain.ts:762` |
| `effect_handler_RECHARGE` | REGISTERED | `packages/core/src/game/effect-item.ts:953` |
| `effect_handler_ACQUIRE` | REGISTERED | `packages/core/src/game/effect-item.ts:970` |
| `effect_handler_BANISH` | REGISTERED | `packages/core/src/game/effect-monster.ts:269` |
| `effect_handler_MASS_BANISH` | REGISTERED | `packages/core/src/game/effect-monster.ts:271` |
| `effect_handler_TELEPORT_TO` | REGISTERED | `packages/core/src/game/effect-teleport.ts:597` |
| `effect_handler_TELEPORT_LEVEL` | REGISTERED | `packages/core/src/game/effect-teleport.ts:599` |
| `effect_handler_LIGHT_LEVEL` | REGISTERED | `packages/core/src/game/effect-terrain.ts:764` |
| `effect_handler_DARKEN_LEVEL` | REGISTERED | `packages/core/src/game/effect-terrain.ts:766` |
| `effect_handler_LIGHT_AREA` | REGISTERED | `packages/core/src/game/effect-terrain.ts:768` |
| `effect_handler_DARKEN_AREA` | REGISTERED | `packages/core/src/game/effect-terrain.ts:770` |
| `effect_handler_CURSE_ARMOR` | REGISTERED | `packages/core/src/game/effect-item.ts:962` |
| `effect_handler_CURSE_WEAPON` | REGISTERED | `packages/core/src/game/effect-item.ts:964` |
| `effect_handler_BRAND_WEAPON` | REGISTERED | `packages/core/src/game/effect-item.ts:956` |
| `effect_handler_BRAND_AMMO` | REGISTERED | `packages/core/src/game/effect-item.ts:958` |
| `effect_handler_BRAND_BOLTS` | REGISTERED | `packages/core/src/game/effect-item.ts:960` |
| `effect_handler_CREATE_ARROWS` | REGISTERED | `packages/core/src/game/effect-item.ts:966` |
| `effect_handler_TAP_DEVICE` | REGISTERED | `packages/core/src/game/effect-item.ts:968` |
| `effect_handler_SHAPECHANGE` | REGISTERED | `packages/core/src/game/effect-general.ts:995` |
| `effect_handler_BIZARRE` | REGISTERED | `packages/core/src/game/effect-general.ts:992` |
| `effect_handler_SELECT` | REGISTERED | `packages/core/src/effects/handlers.ts:383` |
| `effect_handler_CLEAR_VALUE` | REGISTERED | `packages/core/src/effects/handlers.ts:401` |
| `effect_handler_SCRAMBLE_STATS` | REGISTERED | `packages/core/src/game/effect-general.ts:1019` |
| `effect_handler_UNSCRAMBLE_STATS` | REGISTERED | `packages/core/src/game/effect-general.ts:1021` |

### Two additional static rows in the TSV

| C symbol | Verdict | Port counterpart |
|---|---|---|
| `enchant2` (`effect-handler-general.c:294`) | INLINED | `packages/core/src/game/effect-item.ts:354`; the port calls `enchantScore` and writes back the returned score directly |
| `tval_is_not_money` (`effect-handler-general.c:1717`) | PORTED | `packages/core/src/game/effect-detect.ts:360` as `isNotMoney` |

## Ten line-by-line semantic diffs

The selection emphasizes branches, loops, RNG ordering, targeting, and
state-changing side effects.  Results: **6 MATCH, 4 DIVERGENCE**.

| Handler | C / port citations | Verdict | Line-by-line conclusion |
|---|---|---|---|
| `BOLT_OR_BEAM` | C `effect-handler-attack.c:158-166`; port `effect-attack.ts:161-166` | MATCH | Both add `beam + other`, draw exactly one `randint0(100)`, use `< beam`, then tail-call BEAM or BOLT and return that result. |
| `MON_HEAL_KIN` | C `effect-handler-attack.c:311-359`; port `effect-monster.ts:166-258` | **DIVERGENCE** | C rolls `amount` before reservoir-sampling for kin; the port samples first and rolls only after a kin exists, changing RNG state/order and skipping the value roll when none exists. C emits heal-health text only when the kin is seen; shared port helper `healMonster` emits “sounds … healthy” when unseen, behavior copied from `MON_HEAL_HP` but not present in `MON_HEAL_KIN`. HP cap, fear clear, identification, and kin predicate otherwise match. |
| `TIMED_INC` | C `effect-handler-general.c:576-645`; port `effect-general.ts:688-748` plus `effects/handlers.ts:246-284` | MATCH | Value roll and identification precede the same decoy early return; monster targets use the same six TMD-to-MON_TMD cases and clamped amount; the player path uses `other` only when the status is already active and passes notify/disturb/check flags equivalently. C computes the pure target pointer before its decoy check; that reordering has no state or RNG effect. |
| `DESTRUCTION` | C `effect-handler-attack.c:1169-1281`; port `effect-terrain.ts:406-488` | **DIVERGENCE** | Circle bounds/distance, ROOM/VAULT/GLOW/SEEN changes, player/stair/permanent exclusions, monster deletion, `randint0(200)` terrain thresholds, element learning, resistance, and `10 + randint1(10)` blindness match. The port does not perform C's `square_forget()` against player map memory. It also removes destroyed artifacts but never does C's `mark_artifact_created(false)` for an unknown artifact when `birth_lose_arts` is off, so that artifact cannot regenerate. Both omissions are already broadly ledgered under map memory/artifact upkeep; they remain real core divergences. |
| `RECHARGE` | C `effect-handler-general.c:2127-2191`; port `effect-item.ts:464-545` | MATCH | Strength roll, immediate ID, cancel return, failure chance, guaranteed/one-in-N backfire, single-item destruction, ease formula, `t = strength / (10 - ease) + 1`, and `2 + randint1(t)` charge gain match. UI-only `recharge_pow`, combine, and redraw flags are represented outside the handler. |
| `TELEPORT_TO` | C `effect-handler-general.c:2703-2831`; port `effect-teleport.ts:277-380` | **DIVERGENCE** | Start/aim selection, no-teleport checks, coordinate sentinel, monster-to-player radius 2, vault radius 10, widening threshold, legal-destination rejection sampling, movement, and PROJECT clearing match. The port omits the arena early return and the monster-decoy branch at C `:2735-2739`. It also computes `dimDoor` but discards it (`void dimDoor`) instead of C's `target_set_location(0, 0)`. These are acknowledged in the teleport ledger but are not semantic matches. |
| `TELEPORT_LEVEL` | C `effect-handler-general.c:2834-2934`; port `effect-teleport.ts:418-511` | **DIVERGENCE** | Monster-target deletion, no-teleport checks, hostile nexus resistance, force-descend/quest/bottom gates, the 50% direction choice, destination-depth choice, messages, and change-level hook match. The port omits C's arena early return and decoy destruction before player checks. Command-queue flushing and typed sound are also absent but were not counted as separate core findings here because this review did not audit those surrounding subsystems. |
| `TAP_DEVICE` | C `effect-handler-general.c:3370-3446`; port `effect-item.ts:819-865` | MATCH | Item cancel, staff/wand energy `((5 + level) * 3 * pval) / 2`, `< 36` refusal, full-mana refusal, charge drain, mana `energy / 6` with fractional reset/cap, message, `used`, and `randint1(2)` stun flags match. |
| `BIZARRE` | C `effect-handler-general.c:3516-3599`; port `effect-general.ts:860-951` | MATCH | The same `randint1(10)` partitions produce permanent five-stat/quarter-XP loss, 1000 DISP_ALL, radius-3 300 mana ball, or 250 mana bolt. Target-grid and projection-flag changes for DIR_TARGET match, as do return values. |
| `MOVE_ATTACK` | C `effect-handler-attack.c:1785-1855`; port `effect-melee.ts:342-416` | MATCH | Both require an obvious monster, take up to four steps, choose diagonal/cardinal direction then `d,+1,-1`, return `moves != 4` when barred, return false after attacking a blocking monster, scale blows by `(blows * moves + 2) / 4`, and stop after a killing blow. |

## Actionable gaps (reported, not fixed)

1. **W1-EFFECT-001 — `MON_HEAL_KIN` RNG and unseen messaging.** Move the
   `effectCalculateValue(ctx, false)` call before `chooseNearbyInjuredKin`, even
   when no target will be found.  Do not use `MON_HEAL_HP`'s unseen “sounds
   healthier” branches for kin healing; C only prints the kin-heal health
   message when `seen` is true.  Preserve fear clearing and identification.
2. **W1-EFFECT-002 — `DESTRUCTION` knowledge/artifact bookkeeping.** For every
   affected grid, forget the player's remembered square as C's
   `square_forget()` does.  When destroying an artifact, keep it permanently
   created (and add loss history) if `birth_lose_arts` is on or it is known;
   otherwise clear its created mark so it can regenerate.  Do this before
   removing the pile.
3. **W1-EFFECT-003 — `TELEPORT_TO` arena/decoy/target handling.** Return after
   identification on arena levels; for a monster-origin, player-targeting cast
   that monster sees the live decoy, destroy the decoy and return; after a
   player-chosen Dimension Door, clear the location target.
4. **W1-EFFECT-004 — `TELEPORT_LEVEL` arena/decoy handling.** Return after
   identification on arena levels.  After the monster-target branch and before
   player no-teleport checks, destroy a live decoy and return.

No production behavior was changed for these findings.

## What was not checked

- The other 62 assigned handler bodies were not line-by-line compared; their
  verdict is registration/counterpart completeness only.
- The deep diff did not audit transitive implementations of projection,
  movement, object-stack, timed-status, map-memory, command-queue, message
  grammar, or sound primitives except where a direct handler mismatch is stated.
- No behavioral regression tests were added for the four reported divergences,
  because the lane instructions require reporting deep-diff defects without
  fixing them.  The only changed test is the mechanical completeness guard.
- The 40 `effect_handler_*` functions outside the 72-row unmatched slice were
  included in the 112-way mechanical guard but not individually adjudicated.

## Explicit guesses and uncertainty

- **GUESS (selection only):** “most behaviorally intricate” is subjective.  The
  ten handlers above were selected because they maximize branch count, loops,
  RNG ordering, targeting, and multi-subsystem state changes within the assigned
  72.
- **UNCERTAIN:** The exact user-visible pronoun/name differences in
  `MON_HEAL_KIN` depend on the still-simplified MDESC/display layer.  The
  RNG-order mismatch and the extra unseen heal message do not depend on that
  uncertainty.
- **UNCERTAIN:** Command-queue flushing in `TELEPORT_LEVEL` may have a session
  layer equivalent not visible in the handler.  It is recorded as not audited,
  not asserted as an additional defect.
- **MAPPING CHOICE:** For handlers implemented by shared factories, the durable
  C-symbol citation is attached to the specific `EF.*` registry entry.  That
  registration line is the unambiguous per-effect counterpart even when there
  is no uniquely named TypeScript function.
