# Planned, not yet implemented

**This file is the only place in the repository where work that has NOT landed is
written down.** `CHANGELOG.md` records what shipped and nothing else: an entry
appears there when the code is in the tree, never before. The two are easy to
blur, and blurring them is expensive in a public repository: a changelog that
describes intentions reads, to somebody who did not write it, exactly like a
changelog that describes features. They then look for the feature.

So the rule is one sentence. **If it works, it goes in the changelog. If it is
going to work, it goes here.**

What this file is *not*: it is not the plan. `docs/PORT_PLAN.md` holds the
ratified decisions and the shape of the project, and it outranks this file
wherever they touch. This is a worklist: the things known to be missing, with
enough of the evidence attached that picking one up does not mean rediscovering
why it matters.

An item leaves this file in exactly one of three ways: it lands (and is written
up in `CHANGELOG.md`), it is found not to apply (and says so, briefly, before it
goes), or it is found to be unreachable in the thing being ported (and says
that). "Still open" is not one of them, and neither is silence.

Last reviewed: 2026-08-20.

---

## Core fidelity

### The remaining `finish_parse_*` hooks

Upstream runs a finish hook after parsing many of its data files, a second pass
that orders, validates, back-fills or reverses what the parser built. The port
folds parse and finish together in a registry constructor, which means **a parity
test mirroring upstream's parser tests is structurally blind to the finish
hook**: it can pass in full while the finish pass is simply absent. Four have
been found missing that way and are now ported (`finish_parse_feat`'s
prefix/preposition space, store `shopnum`/`store_max` ordering, critical-level
validation, hints order).

**33 of ~45 hooks in the reference tree have been audited**: `init.c`'s 14,
`obj-init.c`'s 11 and `mon-init.c`'s 8, the last two on 2026-08-20. What is
left, by file:

| Where | Hooks | Note |
| --- | --- | --- |
| `generate.c` | 3 | level generation; a divergence here moves the RNG stream |
| singletons | 9 | one hook each, spread across the remaining files |

The audit method: read the upstream `finish_parse_*` body, find the port's
equivalent constructor, and ask what the hook does that the constructor does
not. A hook with no port subject is a finished answer and should be recorded as
one.

**What `obj-init.c`'s eleven turned up**, recorded so the reading is not
repeated. Eight were already reproduced: `projection` (its element-count
validation is present, and in a mod-aware form that names the offending code),
`object_base` (tval indexing), `act`, `object` (the base-kind flag union and
`ordinaryKindCount`), `ego` (`eidx`), `artifact` (the four object-like kinds),
`object_property`, and the 1-based arrays the rest of them build. One was
missing and is now ported: **`finish_parse_curse`'s MULTIPLY_WEIGHT check**, on
a curse with a negative weight adjustment. Two have no port subject:

- **The 254-entry cap on slays, brands and curses.** Upstream returns
  `PARSE_ERROR_TOO_MANY_ENTRIES` past 254 because of the width C stores those
  indices in. The port stores an object's brands and slays as `boolean[]` and
  saves them by CONTENT ID, not by index, so there is no width to overflow, and
  reproducing the cap would add a restriction to mods that the port's own
  storage does not require, and the port adds nothing.
- **`finish_parse_randart`.** There is no `randart.txt` in the content pack; the
  port generates randarts in code (`obj/randart.ts`), so upstream's parser for
  them has nothing here to be faithful to.

**What `mon-init.c`'s eight turned up.** One was missing and is now ported:
**`finish_parse_lore`'s base-flag union**, which makes a monster's base flags
known before the player has ever met it. Five of the rest have no port subject,
and the reason is the same each time: the port resolves by NAME where the C
resolves by index, so the array-building those hooks exist to do has nothing to
correspond to: `meth` and `eff` (blow methods and effects are `Map`s keyed by
name and are never indexed or iterated for a pick), `mon_spell` and `mon_base`
(both hooks only publish the parser's list), and `monster`'s `mon_blows_max`
padding (the port's blow arrays are exactly as long as the race's blows, so
there are no empty slots to pad or to zero). Two were already reproduced:
`pain` (a `Map` keyed by `pain_idx`, so upstream's gaps survive by
construction) and `pit` (file-order indices).

### `flavor.txt` records that interleave `fixed:` and `flavor:`

The compiled record splits the two directives into separate arrays, so the
file's true line order is not recoverable from the compiled shape, and the entry
`index` cannot stand in for it, because flavor.txt's own numbering is not the
order it writes the lines in. Nothing shipped interleaves them, and the binder
now reproduces the shipped order exactly, so this is latent rather than live. It
would become live the moment a mod interleaved them. Fixing it properly means the
content compiler emitting one ordered list per record.

## Mod resilience

The contract is in `docs/modding/MOD_COMPATIBILITY.md`, and its four gates are
what any of this has to satisfy. One area is known to be short of it.

### Bind-time resilience: the rest of the binders

Three are done. Store records are complete: every field a patch can reach
(`normal`, `always`, `buy`, and the `store:` entrance) refuses a mod's
unresolvable entry and attributes it; the ego `item:` list does the same; and an
artifact's `base-object` now drops the whole record rather than the field, which
is the first case where the record was the right unit. The shared decision lives
in `packages/core/src/mod/refusal.ts`, so a fourth binder is a small job rather
than a repeat of the reasoning.

**What is missing is the denominator.** No systematic pass has been made over
the remaining binders to find every field that resolves a NAME from a list a mod
can append to, which is the shape that makes this reachable. Three are named and
unfixed: an artifact's `flags`, `values` and `act` tokens still throw on a mod's
typo, where `base-object` no longer does, and each needs its loop turned into
something that can report instead of throw inside a parity-sensitive binder.
`curse` `type` is untouched, and the monster, trap and feature binders have never
been looked at for this at all. The first piece of work is still the census.

Two known cases that the composer deliberately leaves to the binders:

- **A record a mod OWNS whose required container field is absent.** The composer
  will not put back a field a patch removed, because dropping fields is how a
  total conversion works, so a `replaces` body that omits a required list is
  still fatal where it is read. A binder refusing a record whose owner is a mod
  is the answer, and it is the same work as the census above.
- **A malformed field OP throws out of the composer.** `applyFieldPatch` assumes
  well-formed ops: an `append` written with `value` instead of `values` reaches
  `op.values is not iterable`, and the exception leaves `composeContentPacks`
  entirely, so it is attributed to nothing and there is no partial result.
  Measured 2026-08-20 while writing the shape tests, by mistyping the op.
  `composeDroppingBroken` exists and may already be the intended answer for the
  host's load path; what is missing is knowing whether the game's own path uses
  it.

## Attribution

When a mod causes something, the game should say so; otherwise the reader blames
core for behaviour a mod produced. The character dump's `[Mods enabled]` block is
fixed. **The other surfaces have never been enumerated**, which is why there is
no fraction here: save provenance, log lines, and the conflict pane are the three
that are known to exist, and the first task is to find out whether that is the
whole list.

## Alpha gate

Renegotiated 2026-08-15: the moddability gate is otherwise met, and what remains
is:

- **Gap 21, UI moddability.** The world is a separate seam (gap 9) and is done;
  everything else a mod might want to change about the interface is this.
- **Catch-up mod content**, so the first-party mods cover what the gate assumes
  they cover.
- **The alpha cut itself**, on a tag the in-game updater can see. A draft release
  cannot be a channel: `gh release view` 404s on a draft and so does the
  updater.
