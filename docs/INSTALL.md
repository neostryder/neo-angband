# Playing and installing Neo Angband

Neo Angband is one web app that runs on three surfaces from the *same* build:

1. **In a browser** (and installable as an offline PWA) - zero install.
2. **Self-hosted** as a plain static site - host it anywhere.
3. **As a desktop app** (Electron) - a native, offline, double-click install.

The engine, content, saves, and the entire mod framework behave the same on all
three. Where a surface genuinely differs, it is called out in the
[parity matrix](#parity-matrix) below rather than left as a hidden gap.

---

## 1. Play in a browser (and install as a PWA)

**Just play:** open the hosted game in any modern browser - nothing to install.
Your character autosaves to the browser (IndexedDB) and resumes next visit.

**Install as an app (offline, any platform):** the game is a Progressive Web
App, so you can install it and play offline.

- **Desktop Chrome / Edge:** click the install icon in the address bar (or menu
  -> "Install Neo Angband..."), then launch it like any app.
- **Android (Chrome):** menu -> "Add to Home screen" / "Install app".
- **iOS / iPadOS (Safari):** Share -> "Add to Home Screen".
- **Firefox:** desktop Firefox does not install PWAs; use the browser tab, or
  Chrome/Edge, or the desktop app below.

Once installed, the service worker caches the whole game, so it works with no
network connection. Updates apply automatically the next time you are online.

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

## 3. Desktop app (Electron)

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
| Saves persist across sessions | Yes (IndexedDB) | Yes (IndexedDB) | Yes (IndexedDB) | Yes (IndexedDB) |
| Works offline | Only after first load (SW) | Yes | Only after first load (SW) | Yes (always) |
| Responsive / any viewport | Yes | Yes | Yes | Yes |
| Bundled mods + in-app mod manager | Yes | Yes | Yes | Yes |
| Enable / disable / reorder / consent / profiles | Yes | Yes | Yes | Yes |
| Content-pack mods (bundled) | Yes | Yes | Yes | Yes |
| Trusted in-process system-override mods | Yes | Yes | Yes | Yes |
| Untrusted sandbox (Worker) mods | Yes | Yes | Yes | Yes |
| Install mods from a URL / folder | No (1) | No (1) | No (1) | Planned (2) |
| SharedArrayBuffer / cross-origin isolation | Only with COOP/COEP headers | Same as host | Only if host sends COOP/COEP (3) | Yes (built in) |
| Accessibility (screen reader, keyboard, scaling) | Yes | Yes | Yes | Yes |

Notes:
1. The web build inlines every mod at build time and has no runtime code loader,
   so it cannot fetch and run a mod from a URL. The in-app mod manager says so
   rather than showing a dead button. Bundled mods are fully manageable.
2. The desktop build serves a user `mods/` folder; loading runtime mods from it
   is the next desktop increment (the serving seam is already in place).
3. GitHub Pages and most static hosts cannot send custom headers, so cross-
   origin isolation is unavailable there. It is never required - the trusted
   in-process mod tier works on every surface.

---

## Which should I use?

- **Try it / share a link:** the browser. Nothing to install.
- **Play offline on a phone or tablet:** install the PWA.
- **Run your own copy / put it on your site:** self-host the static build.
- **Best desktop experience, or you want filesystem mods later:** the desktop
  app.
