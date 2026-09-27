# Shareable mod-set snapshots: exporting and importing a "Delve"

Built in #87. The Delve format is in `packages/web/src/mod-delve.ts`, and the two Mods-menu rows, the version-mismatch handling, the merge-or-replace choice and the consent preview are part of the game's own mod manager (`packages/web/src/mods.ts` and its supporting modules `mod-store.ts`, `mod-install.ts` and `mod-discover.ts`), not of any individual mod. The manager sits in core because core includes the mod architecture itself (`docs/MODS.md#what-is-core-and-what-is-a-mod`). Every field below comes from state the manager already tracks, and the version-mismatch and consent rules reuse the mechanisms described in `MOD_COMPATIBILITY.md` and `MODS.md` without adding stricter ones.

The implementation differs from the design below in three places:

- **Flag choices come from two stores.** `ModStore.getRuleChoices()` alone does not cover both `PackRule.flag` and `PackSection.flag`, as the field notes below assume: `mod-store.ts` keeps rule choices and section choices in two separate stores. Export and import read and route both, per mod (`delveExportFlags`/`applyDelveFlags` in `mods.ts`), rather than pooling one flat read regardless of which mod a flag belongs to.
- **The three option scalars** (`hitpointWarn`, `delayFactor`, `lazymoveDelay`) have no saved custom defaults the way the boolean option groups do (`options-file.ts` only carries a name->boolean map), and the mod manager has no live `GameState` to read, since it also opens from the title screen. They round-trip in the file, but export always writes the table defaults and import does not apply them anywhere. This is a known gap.
- **"Save to file"** uses the same `downloadUserFile` mechanism `exportCharacter` uses on both platforms, not a new native save-dialog bridge. `CLOUD_BACKUP_DESIGN.md`'s `BACKUP_CHANNEL` was built for one file kind (cloud-backup writes), and a general "Save As" belongs to the shared `host-folder.ts` primitive that #158 builds.
## The gap this closes

Without a Delve, getting your mod set onto a second machine or into someone else's hands means redoing every step from memory: open **Install a mod...**, remember which of the recommended mods you run, install each one, open every mod's **Fixes & tweaks** screen and flip every toggle back, and describe your birth choices and options in words if you want someone to match them. Nothing else captures a setup exactly and hands it to another install or another person.

A narrower feature used to exist. `ModStore.saveProfile` / `applyProfile` saved the current enabled set and capability consents under a name so a player could switch back later, shown as **Profiles...** in the Mods menu. It never left the browser, and it carried no mod versions, no rule or section flag choices and no options. It was removed in neo-angband#163 once player/testing profiles made it redundant: each player/testing profile carries its own enabled set and consents, so switching mod loadouts now means switching profiles. This feature (still unbuilt) does not take over that local job, which #163's profiles already cover. It goes further in another direction: a real file, or a block of text short enough to paste into a Discord message, that is versioned, carries each mod's version, origin and flag choices, can separately and optionally carry the birth and general game options a character was using, and can leave the browser entirely.
## What the manager can capture

Every field below is something the manager already tracks.

**Per installed mod** (`packages/web/src/mod-install.ts:71-137`, `InstalledModMeta`, plus the manifest the mod itself shipped, `packages/mod-sdk/src/manifest.ts:378-522`, `PackManifest`):

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

**Options** (`packages/core/src/player/options.ts`, `OptionState`) come in the two groups upstream already treats separately, and a Delve keeps that split:

- `birth`: the frozen `birth_*` snapshot (`OptionState.birth`, `options.ts:129-154`), chosen once at character creation and then locked. Upstream restores this group from `customized_birth_options.txt` (`packages/core/src/player/options-file.ts:1-53`) at the start of birth, before any choice is made, so an import can only seed the next character's birth screen and never rewrites a character who is already born.
- `game`: the `INTERFACE`-typed options (`OPTION_ENTRIES` entries with `type: "INTERFACE"`, `packages/core/src/generated/options.ts`) plus the three scalars `hitpointWarn`, `delayFactor` and `lazymoveDelay`. Upstream persists exactly this group, separately, as `customized_interface_options.txt` and restores it on every new character.

`CHEAT` and `SCORE` options are left out of both groups. Upstream's own `options_init_defaults` (`option.c:148-164`) never restores them from a custom-defaults file either, because they are not birth or interface pages, and a file meant for sharing should not carry anyone's cheat toggles.

Nothing else can be captured, because nothing else exists as named, resolvable state at this level. A mod's own private save bag (`ModPlugin.migrateBag`, `docs/modding/PLUGINS.md#your-own-saved-data-and-changing-its-shape`) belongs to one character's save, not to the install-level configuration a Delve snapshots, and it stays out for the same reason `ModProfile` left it alone.
## Naming

The feature is not called a "profile" because player/testing profiles (neo-angband#163) already use that word for a local feature: separate settings, mod loadout and saves within one install. Reusing it for a portable, shareable file would give two unrelated features the same name in the same menu, which is the collision the removed `ModProfile` mechanism avoided by being the only feature with that name.

The name also stays clear of every term the codebase already uses: `pack`/`PackManifest` for one mod, `bag` for a mod's private save data, `manifest` for the per-mod JSON file, `profile` for player/testing profiles, `Grimoire` and `rune` for real upstream content (Kelek's Grimoire of Power is an actual artifact spellbook, and runes are a real 4.2 mechanic), and `Vault`/`Tome`/`Scroll`/`Quill`/`Atlas`/`Herald`/`Sceptre`/`Forge`, which are RPGM Tools' own other product and mod names.
The feature is called a **Delve**. It is familiar dungeon-crawl vocabulary, so nobody has to learn a new word, but it is not an actual Angband or roguelike mechanic, so it cannot be mistaken for upstream content the way Grimoire or rune could. It reads naturally everywhere the feature appears: a menu row ("Save a Delve...", "Load a Delve..."), a file name (`ironman-race.ndelve`), and a Discord message ("here's my Delve for the Borg race channel"). The rest of this document uses **Delve**, and nothing in the format or the mechanisms depends on the word.
## The file format

A Delve is one JSON object. `formatVersion` is separate from the engine version and from every mod's version, because the format will change on its own schedule (new option groups, new mod fields). `TRANSFER_VERSION` is kept separate for the same reason in `.neochar` character-transfer files (`packages/web/src/save-transfer.ts:47-51`), and a Delve uses that same `magic` + `version` shape instead of a third way of saying what kind of file this is and which revision of its shape it uses.

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

- **`magic`** identifies the kind of file and is what import checks, not the file extension (see "File extension" below). A file with a wrong or missing `magic` is refused before anything else is read, the same way `readTransfer` works (`save-transfer.ts:142-145`).
- **`formatVersion`** goes up only when an older reader would misread a newer file (the rule `TRANSFER_VERSION`'s own comment states, `save-transfer.ts:47`), not on every additive change. An importer that meets a `formatVersion` it does not recognize still imports what it can, as long as the top-level shape parses (see "Version mismatch" below). This is gate 1 of `MOD_COMPATIBILITY.md` ("the engine labels, it does not forbid") applied to the Delve's own version number instead of a mod's.
- **`name`** and **`description`** are the human-readable label. They appear on the import preview screen and are not relied on anywhere else.
- **`createdWithEngine`** is informational only, like a mod's own `engine` range, which is a label and never a gate. It never blocks an import; it lets the preview screen say "made on 0.20.0" the way a mod's row says which builds it was tested against.
- **`mods`** is a list in the exporting player's order, so an import that replaces the enabled set (see below) can also propose the same load order, although load order is only ever a proposal (`docs/modding/MOD_LIFECYCLE.md` section 3).
  - **`flags`** is a flat map of namespaced flag -> boolean, holding exactly the choices `ModStore.getRuleChoices()` recorded for that mod's own flags, never the resolved value (`choice ?? rule.default`). Because the raw choice is exported, an import against a different version of the same mod resolves against that version's defaults. The map is nested under each mod only for readability and does not change the storage shape: an importer makes the same `ModStore.setRuleChoice(flag, value)` call the player would make by hand, once per entry, whichever mod's block it came from.
  - **`consents`** records which capabilities the exporting install approved. The importing player sees it as a preview ("this mod asks for: command:add, event:turn-start - approved on the machine this came from"), and it is never granted automatically; see "Consent is never inherited" below.
  - `sha` is optional and left out when the exporting install never recorded one (absent means unknown, not unpinned, as `InstalledModMeta.sha`'s own doc comment says).
- **`options`** is optional, and so is each of its two children (`birth`, `game`). A Delve can carry mods with no options at all (the common case: sharing an overhaul without dictating anyone's playstyle), options with no mods (a birth or interface preset), or both. A missing block or child means no opinion, not "off".
  - `options.birth` is any subset of the exporting character's frozen `birth_*` values (`OptionState.birth`); the exporter chooses which to include, and nothing requires all of them.
  - `options.game` mirrors `OptionStateData` minus its own `birth` field (`options.ts:69-80`): `values` limited to `INTERFACE`-typed option names, plus `hitpointWarn`, `delayFactor` and `lazymoveDelay`.
### File extension

The suggested extension is **`.ndelve`**, after `.neochar` (`TRANSFER_EXT`, `save-transfer.ts:54`), but the importer accepts any file whose content starts with the right `magic`, `.json` included, because files downloaded from Discord or renamed by a chat client have to work. Import checks the content and never the name, the same principle the zip importer applies to a dropped-in mod folder ("Nothing deeper is looked at", from `docs/MODS.md`'s zip-import paragraph), even though the mechanism there is different.

The file is plain, pretty-printed JSON with no binary payload: no mod code, no archives, only the fields above. A Delve for a dozen mods is a few kilobytes of readable text, small enough to paste into a Discord message inside a code block or attach as a file with no Discord-side tooling. An exchange channel or bot on the RPGM Tools Discord server is out of scope here, and the small plain-text format leaves nothing in the way if one is built later.
## The UI: two new Mods-menu rows

Both rows sit beside the existing action rows in `packages/web/src/mods.ts` (the `addAction` calls that build `download`, `modupdates`, `folder`, `conflicts`, `autosort`, `install`, `reload`), each with its own `ActionKind` entry and fixed `MenuItem.tag` like every other row there:

```
Save a Delve...      "Write your current mod set, flags, and (optionally) your
                       options to a file you can share."
Load a Delve...       "Read someone else's mod set, flags, and options from a
                       file or pasted text."
```
### Save a Delve...

One screen, in the same overlay style as the Mods manager's other sub-screens:

1. A name field (`promptText`) and an optional description field.
2. A checklist of your currently **enabled** mods, all checked, each row showing name and version. Unchecking a mod leaves it out of the export entirely: it does not appear in `mods` at all rather than appearing as disabled, the same "off means absent" rule the mod system applies to a disabled mod's own contributions.
3. Two more checkboxes, both **off** by default because options are the more personal half of the file: "Include my general game options", which captures `options.game`, and "Include my birth options", which captures `options.birth`. You can tick either, both or neither.
4. **Save to file** (desktop: a native save dialog through the same `BACKUP_CHANNEL`-style bridge `docs/modding/CLOUD_BACKUP_DESIGN.md` designed for writing outside the sandbox; browser tab: a plain download) and **Copy to clipboard**, which is there for pasting into Discord. The file is short text, so a copy button costs nothing and skips the save dialog for anyone who only wants to paste it into a chat message.
### Load a Delve...

1. **From a file...** or **Paste text...** (a text-entry overlay of the same kind `promptText` provides, sized for a multi-line paste).
2. The file is parsed and its `magic` checked. It is refused outright only when `magic` is missing or names something else. A recognized `magic` with an unrecognized `formatVersion` still goes on to the next step; see "Version mismatch" below.
3. **A preview screen** with one row per mod named in the file, each showing what would happen:

   | Row state | Meaning |
   |---|---|
   | already installed, same version | no fetch needed, only the enabled/flag state changes |
   | already installed, different version | shown as `installed vX -> delve wants vY`, with a per-row choice: update, or keep the installed version |
   | not installed, origin reachable | will be fetched from `repo` at the requested `tag`, or the newest release this build can actually run if that exact one no longer can - see below |
   | not installed, origin unreachable or the mod is gone | shown struck through with the reason, and skipped; every other row is unaffected |

   Any row can be unchecked to leave that one mod out of the import, as on the export screen's checklist.
4. **A merge-or-replace choice**, asked once for the whole import: **Replace my mod set** (every mod not named in the file is disabled, so your set matches the file exactly) or **Add to my current set** (only the named mods' enabled state and flags change, and everything else you have stays as it was). Neither is preselected. "Try my exact experience" and "just add this one overhaul to what I run" are both common requests, and a wrong guess would silently disable mods, or leave them on, without asking you.
5. If the file has an `options` block, two more checkboxes appear, **both off by default** even though the file includes them: "Also apply the general game options in this file" and "Also apply the birth options to my next new character." The second applies only to the next character you create, never the one in play. Birth options are locked at creation (`OptionState.set` returns `false` for a `BIRTH` name, `options.ts:179-184`), and importing a file does not change that. The imported values become what the birth screen opens with, just as `customized_birth_options.txt` does, and you can still change any of them during birth before confirming, like any other birth default.
6. Confirming applies the enabled set, the flag choices (`setRuleChoice` per entry) and any accepted options, installing new mods through the same discovery, fetch and consent flow **Install a mod...** runs, then offers the same **Apply changes and reload** the rest of the manager ends with.
7. **A result screen** with one line per mod, using the wording the install path already produces for the same outcomes. This is the same principle behind `ctx.installMod`'s `lines` field (`docs/modding/PLUGINS.md`'s `ctx` table: "print it rather than writing a second vocabulary for one concept").
### Version mismatch: the same gates, the same degrade-not-refuse rule

A Delve's per-mod `tag`/`version` is a preference. It is not a pin the way a hand-typed `github.com/owner/repo/tree/<tag>` URL is (`docs/MODS.md`'s "Add from a repository address" paragraph). If you type an exact tag, you get that tag or a clean refusal, because you asked for it by name. A Delve's tag is someone else's note about what worked for them, so the game does its best with it rather than failing on the exact wording of a file you did not write:

- If the named `tag` still installs cleanly on this build (gate 1's `engine` range and gate 2's `modApi` window both accept it, see `MOD_COMPATIBILITY.md`), it is used as named.
- If it does not, the import searches that mod's own repository the same way `discoverMod` already does for the **Install a mod...** and **Update installed mods** screens: newest release first, up to `MAX_VERSIONS_TRIED`, with the same gates and the same definition of runnable. The row shows which version was used and that it differs from the one the file asked for.
- If nothing in that search runs on this build, that mod's row is skipped with the reason (needs a newer game, needs an older game, or the repository could not be reached), and every other mod in the file still imports. One unavailable mod never fails the whole Delve, just as gate 3, one level down, lets a missing patch target cost only that patch and not the mod.
- An unrecognized `formatVersion` is handled the same way. If the top-level shape still parses (a newer version that only added fields, following the "additions strand nobody" rule `MOD_COMPATIBILITY.md` states for `ctx` fields), every field this build understands is applied and the rest are reported and ignored. If the shape cannot be parsed at all, the file is refused, and the refusal names the file's version number, as an out-of-window `modApi` is named today.
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

- **Determinism.** A Delve enables mods through the same "enable a mod, apply changes and reload" path as a manual toggle, so the determinism ratchet applies unchanged with no new logic: a save flips to NONDETERMINISTIC, irreversibly, the first time a determinism-affecting mod is enabled on it (`docs/MODS.md`, "Determinism (decision 22)").
- **Attribution.** The character dump's `[Mods enabled]` block and the conflict pane read the same enabled and consent state that a Delve writes through the existing `ModStore` methods, so a mod a Delve turned on is attributed exactly like one turned on by hand.
- **Compatibility claims.** A mod's own `compat` declarations (`conflicts`, `prefer-mine`/`prefer-theirs`, `patches`; `manifest.ts:200-262`) are read at composition time from whatever ends up enabled, however it got enabled. A Delve that enables two mods with a declared conflict produces the same warning as enabling them by hand, on the conflict pane you already check.
## Where this would live

None of this belongs in `packages/core`. Like the rest of the manager, it is host and install-manager tooling in the same class as `mod-store.ts`, `mod-install.ts` and `mods.ts`, so its home is a new `packages/web/src/mod-delve.ts`: encoding and decoding, merge-or-replace resolution, and the version-mismatch search, which reuses `mod-discover.ts`'s existing search instead of copying it. The two menu rows and their screens go in `mods.ts`, and the file save and load plumbing reuses the per-platform pattern `CLOUD_BACKUP_DESIGN.md` worked out for writing outside the browser sandbox on desktop.
## Open questions

- Whether **Save a Delve...** should let you exclude individual flags within a mod, not only whole mods. The export screen above works per mod, and a per-flag checklist would lengthen the screen by every mod's rule count, so this waits on real usage.
- Whether a player/testing profile (neo-angband#163) could later be created directly from an imported Delve, taking only the mod and flag portion and dropping any `options` block, so the two features are not entirely separate paths. A first version does not need it.
