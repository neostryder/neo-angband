RNG determinism parity review
Independent adversarial review of RNG_FIX.diff

INFINITE-LOOP VERDICT (FIRST)

ISSUE: packages/core/src/store/store.ts:103

storeShuffle uses `while (o === store.owner) o = storeChooseOwner(...)`.
If store.owners has exactly one entry, every draw returns the current owner, so
the loop condition never becomes false. The initialization change at
store.ts:681 avoids this loop for the first store_reset draw, but the same
storeShuffle remains reachable from transact.ts:239 (empty-store restock) and
store.ts:663 (store_update). A one-owner custom or merged store therefore hangs
at 100 percent CPU. The C code has the same assumption at store.c:1497-1498,
but the port must not introduce an unbounded retry for data it accepts. The
actual shipped store pack has four owners per store; that does not make the
runtime implementation safe for a one-owner store.

Other termination checks

- The new flavor reverse walk in packages/core/src/obj/flavor.ts:180-191 is
  bounded: fi decreases from work.length - 1 to zero, and choice is bounded by
  flavorCount. It is not the hang.
- The trap generation path in packages/core/src/gen/util.ts:1176-1198 has no
  retry loop. vaultTraps in util.ts:1503-1510 is bounded to six attempts per
  trap. No new unbounded trap retry was found.
- There are pre-existing unbounded/retry-shaped paths outside these fixes,
  notably randnameMake's outer while at packages/core/src/obj/randname.ts:88
  and the title collision retry in packages/core/src/obj/flavor.ts:226-228.
  With the shipped valid corpus they are not caused by the reverse walk, but
  they are worth hardening independently.

PER-FIX VERDICTS

1. APPROVE - Store init extra owner draw

packages/core/src/store/store.ts:699-702 binds a non-random placeholder, and
store.ts:681 then consumes exactly one storeChooseOwner draw before the ten
maintenance calls. This matches C store_reset at store.c:340-355, where the
initial owner is null and store_shuffle's first choice is accepted. The later
storeShuffle retry behavior is a separate issue reported above; it is not an
extra initial draw.

2. ISSUE: packages/web/src/shop.ts:154-170

The port removes Math.random, and the accept/reaction draws are in the core at
the intended transaction positions. However, C ui-store.c:156-158 consumes a
one_in_(3) and then randint0 for a hint whenever the loaded hints list exists.
The port unconditionally skips that branch because CorePack does not bind
hints. The reference pack includes hints.json, so this is a missing main-stream
draw/count, not cosmetic-only behavior. The remaining level/title/name branch
at shop.ts:159-170 otherwise follows C ui-store.c:146-172.

3. ISSUE: packages/web/src/main.ts:5909

birth.ts:1213 correctly uses an injected RNG, but main.ts injects a fresh
new Rng(seed) instead of the already-running game's state.rng. C ui-birth.c
random choices at lines 465, 678, 696, and 842 advance the one global stream;
the port's birth draws are discarded when the modal ends. The later dungeon
and birth initialization therefore start from a different stream position.
The fallback new Rng(1) at birth.ts:1213 is also unsafe if runBirth is called
outside tests without an RNG.

4. APPROVE - RNG state save/load normalization

packages/core/src/rng.ts:414-418 now reduces stateI modulo RAND_DEG and forces
quick false, matching load.c:388-416. The saved value, 32-word WELL state,
and state index correspond to save.c:286-307. The fixed/fixval fields are
port-only test hooks and are false/zero in normal game saves; retaining them
does not change the normal C stream.

5. ISSUE: packages/core/src/gen/cave.ts:604-615

Wiring reg.traps through boot.ts:218-220 makes util.placeTrap draw the kind and
power for room/allocation traps, but tryDoor still calls only g.markTrap at
cave.ts:614. C gen-cave.c:830-833 calls place_trap there, which consumes the
pick_trap draw and the randcalc power draw. Those doorway traps still have no
generation-time descriptor and therefore still omit both draws. This fix does
not cover all C generation call sites.

6. ISSUE: packages/core/src/session/game.ts:1649-1657

populateFromLevel installs level.traps only when the descriptor list is
nonempty, then ignores trapGrids in that case. Because cave.ts:614 can create
trapGrids without a corresponding Gen.traps entry, a level containing both
descriptor traps and tryDoor marker traps silently loses the latter. If the
descriptor list is empty, the fallback at game.ts:1655 re-picks kind and power
on the play stream, which is exactly the second-draw problem this fix was meant
to remove. This becomes correct only after every C place_trap call, including
tryDoor, records kind and power and populate verifies that no bare marker
remains.

7. APPROVE - Flavor list reverse-walk order

packages/core/src/obj/flavor.ts:179-191 walks the working flavor list from the
last element toward the first. That matches the C linked-list head created by
init.c:4239-4270 and the forward linked-list walk in obj-util.c:76-112: choice
zero selects the last parsed remaining flavor. The loop is bounded and the
test fixture change in flavor.test.ts:43 supplies the same reverse word order
for scroll-title generation.

8. APPROVE - Random-name word order

packages/core/src/session/boot.ts:148-153 reverses each section's word array,
not each word's characters. The JSON record is already a section-level word
array, so this matches init.c:1476-1479, where each parsed word is prepended.
The corresponding flavor test uses the same transformation. No RNG draw is
added or removed by this binding change.

9. ISSUE: packages/core/src/game/mon-cmd.ts:169-173

The added draw is present, but it is placed as an unconditional one-draw step
after raw damage and before all C melee-effect handling. C performs the draw
inside the selected effect handler through mon-blows.c:395-399, 477-480,
609-612, and 645-647. In particular, timed monster effects evaluate their
randint1 amount before melee_effect_timed reaches monster_damage_target, while
the port draws the message first; elemental handlers can also omit the message
when final damage is zero, while the port still draws. Thus this fixes the
missing common draw but does not reproduce exact order/count for all handled
monster-target effects. It also omits the C message type, though that is not
itself an RNG issue.

LIVE MAIN-STREAM RNG BREAKS OUTSIDE THE NINE FIXES

- packages/web/src/main.ts:5901 seeds generateHistory from Date.now. C
  player-birth.c:330-346 get_history consumes randint1(100) per history node,
  and ui-birth.c:746-750 calls it for the birth history preview. This is a C
  main-stream draw. It must use the same game stream and preserve redraw/back
  behavior, not a wall-clock stream.
- packages/web/src/main.ts:751 uses Math.random for RF_ATTR_MULTI. C
  ui-display.c:1439-1446 calls randint1(BASIC_COLORS - 1) on the main RNG for
  every visible multi-colored monster render. The comment claiming display
  randomness is not oracle-faithful; this remains a live stream divergence.
- packages/core/src/session/game.ts:2243 uses new Rng(opts.seed).randint0 for
  randart_seed. C player-birth.c:1283-1291 draws seed_randart and then
  seed_flavor from the same main stream. This separate RNG is another live
  stream-position divergence when birth_randarts is enabled.

TEST AND GOLDEN ARTIFACTS

packages/core/src/store/transact.test.ts:449-454 is justified only by the
new C comment_accept draw: the test now probes one_in_(3) and the optional
randint0(6), which is the stated store.c:1717 behavior. It is not merely
silencing a failure.

packages/core/src/obj/flavor.test.ts:41-43 is justified by the C prepend order
and tests the same input ordering as bindCore. It is also not a failure mask.

packages/cli/baseline/stats-baseline.json changes hundreds of generated counts
starting at line 300, including large changes in gold, monster totals, object
totals, and origins. The diff supplies no C trace or per-seed oracle comparison
that proves these new values. Since fixes 5 and 6 currently omit/redo doorway
traps, fix 3 does not advance the real stream, and the live RNG breaks above
remain, this 436-line replacement cannot be accepted as a C-justified golden.
It currently functions as a failure-baseline update; revert it until the
stream is repaired and the exact C-vs-port stats are demonstrated for each
seed.

OVERALL

The diff is not approvable under Decision 6.2. Fixes 1, 4, 7, and 8 are
supported by the cited C. Fixes 2, 3, 5, 6, and 9 have stream or termination
issues. The store one-owner loop is the first concrete infinite-loop defect.
The full suite was not rerun because the reported six-hour hang makes an
unbounded run unsafe; this review is based on the cited oracle paths and the
live changed code.
