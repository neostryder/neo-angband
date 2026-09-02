# The host platform: what browser-only cost, and the move off it

Written 2026-07-28, after the x_attr layer and the `.prf` surface were ported and
both ran straight into the same wall.

## The question

Is the port giving things up, or jumping through hoops, to stay hostable on a
static site? Should that restriction be dropped?

## Ratified 2026-07-28: the desktop build is the parity bar

The decision, in full: parity is measured against the desktop build, which
must carry the fulness of all the features, including mod support. Keeping the
static site playable alongside it is a bonus, not a competing requirement.

So:

- Parity is measured against the desktop build. "Done" means the desktop
  build expresses everything the reference C does. A thing the browser cannot do
  is no longer a reason for the game not to do it.
- The web build stays, and stays playable on a static site. It is a *reduced
  front end* - which is exactly `main-gcu.c`'s position upstream, not a
  second-class one - and every reduction is declared through `capabilities` and
  listed in the parity matrix (`docs/INSTALL.md`), never silently.
- Mod support in full is a desktop requirement, including the on-disk pack
  layout an external manager can deploy into (Phase 4). The browser keeps what it
  can host - which turned out to be more than this line first claimed: the bundled
  mods, the in-app manager, *and* a real mods folder the player points it at (see
  the correction under cost 3).

The desktop build is also **self-contained by default** (ratified 2026-07-28, in
answer to what "portable" was asked to mean):

> When I said portable, I meant that the executable and its config and data and
> saves and everything are bundled into the same local folder instead of smearing
> them across the OS user's folder or applications folder. [...] All mods would
> then be right in with the app.

So the folder holds all of it - program, settings, savefiles, scores, dumps, mods,
and Chromium's own caches - and the OS user directory is used only where keeping
data in the folder would destroy it (an installed copy, whose uninstaller deletes
the directory) or is not permitted (a read-only location, a signed `.app` bundle).
That is `main-win.c`'s shape, where a downloaded Angband is an executable with
`lib/` beside it. Resolution order and the exceptions: `docs/INSTALL.md` section 4.

Two things this cost that reading the config would not have found. Electron
resolves `sessionData`, `crashDumps` and `logs` separately from `userData`, so all
four have to be redirected or the "self-contained" copy still leaves its caches -
and the browser localStorage the characters currently live in - in the user
profile. And an installed copy and an unzipped copy are IDENTICAL on disk, so the
game cannot tell them apart by looking: the installer has to mark its own work
(`build/installer.nsh`), and unmarked has to mean portable. Marked that way round
deliberately - a missing marker keeps data in the folder, which is recoverable,
where the inverse would scatter a deliberately-portable copy into the profile.

## The answer: yes to both, but the fix is not "leave the browser"

The restriction has been costing real parity, and the cost is measurable rather
than a matter of taste. But the conclusion is **not** to abandon the web build.
It is to stop letting the browser define what the game *is*.

Upstream is not a browser program that happens to run on desktops. It is a
desktop program with several front ends - `main-sdl2.c`, `main-gcu.c`,
`main-win.c` - over **one** host layer (`z-file.c`) and **one** directory set
(`init.c`'s `ANGBAND_DIR_*`). The port had the first half of that shape: a
platform-agnostic `packages/core` with the front end in `packages/web`. It did
not have the second half. Every feature that needed a file asked the browser, got
"no", and was then quietly reshaped to fit the answer.

That reshaping is the defect. The reference C defines the semantics; a front end
either expresses them or is *recorded* as reduced.

## What it cost (each item verified 2026-07-28, not recalled)

1. 18 of the 35 remaining text-census absences (51%) are host-shaped.
Not hard to read, not subtle C. They need a file, a command line, or a process
that can be signalled:

> **Corrected 2026-07-28, later the same day.** Sixteen, not eighteen. `pricing.log`
> x2 sits inside `#ifdef PRICE_DEBUG`, and PRICE_DEBUG is defined **nowhere** in
> the upstream tree - not in `configure.ac`, not in any Makefile - so those two
> lines are unreachable in every build upstream ships and are not owed on any
> platform. The `wiz-stats` x8 stay owed, but to `packages/cli` (which *is* this
> port's stats build) rather than to the game: `USE_STATS` is opt-in and needs
> sqlite3, and the interactive build already reports the other arm honestly
> ("Statistics generation not turned on in this build."). The conclusion does not
> change; the number does, and it was mine to correct.

| Source | Count | What it needs |
| --- | --- | --- |
| `wiz-stats.c` | 8 | `stats.log`, `disconnect.html`, `disconnect_gstat.txt` |
| `obj-power.c` | 2 | `pricing.log` |
| `obj-randart.c` | 2 | `randart.log` - reachable in a **stock** build whenever `birth_randarts` is on |
| `ui-command.c` | 2 | the screen-dump file, and the prompt that chooses its format |
| `ui-game.c` | 2 | the signal-handler panic save; `lore.txt` |
| `ui-birth.c` | 1 | a savefile *directory*, for "A savefile for that name exists. Overwrite it?" |
| `ui-player.c` | 1 | `argv`, for `-f` / `arg_force_name` |

The other 17 are unaffected by platform: ten defensive "Please report this bug"
messages, `mon-spell`'s three, `player-util`'s two shape lookups, one
`cmd-wizard` prompt, and the glyph picker.

2. One canvas silently hollowed out four features. `ANGBAND_TERM_MAX` is 8
(`ui-term.h:244`). Because the port has one:

- the `=` -> `w` "Subwindow setup" row is excused (`packages/web/src/options.ts:607`);
- core's `optionDump()` returns **only** `"# Options\n\n"`, where upstream's
  `option_dump` (`ui-prefs.c:352`) writes a `window:i:j:1` line per set flag per
  term;
- so the "Save subwindow setup to pref file" row - shipped earlier the same day -
  always writes an empty file;
- and the `window:` pref directive parses correctly into nothing.

One platform limit, four features, and only the first was written down.

3. The external-mod-manager decision is architecturally impossible. The
recorded division of labour is that Vortex/MO2 own load-order and bulk mod work
over the shared **on-disk** pack format. A browser origin cannot read a directory
a mod manager writes. The current desktop wrapper serves a `userData/mods`
directory read-only over HTTP with a `/mods/index.json` listing - a half-step
nothing can install *into*.

> **My own sentence above was wrong, and corrected 2026-07-28 later the same day.**
> "A browser origin cannot read a directory a mod manager writes" was true of the
> platform I was thinking of and false of the one shipping. `showDirectoryPicker()`
> hands the page a real `FileSystemDirectoryHandle`, and the handle is structured-
> cloneable, so IndexedDB keeps it and every later launch reads the SAME folder
> without asking again. The bytes a mod manager deploys there are the bytes the tab
> reads. This is the second time a "the browser cannot" premise turned out to be a
> statement about an older web - the first cost this port eighteen census absences -
> so the rule is: check the API, do not recall the limit.
>
> **DONE.** `web/src/mod-folder.ts` supplies the handle; `disk-packs.ts` was split
> into a source-agnostic `readModDir(source)` plus two sources (the shell's HTTP
> index, a picked directory), so every rule about what a usable mod IS lives once
> and both platforms obey it identically. A single mod's own folder is accepted as
> well as a folder of mods, because that is what a player actually picks first.
> Verified live: booting a tab opens the handle store and correctly reports no
> folder; 28 tests, three mutations proven.
>
> What is genuinely reduced in a browser, and now stated in the UI rather than
> excused: the player picks the folder once (a page may not browse a filesystem
> uninvited); the permission can lapse, so the row reads `NEEDS RECONNECTING` and a
> keypress re-grants it; the page is told the folder's name and never its path; and
> Firefox and Safari cannot pick a directory at all, where `folderPickingSupported`
> reports it and the manager offers no dead row.

> **Measured 2026-07-28, and worse than "a half-step": the seam was DEAD.** The
> main process served `/mods/index.json` and `/mods/<name>/...`, and the preload
> exposed `modsBaseUrl` / `modsIndexUrl` on `window.neoDesktop` - and *nothing in
> `packages/web/src` read either of them*. A folder dropped into `mods/` was listed
> by a server nobody asked and loaded by nobody.
>
> **FIXED (Phase 4, same day).** `web/src/disk-packs.ts` reads the directory at
> boot, validates each manifest, and merges the packs into the same discovery map
> the bundled ones use; `load-order.json` is the external manager's file, and a
> player's explicit toggle outranks it in both directions. Verified by deploying a
> real folder into the data directory's `mods\` and launching: the pack appears in
> the in-game manager as `[x] Disk Hound (folder-deployed proof) ... ! noscore`,
> at its load-order position, with its own description and its `affectsGameplay`
> warning, and the "Where mods come from" screen names the real path. Format
> documented at `docs/MODS.md#where-a-pack-lives-on-disk`.

4. Everything shares one evictable bucket. Saves, scores, colours, keymaps,
tile mode, sidebar mode, birth records and the entire virtual user directory are
all in `localStorage` on one origin. Under the no-save-scum, death-is-permanent
policy, a "Clear browsing data" or a quota eviction is unrecoverable character
loss. `writeUserFileChecked` has to do a read-back purely to catch a `setItem`
that silently stored nothing - a hoop that exists only because this is not a
filesystem.

> **Measured 2026-07-28, and the quota half is FIXED.** The saves were being
> written as bare JSON - `compressed` is one of decision 9's three words and was
> the one never implemented. Sizes: 135 KiB in town, 337 KiB at DL20, 391 KiB at
> DL50, each a third larger again once base64'd for `localStorage`. Against a
> ~5 MB origin quota that is about **nine characters**, and `birth_levels_persist`
> can spend it on one. gzip measures at ratio 0.04 on this data (the chunk grids
> and known-map arrays are hugely repetitive).
>
> Core now owns a `SaveCodec` seam (`core/src/save/compress.ts`) - the envelope
> `NGSC1:<id>\n`, the sniffing, and the rule that an unknown codec is *reported*
> rather than guessed - and the front end supplies the compressor, because the
> save path is synchronous (`z-file.c` is) and the browser's own
> `CompressionStream` is async. Verified end to end on a real pre-existing
> uncompressed save in the live app: it resumed at turn 390, the anti-scum flush
> rewrote it at **178 012 -> 11 988 base64 chars (14.8x)** with the gzip magic
> after the envelope, and the next launch resumed from the compressed file at the
> same turn and grid. Roughly 437 characters now fit where 29 did.
>
> Two things this deliberately does NOT fix, so they are not mistaken for done:
> eviction (a compressed bucket is still an evictable one - only the desktop
> build's real files answer that), and decision 9's remaining word,
> **schema-validated**: the load path still checks the version integer and
> nothing else.
>
> **The eviction half is now ANSWERED IN PART, 2026-07-28, and "only real files"
> was again too pessimistic.** A browser bucket is best-effort *by default*, not by
> nature: `navigator.storage.persist()` moves the origin to persistent, which is
> exempt from the browser's own eviction. `web/src/storage-persist.ts` asks for it
> once, at the moment the first character save of a session lands - not at boot,
> where there is nothing to protect and an engine that prompts would be prompting
> about nothing - and the character-select screen carries a one-line warning while
> the answer is no. Measured: a fresh dev origin on localhost is REFUSED (Chromium
> grants by site engagement, and an installed PWA is the strongest signal), which is
> exactly why the notice exists rather than an assumption that asking works.
>
> Still not fixed, and not to be mistaken for done: the player's own "clear browsing
> data" erases everything regardless; the grant is never guaranteed on any engine;
> and only real files on disk answer it completely, which remains Phase 5.

5. The split forced a second front end for anything host-shaped, and it bred
stand-ins. `wiz-stats` lives in the CLI, so the in-game wizard command cannot
reach it. The same pressure produced the "use the CLI" spoiler line,
`wizDumpLevelMap`, and the PNG screen dump - each an *invented* function rather
than a port of one. A stand-in is worse than a gap: it fills the slot, so
neither census can see it.

6. No `argv`, no signals. `main.c`'s whole switch surface and the
panic-save signal handler have no way to be reached.

## What the browser genuinely buys - and keeps

- Click-a-link, zero-install play. That is what the public-alpha work was for,
  and it is the single best thing about this port's distribution.
- Free static hosting that already deploys green.
- PWA offline install.

None of that is given up. The web build stays a first-class front end. It simply
stops being the definition of the game.

## The platform: Electron

Chosen over Tauri and over a plain Node/terminal build.

- **Already here.** `packages/desktop` exists with `electron-builder` configured
  for Windows/macOS/Linux. It is currently a *distribution* wrapper - it serves
  the same web bundle - not a *capability* wrapper.
- **No new toolchain.** The repo is TypeScript and pnpm throughout; the Electron
  main process is Node, so the real-filesystem adapter is shared with the CLI
  rather than reimplemented.
- **Real windows map onto real terms.** `BrowserWindow` per subwindow is the
  direct analogue of `angband_term[i]`.
- **Decisive: one Chromium.** Tauri uses the OS webview (WebView2 / WKWebView /
  WebKitGTK), so canvas and font rendering differ per platform. This port has
  pixel-equivalence tests on the tile engine. Electron ships one renderer, so
  pixels match across desktop *and* the web build.

Tauri's win is bundle size (~5 MB against ~150 MB). For a desktop roguelike that
is the cheapest thing on the table to give up.

## The plan

**Phase 1 - the seam.** `packages/core/src/host/io.ts`: a `HostIo` interface
shaped like `z-file.c` (`exists`/`read`/`write`/`remove`/`move`/`newer`/`list`,
plus `argv`) over `init.c`'s five writable directories, and a
`HostCapabilities` record so a screen *asks* what the platform can do instead of
assuming. Three adapters: `MemoryHost` (core, reference implementation + tests),
`NodeHost` (CLI and the Electron main process), `BrowserHost` (web, reduced and
saying so).

Two details that are load-bearing rather than stylistic:

- `write` returns `"ok" | "create-failed" | "close-failed"`, because upstream
  reports the open failure and the close failure with **different** messages at
  the same call site (`wiz-spoil.c`).
- `newer` returns `boolean | null`. `BrowserHost` returns `null` - "cannot tell" -
  because `localStorage` stores no mtime. Guessing `false` would have silently
  deleted upstream's panic-save prompt; `null` forces the caller to handle it.

**Phase 2a - the capability wrapper.** DONE. `RawFs` / `RawFsHost` split so
z-file.c's rules exist once for both real-filesystem front ends; `host/bridge.ts`
with both ends of the wire in one file; a TypeScript Electron main process serving
it over one synchronous channel; and `ElectronHost` installed in preference to
`BrowserHost`. Verified by driving the built shell - see `STACK.md`.

**Phase 2b - wire the 18.** Each becomes present on the full-capability adapters,
and the census gains a *present-on-desktop* verdict instead of an excuse.

> **Measured 2026-08-03, item by item. Phase 2b is nearly closed, and one item
> turned out to be a behavioural gap rather than a file one.**
>
> | Item | State |
> | --- | --- |
> | `ui-command.c` x2 - screen dump + format prompt | **DONE.** `screenDumpCmd` writes both TEXT formats through the host, tagged `FTYPE_HTML`. |
> | `ui-player.c` x1 - `argv` for `-f` / `arg_force_name` | **DONE.** `launch.ts` reads `host().argv()`; `argForceName()` gates get_file's timestamp branch. |
> | `ui-game.c` - `lore.txt` | **DONE 2026-08-03**, and it was mis-classified. `lore_save` is not a dump: the user directory outlives a character, so upstream's monster memory *survives death* - `tkills` is "killed in all lives" and mon-lore.c says "your ancestors have exterminated at least %d". The port kept the whole lore record in the savefile, which is why nothing noticed and why that sentence could never be true. Both halves of the file are now `core/src/mon/lore-file.ts`, wired in `web/src/lore-file.ts`. |
> | `ui-game.c` - the panic save | **RATIFIED AS N/A**, with a mechanism, not an excuse: the panic file exists because upstream saves on demand, so a crash leaves the signal handler's file ahead of the savefile. This port autosaves the live slot continuously, so there is no second artifact and no window in which one could be newer. Recorded on `"A panic save exists.  Use it? "` in `cli/src/text-census.test.ts`. |
> | `obj-power.c` x2 - `pricing.log` | **RATIFIED AS N/A.** Inside `#ifdef PRICE_DEBUG`, and PRICE_DEBUG is defined nowhere upstream. |
> | `wiz-stats.c` x8 | **OWED TO `packages/cli`**, not to the game: `USE_STATS` is opt-in and needs sqlite3, and the interactive build already reports the other arm honestly. |
> | `obj-randart.c` x2 - `randart.log` | **STILL OPEN, and genuinely owed.** Not `#ifdef`'d, written whenever randarts are generated, and upstream `exit(1)`s if it cannot be opened - so it is part of a stock build with `birth_randarts` on. 193 `file_putf` call sites threaded through the generator (`randart-data.ts` / `randart-build.ts` both say the logging "is dropped throughout"). Mechanical but large; the port has every corresponding code path, so each line has a known home. |
> | `ui-birth.c` x1 - "A savefile for that name exists.  Overwrite it?" | **DIVERGENCE, upheld.** Upstream derives the savefile PATH from the character name, so two characters of one name are one file; the roster keys slots by UUID and nothing dedupes on name, so there is no file to overwrite. |
>
> So of the sixteen: eleven done or ratified N/A, eight owed to the CLI's stats
> build, two (`randart.log`) genuinely open, one upheld divergence.
>
> **What this exercise actually found**, and the reason it was worth doing at the
> level of "port it wherever you can make it work": the dumps were routed around
> the host seam entirely. `charsheet.ts`, `equip-cmp.ts`, `main.ts`, `wizard.ts`
> and `overlay.ts` imported `userdir.ts` - localStorage - directly, so on the
> desktop build every dump still went into localStorage while `RawFsHost` sat
> unused beside it. Only `prefs-ui.ts` went through `host()`. Phase 2a built the
> seam correctly and Phase 2b's own consumers never used it; `web/src/user-io.ts`
> is now the only door, and `user-io.test.ts` fails if a module goes round it.

**Phase 3 - real subwindows.** `BrowserWindow` per term, the flags screen, the
`window:` directive, and a real `option_dump` replacing the stub.

**Phase 4 - the on-disk pack layout,** so Vortex/MO2 have something to deploy
into and the recorded division of labour becomes true.

**Phase 5 - real savefiles on desktop,** which also restores `ui-birth.c:1292`'s
overwrite prompt, plus explicit import/export so a character can move between
the web and desktop builds.

## Classified 2026-07-28: the character-select screen is `get_savefile_selection`

Left open in an earlier session, and now decided. `packages/web/src/charselect.ts`
is a port-invented screen standing where upstream has
`get_savefile_selection` (`ui-game.c:838-860`). Three ways to classify it, and it
is the first:

**It is part of the core port, as the host equivalent.** Upstream answers "which
savefile" with `argv` - `-u<name>`, `arg_force_name` - and failing that with a
front-end prompt. A browser tab has no `argv` and no file dialogue, so *something*
has to ask, and a front end that could not ask would simply be unable to reach a
second character. That is the definition of a NECESSARY platform accommodation
under the ratified rule, so it belongs in the port, not in a mod, and it is
recorded here rather than being quietly excused as a "web reduction". A mod would
be wrong twice over: mods are additive, and a disabled mod's patches do not exist,
which would leave a build with no way to choose a character at all.

The multi-character roster it lists is not an invention either. Upstream has always
had many savefiles; it just keeps them in a directory the OS browses. The port
keeps them in one storage area and browses it itself.

What this classification then OWES upstream, tracked on #114 rather than done here:
`-u<name>` must skip the screen exactly as `arg_force_name` does, and both
`arg_force_name` branches (`ui-game.c:846` and `:855`) need their real prompts.
Those only become meaningful once a save is a file, which is Phase 5's job; the
desktop shell already parses the argument.

## The rule this encodes

The reference C defines the semantics. A front end either expresses them or is
recorded as reduced, via `capabilities`. **What a front end cannot do must never
edit what the game is.**
