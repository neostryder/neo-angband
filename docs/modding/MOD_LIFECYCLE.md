# Mod Lifecycle, Saves, and Composition

> STATUS: RATIFIED 2026-07-08 (PORT_PLAN.md decision 19). Decisions 1, 2, 3, 5,
> and 6 are confirmed as written, and 4 (the determinism guard) stands with the
> change recorded in section 4 below: it is a warning and label, not a bar. The
> uninstall-recovery behaviors in the new section "When a mod's content leaves
> the game" are ratified alongside them. This page is the design of record; it
> is not yet fully built. [OPEN] items still need a decision.

This page answers four questions that decide whether a mod system is
pleasant or painful:

1. How is mod content kept out of the way so installing, updating, and
   uninstalling mods does not break your save?
2. How do you install a mod - from a git repo today, from a marketplace
   later - without friction?
3. How do several mods run together without corrupting each other?
4. What makes the whole thing ergonomic instead of the usual mod-manager
   headache?

It builds on the vocabulary already in `README.md` (packs, `manifest.json`,
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
what breaks modded saves elsewhere. This port serializes `core:kobold`,
`frost:frost-wyrm`, `mypack:quest-of-the-lost-ring` and resolves the
string to a runtime index at load time. Adding, removing, or reordering
content never moves an existing id.

### The save is block-structured and namespaced

The savefile is already block-based (a faithful port of `savefile.c`:
magic, then framed blocks). The port extends it into three tiers:

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

`manifest.json` (see README for the base fields) gains lifecycle fields:

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

The vocabulary is `command:add`, `event:<name>`, `state:<domain>.read`,
`network:<host>`, `registry:<domain>`, **`display:replace`** and
**`ui:<region>.replace`**. The last two are the screen, and they are two grants
rather than one. `display:replace` is what `ModPlugin.frontend` requires -
everything the player sees of the dungeon drawn by the mod. `ui:<region>.replace`
is what `ModPlugin.hud` requires, PER REGION - `ui:messages.replace`,
`ui:sidebar.replace`, `ui:status.replace`, or `ui:*.replace` for all three - so a
mod that redraws the vitals does not have to ask for the message line as well,
and a player consenting is told which part of their screen is changing hands.

Both stand outside `registry:` deliberately, and `registry:*` covers neither: an
override wildcard grants every named game system, which is not the same thing as
owning part of the screen. They do not cover each other either. There is no
`ui:map.replace`, because the dungeon is `display:replace`'s and one region
answering to two capabilities would be two answers to "who draws this".

The vocabulary has since grown `ui:region.create`, `ui:panel.mount`,
`backup:folder`, `debug:spawn`, `mod:install` and `mod:session`. See
`packages/mod-sdk/src/capabilities.ts`, whose own header is the reference list,
and [PLUGINS.md](PLUGINS.md) for what each one is and is not. Two things about the
family shape are worth reading here rather than there, because both are about how
a grant is PRICED rather than about what it opens. First, an action is compared as
well as a kind: `ui:*.replace` carries neither `region.create` nor `panel.mount`,
and `mod:install` does not carry `mod:session`, because in each pair neither side
is a superset. Second, a capability's consent sentence is what makes it
proportionate, so two grants whose sentences differ cannot share a string:
`mod:install` puts a pack in the library switched OFF and the player meets it
before any of it runs, and `mod:session` switches one on for the rest of the
session, which is more rather than less.

### A mod that lasts one session

There is a fourth way a mod arrives, alongside the shipped installer, a folder on
disk, and a zip the player imports: it can be staged for the current browsing
session only (`packages/web/src/mod-session.ts`). The archive is held in session
storage rather than IndexedDB, the pack composes on the next reload without
waiting to be enabled, and closing the game forgets it.

Everything in this section still applies to it. The manifest is validated, the
engine range is honoured, the standards inspection runs, the origin is pinned
against an installed copy of the same id, and the pack goes through the same
composer in the same load order - a staged copy of an installed id shadows it, and
the collision is reported. What is different is the lifetime of the ARCHIVE, and
nothing else: a session pack's records are as real as any while they are loaded,
and section 4's account of what a capability does and does not fence is unchanged
by how long the mod is remembered.

Two honest limits, both recorded because the phrase "just for this session" does
not carry them. The lifetime is a convention rather than a boundary - a browser
restoring a closed or crashed window restores session storage with it - so the
mitigation is that a session mod is always listed, always marked, and always
droppable. And a save written while one was loaded stays loadable but is not
reproducible: entities in the staged namespace are quarantined on the next load,
which is correct, while a field the pack PATCHED on a core record simply returns
to its unpatched value, because a patch lives in the composition and not in the
save. `docs/PLANNED.md` carries the second as open work.

### From a git repository (proposed design, not the shipped path)

[PROPOSED] throughout, and the heading used to read "(today)", which it was not.
The shipped installer reads `manifest.json` at a TAG and nothing else: no branch
head and no bare commit. What it actually does, including how it
picks which release to offer and what an install pins, is in
[MOD_COMPATIBILITY.md](MOD_COMPATIBILITY.md) and [../MODS.md](../MODS.md). The
design below is kept as the design of record for where the installer is going.

The user pastes a repository URL (or picks a ref). The app:

1. Resolves a specific ref (tag preferred, else branch head, else
   commit) and pins it - installs are reproducible, not "latest".
2. Fetches the tree at that ref and reads `manifest.json`.
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
documented, not hidden. The desktop build could clone directly, since it has a
real filesystem and a real process to run git in. Either way the installer
consumes the same pack format.

### From a marketplace (future release)

The marketplace is a delivery layer over the same pipeline, not a
separate system. It serves pre-validated, pre-packaged `.ngpack` bundles
(the pack directory, zipped, with the manifest and a signed content
hash) from its own host, and adds browse / search / screenshots /
ratings in-app. Building it later is cheap because the bundle
format and the installer are built now, with "git" and "marketplace" as two
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

Enabled mods form an ordered list, and **later in the order wins** on genuine
conflicts (last-write-wins, the convention players know from Bethesda games).
That rule is now true of every composition layer; until 2026-08-01 graphics
modes resolved FIRST-wins, so moving a tiles mod later made it lose while the
manager's own row promised the opposite (see "One winner rule" below).

There are two order-producing functions and the split between them is the
model in one line:

- `resolveLoadOrder` **enforces**. It takes the list the player chose and
  refuses an impossible one - a missing dependency, a hard cycle.
- `sortModOrder` **proposes**. It takes the same inputs plus everything anyone
  merely prefers, and answers with an order the player may accept or ignore.
  It cannot fail.

`sortModOrder` weighs four tiers, strongest first, and that ranking is the only
thing deciding which constraint is dropped when they contradict:

| Tier | Source | Why it ranks there |
|---|---|---|
| `hard` | `dependencies`, present `optionalDependencies` | Correctness - a pack cannot patch records that have not composed |
| `player` | what the player pinned by moving a mod | Their machine, their call |
| `author` | `loadAfter`/`loadBefore`, `prefer-mine`/`prefer-theirs` | A named guess about a named mod |
| `group` | membership in the shipped `group` order | Nobody wrote it about this pair |

**`loadAfter`/`loadBefore` used to be HARD edges**, which meant two mods each
claiming priority over the other produced `dependency cycle among packs` and the
whole set refused to launch - with neither author having done anything
unreasonable. They are `author`-tier now. On a cycle the sorter drops the
weakest edge and says which one and why; only an all-hard cycle is reported
unresolvable, and that is an impossible mod set rather than a disagreement.
This is the rule LOOT settled on: soft metadata that contradicts hard metadata
is ignored, not turned into an error neither author can fix.

**Groups** (`PACK_GROUPS`: framework, overhaul, content, gameplay, tweaks,
interface, cosmetic, late) let a mod sort correctly against mods that did not
exist when it was written. Pairwise hints require an author to have heard of the
other mod, which is why LOOT needs a hand-maintained masterlist and why groups
are the thing worth borrowing.

**Player pins survive re-sorting.** Moving a mod records the pair the player
reordered (not an absolute index, which stops meaning anything the moment
another mod is installed) and replays it as a `player`-tier edge. Without this,
an auto-sort silently undoes the placement the player just made, which teaches
them never to press it.

Determinism is a hard requirement, not a nicety: the resolved order goes into
the savefile's mod-set fingerprint, so the sort is a pure function of
(manifests, pins, current order) - no clock, no `Math.random`, and no reliance
on Set/Map iteration for anything that decides an outcome.

### What an author may and may not decide

> **An author has total authority over their own mod's contributions, and none
> over the player's order or anyone else's mod.**

Everything in `compat` follows from that. A claim about your OWN mod (a
section's band, what it contributes) is authoritative. A claim about someone
ELSE's mod is evidence for the sorter and text for the player:

- `prefer-mine` / `prefer-theirs` - a soft ordering preference, dropped without
  ceremony when it contradicts something stronger.
- `conflicts` - "these should not both run", shown as a loud warning carrying
  the author's own `because`, at enable time and in the conflict pane. **Not a
  refusal.** NeoForge and Factorio both block here and this engine deliberately
  does not: ratified decision 18 says the engine labels rather than forbids, a
  third-party author does not get a veto over the player's setup, and a
  declaration goes stale when the other mod fixes the clash.
- `patches` - "when that mod is present, my section X is the compatibility patch
  for it". The section is enabled only while the named mod is, and ignored
  otherwise. The one claim that produces a FIX rather than a winner, which is
  why it lets a compatibility patch ship inside the mod instead of as a third
  download. (RimWorld's `PatchOperationFindMod`, in manifest form.)

`because` is required on every claim. A claim with no reason is one the player
cannot evaluate, and a warning that is always there and never actionable is how
a conflict list turns into wallpaper.

### Sections: the parts of a mod

A mod used to be one atom in the load order, which made three ordinary requests
inexpressible - and they turned out to be the same request. `sections` names the
parts:

```jsonc
"sections": [
  { "id": "kobold-rebalance", "title": "Kobold rebalance",
    "default": true, "priority": "late" }
]
```

- **Scope a claim.** `compat[].scope` names the claimant's own sections, so
  "we clash, but only over the kobold changes" is sayable.
- **Place part of a mod.** `priority` is a BAND (`first`, `early`, `normal`,
  `late`, `last`), not a numeric offset: an offset added to a load index means a
  different neighbour every time the list changes, while every `last` section
  composes after every `normal` one whatever else is installed. This is Forge's
  event-priority scheme over a Bethesda-style load order, and it refuses the
  arms race an integer invites, because there is nothing above `last`.
- **Switch part off.** One player toggle per section, under that mod.

A band yields to a patch target. `priority: "first"` on a section patching
`core:kobold` is a coherent wish and an impossible position, so the section
composes at the earliest legal point instead and the report says the band did
not apply. Soft loses to hard, again.

Contributions are attributed by nesting them under the section id:

```jsonc
{ "fieldPatches": { ... },
  "sections": { "kobold-rebalance": { "fieldPatches": { ... } } } }
```

**A disabled section's contributions do not exist.** They are dropped before
composition rather than composed and overridden - the same rule a disabled mod's
hooks follow.

Sections also expose a flag to the mod's own `hooks.ts`, so `rules` is exactly
"a section with a flag and no contributions". `rules` is unchanged and every
shipped manifest keeps working; the validator refuses a section whose flag a
rule already declares, so the merged flag map cannot give one name two meanings.

**What moves what:** an ordering claim moves a whole MOD; a band moves one PART
of a mod. An author who needs part of their mod placed differently from the rest
says so with a band, which needs nobody's agreement.

### Additive vs conflicting changes

- Additive (each mod adds new records): namespaced ids keep them
  distinct. Never a conflict. This is the overwhelming common case.
- Override (two mods both touch `core:kobold`): a real conflict only if
  they touch the SAME FIELD.

The existing composition model (`patches`, `replaces`, `removes`) is the
lever. [PROPOSED] `patches` becomes field-granular and composable: a
patch is a set of field operations (`set`, `merge`, `addFlag`,
`removeFlag`, numeric `add`/`mul`, list `append`/`removeValue`), applied in
load order. Two mods that
patch DIFFERENT fields of the same record compose cleanly with zero
conflict. Only same-field patches conflict, and then load order decides
and the app says so. This removes the biggest source of false conflicts
in coarse whole-record systems.

### The conflict report, over every layer

The app shows every point where more than one mod contributes, who wins, and -
crucially - **whether anyone loses at all**.

This used to cover CONTENT RECORDS and nothing else, which was one layer of
five. The other four resolved in silence, and three of the four discard
somebody's work:

| Layer | Fold | What used to happen |
|---|---|---|
| Content records | last-wins, per field | reported |
| Graphics (`grafID`) | last-wins (was first-wins) | silent, and backwards |
| Behaviour (`ModHooks`) | per hook - see below | silent |
| Rule flags | last-wins on a flat namespace | silent; two mods share one toggle |
| Autoplayer (`controller`) | single slot | silent; the second install wins |

**The fold is part of the answer**, but it is no longer part of the ANSWER TO
"WHO WINS". Every layer, and every hook, resolves in favour of the mod that
loads last; what the fold says is whether there was anything for a winner to
win. Three folds discard a contribution (`last-wins`, `last-answer`,
`single-slot`) and three combine them (`all-must-agree`, `chained`, `any-yes`),
and only the first group needs a player to do anything. Pretending the layers
resolve alike would be the RimWorld trap - XML, then xpath, then C#, each with
its own effective precedence, so "load order" quietly means three things - but
so is pretending they resolve DIFFERENTLY when they do not.

Of the eight behaviour hooks, two are `last-answer` (the earlier mod's rule
never runs), three `all-must-agree`, one `chained`, one `any-yes`, and one
`all-observe` (every handler runs and none can veto).
`MOD_HOOK_FOLDS` lives in core beside `composeModHooks`, keyed by
`keyof ModHooks` so a hook added to the interface without a fold does not
compile, and a test in
`hooks.test.ts` OBSERVES each fold from what the composition actually does
rather than restating the table - including *which* contributor ran, which is
the half that can be wrong while the table still looks right.

Every claim is **derived from what a mod actually contributes** - the refs in
its files, the keys its hooks factory returned, the grafIDs its manifest claims.
A `touches` declaration in the manifest would have been less code and would go
stale the first time an author forgot to update it, which is the failure this
report exists to catch.

The pane groups its answer three ways, because they need three different amounts
of attention: what an author DECLARED (a human wrote a reason), what is
CONTESTED (somebody's contribution is discarded - the group with a decision in
it), and what COMBINES (listed so the picture is complete, kept last so it does
not bury the group above).

A load order that fails validation (unmet dependency, engine mismatch, hard
cycle) still cannot be launched, and the reason is plain language.

### One winner rule

**The later mod wins. Everywhere. No exceptions.** `mods.ts` ships a live menu
row reading *"Move later (loads last, wins conflicts)"*, and that row is the
specification the rest of this section is measured against.

It was false twice, and the second time was found by re-reading the claim that
the first fix had made it true:

- **2026-08-01.** `composeTileModes` and `enabledTileModes` both gave a
  contested `grafID` to the FIRST claimant, so moving a tiles mod later made it
  lose. Silently, and the conflict report could not see it.
- **2026-08-02.** `walkBlockedByDiggable` and `objectListTiebreak` were
  `first-answer`: the composed hook walked the contributions in load order and
  stopped at the first opinion, so the EARLIER mod's rule ran and the later
  mod's never did. Both are now asked in reverse load order. For the comparator
  that means the last mod's ordering is the primary key and earlier ones break
  the ties it leaves - a lexicographic chain, still a total order, and "later
  wins" for a comparator.

Two folds look like exceptions and are not. `all-must-agree` (the veto hooks)
and `any-yes` are not answering "whose answer is used?" at all: `true` from
`historyAdd` means "I have nothing to say about this entry", not "I insist it be
written", so two mods suppressing two different things do not disagree. Making
those last-wins would let a later mod's silence cancel an earlier mod's rule -
breaking both mods for a consistency nobody asked for. The invariant that
actually matters is that **no mod's opinion is ever discarded in favour of an
earlier one**, and those two discard nothing.

Two deliberate carve-outs remain, and neither is a load-order question:

- A contested Graphics row keeps the SLOT the first claimant put it in, so the
  Graphics menu does not reshuffle when mods are reordered. Only which pack
  draws it changes - **position, not precedence**.
- A pack in the mods FOLDER that reuses a compiled-in pack's id loses to the
  compiled-in one (`mergeModSources`, `discoverMods`). That is **identity, not
  order**: the two are rival candidates for the same mod rather than two mods
  in a sequence, and letting a folder silently redefine what an id means would
  leave the player with no way to see which one they had enabled. In a release
  build the compiled-in set is EMPTY, so this rule only ever fires in dev,
  against the `demo-*` framework proofs.

### External managers (Vortex, MO2)

**RATIFIED 2026-07-27.** Integrating with Vortex and the other
popular mod managers is an explicit goal, and it sets the division of
labour between them and the game:

- **The game ships rudimentary management only.** Turning a mod on and
  off, nudging one earlier/later in the order (the existing "Move earlier"
  / "Move later" rows in `mods.ts`), opting out of one of its patches,
  seeing what conflicts, applying a saved profile. That is the floor a
  player needs to run the first-party mods and a handful of others without
  extra software - not a mod-manager reimplementation.
- **Advanced management belongs to the mod manager.** Real load-order
  SORTING above all (rule sets, auto-sort, bulk reordering of a large
  set), plus deployment/staging, collections and bundles, per-profile
  installs, update watching, and bulk install/remove. Those are solved
  problems in Vortex/MO2 and they are what those tools are for; this project does not
  compete with them and does not grow the in-game UI to match them.

> **AMENDED 2026-08-01: auto-sort comes back in-game.**
> The clause above putting load-order SORTING outside the game is revised; the
> rest of the division of labour stands unchanged. What moved and why:
>
> The 2026-07-27 division was drawn when sorting meant "a UI for dragging a long
> list", which is genuinely Vortex/MO2's job. It is not what sorting means once
> authors can declare compatibility: the inputs (`group`, `compat`,
> `loadAfter`/`loadBefore`, the player's pins) are all things the ENGINE reads
> and the external manager cannot see, and resolving them is one deterministic
> function, not a UI. Leaving it outside would have meant an author could state
> a preference that nothing in the game could act on.
>
> So the game gains ONE BUTTON - "Auto-sort load order..." - which proposes an
> order, shows every suggestion it could not honour, and writes nothing until
> the player accepts. It is not staging, collections, per-install profiles,
> update watching or bulk management, and none of those are coming in-game.
- **The seam is the shared on-disk format, not an API.** A pack is a plain
  directory / zip with a manifest, so it is filesystem-friendly by
  construction. A desktop build watches a mod directory that a Vortex or
  MO2 extension deploys into and honours the explicit enabled-set and
  order it finds there. One format serves both; there is no fork, and the
  external tool never needs the game running to do its job.

Consequence for the engine: the ENABLED SET and the LOAD ORDER must both
be externally authorable, plain-text, and authoritative when present -
not derived state hidden in `localStorage`. The web build's
`localStorage` set (`mod-store.ts`) is the browser's stand-in for that
file, and `?mods=` is already an external override that outranks it, so
the precedence rule (external order > stored order) is settled; the file
form lands with the desktop build.

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

Gameplay scoring mode (core-governed ratchet). A pack that changes core
gameplay declares `affectsGameplay: true` in its manifest. On the first enable
for a save, the UI warns that it will become non-scoring and asks for
confirmation. If accepted, core sets `modNoscore`. This is separate from the
determinism ratchet: a mod may be deterministic, nondeterministic,
gameplay-affecting, both, or neither. `modNoscore` never clears after a mod is
disabled or removed, and score entry rejects it independently of Angband's
reference-format-compatible `player.noscore` bitfield.

---

## 5. Ergonomics: designing out the usual complaints

The goal is a mod UX that avoids the pitfalls people complain about
elsewhere. Each known complaint, and the design answer:

- "A mod broke my save / I cannot uninstall safely."
  -> String-id references, per-mod save namespaces, per-mod migrations,
  and quarantine-on-uninstall. Uninstalling is reversible.
- "Load order is arcane (hand-sorting plugin files, external sorters)."
  -> Auto-sort by declared dependencies, so a correct order needs no
  human. Where a real same-field conflict leaves a genuine choice, the
  conflict report names it in plain words and says who currently wins -
  and the sorting itself is done in the player's mod manager (Vortex/MO2),
  which is already built for it, over the shared on-disk order.
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
2. Next: the in-app mod manager UI - deliberately rudimentary per the
   2026-07-27 division of labour (list, enable/disable, a one-step
   earlier/later nudge, per-patch opt-out, install-from-url, conflict view,
   capability consent, profiles), plus the one auto-sort button the
   2026-08-01 amendment above adds. Bulk reordering, staging, collections
   and update watching stay the external manager's job.
3. Future release: the marketplace backend and in-app browser, plus the
   externally-authored enabled-set/order file and a Vortex/MO2 extension
   over the shared on-disk format.

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
9. Integrate with Vortex and the other popular mod managers, and split the
   labour with them: the game keeps rudimentary management (enable/disable,
   per-patch opt-out, a one-step order nudge, conflict report, profiles)
   and advanced management - load-order sorting above all - is the external
   manager's job over the shared on-disk pack format. The enabled set and
   the load order must therefore be externally authorable and authoritative
   when present. [DECIDED 2026-07-27]
10. A mod is the unit the player switches; its patches ride with it. A
   disabled mod's patches DO NOT EXIST (no flag, nothing to toggle,
   faithful 4.2.6); enabling a mod turns its whole patch set on at once,
   and each patch is then individually switchable so a player can take the
   set minus one. `default: true` on a rule means only "on once its own mod
   is on". [DECIDED 2026-07-26, wording clarified 2026-07-27]
