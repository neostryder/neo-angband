# Playing and installing Neo Angband

Neo Angband is **alpha software** and the point of this page is to get you onto a
build **you control**, because that is the only kind of build a bug report can be
pinned to. Deliberately, no hosted demo URL appears here: a hosted copy can
change under you between sessions, so "it did X" stops being reproducible.

## The short answer

**[Download a build from Releases.](https://github.com/neostryder/neo-angband/releases)**
Windows, macOS and Linux, plus the static site as a zip. The Windows
**portable** `.exe` and the Linux **AppImage** need no installer: download, run,
and the game keeps its saves in a folder beside itself.

Those builds are **not code-signed**. There is no Apple Developer identity or
Windows certificate behind this project yet, so the first launch is blocked.
**Windows** is one click: SmartScreen says "unrecognised app", choose *More info
-> Run anyway*. **macOS is not one click** and the way through is not on the
dialog it shows you - see [the macOS steps](#macos-blocks-it-first-time) below.
That is a real trust decision and it is yours to make; if you would rather not,
build it yourself from section 1, or play in a browser, which asks nothing of you.

**Nothing needs any of the rest of this page.** It is here for the other four
ways, all of which run the *same* build:

| | Best for | Start at |
|---|---|---|
| **From source (dev server)** | testing, and fixing what you find | [section 1](#1-run-it-from-source-recommended-for-testing) |
| **Self-hosted static site** | your own copy, or one for a group | [section 2](#2-self-host-as-a-static-site) |
| **Installed PWA** | playing offline on a phone or tablet | [section 3](#3-install-as-a-pwa-offline-any-platform) |
| **Desktop app (Electron)** | building the packaged app yourself | [section 4](#4-desktop-app-electron) |

The engine, content, saves, and the entire mod framework behave the same on all
of them. Where a surface genuinely differs, it is called out in the
[parity matrix](#parity-matrix) rather than left as a hidden gap.

**Your saves survive an update.** Every change to the save format ships the
conversion that reads the version before it, and a build that raises the format
without writing that conversion fails its own tests. A save from a *newer* build
than the one you are running says so and asks you to update; it is never
reported as damage, and a save the game cannot open is never overwritten.

**Prerequisites** for everything except the download and the PWA install:
[Node](https://nodejs.org/)
22 or newer, and [pnpm](https://pnpm.io/installation) **11**: run
**`corepack enable pnpm`** and the `packageManager` field in the root
`package.json` decides the exact version. The 11 is not advisory: pnpm 10 fails on
*every* command in this repository, `--help` included, because 11 ships a
different package layout that 10 downloads to a path it cannot then run from.
`npx pnpm@11 <cmd>` works in a pinch without installing anything, and
[CONTRIBUTING.md](../CONTRIBUTING.md) has the long version. Everything below
assumes you have cloned the repo and run `pnpm install` once at its root.

---

## 1. Run it from source (recommended for testing)

```sh
git clone https://github.com/neostryder/neo-angband.git
cd neo-angband
pnpm install
pnpm --filter @rpgm-tools/neo-angband-web dev
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
pnpm --filter @rpgm-tools/neo-angband-web bundle
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

## Which browser?

**Any current one.** The whole game plays in Firefox, Safari, Chrome and Edge, and
mods install in all of them. There is no browser this game refuses, and no feature a
Firefox or Safari player has to do without to play it.

Two things are genuinely Chromium-only, and neither is gameplay:

- **Choosing a mods folder on your computer.** Firefox and Safari have no way to hand
  a directory to a web page - the capability does not exist, so there is no
  workaround. It matters if you are *writing* a mod or using one that was never
  published. Downloading a mod needs nothing special and works everywhere, so a
  player's mod list is not affected.
- **Installing as an app from the browser.** Desktop Firefox has no PWA install; use
  a tab (offline caching still works), or the desktop build. Safari on macOS 14+ and
  iOS installs fine.

**The recommended way to play is the desktop build** (section 4), and not as a fallback for
anything: it keeps real saves in a real folder, needs no network at all, and is not
subject to a browser deciding to reclaim its storage. The browser build exists so the
game is one link away, and so a bug report can be pinned to a build you control.

This is measured rather than assumed. The web build's whole browser-API surface is
`localStorage`, `indexedDB`, `crypto.subtle`, module Workers, `ResizeObserver`,
`matchMedia`, `structuredClone`, a service worker and a 2D canvas - all of which
Firefox and Safari have. It deliberately does not use `CompressionStream` (the save
codec has its own reason, see `packages/web/src/save-codec.ts`), and the only
File System Access call anywhere is the directory picker named above.

---

## 3. Install as a PWA (offline, any platform)

The game is a Progressive Web App, so any build served over **https** (or from
`localhost`) can be installed and then played with no network at all. Install it
from your own build in section 1 or section 2 - that keeps you on a version you control.

- **Desktop Chrome / Edge:** click the install icon in the address bar (or menu
  -> "Install Neo Angband..."), then launch it like any app.
- **Android (Chrome):** menu -> "Add to Home screen" / "Install app".
- **iOS / iPadOS (Safari):** Share -> "Add to Home Screen".
- **Firefox:** desktop Firefox does not install PWAs; use the browser tab (the
  service worker still caches the game for offline play), or Chrome/Edge, or the
  desktop app below - which is the better answer anyway.

Once installed, the service worker caches the whole game, so it works offline.
Updates apply automatically the next time you load it online.

Note the storage consequence: **an installed PWA and the tab you installed it
from may be separate save stores** if their origins differ. See
[Saves are per-surface](#saves-are-per-surface).

---

## 4. Desktop app (Electron)

The desktop build (`packages/desktop`) runs the exact same web bundle in a native
window - and hands it a **real filesystem and a real command line**. That is the
difference between it and the browser: same game, more capable host. It is the
build parity is measured against, because it is the one that can express
everything upstream does (see [parity/PLATFORM.md](../parity/PLATFORM.md)).

**It is self-contained by default.** Unzip it anywhere and that folder holds the
whole game: the program, your settings, your savefiles, your scores, your
character dumps and your mods. Nothing is written to your user profile, so you can
move the folder, back it up by copying it, or carry it on a stick. This is
upstream's own Windows shape - a downloaded Angband has always been `angband.exe`
with `lib/` beside it - and the one exception is a copy placed by the installer,
for the reason given under [where your data lives](#where-your-data-lives).

### Run it from source

```sh
# one time
pnpm install                       # installs Electron (a large download)

# build the web bundle, then launch the desktop app
pnpm --filter @rpgm-tools/neo-angband-desktop dev
```

`dev` builds `packages/web/dist-web` and then opens it in the Electron window.
If you have already built the web bundle, `pnpm --filter @rpgm-tools/neo-angband-desktop
start` launches without rebuilding.

### Package it

Only needed if you want a build the [Releases](https://github.com/neostryder/neo-angband/releases)
page does not offer - a platform I do not build, or a change of your own.

```sh
pnpm --filter @rpgm-tools/neo-angband-desktop dist
```

Everything lands in `packages/desktop/dist-desktop/`, built by electron-builder.
The script empties that folder first, so what is in it is what you just built and
not an archive of every version you have ever made. Run it on the target OS
(cross-building, especially for macOS, has its own toolchain requirements).

The same thing runs in CI on a tag: `.github/workflows/release.yml` builds all
three platforms and attaches them to a draft release. See
[RELEASING.md](RELEASING.md).

| Platform | Installer | No-install |
|---|---|---|
| Windows | `.exe` (NSIS) | **`Neo Angband-<ver>-portable.exe`**, plus a `.zip` |
| macOS | `.dmg` | `.zip` of the `.app` |
| Linux | `.deb` | `.AppImage`, plus a `.tar.gz` |

Every one of them carries its own Chromium, Node and game bundle, so nothing needs
to be installed first. The `.zip` / `.tar.gz` / `install:portable` shapes go
further and keep their data in the folder too - see
[where your data lives](#where-your-data-lives).

For just the single-file portable Windows build:

```sh
pnpm --filter @rpgm-tools/neo-angband-desktop dist:portable
```

### Install it into a folder you choose

To build the game and put it straight into one self-contained folder - the shape
described above, ready to run:

```sh
pnpm --filter @rpgm-tools/neo-angband-desktop install:portable
```

It goes to `C:\Games\Neo Angband` on Windows and `~/Games/Neo Angband` elsewhere.
Name another location as an argument, or set `NEO_ANGBAND_INSTALL_DIR`:

```sh
pnpm --filter @rpgm-tools/neo-angband-desktop install:portable "D:\Games\Neo Angband"
```

Re-running it over an existing install replaces the program and **keeps
`neo-angband-data` untouched**, so rebuilding never costs you a character.

### Where your data lives

The game keeps upstream's writable tree - `save/`, `panic/`, `scores/`, `user/`,
`archive/`, a `mods/` folder, and Chromium's own caches in `chromium/` - under one
base directory. Which one depends on how you launched it, in this order:

1. **`NEO_ANGBAND_DATA` is set** - that path. This is upstream's own
   `ANGBAND_PATH` (`init.c`).
2. **You ran the single-file portable `.exe`, or an AppImage** - a
   `neo-angband-data` folder beside the file you double-clicked. (Both of those
   unpack themselves somewhere temporary, so it is the file's own folder that
   counts, not where the program is running from.)
3. **A `neo-angband-data` folder already exists beside the program** - that
   folder. This is how you make an *installed* copy self-contained: create the
   folder, and the game uses it from then on.
4. **The program's own folder** - `neo-angband-data` beside the executable. This
   is the default, and it is what makes an unzipped copy self-contained without
   being asked.
5. Otherwise the OS user-data directory:
   - Windows `%APPDATA%\Neo Angband`
   - macOS `~/Library/Application Support/Neo Angband`
   - Linux `~/.config/Neo Angband`

Only three things reach step 5, and each of them wants to:

- **A copy the installer placed.** Uninstalling deletes the install directory, and
  your characters must not be inside it. The installer leaves an `installed.txt`
  saying so and naming where the data went; delete nothing else if you want to
  keep playing.
- **A folder the OS will not let the game write to** - dragged into Program Files,
  say. Rather than refuse to start, the game uses the location that works.
- **macOS.** Data inside `Neo Angband.app` would break the bundle's signature and
  be thrown away by the next upgrade, so a `.app` uses step 5 unless you pick
  step 1 or 3.

The path in use, and which rule chose it, is printed at startup:
`[neo-angband] data (folder): C:\Games\Neo Angband\neo-angband-data`. If the folder
cannot be written to, the game says so and stops rather than starting a character
it could never save (upstream's `create_needed_dirs` does the same).

To back a character up, copy the `save/` folder. To move an install, copy the whole
folder - program included.

### macOS blocks it first time

macOS will not open a downloaded app that Apple has not notarised, and **the
dialog it shows you does not contain the way through.** It offers *Done* and
*Move to Trash* and nothing else, which reads as "this app is broken". It is not
broken; the permission lives in System Settings, several screens away. Here is
the whole route.

1. Open the `.dmg` and drag **Neo Angband** to Applications (or anywhere else -
   it does not have to be Applications).
2. Double-click it. macOS says *"Neo Angband" Not Opened - Apple could not verify
   "Neo Angband" is free of malware.* Click **Done**. **You have to do this
   first**: the permission in step 4 only appears once macOS has actually blocked
   a launch, and it stops being offered about an hour later.
3. Open  **System Settings -> Privacy & Security** and scroll down to the
   **Security** section, near the bottom of a long page.
4. There is a line reading *"Neo Angband" was blocked to protect your Mac.* Click
   **Open Anyway** beside it, and authenticate with Touch ID or your password.
5. Launch the app again. One more *Open Anyway* confirmation, and it starts. Every
   launch after this one is normal.

Or do it in one command, which is the same decision made explicitly:

```sh
xattr -d com.apple.quarantine "/Applications/Neo Angband.app"
```

**Do not follow the old right-click -> Open advice.** It was the standard answer
for years, this page used to give it, and Apple removed the bypass in **macOS 15
Sequoia** - on 15 and later it produces the same refusal as a double-click. The
steps above work on Ventura, Sonoma, Sequoia and Tahoe alike.

**Windows** is the same trade with one click: SmartScreen says *Windows protected
your PC*, and *More info -> Run anyway* is the way through.

**Why there is no signature.** Notarising a Mac app needs a paid Apple Developer
identity and a Windows one needs a code-signing certificate; this project has
neither, and until it does, the honest position is to say exactly what you are
being asked to trust rather than to hide it. The macOS bundle IS **ad-hoc
signed** (`codesign --sign -`), which is a different thing: it carries no
identity and satisfies no Gatekeeper policy, and it is what lets the app run at
all on Apple Silicon, where an entirely unsigned binary is refused by the kernel
and reported as *"damaged"*.

**Apple Silicon: take the arm64 build.** The release page carries both, and the
x64 one is for Intel Macs. It is not a fallback: Apple is withdrawing Rosetta 2,
**macOS 27 removes it during installation** (it can be reinstalled on demand) and
macOS 28 drops it for everything but a named set of old games - so on a current
Mac the Intel build is likelier to refuse to launch than to run slowly. If you
are not sure which one you took, open **Activity Monitor** while the game is
running and look at the **Kind** column: it should say *Apple*, not *Intel*.

### Updating

**The game updates itself.** When a newer version has been published, the title
screen grows a shimmering **(U)pdate** row. Pressing `U` downloads the new
version, checks it against the checksum GitHub published for it, restarts, and
comes back on the new one. Your `neo-angband-data` folder - characters,
settings, scores, mods - is not touched, and the old files are kept until the new
ones are in place, so a failure leaves you on the version you already had.

Two shapes cannot replace themselves and say so instead of pretending:

- the **single-file portable** build and the **AppImage**, because both unpack to
  a temporary folder each time they run - there is nothing on disk to update;
- an install in a folder the OS will not let the game write to, such as
  `Program Files`.

In those cases `U` opens the releases page. In the browser the same key reloads
onto the new build, which the service worker has already fetched.

#### How new a build you want

The update screen has three channels, and `C` cycles them. The choice is
remembered.

| Channel | What you get | How often |
| --- | --- | --- |
| `stable` | Finished releases only | Nothing yet - see below |
| `beta` | Pre-releases too, which is every `0.x` version | Every few weeks |
| `early` | A build of every commit on master | Minutes after each push |

**While the game is `0.x`, `stable` is empty**, because a version below 1.0 is a
pre-release by definition and every release is flagged as one. New installs
therefore start on `beta`; the day 1.0.0 ships, `stable` starts meaning
something and new installs default to it.

`early` builds are made by CI from whatever just landed on master. They pass the
same test suite every commit passes and nothing else - **nobody has played
them**. There are no release notes and no changelog entry, and only the newest
one exists at any moment. Saves are still saves: a build that changes the save
format ships the conversion for it like any other.

**Changing channel never moves you backwards.** The channel decides where the
game *looks*, not what it runs. If you drop from `early` to `beta` or `stable`
you keep the build you have, and the update screen says so - it tells you which
channel you are ahead of and that you will be offered the next build that
channel publishes once it overtakes you. Nothing happens in the meantime, on
purpose: a character is saved by the version that made it, the save format only
ever moves forward, and an older engine cannot always read a newer save.

### What the desktop build adds

- **Offline and native by default** - no browser, no address bar; launches like
  any installed app.
- **Real files.** Upstream's writable tree exists for real, so the things that
  are a file in the original are a file here: `.prf` preference dumps you can
  open in an editor, character dumps, screen dumps, the score file. In the
  browser those live in a virtual directory inside browser storage.
- **A command line.** `main.c`'s switches reach the game, which the browser has
  no way to provide:

  ```
  -c             Select savefile with a menu; overrides -n
  -n             Start a new character
  -l             List the savefiles you can play, and exit
  -w             Resurrect dead character (marks savefile)
  -g             Request graphics mode
  -u<who>        Use your <who> savefile
  -f             Force the character name (no rename, no name prompt)
  -d<dir>=<path> Override one directory, e.g. -dsave=D:\angband-saves
  -m<sys>        Use display module <sys>
  ```

  Run the app with `-h` (or any unknown switch) to print the same list with the
  current directory defaults filled in. Two quirks are upstream's own and kept:
  `-g` takes no number (`-g2` prints the usage text), and the eight read-only
  data directories are accepted by `-d` but have no path to override, because
  this port compiles that data in.
- **A user mods folder** - `mods/` inside the data directory. Copy a mod's folder
  in and restart; it appears in the in-game mod manager, off until you enable it.
  An external mod manager (Vortex/MO2) deploys into the same folder and owns
  `load-order.json` there. The mod manager's "Where mods come from" row names the
  exact path and lists anything it could not read. Format:
  [docs/MODS.md](MODS.md#where-a-pack-lives-on-disk).
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
| Saves exempt from browser eviction | If granted (8) | Usually (8) | If granted (8) | Usually (8) |
| Works offline | Only after first load (SW) | Yes | Only after first load (SW) | Yes (always) |
| Responsive / any viewport | Yes | Yes | Yes | Yes |
| In-app mod manager | Yes | Yes | Yes | Yes |
| Mods bundled with the game | **None, by design** (1) | None | None | None |
| Download and install a mod | Yes (2) | Yes (2) | Yes (2) | Yes (2) |
| Install a mod from a FOLDER | Chrome / Edge only (3) | Chrome / Edge only (3) | Chrome / Edge only (3) | Yes, its own folder (4) |
| Enable / disable / reorder / consent / profiles | Yes | Yes | Yes | Yes |
| Content-pack (data) mods | Yes | Yes | Yes | Yes |
| Scripted-plugin (code) mods | Yes (5) | Yes (5) | Yes (5) | Yes (5) |
| Trusted in-process system-override mods | Yes | Yes | Yes | Yes |
| Untrusted sandbox (Worker) mods | Yes | Yes | Yes | Yes |
| SharedArrayBuffer / cross-origin isolation | Only with COOP/COEP headers | Same as host | Only if host sends COOP/COEP (6) | Yes (built in) |
| Accessibility (screen reader, keyboard) | Yes (7) | Yes (7) | Yes (7) | Yes (7) |

Notes:
1. **The game ships with no mods at all**, and that is the parity mandate in
   mechanical form: a fresh install is Angband 4.2.6 and nothing else. The
   first-party mods - `qol`, `bug-fixes`, `feature-restoration`, `neo-linoleum`
   and `borg` - each live in their own repository and arrive through the same
   route, and the same verification, as anybody else's. Nothing is
   second-class, including mine.
2. The mod manager's **Install a mod...** row downloads from a mod's own repository
   at a pinned TAG (never a branch, so what arrives cannot change under you). What
   gets pinned is the ORIGIN: the first install records which repository the mod came
   from, and only a copy from that same repository may ever replace it, so an update
   cannot quietly arrive from somewhere else. Changing where a mod comes from means
   uninstalling it first, and the game says so rather than doing it for you. The
   install also records a SHA-256 of every byte that actually arrived, which is what
   lets the manager answer "has this copy changed since it was installed" later on.
   **It cannot tell you whether what arrived is what the author published.** There is
   nothing to compare a first download against, and this build ships no digests of
   its own, so that is a property the game does not have rather than one it checks
   quietly. It needs only a network request and the browser's own storage, so it
   works on **every** browser, and it is the reason no browser is excluded below.
   Installed mods are read back at boot by the same validator that reads a folder on
   disk.
3. **"Choose a mods folder..." is the Chromium-only route**, because Firefox and
   Safari have no way to hand a directory to a web page - there is no workaround to
   find, the capability does not exist. It is for developing a mod, or using one that
   was never published: you pick the folder once (a page may not browse a filesystem
   uninvited), and the browser may need permission again after a long gap, when the
   row says `NEEDS RECONNECTING`. Nothing is missing from a Firefox or Safari player's
   mod list because of note 2.
4. The desktop build reads mods from its own `mods/` folder, and an external mod
   manager can deploy into it (`load-order.json` is honoured). It can also install
   from the catalogue, like every other surface.
5. A mod folder may ship `plugin.js` and it will be loaded and RUN - from a loopback
   URL on desktop, a `blob:` from a picked directory, or browser storage for one that
   was installed. This used to be false: a mod from outside the build was data only,
   and scripted plugins had to be bundled. Both halves changed, which is what made
   shipping no bundled mods possible at all.
6. GitHub Pages and most static hosts cannot send custom headers, so cross-
   origin isolation is unavailable there. It is never required - the trusted
   in-process mod tier works on every surface.
7. The grid auto-scales to any viewport (see below); the game does NOT currently
   offer a manual text/tile scale control. Browser pinch-zoom is intentionally
   disabled on the game canvas (the page sets `maximum-scale=1,
   user-scalable=no`) so a stray pinch cannot blur or misalign the grid - resize
   the window or use your OS/browser page zoom instead.
8. By default a browser may delete a site's whole storage bucket to reclaim space,
   without asking - which under this game's terminal-death rule is permanent
   character loss from a mechanism you never see. So the first time a character save
   lands, the game asks for **persistent** storage, which is exempt from that.
   Chromium grants it by engagement (installing the app is the strongest signal,
   which is why the installed rows read "usually"); Firefox asks you. It is asked
   for once, never re-nagged, and the character-select screen says where you stand
   either way. What it does not protect against: *you* clearing browsing data, or a
   cleanup tool doing it for you - see [What destroys a roster](#what-destroys-a-roster),
   which is the larger risk of the two and the one an export answers.

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

Your character save lives in **localStorage** and your installed mods in
**IndexedDB**, both scoped to the specific app/origin you play on. That means a
character created in a browser tab is not automatically visible in the installed
PWA on a different origin, in the Electron desktop app, or on a different host -
each is its own storage sandbox. This is normal browser behavior, not data loss.

To move a character between surfaces, use the built-in **save export / import**:
`Shift-X` on the character list writes the highlighted character to a `.neochar`
file, `Shift-M` reads one back. Keep an exported copy as a backup - a character
save is overwritten in place, and death is permanent with no restore points,
faithful to the original.

An export is **not** a restore point, and the game enforces that: a file will not
import over a character who has died in that roster (even after the tombstone has
been cleared), and it will not import over a living copy of themselves unless the
file is further along - in which case it takes their own slot back rather than
becoming a second copy. What it cannot police is a second install that never saw
the death, or a hand-edited file; the same hole `cp save/Bilbo /tmp` has always
opened in upstream Angband.

### What destroys a roster

**Anything that clears this origin's storage takes every character AND every
installed mod, at once, with no undo.** They share one storage bucket, so a
cleanup that reaches the saves reaches the mods too. Specifically:

- "Clear browsing data" or "Clear site data" covering the origin you play on
- A cleanup tool - Disk Cleanup, CCleaner, a browser extension, a "free up space"
  setting - or a scheduled task or script that runs one for you
- Resetting the browser, or deleting its profile
- On the desktop build: deleting or moving the game's `neo-angband-data` folder,
  or uninstalling

Because death is permanent, a character lost this way is not recoverable from
anything except a file you exported yourself. Export first.

The game says all of this in one place: **Where your characters live**, from the
Escape menu or `Shift-W` on the character list. It names the actual folder or
origin, what is stored there now, and whether the browser has marked it
persistent.

On the **desktop build** there is a second backup that has no browser equivalent:
close the game and copy the whole `neo-angband-data` folder. It carries the saves,
the settings and the installed mods together.

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

- **Testing the port, or fixing something:** run it from source (section 1). You know
  the commit you are on, which is what makes a bug report usable.
- **Your own copy, or one for a group:** self-host the static build (section 2).
- **Playing offline on a phone or tablet:** install the PWA (section 3) from your own
  https build.
- **A native double-click install, or filesystem mods later:** the desktop app
  (section 4).
