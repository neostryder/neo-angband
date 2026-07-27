# Playing and installing Neo Angband

Neo Angband is **alpha software** and the point of this page is to get you onto a
build **you control**, because that is the only kind of build a bug report can be
pinned to. Deliberately, no hosted demo URL appears here: a hosted copy can
change under you between sessions, so "it did X" stops being reproducible.

One web app, four ways to run it, all from the *same* build:

| | Best for | Start at |
|---|---|---|
| **From source (dev server)** | testing, and fixing what you find | [§1](#1-run-it-from-source-recommended-for-testing) |
| **Self-hosted static site** | your own copy, or one for a group | [§2](#2-self-host-as-a-static-site) |
| **Installed PWA** | playing offline on a phone or tablet | [§3](#3-install-as-a-pwa-offline-any-platform) |
| **Desktop app (Electron)** | a double-click native install | [§4](#4-desktop-app-electron) |

The engine, content, saves, and the entire mod framework behave the same on all
four. Where a surface genuinely differs, it is called out in the
[parity matrix](#parity-matrix) rather than left as a hidden gap.

**Prerequisites** for everything except the PWA install: [Node](https://nodejs.org/)
22 or newer, and [pnpm](https://pnpm.io/installation) 10 (run `corepack enable`
and pnpm comes with Node). Everything below assumes you have cloned the repo and
run `pnpm install` once at its root.

---

## 1. Run it from source (recommended for testing)

```sh
git clone https://github.com/neostryder/neo-angband.git
cd neo-angband
pnpm install
pnpm --filter @neo-angband/web dev
```

Open **http://localhost:5178**. That is it - there is no build step to wait for
and no configuration. The dev server hot-reloads, so if you change a file the
page updates.

This is the setup to use when you are hunting for differences from the original:
you know exactly which commit you are playing (`git rev-parse --short HEAD`), and
you can put that commit in a bug report.

To run the test suite while you work:

```sh
pnpm test                  # everything
pnpm test packages/core    # one area
```

---

## 2. Self-host as a static site

The production build is a folder of static files - no server code, no database,
no runtime fetches. Host it on GitHub Pages, Netlify, S3, nginx, or any static
file host.

```sh
# from the repo root
pnpm install
pnpm --filter @neo-angband/web bundle
# the built site is now in packages/web/dist-web/
```

Serve the contents of `packages/web/dist-web/` at any path. The build uses a
**relative base** (`base: "./"`), so it works whether you serve it at a domain
root (`https://example.com/`) or a subpath (`https://example.com/neo-angband/`)
- no reconfiguration needed.

Quick local check:

```sh
cd packages/web/dist-web
python3 -m http.server 8080   # then open http://localhost:8080/
```

Notes:
- Serve over **https** (or `localhost`) so the PWA/service worker and offline
  install work. Plain `http://` on a remote host disables install.
- For the optional cross-origin-isolated features (see the parity matrix), send
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`. Most static hosts (including
  GitHub Pages) cannot send custom headers; the game runs fine without them.

---

## 3. Install as a PWA (offline, any platform)

The game is a Progressive Web App, so any build served over **https** (or from
`localhost`) can be installed and then played with no network at all. Install it
from your own build in §1 or §2 - that keeps you on a version you control.

- **Desktop Chrome / Edge:** click the install icon in the address bar (or menu
  -> "Install Neo Angband..."), then launch it like any app.
- **Android (Chrome):** menu -> "Add to Home screen" / "Install app".
- **iOS / iPadOS (Safari):** Share -> "Add to Home Screen".
- **Firefox:** desktop Firefox does not install PWAs; use the browser tab, or
  Chrome/Edge, or the desktop app below.

Once installed, the service worker caches the whole game, so it works offline.
Updates apply automatically the next time you load it online.

Note the storage consequence: **an installed PWA and the tab you installed it
from may be separate save stores** if their origins differ. See
[Saves are per-surface](#saves-are-per-surface).

---

## 4. Desktop app (Electron)

The desktop build (`packages/desktop`) is a thin native wrapper around the exact
same web bundle: a native window, offline by default, with room to grow
filesystem-based mod loading. It is optional - the browser and PWA are fully
featured on their own.

### Run it from source

```sh
# one time
pnpm install                       # installs Electron (a large download)

# build the web bundle, then launch the desktop app
pnpm --filter @neo-angband/desktop dev
```

`dev` builds `packages/web/dist-web` and then opens it in the Electron window.
If you have already built the web bundle, `pnpm --filter @neo-angband/desktop
start` launches without rebuilding.

### Package installers

```sh
pnpm --filter @neo-angband/desktop dist
```

This produces platform installers in `packages/desktop/dist-desktop/`
(Windows `.exe`/NSIS, macOS `.dmg`, Linux `.AppImage`/`.deb`) via
electron-builder. Run it on the target OS (cross-building, especially for macOS,
has its own toolchain requirements).

**Signing.** The produced macOS `.dmg` and Windows `.exe` are unsigned, so a
first run may hit Gatekeeper (macOS) or SmartScreen (Windows). Signing and
notarization require developer certificates and are left to whoever cuts a
distribution.

### What the desktop build adds

- **Offline and native by default** - no browser, no address bar; launches like
  any installed app.
- **A user mods folder.** The app serves a `mods/` directory (under the OS user-
  data path) to the game. This is the seam for loading mods from disk - the
  filesystem/URL mod install the web build intentionally cannot do (see the mod
  manager's "Install from URL" note). The folder is created on first launch;
  wiring the game's loader to read runtime mods from it is the next desktop
  increment.
- **Cross-origin isolation.** The desktop build serves the app with COOP/COEP
  headers, so `SharedArrayBuffer` is available. Nothing requires it today, but
  it is the one capability a static host cannot provide (see the matrix).

---

## Parity matrix

The same game everywhere. This table is the honest, per-surface difference list
- if a row is not called out, it behaves identically.

| Capability | Browser | PWA (installed) | Static self-host | Desktop (Electron) |
|---|---|---|---|---|
| Full gameplay (faithful 4.2.6) | Yes | Yes | Yes | Yes |
| Saves persist across sessions | Yes (localStorage) | Yes (localStorage) | Yes (localStorage) | Yes (localStorage) |
| Works offline | Only after first load (SW) | Yes | Only after first load (SW) | Yes (always) |
| Responsive / any viewport | Yes | Yes | Yes | Yes |
| Bundled mods + in-app mod manager | Yes | Yes | Yes | Yes |
| Enable / disable / reorder / consent / profiles | Yes | Yes | Yes | Yes |
| Content-pack mods (bundled) | Yes | Yes | Yes | Yes |
| Trusted in-process system-override mods | Yes | Yes | Yes | Yes |
| Untrusted sandbox (Worker) mods | Yes | Yes | Yes | Yes |
| Install mods from a URL / folder | No (1) | No (1) | No (1) | Planned (2) |
| SharedArrayBuffer / cross-origin isolation | Only with COOP/COEP headers | Same as host | Only if host sends COOP/COEP (3) | Yes (built in) |
| Accessibility (screen reader, keyboard) | Yes (4) | Yes (4) | Yes (4) | Yes (4) |

Notes:
1. The web build inlines every mod at build time and has no runtime code loader,
   so it cannot fetch and run a mod from a URL. The in-app mod manager says so
   rather than showing a dead button. Bundled mods are fully manageable. (A
   runtime mod-loader that lets a plain static site or PWA load user content-pack
   and sandboxed-plugin mods from a file picker / drag-drop is a planned mods-
   phase feature; it is an implementation gap, not a platform limitation.)
2. The desktop build serves a user `mods/` folder; loading runtime mods from it
   is the next desktop increment (the serving seam is already in place).
3. GitHub Pages and most static hosts cannot send custom headers, so cross-
   origin isolation is unavailable there. It is never required - the trusted
   in-process mod tier works on every surface.
4. The grid auto-scales to any viewport (see below); the game does NOT currently
   offer a manual text/tile scale control. Browser pinch-zoom is intentionally
   disabled on the game canvas (the page sets `maximum-scale=1,
   user-scalable=no`) so a stray pinch cannot blur or misalign the grid - resize
   the window or use your OS/browser page zoom instead.

---

## Screen and display controls

The terminal is a **fixed 80 columns x 24 rows**, drawn at the largest whole
cell size that fits your window and centred, so the surrounding area is
letterbox. 80x24 is both upstream's default main-window size and its enforced
minimum (`MIN_COLS_MAIN` / `MIN_ROWS_MAIN`, `reference/src/main-sdl2.c:139`), and
it is what every Angband screen is laid out against - the status rows, the
right-aligned inventory, the store columns. The map area inside it works out to
66x22 in the classic left-sidebar layout, matching the C exactly.

Every lever upstream gives a player over the display, and where it is here:

| Upstream lever | Here |
|---|---|
| Sidebar mode (left / top / none) | `=` -> **Set sidebar mode** |
| Graphics: ASCII or a tile set | in-game menu -> **Graphics** |
| Interface options (`show_damage`, `center_player`, `purple_uniques`, `solid_walls`, ...) | `=` -> **User interface options** |
| Base delay factor / hitpoint warning / movement delay | `=` -> **d** / **h** / **m** |
| Keymaps, colours | `=` -> **Edit keymaps** / **Edit colours** |
| **Resize the main window for a bigger map** | **Not yet.** The grid stays 80x24 and scales; it does not grow into a larger window. |
| **Big-tile multiplier** (`tile_width` / `tile_height`) | **Not yet.** Both are fixed at 1, so tiles are one cell each. |
| **Subwindows** (monster list / messages / inventory in separate terms) | **Not offered.** The port is one surface, by design. |
| Save/load `.prf` pref files | **Not applicable.** Settings persist in browser storage automatically, so there is nothing to write or read back. |
| Auto-inscription setup | Present, but reached from the knowledge browser (`~`) rather than from the options menu, where upstream also lists it. |

The three "not yet" rows are the honest gaps. A screen-rendering
quality-of-life mod is the intended home for going beyond upstream here (a
reflow mode already exists behind an opt-in flag in the terminal code); core
stays on upstream's own defaults.

### Saves are per-surface

Your character save lives in **localStorage, scoped to the specific app/origin
you play on**. That means a character created in a browser tab is not automatically
visible in the installed PWA on a different origin, in the Electron desktop app,
or on a different host - each is its own storage sandbox. This is normal browser
behavior, not data loss.

To move a character between surfaces, use the built-in **save export / import**:
export to a file from one surface, import it on the other. Keep an exported copy
as a backup - a character save is overwritten in place, and death is permanent
with no restore points, faithful to the original.

Clearing your browser's site data for the origin you play on **deletes your
characters**. Export first.

---

## Starting, resuming and deleting a character

The whole flow, so nothing about it has to be guessed at:

**First launch.** You get the title screen. Press any key (or tap) to continue.
With no characters yet, you go straight into character creation.

**Creating a character** walks the same birth sequence as the original: race,
class, then stats (point-buy, roll, or the standard defaults), then a name and
history. `ESC` steps back a screen; `ESC` on the first screen returns to the
title. When birth finishes you are standing in the town.

**Resuming.** Launch the game again and the title screen offers your roster.
Pick a character by its letter, or tap its row; `ESC` resumes the most recent
one. Play autosaves continuously, so "resume" always means where you actually
left off - there is nothing to save manually before closing the tab.

**Saving on purpose.** The in-game menu has **Save and exit**, which writes and
returns you to the title. `^S` saves without leaving.

**Deleting a character.** On the roster, press `Delete` or `Backspace` on the
row (or select a dead character). It names the character and asks for
confirmation first, and there is no undo - export anything you might want back.

**Dead characters** stay on the roster so you can read the tombstone and the
character sheet. They cannot be resumed; that is the point.

---

## Which should I use?

- **Testing the port, or fixing something:** run it from source (§1). You know
  the commit you are on, which is what makes a bug report usable.
- **Your own copy, or one for a group:** self-host the static build (§2).
- **Playing offline on a phone or tablet:** install the PWA (§3) from your own
  https build.
- **A native double-click install, or filesystem mods later:** the desktop app
  (§4).
