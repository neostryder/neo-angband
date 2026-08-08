# Where this port is deliberately not Angband 4.2.6

Written 2026-08-07, the day [PORT_TODO.md](PORT_TODO.md) closed the last of the 68
gaps it had written down — and, later the same day, re-ran the census and reopened
two. So the honest version of that milestone is *every gap this project found and
wrote down is closed except two, which are named in PORT_TODO.md*. This file is the
other half of the sentence: the things that are different **on purpose** and are not
going to be closed, each with the reason.

It is derived from the ledger census — `parity/reports/deferral-census.tsv`, the
**32 rows adjudicated `divergence`** and the **52 adjudicated `n-a`** — plus the
divergences stated in the ledger files themselves. Everything below is a real,
checkable claim about the code, not a category someone invented afterwards.

**The organising question is "could this have been a transliteration?"**, because
that is the question actually being asked, and the honest answer is not the same for
every row. Three classes:

- **A** — the C construct has no counterpart. A transliteration is not merely hard,
  there is nothing to write.
- **B** — a counterpart exists but writing it would produce something worse, and the
  reason is external to the port (a browser, a garbage collector, a canvas).
- **C** — **a decision.** A faithful transliteration was possible and something else
  was chosen. These are the ones worth arguing about, and they are marked so they can
  be.

---

## C1. The knowledge twin: `obj->known` is synthesised, not stored

**22 of the 32 `divergence` rows are this one thing.** It is by far the largest
divergence in the port and the only one that touches gameplay-visible values.

**Upstream.** Every `struct object` carries a second object, `obj->known`, allocated
beside it. It holds what the player knows: the flags they have learned, the modifiers
they have seen, the curses they have identified. Code writes to it (`object_copy` on
pickup, a field set when a rune is learned) and later reads from it, and `object_desc`
takes `obj->known` as the thing to describe.

**Here.** There is no stored twin. `obj/known-object.ts` `objectKnownShadow(obj, p,
env, deps)` **derives** the twin on demand from the real object intersected with the
player's rune knowledge (`p->obj_k`), and every read site that upstream points at
`obj->known` points at the shadow instead.

**Class C — a decision, and the cost is nameable.** A stored twin was portable. What
it bought to leave it out: knowledge cannot drift out of step with the object (there
is no second copy to forget to update), and a save carries no duplicate object graph.
What it costs: any upstream sequence that **writes** `obj->known` and later reads back
something the shadow cannot re-derive would differ. The census rows are the audit of
exactly that — each one names a write site and says what re-derives it (e.g.
`game/gear.ts`: `objKnown.toA` is set at birth by `player_outfit`, so the shadow at
`known-object.ts:446` yields the true `toA` and the twin write has no observable
consumer). No row found a write whose value could not be re-derived. That is an
argument, not a proof, and it is the single most valuable thing for a future reviewer
to attack.

## Closed: `add_brand` matched element names from a local table

A second `C` row stood here. `add_brand` compared a brand's name against a local
`ELEMENT_PROJ_NAMES` table mirroring `projection.txt`, because `ObjRegistry` is bound
from the object domain of the content pack and carried no projections. The mirror was
guarded by a test that re-derived the list from `reference/lib/gamedata/projection.txt`
— which proved it matched 4.2.6 and nothing else. The cost that guard could not touch
was named in the row itself: **a mod that renames an element would diverge at
runtime**, upstream ceasing to match while this port carried on matching.

**Closed 2026-08-07.** The bound projection table now hangs off `ObjRegistry`
(`obj/bind.ts`, attached by `bindCore`), `add_brand` compares against
`projections[i].name` as obj-randart.c:1951 does, and the mirror and its test are
deleted. A registry built without projections **throws** from randart rather than
substituting a list, because a substitute is an unchecked claim about
`projection.txt`. The check is now the mod rather than the reference: `randart.test.ts`
renames the four base elements and asserts the generated set changes, which an
implementation reading a mirror cannot do.

## Retired: "a randart set is not pinned by name"

A third `C` row stood here claiming the port persists a character's artifact history by
raw `aIdx` where upstream persists it by NAME and re-resolves through
`lookup_artifact_name` (save.c:1063 / load.c:1748). **The claim was already false when
it was written.** `SavedHistoryInfo` carries `artifactName: string`
(`session/save.ts:628`), serialisation writes `ids.artifactName(e.aIdx)` (`:682`), and
load resolves it back through `objReg.artifacts.find(a => a?.name === artifactName)`
and `continue`s when it fails (`:790-809`) — which is load.c:1748-1755 line for line.
The numeric `aIdx` survives only as an optional legacy field a migration reads.

It is recorded here rather than deleted because a divergence row is a standing claim
about the code, and a claim that quietly disappears takes with it the chance to notice
it was wrong. This one was wrong; the mechanism it named exists and matches upstream.

---

## B1. There is no redraw pipeline, because nothing needs one

Upstream keeps dirty-flag bitmasks — `PU_BONUS`, `PR_HEALTH`, `PR_MONLIST`,
`square_light_spot` — so a terminal can repaint only what changed. Roughly a dozen
`n-a` rows are a `PR_*` or `PU_*` bit with no port equivalent.

**Class B.** The front end recomputes and repaints unconditionally after every
state-changing action; on a canvas that is cheaper than tracking what moved. Porting
the flags would mean building a cache invalidation scheme for a renderer that has no
cache. Note that the *derived-value* half (`update_stuff` and friends) is a separate
matter and is tracked in the ledger as its own item — this entry is about the REDRAW
bits only.

## B2. Manual memory management has nothing to port to

`dice_free`, `expression_free`, `object_delete`, `mem_free`. **Class A/B**: the
runtime is garbage collected. `parity/ledger/dice.yaml` and `expression.yaml` state
this as ratified N/A rather than deferral, because a deferral implies future work.

## B3. Debug-build twins collapse into one function

`flag_has_dbg` / `flag_on_dbg` are the C's assert-wrapped variants of `flag_has` /
`flag_on`, compiled out of a release build. The port's `FlagSet` asserts
**unconditionally** (`assertValidFlag`), so the debug twin has nothing left to add.
**Class A.**

## B4. There is no process to kill

`exit(1)` when `randart.log` cannot be opened (obj-randart.c L3164-L3171), and
`quit()` generally. **Class B**, and stated at the site: a browser tab has no process,
and a desktop player did not ask to lose a character over a log file. The message goes
to the caller and generation continues. Upstream's own two messages are still emitted,
so nothing is silently swallowed. Process lifetime belongs to the shell
(`parity/ledger/wizard-debug.yaml`).

## B5. The object registry is a pile map, not an index array

Upstream keeps `cave->objects[]` and threads an `oidx` through `list_object` /
`delist_object`. **Here**, `state.floor` is a pile map keyed by grid, and the
monster↔object mimicry link is `obj.mimickingMIdx === mon.midx`, which `become_aware`
reads and the save persists.

**Class B, ratified** (`game/floor.ts:19-21`). The port did not omit the registry, it
replaced it; nothing observable depends on an `oidx`. Two census rows were
re-adjudicated from `real` to `divergence` when that was established.

## B6. The RNG is seeded by the host, and display animation never touches it

Upstream's `Rand_init` seeds from time and pid. **Here** the host seeds from
`crypto`/`Math.random` and **stores the seed in the save**, which is what makes a run
reproducible at all (`parity/ledger/rng.yaml`).

Separately, `RF_ATTR_MULTI` shimmer uses `randint1(BASIC_COLORS-1)` upstream, pulling
the game RNG from `do_animation`. Here the web layer binds that seam to a
**display-only** `Math.random` helper, so idle shimmer cannot perturb the deterministic
stream. **Class B and deliberate**: upstream's animation runs inside a game loop that
this port does not have, and a shimmering monster advancing the RNG would make a
replay depend on how long you looked at the screen.

## Closed: preview builders drew from a throwaway stream

A `B` row stood here. `make_fake_artifact` rolls a curse timeout through
`copy_curses`, and that roll draws; the knowledge browser passed a fresh `Rng` at a
fixed seed instead of the game stream, so browsing could not perturb a run and an
artifact previewed identically every time. Both of those are nicer than Angband and
neither is Angband — `desc_art_fake` (ui-knowledge.c:1629) hands
`make_fake_artifact` no stream of its own, so browsing an artifact **does** advance
upstream's RNG.

**Closed 2026-08-07.** Every caller of `makeFakeArtifact` now passes the game stream,
and `FAKE_ARTIFACT_SEED` is deleted. The `rng` parameter stays required with no
default even though the answer is now uniform, because a default is how the browser
acquired a private stream in the first place. Measured before changing it: the recall
fires once per explicit selection (`runGroupedBrowser` resolves only when a member is
chosen), matching upstream's `if (recall)` gate at ui-knowledge.c:1129 — an
immediate-mode renderer calling it per repaint would have made the game stream far
worse than the private one.

Two neighbours went with it. The wizard item browser was calling `makeFakeArtifact`
where upstream calls `get_art_name` (ui-wizard.c:154) — a **different function** that
does `object_prep(RANDOMISE)` with no `copy_artifact_data`, so it draws the base
item's plusses and never rolls a curse. It is now ported rather than substituted. And
the spoiler generator drew from its own `SPOIL_PREP_SEED`; it boots a headless game at
a fixed seed, so it now draws from that game's stream, which is the direct analogue of
upstream's spoiler running inside a live game.

`artifact_power` during randart generation was the third caller and the one that bit:
it must draw from the game stream because `design_artifact` re-powers artifacts
`make_bad` has just cursed, and until 2026-08-07 it did not, which meant the port's
randart sets were not Angband's.

## B8. Dead upstream branches are not ported

`mapview.ts` carries a note about rounding branches that are unreachable in the C.
**Class B**, and it is stated policy rather than an oversight: not porting dead code
is a documented decision, and the cordon is recorded so a future upstream bump that
makes a branch live can find it.

---

## Platform: the three things a browser changes

These are not in the census because they are not code-level notes, and they are the
ones a player is most likely to notice.

### P1. A save is not a file

On the web a save is a record in IndexedDB. **On the desktop build too** — the
Electron app is the same web build, so a player's saves are not files in a folder they
can copy, and the storage a browser gives can be cleared by the player's own cleanup
tools. This is the largest practical difference between playing this and playing
Angband, and it drives the import/export gate.

### P2. A mod is fetched, not compiled in

Upstream has no mods. This port's model — a curated list naming REPOSITORIES, each mod
discovered from its own repository at a tag, replacement gated on ORIGIN — is
additive, but the thing worth stating is that the game **downloads code**, and the
gate on that is trust on first use rather than a signature. See
`packages/web/src/mod-registry.ts`, which documents the check that was given up and
why.

### P3. The front end is a reimplementation

Core is the port. The UI reproduces upstream's layouts, keys and messages, but it is
original code against a canvas rather than a port of `ui-*.c` against curses. So
"faithful" there is a claim about what the player sees, checked by eye and by targeted
tests, not by a function-for-function census. **Desktop is the parity bar**; the web
build is reduced by what a browser can do.

---

## What this list is not

It is not a list of every difference — it is a list of every difference **anyone wrote
down**, which is the same limit [PORT_TODO.md](PORT_TODO.md)'s closing section names.
A subsystem ported cleanly and never annotated appears nowhere in the census whether it
is faithful or not.

The check that would catch what this misses is not a bigger document; it is
`docs/PARITY.md`'s measurement, and its limits are stated there.
