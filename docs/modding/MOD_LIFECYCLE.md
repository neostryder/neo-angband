# Mod Lifecycle, Saves, and Composition

> STATUS: RATIFIED 2026-07-08 (PORT_PLAN.md decision 19). The maintainer confirmed
> decisions 1, 2, 3, 5, and 6 as written, and 4 (the determinism guard)
> with the change recorded in section 4 below: it is a warning and label,
> not a bar. The maintainer also added the uninstall-recovery behaviors in the new
> section "When a mod's content leaves the game". This page is the design
> of record; it is not yet fully built. [OPEN] items still need a decision.

This page answers four questions that decide whether a mod system is
pleasant or painful:

1. How is mod content kept out of the way so installing, updating, and
   uninstalling mods does not break your save?
2. How do you install a mod - from a git repo today, from a marketplace
   later - without friction?
3. How do several mods run together without corrupting each other?
4. What makes the whole thing ergonomic instead of the usual mod-manager
   headache?

It builds on the vocabulary already in `README.md` (packs, `pack.json`,
namespaced ids, `patches`/`replaces`/`removes`, provenance) and the
ratified pillars in `../MODS.md`.

---

## 1. Saves that survive mod changes

The single most important rule, from which almost everything else
follows:

> [PROPOSED] Saves reference content by stable namespaced string id,
> never by numeric index.

Upstream Angband serializes a monster as its `r_idx` and an item as its
`k_idx` - array positions. Add or remove one record and every later
index shifts, silently corrupting old saves. That fragility is exactly
what breaks modded saves elsewhere. We serialize `core:kobold`,
`frost:frost-wyrm`, `mypack:quest-of-the-lost-ring` and resolve the
string to a runtime index at load time. Adding, removing, or reordering
content never moves an existing id.

### The save is block-structured and namespaced

The savefile is already block-based (a faithful port of `savefile.c`:
magic, then framed blocks). We extend it into three tiers:

- A `manifest` block: the exact mod set that produced this save - each
  pack's `id`, `version`, content hash, and source (git URL + ref, or
  marketplace id), plus the resolved load order. This is the save's
  "profile fingerprint".
- Core blocks (player, dungeon, messages, RNG state, ...): the base
  game state. All cross-references inside use namespaced string ids.
- One block per mod, keyed `mod:<id>`: that mod's own private state - an
  opaque bag the engine never interprets, versioned by the mod's
  `saveSchema` number. A scripted plugin persists whatever it likes here
  and is the only thing that reads it back.

Every persisted entity that came from a mod records the id of its
definition. A `frost:frost-wyrm` standing on the level is stored as a
normal monster instance whose "race" reference is the string
`frost:frost-wyrm`. The instance data is core-shaped; only the reference
is mod-owned.

### What happens when the mod set changes under a save

Because each mod owns exactly its own namespace, the blast radius of any
change is that namespace:

- Mod ADDED since the save: its namespace was empty in the save; it
  simply starts contributing. No migration.
- Mod UPDATED (version changed): the engine hands the mod its own old
  `mod:<id>` bag and asks it to migrate from its old `saveSchema` to the
  new one. Declarative content usually needs nothing (ids are stable);
  scripted mods ship a migration function that touches only their bag.
  Core never participates.
- Mod REMOVED (uninstalled): entities that reference the missing mod are
  [PROPOSED] quarantined, not deleted. They move into an
  `orphans:<id>@<version>` store inside the save - frozen, inert,
  removed from active play, but preserved. Reinstall the mod (same major
  version) and they rehydrate exactly where they were. This is the
  clean-uninstall guarantee: uninstalling removes a mod's active content
  without ever corrupting the save.

[DECIDED 2026-07-14, decision 8] Orphan policy: option (a) - on the first
load after content is orphaned, surface a one-time per-save prompt offering
"keep frozen" (default) vs "purge N orphaned items permanently". Quarantine
stays the default and nothing is destroyed without an explicit, counted,
one-time confirmation. Rejected (b) (auto-purge trivial cosmetic orphans):
"trivial" and "cosmetic" are not reliably decidable by the engine, and silent
deletion - even of cosmetics - violates the "nothing a player earned vanishes
without a trace" guarantee. The prompt is per-save and one-time so it never
nags; declining leaves everything quarantined and reversible.

### When a mod's content leaves the game (RATIFIED, decision 19)

Quarantine is the storage mechanism; these are the player-facing
recoveries built on top of it, so uninstalling a mod never strands or
silently destroys a character. They also fire when content is not
uninstalled but SHADOWED - a later mod in the load order `removes` or
`replaces` a record the save depends on.

- Stranded location. If the character is standing on a level, in a room,
  or in a whole region that a now-missing mod generated, the load cannot
  place them there. They are returned safely to the TOWN (the canonical
  always-present safe location, itself core parity content), with a
  message explaining why. The dungeon regenerates from the surviving
  content as normal on the next descent; no half-loaded mod geometry is
  ever walked.
- Stranded items. Items whose definition came from the missing mod are
  not dropped and not deleted. They are moved into the player's HOME
  (the game's existing persistent stash) as inert entries - visible,
  labelled with their origin mod, but not equippable, usable, or
  sellable while the mod is absent. Reinstalling the mod (same major
  version) reactivates them in place. This uses the same
  `orphans:<id>@<version>` store; the home is just where the player sees
  and reclaims them.
- The stash view. A dedicated, always-reachable screen lists everything
  currently quarantined - by uninstall OR by another mod's override -
  grouped by the mod that owns it, showing what it is, why it is inert
  ("frost uninstalled" / "shadowed by bigmonsters"), and what would
  restore it ("reinstall frost >=1.0" / "move bigmonsters below frost").
  Nothing a player earned ever vanishes without a trace they can find.

These recoveries are graceful degradation, not gameplay rollback: they
preserve what the player has against a tooling change, and do not let the
player undo an in-game outcome, so they sit cleanly beside the
no-save-scum rule.

### Compatibility gating

A save refuses to load only when it genuinely cannot: an incompatible
engine version, or a missing REQUIRED dependency of an enabled mod. In
those cases the app says exactly what is missing and offers the fix
("install core >=0.6.0" / "reinstall frost@1.x"), rather than failing
with a stack trace. Everything softer than that (a removed optional mod,
a cosmetic pack gone) degrades gracefully via quarantine.

---

## 2. Installing mods

### The manifest carries everything the installer needs

`pack.json` (see README for the base fields) gains lifecycle fields:

```json
{
  "id": "frost",
  "version": "1.2.0",
  "engine": ">=0.5.0 <0.7.0",
  "shape": "content",
  "dependencies": { "core": ">=0.5.0", "runes": "^2.0.0" },
  "optionalDependencies": { "biglevels": "*" },
  "loadAfter": ["runes"],
  "loadBefore": [],
  "saveSchema": 3,
  "capabilities": ["command:add", "event:turn-start", "state:party.read"],
  "repository": "https://github.com/you/frost",
  "license": "CC-BY-4.0",
  "screenshots": ["media/1.png"],
  "changelog": "CHANGELOG.md"
}
```

The `capabilities` list applies only to `shape: plugin` mods and is the
consent surface (section 4). Content and tile packs request none.

### From a git repository (today)

The user pastes a repository URL (or picks a ref). The app:

1. Resolves a specific ref (tag preferred, else branch head, else
   commit) and pins it - installs are reproducible, not "latest".
2. Fetches the tree at that ref and reads `pack.json`.
3. Validates: schema, `engine` compatibility, dependency availability
   and version ranges, and (for plugins) the capability list.
4. Shows a pre-install summary: what it adds, what it patches/replaces/
   removes (computed against the current load order), capabilities it
   requests in plain language, size, license, author, screenshots, and
   any conflicts with already-enabled mods.
5. On confirm, materializes the mod into local storage
   (content-addressed by hash), enables it, and inserts it into the load
   order at the dependency-correct position.

[PROPOSED] Browser reality, stated honestly: a web page cannot speak the
git protocol or clone arbitrary hosts (CORS, no git transport). "Install
from git" in the web build means fetching the repository tarball at a
ref through the host's HTTP API (GitHub/GitLab both expose CORS-friendly
archive and raw endpoints for public repos). Private or self-hosted
repos need a user-supplied token or a small optional proxy; this is
documented, not hidden. A desktop build (if one ships) can clone
directly. Either way the installer consumes the same pack format.

### From a marketplace (future release)

The marketplace is a delivery layer over the same pipeline, not a
separate system. It serves pre-validated, pre-packaged `.ngpack` bundles
(the pack directory, zipped, with the manifest and a signed content
hash) from our own host, and adds browse / search / screenshots /
ratings in-app. Building it later is cheap because we build the bundle
format and the installer now, with "git" and "marketplace" as two
sources feeding one installer. [PROPOSED] The in-app browser is a view
onto that source; actually building the marketplace backend is a future
release, as noted.

### Updating and uninstalling

- Update: the app compares the pinned ref (or marketplace version)
  against upstream, shows the changelog and any migration notes,
  re-checks conflicts and dependencies, then applies atomically. Before
  a migration runs it takes an internal pre-migration snapshot of the
  affected save (see the note under section 5 on why this is not
  save-scumming) and rolls back if the migration throws.
- Uninstall: disable, then optionally delete files. The app states the
  consequence up front ("3 characters use this mod; their in-world frost
  content will be quarantined and restored if you reinstall") so there
  is never a silent loss.

---

## 3. Running many mods together

### Load order and dependency resolution

Enabled mods form an ordered list. [PROPOSED] Later in the order wins on
genuine conflicts (last-write-wins, the convention players already know
from Bethesda games and similar mod ecosystems). The order is computed by:

1. Topological sort by `dependencies` and `loadAfter`/`loadBefore`
   (hard requirements first; cycles rejected at install).
2. User preference within the freedom that leaves.

Most mods never need manual ordering; the app only asks the user to
choose when two mods actually collide on the same field (below).

### Additive vs conflicting changes

- Additive (each mod adds new records): namespaced ids keep them
  distinct. Never a conflict. This is the overwhelming common case.
- Override (two mods both touch `core:kobold`): a real conflict only if
  they touch the SAME FIELD.

The existing composition model (`patches`, `replaces`, `removes`) is the
lever. [PROPOSED] We make `patches` field-granular and composable: a
patch is a set of field operations (`set`, `merge`, `addFlag`,
`removeFlag`, numeric `add`/`mul`), applied in load order. Two mods that
patch DIFFERENT fields of the same record compose cleanly with zero
conflict. Only same-field patches conflict, and then load order decides
and the app says so. This removes the biggest source of false conflicts
in coarse whole-record systems.

### The conflict report

Before a session starts, the app computes the merged content and shows a
conflict report: every record touched by more than one mod, which fields
each touched, and who wins. Same-field collisions are highlighted with a
one-line resolution ("frost and runes both set kobold.speed; frost wins
- drag to reorder"). Nothing is silent, nothing is a surprise at
runtime. A load order that fails validation (unmet dependency, engine
mismatch, cyclic requirement) cannot be launched, and the reason is
plain language, not an error code.

### External managers (Vortex, MO2)

[PROPOSED] The pack format is a plain directory / zip with a manifest, so
it is filesystem-friendly. A desktop build can watch a mod directory
that a Vortex or Mod Organizer 2 extension deploys into, giving power
users their preferred tool for free. But the in-app manager is
first-class and aims to be good enough that most players never need an
external one. Same format serves both; we do not fork.

---

## 4. Trust, safety, and determinism

Three trust tiers, unchanged from MODS.md, made concrete at install:

- Content packs (declarative JSON): validated data, cannot execute.
  Lowest bar, freely shareable.
- Tile packs: validated manifest plus images. Same posture.
- Scripted plugins: real code, run in a sandbox (a Web Worker with no
  ambient DOM, network, or storage) with explicit capability grants. At
  install the app lists the capabilities in plain language ("add
  commands", "read party state", "network access to api.example.com")
  and the mod gets nothing it did not request and the user did not
  approve.

Determinism guard (RATIFIED, decisions 19 and 22 - and deliberately
modest). First, what determinism is NOT here: it is NOT the anti-save-scum
mechanism. Anti-save-scum comes from the faithful port of the original's
persisted RNG state (the full `STATE[]`/`Rand_value` in the save, so a
reload resumes the exact stream and cannot reroll) plus single-save and
terminal death - see the save-scum policy. That protection rides on saved
state, not on the run being reproducible from a seed, so it composes with
mods.

What the guard IS: a convenience and an honest label. The SDK hands every
plugin a seeded RNG and, by default, the sandbox withholds the
nondeterministic sources (wall clock, `Math.random`, ambient network) so an
author who does nothing special stays deterministic - which keeps the
unmodded-style "shareable seed" reproducibility working when their mod is
pure. That reproducibility is a nice-to-have, not a guarantee the game
depends on.

Per decision 18, cheaty and nondeterministic mods are allowed and the
engine does not forbid. A mod that wants nondeterminism (a live-multiplayer
transport, a wall-clock event, an external AI agent) declares
`nondeterministic: true` in its manifest. The engine then grants the
capabilities it asks for and marks any profile containing it as
"not reproducible / not seed-shareable" - nothing is blocked; the player is
just told what they are trading away. Note two honest consequences, both
expected: (a) any add/remove/update of mods mid-run also breaks
reproducibility-from-seed, because the mod set is part of the seed's inputs;
(b) a nondeterministic mod re-opens reload-reroll WITHIN its own mechanics
(those outcomes are not pinned to saved state) - core mechanics stay
reroll-proof because they draw from the saved seeded stream. An undeclared
plugin that trips a withheld source gets a clear author-facing error
pointing at the fix, not a silent divergence.

Save determinism mode (core-governed ratchet). The label is not just cosmetic:
every save carries a determinism mode that CORE owns and enforces regardless
of which mods are loaded. A save starts DETERMINISTIC; the first time a
determinism-affecting mod is enabled on it, core flips it to NONDETERMINISTIC
seamlessly and IRREVERSIBLY. Removing the mod later does not restore
deterministic mode - it is a one-way ratchet, so a deterministic (unmodded)
save cannot be tainted by a mod and then "cleansed" to reclaim its
reproducibility/anti-scum guarantees. Mods can trigger the flip but can never
reverse or prevent it. This is why the save block records the exact mod set
and the mode: the mode travels with the save. See PORT_PLAN.md decision 22.

---

## 5. Ergonomics: designing out the usual complaints

The brief was a mod UX that avoids the pitfalls people complain about
elsewhere. Each known complaint, and the design answer:

- "A mod broke my save / I cannot uninstall safely."
  -> String-id references, per-mod save namespaces, per-mod migrations,
  and quarantine-on-uninstall. Uninstalling is reversible.
- "Load order is arcane (hand-sorting plugin files, external sorters)."
  -> Auto-sort by declared dependencies; manual ordering surfaces only
  for real same-field conflicts, with a plain explanation of what each
  choice does.
- "Silent conflicts, mystery crashes mid-game."
  -> A pre-launch conflict report and a validation gate. If it launches,
  it composed cleanly; if it will not, you are told why in plain words.
- "Dependency hell / missing masters."
  -> Dependency resolution with version ranges and a clear "this also
  needs runes >=2.0 - install it too?" step. Never launches with unmet
  requirements.
- "Where do I even get mods, and is this download safe?"
  -> In-app install from trusted git sources now, a browsable
  marketplace later, license and author shown before install,
  capabilities shown before enabling a script.
- "Updating breaks everything."
  -> Pinned refs, changelog and migration preview, atomic apply with an
  internal pre-migration snapshot and automatic rollback on failure.
- "I cannot tell what a mod actually changes."
  -> The computed diff view: records added, patched, replaced, removed,
  fields touched, and capabilities requested.

### Profiles (a feature players will expect once they have it)

[PROPOSED] A profile is a named, ordered mod set. A character/save is
bound to the profile that created it (that is what the manifest block
records). You can keep a vanilla character and a heavily modded one side
by side with no cross-contamination, and switch a character's profile
only through a guarded flow that runs the appropriate migrations or
quarantine. Profiles are shareable (export/import a small profile file:
ids, versions, sources, order) so a friend can one-click reproduce your
setup. Note the deliberate asymmetry with saves: profiles are meant to
be shared; savefiles are not casually exportable, because the engine's
determinism plus a shared seed plus a shared profile already reproduces
a playthrough, and freely exportable saves would undercut the
no-save-scum guarantee (see save-scum policy).

Why the pre-migration snapshot in section 2 is not save-scumming: it is
an operational safety net that only ever restores when a migration
throws, and it is not exposed as a "load an earlier save" command. It
protects against tool failure, not against the player's own bad luck.
The no-save-scum rule bars player-facing rollback of gameplay outcomes;
this is neither player-facing nor a gameplay rollback.

### Safe mode

[PROPOSED] If an enabled combination fails to boot, the app offers a
one-click "start with mods disabled" recovery so a bad mod can never
brick access to the app or to a save.

---

## 6. Build order (so this is real, not aspirational)

Seams and formats first (they are cheap now and expensive to retrofit),
UI next, marketplace last:

1. Now, as the save system and loader land: string-id serialization,
   the namespaced save blocks and per-mod bags, the field-level patch/
   merge composer, the load-order + dependency resolver, the capability
   model, and the conflict-report computation. These are engine seams.
1b. THE JOINING STEP (added 2026-07-14, see MOD_INTEGRATION_PLAN.md): the
   engine seams from item 1 must actually be wired into the running game -
   a loader that resolves + composes the pack set at boot, capability
   enforcement on the perceive/act facades, the agent controller installed
   in the host, and the turn loop routed through the event bus. A
   2026-07-14 audit found item 1's seams are built and tested but have no
   runtime caller; this is Wave 1 of the integration plan and it precedes
   the UI below.
2. Next: the in-app mod manager UI (list, enable/disable, reorder,
   install-from-url, conflict view, capability consent, profiles).
3. Future release: the marketplace backend and in-app browser, and an
   optional Vortex/MO2 extension over the shared on-disk format.

A `neo-pack` CLI (validate + bundle, a sibling of `neo-linoleum`) ships
alongside so authors can check a pack in CI before publishing, and the
repo carries sample mods that CI installs and runs.

---

## Decisions (ratified 2026-07-08, PORT_PLAN.md decision 19)

1. String-id (not index) serialization as the load-bearing rule. [DECIDED]
2. Quarantine (freeze + restore) as the default uninstall behavior, with
   a one-time keep/purge prompt for orphans. [DECIDED]
3. Last-in-load-order-wins with field-level patch composition. [DECIDED]
4. Determinism guard on state-affecting plugins - AS A WARNING AND LABEL
   WITH AN OPT-OUT, NOT A BAR (cheaty and nondeterministic mods are
   allowed; see section 4 and PORT_PLAN.md decision 18). [DECIDED, changed]
5. Profiles bound to saves, profiles shareable but saves not. [DECIDED]
6. Pre-migration snapshot as operational safety, reconciled with the
   no-save-scum rule. [DECIDED]
7. Uninstall recovery: stranded characters return to town, mod items are
   quarantined to the player's home and reactivate on reinstall, and a
   stash view surfaces everything quarantined or shadowed. [DECIDED]
8. Orphan policy: quarantine by default with a one-time per-save keep/purge
   prompt (keep default); no auto-purge. [DECIDED 2026-07-14]
