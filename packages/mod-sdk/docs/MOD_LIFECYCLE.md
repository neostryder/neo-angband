# Mod Lifecycle, Saves, and Composition

This page covers how mods interact with saves, with installation and with each other. Parts of it are built and parts are not. Where the difference matters the text says which, items still marked `[PROPOSED]` are not built yet, and items marked `[OPEN]` are unresolved. The determinism guard in section 4 is a warning and a label on the save, never a bar to using a mod.

It deals with four questions:

1. How is mod content kept separate, so that installing, updating and uninstalling mods does not break your save?
2. How do you install a mod (from a git repo today, from a marketplace later) without friction?
3. How do several mods run together without corrupting each other?
4. What keeps all of this from turning into the usual mod-manager headache?

It builds on the vocabulary in `README.md` (packs, `manifest.json`, namespaced ids, `patches`/`replaces`/`removes`, provenance) and the principles in `../MODS.md`.

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

Each mod owns only its own namespace, so a change to the mod set can only affect that namespace:

- A mod added since the save had an empty namespace in it, so it simply starts contributing. No migration is needed.
- When a mod is updated to a new version, the engine hands it its own old `mod:<id>` bag and asks it to migrate from its old `saveSchema` to the new one. Declarative content usually needs nothing, since ids are stable, and a scripted mod ships a migration function that touches only its own bag. Core takes no part.
- When a mod is uninstalled, entities that reference it are [PROPOSED] quarantined rather than deleted. They move into an `orphans:<id>@<version>` store inside the save, where they are frozen, inert and out of active play but preserved. Reinstall the mod (same major version) and they come back exactly where they were. Uninstalling therefore removes a mod's active content without ever corrupting the save.

On the first load after content is orphaned, the game shows a one-time prompt for that save offering "keep frozen" (the default) or "purge N orphaned items permanently". Quarantine stays the default, and nothing is destroyed without that explicit, counted confirmation. The prompt appears once per save so it never nags, and declining leaves everything quarantined and reversible. There is no automatic purge, even for orphans that look trivial or cosmetic: the engine cannot reliably tell what counts as either, and silent deletion would break the rule that nothing a player earned vanishes without a trace.

This is built. The prompt appears once the game screen is live, with "keep" as the first option, and states how much a purge would destroy. Dismissing it counts as keeping, since keeping is the only answer that destroys nothing. The answer is recorded in `SavedGame.orphansAcknowledged` and written to disk immediately, so neither answer is asked for again and a crash cannot undo a purge. The whole engine side is `orphanPromptDue` and `purgeOrphans` (`packages/core/src/mod/orphan-stash.ts`), and purging is the only write anywhere in the orphan path.
### When a mod's content leaves the game

Quarantine is how orphaned content is stored. The recoveries below are what the player sees on top of it, and they exist so that uninstalling a mod never strands a character or silently destroys anything. They also apply when content is shadowed rather than uninstalled, meaning a later mod in the load order `removes` or `replaces` a record the save depends on.

- Stranded location. If the character is standing on a level, in a room, or in a whole region that a now-missing mod generated, the load cannot put them there. They are returned safely to the town, which is core parity content and always present, with a message explaining why. The dungeon regenerates from the remaining content as normal on the next descent, so half-loaded mod geometry is never walked.
- Stranded items. Items whose definition came from the missing mod are neither dropped nor deleted. They are frozen in the `orphans:<id>@<version>` store as inert entries, listed and labelled with their origin mod, and cannot be equipped, used or sold while the mod is absent. Reinstalling the mod puts each one back where it came from: a worn item returns to its equipment slot if that slot is still free, and a carried one returns to the pack. This is built, as part of the orphans store rather than as home stock. The frozen entry records the gear handle and the equipment slots it was taken out of (`packages/core/src/mod/save-blocks.ts`), which is what makes the exact restore possible. While it waits it takes no home slot, no pack slot and no weight, so it costs the player nothing a home slot would have cost, and the stash view below is where it is seen and reclaimed.
- The stash view. A dedicated screen, reachable at any time, lists everything currently quarantined, whether by uninstall or by another mod's override, grouped by the mod that owns it. Each entry shows what it is, why it is inert ("frost is not installed" / "frost is installed but switched off"), and what would restore it ("install frost again" / "turn frost back on"), so nothing a player earned disappears without a trace they can find. This is built: Mods -> "Set aside by a missing mod", screen id `core:mod-orphans` (`packages/web/src/mod-orphans.ts`), over the read-only model in `packages/core/src/mod/orphan-stash.ts`. The menu row shows the count, and a load that newly freezes something names it on the message line. Quarantine is keyed on whether a namespace is present, so the screen works out the reason from what the host can see now instead of reading a reason from the store. Shadowed entities will reach the same screen by the same route as soon as quarantine produces them, because a shadowed entity's own namespace is present and the screen already has wording for that state.

These recoveries protect what the player has against a change in their mod setup. They never let the player undo something that happened in play, so they sit alongside the no-save-scum rule without conflicting with it.
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

A grant records what the mod asked for at the moment the player gave it, so it can fall behind the manifest. Consent is written when a mod is enabled. If a later version adds a capability and the mod is updated in place, the stored grant covers only part of what the mod now requests, and a plugin whose grant does not cover its manifest does not load. `loadPluginPacks` puts it on `skipped` rather than `problems`, because a mod the player has switched off goes on that same list and neither case is a fault.

Nothing else on the screen shows this. The row stays enabled, and every rule the mod declares still renders and still accepts a click, because the options rows are built from manifests rather than from loaded code. Only the plugin half is affected: `pack.ts` performs no capability check, so a hybrid content-and-plugin mod that is short a grant keeps composing its content while its code does not run.

The manager therefore treats an out-of-date grant as its own state, with its own action. The row carries the stored grant alongside the requested list, the detail pane names the difference and says the code is not running, and the mod's own screen offers to allow what is newly requested. Declining offers to switch the mod off, so a mod that is listed as on while contributing nothing is always a state the player chose and can see.

The vocabulary is `command:add`, `event:<name>`, `state:<domain>.read`, `network:<host>`, `registry:<domain>`, `display:replace` and `ui:<region>.replace`. The last two cover the screen, as two separate grants. `display:replace` is what `ModPlugin.frontend` requires: the mod draws everything the player sees of the dungeon. `ui:<region>.replace` is what `ModPlugin.hud` requires, one region at a time (`ui:messages.replace`, `ui:sidebar.replace`, `ui:status.replace`, or `ui:*.replace` for all three). A mod that redraws the vitals therefore does not have to ask for the message line as well, and a player giving consent is told which part of their screen is changing hands.
Neither screen grant falls under `registry:`, and `registry:*` covers neither of them. An override wildcard grants every named game system, which is a different thing from owning part of the screen. The two screen grants do not cover each other either. There is no `ui:map.replace`, because the dungeon belongs to `display:replace`, and a region answering to two capabilities would have two owners.

The vocabulary has since grown `ui:region.create`, `ui:panel.mount`, `backup:folder`, `debug:spawn`, `debug:wizard`, `mod:install` and `mod:session`. The header of `packages/mod-sdk/src/capabilities.ts` is the reference list, and [PLUGINS.md](PLUGINS.md) explains what each one does and does not open. Two points about how grants are priced apply to the whole family, so they are covered here.

First, a grant is compared by action as well as by kind. `ui:*.replace` includes neither `region.create` nor `panel.mount`, and `mod:install` does not include `mod:session`, because in each pair neither side is a superset of the other. `debug:spawn` does not include `debug:wizard` for the same reason. That comparison arrived with the second `debug:` action: while the family had only one action, the check looked at the kind alone, which happened to be correct, but with two actions it would have let a mod that asked to conjure one monster reach the depth jumps and acquirement as well.

Second, a capability's consent sentence is what tells the player how much it grants, so two grants whose sentences differ cannot share a string. `mod:install` puts a pack in the library switched off, and the player sees it before any of it runs. `mod:session` switches one on for the rest of the session, which grants more.

The same reasoning explains why `mod:install` opens two ctx fields. It carries `ctx.reloadGame` as well as `ctx.installMod`, because content composes at load: a mod that could install a pack but not reload would leave the player holding something the running game never loads, and a reload is not something a mod would ask for on its own. Splitting the two would put half an action on the consent list, which is the same mistake as pricing two actions with one sentence.
### A mod that lasts one session

Besides the shipped installer, a folder on disk and a zip the player imports, a mod can be staged for the current browsing session only (`packages/web/src/mod-session.ts`). The archive is kept in session storage rather than IndexedDB, the pack composes on the next reload without needing to be enabled, and closing the game forgets it.

Everything else in this section still applies. The manifest is validated, the engine range is honoured, the standards inspection runs, the origin is pinned against an installed copy of the same id, and the pack goes through the same composer in the same load order. A staged copy of an installed id shadows it, and the collision is reported. Only the lifetime of the archive differs. While they are loaded, a session pack's records are as real as any others, and section 4's account of what a capability does and does not fence applies unchanged.

"Just for this session" has two limits. First, the lifetime is a convention rather than a boundary: a browser that restores a closed or crashed window restores session storage with it. To make up for that, a session mod is always listed, always marked and always removable. Second, a save written while a session mod was loaded stays loadable but cannot be reproduced. Entities in the staged namespace are quarantined on the next load, as they should be, while a field the pack patched on a core record simply goes back to its unpatched value, because a patch lives in the composition and not in the save. `docs/PLANNED.md` tracks that second limit as open work.
### From a git repository

Step 4 below, the pre-install summary, is built (issue #23). `mod-preinstall.ts` (in `packages/web/src`) reads the candidate's own declared content files at its pinned tag and reports what it adds and what it patches, replaces or removes. Each touched record is paired with its owning pack and whether that owner is enabled right now, instead of a guess about a load order that has not been composed yet. The summary also shows the requested capabilities (in `capability-describe.ts`'s own wording, reused rather than copied), the license, and any `conflicts` claim that would apply in either direction once the candidate joins the player's enabled set (`mod-conflicts.ts`'s `declaredConflicts`, also reused). Size, author and screenshots come from discovery (`mod-discover.ts`), which showed them before the summary existed, and the summary includes them alongside its own sections. `mod-browse.ts`'s `showRepoInstallSummary` displays it between pasting a repository address and the install action. The player confirms or cancels there, and confirming runs the same install path (`installOne`) that the other ways of installing use.

Steps 1, 3 and 5 are still `[PROPOSED]`. The shipped installer reads `manifest.json` at a tag and nothing else (no branch head and no bare commit), the full schema and dependency-availability check still runs only at the actual install rather than before the summary, and an install still appends to the load order rather than inserting at a dependency-resolved position. [MOD_COMPATIBILITY.md](MOD_COMPATIBILITY.md) and [../MODS.md](https://github.com/neostryder/neo-angband/blob/master/docs/MODS.md) describe what the installer does today, including how it picks which release to offer and what an install pins. The numbered list below describes where the rest of the installer is heading.
The user pastes a repository URL (or picks a ref). The app:

1. [PROPOSED] Resolves a specific ref (tag preferred, else branch head, else
   commit) and pins it - installs are reproducible, not "latest".
2. Fetches the tree at that ref and reads `manifest.json`.
3. [PROPOSED] Validates: schema, `engine` compatibility, dependency
   availability and version ranges, and (for plugins) the capability list.
4. Shows a pre-install summary: what it adds, what it patches, replaces or
   removes and whether each touched record's owner is enabled, capabilities it
   requests in plain language, size, license, author, screenshots, and any
   conflicts with already-enabled mods.
5. [PROPOSED] On confirm, materializes the mod into local storage
   (content-addressed by hash), enables it, and inserts it into the load
   order at the dependency-correct position.

[PROPOSED] A web page cannot speak the git protocol or clone from arbitrary hosts (CORS, no git transport). In the web build, "install from git" means fetching the repository tarball at a ref through the host's HTTP API; GitHub and GitLab both expose CORS-friendly archive and raw endpoints for public repos. Private or self-hosted repos need a user-supplied token or a small optional proxy, and the documentation says so. The desktop build could clone directly, since it has a real filesystem and a real process to run git in. Either way the installer consumes the same pack format.
### From a marketplace

There is no self-hosted marketplace and none is planned. An earlier design for one, serving pre-validated, pre-packaged `.ngpack` bundles (the pack directory, zipped, with the manifest and a signed content hash) with in-app browse, search, screenshots and ratings, was never built. Nexus Mods integration (tracked in the mod-distribution issues) takes its place. Nexus already provides hosting, browse and search, screenshots and ratings at a scale a self-hosted marketplace would take years to reach, and a second, competing store would duplicate that infrastructure for a much smaller audience. The manifest fields meant for the marketplace (`description`, `screenshots`, `changelog`, `author`, `license`, and a hash-based integrity record) are the same ones a Nexus-origin install preview uses.
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

Enabled mods form an ordered list, and later in the order wins on a real conflict (last-write-wins, the convention players know from Bethesda games). Every composition layer follows that rule. Until 2026-08-01 graphics modes resolved first-wins, so moving a tiles mod later made it lose while the manager's own row promised the opposite (see "One winner rule" below).

Two functions produce an order, and the split between them sums up the model:

- `resolveLoadOrder` enforces. It takes the list the player chose and refuses one that cannot work, such as a missing dependency or a hard cycle.
- `sortModOrder` proposes. It takes the same inputs plus everything anyone merely prefers, and returns an order the player may accept or ignore. It cannot fail.

`sortModOrder` weighs four tiers, strongest first, and when constraints contradict, that ranking alone decides which one is dropped:

| Tier | Source | Why it ranks there |
|---|---|---|
| `hard` | `dependencies`, present `optionalDependencies` | Correctness - a pack cannot patch records that have not composed |
| `player` | what the player pinned by moving a mod | Their machine, their call |
| `author` | `loadAfter`/`loadBefore`, `prefer-mine`/`prefer-theirs` | A named guess about a named mod |
| `group` | membership in the shipped `group` order | Nobody wrote it about this pair |

`loadAfter` and `loadBefore` used to be hard edges. Two mods that each claimed priority over the other then produced `dependency cycle among packs` and the whole set refused to launch, even though neither author had done anything unreasonable. They are now `author`-tier. On a cycle the sorter drops the weakest edge and says which one and why. Only a cycle made entirely of hard edges is reported as unresolvable, because that mod set is impossible rather than merely disputed. LOOT works the same way: soft metadata that contradicts hard metadata is ignored instead of becoming an error neither author can fix.

Groups (`PACK_GROUPS`: framework, overhaul, content, gameplay, tweaks, interface, cosmetic, late) let a mod sort correctly against mods that did not exist when it was written. Pairwise hints need the author to have heard of the other mod, which is why LOOT needs a hand-maintained masterlist and why groups are the part worth borrowing.

Player pins survive re-sorting. Moving a mod records the pair the player reordered (not an absolute index, which stops meaning anything as soon as another mod is installed) and replays it as a `player`-tier edge. Without this, an auto-sort would silently undo a placement the player just made, and they would soon stop using it.

The sort has to be deterministic, because the resolved order goes into the savefile's mod-set fingerprint. It is a pure function of (manifests, pins, current order): no clock, no `Math.random`, and no reliance on Set/Map iteration order for anything that decides an outcome.
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

A mod used to be a single unit in the load order, which made three ordinary requests impossible to express, and all three turned out to need the same thing. `sections` names the parts of a mod:

```jsonc
"sections": [
  { "id": "kobold-rebalance", "title": "Kobold rebalance",
    "default": true, "priority": "late" }
]
```

- Scoping a claim: `compat[].scope` names the claimant's own sections, so a mod can say "we clash, but only over the kobold changes".
- Placing part of a mod: `priority` is a band (`first`, `early`, `normal`, `late`, `last`) rather than a numeric offset. An offset added to a load index lands next to a different neighbour every time the list changes, whereas every `last` section composes after every `normal` one whatever else is installed. This is Forge's event-priority scheme applied over a Bethesda-style load order, and since nothing ranks above `last`, authors cannot keep outbidding each other with bigger numbers.
- Switching part off: each section gets its own player toggle under its mod.

A band gives way to a patch target. `priority: "first"` on a section that patches `core:kobold` asks for a position that cannot exist, so the section composes at the earliest legal point instead and the report says the band did not apply, the same way any soft constraint yields to a hard one.

Contributions are attributed by nesting them under the section id:

```jsonc
{ "fieldPatches": { ... },
  "sections": { "kobold-rebalance": { "fieldPatches": { ... } } } }
```

A disabled section's contributions do not exist. They are dropped before composition rather than composed and then overridden, which is the same rule a disabled mod's hooks follow.

Sections also expose a flag to the mod's own `hooks.ts`, so a `rules` entry is simply a section with a flag and no contributions. `rules` is unchanged and every shipped manifest keeps working. The validator rejects a section whose flag a rule already declares, so the merged flag map never gives one name two meanings.

An ordering claim moves a whole mod, and a band moves one part of it. An author who needs part of their mod placed differently from the rest uses a band, which needs nobody else's agreement.
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

The app shows every point where more than one mod contributes, who wins, and whether anyone loses at all.

The report used to cover content records only, which is one layer out of five. The other four resolved silently, and three of them discard somebody's work:

| Layer | Fold | What used to happen |
|---|---|---|
| Content records | last-wins, per field | reported |
| Graphics (`grafID`) | last-wins (was first-wins) | silent, and backwards |
| Behaviour (`ModHooks`) | per hook - see below | silent |
| Rule flags | last-wins on a flat namespace | silent; two mods share one toggle |
| Autoplayer (`controller`) | single slot | silent; the second install wins |

Every layer and every hook now resolves in favour of the mod that loads last, so the fold no longer decides who wins. What it tells you is whether there was anything to win. Three folds discard a contribution (`last-wins`, `last-answer`, `single-slot`) and three combine contributions (`all-must-agree`, `chained`, `any-yes`), and only the first group needs the player to do anything. Treating every layer as if it resolved the same way would be the RimWorld trap, where XML, then xpath, then C# each have their own effective precedence and "load order" quietly means three things. Treating the layers as different where they are not would mislead just as much.

Of the eight behaviour hooks, two are `last-answer` (the earlier mod's rule never runs), three `all-must-agree`, one `chained`, one `any-yes`, and one `all-observe` (every handler runs and none can veto). `MOD_HOOK_FOLDS` lives in core beside `composeModHooks` and is keyed by `keyof ModHooks`, so a hook added to the interface without a fold does not compile. A test in `hooks.test.ts` checks each fold against what the composition actually does rather than restating the table, including which contributor ran, since that is the part that can be wrong while the table still looks right.

Every claim is derived from what a mod actually contributes: the refs in its files, the keys its hooks factory returned, the grafIDs its manifest claims. A `touches` declaration in the manifest would be less code, but it would go stale the first time an author forgot to update it, and stale declarations are what this report exists to catch.

The pane groups its results three ways, by how much attention each needs: what an author declared (a person wrote a reason), what is contested (somebody's contribution is discarded, so there is a choice to make), and what combines (listed so the picture is complete, and kept last so it does not bury the contested group).

A load order that fails validation (unmet dependency, engine mismatch, hard cycle) still cannot be launched, and the reason is given in plain language.
### One winner rule

The later mod wins, on every layer. `mods.ts` ships a live menu row reading *"Move later (loads last, wins conflicts)"*, and the rest of this section is measured against that row.

The row has been false twice, and the second case turned up while re-checking that the first fix had made it true:

- 2026-08-01: `composeTileModes` and `enabledTileModes` both gave a contested `grafID` to the first claimant, so moving a tiles mod later made it lose, silently and out of sight of the conflict report.
- 2026-08-02: `walkBlockedByDiggable` and `objectListTiebreak` were `first-answer`. The composed hook walked the contributions in load order and stopped at the first opinion, so the earlier mod's rule ran and the later mod's never did. Both are now asked in reverse load order. For the comparator, that makes the last mod's ordering the primary key, with earlier mods breaking the ties it leaves: a lexicographic chain that is still a total order, and the comparator's version of "later wins".

`all-must-agree` (the veto hooks) and `any-yes` can look like exceptions, but they do not answer "whose answer is used?" at all. `true` from `historyAdd` means "I have nothing to say about this entry", not "I insist it be written", so two mods suppressing two different things are not in disagreement. Making those hooks last-wins would let a later mod's silence cancel an earlier mod's rule, and both mods would break. The rule that matters is that no mod's opinion is ever discarded in favour of an earlier mod's, and these two folds discard nothing.

Two cases resolve differently, and neither is a question of load order:

- A contested Graphics row keeps the slot its first claimant put it in, so the Graphics menu does not reshuffle when mods are reordered. Only the pack that draws it changes; the row's position has nothing to do with precedence.
- A pack in the mods folder that reuses a compiled-in pack's id loses to the compiled-in one (`mergeModSources`, `discoverMods`). This is about identity rather than order: the two are competing candidates for the same mod, not two mods in sequence, and letting a folder quietly redefine what an id means would leave the player unable to tell which one they had enabled. Release builds compile in no packs, so this only ever happens in dev, against the `demo-*` framework proofs.
### External managers (Vortex, MO2)

Neo Angband is meant to work alongside Vortex and the other popular mod managers, and the work is divided between them and the game.

The game ships basic management only: turning a mod on and off, nudging it earlier or later in the order (the "Move earlier" / "Move later" rows in `mods.ts`), opting out of one of its patches, seeing what conflicts, and applying a saved profile. That is enough to run the first-party mods and a handful of others without extra software, and it is not meant to become a full mod manager.

Since 2026-08-01 the game also has one "Auto-sort load order..." button. It proposes an order, shows every suggestion it could not honour, and writes nothing until the player accepts. Sorting lives in the game because its inputs (`group`, `compat`, `loadAfter`/`loadBefore`, the player's pins) are all things the engine reads and an external manager cannot see, and resolving them is one deterministic function rather than a UI. Without it, an author could state a preference that nothing in the game could act on.

Advanced management belongs to the mod manager: rule sets and bulk reordering of a large set, deployment and staging, collections and bundles, per-profile installs, update watching, and bulk install and remove. Vortex and MO2 already solve those problems, and none of them are planned for the game.

The two meet at the on-disk format rather than through an API. A pack is a plain directory or zip with a manifest, so filesystem tools handle it naturally. A desktop build watches a mod directory that a Vortex or MO2 extension deploys into, and honours the explicit enabled set and order it finds there. One format serves both, there is no fork, and the external tool never needs the game running to do its job.

For the engine, this means the enabled set and the load order must both be externally authorable, plain text, and authoritative when present, rather than derived state hidden in `localStorage`. In the web build, the `localStorage` set (`mod-store.ts`) stands in for that file, and `?mods=` is already an external override that outranks it, so external order takes precedence over stored order. The file form arrives with the desktop build.
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

Determinism guard. Save-scum protection does not depend on determinism. It comes from the faithful port of the original's persisted RNG state (the full `STATE[]`/`Rand_value` is in the save, so a reload resumes the exact stream and cannot reroll) together with a single save and terminal death; see the save-scum policy. Because that protection rests on saved state rather than on replaying a run from a seed, it works with mods.

The guard itself is a convenience and a label. The SDK hands every plugin a seeded RNG, and by default the sandbox withholds the nondeterministic sources (wall clock, `Math.random`, ambient network), so an author who does nothing special stays deterministic. That keeps the unmodded-style "shareable seed" reproducibility working when their mod is pure. Reproducibility is a nice-to-have, and the game does not depend on it.

Cheaty and nondeterministic mods are allowed, and the engine does not forbid them. A mod that wants nondeterminism (a live-multiplayer transport, a wall-clock event, an external AI agent) declares `nondeterministic: true` in its manifest. The engine then grants the capabilities it asks for and marks any profile containing it as "not reproducible / not seed-shareable". Nothing is blocked; the player is simply told what they are giving up. Two consequences follow. Adding, removing or updating mods mid-run also breaks reproducibility from a seed, because the mod set is one of the seed's inputs. And a nondeterministic mod reopens reload-rerolling within its own mechanics, since those outcomes are not pinned to saved state, while core mechanics stay reroll-proof because they draw from the saved seeded stream. An undeclared plugin that touches a withheld source gets a clear author-facing error pointing at the fix, instead of a silent divergence.

Save determinism mode. Core enforces the label: every save carries a determinism mode that core owns, whatever mods are loaded. A save starts deterministic, and the first time a determinism-affecting mod is enabled on it, core switches it to nondeterministic. The switch is permanent. Removing the mod later does not restore deterministic mode, so a deterministic (unmodded) save cannot be tainted by a mod and then cleaned up to reclaim its reproducibility and anti-scum guarantees. Mods can trigger the switch but can never reverse or prevent it. That is why the save block records both the exact mod set and the mode: the mode travels with the save.
Gameplay scoring mode. A pack that changes core gameplay declares `affectsGameplay: true` in its manifest. The first time it is enabled for a save, the UI warns that the save will become non-scoring and asks for confirmation, and if the player accepts, core sets `modNoscore`. This is separate from the determinism mode: a mod may be deterministic, nondeterministic, gameplay-affecting, both, or neither. Like the determinism mode it only goes one way. `modNoscore` never clears after a mod is disabled or removed, and score entry rejects it independently of Angband's reference-format-compatible `player.noscore` bitfield.

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

### Profiles

[PROPOSED] A profile is a named, ordered mod set. A character's save is bound to the profile that created it, which is what the manifest block records. You can keep a vanilla character and a heavily modded one side by side with no cross-contamination, and a character only changes profile through a guarded flow that runs the appropriate migrations or quarantine. Profiles can be shared by exporting and importing a small profile file (ids, versions, sources, order), so a friend can reproduce your setup in one click. Saves are handled differently: they are not casually exportable, because the engine's determinism plus a shared seed and a shared profile already reproduce a playthrough, and freely exportable saves would undercut the no-save-scum rule (see the save-scum policy).

The pre-migration snapshot in section 2 is not save-scumming either. It is an operational safety net that restores only when a migration throws, and it is never offered as a "load an earlier save" command. It guards against a failed tool, never against the player's own bad luck. The no-save-scum rule bars player-facing rollback of gameplay outcomes, and the snapshot is neither player-facing nor a gameplay rollback.
### Safe mode

[PROPOSED] If an enabled combination of mods fails to boot, the app offers a one-click "start with mods disabled" recovery, so a bad mod can never lock you out of the app or out of a save.

---

## 6. Build order

Seams and formats come first, because they are cheap now and expensive to retrofit, then UI, and the marketplace last:

1. Now, as the save system and loader land: string-id serialization, the namespaced save blocks and per-mod bags, the field-level patch/merge composer, the load-order and dependency resolver, the capability model, and the conflict-report computation. These are engine seams.
1b. Wiring the engine seams from item 1 into the running game: a loader that resolves and composes the pack set at boot, capability enforcement on the perceive/act facades, the agent controller installed in the host, and the turn loop routed through the event bus. As of 2026-07-14 the item 1 seams were built and tested but had no runtime caller. This step comes before the UI below.
2. Next: the in-app mod manager UI, kept basic to match the split with external managers described above (list, enable/disable, a one-step earlier/later nudge, per-patch opt-out, install-from-url, conflict view, capability consent, profiles), plus the one auto-sort button. Bulk reordering, staging, collections and update watching stay the external manager's job.
3. Future release: Nexus Mods integration (a real second pinned origin, which replaces the self-hosted marketplace this item once named; see "From a marketplace" above), the externally authored enabled-set/order file, and a Vortex/MO2 extension over the shared on-disk format.

Authors check a pack in CI with `neo-angband-mod-check` (the same rules the game enforces at install) and produce a distributable `plugin.js` with `neo-angband-mod-build`. Both ship in `@rpgm-tools/neo-angband-mod-sdk`. The repo carries sample mods that CI installs and runs.
---

## Summary

1. Saves reference content by string id, never by index. Most of the rest of this design follows from that.
2. Uninstalling quarantines a mod's content (freeze and restore) by default, with a one-time keep/purge prompt for orphans.
3. The last mod in the load order wins, and patches compose field by field.
4. The determinism guard on state-affecting plugins is a warning and a label with an opt-out, never a bar. Cheaty and nondeterministic mods are allowed; see section 4.
5. Profiles are bound to saves. Profiles are shareable and saves are not.
6. The pre-migration snapshot is an operational safety net, consistent with the no-save-scum rule.
7. Uninstall recovery: stranded characters return to town, mod items are quarantined and go back to the slot they came out of on reinstall, and a stash view shows everything quarantined or shadowed. The stash view and the item restore are built (see "When a mod's content leaves the game" above); the stranded-location half is not. Items are held in the orphans store rather than as home stock, because the store records the gear handle and equipment slots an item was taken from and the home has no way to carry those. The stash view gives what a home entry would have: visible, labelled, inert, and costing no slot.
8. Orphans are quarantined by default, with a one-time per-save keep/purge prompt where keep is the default, and nothing is purged automatically. This is built.
9. The game works with Vortex and the other popular mod managers and splits the work with them. The game keeps basic management (enable/disable, per-patch opt-out, a one-step order nudge, conflict report, profiles), and advanced management, load-order sorting above all, is the external manager's job over the shared on-disk pack format. The enabled set and the load order must therefore be externally authorable and authoritative when present.
10. A mod is the unit the player switches, and its patches come with it. A disabled mod's patches do not exist (no flag, nothing to toggle, as in 4.2.6). Enabling a mod turns its whole patch set on at once, and each patch can then be switched individually so a player can take the set minus one. `default: true` on a rule means only "on once its own mod is on".
