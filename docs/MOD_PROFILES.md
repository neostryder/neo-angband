# Shareable mod-set snapshots: exporting and importing a "Delve"

**STATUS: DESIGN, nothing here is built.** This document specifies a feature
for the game's own mod manager (`packages/web/src/mods.ts` and its supporting
modules `mod-store.ts`, `mod-install.ts`, `mod-discover.ts`), not any
individual mod's concern - the same "core is the mod architecture itself"
carve-out that the rest of the manager already sits in
(`docs/MODS.md#what-is-core-and-what-is-a-mod`). Read this before starting
work on it: the fields below are not invented, they are read off the real
state the manager already tracks, and the sections on version mismatch and
consent deliberately reuse mechanisms `MOD_COMPATIBILITY.md` and `MODS.md`
already ratified rather than inventing stricter ones.

## The gap this closes

Getting your own mod set onto a second machine, or getting it into someone
else's hands, today means re-doing every step by memory: open **Install a
mod...**, remember which of the recommended mods you run, install each one,
open every mod's **Fixes & tweaks** screen and re-flip every toggle you had,
and separately describe your birth choices and options in words if you want
someone to match them. There is no artifact that captures "this, exactly" and
hands it to another install or another person.

**A narrower version of this used to exist, and was not enough.**
`ModStore.saveProfile` / `applyProfile` let a player save the *current enabled
set plus capability consents* under a name and switch back to it later,
surfaced as **Profiles...** in the Mods menu. It never left the browser, did
not carry a mod's version, and did not carry rule/section flag choices or
options. It was removed (neo-angband#163) once player/testing profiles made
it redundant - every player/testing profile now carries its own independent
enabled set and consents, so switching between mod loadouts is switching
profiles. This feature (still unbuilt) is not a superset of that removed
mechanism's *local* job - #163's profiles cover that now - it is a superset in
a different direction: a real file (or a block of text short enough to paste
into a Discord message), versioned, that can carry a mod's version and
origin, its flag choices, and - separately, opt-in - the birth and general
game options a character was using, and that can leave the browser entirely.

## What the manager can actually capture, read from the real code

Every field below is something the manager already tracks somewhere. None of
it is invented for this document.

**Per installed mod** (`packages/web/src/mod-install.ts:71-137`,
`InstalledModMeta`, plus the manifest the mod itself shipped,
`packages/mod-sdk/src/manifest.ts:378-522`, `PackManifest`):

| Field | Source | Notes |
|---|---|---|
| `id` | `InstalledModMeta.id` / `PackManifest.id` | the folder name and save-namespace key |
| `name` | `PackManifest.name` | human title, for a reader who has not installed it yet |
| `version` | `PackManifest.version` | the mod's own semver |
| `repo` | `InstalledModMeta.repo` | `owner/repo`, where it was fetched from |
| `tag` | `InstalledModMeta.tag` | the release tag installed |
| `sha` | `InstalledModMeta.sha` (optional) | the commit the tag resolved to at install time, for noticing a moved tag |
| enabled state | `ModStore.getEnabled()` (`mod-store.ts:448`) | whether it is in the active set |
| flag choices | `ModStore.getRuleChoices()` (`mod-store.ts:760-767`) | a flat map of namespaced flag -> boolean, covering both `PackRule.flag` and `PackSection.flag` (`manifest.ts:98-171`) - the two vocabularies feed the same map, "so one mod can use one vocabulary for both" |
| granted capabilities | `ModStore.getConsents()` (`mod-store.ts:703`) | which of the mod's requested `capabilities` this install approved |

**Options** (`packages/core/src/player/options.ts`, `OptionState`), in two
groups that upstream itself already treats separately, and this design keeps
that split rather than inventing a new one:

- `birth` - the frozen `birth_*` snapshot (`OptionState.birth`,
  `options.ts:129-154`), chosen once at character creation and locked. Upstream
  restores this group from `customized_birth_options.txt`
  (`packages/core/src/player/options-file.ts:1-53`) at the START of the birth
  process, before any choice is made - so on import this group can only ever
  seed the NEXT character's birth screen, never rewrite a locked, already-born
  one.
- `game` - the `INTERFACE`-typed options (`OPTION_ENTRIES` entries with
  `type: "INTERFACE"`, `packages/core/src/generated/options.ts`) plus the three
  scalars `hitpointWarn`, `delayFactor`, `lazymoveDelay`. Upstream persists
  exactly this group, separately, as `customized_interface_options.txt` and
  restores it on every new character. `CHEAT` and `SCORE` options are
  deliberately **excluded** from both groups - upstream's own
  `options_init_defaults` (`option.c:148-164`) never restores them from a
  custom-defaults file either, because they are not birth or interface pages,
  and a shareable community file has no business carrying somebody's cheat
  toggles.

Nothing else is capturable, because nothing else exists as a named, resolvable
piece of state at the level this feature operates at: a mod's own private save
bag (`ModPlugin.migrateBag`, `docs/modding/PLUGINS.md#your-own-saved-data-and-changing-its-shape`)
belongs to a specific character's save, not to the install-level configuration
this feature snapshots, and is out of scope on the same grounds `ModProfile`
already leaves it alone.

## Naming

"Profile" is ruled out: player/testing profiles (neo-angband#163) already name
a *local* multi-configuration feature (separate settings, mod loadout, and
saves within one install) - reusing the word here for a *portable, shareable*
file would make two unrelated features answer to the same name in the same
menu, exactly the collision the removed `ModProfile` mechanism used to avoid
by being the only claimant.

Five candidates, judged on: does it read as *this project's own* term rather
than a claim about upstream Angband or the wider roguelike genre; does it make
a good verb/noun pair ("save a X", "load a X", "share your X"); does it avoid
every name already spoken for in this codebase (`pack`/`PackManifest` for one
mod, `bag` for a mod's private save data, `manifest` for the per-mod JSON
file, `profile` for the player/testing-profile feature, `Grimoire` and `rune`
for real upstream content - Kelek's Grimoire of Power is an actual artifact
spellbook, and runes are a real 4.2 mechanic - and
`Vault`/`Tome`/`Scroll`/`Quill`/`Atlas`/`Herald`/`Sceptre`/`Forge`, which are
RPGM Tools' own other product and mod names):

| Candidate | Why it could work | Why it might not |
|---|---|---|
| **Delve** | A dungeon-crawl genre word, not an upstream Angband term, so it reads as this project's own coinage rather than a claim about the source game. Works as a plain noun ("your Delve", "a shared Delve") and as a light verb ("delve into someone else's setup"). Short, unclaimed anywhere else in this codebase. | Generic enough that it could describe almost any roguelike feature; carries no specific hint that it is about MOD configuration rather than, say, a dungeon level. |
| **Cairn** | The trail-marker image fits exactly what the feature does: leave a marker that lets someone else retrace your exact path. Strong "try my experience" story for the Discord use case. Unclaimed. | Less immediately clear to a player who has never heard the word used this way; slightly precious. |
| **Sigil** | A personal mark, which fits "make people want to make and share one" - a sigil is something you would want attached to your name. Short, unclaimed. | Reads more like an in-game magic item than a settings file; could be mistaken for a real game object the way `rune` would be. |
| **Waystone** | Same guide/marker idea as Cairn with a slightly more "fantasy game object" feel, which may read as friendlier in a UI row. Unclaimed. | Two words mashed into one is a step further from plain English than the others; no stronger a fit than Cairn for the same idea. |
| **Loadout** | The clearest to everyone immediately - it is standard, cross-genre gaming vocabulary for "my exact setup, shareable." Zero learning curve. | Exactly the generic, catch-all kind of name this feature needs to avoid; carries no Angband or dungeon flavor at all, and does not stand out enough to make anyone want to go make one. |

**Recommendation: Delve.** It is the only candidate that is both a real,
already-understood piece of dungeon-crawl vocabulary (so nobody has to learn a
new word) and not an actual Angband/roguelike mechanic name (so it cannot be
mistaken for upstream content the way Grimoire or Rune would be). It reads
naturally in every UI position this feature needs: a menu row ("Save a
Delve...", "Load a Delve..."), a file name (`ironman-race.ndelve`), and a
Discord sentence ("here's my Delve for the Borg race channel"). The rest of
this document uses **Delve** as the feature's name; every field and mechanism
below works identically under any of the five names above; nothing about the
design is coupled to the word chosen.

## The file format

A Delve is one JSON object. `formatVersion` is separate from the engine
version and from any single mod's version, because this format will need to
change on its own schedule (new option groups, new mod fields) independently
of both - the same reasoning `TRANSFER_VERSION` already applies to `.neochar`
character-transfer files (`packages/web/src/save-transfer.ts:47-51`), whose
`magic` + `version` shape this format deliberately mirrors rather than
inventing a third vocabulary for "what kind of file is this, and which
revision of its shape."

```json
{
  "magic": "neo-angband-delve",
  "formatVersion": 1,
  "name": "Ironman race ruleset",
  "description": "Matches the settings pinned in #ironman-race. Mods only - options are yours to keep.",
  "createdAt": "2026-08-23T18:04:00.000Z",
  "createdWithEngine": "0.20.0",
  "mods": [
    {
      "id": "qol",
      "name": "Quality of Life",
      "repo": "neostryder/neo-angband-mod-qol",
      "tag": "v1.4.0",
      "version": "1.4.0",
      "sha": "9f2c1a4e8b7d3f6a0c5e2b1d4f7a8c3e6b9d2f5a",
      "enabled": true,
      "flags": {
        "qol.autoDig": true,
        "qol.showDamage": false
      },
      "consents": ["command:add", "event:turn-start"]
    },
    {
      "id": "bug-fixes",
      "name": "Unofficial bug fixes",
      "repo": "neostryder/neo-angband-mod-bug-fixes",
      "tag": "v2.1.0",
      "version": "2.1.0",
      "enabled": false,
      "flags": {}
    }
  ],
  "options": {
    "birth": {
      "birth_point_based": true,
      "birth_no_selling": false
    },
    "game": {
      "values": {
        "rogue_like_commands": false,
        "auto_more": true,
        "show_damage": true
      },
      "hitpointWarn": 3,
      "delayFactor": 40,
      "lazymoveDelay": 0
    }
  }
}
```

Field notes:

- **`magic`** identifies the file's kind and is the gate on import, not the
  file extension - see "File extension" below. A file with the wrong or
  missing `magic` is refused before anything else is read, the same shape
  `readTransfer` already uses (`save-transfer.ts:142-145`).
- **`formatVersion`** is bumped only when an older reader would MISREAD a
  newer file (the same rule `TRANSFER_VERSION`'s own comment states,
  `save-transfer.ts:47`), not on every additive change. An importer reading a
  `formatVersion` it does not recognize degrades rather than refuses when the
  top-level shape is still parseable - see "Version mismatch" below; this
  mirrors gate 1 of `MOD_COMPATIBILITY.md` ("the engine labels, it does not
  forbid") applied to the Delve's own version number instead of a mod's.
- **`name`** and **`description`** are the human label, shown on the import
  preview screen and nowhere else authoritative.
- **`createdWithEngine`** is informational only, exactly like a mod's own
  `engine` range (decision 18: a label, never a gate). It never blocks an
  import; it lets the preview screen say "made on 0.20.0" the way a mod's row
  already says which builds it was tested against.
- **`mods`** is a list, in the order the exporting player had them - so an
  import that replaces the enabled set (see below) can also propose the same
  load order, though load order is itself only ever a proposal
  (`docs/modding/MOD_LIFECYCLE.md` section 3).
  - **`flags`** is a flat map of namespaced flag -> boolean, populated from
    exactly the choices `ModStore.getRuleChoices()` recorded for that mod's own
    flags - never the *resolved* value (`choice ?? rule.default`). Exporting
    the raw choice rather than the resolved one means an import against a
    different version of the same mod still resolves correctly against
    *that* version's defaults; nesting the flat map under each mod is a
    presentation choice for readability, not a change to the underlying
    storage shape, and an importer applying it makes exactly the same
    `ModStore.setRuleChoice(flag, value)` call the player would have made by
    hand, once per entry, regardless of which mod's block it was read from.
  - **`consents`** records which capabilities the EXPORTING install had
    approved. It is shown to the importing player as a preview
    ("this mod asks for: command:add, event:turn-start - approved on the
    machine this came from") and is never auto-granted; see "Consent is never
    inherited" below.
  - `sha` is optional and omitted when the exporting install never recorded
    one (the same "absent means unknown, not unpinned" rule
    `InstalledModMeta.sha`'s own doc comment states).
- **`options`** is entirely optional, and its two children (`birth`, `game`)
  are independently optional - a Delve can carry mods and no options opinion
  at all (the common case: sharing an overhaul without dictating anyone's
  playstyle), options and no mods (sharing just a birth/interface preset), or
  both. Absence of the whole block, or of either child, means exactly that:
  no opinion, not "off."
  - `options.birth` is a plain subset of the exporting character's frozen
    `birth_*` values (`OptionState.birth`) - whichever ones the exporter chose
    to include; nothing requires exporting all of them.
  - `options.game` mirrors `OptionStateData` minus its own `birth` field
    (`options.ts:69-80`): `values` restricted to `INTERFACE`-typed option
    names, plus `hitpointWarn`, `delayFactor`, `lazymoveDelay`.

### File extension

The suggested extension is **`.ndelve`**, mirroring `.neochar`
(`TRANSFER_EXT`, `save-transfer.ts:54`) - but the importer accepts any file
whose *content* starts with the right `magic`, `.json` included, because a
file downloaded from Discord or renamed by a chat client is exactly the case
this format has to survive. The gate is the content, never the name, the same
principle the zip importer already applies to a dropped-in mod folder
("Nothing deeper is looked at" - `docs/MODS.md`'s zip-import paragraph, in
spirit if not in that exact mechanism).

The file is deliberately **plain, pretty-printed JSON with no binary
payload** - no mod code, no archives, nothing but the table above - so that a
Delve for even a dozen mods is a few kilobytes of readable text: small enough
to paste directly into a Discord message inside a code block, or attach as a
file, without needing any Discord-side tooling. Building an actual exchange
channel or bot on the RPGM Tools Discord server is explicitly out of scope for
this document; the format's size and plain-text shape are chosen so that work,
if it happens later, has nothing to fight against.

## The UI: two new Mods-menu rows

Both live beside the existing action rows (`packages/web/src/mods.ts`, the
`addAction` calls that build `download`, `modupdates`, `folder`, `conflicts`,
`autosort`, `install`, `reload`), and get their own `ActionKind` entries and
fixed `MenuItem.tag`s the same way every row there already has one:

```
Save a Delve...      "Write your current mod set, flags, and (optionally) your
                       options to a file you can share."
Load a Delve...       "Read someone else's mod set, flags, and options from a
                       file or pasted text."
```

### Save a Delve...

A single screen, in the same overlay style the rest of the Mods manager's
own sub-screens already use:

1. A name field (`promptText`) and an optional description field.
2. A checklist of the player's currently **enabled** mods, pre-checked, each
   row showing name + version; unchecking one drops it from the export
   entirely (it will not appear in `mods` at all, not merely marked disabled -
   the same "off means absent" rule the mod system already applies to a
   disabled mod's own contributions).
3. Two more checkboxes, both **off** by default because options are the more
   personal-taste half of the file: "Include my general game options" and
   "Include my birth options." Checking the first
   captures `options.game`; the second, `options.birth`. Either, both, or
   neither.
4. **Save to file** (desktop: a native save dialog through the same
   `BACKUP_CHANNEL`-style bridge `docs/modding/CLOUD_BACKUP_DESIGN.md` already
   designed for writing outside the sandbox; browser tab: a plain download) and
   **Copy to clipboard**, the second existing specifically for the
   paste-into-Discord case - the file is short text, so a copy button costs
   nothing and skips a save dialog entirely for the person who only wants to
   paste it into a chat message.

### Load a Delve...

1. **From a file...** or **Paste text...** (a text-entry overlay, the same
   shape `promptText` already provides, sized for a multi-line paste).
2. Parse and check `magic`; refuse outright only when it is missing or names
   something else. A recognized `magic` with an unrecognized `formatVersion`
   still proceeds to the next step - see "Version mismatch" below.
3. **A preview screen**, one row per mod named in the file, each showing what
   would happen:

   | Row state | Meaning |
   |---|---|
   | already installed, same version | no fetch needed, only the enabled/flag state changes |
   | already installed, different version | shown as `installed vX -> delve wants vY`, with a per-row choice: update, or keep the installed version |
   | not installed, origin reachable | will be fetched from `repo` at the requested `tag`, or the newest release this build can actually run if that exact one no longer can - see below |
   | not installed, origin unreachable or the mod is gone | shown struck through with the reason, and skipped; every other row is unaffected |

   Every row can be unchecked to exclude that one mod from the import, the
   same as the export screen's checklist.
4. **A merge-or-replace choice**, asked once for the whole import: **Replace
   my mod set** (every mod not named in the file is disabled, matching the
   file exactly) or **Add to my current set** (only the named mods' enabled
   state and flags change; everything else the player already has is left
   alone). Defaulting to neither and asking is deliberate - "try my exact
   experience" and "just add this one overhaul to what I run" are both real
   requests from the motivating use case, and guessing wrong silently disables
   or leaves on mods the player did not ask about either way.
5. If the file carries an `options` block, one more pair of checkboxes,
   **both off by default** even though the file included them: "Also apply
   the general game options in this file" and "Also apply the birth options
   to my next new character." The second is explicitly about the *next*
   character created, never the one currently in play - birth options are
   locked at creation (`OptionState.set` returns `false` for a `BIRTH` name,
   `options.ts:179-184`) and nothing about importing a file changes that; the
   seeded values simply become what the birth screen opens on, exactly as
   `customized_birth_options.txt` already does today, and the player can still
   change any of them during that birth walk before confirming, the same as
   any other birth default.
6. Confirm applies the enabled set, flag choices (`setRuleChoice` per entry),
   and any accepted options, through the install path each new mod already
   uses (the same discovery/fetch/consent flow "Install a mod..." runs), then
   offers the same **Apply changes and reload** the rest of the manager
   already ends on.
7. **A result screen**, one line per mod, reusing the exact wording the
   install path already produces for the same outcomes rather than inventing
   new phrasing for the same concept - the same principle `ctx.installMod`'s
   `lines` field was added for (`docs/modding/PLUGINS.md`'s `ctx` table:
   "print it rather than writing a second vocabulary for one concept").

### Version mismatch: the same gates, the same degrade-not-refuse rule

A Delve's per-mod `tag`/`version` is a **preference**, not a pin the way a
player's own hand-typed `github.com/owner/repo/tree/<tag>` URL is
(`docs/MODS.md`'s "Add from a repository address" paragraph). The distinction
matters: a player who typed an exact tag is owed that exact tag or a clean
refusal, because they asked for it by name. A Delve's tag is somebody else's
hint about what worked for them, and this build should do its best rather than
fail on the letter of a file it did not write. Concretely:

- If the named `tag` still installs cleanly on this build (gate 1's `engine`
  range and gate 2's `modApi` window both accept it, `MOD_COMPATIBILITY.md`),
  it is used exactly as named.
- If it does not, the import walks that mod's own repository the same way
  `discoverMod`'s existing newest-runnable-release search already does for the
  **Install a mod...** and **Update installed mods** screens - newest first,
  bounded at `MAX_VERSIONS_TRIED`, same gates, same "no second opinion about
  what runnable means." The row says which version was actually used and that
  it differs from the one the file asked for.
- If nothing in that walk runs here, that one mod's row is skipped and named
  with the reason (needs a newer game, needs an older game, or the repository
  could not be reached), and every other mod in the file still imports. One
  unreachable mod must never fail the whole Delve, the same "a missing patch
  target costs the patch, not the mod" shape gate 3 already establishes for a
  single record inside one manifest, one level up.
- A `formatVersion` this build does not recognize is handled the same way: if
  the top-level shape still parses (a future version that only *added* fields,
  the same "additions strand nobody" rule `MOD_COMPATIBILITY.md` states for
  `ctx` fields), every field this build understands is applied and the ones it
  does not are reported and ignored. A `formatVersion` whose shape this build
  cannot parse at all is refused outright, with the file's own version number
  named in the refusal, exactly as an out-of-window `modApi` is named today.

### Consent is never inherited

A Delve's `consents` field is a **preview**, never a grant. Every mod the
import enables that requests a capability goes through the exact same
plain-language consent prompt a player installing it by hand would see
(`docs/MODS.md`'s trust model: "the UI surfaces what a plugin can touch before
enabling it"). What the field buys is context: the preview screen can say
"this mod asks for command:add and event:turn-start; the machine this Delve
came from had approved both" alongside the same prompt, so a player deciding
whether to trust it has more to go on than the bare capability string - but
they still press the same button themselves, on their own machine, every time.
Silently importing someone else's consent would hand a stranger's approval of
running code to a player who never saw the prompt, which is exactly the
boundary the capability model exists to keep a person at.

## What this inherits for free, and does not need to build

- **Determinism.** A Delve-driven enable goes through the same "enable a mod,
  apply changes and reload" path a manual toggle already does, so the
  determinism-mode ratchet (a save flips to NONDETERMINISTIC the first time a
  determinism-affecting mod is enabled on it, irreversibly - `docs/MODS.md`
  "Determinism (decision 22)") applies identically and needs no new logic
  here.
- **Attribution.** The character dump's `[Mods enabled]` block and the
  conflict pane already read off the same enabled/consent state this feature
  writes through the existing `ModStore` methods, so a mod a Delve turned on
  is attributed exactly as one turned on by hand would be.
- **Compatibility claims.** A mod's own `compat` declarations (`conflicts`,
  `prefer-mine`/`prefer-theirs`, `patches` - `manifest.ts:200-262`) are read at
  composition time from whatever ends up enabled, regardless of how it got
  enabled, so importing a Delve that happens to enable two mods with a
  declared conflict surfaces exactly the same warning enabling them by hand
  would, on the conflict pane the player already knows to check.

## Where this would live

Consistent with the rest of the manager: nothing here belongs in
`packages/core`. This is host/install-manager tooling, exactly like
`mod-store.ts`, `mod-install.ts`, and `mods.ts` already are, so a new
`packages/web/src/mod-delve.ts` (encode/decode, the merge-or-replace
resolution, the version-mismatch walk reusing `mod-discover.ts`'s existing
search rather than a second copy of it) is the natural home, with the two menu
rows and their screens added to `mods.ts`, and the save/load file plumbing
reusing the same per-platform pattern `CLOUD_BACKUP_DESIGN.md` already worked
out for writing outside the browser sandbox on desktop.

## Open questions this document deliberately leaves open

- Whether **Save a Delve...** should offer excluding individual flags within
  a mod, not just excluding whole mods - the export screen above only offers
  per-mod granularity. Left for whoever builds this to decide against real
  usage, since a per-flag checklist multiplies the screen's length by every
  mod's rule count.
- Whether a later revision should let a player/testing profile (neo-angband#163)
  be created directly from an imported Delve (taking only the mod/flag portion,
  silently dropping any `options` block) so the two features are not entirely
  separate paths. Not needed for a first cut, and deliberately not decided
  here.
