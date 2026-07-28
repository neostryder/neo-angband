# The host platform: what browser-only cost, and the move off it

Written 2026-07-28, after the x_attr layer and the `.prf` surface were ported and
both ran straight into the same wall.

## The question

Is the port giving things up, or jumping through hoops, to stay hostable on a
static site? Should that restriction be dropped?

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

**1. 18 of the 35 remaining text-census absences - 51% - are host-shaped.**
Not hard to read, not subtle C. They need a file, a command line, or a process
that can be signalled:

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

**2. One canvas silently hollowed out four features.** `ANGBAND_TERM_MAX` is 8
(`ui-term.h:244`). Because the port has one:

- the `=` → `w` "Subwindow setup" row is excused (`packages/web/src/options.ts:607`);
- core's `optionDump()` returns **only** `"# Options\n\n"`, where upstream's
  `option_dump` (`ui-prefs.c:352`) writes a `window:i:j:1` line per set flag per
  term;
- so the "Save subwindow setup to pref file" row - shipped earlier the same day -
  always writes an empty file;
- and the `window:` pref directive parses correctly into nothing.

One platform limit, four features, and only the first was written down.

**3. The external-mod-manager decision is architecturally impossible.** The
recorded division of labour is that Vortex/MO2 own load-order and bulk mod work
over the shared **on-disk** pack format. A browser origin cannot read a directory
a mod manager writes. The current desktop wrapper serves a `userData/mods`
directory read-only over HTTP with a `/mods/index.json` listing - a half-step
nothing can install *into*.

**4. Everything shares one evictable bucket.** Saves, scores, colours, keymaps,
tile mode, sidebar mode, birth records and the entire virtual user directory are
all in `localStorage` on one origin. Under the no-save-scum, death-is-permanent
policy, a "Clear browsing data" or a quota eviction is unrecoverable character
loss. `writeUserFileChecked` has to do a read-back purely to catch a `setItem`
that silently stored nothing - a hoop that exists only because this is not a
filesystem.

**5. The split forced a second front end for anything host-shaped, and it bred
stand-ins.** `wiz-stats` lives in the CLI, so the in-game wizard command cannot
reach it. The same pressure produced the "use the CLI" spoiler line,
`wizDumpLevelMap`, and the PNG screen dump - each an *invented* function rather
than a port of one. A stand-in is worse than a gap: it fills the slot, so
neither census can see it.

**6. No `argv`, no signals.** `main.c`'s whole switch surface and the
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

**Phase 2 - wire the 18.** Each becomes present on the full-capability adapters,
and the census gains a *present-on-desktop* verdict instead of an excuse.

**Phase 3 - real subwindows.** `BrowserWindow` per term, the flags screen, the
`window:` directive, and a real `option_dump` replacing the stub.

**Phase 4 - the on-disk pack layout,** so Vortex/MO2 have something to deploy
into and the recorded division of labour becomes true.

**Phase 5 - real savefiles on desktop,** which also restores `ui-birth.c:1292`'s
overwrite prompt, plus explicit import/export so a character can move between
the web and desktop builds.

## The rule this encodes

The reference C defines the semantics. A front end either expresses them or is
recorded as reduced, via `capabilities`. **What a front end cannot do must never
edit what the game is.**
