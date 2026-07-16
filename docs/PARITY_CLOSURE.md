# Parity Closure Checklist (path to certified 4.2.6 parity)

Status: opened 2026-07-15 after a full plan-vs-code audit. This is the governing
worklist for closing every remaining gap between the port and the 4.2.6 tag
BEFORE any mod work begins. Ordering: CORE parity gaps first, then verification
tooling, then (separately, later) mods. Mods are explicitly OUT of scope here.

Legend: [ ] open, [~] in progress, [x] done.

## Guiding rulings (the maintainer, 2026-07-15)

- Close ALL core gaps to exact 4.2.6 behavior first; mods come after core is at
  100% parity with full mod support.
- No deviation from upstream was ever intentional. Every approximation is a
  defect to close, not an accepted variation (reinforces decisions 23, 25).
- The terminal/CLI *play* shell is NOT a goal: the web shell is the port's
  destination-platform interface. Node remains a tooling runtime only (harness,
  spoilers), never a required play surface. TypeScript (language) + Node
  (tooling runtime) is correct as-is.

## A. Core gameplay parity gaps

- [x] **A1. Persistent levels** (`birth_levels_persist`, decision 8). DONE.
  Generalized the proven in-memory arena-stash into a depth-keyed, serializable
  `state.levelCache`, gated on the option (OFF by default, so default play is
  unchanged). On leaving a persistent level: compact_monsters + clear player
  marker + stamp freeze-turn + store (cave_store, generate.c L1366); wipe/
  artifact-loss skipped under persist. On entering: if cached, restore the
  level, run the ported `restore_monsters` (regen + timed reduction over elapsed
  turns), sanitize_player_loc + player_place, and remove from cache (else
  generate fresh). Save format extended with an optional `levelCache` reusing
  the existing chunk/monster/group/floor/trap/known serializers (absent =>
  empty, back-compat). Golden tests: re-entry identity (layout + monsters),
  fresh-when-off, monster recovery, save round-trip. Core 2034 green.
  DEFERRED (documented): exact stair-connector matching on FIRST-visit
  generation of a persistent level (dun->persist / join connectors stay
  dormant) - re-entry identity is exact; only a first visit's arrival stair is
  approximate.
- [x] **A2. Identical randart names** (decision 25). `obj/randart.ts` uses a
  local syllable table; upstream `artifact_gen_name` (obj-randart.c L2713) calls
  `randname_make(RANDNAME_TOLKIEN, ...)`. `randname_make` is ALREADY ported
  (`obj/randname.ts`). Fix: compile the RANDNAME_TOLKIEN section of
  `reference/lib/gamedata/names.txt` into a corpus, build the prob table, and
  have randart naming call `randnameMake` with the exact upstream draw order.
  Verify a fixed-seed randart set matches upstream names.
- [x] **A3. obj->known exact** (decision 25). All three residual approximations
  closed, keeping the on-demand synthesis (proven byte-identical, no persistent
  twin needed): (a) real `obj_k->dd/ds/ac` runes added to PlayerObjectKnowledge,
  always 1 from birth (player_outfit obvious knowledge), serialized with a
  default-1 back-compat reader; the shadow multiplies base dd/ds/ac by them
  (obj-knowledge.c L830-838, L1039-1041) so base dice/AC of unidentified items
  show exactly as upstream. (b) the object_flavor_aware side effects
  (L1163-1175) are wired as a knowledge-UPDATE via playerKnowObjectAwareness,
  fired from objectLearnUnknownRune (gated on ASSESSED, matching upstream
  player_know_object's L1033 early return) and NEVER from the display-only
  shadow. (c) notice-mirroring documented as provably byte-identical under
  on-demand synthesis. Core 2030 green, golden tests added (known-object.test.ts).
- [x] **A4. Object-mimic appearance exact** (#71). Object-mimic PLACEMENT is
  unported (`mon.mimickedObj` is always 0 in live play), and the RF_MIMIC_INV
  give-a-copy branch is deferred (needs object_copy). Port both so mimicked
  objects spawn and reveal exactly as upstream. Reference: `mon-make.c`,
  `gen-monster.c`, `mon-move.c` reveal path.
- [x] **A5. get_move_find_hiding + pack-ambush + group-surround** (mon-move.c).
  `get_move_find_hiding` (L613), the `group_ai` ambush branch (L889-915), AND
  the group-surround branch (L932, which draws `randint0(8)`) are all ported at
  their exact upstream positions, so the RNG draw order matches upstream. Golden
  tests cover the hiding-square selection, the boxed-in ambush diversion, and
  the surround fill (skip-filled + fall-through). Done.
- [x] **A6. Zero UI-lore gaps.** Close every deferred lore/display item so
  monster/object knowledge presentation matches upstream: spell/blow color by
  KNOWN resist (mon-lore.c spellColor/blowColor), the `~` knowledge-menu monster
  browser, `get_history` population on the character sheet, EB equipment
  `stat_add`, and the char-sheet mode-1 grid. Also wire the remaining
  `history_add` triggers (#64: artifact loss, find-on-sight, store buy).

## A-followup. Surfaced during A3

- [x] **A7. Combat runes known at birth.** DONE (the maintainer's ruling 2026-07-16: "do
  whatever upstream game does; it was not intentional"). `blankObjKnowledge` now
  sets `to_a/to_h/to_d = 1` at birth exactly as upstream
  `do_cmd_accept_character` ("Hack - player knows all combat runes",
  player-birth.c L1264-1267), so an item's +to-hit / +to-dam / +AC show
  immediately even when unidentified. The learn-by-use combat paths
  (equip_learn_* / missile_learn_*) are preserved but vestigial in real play,
  matching upstream (the runes stay in the machinery, just pre-known). Tests
  updated: the learn-by-use and rune-enumeration tests now zero the combat runes
  explicitly to exercise the machinery in isolation; the object-desc test now
  asserts bonuses show from birth (and hide only if the rune is cleared); the
  legacy-save reader defaults combat runes to the upstream birth state (known);
  a new golden test asserts all three are 1 at birth. Core 2035 green, web+cli
  217 green.

## B. Verification + upstream-tracking tooling

- [x] **B1. Statistical parity harness** (decisions 2, 10, 23). DONE. Built in
  `packages/cli`: a deterministic Monte-Carlo harness (`stats.ts`) mirroring
  `main-stats.c` metrics (monsters by race, objects by tval/kind, gold, obj/mon
  feelings, artifact counts - all by depth), with per-(run,depth) derived seeds;
  a committed baseline (`baseline/stats-baseline.json`) + tolerance comparator
  (`baseline.ts`); and a golden-scenario runner (`scenarios.ts`, 3 scenarios
  driving startGame + the command queue end-to-end). Wired into the vitest suite
  (`parity.test.ts`, 7 tests, EXACT self-regression guard) and CI. Honest
  epistemics documented (`baseline/README.md`): the baseline is a
  self-consistency/regression guard, NOT yet a C-vs-TS diff; the comparator is
  structured to accept a C `main-stats` baseline to upgrade to a true
  cross-implementation check. Replaces the 2-line CLI stub.
  NOTE surfaced by the harness (out of B1 scope, logged for follow-up): floor
  gold objects carry `origin` 0 (NONE) rather than FLOOR at the `generateLevel`
  stage - captured faithfully in the baseline; verify against upstream and fix
  in a follow-up if it is a real deviation.
- [ ] **B2. Spoiler generator** (decision 10). Port `*-spoil.c` as a Node
  dev-tool (objects/artifacts/monsters spoilers). Tooling parity; not gameplay.
- [ ] **B3. Parity ledger reconciliation** (#59, decision 12). Correct every
  stale `status`/`deferred` field in `parity/ledger/*.yaml` against verified
  reality (PUNCHLIST.md). The ledger is the rebase map; it must match the code.
- [ ] **B4. Upstream rebase runbook** (decision 12). Document the tight,
  repeatable process: pull new upstream tag -> diff vs pinned `reference/`
  baseline -> map changed files/functions through the ledger to affected port
  modules -> generate migration worklist -> port + re-verify against B1 -> advance
  the pinned tag. Depends on B3.

## C. Presentation parity

- [ ] **C1. Upstream graphics parity.** Ensure the tile-graphics support that
  ships in upstream 4.2.6 is fully available in-port: selectable tile modes and
  the freely-licensed upstream tilesets loadable through the ported grafmode /
  ui-visuals pipeline (system was ported in #27). This is DISTINCT from the
  Linoleum mod (per-object images, variant pools), which is built only AFTER the
  port hits 100% parity.

## D. Save-architecture robustness (core, enables mods later)

- [ ] **D1. Mod dehydrate/rehydrate on uninstall/reinstall** (decision 19).
  Removing mods mid-game must drop the save back to an essentially vanilla state
  while keeping the mod's save content DEHYDRATED in the savefile; re-adding the
  mod simply REHYDRATES it. Harden and prove the namespaced save-block
  quarantine/restore path end-to-end (round-trip test: play modded -> uninstall
  -> vanilla-clean + dehydrated blob preserved -> reinstall -> full restore).

## E. Web-shell defects (core-adjacent, close now)

- [ ] **E1. Canvas taps leak through modals** (#62). `pointerdown` ignores
  `modalDepth`; taps pass through open modals. Fix + touch target-loop.
- [ ] **E2. Autoinscribe management UI** (#61). Per-kind note registry + UI.

## Explicitly deferred to the MODS phase (NOT part of core closure)

- QoL mod (the maintainer builds after core), bug-fixes mod (decision 24), Linoleum mod
  extension (#45; after 100% port), the beyond-parity NPC/quest/shop mods
  (decision 14), the three bundled mod packs (decisions 18/23), and the runtime
  web mod-loader (makes user mods work on static/PWA, not just Electron).
- Borg gap closure (artifact-activation identity, in-shop signal,
  hypothetical-loadout power deltas) -- the Borg IS a mod; these are implemented
  correctly in the Borg mod during the mods phase, with any required host/core
  data seams noted here if they surface.
