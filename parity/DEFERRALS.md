# What is not ported, and what was judged unnecessary

This document records the gaps this project went looking for, and what each one
turned out to be: ported, a deliberate divergence, or genuinely unreachable in
upstream's own code. It exists so that a `deferred:` note in a ledger file or a
source comment has somewhere to point, instead of asking a reader to trust a
one-line claim with no evidence behind it.

**Looking for something else?**

- [DIVERGENCES.md](DIVERGENCES.md): what is deliberately different from
  Angband 4.2.6, gameplay-affecting or not, with the reason.
- [PORT_TODO.md](PORT_TODO.md): the work-item checklist, including anything
  still genuinely open.

## The three ways a deferral note resolves

Every `deferred:` note in this repository's ledger, and every `DEFERRED` /
`TODO` comment in the source, adjudicates to one of three finished states:

1. **Ported.** The note described a gap that has since closed; the code now
   does the thing.
2. **A deliberate divergence, or not applicable to this platform.** See
   [DIVERGENCES.md](DIVERGENCES.md) for the gameplay-relevant cases; a purely
   mechanical one (manual memory management, a debug-build assertion twin) is
   simply not applicable to a garbage-collected runtime and is noted as such
   in the ledger.
3. **Unreachable in upstream's own C.** No path in 4.2.6 can execute the
   construct, so there is nothing to port. This is the state most easily
   abused, so it carries two requirements: the `file:line` and the exact
   mechanism that makes it unreachable (no caller, a constant-false guard, a
   `#define` set nowhere), and the unreachability must be a property of
   *upstream*, not of what this port happens to call: a port that simply
   never reaches a call site upstream does reach is a port defect wearing this
   state's clothes.

A row that cannot be dated evidence for one of these three is not resolved,
and the tooling below treats an unadjudicated note as open work.

## Not part of the port, with the mechanism

These are not gaps. Each is something a reader might expect to find, that
upstream's own 4.2.6 tree cannot reach either:

- **The three `OSTACK_LIST` checks** (`obj-pile.c:409`, `:410`, `:485`).
  Nothing in Angband 4.2.6 ever passes `OSTACK_LIST`: it is declared at
  `obj-pile.h:33`, tested three times and supplied never, since every `OSTACK_*`
  argument in the C tree is PACK, QUIVER, MONSTER, STORE or FLOOR.
  `obj/ostack-list.test.ts` ratchets the callers, which are the thing that
  could change this.

- **`RSF_BR_MANA` is declared and never used** (`list-mon-spells.h:38`,
  `monster_spell.txt:425`). Of 91 real spell flags, 90 appear somewhere in
  `lib/gamedata/monster.txt`; `BR_MANA` is the one no monster race ever sets.
  The port carries the same shape: the enum entry, the spoiler record, a borg
  case, and **the enum entry must not be removed**: `RSF` is a bit position
  persisted in every save ([MOD_REACH.md](../docs/modding/MOD_REACH.md), row
  22), and dropping index 25 would shift every flag above it. Only the *data*
  fact is unreachable; the entry is load-bearing. `data-exactness.test.ts`
  ratchets this against `reference/lib/gamedata/monster.txt`.

- **`old_class.txt` is shipped and never parsed**
  (`lib/gamedata/old_class.txt`). `lib/gamedata/Makefile:8` installs it into
  every player's data directory, and `init.c` registers no parser for it.
  Shipped is not the same as reachable. `data-exactness.test.ts` asserts both
  halves: the file exists upstream, and no port spec reads it.

- **`PRICE_DEBUG`'s seven `file_putf` sites** (`obj-power.c:1117` onward).
  `PRICE_DEBUG` is defined nowhere in the build, not `configure.ac`, not any
  `Makefile`, not `CMakeLists.txt`, so `pricing.log` cannot be written by any
  shipped 4.2.6 build, and the port's `obj/value.ts` emits nothing on this
  path. `text-census.test.ts` ratchets it in both directions.

### Upstream `#if 0` blocks

Six constructs in 4.2.6 sit inside `#if 0` and so cannot be reached by any
build. None of these carry a test, deliberately: unreachability here is a
property of the *callers*, and a test asserting that a vendored `reference/`
file still brackets a line in `#if 0` would only ever produce a false alarm in
an unrelated file when the reference tag changes.

| upstream | construct |
|---|---|
| `ui-equip-cmp.c` | `sel_better_than`, `sel_exclude_slot`, `sel_only_slot`: the port's `game/equip-cmp.ts` implements only the live selector categories |
| `ui-entry.c:1292-1304` | the `OBJ_MOD_STEALTH` / `OBJ_MOD_SEARCH` cases in `modifier_to_skill` |
| `wiz-stats.c:1342-1356` | `static double total(...)`, left unlinked upstream |
| `main-sdl.c:995-1020` | `sdl_ButtonBankRemove` |
| `main-win.c` | `Term_init_win` / `Term_nuke_win` and their hook assignments, both `/* XXX Unused */` stubs |
| `main-xxx.c` | `color_data[MAX_COLORS]`: the whole file is dead: gated on `USE_XXX`, defined by a `Makefile.xxx` that does not exist in the tree |

A frontend excluded by a CMake *default* is not in this class: `SUPPORT_SDL_FRONTEND`
and its siblings are user-settable options that build a working frontend when
turned on, unlike `USE_XXX` (no enabling makefile exists) or `PRICE_DEBUG` (no
switch anywhere). The same holds for `SCORE_BORGS`, gated by `#ifndef` rather
than `#if 0`, so its body fires by default.

## Keeping the census honest

The census is machine-generated from the ledger's `deferred:` fields and from
`DEFERRED`/`TODO` comments in the source, so this document cannot drift from
the code by hand-editing:

```
node parity/tools/deferral-census.mjs             # rebuild the row list
node parity/tools/deferral-triage.mjs             # add the mechanical hint column
node parity/tools/deferral-verdict.mjs <ref> ...   # record one adjudication
node parity/tools/deferral-report.mjs             # regenerate the appendix below
node parity/tools/ledger-deferred-items.mjs       # the ledger's own deferred: list items
```

`deferral-report.test.ts` fails when the appendix below is stale, and fails on
a new deferral note with no verdict or a verdict with no evidence, so this
document cannot describe a census that has since changed. Re-run
`ledger-deferred-items.mjs` after editing any `deferred:` bullet in a ledger
file: the generator carries a verdict forward by the bullet's text, so a
rewritten bullet is a new, unadjudicated row until this runs again.

<!-- BEGIN GENERATED: deferral-report.mjs -->

## Appendix: every row, with its verdict

Generated from `parity/reports/deferral-census.tsv` (226 rows).

| verdict | meaning | rows |
| --- | --- | --- |
| `divergence` | Deliberately different, with the mechanism named | 30 |
| `n-a` | Not applicable to this port, with the mechanism named | 49 |
| `unreachable-in-upstream` | No path in 4.2.6 can execute it, measured in the C (the third finished state) | 7 |
| `ported` | Done; the note was stale and has been rewritten | 25 |
| `note-is-fix` | The wording sits inside a record of a FIX, not a gap | 83 |
| `not-a-deferral` | Ordinary English, not a parity claim | 32 |
| | **total** | **226** |

### `divergence` - Deliberately different, with the mechanism named (30)

- `packages/core/src/game/context.ts:1345` - mon-death.ts:417-418 calls monsterDeath before deleteMonster; context.ts:1351-1412 removes groups, targets, artifacts, mimics, square and slot. The only remainder is the documented repaint-layer divergence.
- `packages/core/src/game/curse-tick.ts:98` - known-twin write; obj/known-object.ts synthesises the shadow on demand, so the object-info display reads the same value
- `packages/core/src/game/gear.ts:205` - Same: the known twin is synthesised, not stored (obj/known-object.ts objectKnownShadow)
- `packages/core/src/game/gear.ts:398` - The note already contains its own answer - objKnown.toA is 1 from birth, so the shadow at known-object.ts:446 yields the real toA and the twin write has no observable consumer
- `packages/core/src/game/gear.ts:444` - Same write, same reason (known-object.ts:446)
- `packages/core/src/game/gear.ts:1095` - objectSimilar's equipped test: isEquipped is ported; the OSTACK_LIST knowledge checks read the synthesised shadow
- `packages/core/src/game/gear.ts:1181` - The obj->known twin, ratified as DIVERGENCES.md C1 - synthesised on demand by objectKnownShadow rather than stored. Scheduled for replacement by the persistent twin under work item #126, at which point this becomes ported
- `packages/core/src/game/gear.ts:1250` - pval bonuses are live; equip_cnt is upstream's equipment-count UI counter, which the port's character sheet derives directly from player.equipment
- `packages/core/src/game/known.ts:126` - Same C1 divergence, remembered-pile half: an entry points at the original object so it reports the original's properties, which is what a stored obj->known would carry. Scheduled under #126
- `packages/core/src/game/known.ts:1046` - Known twin synthesised on demand (obj/known-object.ts)
- `packages/core/src/game/known.ts:1074` - Known twin synthesised on demand; monsterCarry itself is ported and called two lines below (known.ts:854)
- `packages/core/src/game/mon-place.ts:279` - LEAD READ. Re-adjudicated from real. list_object/delist_object is oidx bookkeeping for upstream's cave->objects[] registry, and the port replaced that registry rather than omitting it: state.floor is a pile map keyed by grid, and the mon<->obj mimicry link is obj.mimickingMIdx === mon.midx, which become_aware reads and the save persists. Nothing observable depends on an oidx. Ratified in game/floor.ts:19-21
- `packages/core/src/game/mon-place.ts:340` - LEAD READ. Same ratified substitution as mon-place.ts:267 - the pile map IS the object list
- `packages/core/src/game/monster-turn.ts:1361` - The player-cave placeholder copy rides the knowledge subsystem, which the port models as synthesised knowledge rather than a second grid array
- `packages/core/src/gen/generate.ts:11` - The known-level ("player cave") duplicate, ratified at game/known.ts:153 - the same decision as the per-object twin, applied to terrain. Related to work item #126
- `packages/core/src/obj/bind.ts:1367` - The known-object side is synthesised on demand (obj/known-object.ts) rather than bound as a second object
- `packages/core/src/obj/desc.ts:15` - The header's inline DEFERRED notes are all known-twin reads, which desc.ts now takes from objectKnownShadow
- `packages/core/src/obj/knowledge.ts:22` - Per-object twin replaced by on-demand synthesis (obj/known-object.ts objectKnownShadow)
- `packages/core/src/obj/knowledge.ts:773` - A known-twin display marking, subsumed by the shadow
- `packages/core/src/obj/knowledge.ts:792` - Same
- `packages/core/src/obj/knowledge.ts:1210` - Same
- `packages/core/src/obj/known-object.ts:9` - This module IS the divergence: the twin is synthesised on demand and desc.ts reads the shadow wherever upstream reads obj->known
- `packages/core/src/obj/object.ts:7` - Header points at obj-model.yaml; the model's absent twin is the synthesised shadow
- `packages/core/src/obj/object.ts:182` - Known-twin field
- `packages/core/src/obj/object.ts:296` - The explicit statement of the divergence: no persistent twin, synthesis instead (obj/known-object.ts)
- `packages/core/src/store/store.ts:560` - The obj->known pile is synthesised on demand (obj/known-object.ts)
- `parity/ledger/game-gear.yaml:73` - The known twin is synthesised on demand; the line's own "NOT deferred" clause lists what is live
- `parity/ledger/rng.yaml:40` - Rand_init's time/pid seeding is deliberately replaced: the port seeds from crypto/Math.random at the host and stores the seed in the save, which is what makes a run reproducible
- `parity/ledger/ui-entry.yaml:107` - Synthesised on demand (obj/known-object.ts)
- `parity/ledger/ui-entry.yaml:114` - The port folds merged curse data into the object's own flags, which the note states is equivalent

### `n-a` - Not applicable to this port, with the mechanism named (49)

- `packages/core/src/game/cave-square.ts:58` - Adjacent-decoy destruction on floors; no RNG, and the decoy itself is modelled
- `packages/core/src/game/cave-square.ts:68` - Same adjacent-decoy note, no RNG
- `packages/core/src/game/known.ts:250` - The note names its own mechanism: the front end runs updateView + noteSpots after every state-changing action, so there is no dirty-flag pipeline for a PU_/PR_ bit to set
- `packages/core/src/game/loop.ts:339` - A message on a seen trap re-arming; the port has no PR_ dirty-flag pipeline and the front end repaints unconditionally
- `packages/core/src/game/mon-death.ts:342` - PR_MONLIST is a redraw bit with no port equivalent (the front end repaints unconditionally); the note itself records quest_check as wired
- `packages/core/src/game/monster-turn.ts:1303` - Presentation only, no RNG; the port routes messages through the shell sink
- `packages/core/src/game/monster-turn.ts:1680` - Lore note on OF_AGGRAVATE, no RNG; monster lore is otherwise wired
- `packages/core/src/game/monster-turn.ts:1713` - Message plumbing and lore; the messages route through the shell sink
- `packages/core/src/game/player-path.ts:95` - Sound and redraw halves; no RNG, and the port has no PR_ pipeline
- `packages/core/src/game/player-turn.ts:825` - Two of the 20 are correctly never replaced: upstream's "look" is a UI function with CMD_NULL (ui-knowledge.c:4169, bound by the shell to l/x at web main.ts:8039), and 4.2.6 has no search command at all - no do_cmd_search, no CMD_SEARCH
- `packages/core/src/game/project-cast.ts:10` - Layer boundary with live suppliers: session/game.ts:1223 supplies the monster hooks and :1289 the player hooks, so the "deferred consequences" all run in play
- `packages/core/src/game/project-cast.ts:31` - basicPlayerActor is the worldless view; the live path supplies the real actor (session/game.ts:1289)
- `packages/core/src/game/project-cast.ts:152` - CastHooks is the seam, supplied at session/game.ts:1223/:1289
- `packages/core/src/game/project-cast.ts:154` - ProjectMonsterHooks supplied at session/game.ts:1223
- `packages/core/src/game/project-cast.ts:156` - ProjectPlayerHooks supplied at session/game.ts:1289, onSideEffects via makePlayerSideEffects (game/player-side.ts:139)
- `packages/core/src/game/project-monster.ts:48` - The seam's suppliers are live (session/game.ts:1223)
- `packages/core/src/game/project-player.ts:16` - Same seam discipline; supplied at session/game.ts:1289. The killer-name half is tracked separately as the MDESC_DIED_FROM gap
- `packages/core/src/game/project-player.ts:93` - Supplied at session/game.ts:1289
- `packages/core/src/game/shape-inspect.ts:108` - Re-verified 2026-08-14 (#226). A binding-layer boundary, not a divergence in play: class spell effects are held as raw pack records (ClassSpell.effectsRaw, player/types.ts:151) and game/spell-cmd.ts:239 casts and aims off those same records, so the raw chain is consumed for real casting.
- `packages/core/src/game/spoil.ts:379` - seed_randart only matters under birth_randarts and this is a dev tool; the note states the condition
- `packages/core/src/mon/project-mon.ts:45` - The seam's suppliers are live (session/game.ts:1223)
- `packages/core/src/mon/take-hit.ts:24` - The PR_HEALTH redraw, which is the ratified repaint divergence (DIVERGENCES.md B1): the renderer is immediate-mode and has no dirty-flag to raise. The state it gates, state.healthWho, IS tracked
- `packages/core/src/mon/timed.ts:223` - Health-bar / monster-list redraw; the front end repaints unconditionally
- `packages/core/src/obj/desc.ts:632` - is_unknown's placeholder path belongs to the object-list screen, which the web layer draws (game/obj-list.ts + web screens)
- `packages/core/src/player/bind.ts:15` - Layer boundary: the raw effect chain is compiled by the effects domain, which is ported (effects/effect.ts) and wired at session boot
- `packages/core/src/player/birth.ts:395` - Kind-name refs are resolved by the session (outfitPlayer + tvalFindIdx at gear.ts:1300); the binding layer holding names is the design
- `packages/core/src/player/birth.ts:443` - Same: "deferred references" names the binding boundary
- `packages/core/src/player/birth.ts:446` - Same
- `packages/core/src/player/exp.ts:17` - PU_/PR_ update flags have no port equivalent; the front end repaints unconditionally
- `packages/core/src/player/types.ts:153` - Binding boundary: the raw record is compiled by the effects domain at boot
- `packages/core/src/player/types.ts:171` - Same binding boundary
- `packages/core/src/player/types.ts:204` - Same, handed to the obj domain
- `packages/core/src/player/types.ts:206` - Same
- `packages/core/src/player/types.ts:225` - Same: tval/sval names resolved by the obj domain
- `packages/core/src/world/chunk.ts:10` - square_light_spot is a lighting refresh with no port equivalent; the front end recomputes and repaints every frame
- `packages/web/src/mapview.ts:71` - The rounding branches are dead code upstream; not porting dead code is the documented policy
- `parity/ledger/bitflag.yaml:54` - flag_has_dbg / flag_on_dbg are the C's debug-build assert wrappers around flag_has / flag_on. TypeScript's FlagSet asserts unconditionally (assertValidFlag), so the debug twin has nothing to add. Ratified N/A, not deferred.
- `parity/ledger/dice.yaml:38` - dice_free is manual deallocation. Nothing to port to a garbage-collected runtime. Ratified N/A, not deferred.
- `parity/ledger/effects-interpreter.yaml:138` - recharge_failure_chance IS in the obj domain, which is where the note says it belongs; the rest of the line is about GC and serialisation
- `parity/ledger/expression.yaml:31` - expression_free is garbage collected and the strtol saturation is documented in the helper; neither is reachable behaviour
- `parity/ledger/game-arena.yaml:16` - monster_index_move exists only to serve arena_gen's memcpy; the port's arena builder reads state.healthWho instead
- `parity/ledger/game-effect-detect.yaml:48` - What remains after the closures this row records is the DTRAP border and the item/monster list redraws, both the ratified repaint divergence. The row's third clause is FALSE: there are no detection sounds to defer - effect_handler_DETECT_* (effect-handler-general.c:1321-1874) uses msg() and never sound()
- `parity/ledger/game-effect-detect.yaml:58` - The monster recall WINDOW refresh (PR_MONSTER) is the ratified repaint divergence; an immediate-mode renderer has no window to invalidate
- `parity/ledger/game-gear.yaml:70` - Pack overflow at birth: a birth kit cannot overflow, and packOverflow itself is ported and called (obj-cmd.ts:276, session/game.ts:806)
- `parity/ledger/player-model.yaml:53` - Starting-inventory kind-name refs are resolved by the session; a binding boundary
- `parity/ledger/ui-display.yaml:155` - update_topbar / SIDEBAR_TOP, the prt_*_short handlers, hp_colour_change and every Term_* positioning call are the curses term's own layout machinery. The port draws the same values on a canvas grid (game/display.test.ts covers the value formatting); there is no subterm to position
- `parity/ledger/ui-player.yaml:68` - The resist/ability/sustain grid is ported, in the separate module the note points at (characterGrid, ui-entry.ts:1863, drawn by web charsheet.ts:270)
- `parity/ledger/wizard-debug.yaml:163` - The action is reachable by another route already ported; upstream's separate entry point adds no behaviour
- `parity/ledger/wizard-debug.yaml:170` - Process lifetime belongs to the shell, which owns it in this port

### `unreachable-in-upstream` - No path in 4.2.6 can execute it, measured in the C (the third finished state) (7)

- `packages/core/src/game/effect-general.ts:587` - Promoted from n-a 2026-08-14: the same upstream measurement as parity/ledger/game-effect-general.yaml:97. Upstream's call (effect-handler-general.c:992) returns at mon-util.c:794 before reaching its own body, so the pflag arm at mon-util.c:822-829 never runs and there is nothing to port.
- `packages/core/src/obj/object.ts:900` - Re-verified 2026-08-14 (#226). object_similar's two object_is_equipped guards (obj-pile.c:400-403) read the global player->body, and object.ts:915-925 enumerates every upstream mode: no 4.2.6 caller reaches the guard with an equipped object, because combine_pack walks player->upkeep->inven and the port's pack/quiver/floor paths (gear.ts:614, :696, pickup.ts:164) cannot contain one. PORT_TODO 2.11.
- `packages/core/src/obj/object.ts:916` - Promoted from n-a 2026-08-14: this is the TEMPLATE the third finished state is judged against, ratified by the owner 2026-08-09 (option A). Nothing in 4.2.6 ever passes OSTACK_LIST - it is declared at obj-pile.h:33, tested at obj-pile.c:409, :410 and :485 and supplied never; every OSTACK_* argument in the C tree is PACK, QUIVER, MONSTER, STORE or FLOOR and no arithmetic sets 0x04. obj/ostack-list.test.ts is the ratchet and it sits on the CALLERS, which are the thing that can change.
- `packages/core/src/obj/randart-log.ts:72` - Promoted from n-a 2026-08-14 (#228), and the sites are now named. object_value_real's pricing.log is guarded by #ifdef PRICE_DEBUG at obj-power.c:1117, :1144, :1153, :1166, :1175 and :1197 (the #else arm at :1134, block closing :1206), and PRICE_DEBUG is defined nowhere - not configure.ac, not any Makefile, not CMakeLists.txt - so it is a hand-edit-only switch and pricing.log cannot be written by any shipped 4.2.6 build. The port emits nothing on this path: obj/value.ts has no log call at all. packages/cli/src/text-census.test.ts:62-66 is the ratchet and it fails in BOTH directions.
- `packages/core/src/store/transact.ts:26` - Re-verified 2026-08-14 (#228). There is no purchase-side history call to port: do_cmd_buy runs reference/src/store.c:1646-1774 and makes no history call of any name. store.c has exactly four - :1087 and :1303 (history_lose_artifact, turnover and black-market purge), :1924 (history_find_artifact, inside do_cmd_sell at :1865), :1988 (the store refusing what it just bought) - and the sell pair is wired at session/game.ts:3621-3622 and :3666-3667. The earlier note named a call upstream does not make; the direction was backwards. transact.ts:26-39 now records the correction at the site.
- `parity/ledger/game-effect-general.yaml:97` - Promoted from n-a 2026-08-14: the mechanism is a measurement of upstream, not of this platform. effect-handler-general.c:992 is update_smart_learn(mon, player, 0, PF_NO_MANA, -1) and mon-util.c:794 returns immediately when flag is 0 and the element is out of range - exactly that argument list. It is the ONLY one of the nine 4.2.6 call sites that passes a pflag, so the pflag arm at mon-util.c:822-829 is unreachable and known_pstate.pflags is never written in any game of Angband.
- `parity/ledger/gamedata.yaml:502` - Promoted from n-a 2026-08-14 (#228), with the mechanism measured. old_class.txt is SHIPPED and never parsed: lib/gamedata/Makefile:8 installs it into every player's data directory and init.c registers no old_class_parser. The only other mentions in 4.2.6 are src/Makefile.ibm:114 (an 8.3-FAT rename for the DOS build), src/win/vs2019/Angband.vcxproj:707 and .filters:1657 (an MSVC Text item), and comments in three tileset .prf files. Shipped is not reachable.

### `ported` - Done; the note was stale and has been rewritten (25)

- `packages/core/src/game/wizard.ts:68` - spoilObjDesc / spoilArtifact / spoilMonDesc / spoilMonInfo are live at game/spoil.ts:273, :366, :480, :532; web/src/wizard.ts:373 runSpoilers reaches them through the host seam.
- `packages/core/src/gen/gen-monster.ts:350` - spreadMonsters is exported at gen-monster.ts:353 and used by the cave builders at gen/cave.ts:1721 and :1865; gen/gen.test.ts:2175 exercises room_of_chambers.
- `packages/core/src/mon/lore-describe.ts:863` - combat/melee.ts:243 chanceOfMeleeHitBase and combat/hit.ts:60 hitChance are wired as meleeHitPercent in web/src/main.ts:3786-3787; web/src/screens.test.ts:942-969 checks the live percentage.
- `packages/core/src/mon/lore-describe.ts:1316` - web/src/main.ts:3788-3790 wires monsterHitPercent from the actor defence and monster attack power; lore-describe.ts:1319 consumes that supplied seam.
- `packages/core/src/obj/knowledge.ts:1331` - obj/knowledge.ts:1134 requests PN_IGNORE, session/game.ts:609-611 names the next notice pass, and game/notice.ts:30 consumes it; game/notice.test.ts:177 covers its ordering.
- `packages/core/src/obj/object.ts:910` - The object-info seam calls ObjectInfoDeps.isEquipped at obj/object.ts:1020 and :1049; store/transact.ts:84, :410 and :652 implement and use the real player-equipment predicate.
- `parity/ledger/game-obj-list.yaml:45` - game/obj-list.ts:306 objectListEntryName sends the summed count through ODESC.ALTNUM; the row renderer uses it at :340-341 and obj-list.test.ts covers the listing behaviour.
- `parity/ledger/game-project-cast.yaml:53` - game/effect-attack.ts:433-445 implements both handleTOUCH target branches, and game/project-cast.ts:705 delegates to the handler.
- `parity/ledger/high-scores.yaml:96` - game/effect-attack.ts:703 and game/project-cast.ts:147 form MDESC_DIED_FROM killers; game/take-hit-hooks.ts:66-68 records diedFrom and web/src/main.ts:4990-5000 passes it to score construction.
- `parity/ledger/player-history.yaml:46` - web/src/screens.ts:1107 exports historyLines and web/src/charsheet.ts:581 dumpCharacterFile writes the character dump through the host seam.
- `parity/ledger/player-history.yaml:79` - session/game.ts:1113-1137 wires onArtifactFound and onArtifactLost; game/pickup.ts:305-310 invokes the find hook and game/effect-item.ts:678 invokes the loss hook. There is no distinct store-purchase entry to owe (corrected 2026-08-14): do_cmd_buy (store.c:1646-1774) makes no history call, and store.c's only find-side call is history_find_artifact at :1924 inside do_cmd_sell.
- `parity/ledger/player-history.yaml:91` - web/src/main.ts:4642 calls historyAdd with HIST.USER_INPUT from the note command (noteCmd at :4615, the ':' binding at :8201), and web/src/rest-steal-note.test.ts:60-80 verifies the binding, the "Note: " prompt and the history action. Line numbers re-measured 2026-08-14: the call had drifted from :4557 to :4642.
- `parity/ledger/store-price.yaml:21` - store/store.ts:113 exports storeChooseOwner and invokes it at :129, :133 and :716 when a store is initialized or maintained.
- `parity/ledger/ui-entry.yaml:138` - game/ui-entry.ts:2114 exports equipCmpCategories; game/equip-cmp.ts:391 consumes it and game/equip-cmp.test.ts:116 checks all categories and the combined row.
- `parity/ledger/wizard-debug.yaml:14` - obj/make.ts:754 ArtifactState records created artifacts, and session/save.ts:1069 plus :1500 serialize artifactsCreated.
- `parity/ledger/wizard-debug.yaml:87` - web/src/wizard.ts:2083 runTweakItem is reached from the play-item T branch at :1918-1920.
- `parity/ledger/wizard-debug.yaml:112` - game/dump-level.ts:109 exports dumpLevel and web/src/wizard.ts:1592 runWriteMap drives it; game/dump-level.test.ts covers its output.
- `parity/ledger/wizard-debug.yaml:139` - The spoiler generators are game/spoil.ts:273, :366, :480 and :532, reachable from web/src/wizard.ts:373 runSpoilers.
- `parity/ledger/wizard-debug.yaml:144` - web/src/wizard.ts:901, :904 and :907 invoke the three collectors runCollectObjMonStats (:1731), runCollectPitStats (:1758), and runCollectDisconnectStats (:1717).
- `parity/ledger/wizard-debug.yaml:147` - game/wizard.ts:1682 exports wizStatItem and web/src/wizard.ts:2003 runs it from the item-stat workflow.
- `parity/ledger/wizard-debug.yaml:154` - web/src/wizard.ts:2058 runChangeQuantity is selected by the play-item Q branch at :1923-1925.
- `parity/ledger/wizard-debug.yaml:164` - web/src/wizard.ts:2058 runChangeQuantity is reachable through the Q/q play-item action at :1923-1925.
- `parity/ledger/wizard-debug.yaml:166` - web/src/wizard.ts:1890 runPlayItem contains the A/K/S/R/T/C/Q dispatch at :1914-1925 and uses game/wizard.ts:1520, :1575 and :1610 snapshot/reject/accept operations.
- `parity/ledger/wizard-debug.yaml:167` - The quantity action has its live play-item shell: web/src/wizard.ts:1890 dispatches Q at :1923-1925 to runChangeQuantity (:2058).
- `parity/ledger/world-kernel.yaml:36` - Re-verified 2026-08-14 (#226). session/game.ts:900 supplies monsterLightSources() and session/monster-light-wiring.test.ts:120-130 boots a game and proves it changes the live map; the square side effects and map rendering the row also named are the ratified repaint divergence (DIVERGENCES.md B1), not owed work. PORT_TODO 7.4.

### `note-is-fix` - The wording sits inside a record of a FIX, not a gap (83)

- `packages/core/src/combat/mon-melee.ts:29` - The rewritten header: it records that all four formerly-listed items are ported and names the one that is not (mon/steal.ts:234)
- `packages/core/src/effects/handlers.ts:82` - Records that the "deferred (8.9)" note outlived its wiring: this worldless layer has no monster registry, and the GAME override names the killer through monsterDesc(MDESC_DIED_FROM) at game/effect-attack.ts and game/project-cast.ts
- `packages/core/src/game/cave-cmd.ts:23` - The sentence records that player_best_digger IS now ported; "was deferred" is history, not a deferral.
- `packages/core/src/game/cave-cmd.ts:33` - Records that count_feats is NOW PORTED and that deferring it had been wrong; easy_open does not exist in 4.2.6.
- `packages/core/src/game/context.ts:312` - Records the REMOVAL of a stand-in (noticeIgnore) that nothing read. PlayerUpkeep.notice is the real mask now, raised where upstream raises it and drained by game/notice.ts (PORT_TODO 2.5)
- `packages/core/src/game/context.ts:492` - Records why tempBrandSlay is a required peer rather than an optional seam - the note it replaces (PORT_TODO 3.20) had claimed a predicate was missing that existed
- `packages/core/src/game/context.ts:961` - "exactly as when it was deferred" records that the curse tick is now installed by the session
- `packages/core/src/game/context.ts:1262` - Records the DELETION of a wrong predicate. squareIsEmpty was not square_isempty; the faithful port squareIsEmptyLive in game/mon-place.ts is now the only one
- `packages/core/src/game/effect-general.ts:295` - Records that the gear_to_label letter IS printed: GEAR_LABELS is indexed by body slot exactly as known.ts:775 does, and the row that called it a display concern was wrong
- `packages/core/src/game/effect-general.ts:546` - Records that the monster-vs-monster disenchant branch is ported and ordered first, and that "rides monster-spell targeting (#19)" stopped being true when monsterTargetMonster landed
- `packages/core/src/game/effect-teleport.ts:43` - Records two closures: the three teleport sounds (PORT_TODO 3.26) and the MON_MSG_BRIEF_PUZZLE queue entry (PORT_TODO 3.1)
- `packages/core/src/game/effect-teleport.ts:49` - The sentence says teleportMonster IS the backing that project-monster deferred - a record of the wiring, not a gap
- `packages/core/src/game/effect-terrain.ts:253` - Records a fixed crash (arena entry, out-of-bounds) and states that deferring to the caller's refresh is what upstream's flag does
- `packages/core/src/game/mon-group.ts:28` - The sentence records a CORRECTION to an earlier wrong claim about monster_can_see, not a deferral
- `packages/core/src/game/monster-turn.ts:24` - "NOW WIRED (was deferred)" is a record of the fix
- `packages/core/src/game/monster-turn.ts:1387` - Records that the "rune of protection is broken!" message IS printed below, and that the line calling it deferred sat beside the code doing it
- `packages/core/src/game/monster-turn.ts:1411` - Records that item pickup, group behaviour and lore are all ported (PORT_TODO 7.2) and that two of the three were already ported when the note was written
- `packages/core/src/game/monster-turn.ts:1525` - Records a fixed live defect: destroyDecoy had printed the message for its five other callers all along, and this site - the commonest way a decoy dies - was one of the two that went around the function
- `packages/core/src/game/obj-cmd.ts:1796` - Records that the port routes this through combine_pack, which is what happens - a design record, not a gap
- `packages/core/src/game/player-path.ts:28` - "are wired (W2-003 navigate-up/down, explore, pathfind)" records the fix
- `packages/core/src/game/project-cast.ts:739` - Records that the decoy / target-monster branches are ported one level up in game/effect-attack.ts handleTOUCH, and that the stale note manufactured PORT_TODO 2.13
- `packages/core/src/game/ranged-cmd.ts:24` - The sentence explicitly says the item "had been listed here as deferred, which is" wrong - a correction
- `packages/core/src/game/take-hit-hooks.ts:23` - Records that the port deliberately mirrors upstream's close_game ordering, and names where it happens
- `packages/core/src/game/ui-entry.ts:26` - ui-entry.ts:26-28 is a historical correction, not an outstanding absence: liveTimedUiDeps is exported at :1417 and objectKnownShadow at obj/known-object.ts:441 supplies the view.
- `packages/core/src/game/ui-entry.ts:1408` - Records that PORT_TODO 3.8's stated cause was wrong - player_flags_timed is ported at player/calcs.ts:1097 - and that the DEFERRED comment on the seams had outlived it
- `packages/core/src/game/ui-entry.ts:1411` - Same fix record, temp_resist half: TimedEffect.tempResist exists at player/types.ts:341, so PORT_TODO 3.7's stated cause was also wrong
- `packages/core/src/gen/cave.ts:32` - Records that neither thing this header called deferred still is: the town builder places all eight stores and the persistent-level connectors are live end to end (PORT_TODO 4.3)
- `packages/core/src/gen/generate.ts:15` - Records that arena levels (PORT_TODO 4.1) and quest levels (4.2) are both built and driven, and had been for some time
- `packages/core/src/gen/generate.ts:23` - Records that getJoinInfo, getMinLevelSize and collectJoins are all present and that session/changeLevel drives them (PORT_TODO 4.3)
- `packages/core/src/mon/lore-describe.ts:1376` - Records that the tile_width/tile_height gate is unconditionally true here (a ratified divergence at web/src/mapview.ts:70) and is omitted rather than deferred
- `packages/core/src/mon/steal.ts:35` - Records that react_to_slay on the monster-thief path IS ported (PORT_TODO 2.2) and that the reason originally given for skipping it was untrue when written
- `packages/core/src/mon/steal.ts:36` - The continuation of the same fix record - the precedent it cited ("the EAT_ITEM blow already defers it") was itself false
- `packages/core/src/obj/knowledge.ts:701` - Records that the shared launcher accessor closed two DEFERRED notes whose stated obstacle was three lines of body-slot walk (PORT_TODO 3.9)
- `packages/core/src/obj/make.ts:1253` - Explains why the current behaviour matches upstream at a site that was once a stub
- `packages/core/src/obj/make.ts:1258` - Records that book rejection is live and that the stale note is what manufactured PORT_TODO 2.15; the real defect was the wiring, and it is named
- `packages/core/src/obj/object-info.ts:270` - Records why the temp brand/slay dep is required rather than optional - an optional field would have reproduced the bug it fixes (PORT_TODO 3.20)
- `packages/core/src/session/game.ts:3302` - Records the single binding of tempBrandSlay that closed PORT_TODO 3.20; the melee hooks used to build a private copy nothing else could reach
- `packages/core/src/session/game.ts:4129` - The load path's copy of the same fix record
- `packages/core/src/store/store.ts:173` - This line IS the expansion the other notes call deferred
- `packages/core/src/store/transact.ts:13` - The header's LIVE list records that both sides of the rune learn loop are now wired, and says the DEFERRED label is what made the asymmetry read as intentional
- `packages/core/src/store/transact.ts:24` - The sentence records the fix and why the stale label was harmful
- `packages/web/src/main.ts:3837` - Records that all three greyed-browser claims were wrong: everseen is modelled and wired, and shapeLoreLines is a full port of shape_lore
- `packages/web/src/main.ts:8558` - Records why the first FOV after birth/load clears only_partial, and that it is thrown rather than skipped so a missing updateFov cannot hide behind a black screen
- `parity/ledger/combat-melee.yaml:91` - The comment recording that this list was adjudicated and that ten of its eleven entries had stopped being true
- `parity/ledger/game-arena.yaml:64` - Records that monster reproduction is ported and wired (multiplyMonster supplied at session/game.ts:1855) and that the row was wrong in both halves
- `parity/ledger/game-arena.yaml:71` - Records that ALTER_REALITY is ported and that its arena guard was simply missing rather than blocked - a live defect, now closed (PORT_TODO 4.1)
- `parity/ledger/game-arena.yaml:87` - Records that EVENT_GEN_LEVEL_START("arena") has nothing to defer: its only 4.2.6 subscriber is wiz-stats.c:2635, a debug statistics collector
- `parity/ledger/game-effect-melee.yaml:44` - "Every formerly-deferred handler is now DONE"
- `parity/ledger/game-effect-melee.yaml:52` - Records the closure of all four items (2026-08-07): message_pain with its show_damage branch, the mon_msg queue grammar, MSG_TELEPORT for the JUMP_AND_BITE jump
- `parity/ledger/game-effect-monster.yaml:56` - Records that the arena guards are present at both sites upstream has them (PORT_TODO 4.1)
- `parity/ledger/game-effect-monster.yaml:64` - Records a fixed live message defect: the heal handlers now call monsterDesc with MDESC_STANDARD and MDESC_PRO_VIS|MDESC_POSS as effect-handler-attack.c:268-271 does
- `parity/ledger/game-effect-teleport.yaml:37` - Records that teleportMonster is the backing for the hook
- `parity/ledger/game-effect-teleport.yaml:115` - Records that MSG_TELEPORT / MSG_TPOTHER / MSG_TPLEVEL now go through state.sound at every site upstream calls sound() (PORT_TODO 3.26)
- `parity/ledger/game-effect-terrain.yaml:53` - Records that squareMemorize, squareKnowPile and squareSensePile are all ported and called, and that square_light_spot falls under the ratified repaint divergence
- `parity/ledger/game-mon-ranged.yaml:31` - The ledger sentence records a completed fix: summonPossible rejects arena levels at game/mon-ranged.ts:81-83 and warded grids at :90-92.
- `parity/ledger/game-monster-ai.yaml:40` - "NOW WIRED (were deferred)"
- `parity/ledger/game-project-feat.yaml:45` - Records that exposeToSun is ported and that the reason for deferring it ("no town or day-night cycle yet") expired when PORT_TODO 4.3 built town generation
- `parity/ledger/game-trap.yaml:54` - Records that the trap hooks are supplied by the live session and that equip learning fires on both upstream paths (trap.c:515-518 and 534-539)
- `parity/ledger/game-trap.yaml:58` - A continuation line of the bullet above; the census matched the quoted fragment of the claim being corrected, not a claim of its own
- `parity/ledger/game-trap.yaml:61` - Records that no_light, the monster glyph and web interactions are ported, and that trap effect coverage is classified as a whole surface with a control proving the pass is not vacuous
- `parity/ledger/game-trap.yaml:70` - Records that the trapdoor persistent-levels check and the is_quest check beside it read the live option store; the row had named the option system as unbuilt
- `parity/ledger/gamedata.yaml:482` - Records that both halves of "front-end/UI concern, not part of the core rules pack" were wrong - the pack ships the file and core parses it
- `parity/ledger/gen-cave.yaml:48` - Records that every builder the list called missing is registered and selectable, and names arena_gen as the one genuine exception
- `parity/ledger/gen-framework.yaml:57` - gen/room.ts:1472-1514 and :1561-1602 build nests/pits with setPitType then table.prep(monPitHook(pit)); this line records the closure, not an owed gap.
- `parity/ledger/gen-framework.yaml:77` - Records that the three persistent-level connector functions are all present and that the one_off lists are an AVOID list, imposing no minimum
- `parity/ledger/mon-lore-describe.yaml:107` - Records that the tile-size gate is unconditionally true and omitted rather than faked, a ratified divergence at web/src/mapview.ts:70
- `parity/ledger/mon-make.yaml:49` - Records that LEVEL RATING was listed as deferred and is not - add_to_monster_rating is wired for generation and for live summons/breeders
- `parity/ledger/mon-take-hit.yaml:31` - Records that onKill is supplied by the live session and that player_kill_monster's consequences all run from there
- `parity/ledger/mon-take-hit.yaml:40` - Records that melee routes through monTakeHit at every site and that nothing applies damage inline any more
- `parity/ledger/obj-desc.yaml:44` - The sentence names objectKnownShadow as the replacement - the divergence, recorded
- `parity/ledger/obj-ignore.yaml:91` - Records that the port applies ignore settings immediately on read, so the flag is belt-and-braces; the ignore redraw is the ratified repaint divergence
- `parity/ledger/obj-knowledge.yaml:113` - Records the closure of every call-site family the row deferred, each named with its port location
- `parity/ledger/obj-randart.yaml:50` - Records that artifact_gen_name's word list IS ported (obj/randname.ts, checked against an independent oracle) and had been longer than the note claimed otherwise
- `parity/ledger/options.yaml:31` - Records that the options store replaced the scattered per-seam defaults
- `parity/ledger/options.yaml:74` - Records that options_save_custom / restore_custom / restore_maintainer landed as PORT_TODO 5.3, and that both halves of the reason for deferring them were wrong
- `parity/ledger/player-history.yaml:72` - Records that the earlier "find-on-sight" reading was a misreading of the C: object_touch is gated on loc_eq(grid, player->grid), so there is no on-sight discovery at a distance to reproduce
- `parity/ledger/project-path.yaml:78` - Records that square_isbelievedwall is ported and wired on both halves, and that every clause of the entry it replaces had stopped being true
- `parity/ledger/project-path.yaml:83` - target-loop.ts:243-270 is the live target loop and PORT_TODO 7.1 closed its terrain-memory path. target-loop.ts:252 is a separate object-memory gap; this ledger line is closure prose, not that owed row.
- `parity/ledger/session-save.yaml:80` - Records that the web host keeps a character roster with per-character slots and migrates legacy single-slot saves; save slots are a host concern and the format carries them
- `parity/ledger/session-save.yaml:92` - Records that birth_levels_persist is honoured and SavedGame.levelCache serializes every StoredLevel (save.c:1001)
- `parity/ledger/store-bind.yaml:55` - Describes the bookseller's data shape, which the expansion at store.ts:173 consumes
- `parity/ledger/store-maint.yaml:37` - Records that both conjuncts of the buy check are ported and that the object_flag_is_known half landed with PORT_TODO 2.10
- `parity/ledger/ui-entry.yaml:133` - Records that PF_FAST_SHOT is live and that the launcher-slot reach the row called deferred already existed in player/calcs.ts

### `not-a-deferral` - Ordinary English, not a parity claim (32)

- `packages/core/src/game/cave-cmd.ts:956` - Describes the fallback when the traps module is absent, not a missing feature; trap.ts registers the real disarm and session/game.ts:1698 supplies trapDeps
- `packages/core/src/game/context.ts:349` - Prose about why the options store is optional, and it states the fallback is exact; no feature is claimed absent
- `packages/core/src/game/context.ts:848` - Policy prose about an optional seam, not a parity claim, and the policy is honoured: state.combinePack IS supplied by the live session at session/game.ts:899, so only a worldless harness leaves the bit owed
- `packages/core/src/game/gear.ts:1269` - A sentence ABOUT the census, not a parity claim: the docblock explains that the local is named newPile after upstream rather than "deferred", and in saying so it matched the census itself. Left as-is rather than reworded, because the clearer sentence is worth one classified row.
- `packages/core/src/game/notice.ts:16` - Ordinary English ("would defer it by a turn") in prose explaining why ignore must run before combine; no feature is claimed absent
- `packages/core/src/game/notice.ts:50` - Policy prose, and the policy is honoured: state.combinePack is supplied at session/game.ts:899, so leaving PN_COMBINE set describes only an unwired harness. notice.test.ts asserts both halves
- `packages/core/src/game/pickup.ts:16` - Describes the behaviour when the module is not installed; installPickup replaces the stub and is called in the live composition
- `packages/core/src/player/options.ts:28` - Describes how seams read the store, and states the fallback is exact
- `packages/core/src/session/game.ts:1031` - A note about JavaScript declaration order, not a parity claim
- `packages/core/src/session/game.ts:3416` - A note about the mod event flood, not a parity claim
- `packages/web/src/charselect.ts:130` - Describes the shell's own command hook, not a parity claim
- `packages/web/src/main.ts:3736` - Records that a utility is deliberately unbound; nothing upstream is missing
- `packages/web/src/main.ts:5910` - main.ts:5910 merely describes routing a multi-object pile to the floor-list UI; main.ts:5973 calls showFloorList, which is implemented at overlay.ts:304 and exercised at overlay.test.ts:1424-1525.
- `packages/web/src/main.ts:5931` - The word "defer" is ordinary UI-routing prose, not an absence: this branch sets pendingFloorPile at main.ts:5931-5932 and the live caller opens showFloorList at :5973.
- `packages/web/src/main.ts:8475` - A setTimeout, chosen because the fault surfaces inside core
- `packages/web/src/mod-browse.ts:1156` - A variable named `todo`
- `packages/web/src/mod-browse.ts:1158` - A variable named `todo`
- `packages/web/src/mod-code.ts:207` - "rather than deferring to it" is about which layer reports a mod error
- `packages/web/src/mod-taint.ts:64` - "must defer" is about deferring to a tick, not a parity claim
- `packages/web/src/mod-zip-source.ts:129` - A one-tick setTimeout around a Chrome focus/change ordering quirk
- `packages/web/src/pwa.ts:29` - The beforeinstallprompt event, which is literally called a deferred prompt
- `packages/web/src/pwa.ts:51` - Same event
- `packages/web/src/userdir.ts:222` - A one-tick setTimeout around the same Chrome quirk
- `packages/cli/src/host-node.ts:50` - Quotes init.c's own "ToDo" comment as evidence about upstream
- `packages/desktop/src/main.ts:1133` - A variable named `todo`
- `packages/desktop/src/main.ts:1135` - A comment about that variable
- `packages/desktop/src/main.ts:1142` - Same variable
- `packages/desktop/src/main.ts:1146` - Same variable
- `packages/desktop/src/main.ts:1191` - Same variable
- `packages/mod-sdk/src/sort.ts:216` - A mod-conflict reason string: one mod "defers to" another
- `parity/ledger/game-effect-teleport.yaml:67` - A closure record under the ledger's deferred: key - the line's own text says NOT deferred any more, and the five rows it replaces were retired by 027de3e6a
- `parity/ledger/gamedata.yaml:5` - A structural comment about the document layout

<!-- END GENERATED -->
