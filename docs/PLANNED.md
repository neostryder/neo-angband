# Planned, not yet implemented

**This file is the only place in the repository where work that has NOT landed is
written down.** `CHANGELOG.md` records what shipped and nothing else — an entry
appears there when the code is in the tree, never before. The two are easy to
blur, and blurring them is expensive in a public repository: a changelog that
describes intentions reads, to somebody who did not write it, exactly like a
changelog that describes features. They then look for the feature.

So the rule is one sentence. **If it works, it goes in the changelog. If it is
going to work, it goes here.**

What this file is *not*: it is not the plan. `docs/PORT_PLAN.md` holds the
ratified decisions and the shape of the project, and it outranks this file
wherever they touch. This is a worklist — the things known to be missing, with
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

Upstream runs a finish hook after parsing many of its data files — a second pass
that orders, validates, back-fills or reverses what the parser built. The port
folds parse and finish together in a registry constructor, which means **a parity
test mirroring upstream's parser tests is structurally blind to the finish
hook**: it can pass in full while the finish pass is simply absent. Four have
been found missing that way and are now ported (`finish_parse_feat`'s
prefix/preposition space, store `shopnum`/`store_max` ordering, critical-level
validation, hints order).

**14 of ~45 hooks in the reference tree have been audited.** What is left, by
file:

| Where | Hooks | Note |
| --- | --- | --- |
| `obj-init.c` | 11 | the largest group, and the one closest to visible behaviour |
| `mon-init.c` | 8 | independent of the object side; safe to run in parallel with it |
| `generate.c` | 3 | level generation; a divergence here moves the RNG stream |
| singletons | 9 | one hook each, spread across the remaining files |

The audit method that found the four: read the upstream `finish_parse_*` body,
find the port's equivalent constructor, and ask what the hook does that the
constructor does not. A hook that has no port subject (because nothing binds
that file) is a finished answer and should be recorded as one.

### `flavor.txt` records that interleave `fixed:` and `flavor:`

The compiled record splits the two directives into separate arrays, so the
file's true line order is not recoverable from the compiled shape — and the entry
`index` cannot stand in for it, because flavor.txt's own numbering is not the
order it writes the lines in. Nothing shipped interleaves them, and the binder
now reproduces the shipped order exactly, so this is latent rather than live. It
would become live the moment a mod interleaved them. Fixing it properly means the
content compiler emitting one ordered list per record.

## Mod resilience

The contract is in `docs/modding/MOD_COMPATIBILITY.md`, and its four gates are
what any of this has to satisfy. Two areas are known to be short of it.

### Bind-time resilience beyond stores

Store records are now complete: every field a patch can reach — `normal`,
`always`, `buy`, and the `store:` entrance — refuses a mod's unresolvable entry
and attributes it, while core's own bad data still throws. **No other binder has
been audited at all**, so there is no honest denominator here yet; the first
piece of work is to produce one. `obj/bind.ts`'s ego `sval` resolution is the
known next case.

### Record SHAPE is never validated

`composeContentPacks` applies a mod's field patches and validates the *manifest*,
but nothing validates the resulting *record* against its `FileSpec`. A patch that
replaces a list-valued field with a scalar therefore produces a record every
binder accepts syntactically and then crashes on. The composer is the one place
that sees every patched record before anything binds it, and
`packages/content/src/specs/*.ts` already describes each directive's field types,
so this belongs there rather than in 40-odd binders.

## Attribution

When a mod causes something, the game should say so — otherwise the reader blames
core for behaviour a mod produced. The character dump's `[Mods enabled]` block is
fixed. **The other surfaces have never been enumerated**, which is why there is
no fraction here: save provenance, log lines, and the conflict pane are the three
that are known to exist, and the first task is to find out whether that is the
whole list.

## Alpha gate

Renegotiated 2026-08-15: the moddability gate is otherwise met, and what remains
is:

- **Gap 21 — UI moddability.** The world is a separate seam (gap 9) and is done;
  everything else a mod might want to change about the interface is this.
- **Catch-up mod content**, so the first-party mods cover what the gate assumes
  they cover.
- **The alpha cut itself**, on a tag the in-game updater can see. A draft release
  cannot be a channel — `gh release view` 404s on a draft and so does the
  updater.
