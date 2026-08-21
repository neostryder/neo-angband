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

Last reviewed: 2026-08-21.

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

### The `^` prefix as a second route to a control command

`commands.txt` offers a fallback for a host that swallows control-plus-key: press
and release `^`, then the letter. It resolves through upstream's keymap layer, so
`^` plus `x` is `^x` wherever a control key is read. This port has no such route
- the control branch of `main.ts`'s keydown handler requires `ev.ctrlKey` - so
the command summary drops that sentence rather than describing a keystroke that
does nothing.

It is the one row on that page whose absence a player is likely to hit, because a
browser tab is exactly the host the sentence was written for: `Ctrl-W` closes the
tab before any page script sees it, and no amount of `preventDefault` changes
that. Closing it means the keydown handler accepting a bare `^` as a pending
prefix and folding the next letter into a control key, ahead of both keysets'
command tables.

### The roguelike keyset's `^` plus direction alter keys

`r_comm.txt` maps `^b ^h ^j ^k ^l ^n ^u ^y` to alter-direction, which is how a
roguelike-keyset player tunnels, opens and disarms without leaving the movement
letters. The control branch handles that keyset's `^t`, `^d` and `^v` and stops
there, so those eight are unbound and the command summary says so above its
table. `alterCmd` already exists and takes a direction; what is missing is the
eight-way dispatch in the control branch.

### The birth screen's help is always the original keyset

`do_cmd_help` picks its index file from `rogue_like_commands`, and during birth
upstream reads it off the player it is building. This port's birth screen carries
only the `birth_*` options, so `?` there shows the original-keyset summary whoever
is reading it. Closing it means the interface-option defaults
(`customized_interface_options.txt`, already read by `customPageDefaults`)
reaching `openBirthHelp`.

### The targeting banner's remaining clauses

`target_display_help` builds its sentence from what the loop is offering, and two
clauses are never reached here: `g` moves to the selection (pathfinding, which
`runTargetLoop` takes as an argument and ignores) and the ignore key ignores the
selected object. Upstream omits each in exactly the case this port is always in,
so the banner is not saying anything false; the clauses arrive with the commands.
Its `<click>` half is also absent, because taps are gated off while a modal owns
input.

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

## The tile seams

### Two mods answering for the player's cell is unreported

`registry:tiles` grew a player-tile door in the Unreleased line: a provider asked
once per frame the player is drawn, first non-null answer in load order winning.
That is the first tile seam where a CONTEST between two mods is possible.
`mod-conflicts.ts` reports contested slots - two mods wanting the same menu, the
same HUD region, the same grafID - and it has no row for this one, so two mods
that both answer for the same character both had an opinion and load order
silently picks. The fill door deliberately has no conflict row either, and there
the reason is that a contest cannot happen (a fill only writes a blank, first
asker wins, neither can undo the other); here it can. `tile-registry.ts` says the
same thing in its own header.

What keeps it small is that a provider is expected to answer null for everything
it has no opinion about, so an overlap needs both mods to care about the same
character in the same moment. What would close it is a row naming both mods and
which one is being drawn.

### The seam docs did not describe either new tile capability - PLUGINS.md and LINOLEUM.md done

`TileFill.transform` and `TilesFacade.player` are in the tree, tested, and
consumed by neo-linoleum 0.16.0. `docs/modding/PLUGINS.md` now has a
"Repainting a tile, and drawing the player's own cell" subsection (with the
registry:tiles table row pointing at it), and `docs/LINOLEUM.md` names the new
`transformed` slot kind alongside `derived` and corrects a stale reference to
the renamed `derivedSlots` allocator.

`docs/modding/MOD_SEAMS.md` and `docs/modding/MOD_REACH.md` deliberately were
not touched. Neither one already covers `registry:tiles` at all (that seam's
home has always been PLUGINS.md's registries walkthrough) - MOD_SEAMS.md picks
a handful of seams for a deeper property-by-property treatment where the
seam's semantics are non-obvious (see its new section 4a on `simulateLoadout`,
for comparison), and a tile-drawing lookup does not need that kind of writeup;
MOD_REACH.md's rows measure what a mod cannot YET reach, and this capability
already being reachable is not that kind of fact. Revisit if a future mod
author's confusion says otherwise - the test is "somebody writing a mod looked
and could not find it," not a rule that every capability needs a row in every
seam-enumerating file.

### No pixel has been seen through the transform

`remapToRamp` is measured byte for byte and the slot allocation is measured
through the real door, but nothing has photographed a mirrored, repainted tile on
screen. The transform is the one part of this that leaves the pure-arithmetic
world: it reads the image back with `getImageData`, which needs the image to be
readable. Every path a pack arrives by is same-origin (the site, or a `blob:` URL
this document minted), so it should never taint - and "should" is the word doing
the work. A taint throws, the transform returns null, and the caller draws the
donor's own picture, so the failure is silent by design. The instrument is the
installed desktop build over CDP, which is the only one of the three that reports
pixels.

## Moddability reach

This was the "alpha gate", narrowed 2026-08-15. Renamed on 2026-08-21 because
the gate has been passed: `0.20.0` shipped as the initial public alpha on
2026-08-16, so **the alpha cut itself has left this file by landing** and the job
since then is each next minor or patch rather than reaching a cut. What was filed
under that heading and is still genuinely open is the moddability work the cut was
waiting on:

- **Gap 21, UI moddability.** The world is a separate seam (gap 9) and is done;
  everything else a mod might want to change about the interface is this.
- **Catch-up mod content**, so the first-party mods cover what the gate assumed
  they cover.

### The input door does not know about IME composition

Found 2026-08-21 while giving mod panels a keyboard, and it is older than that
work and independent of it. `browserKeydown` (`packages/web/src/input-door.ts`)
reads no `isComposing`, so while an input method is composing a character every
intermediate keystroke is dispatched to whatever screen owns the keyboard and
read as a game command. Nothing in the tree checks `isComposing` or the legacy
`keyCode === 229` that stands in for it; a grep for either returns zero.

It has been harmless so far for a reason that is about to stop being true: there
was nothing on this page to compose INTO, every screen being a character grid the
game types into itself. A mod panel is the first real text field this game has
had, and inside a panel the composition is already safe, because the door stands
down for the panel's own keystrokes and the escape hatch declines a composing
Escape. What is still exposed is the game's OWN prompts - `getString` and its
callers - where a player composing a character name in Japanese is also issuing
commands. Closing it is one guard at the same choke point, and the reason it is
not in that commit is that it changes what every existing screen receives, which
wants its own measurement rather than riding along with a new seam.

### A mod panel has never been driven on a phone or in Electron fullscreen

`ui:panel.mount` (2026-08-21) was measured where it could be: its ownership,
invariant and escape-hatch logic have unit tests, and the three browser semantics
it rests on were probed in the shipping desktop build over CDP and are recorded
in `panel-runtime.ts`. Two environments were not measured, because measuring them
needs a mod that mounts a panel and the first one is still being written.

A virtual keyboard resizes the visual viewport, which resizes the canvas, which
repaints the whole game frame - so typing in a panel on a phone may stutter, and
a field near the bottom of a `position: fixed; inset: 0` container may sit under
the keyboard where the player cannot see what they are typing. The host sets
`touch-action: manipulation` and draws its close control inside the safe-area
insets; everything about where a panel puts its own fields is the mod's, and the
guidance in `MOD_SEAMS.md` section 4b does not currently say to use
`visualViewport`. Electron fullscreen is the other one: fixed-position overlays
over a canvas that is itself using the Fullscreen API have behaved
inconsistently across Electron versions, and this shell's own fullscreen events
already fire before `isFullScreen()` flips.

### A player-visible speed control for a mod's autoplayer

`ModPlugin.controller`'s pump (added 2026-08-21, see `CHANGELOG.md`) ticks on a
plain constant, `MOD_AUTOPLAYER_TICK_MS`. The debug agent seam (`?agent=`)
already has a `?speed=fast|normal|slow` URL param for the same pump shape; the
mod-controller path has no equivalent, and watching an autoplayer is the whole
point of having one. A real control belongs in the UI - plausibly beside "Let
the Borg play" in the mod's own rule row - rather than a URL param, since that
row is what a player actually sees.

Also unmeasured: unattended-long-run resource behaviour. The pump has no tick
cap on purpose (the debug seams cap ticks only as a manual-test safety valve,
and a "let it play" mod is supposed to keep going), but nothing has watched
what an hours-long run does to memory or performance.
