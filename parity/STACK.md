# The stack, and the route to a faithful TypeScript Angband with mods

Written 2026-07-28, answering: given a faithful port plus a mod system, all in
TypeScript, what is the best route and stack?

Read `PLATFORM.md` first for the measurement this rests on.

## The short answer

**The stack was never the problem. A missing layer was.**

Nothing here needs replacing - not TypeScript, not pnpm, not Vite, not Vitest,
not Electron. What was missing is the thing upstream has and this port did not:
a host layer between the game and the platform. Without it, every feature that
needed a file asked the browser, got "no", and was reshaped to fit the answer.
Eighteen of the thirty-five remaining census absences - 51% - are that, and
nothing else.

**A Node server is not needed either.** It was offered, and the honest answer is
no: Electron's main process already *is* a Node process. Putting the filesystem
behind HTTP would add a network hop, a second failure mode, and force the whole
host layer to be asynchronous - which would then push `await` up through the
command layer and let the transport reshape the game's control flow. The existing
loopback HTTP server in the desktop shell is for COOP/COEP headers, not for files.

## The shape

Upstream's arrangement, which is the target:

```
              rules, no I/O            -> packages/core
                    |
              ONE host layer           -> z-file.c + init.c's ANGBAND_DIR_*
                    |
   +----------------+----------------+
   |                |                |
main-sdl2.c      main-gcu.c      main-win.c      (front ends)
```

What the port has now:

```
              packages/core           rules, no I/O
                    |
        core/src/host/  (HostIo)      z-file.c's shape, injectable
                    |
   +----------------+----------------+
   |                |                |
packages/web    packages/cli   packages/desktop
BrowserHost     NodeHost       NodeRawFs over IPC
(reduced,       (full)         (full)
 and says so)
```

`packages/mod-sdk`, `packages/content`, `packages/linoleum` and `packages/borg`
hang off core, unaffected: mods are a core-level concern, not a platform one.

## The stack, item by item

| Layer | Choice | Verdict |
| --- | --- | --- |
| Language | TypeScript, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | **Keep.** The type system has caught real parity bugs, including one this session (see "mutation-proven" below). |
| Packages | pnpm workspaces, `tsc -b` project references | **Keep.** Project references are what let the desktop front end join the same gate as the others. |
| Web build | Vite + `vite-plugin-pwa` | **Keep.** Zero-install play is the best thing about this port's distribution. |
| Tests | Vitest | **Keep.** 5 900+ tests; the ratchet the whole port rests on. |
| Desktop | Electron | **Keep, and promote** from distribution wrapper to capability wrapper. |
| Desktop main build | esbuild → two self-contained `.cjs` files | **New.** See below. |
| Server | none | **Correctly absent.** |

### Why Electron, not Tauri

- **One Chromium.** Tauri uses the OS webview (WebView2 / WKWebView /
  WebKitGTK), so canvas and font rendering differ per platform. This port has
  pixel-equivalence tests on the tile engine. Decisive.
- **No new toolchain.** The main process is Node, so the real-filesystem adapter
  is *shared* with the CLI rather than reimplemented.
- **`BrowserWindow` per subwindow** is the direct analogue of `angband_term[i]`.

Tauri's win is bundle size (~5 MB against ~150 MB). For a desktop roguelike that
is the cheapest thing on the table to give up.

### Why esbuild for the main process

The main process needs `NodeRawFs` - the same real-filesystem adapter the CLI
uses - because the alternative is a second hand-written copy of z-file.c's
syscalls, and two copies drift. Getting a workspace package into an Electron main
process without a bundler means shipping pnpm's `node_modules` symlinks inside
the packaged app, which is the fragile part of Electron packaging. Bundling
produces two self-contained CommonJS files and electron-builder has nothing to
resolve.

## The one design decision worth stating

**The host layer is synchronous, including across the process boundary.**

`z-file.c` is synchronous and so is every caller of it: `prefs_save` writes
inside a menu handler, the panic save writes from a signal handler, the game loop
reads a pref file inline. So the Electron bridge uses `ipcRenderer.sendSync`.

That is normally discouraged, and here it is right. An async host would push
`await` up through the entire command layer and change the game's control flow to
suit the transport - the same category of mistake as letting the browser decide
what a file is. The writes are a few kilobytes to a local disk.

## Route

Five phases. Each is independently shippable and leaves the web build working.

**Phase 1 - the seam.** DONE (`0c0cfea48`). `HostIo` + `HostCapabilities` +
`textLinesToFile` in core; `MemoryHost`, `NodeHost`, `BrowserHost`; wired at web
startup so it is not dead code.

**Phase 2a - the capability wrapper.** DONE (this commit). The split that keeps
one copy of the rules, the wire with both ends in one file, a TypeScript Electron
main process, and `ElectronHost` chosen over `BrowserHost` at startup.

Verified by running the real shell, not by reading it:

- the five `ANGBAND_DIR_*` directories appear under
  `%APPDATA%\Neo Angband\` (init.c's `create_needed_dirs`, in a real main process);
- `window.neoHostFs.argv` in the live renderer returns the process's ACTUAL
  command line, which is how we know argv comes from the main process and not
  from the renderer's Chromium switch list;
- a write through the bridge lands on disk, `displayPath` returns the real
  absolute Windows path, and `../escaped.txt` is refused with nothing written
  outside the directory;
- and the decisive one: driven through its own UI (`=` → `v` → `b`), the game
  wrote a 21 169-byte monster attr/chars dump to
  `%APPDATA%\Neo Angband\user\`. Under `BrowserHost` that would have gone to
  localStorage and the disk would have stayed empty, so this is what proves
  `setHost` installed the desktop host rather than merely that the bridge exists.

Two things this turned up that were not on any list:

1. **The desktop build had never been runnable.** pnpm 10 blocks postinstall
   scripts unless allowlisted, and Electron's postinstall is what downloads the
   Chromium binary - so `electron .` died with "Electron failed to install
   correctly". Fixed by `onlyBuiltDependencies` in `pnpm-workspace.yaml`.
2. **Savefiles were going to land in a directory called `@neo-angband/desktop`,**
   because Electron derives `userData` from the package name and this is a scoped
   workspace package. Fixed with `app.setName("Neo Angband")` before the first
   `getPath("userData")`, which caches.

**Phase 2b - wire the 18.** `wiz-stats` ×8, `obj-power` ×2, `obj-randart` ×2,
`ui-command` ×2, `ui-game` ×2, `ui-birth` ×1, `ui-player` ×1. Each becomes
present on the full-capability adapters, and the census gains a
*present-on-desktop* verdict instead of an excuse.

**Phase 3 - real subwindows.** `BrowserWindow` per term 1..7, the `=` → `w`
flags screen (ui-options.c:386-405), the `window:` pref directive, and a real
`option_dump` replacing core's `"# Options\n\n"` stub.

**Phase 4 - the on-disk pack layout,** so Vortex/MO2 have something to deploy
into and the recorded division of labour becomes true.

**Phase 5 - real savefiles on desktop,** which also restores ui-birth.c:1292's
overwrite prompt, plus explicit import/export so a character can move between the
web and desktop builds.

## What "done" means

The **desktop build is the parity bar**; the web build is a documented
reduced-capability front end. That is upstream's own arrangement - `main-gcu`
cannot show subwindows either - and it is the only version where 100% parity is
reachable rather than permanently 18 short.

The web build stays first-class as a *distribution*: click-a-link play, free
static hosting, PWA offline install. None of that is given up.

## The rule this encodes

The reference C defines the semantics. A front end either expresses them or is
recorded as reduced, via `capabilities`. **What a front end cannot do must never
edit what the game is.**
