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
state-changing side effects.  Current result after the assigned repair passes:
**6 MATCH, 3 FIXED, 1 PARTIALLY FIXED**.  `TELEPORT_LEVEL` retains two
reported-not-fixed surrounding-subsystem gaps below.

| Handler | C / port citations | Verdict | Line-by-line conclusion |
|---|---|---|---|
| `BOLT_OR_BEAM` | C `effect-handler-attack.c:158-166`; port `effect-attack.ts:161-166` | MATCH | Both add `beam + other`, draw exactly one `randint0(100)`, use `< beam`, then tail-call BEAM or BOLT and return that result. |
| `MON_HEAL_KIN` | C `effect-handler-attack.c:311-359`; port `effect-monster.ts:166-258` | **FIXED** | The RNG-order and unseen-message divergences were fixed by W1-EFFECT-001.  Its re-audit also found and fixed the opposite null-monster roll-order divergence in `MON_HEAL_HP`; details and bite-proofs are below. |
| `TIMED_INC` | C `effect-handler-general.c:576-645`; port `effect-general.ts:688-748` plus `effects/handlers.ts:246-284` | MATCH | Value roll and identification precede the same decoy early return; monster targets use the same six TMD-to-MON_TMD cases and clamped amount; the player path uses `other` only when the status is already active and passes notify/disturb/check flags equivalently. C computes the pure target pointer before its decoy check; that reordering has no state or RNG effect. |
| `DESTRUCTION` | C `effect-handler-attack.c:1169-1281`; port `effect-terrain.ts:402-493` | **FIXED** | Circle behavior still matches.  W1-EFFECT-002 added `square_forget()` for every affected grid and the exact known/`birth_lose_arts` artifact history plus created-registry branch before pile removal. |
| `RECHARGE` | C `effect-handler-general.c:2127-2191`; port `effect-item.ts:464-545` | MATCH | Strength roll, immediate ID, cancel return, failure chance, guaranteed/one-in-N backfire, single-item destruction, ease formula, `t = strength / (10 - ease) + 1`, and `2 + randint1(t)` charge gain match. UI-only `recharge_pow`, combine, and redraw flags are represented outside the handler. |
| `TELEPORT_TO` | C `effect-handler-general.c:2703-2831`; port `effect-teleport.ts:307-397` | **FIXED** | Existing movement and landing behavior still matches.  W1-EFFECT-003 added the arena return, seen-decoy destruction, and Dimension Door location-target clearing in C order. |
| `TELEPORT_LEVEL` | C `effect-handler-general.c:2834-2934`; port `effect-teleport.ts:434-536` | **PARTIALLY FIXED** | W1-EFFECT-004 fixed the two assigned handler gaps: the arena return and decoy destruction before player checks.  The port really does have a session/game command queue, so C's `cmdq_flush()` is an additional confirmed divergence; typed `MSG_TPLEVEL` sound is also absent.  Both are reported-not-fixed below under rule 8. |
| `TAP_DEVICE` | C `effect-handler-general.c:3370-3446`; port `effect-item.ts:819-865` | MATCH | Item cancel, staff/wand energy `((5 + level) * 3 * pval) / 2`, `< 36` refusal, full-mana refusal, charge drain, mana `energy / 6` with fractional reset/cap, message, `used`, and `randint1(2)` stun flags match. |
| `BIZARRE` | C `effect-handler-general.c:3516-3599`; port `effect-general.ts:860-951` | MATCH | The same `randint1(10)` partitions produce permanent five-stat/quarter-XP loss, 1000 DISP_ALL, radius-3 300 mana ball, or 250 mana bolt. Target-grid and projection-flag changes for DIR_TARGET match, as do return values. |
| `MOVE_ATTACK` | C `effect-handler-attack.c:1785-1855`; port `effect-melee.ts:342-416` | MATCH | Both require an obvious monster, take up to four steps, choose diagonal/cardinal direction then `d,+1,-1`, return `moves != 4` when barred, return false after attacking a blocking monster, scale blows by `(blows * moves + 2) / 4`, and stop after a killing blow. |

## Actionable gaps

1. ~~**W1-EFFECT-001 — `MON_HEAL_KIN` RNG and unseen messaging.**~~ **FIXED
   2026-07-26**, and the finding was right. Verified against the C before acting:
   `effect-handler-attack.c:319` does precede `:324`, and `:338-344` does wrap
   both messages in `if (seen)` where `:282-290` has "sounds ..." variants.

   A **third** sub-divergence turned up in the same pair while confirming these
   two, and it points the other way. `MON_HEAL_HP` computes `amount` at `:261`,
   which is BEFORE its `if (!mon) return true;` at `:265`, so a `midx` resolving
   to no monster still consumes the value's draws. `MON_HEAL_KIN` checks at
   `:317`, before `:319`, and consumes nothing. The port had both handlers
   guarding first. That asymmetry between two otherwise-identical handlers is a
   wart, and core keeps upstream's warts.

   All three came from the same cause: one shared `healMonster` body standing in
   for two upstream functions that differ in exactly three places. The body is
   still shared for the heal-and-cancel-fear tail, which genuinely is common, and
   now takes an `unseenMsg` flag for the part that is not.

   Guards in `packages/core/src/game/effect-monster.test.ts`, each proven to bite
   by reverting that one piece of the fix:

   | reverted | failure |
   |---|---|
   | roll the KIN value after the search | `expected 53 to be 48` |
   | give KIN the unseen messages back | `an unseen kin produces no heal message at all: expected [ Array(1) ] to deeply equal []` |
   | move the HP roll after its null guard | `a missing monster must leave the two streams in different places` |

   The order guard works by comparing against `MON_HEAL_HP` on a lone monster at
   the same seed and dice: HP rolls the value as its first RNG action, so if KIN
   also rolls first the two heal by exactly the same amount. Three injured kin are
   placed so the search makes three draws that would otherwise shift the stream.

   Noted while measuring, upstream wart reproduced correctly: `effect_do` rolls
   the dice for EVERY effect before dispatching (`effects.c:403-404`), and
   `dice_roll` consumes a `damroll` it then throws away, keeping only
   base/dice/sides (`z-dice.c:591`). So each effect pays for one discarded roll
   before its handler's own `effect_calculate_value`. The port does the same at
   `dice.ts:419`, and the null-guard test documents it so the next reader does not
   mistake it for the thing being measured.
2. ~~**W1-EFFECT-002 — `DESTRUCTION` knowledge/artifact bookkeeping.**~~
   **FIXED 2026-07-26**, and the report was right.  Re-verified against C:
   `effect-handler-attack.c:1201-1207` forgets every affected grid before the
   player-grid early continue, so the player grid, stairs, and permanent grids
   are included.  `:1220-1237` logs and marks known/`birth_lose_arts`
   artifacts permanently created, but clears the created mark for an unknown
   artifact when the option is off; `:1239-1243` removes the piles only after
   that bookkeeping.

   Port fixes are `effect-terrain.ts:432-437` and `:450-461`.  Guards are
   `effect-terrain.test.ts:346-407`.  The artifact guard observes
   `ArtifactState.isCreated()`, the same registry gate generation reads in
   `obj/make.ts:955`, rather than inspecting a test-only flag.

   | reverted | verbatim failure |
   |---|---|
   | `squareForget(state, grid)` | `AssertionError: expected false to be true // Object.is equality` |
   | artifact-registry `markCreated()` | `AssertionError: expected true to be false // Object.is equality` |
   | permanent-loss history call | `AssertionError: expected [] to have a length of 1 but got +0` |

3. ~~**W1-EFFECT-003 — `TELEPORT_TO` arena/decoy/target handling.**~~ **FIXED
   2026-07-26**, and all three reported branches were present in C:
   the arena return is `effect-handler-general.c:2714-2715`; a monster-origin
   cast only destroys the decoy in the player-targeting branch when
   `monster_is_decoyed(mon)` at `:2735-2739`; and a player-choice Dimension
   Door clears the location target at `:2817-2820`.

   Port fixes are `effect-teleport.ts:326-327`, `:341-345`, and `:392-394`.
   Guards are `effect-teleport.test.ts:148-202`.

   | reverted | verbatim failure |
   |---|---|
   | arena return | `AssertionError: expected 1 to be +0 // Object.is equality` |
   | seen-decoy branch | `AssertionError: expected { x: 15, y: 10 } to be null` |
   | Dimension Door target clear | `AssertionError: expected true to be false // Object.is equality` |

4. ~~**W1-EFFECT-004 — `TELEPORT_LEVEL` arena/decoy handling.**~~ **FIXED
   2026-07-26** for the two assigned gaps.  C identifies, then returns in an
   arena at `effect-handler-general.c:2842-2845`.  After the target-monster
   deletion branch, it destroys any live decoy and returns at `:2847-2859`,
   before no-teleport, resistance, direction, or level-change work.

   Port fixes are `effect-teleport.ts:514-515` and `:523-527`.  Guards are
   `effect-teleport.test.ts:227-258`.

   | reverted | verbatim failure |
   |---|---|
   | arena return | `AssertionError: expected 1 to be null` |
   | decoy branch | `AssertionError: expected { x: 10, y: 8 } to be null` |

## Reported, not fixed (rule 8)

- **`TELEPORT_LEVEL` command queue:** confirmed additional divergence.  C
  explicitly flushes pending commands before either level change at
  `effect-handler-general.c:2903-2917`.  The port has a real equivalent:
  `GameState.cmdQueue` at `game/context.ts:503`, drained before input at
  `game/player-turn.ts:702-705`, and flushed by `disturb()` at
  `game/player-path.ts:97-107`.  `teleportPlayerLevel()` changes level at
  `effect-teleport.ts:468-493` without clearing it.  This was not one of the
  three named assignments, so it was not fixed.
- **`TELEPORT_LEVEL` typed sound:** C uses `msgt(MSG_TPLEVEL, ...)` at
  `effect-handler-general.c:2908-2917`; the port emits plain text through
  `say()`.  The original report already noted this.  It remains unfixed.
- **`ALTER_REALITY` arena/ident ordering:** noticed while checking the same
  file.  C checks the arena before the message, level change, and
  identification at `effect-handler-general.c:1184-1191`.  The port has no
  arena guard and sets `ident` before acting at `effect-teleport.ts:543-550`.
  This is outside the named assignments and remains unfixed.

## What was not checked

- The other 62 assigned handler bodies were not line-by-line compared; their
  verdict is registration/counterpart completeness only.
- The deep diff did not audit transitive implementations of projection,
  movement, object-stack, timed-status, map-memory, command-queue, message
  grammar, or sound primitives except where a direct handler mismatch is stated.
- Behavioral guards were added only for W1-EFFECT-002 through -004, the three
  divergences assigned to this repair lane.  The extra rule-8 findings above
  intentionally have no passing regression guard.
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
- **RESOLVED (not a guess):** `TELEPORT_LEVEL` does have a concrete port-side
  command-queue equivalent; the citations in “Reported, not fixed” establish
  the missing flush.
- **MAPPING CHOICE:** For handlers implemented by shared factories, the durable
  C-symbol citation is attached to the specific `EF.*` registry entry.  That
  registration line is the unambiguous per-effect counterpart even when there
  is no uniquely named TypeScript function.
