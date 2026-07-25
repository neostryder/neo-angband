# RNG-Determinism P1 Fix Brief (Grok writer)

Decision 6.2: the BASE GAME must reproduce the C's EXACT RNG stream (same seed -> same
dungeon and rolls). Every fix below must make the port draw from the game RNG in the SAME
ORDER and SAME COUNT as the C. `reference/` is the ORACLE.

## Non-negotiable rules
- Match the C draw order and count EXACTLY. No extra, missing, or reordered draws.
- Use the shared GAME RNG (state.rng), never Math.random or a Date.now-seeded RNG, for any
  draw that the C makes on its main/gen stream.
- REUSE existing infra where present; do not reimplement subsystems. Minimal surgical diffs.
- ASCII only. Do NOT commit or push. Leave changes in the working tree.
- After changes, run the FULL suite: `pnpm test` (vitest run) + `pnpm typecheck`. RNG changes
  ripple into goldens; if a fix legitimately shifts a self-generated golden, update the golden
  ONLY if the new behavior matches the C (note which and why). If a fix would require large or
  risky changes, STOP and report rather than force it.

## The 9 fixes (C file:line -> port)
1. **Store init extra owner draw** — `store.c:340-357,1478-1501`. C: first owner = one
   `randint0(n_owners)` per store, then store_maint x10. Port draws owner at bind, THEN
   store_shuffle draws again until a different owner (>=1 extra draw). Fix: single owner draw
   at init, matching C order. (`packages/core/src/store/*`)
2. **Shop flavor uses Math.random** — `store.c:453-460,491-507,1717-1718`; `ui-store.c:139-177`.
   accept roll (one_in_(3)), comment_accept ONE_OF, purchase_analyze ONE_OF, and prt_welcome
   one_in_/randint0 all consume the MAIN game RNG in C statement order. Port uses Math.random
   (flavorOneIn/flavorPick) and emits comment_accept in the shell AFTER storeBuy returns. Fix:
   route these through state.rng at the C call position (comment_accept inside do_cmd_buy BEFORE
   any empty-store shuffle/maint). (`packages/core/src/store/*`, `packages/web/src/shop.ts`)
3. **Birth random choices use Date.now RNG** — `ui-birth.c:678`. Random birth choices must
   consume the shared game RNG stream, not a new Date.now-seeded one. (`packages/web/src/*birth*`)
4. **RNG state save/load normalization** — `save.c:286-307`, `load.c:388-415`. C saves
   Rand_value, state_i, 32-word WELL state; load reduces state_i modulo RAND_DEG and forces
   Rand_quick=false. Port restores stateI directly (no modulo) and persists quick/fixed/fixval.
   Fix load to modulo-normalize state_i and force quick=false. (`packages/core/src/save/*`,
   `packages/core/src/rng.ts`)
5. **Gen-time trap pick/power draws missing** — `trap.c:356-394`, `gen-util.c:790-791`,
   `gen-cave.c:821-834`. During generation place_trap draws pick_trap + power INTO the level
   RNG stream; port genDeps omits trapKinds so no gen-stream draw -> all later placement
   diverges. Fix: wire trapKinds into genDeps so place_trap draws kind+power at gen time in the
   gen stream. (`packages/core/src/gen/*`) [HIGH RIPPLE - run full gen tests]
6. **populateFromLevel re-picks traps** — `trap.c:356-394`. Kind/power chosen at generation are
   final; port re-draws pick+power on the play RNG (tIdx=-1) and discards Gen.traps. Fix:
   materialize the generated trap (kind+power) without a second draw. (`packages/core/src/gen/*`)
7. **Flavor list reverse-walk order** — `init.c:4239-4270`, `obj-util.c:76-112`. C prepends
   flavors (linked-list head = last parsed); flavor_assign_random choice=0 selects the LAST
   remaining random flavor of that tval in file order. Port walks forward. Fix: reverse the
   flavor walk to match C so seed_flavor produces the C's colours. (`packages/core/src/obj/*`,
   content bind)
8. **Random-name word order not reversed** — `init.c:1476`. names.txt words are prepended;
   each section's indexed word array is REVERSE file order. Port stores forward order. Fix:
   reverse per-section word arrays at bind. (`packages/core/src/*` content bind)
9. **Monster-vs-monster blow action-message draw missing** — `mon-blows.c:225`. Each handled
   monster-target blow calls display_blow_message_vs_monster incl. its `randint0(num_messages)`
   draw. Port omits the message AND the draw. Fix: emit the vs-monster message and make the
   matching randint0 draw in the C position. (`packages/core/src/combat/*`, `mon` msg)

## Report back (stdout)
Per fix: files changed, one-line summary, whether any golden was updated (and why it matches C).
Then: `RNG FIXES DONE <n>/9 tests <pass|fail>`. Leave changes uncommitted.
