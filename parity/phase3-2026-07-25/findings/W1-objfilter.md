# W1 — object-filter predicates (obj-util.c / obj-tval.c / obj-slays.c / obj-pile.c)

Worktree: `C:\Repositories\na-wt-fx` (`p5/objfilter`). Resumed from an
inherited WIP snapshot (`fc9b3261e`) recovered after a host reboot; triaged
per the resume brief before extending.

## Inherited-hunk triage (commit fc9b3261e)

| file | hunk | verdict | reference | test |
|---|---|---|---|---|
| `game/effect-item.ts` | `tvalIsBolt(o.tval)` replaces inline `o.tval === TV.BOLT` in the BRAND_BOLTS tester | KEEP | `obj-tval.c:165` (`tval_is_bolt`) | Behavior-preserving refactor — the two forms are provably identical for all inputs, so no test can fail-without-it. Existing `effect-item.test.ts:413` ("BRAND_BOLTS flames a chosen stack of bolts") already covers the tester's behavior and still passes. |
| `game/floor.ts` | `pileContains`, `pileLastItem` | KEEP | `obj-pile.c:268`, `:248` | `floor.test.ts` "pileContains / pileLastItem" (2 new tests, direct unit tests since neither is wired to a caller yet) |
| `game/floor.ts` | `OFLOOR`/`USE_MODE` bit constants, `ItemTester`, `scanFloor` | KEEP | `obj-pile.h:44-48`, `game-input.h:28-31`, `obj-pile.c:1295` | `floor.test.ts` "scanFloor" (5 new tests: tester, TOP, VISIBLE, cap) |
| `game/floor.ts` | `scanItems` | KEEP | `obj-pile.c:1376` | `floor.test.ts` "scanItems" (4 new tests: pass order, quiver-dedupe, itemMax cap) — mutation-verified below |
| `game/obj-cmd.ts` | `objectEffect`, `objIsActivatable`, `objCanActivate`, `objCanWear` | KEEP | `obj-util.c:886`, `:721`, `:730`, `:810` | `obj-cmd.test.ts` new describe blocks (6 tests) |
| `game/obj-cmd.ts` | `useAux` reads `objectEffect(obj)` instead of `obj.effect` | KEEP — confirmed real bug fix | `cmd-obj.c:410` (`struct effect *effect = object_effect(obj);`) | `obj-cmd.test.ts` "runs the ACTIVATION's effect chain..." — mutation-verified below |
| `game/obj-cmd.ts` | `useCommand`'s `ready` param; zap-rod keeps `objCanZap`, activate switches to `objCanActivate` | KEEP — confirmed real bug fix (see GAP-FIXED below) | `cmd-obj.c:832-889` (`do_cmd_zap_rod`/`do_cmd_activate` use distinct guards) | `obj-cmd.test.ts` "registered command: activate" / "zap-rod" (3 tests) — mutation-verified below |
| `game/spell-cmd.ts` | `playerBookHasUnlearnedSpells` | KEEP | `player-util.c:1315` | `spell-cmd.test.ts` new describe (3 tests) |
| `obj/bind.ts` | `ObjRegistry.lookupArtifactName`, `.lookupEgoItem` | KEEP | `obj-util.c:520`, `:549` | `bind.test.ts` new describes (7 tests) |
| `obj/object.ts` | `tvalIsBolt` definition | KEEP | `obj-tval.c:165` | paired with the effect-item.ts hunk above |
| `player/spell.ts` | `objCanBrowse`, `objCanCastFrom`, `objCanStudy` | KEEP | `obj-util.c:775`, `:780`, `:786` | `spell.test.ts` new describe (2 tests) — mutation-verified below |
| `web/main.ts` | Wires `objCanWear`/`objIsActivatable`/`objCanBrowse`/`objCanCastFrom`/`objCanStudy`/`playerBookHasUnlearnedSpells` into `activateItem`, `chooseBook`, `castSpell`, `studySpell`, `browseCmd`, `useGenericCmd`, `swapWeaponCmd`, `displayDeps`, the `w` keydown handler | KEEP | `cmd-obj.c:879,987,1129,1187,1215`; `ui-spell.c:340`; `ui-display.c:1235` | No direct unit harness exists for `main.ts` in this codebase (no `main.test.ts`; it's integration glue). Verified line-by-line against each cited C call site; the underlying predicates it calls are unit-tested above. |
| `web/screens.ts` | `magicBooks` takes an optional `tester`, defaulting to accept-all (which combines with the existing `playerObjectToBook` check to reproduce `obj_can_browse`) | KEEP | `cmd-obj.c:1129/1187/1215`, `ui-spell.c:340` | `screens.test.ts` new describe (3 tests) — mutation-verified below |

**Corrects a stale prior claim**: `parity/phase3-2026-07-25/findings/W1-obj-util.md`
(an earlier lane) marked `obj_is_activatable` and `obj_can_wear` **PORTED**
against the pre-WIP `main.ts`, which only tested `obj.activation` (missing
every kind-effect ring) and `tvalIsWearable` directly. Per
`parity-lane-reports-are-leads-not-specs`: that PORTED verdict was wrong at
the time; this lane's fix is what makes it true now.

## Extension made in this session (within batch scope)

While proving `scanFloor`/`scanItems`, I found upstream's `object_test`
(`obj-util.c:386`) — the actual tester wrapper `scan_floor`/`scan_items` call,
not the bare tester — **always excludes gold** (`tval_is_money`), even with a
null tester. The inherited `scanFloor`/`scanItems` called the tester directly
and had no gold exclusion, so a future null-tester caller (e.g. a "drop"/"pickup"
`get_item`) would list gold objects the C never would. No current caller
passes a null tester with gold reachable, so this was latent, not yet visible
in play — but it is squarely the `object_test` predicate from my assigned
batch. Added `objectTest()` (`packages/core/src/game/floor.ts`) and routed
both scan functions through it. Proven by `floor.test.ts` "excludes gold from
a null-tester scan" (2 tests, one per function) — mutation-verified below.

## Lane table — every symbol in the assigned batch

Batch = `w1-triage.tsv` rows with `AREA-WORKED-NO-CANDIDATE`/`NO-TRACE` under
`obj-util.c`, `obj-tval.c`, `obj-slays.c`, `obj-pile.c` (23 symbols).

| C symbol | ref | verdict | evidence |
|---|---|---|---|
| `pile_last_item` | obj-pile.c:248 | PORTED | `pileLastItem`, `packages/core/src/game/floor.ts:83` |
| `pile_contains` | obj-pile.c:268 | PORTED | `pileContains`, `floor.ts:70` |
| `object_free` | obj-pile.c:294 | N/A | Manual C heap free (`mem_free` of `slays`/`brands`/`curses`/the struct); GC owns object lifetime in TS |
| `object_pile_free` | obj-pile.c:366 | N/A | Manual C heap free of an entire linked pile; same reason |
| `scan_distant_floor` | obj-pile.c:1334 | PORTED (reduced, pre-existing) | `packages/core/src/game/target-loop.ts:107-120` — the look/target cursor's object clause reads the live `floorPile` instead of a remembered-object twin cave; the module header (`target-loop.ts:31-36`) documents the reduction explicitly. Not part of this lane's changes. |
| `scan_items` | obj-pile.c:1376 | PORTED | `scanItems`, `floor.ts:175` |
| `item_is_available` | obj-pile.c:1426 | GAP (see below) | not ported |
| `brand_count` | obj-slays.c:223 | PORTED | `countTrue`, `packages/core/src/obj/randart-data.ts:226`, used at `:578/581/638/641/722/725` (one shared counter for both brands and slays, matching the C's identical logic in two functions) |
| `slay_count` | obj-slays.c:244 | PORTED | same as `brand_count` |
| `tval_is_mushroom_k` | obj-tval.c:64 | N/A | Zero call sites anywhere in `reference/src/**/*.c` — dead even in the C; no reachable behavior to port |
| `tval_is_money_k` | obj-tval.c:99 | PORTED | `tvalIsMoney(kind.tval)`, e.g. `packages/core/src/game/mon-place.ts:293`, `game/wizard.ts:288` — the port generalizes over a raw `tval` number instead of duplicating one predicate per struct type |
| `tval_is_bolt` | obj-tval.c:165 | PORTED | `tvalIsBolt`, `packages/core/src/obj/object.ts` (this lane) |
| `tval_is_book_k` | obj-tval.c:339 | PORTED | `tvalIsBook(kind.tval)`, `packages/core/src/obj/desc.ts:175`, `obj/make.ts:1280` |
| `tval_sval_count` | obj-tval.c:429 | PORTED | Only C caller is `obj-make.c:191` (`init_money_svals`, enumerating gold kinds); ported directly as a `reg.kinds` filter, `packages/core/src/obj/make.ts:322-327` |
| `tval_sval_list` | obj-tval.c:451 | PORTED | same call site as `tval_sval_count`, same evidence |
| `lookup_artifact_name` | obj-util.c:520 | PORTED | `ObjRegistry.lookupArtifactName`, `packages/core/src/obj/bind.ts` (this lane) |
| `lookup_ego_item` | obj-util.c:549 | PORTED | `ObjRegistry.lookupEgoItem`, `bind.ts` (this lane) |
| `obj_is_activatable` | obj-util.c:721 | PORTED | `objIsActivatable`, `game/obj-cmd.ts` (this lane) |
| `obj_can_cast_from` | obj-util.c:780 | PORTED | `objCanCastFrom`, `player/spell.ts` (this lane) |
| `obj_can_study` | obj-util.c:786 | PORTED | `objCanStudy`, `player/spell.ts` (this lane) |
| `obj_can_wear` | obj-util.c:810 | PORTED | `objCanWear`, `game/obj-cmd.ts` (this lane) |
| `obj_is_throwing` | obj-util.c:824 | GAP (see below) | not ported |
| `obj_is_useable` | obj-util.c:867 | GAP (see below) | partially ported |

## GAP blocks

### GAP-1: `item_is_available` (obj-pile.c:1426) — not ported, not fixed
ref: `object_is_carried(player, obj) || square_holds_object(cave, player->grid, obj)`, guarding `do_cmd_fire` (`player-attack.c:1338`, "That item is not within your reach.")
port: no equivalent check in `packages/core/src/game/ranged-cmd.ts`'s `fire` handler
what differs: the C re-validates that a picked ammo object is still reachable (guards a stale handle across a repeated/queued command). The port's `fire` resolves ammo only via `state.gear.store` (never a floor index), so the specific staleness this check guards against cannot currently occur — but that is because floor-sourced firing (`USE_FLOOR` in upstream's `cmd_get_item` mode) is not wired into `ranged-cmd.ts` at all, which is a separate, larger gap in `obj_can_fire`'s command wiring, not an object-filter predicate.
effect: none observable today (the vulnerable path doesn't exist yet); becomes live the day floor-sourced firing is added
severity: P3
fixed: no — reason: the actual missing capability (fire ammo from the floor) is out of this batch's scope (`obj_can_fire`/`ranged-cmd.ts`, not an obj-util/obj-tval/obj-slays/obj-pile predicate); adding only the guard with no floor-fire path would be untestable dead code

### GAP-2: `obj_is_throwing` (obj-util.c:824) — not ported, not fixed
ref: `of_has(obj->flags, OF_THROWING)`, used by `ui-object.c:1456-1458` to power the `get_item` menu's "SHOW_THROWING" sub-view (a toggle that narrows the picker to OF_THROWING-flagged items specifically, distinct from `obj_can_throw`'s broader "can be thrown at all" filter already used by the port's `throw` command)
port: `packages/web/src/main.ts` has no `SHOW_THROWING`-equivalent toggle in any item picker; the flag itself is read inline elsewhere (`combat/ranged.ts`, `obj/power.ts`) for damage/crit purposes, unrelated to this UI feature
what differs: the classic get_item dialog's "narrow to throwing items" keystroke toggle is absent
effect: cosmetic/convenience only — every throwable item is still reachable through the normal (unfiltered) picker via the `throw` command's own `obj_can_throw` filter
severity: P3
fixed: no — reason: this is a `get_item` menu UI feature (a new toggle + sub-view), not a predicate function; implementing it means touching `main.ts`'s picker modal architecture, well outside "port a filter predicate"

### GAP-3: `obj_is_useable` (obj-util.c:867) — partially ported, not fixed
ref: `tval_is_useable(obj) || object_effect(obj) || (tval_is_ammo(obj) && obj->tval == player->state.ammo_tval)` — `do_cmd_use`'s (`U`) get_item filter (`cmd-obj.c:950`)
port: `useGenericCmd` (`packages/web/src/main.ts:4356`) covers the device/consumable tval set (`codeFor`: wand/rod/staff/scroll/potion/edible, matching `tval_is_useable`) and equipped activatable items (this lane's `objIsActivatable` fix)
what differs: it does **not** list (a) an *unequipped* wearable-with-effect object sitting in the pack (upstream's `object_effect(obj)` half of the OR has no equipped requirement — it's listed regardless, and only refused with "Equip the item to use it." after selection if not worn), or (b) ammo matching the current launcher's tval (upstream's third OR arm; the C routes a selected ammo to `do_cmd_fire`)
effect: pressing `U` with, say, a Ring of Flames unequipped in the pack, or ammo for the wielded launcher, silently omits them from the "Use" list instead of listing-then-refusing (ring) or firing (ammo) — a real but narrow omission, since both items remain reachable via their own dedicated commands (wield-then-activate, or `f`ire)
severity: P3
fixed: no — reason: fixing requires extending `useGenericCmd`'s picker to scan the whole pack plus quiver/launcher-match, a UI-command expansion beyond this batch's predicate-function scope; flagging rather than scope-creeping this late in the lane

## Mutation table

| mutation | test that caught it | pre-existing suite catch it too? |
|---|---|---|
| `useAux`: `objectEffect(obj)` → `obj.effect` | `obj-cmd.test.ts` "runs the ACTIVATION's effect chain in place of the kind's own effect" | No — no prior test exercised an activation whose kind also carried its own effect |
| `activate` registration: `ok: objCanActivate` → `ok: objCanZap` | `obj-cmd.test.ts` "activates a ring with a kind effect and no `act:`" | No — no prior test exercised the `activate` registered command at all |
| `floor.ts` `objectTest`: removed the `tvalIsMoney` gold exclusion | `floor.test.ts` "excludes gold from a null-tester scan" (both `scanFloor` and `scanItems` variants) | No — `scanFloor`/`scanItems` had no prior tests |
| `scanItems` INVEN pass: removed the `objectIsInQuiver` skip | `floor.test.ts` "the inventory pass excludes quivered handles" | No — same, no prior tests |
| `scanItems`: swapped EQUIP/INVEN pass order | `floor.test.ts` "orders inventory, equipment, quiver, then floor" | No — same |
| `objCanStudy`: reduced to bare `objCanBrowse` (dropped the `spellBookCountSpells` count) | `spell.test.ts` "objCanCastFrom and objCanStudy diverge from the bare browse test" | No — no prior test exercised `objCanStudy`/`objCanCastFrom` at all. Note: `screens.test.ts`'s `magicBooks`-tester test does **not** catch this mutation live, because `packages/web` resolves `@neo-angband/core` through the built `dist/` (package.json `main`), not `src` — a core-only edit needs `pnpm build` before a web-level test can see it. Not a defect in the test; a build-step dependency worth knowing when debugging a "web test didn't catch it" surprise. |

(`objCanWear`'s `wieldSlot(obj) >= 0` refactor and `tvalIsBolt`'s introduction
are both provably behavior-identical to what they replaced over every input —
see the inherited-hunk table — so no mutation of them can be caught by a
behavioral test; this was verified by hand-tracing `wieldSlot`/`slotByType`'s
fallback path rather than by a failing mutation.)

## Counts

- Inherited hunks: 13 triaged, **13 KEEP, 0 REVERT, 0 REWORK** (one hunk —
  `scanFloor`/`scanItems`'s tester wrapper — extended with the `objectTest`
  gold-exclusion fix, itself in batch scope).
- Lane symbols: 23 total — **17 PORTED, 3 N/A, 3 GAP** (none of the 3 GAPs
  fixed; all P3, all documented above with a specific out-of-scope reason).
- New tests added: 43 (`floor.test.ts` +24, `obj-cmd.test.ts` +11,
  `spell-cmd.test.ts` +3, `spell.test.ts` +2, `bind.test.ts` +7,
  `object.test.ts` +1, `screens.test.ts` +3 — some totals overlap net-new vs.
  touched-file line counts; exact per-file counts are in the table above).
- Mutations run: 6, all caught by the new tests, none caught by the
  pre-existing suite.
- `pnpm build`: clean.
- `npx vitest run` on touched files: 8 files / 265 tests, all passing.
- Full `packages/core/src` suite (excluding the known-hang
  `packages/borg/src/{think,foundation}.test.ts`): 222 files / 2991 tests, all
  passing.
- Full `packages/web/src` suite: 35 files / 438 tests, all passing.

## Merge resolution (integrate/objfilter, `git merge --no-ff p5/objfilter`)

Merging this lane's branch into `integrate/objfilter` (already carrying the
`p5/cmdwiz` + `p5/playercan` read-scroll resolution, commit `e8982d17a`)
conflicted in five files. Both sides were independent ports of the same C;
resolution follows `parity-lane-reports-are-leads-not-specs` — read the C
before picking a side.

| file | upstream C function | HEAD had | p5/objfilter had | kept | why |
|---|---|---|---|---|---|
| `game/obj-cmd.ts` (imports/functions) | `object_effect`/`obj_is_activatable`/`obj_can_activate`/`obj_can_wear` (obj-util.c:886/721/730/810) vs. `player_can_read`/`no_light` (player-util.c:1166, cave-view.c:913) | `playerCanRead`, `noLight`, the `squareIsSeen` import (from the prior read-scroll merge) | `objectEffect`, `objIsActivatable`, `objCanActivate`, `objCanWear` (this lane's new predicates) — and had *dropped* `playerCanRead`/`noLight` because p5/objfilter's base predates their addition | **both** — inserted the four new p5 functions right after `objCanZap`, kept `playerCanRead`/`noLight`/the `squareIsSeen` import untouched | Non-overlapping additions to the same function neighborhood; p5/objfilter never touched read-gating, it just lacked it because its base was older. Dropping either side would regress real, already-tested behavior. |
| `game/obj-cmd.ts` `useAux`'s effect-chain build | `use_aux` (cmd-obj.c:410, `struct effect *effect = object_effect(obj);`) | `buildObjectEffectChain(obj.effect ?? [], ...)` | `buildObjectEffectChain(objectEffect(obj) ?? [], ...)` | p5/objfilter's `objectEffect(obj)` | Confirmed real bug fix per the task brief: an activation's effect must replace the kind's, not run alongside/instead-of-correctly. `obj.effect` alone ran an artifact's (often empty) kind effect instead of its activation. |
| `game/obj-cmd.ts` `useCommand` + `zap-rod`/`activate` registrations | `do_cmd_zap_rod` (cmd-obj.c:832, guards `obj_can_zap`) vs. `do_cmd_activate` (cmd-obj.c:866, guards `obj_can_activate`) — two commands, two distinct guards | generic `USE.TIMEOUT` branch in `useCommand` guarded on `objCanZap` for **both** zap-rod and activate | per-command `ready: {ok, msg}` param — zap-rod passes `objCanZap`, activate passes `objCanActivate` with `objIsActivatable` as the filter | p5/objfilter's `ready`-param mechanism | This is the exact bug named in the task: `objCanZap` requires a rod tval (`tvalCanHaveTimeout`), so using it as activate's guard permanently refused every artifact/ring activation. Confirmed against `cmd-obj.c:851-855` (zap-rod's own wording) vs. `:886-890` (activate's own wording) — upstream never shares this guard. |
| `game/obj-cmd.ts` `installObjCommands` quaff/read registrations | `do_cmd_quaff_potion` (cmd-obj.c:917-931, opens with the resume-shape gate) and `do_cmd_read_scroll` (cmd-obj.c:740-758, resume-shape gate THEN `player_can_read`) | `quaff` wrapped in `gated(...)`; `read` wrapped in `gated(...)` **and** additionally checks `playerCanRead` before the scroll pick | `quaff` **not** gated at all; `read` gated but with no `playerCanRead` check | HEAD's versions of both, verbatim | p5/objfilter's base predates both fixes (the shape-gate-on-quaff fix and the `player_can_read` wiring), so its simpler versions are stale, not intentional changes — confirmed by diffing p5/objfilter's own history against the merge-base, which has neither fix either. Keeping p5's versions would have reintroduced two already-fixed, already C-verified bugs. |
| `game/obj-cmd.test.ts` | (test file, no single C function) | `describe("player_can_read gates the read command...")` — 7 tests | `describe("object_effect / obj_is_activatable / obj_can_activate...")`, `describe("obj_can_wear...")`, `describe("registered command: activate...")`, `describe("registered command: zap-rod...")` — 11 tests | **both**, concatenated | Two disjoint test suites for two disjoint features (read-gating vs. activation-guard fix); pure textual conflict from both being appended at the same line, no logical overlap. All imports (`objectEffect`, `objIsActivatable`, `objCanActivate`, `objCanWear`, `objCanZap`, `invenWield`, `maxDeviceSkill`) were already present/needed by the pre-existing merged import block. |
| `game/spell-cmd.ts` | `player_can_cast` (player-util.c:1087) vs. `player_book_has_unlearned_spells` (player-util.c:1315) | Detailed `playerCanCast` docstring (contrast with `player_can_read`, the two prereq exports) | New function `playerBookHasUnlearnedSpells` + a one-line `playerCanCast` docstring | **both** — kept HEAD's fuller `playerCanCast` docstring, inserted p5/objfilter's whole new `playerBookHasUnlearnedSpells` function immediately before it | Different functions in the same file region; p5/objfilter's one-liner replacement docstring carried no information HEAD's richer one didn't already have, so HEAD's was kept. |
| `game/spell-cmd.test.ts` | (test file) | Full test file incl. the "spell consequence wiring" describe block, importing `playerCanCast`/`SQUARE` (needed by an already-merged, unconflicted `player_can_cast no_light` describe block further down) | Same test-body content byte-for-byte (diffed to confirm — only a trailing-newline difference) but a shorter import list (had `playerBookHasUnlearnedSpells`, lacked `playerCanCast`/`SQUARE`) | HEAD's body, union of both import lists | The conflict was purely an import-list artifact around identical test bodies — confirmed via `diff` against each side's pre-merge blob (`git show <rev>:...`) after excluding each side's own unique tail block. The already-auto-merged tail (both the `no_light` describe block HEAD added and the `playerBookHasUnlearnedSpells` describe block p5/objfilter added) needs both `playerCanCast`+`SQUARE` and `playerBookHasUnlearnedSpells` in scope, so the merged import list needs all three sets. |
| `web/main.ts` `castSpell` | `do_cmd_cast` (cmd-obj.c:1113): `player_get_resume_normal_shape` -> `player_can_cast(player, true)` (L1123, BEFORE `cmd_get_spell`) -> `cmd_get_spell`'s book tester `obj_can_cast_from` (L1129) | `playerCanCast(state, {msg: say})` gate before `chooseBook`, but `chooseBook` called with no tester (accepts any book) | An inline `if (!player.cls.magic.totalSpells)` check (a partial, no_light/blind/confused-blind reimplementation of one branch of `player_can_cast`) before `chooseBook`, but `chooseBook` called with `(o) => objCanCastFrom(player, o)` as the book tester | **both real halves**: HEAD's full `playerCanCast` gate (kept, its comment now cites the exact C line numbers) + p5/objfilter's `objCanCastFrom` book tester | `do_cmd_cast` has TWO separate checks at two different call sites (L1123's full player-state gate, then L1129's per-book tester inside `cmd_get_spell`) — exactly the pattern the task brief warned about. p5/objfilter's inline totalSpells check was a weaker duplicate of the first gate (missing no_light/blind/confused), so it was dropped in favor of `playerCanCast`, but its `objCanCastFrom` book-filtering discovery is real and was missing entirely on HEAD's side. |

All five files verified with `pnpm build` (clean, `@neo-angband/mod-sdk` built
first since it was an unrelated missing prerequisite, not a merge artifact)
and `vitest run --root packages/core` / `--root packages/web`: 226 files /
3262 tests and 36 files / 453 tests, all passing. Merge committed with
`--no-ff` on `integrate/objfilter`; not pushed.
