# Changelog

All notable changes to Neo Angband are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims
to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

As of 1.0.0, Neo Angband follows standard Semantic Versioning: a breaking
change to the API, save format, or mod interfaces is a MAJOR bump, a
backward-compatible feature is MINOR, and a fix is PATCH. This file is
maintained going forward - each notable change lands in the Unreleased
section and moves under a version heading when that version is cut.

**Only work that has SHIPPED appears here.** An entry is written when the code is
in the tree, never in advance of it: to a reader who did not write it, a
changelog describing intentions is indistinguishable from one describing
features, and they go looking for the feature. Work that is planned but not yet
implemented lives in [docs/PLANNED.md](docs/PLANNED.md).

An entry also has to matter to somebody playing the game or writing a mod.
Documentation wording, internal refactoring and test-only additions are not
recorded here. Bug fixes are, however small.

**A bug or a difference somebody outside the project reported gets their name
on the fix.** "Reported by `<name>`" closes the entry, with the name exactly as
they gave it in public (a GitHub issue author, a named commenter in a public
thread) - never a real name learned any other way, and never for a private
conversation. A fix nobody outside reported carries no such line.

Starting with this entry, an entry opens with one or more bracketed tags.
`[Visible]` marks a change a player would notice in the game or mod itself;
`[Internal]` marks one that touches only code, tooling, or a maintainer's own
workflow, with nothing for a player to see. A further tag (`[Security]`,
`[Balance]`, `[UI]`, `[Modding-API]`, `[Localization]`, `[Save-Compat]`,
`[Docs]`, `[Content]`, `[Compatibility]`, and others as they come up) names
what kind of change it is. Lists appear in this order and each is omitted
when empty for a release: Added, Changed, Removed, Fixed. Earlier entries
were not retagged.

`0.x` was the pre-release line, where every feature release bumped the MINOR
number instead (`0.9.0` was followed by `0.10.0` rather than `1.0.0`) and
`1.0.0` was reserved for this, the public release. The first-party mods
followed the same scheme, reaching `1.0.0` with the game - and a mod whose
released tag needs to be superseded takes whatever bump its actual change
warrants, because a published tag must never be moved: the game records the
commit a tag resolved to when the mod was installed, and a tag that has
since been retargeted is reported as moved rather than as the version it
still calls itself.

## [1.8.0] - 2026-09-04

### Added

- [Internal] [Modding-API] **Added API-2's generic Worker transport caches and messages.** Workers can now read allow-listed versioned snapshots, receive invalidations, install host-evaluated policies, answer serial asynchronous hook decisions, declare host-owned commands, and push cached text regions. This is ABI plumbing only; no shipped mod has moved to API-2 yet.

- [Internal] [Modding-API] **Mods can observe newly gained spells and known item activations, then create an unused keymap through a consented host facade.** `ModHooks.abilityGained` reports the committed ability, while `keymap:write` exposes `ctx.keymaps` backed by the live keymap store and its normal preference save path (#167).

- [Visible] [Modding-API] **Mods can apply a consented post-processing visual filter to the terminal canvas.** The new `display:filter` capability exposes `ctx.display.setVisualFilter(filter)`, which affects the final ASCII or tile frame and every terminal-grid screen without changing the game's named color palette (#166).

- [Internal] [Modding-API] **Added the opt-in API-2 Worker plugin ABI.** A manifest can select `modApi: 2`, `runtime: "worker"`, and a `workerEntry`; Neo Angband then starts that entry through a host-owned Dedicated Worker bootstrap with a versioned, validated structured-clone protocol. API-1 `plugin.js` remains explicitly trusted in-process code (#155).

- [Internal] [Modding-API] **Completed API-2's reactive model and host-owned panel protocols.** Subscribed Worker plugins now receive cloned state and display snapshots after changed rendered frames, and the `ui:panel` capability now renders a small host-owned text/button/layout panel grammar rather than forwarding a placeholder UI intent (#155).

- [Visible] [Docs] **Added the `neo-angband-bin` AUR package definition.** It
  installs the released x86_64 AppImage with an Arch launcher, desktop entry and
  icon, and documents both local `makepkg` installation and the one-time AUR
  submission still required from an account (#130).

- [Internal] [Modding-API] **Mods can add runnable rows to the Escape Game menu.** A plugin that declares `registry:menu` can call `host.menus.addAction("core:game-menu", action, label, handler)`; the host namespaces the action to that mod and invokes only its callback when selected. This closes the menu-callback seam needed by save-backup UI without making a new row accidentally select a core command (#96).

- [Visible] [UI] **Accepting a game update can now include every installed mod with a newer compatible tag.** The Update screen asks whether to carry those pinned mod updates too; a failed mod is named before the game update continues, with the Mods screen left as its retry door (#111).

- [Visible] [Docs] **Added a beginner walkthrough and tested finished mod for making a custom town shop.** It uses Neo Angband's content and store-behaviour seams instead of upstream source-file edits (#148).

- [Visible] [UI] **Linoleum tile-pack conversion now shows a rotating terminal-HUD glyph and messages when it starts and finishes.** First-time atlas conversion continues in the background while the game remains responsive (#124).

- [Visible] [UI] **The title screen's footer is now a short project description, a Docs/GitHub/Releases/Discord link block, and a thank-you line, replacing the Morgoth quote, the Website/Forums lines, and both credit lines.** The four links are real clickable/tappable spans using the same mechanism issue #59 established, not just printed URLs (#168).

- Deleting a profile now asks whether to keep its living characters first;
  kept ones go into a small holding pool and can be reclaimed into any
  profile afterward from a new `Reclaim saves...` row on the Profile screen
  (#163).

### Changed

- [Visible] [UI] **Recommended mods now open directly from the Mods screen, and selecting an uninstalled mod offers one explicit "Install and enable" action instead of asking the same enable question again after downloading.** The successful-install screen now goes straight to the existing reload choice instead of requiring backtracking through the source and mod menus. The mod's detail pane remains visible before that decision; capability consent, mod-conflict, and non-scoring-game warnings still stop the flow before anything runs. Other install sources remain available from the recommended list (#103).

- [Visible] [UI] **The Discord invite, the GitHub issues address, and the support email printed on the Help, Report-a-problem, mid-turn-fault, and crash screens are now real links.** A tap, click, or the existing key (`G`/`1`/`C` on the report screen, or a click on the community page) opens the address in a browser tab or, for the support address, a `mailto:` compose window; the email's displayed text stays the obfuscated "strider-angband (at) rpgm.tools" form. Link text is coloured with the terminal's own "-more-" cyan rather than an invented hyperlink blue, and the crash screen (a DOM overlay, not the terminal) draws real `<a>` anchors in the same colour (#59).

### Fixed

- The title screen's `(P)rofile` rollout (#163) renamed New/Open/Install but
  missed the fourth row: `(L)oad last save` is now `(R)esume` (key `r`), as
  the issue originally scoped.

- [Internal] [Docs] **The modding docs still described Borg activation through a "Let the Borg play" settings-screen toggle.** The Borg mod dropped that toggle in favor of Ctrl-Z-only activation some time ago; the host-side code already reflected it, but `docs/modding/BORG.md` and a few code comments did not (#133).

## [1.3.0] - 2026-08-29

### Added

- Player/testing profiles: a new `(P)rofile` row, first on the title screen,
  opens a screen to create, rename, delete, and switch between named
  profiles. Each profile keeps its own options, mod loadout, and save
  roster within the one install; only the Hall of Fame scores are shared
  across all of them. The starting profile needs no setup - it is the
  default until a second one is created, at which point creating it offers
  to name the original and to start the new one from the current profile's
  settings or from a full reset. Switching profiles reloads the game
  (#163).

### Removed

- The Mods menu's `Profiles...` row, which let a player save the currently
  enabled mod set and capability consents under a name and switch back to
  it - superseded by player/testing profiles above, which carry an
  independent mod loadout per profile (#163).

## [1.2.1] - 2026-08-29

### Fixed

- A menu's cursor reset to the first row whenever a submenu closed, instead of
  staying on the row you opened it from - `manageMod` (a mod's own Disable /
  Move / Read description actions), the top-level Mod options browser, and the
  Options Menu (`=`) all rebuilt their menu on every pass without threading a
  cursor through it, unlike `manageModOptions`, which already did (#159). Fixed
  the same way that screen already was, and while doing so found the pattern
  itself was incomplete: `selectFromMenu`'s cursor tracking only followed
  arrow-key navigation, not a tag letter, a jump key or a tap - so a caller
  that reported its cursor to reopen a menu in the right place could still be
  wrong if the row was reached any other way. Every caller using this pattern
  benefits, not just the three fixed here.
- The birth-options-style yes/no toggle screens (Birth options, Interface
  options, Cheat options) treated their two horizontal arrows asymmetrically:
  ArrowRight toggled the highlighted row, ArrowLeft exited the whole screen
  outright. Both now toggle in place, matching t/T/Enter; only Escape leaves
  (#161).
- Escape on those same screens left silently even when a setting had changed
  and "(s)ave" was never pressed. Where the screen has a save action at all
  (Interface options and the at-birth Birth options editor - the only two
  upstream ever gives one), Escape now asks "Save changes before leaving?"
  first if anything changed since the screen opened or was last saved (#161).

## [1.2.0] - 2026-08-29

### Added

- A `patches`-scoped section's resolved flag now also reaches the mod it
  patches, not only its own mod (neo-angband#32). A `compat: [{claim:
  "patches", with: X, scope}]` claim already meant "this section only makes
  sense when X is present" - handing its resolved value to X's own ctx.flags
  is the same declaration read one step further, not a new one, and it stays
  narrow: only a flag a `patches` claim already names, never a whole mod's
  flags wholesale. The Bug Fixes mod's new "Borg Fixes" section is the first
  user of this - a toggle that lives in Bug Fixes' own menu but gates code in
  the Borg mod.

### Fixed

- A mod id retired by `RENAMED_MOD_IDS` (mod-store.ts) stayed installed forever
  once its successor was also installed: the settings migration already moved
  the player's enabled choice and rule choices to the new id, but nothing
  removed the old id's own installed files, so Mod options kept a permanent,
  greyed-out, unusable row for it. `installedMods()` now removes an old id's
  install the moment its successor is also found installed (#153).
- The autoplayer decline message (Ctrl-Z, "not now") still told the player to
  turn its autoplay rule back off from Mods - a setting that no longer exists
  now that activation is Ctrl-Z-only. It now describes what actually happens:
  the player is asked again next time (#133).
- The README glossed ToME as "Troubles of Middle-Earth" instead of its real
  name, Tales of Middle-earth.
- The game's combat text, status messages and yes/no prompts were still
  written as hardcoded English in the web front end's main module, so a
  mod-supplied locale could not reach any of them: every melee hit, miss,
  crit and kill line, the targeting and item-picker status messages, the
  spell, study and browse refusals, the save, retire, quit and death
  confirmations, the screen-dump and pref-command reports, and the borg and
  autoplayer notices. All of it now routes through `t()`, with variable text
  carried as named placeholders so a translation can put the count, the
  monster or the verb where its own grammar needs it. The bundled
  `demo-resources` mod's `en-XA` pseudo-locale catalog grew to match, and
  also picked up the entries the mods, mod-browse and options screens had
  been missing since they were routed (neostryder/neo-angband#95).

## [1.1.2] - 2026-08-27

Current state of the project at version `1.8.0` - a fixes release. No player
action is needed for the Linoleum id change below; an existing install
carries its enabled choice and rule choices across automatically.

### Changed

- The Linoleum mod's id is `linoleum`, not `neo-linoleum` - it moves back the
  other way from the 2026-07-31 rename now that the id no longer leaks into
  what a player sees. An existing install carries its enabled choice and
  rule choices across automatically.

### Fixed

- `@rpgm-tools/neo-angband-mod-sdk` stopped regenerating its packaged docs from
  `docs/modding/` before every publish - a version-bump revert dropped the
  `prepack` wiring along with the version number it meant to undo, so the
  1.0.1 and 1.1.1 packages both shipped whatever was sitting in `docs/` at
  commit time rather than the current source. The gap was real: `MOD_SEAMS.md`
  had gone stale since, missing the 1.1.0 `ctx.display` seam entirely. Wiring
  restored; `docs/` is generated fresh on every `npm pack`/`publish` again.

## [1.1.1] - 2026-08-27

Current state of the project at version `1.1.1` - a fixes release. Nothing
new for a player; two corrections for anyone reading the Mod options screen
or writing a mod against the SDK.

### Fixed

- `@rpgm-tools/neo-angband-mod-sdk`'s published package never actually shipped
  its `docs/` directory - the manifest's `files` list named `dist`, `src` and
  `bin` but not `docs`, so every consumer of the real published package (as
  opposed to a local, unbuilt checkout) was missing the mod-authoring
  documentation the 1.1.0 changelog entry below describes. `files` now
  includes `docs`.
- The Mod options screen no longer labels each row "Fix:" or "Part:" - an
  internal distinction (a behavioural rule versus a content section) that
  meant nothing to a player reading the row. The detail panel already
  explains that distinction in a full sentence when it matters.

## [1.1.0] - 2026-08-27

Current state of the project at version `1.1.0` - mods can now reach the
sidebar and play grid's own display geometry, and mod settings are easier to
navigate.

### Added

- A display-geometry seam for mods: `ctx.display.snapshot()` and a runtime
  grid/camera/map-view/sidebar/tile-scaling control surface
  (`GlyphTerm.setReflow`, `setGrid`, `setCamera`, `setMapView`,
  `setSidebarExtent`, `setTileScaling`, `repaint`), plus a capture-phase key
  subscription mods can use for their own display controls. Deliberately
  policy-free: no zoom steps, no persistence, no gesture handling, and no UI -
  a mod builds those on top, the same "necessary in core, nice is a mod" split
  every other seam in this project follows. Automatic camera re-clamping after
  a resize is included, so a mod does not have to re-derive it.
- The standard Options (`=`) menu gained a **Mod options** entry: an "All
  mods" flat list of every installed mod's settings, plus one entry per mod.
  The recommended-mods flow gained a single bulk action (enable/update all
  recommended mods, with an explicit follow-up choice about turning their
  options on too) instead of working through each mod by hand, and capability
  approvals for a batch now happen on one screen.
- `@rpgm-tools/neo-angband-mod-sdk` now packages the real mod-authoring
  documentation, including the beginner tutorials and API references, under
  `docs/`. The package generates that copy from `docs/modding/` when it builds
  or packs, so the repository documentation remains the single source of truth.

### Changed

- The Mods screen's "Fixes & tweaks" and "Parts of this mod" are merged into
  one "Mod options" entry, matching the new `=` menu entry above.

### Fixed

- The "Update installed mods" screen showed a mod's internal codename instead
  of its real display name (neo-angband#132).
- A character that had ever handed the keyboard to an autoplayer mod (even
  once, even long ago) no longer silently resumes under its control on every
  later, unrelated boot. The warn-and-confirm prompt now runs every time,
  except on the one reload that immediately follows an explicit "yes"
  (neo-angband#138).

## [1.0.0] - 2026-08-26

### Added

- Two new `ModHooks` extension points for the bug-fixes mod: `partialStackMerge`,
  a veto on combinePack's uneven-stack merge (the point a mod can refuse to
  drain an already-full source stack into a smaller one, neostryder/neo-angband#115),
  and `packOverflowVictim`, a decision hook that lets a mod redirect
  pack_overflow's NULL-victim shed to the item that actually displaced out of
  the quiver rather than the last inventory slot (neostryder/neo-angband#116).
  With no hook installed, both call sites are byte-identical to 4.2.6.
- `checkRecords` now emits an advisory `field/vocabulary` hint when a
  record's value falls outside the closed set `RECORD_BLUEPRINTS` measures
  for that field - the same measurement the workshop's record-screen
  dropdown and file editor already read independently of each other. The two
  consumers now share one answer instead of each deciding on its own
  (neostryder/neo-angband#48).
- Agent API 1.4.0: `PlayerStatusView` now exposes thirteen buff timers
  (fast, sprint, protection from evil, hero, berserker strength, mystic
  shield, stoneskin, blessed, fastcast, and the five temporary elemental
  resists) alongside the eight negative afflictions it already carried,
  the same read-only, add-only way. Unblocks a mod-side buff cross-check
  against real engine state instead of the mod's own message-based
  bookkeeping (neostryder/neo-angband#121).
- The desktop build now bundles README.md and the other root policy/legal
  docs (CHANGELOG, LICENSE, TERMS, PRIVACY, SECURITY, CODE_OF_CONDUCT,
  CONTRIBUTING, AI_USAGE_POLICY) at the install folder's own root, beside
  the executable - they were never copied there before.

### Changed

- The browser tab icon, PWA install icon, and iOS home-screen icon are now
  the actual app icon (the same mascot artwork the desktop build ships)
  instead of a placeholder green "@" glyph. The web app's `index.html` also
  gained explicit favicon `<link>` tags, which it never had before.
- The portable data folder beside the executable is named `data` instead
  of `neo-angband-data`. Only a fresh install or a fresh portable data
  folder gets the new name; an existing `neo-angband-data` folder is found
  and used in place, exactly as before, both at startup and across an
  in-place update - nothing migrates and no save is moved, and neither
  name is ever deleted out from under an install that has it.

### Fixed

- A message longer than the display line took up a whole page of its own;
  upstream splits it at the rightmost space and recurses on the rest
  instead. The pager now does the same (neostryder/neo-angband#7).
- Selecting a Linoleum tile pack that had never been converted before blocked
  the whole game until the entire source atlas finished slicing into loose
  files - long enough on a large pack (Shockbolt) to look identical to a
  hang. The game now hands control back immediately and shows a banner
  naming what is converting; the tileset applies once it finishes. Streaming
  individual tiles in as they convert, instead of applying the whole pack at
  once at the end, remains open (neostryder/neo-angband#124).
- The birth point-buy stat allocation screen never showed the gold-rectangle
  cursor upstream draws just after the current stat's cost (ui-birth.c:1135),
  because that screen is hand-rolled rather than built on the shared menu
  widget every other cursor-driven screen in the game already gets it from.
  Up/down now moves a real cursor there like everywhere else
  (neostryder/neo-angband#60).
- `menuNav`, the one navigation helper every overlay and menu screen shares,
  never recognized h/j/k/l, even with the roguelike keyset selected - a
  game-wide gap, not limited to the birth screen where it was first
  reported. It now takes a `roguelike` parameter and resolves h/j/k/l
  through the same direction mapping arrows and numpad already use.
  Reported by Nate (neostryder/neo-angband#127).
- The store's item context menu (Examine/Buy/Buy One) printed its labels
  directly over the live stock list with no backdrop, so the stock row's own
  text bled through around and behind them. It now draws as a bordered,
  backed popup near the selected row instead. Reported by Nate
  (neostryder/neo-angband#128).

- A mod's unresolvable reference or malformed patch could take the whole game
  down at boot in six places the mod-resilience audit had not yet reached: an
  artifact's `flags:`/`values:` tokens, a curse's `type:` entries, a monster's
  `base:`/`friends-base:`/`friends:`/`shape:`, a terrain feature's `mimic:`,
  and a store record whose `owner:` list a `replaces` body dropped entirely.
  Each now drops only the mod's own bad entry (or, where the field is the
  whole record's foundation, the one record) and reports it, the same way an
  ego's unresolvable `item:` line already did; core's own data still fails
  loudly. A malformed `fieldPatch` operation - an `append` written with
  `value` instead of `values`, for instance - used to abort composition
  entirely with no partial result and could drop every installed mod at once
  when the resulting error named none of them; it is now refused the same way
  a missing patch target already was (neostryder/neo-angband#8).
- Nearly every screen in the web front end still wrote its UI text as a
  hardcoded English literal, so a mod-supplied locale could not reach it no
  matter what it declared: context menus, the mods and mod-browse screens,
  options, keymap editing, pref-file screens, the wizard/debug console, the
  shop, the character sheet, the knowledge browser, the title screen's
  credits, and birth and character-select. All of it now routes through
  `t()` - over a thousand message ids added in this pass - and the bundled
  `demo-resources` mod's `en-XA` pseudo-locale catalog grew to match, so
  switching to it no longer shows plain English for anything that is in fact
  translatable. main.ts's combat messages and its `confirmYesNo`/`getCheck`
  prompts were outside this pass's scope and remain untranslated
  (neostryder/neo-angband#95).
- An autoplayer mod (the Borg) took over the keyboard with no way to hand it
  back short of force-quitting: its own answer to a blocking prompt reached
  the game the same way a real keypress did, so opening the game menu to
  disable it just closed again on the mod's next tick. Any real keypress now
  interrupts an autoplayer immediately, only while the window actually has
  focus, so one left running in the background does not hand back control on
  a keystroke meant for another window. Ctrl-Z also now offers to start one,
  through upstream's own warn-and-confirm prompt, rather than a silent
  mod-manager toggle that took effect on the next reload
  (neostryder/neo-angband#125).

## [0.34.2] - 2026-08-25

### Fixed

- The desktop build's injected mod-origin-merge script carried its own copy of
  the save database's schema, out of sync with a store added earlier: it still
  expected schema version 2 and did not know about the linoleum tile-cache
  store, so an install landing on that path could fail to open a save
  (neostryder/neo-angband#122).

## [0.34.1] - 2026-08-24

### Fixed

- The desktop in-place updater refused to download any release after GitHub
  renamed the CDN host release downloads redirect to, failing every update
  attempt with "the release download redirected to an unexpected host." The
  trusted-host check now matches any `*.githubusercontent.com` subdomain
  instead of one specific hostname, so a future rename does not repeat this.
  A copy already stuck on the old check has to be reinstalled by hand once
  (see the README) since the broken check runs in the copy that is already
  installed, not in whatever is published next.

## [0.34.0] - 2026-08-24

### Added

- **A Linoleum-engine tile pack can now ship as a single source tilesheet
  atlas instead of a pre-converted loose-file tree.** A `tilesheet` source
  descriptor on a manifest's `tilePacks` entry (`packages/mod-sdk/src/manifest.ts`)
  names the atlas image and its `graf-*.prf` mapping files; the new
  `@rpgm-tools/neo-angband-linoleum` package's shared conversion plan (also used
  by the mod's own build tooling) runs the first time a player actually selects
  that pack, and the generated loose files are cached in IndexedDB
  (`packages/web/src/linoleum-cache.ts`) so later enables reuse them without
  reconverting. This exists because a fully pre-converted multi-pack tileset mod
  can exceed the installer's archive entry-count guard before any content is
  examined (neostryder/neo-angband#120); shipping the small source atlas instead
  keeps a legitimate mod's archive far under that limit without weakening the
  guard for anything else.
- **A mod can now decide whether a shapechange's obvious flags are learned
  directly**, through a new `shapeLearnObviousFlagsDirectly` hook on the
  behaviour seam (`ModHooks`). Core reads it in `shapeLearnOnAssume` after
  computing the shape's obvious (OFID_WIELD) flags, on top of the existing
  equipment-based learning rather than instead of it. With no mod contributing
  one the hook is absent and a shape's obvious flag is learned only when a worn
  item also carries it, which is Angband 4.2.6's own behaviour: a flag the
  shape alone grants is never learned. Upstream corrected that after the tag
  ([`c8036c515`](https://github.com/angband/angband/commit/c8036c51537942a560e3d7f81749c431bbb4701f)),
  and the correction ships as the `upstream-catchup` mod's rule; core stays
  pinned to the tag and holds only the point at which the direct-learn
  decision is made.
- Mods can observe a frozen level returning through the `levelRevisited` behaviour
  hook. With no contributor, the port still resumes its cached level exactly as
  4.2.6 did. The `upstream-catchup` mod uses the notification for upstream
  `5c45eb958`'s noise-clear/scent-aging behaviour on persistent-level and
  single-combat returns (neostryder/neo-angband#119).

## [0.33.0] - 2026-08-24

### Added

- Character history now exposes a write-time mod seam that can retain raw input
  with a display-expansion marker, plus a display-time formatter shared by the
  history screen and character dump. Unused seams preserve the faithful 4.2.6
  stored text and rendering.
- **A mod can now decide the radius a blast is built from**, through a new
  `projectionRadius` hook on the behaviour seam (`ModHooks`). Core reads it in
  `computeProjection` before any grid is collected, and it is folded `chained`,
  so two mods narrowing one blast for two unrelated reasons both get their
  narrowing. With no mod contributing one the member is absent and the radius is
  used exactly as it was given, which is Angband 4.2.6's own behaviour: 4.2.6
  sizes its damage-at-distance table by `max_range` and never checks the radius
  against it, so a radius above the maximum reaches distances the table has no
  entry for. Upstream corrected that after the tag
  ([`f0f6bd223`](https://github.com/angband/angband/commit/f0f6bd223b6b9faf0072b0ae7ffb34a812b97349),
  upstream issue [#6671](https://github.com/angband/angband/issues/6671)); core
  stays pinned to the tag and holds only the point at which the radius is
  decided, and the correction ships as the `upstream-catchup` mod's
  `catchup.projections` rule. The hook is RNG-free by contract - the radius
  decides how many grids the blast collects, so a draw there would move the
  stream by an amount that depends on the terrain.

### Fixed

- Long capability descriptions and other scrollable table text now wrap instead
  of being silently cut off at the edge of the terminal. Reported by neostryder.

## [0.32.0] - 2026-08-24

### Added

- A mod's declared screenshots, previously validated but never shown
  anywhere, now appear in the mod-detail view during install/browse
  alongside its other metadata.
- **`upstream-catchup`** added to the recommended first-party mods
  ([mods/registry.json](mods/registry.json)): changes upstream Angband accepted
  after the `4.2.6` tag core is pinned to, each cited to the commit that made it,
  one toggle per class of change and every toggle off by default. Its first
  release carries the four post-4.2.6 tile-assignment commits, which give a
  creature or an item a picture in a tile set that was leaving it as a coloured
  letter. A change with no accepted upstream commit still belongs to `bug-fixes`;
  that one question is the whole boundary between the two mods, and a fix
  upstream later accepts moves across at the next release. The mod expires by
  design - a rebaseline onto a newer upstream tag makes every row in it redundant.
  See [docs/modding/UPSTREAM_CATCHUP_MOD_SCOPE.md](docs/modding/UPSTREAM_CATCHUP_MOD_SCOPE.md).

### Fixed

- A menu list squeezed by a detail pane (the mod manager's "Recommended mods"
  screen among others) gave no on-screen sign that more rows existed above or
  below the visible window - arrowing past the edge scrolled correctly but
  looked identical to reaching the end of the list. A small arrow now marks
  the clipped edge, in the column every row already leaves empty.
- The Escape (game) menu and the death menu had every label, hint, and footer
  written as a hardcoded English literal. A mod-supplied locale could not
  touch any of them no matter what it declared. Both menus now route through
  `t()` like the help pages already did, and their footers moved from a
  module-level constant to a function so a language switched mid-session
  takes effect instead of freezing whatever was active at boot.
- The bundled `demo-resources` mod's `en-XA` pseudo-locale, the tool
  `docs/modding/AUTHORING.md` documents for finding strings the translator
  never reaches, only covered 6 of the ids already wired through `t()`.
  Switching to it left several already-translatable help titles showing
  plain English, which looks identical to a string that bypasses the
  translator and defeats the pseudo-locale's own purpose. It now covers
  every message id currently wired up.

## [0.31.1] - 2026-08-24

### Fixed

- The install-choice screen ((I)nstall locally) silently cut off its text on a
  24-row terminal instead of showing all of it. It now scrolls, with the same
  arrow/page/home/end keys and "(a-b/n)" footer cue `showTextScreen` already
  uses elsewhere.
- A mod-defined player race or class, or a mod-defined monster, whose name
  collided with an existing one was silently bound over the earlier record.
  The first-loaded name now wins and the later, colliding record is refused
  and reported instead.
- A mod pack's chest traps and its world-topology data (level names by depth)
  were composed into the pack but never bound into the running game, so a mod
  supplying either had no effect and the game fell back to the built-in
  defaults with no indication anything was missing. Both are now wired
  through to the level the same way other composed content is.
- A loose (Linoleum-style) tileset's family-level glow, tint, and pulse
  effects, declared with a `:when:` rule, were never evaluated at render
  time. They now apply, and `docs/LINOLEUM.md`'s claim that they were is
  corrected to match.
- The graphics-mode full dungeon map overview did not render the level
  correctly; it now draws a miniature tile per grid, matching the ASCII
  overview's coverage. The ASCII path is unchanged.
- A mod-composition failure during boot left the game unable to start with no
  recovery path. It now falls back to a safe mode that disables all mods and
  reloads, the same way a live in-session mod failure already does.
- The desktop app's stranded-origin recovery logged its own successful
  recovery at "error" severity, reading as a crash in the logs when nothing
  was actually broken. It now logs at "warn".

## [0.31.0] - 2026-08-23

### Security
- The desktop updater no longer accepts a download URL or checksum from the
  renderer. The main process re-reads the named release from GitHub and
  resolves the platform asset's URL, digest, and size itself; redirects are
  followed manually with a host check on every hop, and extraction now
  enforces archive size, entry count, and expansion-ratio limits.
- A content patch path such as `__proto__.x` no longer reaches
  `Object.prototype`. Every path-walking entry point in the patch and compose
  modules now rejects `__proto__`, `prototype`, and `constructor` and reads
  only a container's own properties.
- Repository mod downloads and imported `.neochar` saves now decompress
  within the same resource limits the local mod importer already enforced,
  instead of expanding an untrusted archive or save with no ceiling.
- The game window no longer navigates away from its own origin on a
  same-window navigation. The check that decides what counts as the game's
  own address now parses the URL instead of matching a string prefix.
- Three dependencies pinned to versions with published advisories
  (`fast-uri`, `js-yaml`, `nanoid`) are updated.

## [0.30.0] - 2026-08-23

### Added
- The mod conflict report now includes a row for two or more mods that both
  provide the player's own tile. `TileRegistry.playerTile` already took the
  first non-null answer in load order; a later provider's opinion was
  silently discarded with nothing to show for it, unlike every other
  contested slot the report already covers.

### Changed
- Mod sizes now display as their exact byte count instead of a KiB/MiB
  approximation. Every size in the pipeline was already measured exactly;
  only the display step was rounding it.

### Fixed
- Text-entry prompts (including the mod install "Repository" prompt) now
  accept a pasted value, and no longer insert a character typed while
  composing text through an IME.
- A session-only mod's consent now refreshes when a re-staged draft changes
  the archive's bytes, instead of carrying the original consent across the
  edit.

## [0.29.0] - 2026-08-23

### Added
- Mod authors can now put `renamedSectionFlags` on a `PackSection` to preserve
  a player's explicit on/off decision when a section is renamed or when a rule
  becomes a section to gate content. The host imports the first matching legacy
  rule or section choice before applying the section default.
- A save's manifest now records the content digest of every present pack.
  Loading warns when a still-present pack's digest no longer matches what the
  save was written with, catching a session or installed mod that patched a
  core record (rather than only adding one) differently, or dropped the patch
  entirely, even though nothing was orphaned. Installed mods use their
  install-time per-file digests, prefetched before the synchronous boot path.
- **The agent view can answer "does this player's class have flag X."**
  `PlayerView.classFlags` reports the PF_* codes on the player class's own flag
  set (class.txt's `player-flags:` lines) - COMBAT_REGEN for a Blackguard, ZERO_FAIL
  for a Mage, and so on. The view already carried equipment-derived object flags
  and derived skills, but nothing that read the class definition itself, so a mod
  asking a class-flag question had no seam to ask it through. A new field on an
  existing view rather than a new accessor, so the agent API is now 1.3.0.

### Fixed
- **`flavor.txt`'s `fixed:`/`flavor:` order is now recoverable from the
  compiled record.** The content compiler used to split the two directives
  into separate arrays, so a record that interleaved them could not be
  reproduced from the compiled shape at all - the entry `index` cannot stand
  in for file order either, since flavor.txt's own numbering is not the order
  the file writes lines in. Nothing shipped interleaves the two directives, so
  this was latent rather than live; it would have become live the moment a
  mod's flavor.txt did. The compiler now emits one ordered `entries` list per
  record, each entry tagged with which directive produced it, so binding
  follows the file's real line order regardless of how a flavor.txt
  interleaves `fixed:` and `flavor:`.

## [0.28.1] - 2026-08-23

A fixes release: two keymap defects are corrected, and the Mod Builder mod is
renamed to ModForge.

### Fixed
- Home/PageUp/End/PageDown now walk the same diagonal the numpad digits
  7/9/1/3 do with Num Lock on, matching the numpad's own orthogonal keys
  (Arrow keys), which already worked either way.
- A custom keymap can now be triggered by a plain F-key (F1-F12, no modifier)
  or by Enter, and an action sequence can now include Enter as one of its
  keypresses - so a macro ending in Enter, such as the rest command
  `R&[Enter]`, can be bound. Both the keymap editor's capture prompt and the
  keymap resolver that fires a bound key during play now accept the same set
  of trigger keys, so a trigger the editor accepted could no longer silently
  fail to ever fire.

### Changed
- The Mod Builder mod is now named ModForge, with a new manifest id (`forge`).
  An existing install's enabled and consent choices carry over automatically.

## [0.28.0] - 2026-08-22

A mod-authoring release: a plugin now gets the SDK's authoring stack and the
game's own composed records live in `ctx`, and can apply a staged mod with a
proper reload instead of asking the player to press one - alongside a fix for
two windows open on the same character overwriting each other's saves, and a
Turbo speed tier for a mod's autoplayer.

### Fixed

- Two windows open on the same character no longer overwrite each other's saves.
  The character a window writes to is now that window's own, held for as long as
  it is open, instead of being read from a setting every window on the origin
  shared. Opening a character that is already being played somewhere else is
  refused with an explanation rather than allowed and then silently lost, and a
  window that ends up without the character - a duplicated tab, which resumes
  without passing the character select - says so instead of playing on unsaved.
  `neo-angband-active` still records which character to offer at the next launch;
  it no longer decides where a save goes.

### Added
- A player-visible speed control for a mod's autoplayer: the mod's own Fixes &
  tweaks screen (Mods -> the mod) now shows an Autoplayer speed row - Turbo,
  Fast, Normal or Slow - beside the rule that hands it the keyboard in the
  first place, once it holds the controller slot. Takes effect at once, no
  reload. Fast, Normal and Slow match the debug agent seam's existing
  `?speed=fast|normal|slow` tiers; Turbo (10ms) has no named equivalent there,
  since the debug seam already reaches 10ms by passing a raw millisecond
  value instead of a tier name.
- **`ctx.authoring`: the mod SDK's authoring stack, handed to a plugin.** The
  whole public barrel, live, on the terms `ctx.core` is handed over: blueprints
  measured from core's own records, `peersFor`, `suggestFields`, `templateRecord`,
  `draftRecord`, `checkRecords` and `ModProject`. Always present and gated by no
  capability, because these are pure functions over data the caller supplies. A
  tool that helps somebody write a monster could reach none of it before: a plugin
  resolves no bare specifier, so the published npm package was out of reach of the
  game it describes.
- **`ctx.composedRecords`: the records the running game was composed from.**
  Every content record as JSON, keyed by pack-file stem with no extension, which
  is the shape the authoring functions accept. This is the unbound twin of
  `ctx.registries`: a bound `MonsterRace` has no `base`, because the binder
  resolved the name into a pointer, so a table of comparable records could not be
  built from the registry. Mod-added records are in it on the same terms as
  core's, each carrying its provenance, so a draft based on another mod's content
  can name the dependency it just acquired. Absent during content composition,
  for the reason `ctx.registries` is.
- **`ctx.reloadGame`: a mod can apply what it just staged.** The game's own
  mod-change sequence, behind either `mod:install` or `mod:session` - whichever
  capability the mod already holds - because content composes at load and
  staging plus reload are one act: a mod that cannot follow a stage with a
  reload leaves the player holding something the running process will never
  load. What the host does that a mod cannot do for itself is the sequence -
  every plugin's `uninstall()` runs, the autoplayer hands the keyboard back, the
  live character is written down, and the session comes back on that character
  instead of on the title screen. It is not a permission to reload: a plugin
  runs in the page and reaches `location` with no grant at all, and a mod
  calling that directly loses the player's progress since the last save.
- **An install outcome now carries the game's own wording.**
  `ctx.installMod(bytes)` answers with `lines` on both arms: the lines the Mods
  screen itself prints for that same install, including one row per unmet
  requirement and the author's advice under them. A mod built inside the game
  therefore fails a standards check in the same words as one somebody downloaded,
  rather than in a second vocabulary a player cannot look up. `problem` is
  unchanged and is still one whole sentence.
- **A second API-surface ratchet, over the SDK.**
  `packages/mod-sdk/mod-sdk-api-surface.json` records its 94 runtime exports and
  `mod-authoring-surface.test.ts` fails in both directions against it. Handing a
  namespace to a plugin puts every name in it beyond the compiler's reach, which
  is why core has had this since 2026-08-02; `node tools/api-surface.mjs` now
  checks and updates both baselines in one run.

### Changed

- The download screen's size line now shows the exact byte count, comma-grouped,
  instead of rounding to KB or MB - "162,343,507 Bytes" rather than "155 MB".
  The screen already reads as a terminal (the ASCII progress bar); an unrounded
  count fits that and visibly climbs while the download runs, where a
  one-decimal MB figure barely moves.

## [0.27.2] - 2026-08-22

An install-clarity and defaults release: picking (I)nstall locally now lays
out the desktop-vs-browser tradeoff before committing to either, and a new
character starts able to sell to stores instead of needing to find the birth
options page first.

### Added

- "(I)nstall locally" now opens a choice screen first instead of going
  straight to the browser's PWA install page. It lays out the desktop app and
  the installed-PWA path side by side - platform list, update mechanism, the
  desktop's real mods folder versus the PWA's offline service-worker cache,
  and the desktop build's current lack of code signing - so the player picks
  a platform before committing to either download. Picking the desktop app
  opens the Releases page in the real browser; picking the PWA path continues
  into the existing install screen unchanged.

### Changed

- A new character now starts with selling enabled. Core's `birth_no_selling`
  option still exists and still works exactly as upstream describes it - it
  can be turned back on at birth, or made the permanent default again through
  a `customized_birth_options.txt` line - but the shipped default flips from
  upstream's own ON to OFF, so a new player is not silently locked out of
  every shop until they find the birth options page. See
  [docs/PARITY.md](docs/PARITY.md) ("Accepted: birth_no_selling defaults to
  off in core") for the parity accounting.

## [0.27.1] - 2026-08-22

A keyboard-input release: the documented `^` fallback for a control command
now works, the roguelike keyset's caret-plus-direction alter keys are fully
wired, and the birth screen's help matches the keyset actually in use.

### Fixed

- Pressing and releasing `^` (caret) and then a letter did nothing: only a
  real Ctrl-plus-key chord reached a control command. `commands.txt` documents
  the caret sequence specifically for a host that swallows the real chord
  before any page script sees it, and a browser tab is exactly that host -
  `Ctrl-W` closes the tab outright, and no `preventDefault` changes that. The
  keydown handler now arms a pending-caret flag on a bare `^` and resolves the
  next keypress through the same dispatch a real Ctrl chord uses.
- The roguelike keyset's eight caret-plus-direction alter keys (`^b`, `^h`,
  `^j`, `^k`, `^l`, `^n`, `^u`, `^y`) were unbound; only `^t`, `^d` and `^v`
  reached a command. All eight now resolve to alter (attack, tunnel, open,
  disarm or close) in the direction their letter already walks.
- The birth screen's help key always showed the original keyset's command
  summary, even when the roguelike keyset was the customised default or had
  already been chosen for the character being born. `do_cmd_help` reads the
  keyset live off the player under construction; the birth screen now reads
  the same customised interface-option default the running game does and
  opens the matching summary.

## [0.27.0] - 2026-08-21

A trading and rest release: an agent's `shop-buy`, `shop-sell` and `shop-exit`
commands now reach a real handler instead of a silent no-op, and the `rest`
command carries its own multi-turn continuation matching upstream instead of
spending exactly one turn per call, so resting reaches the doubled
regeneration rate upstream gives it. Alongside these, "Report a problem" opens
the right issue tracker for the game or an installed mod directly from the
report screen, repeated messages page correctly during a run or a rest, and
the recall screen's run-length format matches upstream's own.

### Added

- **"Report a problem" now opens the right issue tracker, for the game or for a
  mod.** Once the report file is written the screen lists a destination per
  project and opens the chosen one in the real browser: `G` for Neo Angband, `C`
  for the RPGM Tools Discord, and a digit for each enabled mod that has a
  recorded origin. Nothing is uploaded; the file is still attached by hand.

  A mod's address is read from its install record, which is the repository the
  mod was pinned to on first install rather than whatever the copy on disk now
  claims. Neo Angband's own row goes to the template chooser, because its two
  templates are known to exist; a mod's row goes to the tracker root instead,
  because whether somebody else's repository has templates, or has issues open at
  all, cannot be known from inside the game. A mod whose origin is not a
  repository the game can address - one imported from a file that declared none,
  for instance - says so and offers no key, rather than guessing at a URL that
  might open a stranger's project. Every address is printed under its row, so no
  page is opened that the player has not read first.

  The same screen now gives the advice that decides whether a report is
  actionable: one problem per report, search the tracker first, say what you did
  and expected and got, and which of the two forms a difference from Angband
  belongs in.

### Fixed

- The `rest` command spent exactly one game turn per invocation no matter what
  duration was requested, because it was wired to the same handler as standing
  still in place. Upstream's own rest command takes one turn too, but re-queues
  itself on the internal command queue so a single keypress runs to the full
  requested duration - a turn count, "until HP and SP are full", "until nothing
  is needed", or "until either is full" - without asking for input again, and
  stops early on a disturbance exactly as any other rest would. The port's
  desktop keyboard worked around the gap with its own turn-by-turn loop outside
  the engine, so it looked correct at the keyboard; every other caller of the
  command queue got only the single turn, and never reached the five-turn
  threshold for resting's doubled regeneration rate. The command now carries
  its own multi-turn continuation, matching upstream, and reaches every caller
  the same way.
- Repeated identical messages showed as one top line with a ticking `<Nx>`
  counter instead of being reprinted. Upstream keeps the run-length count for
  the recall screen only: the top line is redrawn for every occurrence, several
  share the line, and a `-more-` prompt stops for each screenful. The recall
  screen (`Ctrl-P`) still collapses the run, unchanged. Two related cases came
  with it: the top line no longer carries a `<Nx>` suffix that belongs only to
  the recall screen, and the partial line left by a step of a run or a rest now
  carries into the next step instead of being wiped, so its `-more-` arrives
  when the line fills rather than never. A dig, an open or a disarm keeps
  starting each attempt on a fresh line, which is what upstream does for a
  command repeating on its own count. Reported by `nck_m`.
- Leaving a level with several screenfuls of pending messages read only the
  earlier ones: the last screenful got no `-more-` and was wiped by the new
  level. The flush before a level change now stops for every screenful.
- A run of identical messages on the recall screen (`Ctrl-P`) read `text (xN)`;
  upstream's own format (`ui-knowledge.c`, `ui-display.c`) is `text <Nx>`. Three
  comments describing the old, wrong format as upstream's are corrected too.
  Reported by `nck_m`.
- "Report a problem" told a player to send the written file "wherever you got
  the game from," naming no actual destination. It now names the GitHub issue
  tracker and the RPGM Tools Discord, and the two issue form templates note
  that the report file already answers several of their required fields.
  Reported by `nck_m`.
- An agent's `shopBuy` / `shopSell` / `shopExit` commands reached no handler at
  all: the engine's command registry had nobody registered for `shop-buy`,
  `shop-sell` or `shop-exit`, so a controller's shopping decisions were a
  silent no-op and an autoplayer that stepped into a shop could not spend or
  raise a copper. The three now resolve a stock index or a gear handle into a
  real object, re-check standing in the right store, and commit through the
  same buy/sell path the interactive shop screen uses.

## [0.26.0] - 2026-08-21

A mod-authoring release: a mod can now drive the debug/wizard command set on a
throwaway session, load and run for a single session without installing,
conjure an item or creature into the live game, install a content mod through
the same door the player's own import uses, and draw a real HTML panel over
the game. Alongside these, an autoplayer no longer stalls at a `-more-` prompt
or loops forever on a locked door, a stale capability check that compared kind
rather than action is fixed, quitting a living character shows the two pauses
upstream shows, and several help screens are transcribed from `lib/help`
instead of a curated subset that had drifted from it.

### Added

- **A mod can drive the game's debug commands, on a session that has stopped being
  saved.** A new capability, `debug:wizard`, hands a consenting mod `ctx.wizard`:
  the depth jumps, the experience and gold and stat edits, acquirement, summoning,
  banishment, mapping, lighting and lore, plus a catalogue of every item, creature
  and artifact the running game has with the pack that added each one. Every
  command is the function the `^A` menu already dispatches to, called from a mod's
  screen instead of from a text prompt, so nothing about the rules is reproduced
  here.

  What makes it offerable is that it refuses to run until the session has been cut
  loose from its save. The character on disk keeps whatever the last save left,
  everything after that is discarded, and there is no way back - so a mod holding
  this can never write a cheated character over one somebody cares about. The
  autosave runs at the tail of a turn and throttles to three seconds, so what is
  given up is at most three seconds of turns; reloading the page returns to the
  character select with the character waiting as it was.

  It is a separate grant from `debug:spawn` and neither covers the other. Spawning
  happens to the character the player is actually playing and costs them that
  character's score permanently; this one costs the session and leaves the save
  alone, which makes it the safer of the two for anything on disk.

- **A mod can be loaded for one session, without joining your library.** A new
  tier of mod source holds an archive in session storage instead of installing it:
  the game picks it up on the next reload, composes it exactly as it composes any
  other pack, and forgets it when the game is closed. It is reached two ways.

  The player's way is a new row on `Import a mod` - "Try a .zip for this session
  only" - and it accepts an archive that ships CODE, because a player choosing a
  file is making the same decision they make when they import one permanently. It
  asks in a screen of its own first, which names the code files, shows the archive's
  size and digest, and lists what the manifest asks for in the same words and the
  same order the install consent prompt uses. Grants made there are held beside the
  archive rather than written to the stored consents, so trying somebody's mod once
  leaves no standing permission behind.

  A mod's way is `ctx.loadModForSession(bytes)`, behind the new `mod:session`
  capability, and it is CONTENT ONLY on exactly the terms `mod:install` is: code
  under any extension is refused, and so is an archive whose manifest asks for a
  capability. A mod handing the engine another mod's code to run is a different act
  from a player choosing a file, and it stays refused. `mod:session` is a separate
  grant from `mod:install` rather than a relaxation of it - an install arrives
  switched off and waits for the player, a session load is on as soon as the game
  reloads - and the capability comparison checks the action so neither consent
  sentence can be spent on the other.

  Everything that makes an install safe runs here too, through the same functions:
  the third-party switch before the archive is opened, the archive ceilings and the
  zip-slip check, the standards inspection that refuses a mod which would install
  and then do nothing, and the origin pin, so a staged archive cannot shadow an
  installed mod of the same id under a different origin. A staged copy of an id you
  already have DOES shadow the installed one for the session, which is the point of
  trying a draft, and the collision is reported on that mod's row.

  **What is temporary is the mod, not what it does.** The archive is forgotten; a
  character it changed stays changed, anything it stored stays stored, and anything
  it sent has been sent. Every screen involved says so, because "just for this
  session" reads as a safety feature and is not one. The lifetime is also a strong
  convention rather than a boundary: session storage survives a reload, which is
  what makes the tier work, and a browser restoring a closed or crashed window
  restores it too. So a session mod is always listed, always marked `SESSION ONLY`,
  and its detail screen offers `Drop it` instead of an on/off switch - it is on
  because it was staged, and dropping the archive is the only thing that stops it.

- **A mod can conjure an item or a creature into the live game, and the character
  is marked for it.** `ctx.debug`, behind the new `debug:spawn` capability, drops
  one item at the player's feet or scatters one creature near them, exactly as the
  debug commands do. It adds almost no ability and a good deal of honesty: every
  primitive behind it was already on `ctx.core`, and the gate they check reads a
  `debug` flag out of a deps bag the caller assembles - so a mod could always have
  conjured whatever it liked, with no capability and no trace.

  What the capability adds is the mark. The first use in a character asks the
  game's own debug question, in the same words and through the same function `^A`
  uses, and accepting sets the same permanent `NOSCORE.DEBUG` bit - before
  anything is placed, so nothing can arrive in a character the player did not
  agree to spend. It also adds a line on the consent list, its own kind with no
  wildcard over it, so a player can see exactly which of their mods can do this.

  The question is asked on the character grid, which a mod's own modal panel would
  be covering, so the first spawn in a character is refused by name while one is
  open rather than posing a prompt nobody can see or answer. Placement is the
  game's and the API has no coordinates.

- **A mod can install a content mod.** `ctx.installMod(bytes)`, behind the new
  `mod:install` capability, takes the bytes of a mod archive and lands it through
  the same door the player's own zip import uses - so it is read under the same
  ceilings, inspected against the same requirements in the same words, keyed and
  digested the same way, and pinned to the same origin on first import. This is
  the caller `ModProject` was written for: it has emitted a mod folder's exact
  bytes since it was written and had nothing to hand them to, because nothing a
  mod can reach turns bytes into an installed mod.

  The door installs CONTENT only. An archive that ships code, under any name and
  not merely `plugin.js`, is refused by file; so is one whose manifest asks for
  any capability. That is what keeps the grant the size of its own sentence: "may
  add records and tweaks to your library" rather than "may write a program,
  install it, and have you enable something it authored". And an install is not
  an enable - what arrives is switched off, the player is shown its own
  capability list before any of it runs, and a mod takes effect on reload - which
  is what stops one grant becoming every grant. The consent line says both halves
  rather than leaving either to be discovered.

  Refusals are values, never throws, because the caller is a mod that will be
  showing the answer to a player. The bytes are copied before anything
  asynchronous runs, so what was inspected is what is stored.

- **A mod can draw with real HTML instead of the character grid.** A mod holding
  the new `ui:panel.mount` capability gets `ctx.ui.openPanel(spec)`, which mounts
  a panel on the page above the game and hands back a shadow root to build in.
  The five UI seams before it all paint character cells through the same seven
  methods, which is right for a compass or a carried-weight readout and wrong for
  a form: a field with a caret, a list with a scrollbar and a table the player
  sorts by clicking a column are three things every browser already has and this
  codebase has none of.

  The part a mod could not do for itself is the keyboard. The front end has one
  keydown registration - `window`, capture phase, installed at import - and every
  modal handler behind it cancels the event, so a real `<input>` on this page
  received nothing and its keystrokes were read as game commands instead: typing
  a name walked the character across the level. The door now stands down for a
  keystroke whose composed path runs through the top panel before it reaches the
  game's canvas, so the caret decides whose key it is, per keystroke.

  Escape belongs to the player and a mod cannot take it. It closes the topmost
  panel, decided at the door before the panel is offered the key, and focus
  returns to the game rather than to whatever the panel had focused; a modal
  panel also carries a close control the host draws outside the mod's shadow
  root, because a phone has no Escape key. The suppression fails OPEN: a
  container that has been detached, moved out of the panel layer, or made a
  parent of the game's own canvas is closed and the keyboard goes back, checked
  as each key arrives rather than once at mount, and a panel under another is
  inert. A panel the player closed puts that mod on a brief pause, so reopening
  cannot outrun the key they used to get out, and eight panels is the ceiling
  because Escape closes one at a time.

  The shadow root is style hygiene rather than a sandbox and the consent text
  says so: a plugin runs in the page's own realm, so a mod can reach the document
  with or without this grant. What the grant carries is the sentence the player
  reads before enabling the mod - that it can draw something which looks exactly
  like the game's own screens and read what is typed into it - and a container the
  host owns, places, stacks and takes away. Panels come down when the mod set
  changes, after each plugin's `uninstall()` and before the save.

### Fixed

- **An autoplayer mod stopped dead at every `-more-`, and only a human could
  free it.** A turn's tail can raise a prompt that blocks for a keypress - two
  screenfuls of messages, the forced `-more-` a level change puts in front of the
  stair message, the floor-item list on a pile of two or more, a shop screen - and
  the autoplayer clock skipped every tick while one was up. So a mod that plays the
  game by itself could not go downstairs: it printed "You enter a maze of down
  staircases." and waited for a key that was never coming. The `auto_more` option
  cleared the pager and reached neither of the other two, and it is stored per
  character, so it reverted every time the autoplayer started a new one.

  While an autoplayer holds the keyboard, the host now answers the prompt itself:
  one ESCAPE through the same input door every real keystroke goes through, logged
  each time. That is upstream's own mechanism in this shell's terms - its borg
  installs itself as the hook `inkey()` consults for every key the game reads, and
  answers a `-more-` with a space before it thinks about a move at all. Nothing is
  answered before there is a game to play, so character creation still belongs to
  the player. See `docs/modding/BORG.md`.

- **`CellView.trap` reported a locked door as a trap, and an agent that believed
  it hung.** The field meant "this grid holds any trap record", and a closed door's
  lock IS a trap record - so is a glyph of warding, a web and a decoy. The `disarm`
  command wants a VISIBLE PLAYER trap and refuses anything else without spending a
  turn, so an autoplayer that walked up to a locked door disarmed it forever with
  game time frozen. The field is now `square_isdisarmabletrap`, the same predicate
  `disarm` tests and the trap layer draws from.

  It also closes a leak: an undetected trap used to be readable through this
  field, on a view whose own rule is that a trap the player has not found is not on
  the screen and therefore not in the view. **This is a behaviour change for any mod
  reading `CellView.trap`**; see `docs/modding/MOD_COMPATIBILITY.md`.

- **`debug:spawn` would have carried a second `debug:` capability along with it.**
  The grant check compared the capability's kind and not its action, which was
  correct by accident while `spawn` was the only debug action. Adding a second one
  would have meant a player who agreed to a mod conjuring one monster had also
  agreed to the depth jumps, the experience grants and the acquirement. The action
  is now compared, as it already was for `mod:` and `ui:`.

- `^X` pauses on the way out, and shows the score it would have scored. Saving and
  quitting a living character prints "Press Return (or Escape)." and waits, and
  then, unless that key was Escape, opens the character's would-be Hall of Fame
  entry - "Killed by nobody (yet!)" - to page through before the game leaves. Both
  are what `close_game` does once `playing` goes false, and the port had neither:
  it wrote the save and went straight to the title screen, so the last thing a
  quitting player saw was the dungeon. Neither pause asks a question or can cancel
  the quit, and the preview writes nothing to the score table - a score is only
  ever entered at a real death. `^S`, which saves without quitting, is unchanged,
  because `save_game` stops at the save.
- The `?` command summary is `lib/help`'s own again, keyset for keyset. It had
  been a curated subset written when most of upstream's keyset was unbound here,
  and the port has bound all of it since: the page had drifted into saying that
  `S` saves the game and `V` shows the hall of fame (they are See abilities and
  Display version info, as upstream), listed a `p` that recites prayers, and
  omitted the staircase keys that the playing-guide page beside it explains. It
  now prints `commands.txt` or `r_comm.txt` according to `rogue_like_commands`,
  the way `do_cmd_help` chooses between `index.txt` and `r_index.txt`, and names
  the keyset in its title. The rows this build has nothing behind are named
  once, above the table, instead of being left out of it.
- The symbol legend prints `symbols.txt`, two glyphs to a line as the file has
  them, with the two paragraphs a curated version had dropped: `/` identifies a
  symbol here and user pref files load here, so both were true all along.
  Flattening the file into one column had also dropped upstream's `x  -` row and
  slid "Xorn/Xaren" onto the lowercase `x`, so the legend named a glyph no xorn
  has.
- The help index offers "Available symbols", `index.txt`'s own wording, and
  carries upstream's pointer to the manual - which had been sitting at the foot
  of the command summary, 56 rows below where a player looks for it.
- `V` prints the Angband copyright notice, which is what upstream's
  `do_cmd_version` puts on that screen and which this build had replaced with
  credits alone.
- The targeting banner uses `target_display_help`'s own wording again ("`r`
  displays details", "`+` and `-` cycle through places", "`t` targets
  selection").

## [0.25.0] - 2026-08-21

Current state of the project at version `1.0.0` - a features release for mod
authors. A tileset mod can now say what the player's own cell draws and ask for
a palette-swapped or mirrored copy of any tile; a hypothetical loadout can be
scored without wearing it; and an autoplayer mod's character now starts again
when it dies, in the same session, the way upstream's borg always has.

### Added

- **A tileset mod can say what the PLAYER's own cell draws, and ask for a
  mirrored or palette-swapped copy of any tile.** Two additions to
  `registry:tiles`, both mechanism with no taste in them, and both there because
  a mod wanted something the door could not express.

  `TileFill.transform` is the sibling of `derive`: where `derive` rotates a
  donor's own hue, this replaces the palette outright, indexing each pixel by
  brightness into a ramp the caller hands over and carrying alpha through
  untouched. It refuses on the same three grounds `derive` does, and it returns
  null on a fixed tilesheet for the same reason - there is no spare cell in an
  atlas to put a variant in. `TilesFacade.player` is a provider asked once per
  frame the player is drawn: given the character's shape, level, class and race,
  which tile should this cell show? Null is "the tile set's own player picture",
  which is what happens with no provider installed, and first non-null in load
  order wins so two such mods can coexist.

  The player's cell needed a door of its own rather than a fill. The player is
  race 0 in the monster tile table (`grid_data_as_text`'s is_player branch reads
  that slot for both the colour and the character) and every shipped tile set
  assigns it, so `fillMonster(0, ...)` is refused and should be. What is asked
  here is a different question, at a different time, and it owns nothing: the
  tile map is never written, so a condition switching off restores the pack's own
  tile with no rebuild, a provider that throws costs one frame's answer, and the
  '@' and its HP decile are untouched either way.

  Nothing in the game uses either of these. The consumer is neo-linoleum 0.16.0,
  which draws a shapechanged character as the creature - Angband 4.2.6 has no
  per-shape player picture, so what one should look like is a judgement, and a
  tile set gets to make judgements about its own art where the port does not.

- **A loadout the character is not wearing can be derived.** `simulateLoadout`
  answers "what would I be, wearing this instead": it runs the engine's own
  `calc_bonuses` over a hypothetical set of worn objects and returns the
  character before, the character after, and the difference between them - every
  field of upstream's `player_state`, plus max hitpoints, max mana, the armour
  encumbrance and the carried weight. Nothing in the live game is written.

  It reuses the real derive rather than summing an item's own bonuses. That is
  what keeps the answer from drifting away from the loadout the character is
  actually in, and it is the only way the interactions are visible at all: the
  ring of strength that changes the blow count, the cuirass that costs a caster
  half their mana, the weight that costs speed. A test asserts the simulated
  answer field for field against really equipping the item.

  A whole before/after/delta surface rather than a score, because the two things
  that want this want different halves of it. An autoplayer reduces it to one
  number; a player comparing two items wants to see which resist was traded for
  which, and a scalar can never say. Reachable by a mod as
  `view.simulateLoadout(change)` on the agent view - additive and optional, so the
  agent API is now 1.2.0 - and by the engine as the exported function.

  `neo-angband-mod-borg` 0.6.0 is the first consumer, and this is what closes the
  last of its four resolver seams: the Borg wears what it finds, buys what it
  needs and sells what it is finished with, where before it could not tell whether
  any of the three would help and so did none of them.

- **An autoplayer mod's character starts again when it dies, in the same
  session.** `StartedGame.reincarnate` is upstream's `reincarnate_borg`
  (`borg/borg-reincarnate.c`): it wipes the live player in place, rolls a new race
  and class, outfits them from the class kit and carries on. The game loop's death
  handler calls it instead of showing the tombstone whenever a mod holds the
  keyboard, which is what turns an autoplayer from something that plays one
  character into something that plays.

  **It is a reincarnation, not a new game**, and every part of that is deliberate.
  The `GameState` object, the player object inside it, the gear store, the RNG
  stream, the option store, the turn counter and the save slot are all the same
  objects afterwards - the same reason a level change swaps the chunk in place
  rather than rebuilding the session around it. Nothing reloads the page, no
  second slot is claimed, and the new character autosaves over the one that died.
  Race and class are ROLLED unless a caller pins them, matching upstream's own
  default (`borg_cfg[BORG_RESPAWN_RACE] == -1` is a reroll). The new character is
  born from `generatePlayer` and `outfitPlayer`, the two functions a genuinely new
  game births from, rather than from a second copy of the birth pipeline.

  Two things upstream does here are deliberately not done: `seed_flavor` and
  `seed_randart` are left alone, because this port's savefile re-derives the
  flavour assignment and the randart set FROM those seeds (`docs/PARITY.md`), so
  moving either mid-session would make the save describe a world the game is not
  in. The flavour KNOWLEDGE is reset instead, which is the half a player can
  observe - a reincarnated character does not inherit what the dead one identified,
  and does not inherit its shopping or its home stash either (`store_reset`).

- **`NOSCORE_BORG` is set, at last.** The bit was defined at upstream's own value,
  included in the score-invalidating mask, persisted in the savefile and read at
  death to print "Score not registered for borgs." - and set by nothing, so every
  read answered false. It is now set at upstream's own activation gate
  (`do_cmd_try_borg`, `cmd-misc.c:140`): the moment a mod takes the keyboard, so
  the character that was already alive when it took over is marked too, and again
  on every character the restart loop produces, because birth zeroes the field.

  The mark is one-way - `markNoscore` only ORs, and no path clears it - so a save
  that has run an autoplayer for one turn stays marked for the rest of its life.
  The character dump says so in an `[Autoplayed]` block, on the same terms as
  `[Mods enabled]`: written only when the bit is set, so a faithful dump ends
  exactly where upstream's does. `[Mods enabled]` answers what was installed, and
  an autoplayer mod can be installed and enabled without ever holding the
  keyboard; this answers who played.

- **A mod's controller now has a clock of its own.** `ModPlugin.controller` was
  installed and then nothing drove it, so an autoplayer only took a turn when a
  human happened to press a key - which meant an autoplayer could not actually
  play by itself, restart loop or not. The mod-controller install site now pumps
  `advance()` on a plain interval, the same shape the debug agent (`?agent=`) and
  sandboxed plugin (`?plugin=`) seams already used: a latch arms one action per
  tick, because `runGameLoop` asks for a command for as long as the player has
  energy, and a controller answering every call would never let `advance()`
  return. Unlike the debug seams, there is no tick cap - a "let it play" mod is
  supposed to keep going, not stop after a fixed number of turns.

## [0.24.0] - 2026-08-21

Current state of the project at version `0.24.0` - a fixes release. Nothing
about the game's rules changed. A game played with random artifacts on now
reloads correctly, which it did not; the desktop build checks a URL before
handing it to the operating system; a mod whose newest release needs a newer
game now offers one that runs here instead of refusing outright; and the mod
consent screen stopped implying that a short permission list bounds what a
mod's code can reach.

### Fixed

- **Random artifacts keep their created, seen and everseen flags across a reload,
  and a carried random artifact stays an artifact.** With `birth_randarts` on,
  every artifact id in the savefile was matched against the STANDARD artifact
  names rather than the random ones. An id is a slug of the artifact's name and
  the save was written from the random names, so nothing matched: an artifact you
  had already found came back unknown, and a random artifact in your pack, in a
  shop or on the floor came back as its plain base item. The artifact set is now
  rebuilt before those ids are resolved, reading the birth option and the seed as
  the file recorded them, so one resolver serves the save migration, the flags and
  every saved object alike. Upstream writes these fields positionally by index and
  so has nothing to lose here, which makes this the port's own defect rather than a
  wart to preserve. A game with `birth_randarts` off is unchanged.

- **A mod's artifact keeps its provenance when random artifacts are on.** The
  whole artifact array is replaced by the generated set, and the clone it was
  built from dropped two fields: the stamp saying which pack contributed the
  record, and the place a mod's own fields on that record live. An artifact's
  savefile id is minted from that stamp, so a mod's artifact was written into the
  save under core's namespace instead of the mod's, and a plugin reading its own
  fields back off the artifact found nothing. Nothing about an unmodded run
  changes: core's records carry neither field, and neither is read by artifact
  generation, which the recorded whole-set vectors confirm.

- **The desktop build checks a URL before handing it to the operating system.**
  The update page's reveal link and the external-link opener both called
  `shell.openExternal` with whatever string reached them, and the reveal link's
  string usually begins as GitHub's own release JSON, fetched over the network
  rather than built into the program. Both are also reachable directly from any
  script running in the game page, a mod's plugin.js included, since a mod's code
  is a plain module import into that same page. Neither origin was validated, so a
  scheme other than http or https would have reached whatever program is
  registered for it on your machine instead of a browser. The reveal link is now
  checked against this project's own github.com releases pages and the
  external-link opener against http and https generally; either rejection is
  logged with what was rejected rather than failing silently.

### Changed

- **The mod consent screen warns about the code for every mod that ships code,
  and the modding docs say what a permission actually gates.** The warning used to
  appear only when one of the requested permissions was flagged powerful, which
  made it read as a consequence of the list: a plugin asking for nothing but a
  tile or vocabulary registry got a consent screen with no such line, and a plugin
  asking for nothing at all got no consent screen and a manager row reading `Asks
  for no permissions`. That reassurance was wrong. A `registry:*` permission gates
  one convenience facade, and the same live registries arrive at the plugin a
  second time with no check at all, so a mod that declared no domain can still
  register a room builder, a cave builder, a dungeon profile, a vault glyph, an
  item class, a rune, a randart ability or a message type. Fourteen of the gated
  domains have such a twin. That is inherent in running trusted code inside the
  engine rather than a gap to close, since nothing reachable from inside the engine
  namespace can be withheld from code already inside it, so the words moved instead
  of the mechanism: the screen names the code, the manager row on a code mod that
  asks for nothing says it still runs code, and `docs/modding/PLUGINS.md` gains
  "What a capability gates, and what it does not" with the table of twins and the
  reason declaring still matters, which is that the player reads the declaration
  and the conflict report is built from it. The boundary that does hold is the
  install, which is where a player decides to trust a mod's code at all. A test
  measures both halves, the gate refusing and the twin reaching, against the real
  bound registries and the real plugin context, so the prose cannot drift back into
  claiming containment.

- **A mod whose newest release needs a newer game now offers the newest release
  that does not.** The mod screen used to read `will not run on this version` and
  stop there, even when the same mod still had an earlier release that ran
  perfectly on your build. It now looks back through that mod's earlier releases
  and offers the newest one your game can actually run. It names the newer release
  it stepped past, and it tells you to update the game only when updating the game
  is what would get you that release. A mod with nothing that runs here is still
  refused, and now says how many of its releases were tried instead of leaving you
  to wonder whether the older ones were looked at.
  - **Update installed mods** stopped offering an update the game would then
    refuse to load. A mod already on the newest release your build can run is
    described that way rather than as out of date, and the row says which newer
    release is waiting on a game update.

## [0.23.0] - 2026-08-20

Current state of the project at version `0.23.0` - the release where the port
gives something back. Nothing about the game's rules changed. What changed is that
a mod can ask what the game is made of, that the Borg finally uses it, and that
the game stopped deciding what a mod's monster looks like - a rule 0.22.0 had
added and 4.2.6 has no opinion about, handed to the tile set where it belongs.

### Added

- **A plugin can now ask the game what it is made of: `ctx.registries`.** Every
  race, object kind, feature, trap, store and projection the session actually runs
  on, bound, at its real index. Until now a plugin could see `ctx.state` - the
  monsters standing on the current level - which is enough to draw a frame and not
  enough to answer a question about a thing by index: what a creature you are
  merely remembering can do, what an item you have never picked up is worth, which
  kinds share a `tval`. It is the whole registry set rather than a curated slice,
  for the reason `ctx.core` is the whole namespace. **A mod's own content is in it
  on the same terms as core's**, because binding happens after every enabled mod
  composes and mods append, so nothing in a lookup tells a modded race from a core
  one. That is what lets a consumer treat modded and vanilla content identically
  without trying to.
  - The first consumer is the **Borg**, which had shipped since its port with its
    danger evaluator fed zeroes: `makeCoreResolvers` existed, was documented, and
    had no caller, because the race registry was not reachable from a plugin. It
    is now, so the Borg fears real monsters, including ones a mod added.

- **A tileset mod can supply tiles for content the pack has never heard of:
  `registry:tiles`.** A plugin registers one filler, which runs after every pref
  layer - the pack's own and each mod's - and writes through a door that only ever
  fills what nothing assigned. So it cannot repaint the tile set even by mistake,
  and two mods filling different blanks cannot fight over one. The loose-pack
  engine also hands a filler a `derive(donor, hue)`, which allocates a slot drawing
  an existing asset with its hue rotated; the tilesheet engine answers null,
  because its tiles are cells of a fixed atlas with no spare cell for a variant,
  and a filler copies the donor instead.

### Removed

- **The game no longer decides what a mod's monster looks like
  (`fillTilesFromKin`).** 0.22.0 gave an added creature the tile of a race sharing
  its `base`, and an added item the tile of a kind sharing its `tval`. It is gone
  one release later, on the rule that has not moved since the port started: the
  port adds nothing to 4.2.6. Angband 4.2.6 has no concept of a record a mod added,
  so it has no opinion about what one should look like, and "the lowest-index
  relative's picture" is a judgement rather than ported behaviour. It was also a
  judgement about art the game does not own - a tile set drawn in 2003 has no
  picture for content added twenty years later, and a relative's picture there is a
  confident lie where a letter was the honest answer.

  **Nothing is lost for a player who wants the behaviour**, and it got better on
  the way out: `neo-linoleum` 0.15.0 carries exactly that rule, restricted to its
  own packs, and gives the added creature a recoloured tile of its own rather than
  a pixel-identical copy of its cousin's. It is one switch in that mod's options,
  on by default. Under Angband's own tile sheets an added creature is a letter
  again, which is what it was before 0.22.0 and what a fixed atlas can honestly
  offer.

  For mod authors: **ship tiles with your content, and if you do not, say so in
  your description and point players at a tile mod that fills blanks.** Tutorials 2
  and 3 now say that where the tile question comes up, and neither treats
  neo-linoleum as a dependency - a content mod is complete in ASCII with no tile
  set at all. The removal and its replacement are recorded in
  [docs/modding/MOD_COMPATIBILITY.md](docs/modding/MOD_COMPATIBILITY.md) under
  "Removals taken knowingly", which is the fourth entry of exactly this shape and
  the first whose subject had shipped.

## [0.22.0] - 2026-08-20

Current state of the project at version `0.22.0` - the mod-resilience release.
Nothing about the game's rules changed. What changed is that a mod can now add
one line to a list instead of restating it, that a mod's own content is drawn
rather than lettered, and that thirteen defects are fixed - four of them ways one
line of one mod could take the whole game down at boot, which now cost that mod
its line and nothing else.

### Added

- **A mod can add one entry to a list.** Two new field-patch ops: `append`, which
  adds entries to the array at a dot-path without restating it, and `removeValue`,
  which drops entries deep-equal to a value. This closes the limitation recorded
  under 0.21.0: putting a modded item in a shop's stock is now a three-line patch,
  core's own stock list survives untouched, and two mods can both add to the same
  store because neither has to replace the other's list. `append` is treated as
  composing (like the flag ops) so two mods appending to one list is not a
  conflict; `removeValue` is order-dependent, because it can erase another mod's
  entry, so it is reported and the mod that loads last wins.
- **An added monster or item is drawn from its family in tile mode.** A tile set
  maps named monsters to pictures and has never heard of a mod's, so modded
  content used to stand out as a coloured letter among pictures, and the only
  fix available to an author was a pref file naming *atlas coordinates*, which are
  correct for one tile set and wrong for every other. A monster with no tile of
  its own now takes one from a race sharing its `base`, and an object kind from a
  kind sharing its `tval`, so a modded ant is an ant in every tile set at once.
  Restricted to records a mod ADDED, by provenance, so core's own drawing is
  untouched, including the object kinds that are deliberately blank because they
  are drawn by flavour. Runs in both tile engines. A pref file naming a specific
  tile still wins.
- Tutorial 2 now stocks its item in the Armoury, and its finished mod is checked
  against the real store binder, which is where an item name that does not
  resolve is caught, rather than becoming a shop that quietly lacks it.
- **A seventh tutorial: add an artifact.** The one shape the first six did not
  cover, and the last of the three examples a player asked for by name. An
  artifact is a layer over an item the game already ships rather than an item of
  its own, so it gets its own page: what `base-object` is, why an artifact's
  `name` is only half a name and carries none of the `&` and `~` decoration an
  ordinary item's does, and the trap that a wrong `tval` is reported while a
  wrong `sval` silently invents a placeholder base object, because that is the
  behaviour the Phial, the Star and the Arkenstone depend on. Its finished mod
  is a real folder like the other six, bound by the real object registry rather
  than read back as JSON.

### Fixed

- **A mod's artifact naming a base object that is not there costs the artifact,
  not the game.** Third instance of the store binder's defect, and the first
  where the right size of the drop is the whole record: a shop with one fewer
  stock line is a shop and an ego with one fewer candidate base is an ego, but an
  artifact with no base kind is not an artifact, because every number on it is an
  adjustment to a kind that has to exist. So a mod-contributed artifact whose
  `base-object` resolves to nothing is dropped whole and reported against that
  mod through the same mod-manager path the store and ego drops already use, and
  core's own still throws the message it always threw. Index-safe in the
  direction that matters: core's pack composes first and mods append, so no core
  artifact can sit behind a mod's and a savefile's core artifacts keep their
  numbers. An invalid `flags`, `values` or `act` token on a mod's artifact still
  throws and is recorded in [docs/PLANNED.md](docs/PLANNED.md).
- **The look/target UI ran terrain prefixes into the name: "the entrance to
  theArmoury", "You are inan open door", "somelava".** `terrain.txt` writes every
  `look-prefix` and `look-in-preposition` without a trailing space, and upstream
  separates them from the name in `finish_parse_feat` (`init.c` L2256-2272),
  which appends a space to each non-empty one after the parse. The port copied
  the data faithfully and never ported that hook, so the targeting code's
  `<preposition><prefix><name>` concatenation had nothing between its parts.
  Ten features, three visible strings: the eight store entrances ("the entrance
  to the"), the open and broken doors ("in"), and lava ("some"), plus the
  stores' "at" preposition, which the same normalisation covers. Two comments in
  `known.ts` asserted this was upstream's own data rather than a missing hook
  and are corrected; the assertions that had encoded the unseparated values are
  now the test that would have caught it. A port defect rather than an upstream
  wart: upstream renders these lines correctly, so it belongs in core, not in
  `bug-fixes`.
- **The town laid out eight store lots no matter what the terrain data said, and
  three other post-parse hooks were absent.** `finish_parse_feat`'s trailing-space
  half landed above; the same hook also derives each shop entrance's `shopnum`
  from the order of the `SHOP` flags and counts them into `z_info->store_max`
  (`init.c` L2249-2257, L2275), and the port hard-coded that eight-feature list in
  `town_gen_layout` instead. So a mod that flags another terrain `SHOP` got a
  store with no door anywhere in town, unreachable for the whole game, and one
  that cleared a `SHOP` flag left a lot leading to a shop that no longer existed.
  `FeatureRegistry` now assigns `shopnum` in `FEAT` order and exposes
  `storeMax` / `shopFeats()`, and the town reads those. `TOWN_STORE_FEATS` stays
  as the shipped-data expectation with a test that fails if the two ever part.

  Audited the other twelve `finish_parse_*` hooks against the port at the same
  time. Two more were missing:

  - **A bad critical-level table was accepted in silence.**
    `finish_parse_constants` runs `check_critical_levels` (`init.c` L986-1020) over
    the melee and ranged cutoff tables and refuses the data when the cutoffs do
    not strictly increase, because the `power >= cutoff` walk can never reach a
    row whose cutoff did not rise. That critical grade simply stops happening and
    the damage multiplier is quietly wrong. `bindConstants` did no such check, and
    `melee-critical-level` is a top-level key of the constants record that a mod
    can replace wholesale. It now rejects, with the last row's cutoff exempt
    exactly as upstream leaves it (which is why the shipped tables can end in
    `-1`), and the `o-` tables unchecked exactly as upstream leaves them.
  - **Shopkeeper tips came out in the wrong order.** `parse_hint` prepends onto a
    list and `finish_parse_hints` publishes its head, so upstream's `hints` is in
    reverse `hints.txt` order; `bindCore` published file order. `random_hint`
    reservoir-samples over that list, so the draw count matched and the tip did
    not. Reversed at boot, the way `names.txt` already is for the same reason.

  The remaining ten are reproduced or have nothing to reproduce, recorded here so
  the next audit does not repeat the reading: `player_prop`'s per-element
  expansion and its `bindui` binding are ported (`player/abilities.ts`,
  `game/ui-entry.ts`), `names`' list-to-array reversal (`session/boot.ts`),
  `trap`'s list-to-array with `tidx` (`world/trap.ts`), `history`'s entry
  reversal and successor resolution (`player/bind.ts`), `p_race`'s `ridx` and
  `class`'s `cidx` (array index, `player/bind.ts`); `body`'s `equip_slots_max`
  padding is a no-op for a single 12-slot body and the port carries the real slot
  count; `world`'s level-reference validation has no port subject, since nothing
  binds `world.json`; `realm`, `shape` and `flavor` publish a list and free the
  parser, and `flavor`'s reverse order is reproduced at its reader
  (`obj/flavor.ts`).
- **A shop line naming a missing item took the whole game down.** `bindStore`
  threw on a stock entry it could not resolve, from inside `bindCore` →
  `startGame`, which the host runs at module top level, so the player got the
  crash screen and no game at all. The `append` field op made that reachable from
  an ordinary pair of mods and an ordinary click: mod A appends an item mod B
  defines to a store's `normal` table (tutorial 2 is exactly this patch), the
  player disables mod B, and the appended line now names nothing. A
  mod-contributed entry that resolves to nothing is now dropped and reported
  against the mod on its own row in the mod manager; the rest of the store and
  every other shop in town are untouched. **Core's own data still fails loudly:**
  the tolerance is decided per entry from the record's provenance, so an
  unresolvable line in a store no pack has touched throws exactly the message it
  always threw, which is every store in a modless game. Covers every field a
  patch can reach: `normal`, `always` (including its svalless book lines) and
  `buy` each lose one entry, and a `store:` entrance repointed at a feature that
  does not exist leaves the shop unenterable rather than taking the game down.
  The record keeps its place in the store list, because that list is read
  positionally and renumbering it would move a saved game's stock between shops.
  The owner list resolves no names and so has nothing to refuse.
- **The character dump called every installed content mod "(not installed)".** The
  `[Mods enabled]` block resolved each enabled id's version out of the two bundled
  PLUGIN registries only, so a mod carrying no `plugin.js` (most of them, and all
  of the tutorial mods) matched neither and printed the "(not installed)"
  fallback. A pack in the player's own mods folder was equally invisible whether it
  shipped code or not, since those registries glob the bundle rather than the
  folder. Measured in the running desktop build: two tutorial content packs
  enabled and demonstrably composed, both reported as not installed. The version
  now also resolves through the content-pack registry: every bundled pack plus
  everything from the mods directory, a picked folder, or a repository install,
  and "(not installed)" is kept for an id that genuinely resolves to nothing,
  which is a real state worth a line. This mattered because naming the mods is the
  block's entire purpose: a dump claiming a loaded mod is absent points the reader
  at core for behaviour a mod caused. The list also moved out of `main.ts` into
  `mod-summary.ts` so it is testable at all: the entry module cannot be imported,
  which is why a list that was wrong for every content-only mod stayed green.
- **Monster recall did not know what a monster's KIND implies.** Upstream unions
  each race's base flags into its lore at startup (`finish_parse_lore`), so a
  player who has never met a giant black ant still knows ants are animals with
  weird minds, and that ainu resist fire and cannot be confused. The port had
  the race half of that inheritance and not the lore half, which is exactly why
  nothing noticed, since the flags were on the race all along and simply never
  known. Measured against the shipped pack: 54 of the 56 monster bases carry
  flags, so recall was quieter than upstream's for every monster the player has
  not met. The wizard "wipe monster lore" command still loses them for good,
  because upstream's union runs once at startup and never again; the existing
  wipe test is what caught the first attempt putting it in the wrong place.
- **A curse could multiply an object's weight by a negative number.**
  `finish_parse_curse` refuses a curse that carries `MULTIPLY_WEIGHT` together
  with a negative weight adjustment, and the port had the parser-side weight
  check but not this one: it is a FINISH hook, and the port's own comment said
  as much while never implementing it, which is exactly the blindness a parity
  test written against upstream's parser tests cannot see. Core's own data now
  fails the same way upstream's does. A mod's curse instead loses the FLAG and
  is told: of the two halves, the flag is the one whose removal leaves a
  coherent curse (a plain additive weight reduction), and failing the parse for
  a mod would mean the crash screen and no game. Core ships no curse using the
  flag at all, so nothing shipped changes.
- **An ego's `item:` line naming a missing base item took the game down.** The
  same defect the store's stock table had, in a second file: `item:` names a
  specific base kind, `append` lets one mod add an entry to another pack's list,
  and "mod A gives an ego a base item mod B defines, player disables mod B" then
  reached `ego: unknown sval` out of `bindCore` inside `startGame`, the crash
  screen over one line of one ego. A mod-contributed line that resolves to
  nothing is now dropped from that ego's candidate list and reported against the
  mod; core's own still throws the message it always threw. Dropping one entry is
  the whole cost here, because `poss_items` is a set of candidates and an ego
  with one fewer candidate still works: it simply cannot land on the kind that
  went away, which is what the player asked for by disabling the pack that
  defined it. The core-versus-mod decision itself now lives in one place
  (`mod/refusal.ts`) rather than in each binder, so two binders cannot come to
  different answers about the same provenance.
- **A patch could make a field unreadable and take the game down at boot.** A
  field patch that wrote a scalar, or `null`, over a field core writes as a list
  or an object produced a record that composed perfectly and that no binder could
  read: the store binder's `rec.owner.map(...)` threw a `TypeError` from inside
  `bindCore` inside `startGame`, which the host runs at module top level, so the
  player got the crash screen and no game. The composer already checked this:
  the record check's `field/type` rule fired on it and named the mod, but that
  check reports and never refuses by design, because the blueprint it reads is a
  measurement of core's own records and an unlisted value is legal. Container-ness
  is the exception, since nothing can iterate a string, so the composer now
  refuses that one class: the field is put back to what the record had before, the
  pack is told on its own row, and the rest of the patch still lands. Two things
  it deliberately still allows: a scalar written as the wrong scalar (readable,
  and the measurement cannot prove otherwise), and a patch that REMOVES a field,
  because dropping fields is how a total conversion works and putting them back
  would undo it.
- **Randart games handed out the wrong gems.** flavor.txt writes a ring or
  amulet record's `fixed:` lines above its `flavor:` lines, and the binder bound
  them the other way round, so the flavour list was not in the file's order.
  That list is walked backwards by `flavor_assign_random` (it reproduces C's
  prepend-into-a-linked-list), which makes a flavour's position in it the thing
  that decides which ring it lands on. In an ordinary game nothing showed: a
  fixed flavour keeps its own sval and the random assignment skips it, so the
  random ones kept their relative order and every ring looked right. Under
  `birth_randarts` it did show: `flavor_reset_fixed` scrubs every fixed sval but
  the One Ring's, which drops seven more entries into the random pool at the
  wrong end of the list. The draw COUNT is identical either way, so the RNG
  stream never moved and no seed probe could have caught it; only the assignment
  itself differs, and a test now runs both orders against one seed to show that
  it does under randarts and does not without.
- **Three field-patch ops silently destroyed data instead of failing.** An `add`
  or `mul` aimed at a path holding a list or a string treated it as `0` and wrote
  a number over it; a `merge` aimed at a list replaced the list with an object.
  All three now raise a patch error naming the path and what was actually there.
  This was not theoretical: a documentation example shipped an `add` against a
  store's stock list, which turned the list into a number while composition
  reported no problems at all.

### Changed

- Tutorial 3 no longer says an added monster is stuck as a coloured letter in tile
  mode, and no longer says a mod can carry its own art for its own monsters. A
  mod contributes a whole graphics mode, not one picture added to somebody else's
  set. Both claims had outgrown the code.
- Cleaned up some artifacts in the documentation and in source comments: the
  prose now uses plain ASCII punctuation throughout.

## [0.21.0] - 2026-08-19

Current state of the project at version `0.21.0` - the modding-onboarding
release. Nothing about the game's rules changed; what changed is how much you
have to read before you can modify them.

### Added

- **A `registry:store` discount-roll seam** (`StoreBehaviourRegistry.registerDiscountRoll`,
  `StoreFacade.setDiscountRoll`), alongside the existing stack-size seam. Lets a mod restore
  a store's price-discount roll; core installs no handler, so no store discounts anything
  by default.
- **`feature-restoration`** added to the recommended first-party mods
  ([mods/registry.json](mods/registry.json)): restores spells and mechanics later Angband
  versions quietly dropped, each behind its own opt-in toggle (default off).
- **Six modding tutorials** ([docs/modding/tutorials/](docs/modding/tutorials/README.md)),
  each teaching one idea and ending in a visible result - from changing a single value to
  running code behind a player-facing switch. Every tutorial's finished mod is a real folder
  under `samples/tutorials/`, composed against the shipped game data on every test run and
  checked against the game's own mods-folder reader, so a tutorial cannot go quietly stale
  and its finished mod cannot stop being installable. Copy any of the six into `mods/` to
  run them without typing anything.
- **[Feature restoration](docs/modding/FEATURE_RESTORATION.md)** written up as a named
  concept: vanilla stays vanilla, and dropped mechanics come back as optional mods - with the
  research rules (name the version, respect the modern surrounding system, one switch per
  feature, everything off by default) that keep a restoration honest.
- **The character dump names the enabled mods.** A dump is what players hand each other, and
  a mod's change is indistinguishable from a core bug in one. Written only when a mod is
  enabled, so an unmodded dump is unchanged.

### Changed

- **The README is rewritten for players rather than engineers.** What the project is, why you
  might want it, and how to play come first; parity methodology, architecture and provenance
  move behind links. A prominent "want to make a mod?" path now leads to a tutorial rather
  than to an API reference.
- **`AI_POLICY.md` renamed `AI_USAGE_POLICY.md`**, revised for a clearer disclosure section
  and a narrower, engineering-focused correctness claim.
- **The item and monster tutorials now say what a mod gets for free, and what it does not.**
  An item you add is eligible for every ego, brand, rune and quality enchantment that applies
  to its kind, from the moment the mod is on - a *Padded Jerkin of Resist Fire* needs nothing
  declared. A monster you add carries its own colour but inherits its glyph from its base, and
  in a tile set it keeps drawing as a letter until a mod supplies a tile. Both are now written
  down where the beginner meets them.

### Fixed

- **The tutorials' finished mods could not be installed.** All six shipped in folders whose
  names did not match their manifest ids, and the game refuses such a pack - so the one thing
  a reader is most likely to try, dropping the finished article into `mods/` to compare against
  their own, failed. The folders are renamed and the test suite now drives the game's real
  mods-folder reader rather than assembling the packs itself.
- **Two doc claims the code had already outgrown.** `docs/MODS.md` and
  `docs/modding/MOD_REACH.md` still said a mod installed from disk could supply data only and
  that record layering reached 24 of 44 files. Both gates closed some time ago - a mod folder
  ships `plugin.js` and reaches the capability registries from wherever it was installed
  from, and every record of every shipped file is addressable. The stale passages are marked
  as the before-picture rather than deleted, since the reasoning still explains the design.

### Known limitations

- **A mod cannot add one entry to a list.** Field patches can set, merge, add or remove a flag
  and do arithmetic, but they cannot append to an array - so putting a new item in a shop's
  stock means replacing that shop's whole list, and two mods cannot both do it. Everything
  else about an added item composes cleanly with other mods; this does not.

## [0.20.0] - 2026-08-16

The initial public alpha release.

### Added

- **A TypeScript port of Angband 4.2.6**, checked against the original C down
  to message text and screen layout. Parity is measured rather than merely
  asserted: the port is diffed against thousands of levels generated by the
  real compiled C, across a battery of statistical tests. See
  [docs/PARITY.md](docs/PARITY.md).
- **Web-first, desktop-best.** Play in any current browser, install it as an
  offline PWA, self-host it as static files, or run it as a desktop app for
  Windows, macOS and Linux - all from the same build. The desktop build is the
  recommended way to play: real saves in a real folder, no network, no browser
  reclaiming its storage.
- **Moddable by construction, and it ships no mods.** The base game is itself
  a content pack. Declarative, schema-validated packs for content,
  Linoleum-style tile packs, and sandboxed scripted plugins for the exotic -
  all installing through the same verified route as any third-party mod. See
  [docs/MODS.md](docs/MODS.md).
- **Borg**, a faithful port of Angband's automatic player, riding the mod
  API as its own completeness proof.
- **Deterministic and seeded** generation throughout, with a save format built
  to survive modular content.

[Unreleased]: https://github.com/neostryder/neo-angband/compare/v0.24.0...HEAD
[0.24.0]: https://github.com/neostryder/neo-angband/compare/v0.23.0...v0.24.0
[0.23.0]: https://github.com/neostryder/neo-angband/compare/v0.22.0...v0.23.0
[0.22.0]: https://github.com/neostryder/neo-angband/compare/v0.21.0...v0.22.0
[0.21.0]: https://github.com/neostryder/neo-angband/compare/v0.20.0...v0.21.0
[0.20.0]: https://github.com/neostryder/neo-angband/releases/tag/v0.20.0
