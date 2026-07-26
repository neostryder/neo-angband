# Effect body semantic audit — resume

Oracle: Angband 4.2.6, `reference/src/` (read only).  Port baseline: this
worktree on `audit/effect-bodies-resume`.

## Scope and method

`reference/src/list-effects.h` contains 112 `EFFECT(...)` rows and the
assembled production registry has 112 numeric handlers (the independent
registration audit in `W1-EFFECT-HANDLERS.md` establishes the one-to-one
mapping).  A test counted as **semantic** only when it calls the assembled
production registry with that `EF.*` value and asserts a behaviour of the
handler (state, return/used, message, target, or projection), rather than just
checking the enum or registration map.

The current focused effect tests give **77 semantic / 35 no semantic test**.
The previous “about 62” figure is stale: it predates the focused game-layer
tests added for attack, detect, general, item, melee, monster, terrain and
teleport effects.  Mere mentions in parser/object-description tests were not
counted.

Semantic-test set (77):

`MON_HEAL_HP, MON_HEAL_KIN, TIMED_INC, MON_TIMED_INC, GLYPH, WEB,
RESTORE_STAT, DRAIN_STAT, LOSE_RANDOM_STAT, GAIN_STAT, RESTORE_EXP, GAIN_EXP,
DRAIN_MANA, REMOVE_CURSE, RECALL, DEEP_DESCENT, ALTER_REALITY, MAP_AREA,
READ_MINDS, DETECT_TRAPS, DETECT_DOORS, DETECT_STAIRS, DETECT_ORE,
DETECT_GOLD, SENSE_OBJECTS, DETECT_OBJECTS, DETECT_VISIBLE_MONSTERS,
DETECT_INVISIBLE_MONSTERS, IDENTIFY, DETECT_EVIL, CREATE_STAIRS, DISENCHANT,
ENCHANT, RECHARGE, PROJECT_LOS, ACQUIRE, WAKE, SUMMON, BANISH, MASS_BANISH,
TELEPORT, TELEPORT_TO, TELEPORT_LEVEL, RUBBLE, GRANITE, DESTRUCTION,
EARTHQUAKE, LIGHT_LEVEL, DARKEN_LEVEL, LIGHT_AREA, DARKEN_AREA, BALL, ARC,
SHORT_BEAM, LASH, STRIKE, BOLT, BEAM, BOLT_STATUS, CURSE_ARMOR, CURSE_WEAPON,
BRAND_WEAPON, BRAND_AMMO, BRAND_BOLTS, CREATE_ARROWS, TAP_DEVICE, TAP_UNLIFE,
CURSE, JUMP_AND_BITE, MOVE_ATTACK, MELEE_BLOWS, SWEEP, BIZARRE, WONDER,
CLEAR_VALUE, SCRAMBLE_STATS, UNSCRAMBLE_STATS`.

No-semantic-test set (35):

`RANDOM, DAMAGE, HEAL_HP, NOURISH, CRUNCH, CURE, TIMED_SET,
TIMED_INC_NO_RES, TIMED_DEC, DRAIN_LIGHT, RESTORE_MANA, SENSE_GOLD,
DETECT_LIVING_MONSTERS, DETECT_FEARFUL_MONSTERS, DETECT_SOUL,
PROJECT_LOS_AWARE, PROBE, SPOT, SPHERE, BREATH, SWARM, STAR, STAR_BALL,
BOLT_OR_BEAM, LINE, ALTER, BOLT_STATUS_DAM, BOLT_AWARE, TOUCH, TOUCH_AWARE,
SHAPECHANGE, COMMAND, SINGLE_COMBAT, SELECT, SET_VALUE`.

For every no-test entry below, I compared the C handler to the production TS
body/factory it registers, including random calls in execution order, returns
and `ident`, guards, integer division, messages, and player/monster/awareness
branches.  “Verified correct” means no direct-handler divergence was found;
it does not certify lower-level projection, UI, or world primitives.

## Punchlist — no semantic test

| Effect | C / port | Finding | Severity |
|---|---|---|---|
| RANDOM | `effect-handler-general.c:493`; `effects/handlers.ts:44,381` | Verified correct: both are deliberate dispatch dummies; chain selection is in `effect_do` / `EffectRegistry.effectDo`, not the body. | normal play |
| DAMAGE | `effect-handler-attack.c:458`; `effects/handlers.ts:103,409` and `game/effect-attack.ts:700` | Verified correct: value is calculated before unconditional ID; game override handles monster-target and decoy short circuits before player damage. | normal play |
| HEAL_HP | `effect-handler-attack.c:201`; `effects/handlers.ts:117,385` | Verified correct: ID precedes full-HP guard; percentage calculation uses `Math.trunc`; minimum `damroll` is only drawn when wounded; messages/thresholds match. | normal play |
| NOURISH | `effect-handler-general.c:501`; `effects/handlers.ts:180,388` | Verified correct: value then food scaling, subtype order, vomiting message, and false return for an invalid subtype match. | normal play |
| CRUNCH | `effect-handler-general.c:536`; `effects/handlers.ts:215,390` | Verified correct: exactly one `oneIn(2)` and both strings match. | normal play |
| CURE | `effect-handler-general.c:549`; `effects/handlers.ts:223,392` | Verified correct: clears subtype with notify and C-equivalent disturb predicate, then identifies. | normal play |
| TIMED_SET | `effect-handler-general.c:561`; `effects/handlers.ts:233,394` | Verified correct: value roll, clamp, timed call flags and ID order match. | normal play |
| TIMED_INC_NO_RES | `effect-handler-general.c:647`; `effects/handlers.ts:288,396` | Verified correct: value roll and existing-status/`other` branch match; resistance check is false. | normal play |
| TIMED_DEC | `effect-handler-general.c:686`; `effects/handlers.ts:314,398` | Verified correct: the sole division is `Math.trunc(current / other)`, matching C truncation toward zero. | normal play |
| DRAIN_LIGHT | `effect-handler-general.c:928`; `game/effect-general.ts:1015,1093` | Verified correct: game body keeps C’s light-source guard, amount calculation and identify result. | normal play |
| RESTORE_MANA | `effect-handler-general.c:1029`; `effects/handlers.ts:157,386` | Verified correct: value is rolled before the zero-means-full substitution; cap/reset and both messages match. | normal play |
| SENSE_GOLD | `effect-handler-general.c:1682`; `game/effect-detect.ts:470` | Verified correct: delegates to the C-equivalent sensing helper with gold-only predicate and its awareness/ID result. | normal play |
| DETECT_LIVING_MONSTERS | `effect-handler-general.c:1833`; `game/effect-detect.ts:479` | Verified correct: uses the living predicate and C radius/value path. | normal play |
| DETECT_FEARFUL_MONSTERS | `effect-handler-general.c:1893`; `game/effect-detect.ts:502` | Verified correct: fearful predicate and detected-message/ID branch match. | normal play |
| DETECT_SOUL | `effect-handler-general.c:1929`; `game/effect-detect.ts:520` | Verified correct: soul predicate and detection result match. | normal play |
| PROJECT_LOS_AWARE | `effect-handler-attack.c:1125`; `game/effect-attack.ts:729` | Verified correct: shared LOS factory differs only by the aware projection flag, as C does. | normal play |
| PROBE | `effect-handler-general.c:2451`; `game/effect-general.ts:1068` | Verified correct: target/visible-monster iteration and identify result match. | normal play |
| SPOT | `effect-handler-attack.c:545`; `game/effect-attack.ts:718` | Verified correct: value is non-randomized, player-only radius addition uses integer truncation, and projection success controls ID. | normal play |
| SPHERE | `effect-handler-attack.c:571`; `game/effect-attack.ts:719` | Verified correct: radius/diameter defaults and projection-success ID match. | normal play |
| BREATH | `effect-handler-attack.c:681`; `game/effect-attack.ts:715` | Verified correct: monster confusion draws are ordered accuracy then direction; arc minimum/range/defaults and target branches match. | normal play |
| SWARM | `effect-handler-attack.c:974`; `game/effect-attack.ts:723` | Verified correct: repeated projection and per-shot value/RNG order match C. | normal play |
| STAR | `effect-handler-attack.c:1032`; `game/effect-attack.ts:721` | Verified correct: directional loop and per-direction projection/ID semantics match. | normal play |
| STAR_BALL | `effect-handler-attack.c:1062`; `game/effect-attack.ts:722` | Verified correct: direction loop, radius default, and projection flags match. | normal play |
| BOLT_OR_BEAM | `effect-handler-attack.c:158`; `game/effect-attack.ts:704` | Verified correct: one `randint0(100)` after `beam + other`, `<` comparison, then tail-call to beam/bolt. | normal play |
| LINE | `effect-handler-attack.c:173`; `game/effect-attack.ts:712` | Verified correct: value/flags and projection-success-only identification match. | normal play |
| ALTER | `effect-handler-attack.c:186`; `game/effect-attack.ts:713` | Verified correct: no value roll, zero damage, and grid/item beam flags match. | normal play |
| BOLT_STATUS_DAM | `effect-handler-attack.c:383`; `game/effect-attack.ts:708` | Verified correct: intentionally shares BOLT_STATUS body; value/flags/ID-on-project semantics are identical in C. | normal play |
| BOLT_AWARE | `effect-handler-attack.c:398`; `game/effect-attack.ts:710` | Verified correct: aware bit is added before projection and ID depends on projection result. | normal play |
| TOUCH | `effect-handler-attack.c:411`; `game/effect-attack.ts:724` | Verified correct: monster decoy and monster-target guards precede player-centred touch, with matching return behaviour. | normal play |
| TOUCH_AWARE | `effect-handler-attack.c:446`; `game/effect-attack.ts:726` | Verified correct: aware bit is confined to player-centred touch projection; ID follows success. | normal play |
| SHAPECHANGE | `effect-handler-general.c:3449`; `game/effect-general.ts:1073` | Verified correct: selection/cancel and identify/used paths match. | normal play |
| COMMAND | `effect-handler-general.c:3479`; `game/effect-general.ts:1071` | Verified correct: command message/return dispatch and ID semantics match. | normal play |
| SINGLE_COMBAT | `effect-handler-attack.c:1857`; `game/effect-melee.ts:531` | Verified correct: target preconditions and start/end combat paths match. | normal play |
| SELECT | `effect-handler-general.c:3601`; `effects/handlers.ts:47,383` | Verified correct: deliberate dispatch dummy; selector mechanics live in `effect_do` / `EffectRegistry.effectDo`. | normal play |
| SET_VALUE | `effect-handler-general.c:3613`; `effects/handlers.ts:338,399` | Verified correct: it preserves the upstream shared-value quirk; no ID and no extra roll once a shared value is active. | normal play |

## Confirmed leads outside the no-test set

These are retained as leads, not fixes, because their effects do have focused
tests but their direct C bodies still differ in observable edge paths.

| Effect | C / port | Divergence | Severity |
|---|---|---|---|
| TELEPORT_LEVEL | `effect-handler-general.c:2903-2917`; `game/effect-teleport.ts:468-493,534` | C calls `cmdq_flush()` before either player level transition and uses `msgt(MSG_TPLEVEL, ...)`; TS changes level without flushing `GameState.cmdQueue` and sends an untyped message. A queued command can survive a level transition. | normal play (queue); presentation/typed-message |
| ALTER_REALITY | `effect-handler-general.c:1184-1191`; `game/effect-teleport.ts:543-550` | C checks arena first and returns without message, level change or identification. TS has no arena guard and sets `ident` before acting. | edge case (arena) |

No source files were modified by this audit; this report is a lead list for a
separate verification/fix pass.
