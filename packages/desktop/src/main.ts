/**
 * Neo Angband desktop (Electron) main process.
 *
 * This used to be a DISTRIBUTION wrapper: it served the same web bundle in a
 * native window and gave it nothing the browser did not already have. So the
 * desktop build ran the browser's REDUCED host - no real files, no argv, no
 * signals - while sitting on top of Node, and every host-shaped feature stayed
 * absent for no reason but plumbing (parity/PLATFORM.md).
 *
 * It is now a CAPABILITY wrapper. It is upstream's `main-*.c`: the front end
 * that owns the platform, creates init.c's directories, and hands the game a
 * real z-file.c. The renderer is still the identical web bundle - that is the
 * point, one game with several front ends - but here it is handed a
 * full-capability host instead of being left to discover it has none.
 *
 * Two things are served to the renderer:
 *   - the web bundle, over a loopback HTTP server (see the header on
 *     startServer for why HTTP rather than file://);
 *   - the host filesystem, over ONE synchronous IPC channel whose wire format
 *     lives in core (host/bridge.ts), so neither end can drift from the other.
 */

import { app, BrowserWindow, dialog, ipcMain, screen, session, shell } from "electron";
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
/* The host modules by subpath, not through either barrel: the main process needs
 * z-file.c, not the game engine, and importing the barrels pulled the whole of
 * core into this bundle (479 kB of rules a file write has no use for). */
import {
  ALL_HOST_DIRS,
  HostDir,
  hostDirOverrides,
  parseLaunchArgs,
  serveRawFs,
} from "@neo-angband/core/host";
import { NodeRawFs } from "@neo-angband/cli/host-node";
import { LAUNCH_MODULES } from "./modules.js";
import {
  HOST_BRIDGE_CHANNEL,
  HOST_INFO_CHANNEL,
  HOST_QUIT_CHANNEL,
  HOST_SHELL_LIMITS,
} from "./bridge-channel.js";
import type { HostBridgeInfo } from "./bridge-channel.js";
import { checkWritable, resolveDataBase } from "./data-dir.js";
import { PORT_ENV, rememberLoopbackPort, resolveLoopbackPort } from "./loopback-port.js";
import { planOriginMerge } from "./origin-merge.js";
import { ORIGIN_PROBE_ROUTE, planRequest } from "./routes.js";
import type { OriginSnapshot } from "./origin-merge.js";
import { readWindowState, startPlacement, writeWindowState } from "./window-state.js";

/**
 * Where the renderer bundle is, which differs between a checkout and a package.
 *
 * In the workspace it is the web package's own output. In a packaged build
 * electron-builder maps it to `web/` inside the asar (a `files` entry cannot
 * simply name `../web/dist-web` - patterns that climb out of the app directory
 * are silently copied nowhere, which shipped a build whose only screen was the
 * "Web bundle not found" dialog).
 *
 * Both are checked rather than switching on `app.isPackaged`, so an unexpected
 * layout produces the honest missing-bundle dialog naming a real path instead of
 * a confident guess.
 */
function findWebRoot(): string {
  const packaged = path.join(__dirname, "..", "web");
  const workspace = path.join(__dirname, "..", "..", "web", "dist-web");
  for (const c of [packaged, workspace]) {
    if (fs.existsSync(path.join(c, "index.html"))) return c;
  }
  return packaged;
}

const WEB_ROOT = findWebRoot();

/**
 * Set BEFORE the first app.getPath("userData"), which derives from it and then
 * caches. Without this, Electron takes the name from package.json - which is the
 * scoped workspace name - and a player's savefiles land in a directory called
 * "@neo-angband/desktop". That path is where saves live for the lifetime of an
 * install, so it is not a cosmetic detail.
 */
app.setName("Neo Angband");

/**
 * init.c's writable tree, chosen per launch: beside the install by default, under
 * the user's application data only for a copy the installer put there. See
 * data-dir.ts for the order and why. NodeRawFs creates the five ANGBAND_DIR_*
 * subdirectories under whichever base wins, and the mods folder sits alongside
 * them - so an unzipped folder holds the program, its data and its mods together.
 */
const DATA = resolveDataBase({
  env: process.env,
  exeDir: path.dirname(app.getPath("exe")),
  userData: app.getPath("userData"),
  packaged: app.isPackaged,
  platform: process.platform,
});
const USER_BASE = DATA.base;
const MODS_DIR = path.join(USER_BASE, "mods");

/**
 * Move Chromium's own state into the folder too.
 *
 * Without this a "self-contained" copy is not one. Electron unconditionally
 * creates its userData directory - caches, GPU shader cache, local storage, a
 * DevTools port file - under the OS user profile, so a portable game still left
 * an `AppData\Roaming\Neo Angband` folder behind on any machine it was run on,
 * and the localStorage the web build keeps its characters in lived there rather
 * than with the game. That is precisely the smearing this shape exists to avoid.
 *
 * There is no upstream equivalent because upstream has no browser engine; the
 * governing rule is the ratified one, that a portable copy keeps EVERYTHING in
 * one folder. It goes in a subdirectory rather than the base itself so that the
 * five ANGBAND_DIR_* directories stay recognisable next to it instead of being
 * buried among Chromium's dozen.
 *
 * Only for a portable launch: the `user` kind is already Electron's own
 * directory, and reassigning it to itself-plus-a-suffix would orphan the
 * localStorage characters of every existing installed copy.
 *
 * FOUR paths, not one. `userData` is only documented to be where the other three
 * DEFAULT to; `sessionData` (the caches, local storage, IndexedDB), `crashDumps`
 * and `logs` are separate entries that can each be resolved on their own, and
 * "defaults to" is not a guarantee about ordering against an override installed
 * this early. Setting all four is a line each and removes the question. Verified
 * by launch: after this, the user profile has no Neo Angband directory at all and
 * Chromium's 94 files are inside the game folder.
 */
if (DATA.portable) {
  const chromium = path.join(USER_BASE, "chromium");
  app.setPath("userData", chromium);
  app.setPath("sessionData", chromium);
  app.setPath("crashDumps", path.join(chromium, "crashes"));
  app.setPath("logs", path.join(chromium, "logs"));
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  /* A mod ships images and text of its own, and an unlisted extension is served
   * with no content type at all - which an <img> will load anyway but a
   * `fetch().json()` and an SVG will not. */
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

function send(
  res: http.ServerResponse,
  status: number,
  body: string | Buffer,
  type?: string,
): void {
  res.writeHead(status, {
    "Content-Type": type ?? "text/plain; charset=utf-8",
    // Cross-origin isolation -> crossOriginIsolated -> SharedArrayBuffer.
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  res.end(body);
}

/**
 * Serve the first candidate that reads.
 *
 * A LIST rather than one path because `/mods/<id>/...` can be answered from two
 * places - the player's mods folder or the web bundle - and which one holds a
 * given file is not knowable without looking. See routes.ts for why, and for the
 * defect that taught us: a single-candidate lookup made every bundled mod asset
 * a 404 on desktop while serving fine on Pages.
 */
function serveFirst(
  res: http.ServerResponse,
  candidates: readonly string[],
  fallbackIndex: boolean,
): void {
  const [head, ...rest] = candidates;
  if (head === undefined) {
    if (fallbackIndex) {
      // SPA-style fallback to index.html for unknown non-asset routes.
      serveFirst(res, [path.join(WEB_ROOT, "index.html")], false);
      return;
    }
    send(res, 404, "Not found");
    return;
  }
  fs.readFile(head, (err, data) => {
    if (err) {
      serveFirst(res, rest, fallbackIndex);
      return;
    }
    /* The MIME type comes from the file actually opened, not the first
     * candidate: the two roots can name different extensions for one request
     * only if a path is odd, but reading the type off the wrong name is the kind
     * of thing that silently serves a PNG as text/plain. */
    send(res, 200, data, MIME[path.extname(head).toLowerCase()]);
  });
}

/**
 * Why a loopback HTTP server instead of file:// -
 *  - service workers, fetch, and ES modules behave normally on http://127.0.0.1
 *    but are restricted or quirky under file://;
 *  - it lets us send Cross-Origin-Isolation headers (COOP + COEP), which turn on
 *    crossOriginIsolated and therefore SharedArrayBuffer. A static host (Pages)
 *    cannot send those headers, so the untrusted-Worker deep-override path that
 *    needs SAB is only possible on the desktop build. Nothing REQUIRES it - the
 *    trusted in-process tier works everywhere - but the door is open here.
 *
 * The server binds an ephemeral port on the loopback interface only, so nothing
 * is exposed off the machine. Path traversal is rejected.
 */
/**
 * The mods directory, as one index the renderer can act on.
 *
 * There is no C to be faithful to here - upstream has no mod system - so the
 * shape is chosen for the job the recorded division of labour gives it: an
 * external manager (Vortex/MO2) deploys folders and writes the load order, and
 * the game reads both. That means the renderer needs, in one round trip:
 *
 *   - which packs are on disk, and WHICH FILES each contains. Per-file GETs are
 *     enough to fetch a pack but not to discover one, because a pack's record
 *     files are named after the record type and there is no fixed list.
 *   - the on-disk load order, so a manager's ordering decision is not something
 *     the game has to be told about separately.
 *
 * `.json` files at the top level of a pack are listed as its RECORDS, and `.js`
 * files as its CODE. The two are kept apart because they are gated differently:
 * records are composed, code is imported only once the mod is enabled, its
 * declared ABI matches and the player has consented (web/src/mod-code.ts), and
 * every one of those has to be decided before the module runs. Everything else a
 * pack ships - tile images, sounds, a licence, nested data - is `assets`, served by
 * the route below and reached through the plugin context's assetUrl.
 *
 * All three lists are pack-relative PATHS, so a pack's subdirectories are
 * expressible. They used to be bare top-level filenames, which made a mod's
 * `tiles/` and `lib/` folders invisible to the game while the server underneath
 * would have served them perfectly well.
 */
interface ModsIndex {
  readonly packs: readonly {
    readonly id: string;
    readonly files: readonly string[];
    readonly code: readonly string[];
    readonly assets: readonly string[];
  }[];
  /** load-order.json's `order`, or [] when the file is absent or unreadable. */
  readonly order: readonly string[];
  /** Where these live, so the game can tell a player where to put a mod. */
  readonly dir: string;
}

/** load-order.json: the file an external mod manager owns. */
const LOAD_ORDER_FILE = "load-order.json";

function readLoadOrder(): readonly string[] {
  try {
    const raw = fs.readFileSync(path.join(MODS_DIR, LOAD_ORDER_FILE), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return [];
    const order = (parsed as { order?: unknown }).order;
    if (!Array.isArray(order)) return [];
    return order.filter((v): v is string => typeof v === "string");
  } catch {
    /* absent, unreadable, or not JSON: the game runs with no disk order, which
     * is the same state as a fresh install. Reported to the renderer as [] and
     * never as a crash - a hand-edited file must not stop the game booting. */
    return [];
  }
}

/** How deep into a pack the index walks; see the note in mod-folder.ts. */
const MAX_PACK_DEPTH = 12;

/** Every file under `dir`, by path relative to it, with `/` separators. */
function walkPack(dir: string, prefix = "", depth = 0, out: string[] = []): string[] {
  if (depth > MAX_PACK_DEPTH) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    /* Symlinks are not followed: a link out of the mods folder would let a pack
     * name any file on the machine, and the loopback server would serve it. */
    if (e.isSymbolicLink()) continue;
    if (e.isFile()) out.push(`${prefix}${e.name}`);
    else if (e.isDirectory()) {
      walkPack(path.join(dir, e.name), `${prefix}${e.name}/`, depth + 1, out);
    }
  }
  return out;
}

function modsIndex(): ModsIndex {
  const packs: { id: string; files: string[]; code: string[]; assets: string[] }[] = [];
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(MODS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    /* no mods dir yet */
  }
  for (const id of names) {
    const files: string[] = [];
    const code: string[] = [];
    const assets: string[] = [];
    /* The WHOLE tree, not the top level. A mod is data, images and scripts in a
     * folder; listing only its root made `tiles/orc.png` and `lib/dice.js` invisible
     * to the game, which is a mod system that silently drops half of a mod. Record
     * contributions stay top-level-only - see disk-packs.ts for why. */
    for (const rel of walkPack(path.join(MODS_DIR, id))) {
      if (/\.m?js$/i.test(rel)) code.push(rel);
      else if (rel.toLowerCase().endsWith(".json") && !rel.includes("/")) files.push(rel);
      else assets.push(rel);
    }
    packs.push({ id, files, code, assets });
  }
  return { packs, order: readLoadOrder(), dir: MODS_DIR };
}

/**
 * A blank same-origin page.
 *
 * Its only job is to give a hidden window somewhere to stand so the main process
 * can read or write that origin's localStorage (see origin-merge.ts). It must NOT
 * be the app: loading index.html in a hidden window would boot a second copy of
 * the game, which under a no-save-scumming policy is a second autosaver.
 *
 * The route itself lives in routes.ts, so the router and the loader cannot drift
 * onto two different paths.
 */
const ORIGIN_PROBE_PAGE =
  "<!doctype html><meta charset=utf-8><title>storage</title>";

function startServer(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      const plan = planRequest(url, { modsDir: MODS_DIR, webRoot: WEB_ROOT });
      switch (plan.kind) {
        case "origin-probe":
          send(res, 200, ORIGIN_PROBE_PAGE, MIME[".html"]);
          return;
        // User mods folder (read-only), for the filesystem-mod path.
        case "mods-index":
          send(res, 200, JSON.stringify(modsIndex()), MIME[".json"]);
          return;
        case "forbidden":
          send(res, 403, "Forbidden");
          return;
        case "file":
          serveFirst(res, plan.candidates, plan.fallbackIndex);
          return;
      }
    });
    server.on("error", reject);
    /* A FIXED port on loopback only. Fixed, not ephemeral, because the port is
     * part of the origin the renderer's localStorage - and therefore the character
     * roster - is partitioned by; see loopback-port.ts. Nothing is exposed off the
     * machine either way. */
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    });
  });
}

/**
 * Serve z-file.c to the renderer over one synchronous channel.
 *
 * SYNCHRONOUS on purpose: z-file.c is, and so is every caller of it - prefs_save
 * writes inside a menu handler, the game loop reads a pref file inline. An async
 * host would push `await` up through the command layer and let the transport
 * reshape the game's control flow, which is the same mistake as letting the
 * browser decide what a file is. See host/bridge.ts.
 *
 * The renderer is the untrusted side, so serveRawFs validates every argument and
 * NodeRawFs rejects any leaf name that escapes its directory. A malformed or
 * hostile call gets that operation's failure value; it never throws here,
 * because an exception in a sync IPC handler would take the main process with it.
 */
function installHostBridge(dirs: Readonly<Partial<Record<HostDir, string>>>): void {
  const serve = serveRawFs(new NodeRawFs(USER_BASE, dirs));
  ipcMain.on(HOST_BRIDGE_CHANNEL, (event, op: unknown, args: unknown) => {
    try {
      event.returnValue = serve(
        typeof op === "string" ? op : "",
        Array.isArray(args) ? (args as unknown[]) : [],
      );
    } catch {
      /* serveRawFs is written not to throw; this is the belt to its braces,
       * because leaving returnValue unset hangs the calling renderer forever. */
      event.returnValue = undefined;
    }
  });

  const info: HostBridgeInfo = {
    argv: commandLine(),
    ...HOST_SHELL_LIMITS,
    dataDir: USER_BASE,
    portable: DATA.portable,
  };
  ipcMain.on(HOST_INFO_CHANNEL, (event) => {
    event.returnValue = info;
  });

  /**
   * textui_quit (ui-game.c:199): "Save and exit" leaves the program.
   *
   * app.quit() rather than closing the window, because closing it would run the
   * window-all-closed path - which on macOS deliberately keeps the app alive, so a
   * player there would have "exited" to nothing at all.
   *
   * The renderer has already written and verified the save before it gets here
   * (closeGameSave retries and reports), so this must not second-guess it: a shell
   * that refused to quit on the game's behalf would be the same class of bug as the
   * row that never quit in the first place.
   */
  ipcMain.on(HOST_QUIT_CHANNEL, () => {
    app.quit();
  });
}

/**
 * main.c's argv, minus the program name AND minus this front end's own switches.
 *
 * Only this process sees the real command line: `electron . -f Bilbo` in
 * development puts the app path at argv[1], while a packaged build does not have
 * it, so the two cases drop a different amount.
 *
 * The `--`-prefixed filter is not a liberty. Upstream splits the command line
 * between the game and the display module - everything after `--` is handed to
 * `modules[i].init(argc, argv)` (main.c:451-457) and the game never looks at it -
 * and every switch main() itself takes is single-dash. Here the display module is
 * Chromium, which reads its switches (`--remote-debugging-port`, `--disable-gpu`,
 * ...) straight off the same command line wherever they appear, and does NOT
 * honour the positional `--`. So the split has to be made by prefix instead of by
 * position, or the module's own switches reach the game's option loop, which
 * faithfully treats an unknown switch as a usage error - and the app then prints
 * usage and quits without ever opening a window. That was measured, not
 * predicted: `electron . -f -uThorin --remote-debugging-port=9557` did exactly
 * that.
 *
 * A single-dash switch the game does not know is still a usage error, which is
 * the part that matters: `-q` must not be silently ignored.
 */
function commandLine(): readonly string[] {
  /* Filter FIRST, then drop the app path, because a Chromium switch given before
   * the app path shifts its position: `electron --remote-debugging-port=N . -f`
   * puts "." at argv[2], and a fixed slice(2) then hands "." to the option loop,
   * which rejects it - there are no positional arguments in main.c. Measured the
   * same way: it printed usage and quit. */
  const rest = process.argv.slice(1).filter((a) => !a.startsWith("--") || a === "--");
  /* In development the app path is itself an argument; a packaged build has none.
   * process.defaultApp is Electron's own signal for that, and unlike a position
   * it does not move. */
  return process.defaultApp ? rest.slice(1) : rest;
}

/**
 * main()'s three paths that never reach a display module (main.c:393, 461-490,
 * 236-271): list the savefiles, print the usage text, or quit with a message.
 *
 * They belong HERE rather than in the renderer because they need a console and
 * happen before any window exists, which is exactly where upstream does them -
 * `angband -l` prints to stdout and exits without ever initialising a terminal.
 * Returns true when the launch should stop.
 *
 * The renderer parses the same argv again with the same function, so there is one
 * definition of what each switch means and no chance of the two disagreeing.
 */
function handleEarlyExit(): boolean {
  const outcome = parseLaunchArgs(commandLine(), {
    modules: LAUNCH_MODULES,
    dirDefaults: Object.fromEntries(
      ALL_HOST_DIRS.map((d) => [d, path.join(USER_BASE, d)]),
    ),
  });
  switch (outcome.kind) {
    case "run":
      /* change_path's directory overrides, which the host layer needs before the
       * first file is touched. `dir_create` is NodeRawFs' constructor. */
      DIR_OVERRIDES = hostDirOverrides(outcome.args);
      return false;
    case "usage":
      /* puts() for each line, then quit(NULL). */
      for (const line of outcome.lines) console.log(line);
      app.quit();
      return true;
    case "quit":
      /* quit_fmt(): upstream's message goes to stderr through plog. */
      console.error(outcome.message);
      app.quit();
      return true;
    case "list-saves": {
      /* list_saves (main.c:301-333). The savefile "desc" upstream prints comes
       * from a savefile header this port does not write yet (Phase 5), so every
       * entry takes upstream's own no-desc branch: ` %-15s`. */
      const dirs = hostDirOverrides(outcome.args);
      const names = new NodeRawFs(USER_BASE, dirs).listFiles(HostDir.SAVE);
      if (names.length === 0) {
        console.log("There are no savefiles you can use.");
      } else {
        console.log("Savefiles you can use are:");
        for (const n of names) console.log(` ${n}`);
        console.log("");
        console.log("Use angband -u<name> to use savefile <name>.");
      }
      app.quit();
      return true;
    }
  }
}

/** Set by handleEarlyExit before anything opens a file. */
let DIR_OVERRIDES: Readonly<Partial<Record<HostDir, string>>> = {};

/* ------------------------------------------------------------------ *
 * Recovering characters stranded by the old ephemeral port.
 * ------------------------------------------------------------------ */

/** Records which abandoned origins have already been dealt with. */
const MERGED_FILE = "origins-merged.txt";

function mergedPorts(userDir: string): Set<number> {
  try {
    const raw = fs.readFileSync(path.join(userDir, MERGED_FILE), "utf8");
    return new Set(
      raw
        .split(/\s+/)
        .map((s) => Number.parseInt(s, 10))
        .filter((n) => Number.isInteger(n)),
    );
  } catch {
    return new Set();
  }
}

function rememberMergedPorts(userDir: string, ports: Iterable<number>): void {
  try {
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, MERGED_FILE), `${[...ports].join("\n")}\n`, "utf8");
  } catch {
    /* best effort: the worst case is harvesting the same origin again next time,
     * which the merge rules make a no-op. */
  }
}

/** Read every localStorage entry of the origin served on `port`. */
async function readOriginStorage(port: number): Promise<Record<string, string>> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL(`http://127.0.0.1:${port}${ORIGIN_PROBE_ROUTE}`);
    return (await win.webContents.executeJavaScript(
      `(() => { const o = {};
         for (let i = 0; i < localStorage.length; i++) {
           const k = localStorage.key(i);
           if (k !== null) o[k] = localStorage.getItem(k) ?? "";
         }
         return o; })()`,
    )) as Record<string, string>;
  } finally {
    win.destroy();
  }
}

/** Write entries into the origin served on `port`, one key at a time. */
async function writeOriginStorage(
  port: number,
  writes: Readonly<Record<string, string>>,
): Promise<string[]> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const failed: string[] = [];
  try {
    await win.loadURL(`http://127.0.0.1:${port}${ORIGIN_PROBE_ROUTE}`);
    for (const [key, value] of Object.entries(writes)) {
      /* One key per evaluation so a quota refusal names the key that hit it
       * instead of losing the whole batch (a recovered save can be 500 kB). */
      const ok = (await win.webContents.executeJavaScript(
        `(() => { try { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(
          value,
        )}); return true; } catch { return false; } })()`,
      )) as boolean;
      if (!ok) failed.push(key);
    }
  } finally {
    win.destroy();
  }
  return failed;
}

/**
 * Bring characters written under the old ephemeral origins into the stable one.
 *
 * Runs once per abandoned origin and reports what it found. Never fatal: a failure
 * here must not stop the player getting into the game, and nothing is deleted from
 * the origin it was read from, so a failed attempt can simply be repeated.
 */
async function recoverStrandedOrigins(
  userDir: string,
  stablePort: number,
  knownPorts: readonly number[],
): Promise<void> {
  const done = mergedPorts(userDir);
  const todo = knownPorts.filter((p) => p !== stablePort && !done.has(p));
  if (todo.length === 0) return;

  const sources: OriginSnapshot[] = [];
  for (const port of todo) {
    /* A throwaway server serving ONLY the blank page: the game must not boot in
     * one of these windows, and on this port it never can. */
    const server = http.createServer((_req, res) =>
      send(res, 200, ORIGIN_PROBE_PAGE, MIME[".html"]),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
      });
      sources.push({ port, entries: await readOriginStorage(port) });
    } catch (err) {
      console.error(`[neo-angband] could not read storage on port ${port}: ${String(err)}`);
    } finally {
      server.close();
    }
  }

  const plan = planOriginMerge(await readOriginStorage(stablePort), sources);
  const keys = Object.keys(plan.writes);
  if (keys.length === 0) {
    rememberMergedPorts(userDir, [...done, ...todo]);
    return;
  }

  const failed = await writeOriginStorage(stablePort, plan.writes);

  /* Read it BACK before believing it. setItem returning true means Chromium
   * accepted the value, not that the value is in the database; the marker written
   * below says "these origins have been dealt with" and would then be a lie that
   * hides a character permanently, because nothing looks at those origins again.
   * The source origins are never modified, so a failed verification simply leaves
   * the whole job retryable. Storage is flushed first so the check is against
   * something durable rather than the same in-memory map that was just written. */
  try {
    await session.defaultSession.flushStorageData();
  } catch {
    /* Not fatal: the read-back below is the actual gate. */
  }
  const after = await readOriginStorage(stablePort);
  const missing = Object.keys(plan.writes).filter((k) => !(k in after));
  if (missing.length > 0) {
    console.error(
      `[neo-angband] recovery did not stick for ${missing.length} key(s): ` +
        `${missing.join(", ")} - the old storage is untouched and it will be retried.`,
    );
  }

  /* Only mark the sources handled if everything landed AND is still there. A quota
   * failure must stay retryable - the bytes are still in the old origin, and they
   * are a character. */
  if (failed.length === 0 && missing.length === 0) {
    rememberMergedPorts(userDir, [...done, ...todo]);
  }

  const names = plan.recovered.map((r) => `${r.name}${r.hasSave ? "" : " (memorial)"}`);
  console.log(
    `[neo-angband] recovered ${plan.recovered.length} character(s) from ` +
      `${sources.map((s) => s.port).join(", ")}: ${names.join(", ")}` +
      (plan.skippedUnplayed.length > 0
        ? `; left ${plan.skippedUnplayed.length} unplayed birth(s) behind: ` +
          plan.skippedUnplayed.map((r) => r.name).join(", ")
        : ""),
  );
  if (plan.recovered.length > 0) {
    await dialog.showMessageBox({
      type: failed.length === 0 ? "info" : "warning",
      title: "Neo Angband",
      message:
        failed.length === 0
          ? `Recovered ${plan.recovered.length} character(s).`
          : `Recovered ${plan.recovered.length} character(s), with problems.`,
      detail:
        "An earlier version of the game stored characters against a port number " +
        "that changed every launch, which is why they stopped appearing. They " +
        "have been moved into this copy's own storage and are on the character " +
        `screen now:\n\n${names.join("\n")}` +
        (plan.skippedUnplayed.length > 0
          ? `\n\nNot brought over, having never been played past turn 0: ` +
            `${plan.skippedUnplayed.map((r) => r.name).join(", ")}.`
          : "") +
        (failed.length > 0
          ? `\n\nThese could not be written (storage may be full): ${failed.join(", ")}. ` +
            "They are still in the old storage and will be retried next launch."
          : ""),
    });
  }
}

/**
 * True once the game's own window exists.
 *
 * Guards window-all-closed: the hidden windows startup uses to reach an origin's
 * localStorage are windows too, and their closing must not be read as the player
 * having quit.
 */
let gameWindowOpened = false;

async function createWindow(port: number): Promise<void> {
  gameWindowOpened = true;
  const userDir = path.join(USER_BASE, "user");
  const startState = readWindowState(userDir);
  /* Validated against the displays that exist NOW, not the ones the rectangle was
   * saved on - see startPlacement. */
  const placement = startPlacement(
    startState,
    screen.getAllDisplays().map((d) => d.workArea),
  );
  const win = new BrowserWindow({
    ...placement,
    backgroundColor: "#0b0b0b",
    autoHideMenuBar: true,
    /* Restored, as main-sdl.c restores its own `Fullscreen` (L4694, L5905): a
     * player who chose fullscreen chose it for the game, not for one session. */
    fullscreen: startState.fullscreen,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  /* Maximised is restored too, and is a SEPARATE state from fullscreen -
   * main-win.c keeps its own `Maximized` key and applies it as a window style when
   * it creates the window (`if (td->maximized) td->dwStyle |= WS_MAXIMIZE;`,
   * L2770). Electron has no constructor option for it, so it is a call.
   *
   * Skipped when fullscreen, because that is what the window will actually be:
   * MEASURED, Electron reports isMaximized() false for a full-screen window, so
   * the two are never both saved and there is nothing to layer.
   */
  if (startState.maximized && !startState.fullscreen) win.maximize();

  /* Fullscreen, and BORDERLESS with it: Electron's own full-screen state drops the
   * frame and title bar, and the menu bar goes with it, so the terminal grid gets
   * the whole display exactly as SDL_FULLSCREEN gives it upstream. A maximised
   * window deliberately keeps its chrome - that is what maximised means.
   *
   * Bound through before-input-event rather than a menu accelerator or a page
   * listener because the renderer attaches its key handlers on window in the
   * CAPTURE phase and stops propagation (see the overlay-key note in the web
   * package): a keydown handler in the page is not reliably reachable, while
   * before-input-event sees the key before the page does and cannot be eaten.
   */
  win.webContents.on("before-input-event", (event, input) => {
    if (
      input.type !== "keyDown" ||
      input.key !== "F11" ||
      input.control ||
      input.alt ||
      input.meta ||
      input.shift
    ) {
      return;
    }
    event.preventDefault();
    win.setFullScreen(!win.isFullScreen());
  });

  /* The window's state is tracked HERE rather than asked of the window inside each
   * handler, and that is the whole bug this replaces.
   *
   * MEASURED on Electron 43 / Windows 11: `enter-full-screen` and
   * `leave-full-screen` both fire BEFORE `isFullScreen()` flips. Inside the
   * enter handler `isFullScreen()` is still false; inside the leave handler it is
   * still true. So the old code wrote the INVERSE of reality every time - press
   * F11, go genuinely fullscreen, and the file records `Fullscreen = 0` - and the
   * menu bar was un-hidden on the way in for the same reason. (The API note about
   * asynchronous fullscreen transitions is documented only for macOS. It is not
   * only macOS.)
   *
   * The event itself names the new state unambiguously and needs no timing
   * assumption at all: enter means true, leave means false.
   */
  let fullscreen = startState.fullscreen;
  let maximized = startState.maximized;
  let width = placement.width;
  let height = placement.height;
  /* Null when startPlacement REJECTED the saved position (it named a display that
   * is gone): the window is centred, and the file must not keep insisting on a
   * rectangle nothing can show. The first move/resize, or the close, records where
   * it really is. */
  let position: { x: number; y: number } | null =
    placement.x !== undefined && placement.y !== undefined
      ? { x: placement.x, y: placement.y }
      : null;

  const save = (): void => {
    writeWindowState(userDir, { fullscreen, maximized, width, height, position });
  };

  /* Whatever the window looks like when it is NOT fullscreen and NOT maximised -
   * main-win.c's `rcNormalPosition`, the rect it saves rather than the live one
   * (save_prefs_aux L771-773), so that un-maximising after a restore puts the
   * window back where the player last dragged it.
   *
   * getNormalBounds() is that rect and is MEASURED correct while maximised; while
   * FULLSCREEN it is not (it came back as the maximised rect), hence the guard.
   * The guard uses the tracked flag, not isFullScreen(), for the reason above:
   * enter-full-screen fires first, so `fullscreen` is already true by the time the
   * transition's own resize/move events arrive.
   */
  const rememberBounds = (): void => {
    if (fullscreen || win.isMinimized()) return;
    const b = win.getNormalBounds();
    width = b.width;
    height = b.height;
    position = { x: b.x, y: b.y };
  };
  win.on("resize", rememberBounds);
  win.on("move", rememberBounds);

  const applyChrome = (): void => {
    win.setMenuBarVisibility(!fullscreen);
  };
  applyChrome();

  win.on("enter-full-screen", () => {
    fullscreen = true;
    /* At most one of the two, and fullscreen is the one that can be restored - see
     * WindowState.maximized. Nothing is lost: MEASURED, leaving fullscreen from a
     * window that was maximised underneath re-emits `maximize`, so the flag comes
     * back on the way out. Cleared here rather than only at write time so the
     * TRACKED state never holds a pair the restore path cannot reproduce. */
    maximized = false;
    applyChrome();
    save();
  });
  win.on("leave-full-screen", () => {
    fullscreen = false;
    applyChrome();
    save();
  });
  /* MEASURED: entering fullscreen from an already-maximised window emits a
   * `maximize` event too, AFTER enter-full-screen. Without the guard that would
   * record "maximised" for a window that Electron itself calls un-maximised. */
  win.on("maximize", () => {
    if (fullscreen) return;
    maximized = true;
    save();
  });
  win.on("unmaximize", () => {
    if (fullscreen) return;
    maximized = false;
    save();
  });
  /* Both upstream front ends save their prefs at shutdown and nowhere else -
   * hook_quit calls save_prefs (main-win.c L5124, main-sdl.c L1217). The saves
   * above are additional, so that a crash does not lose the choice; the flushes
   * below are the ones that catch a plain resize or drag, which is far too frequent
   * an event to write a file on.
   *
   * `close` is not the only way a run ends. A Windows session end - shutdown,
   * restart, log off - closes the app through its own path, and a window that never
   * gets a `close` would take the whole session's resizing and dragging with it.
   * Electron gives that path its own Windows-only events (BrowserWindow
   * `query-session-end` and `session-end`, `electron.d.ts` L2316-2325 / L2411-2422).
   *
   * `query-session-end` is the one with time left in it - it is the only one that
   * CAN be delayed. It deliberately is not: the file is written and the session goes
   * on ending, because there is nothing here worth standing in a player's way over.
   * `session-end` is hooked too, cheaply, in case the query never arrives; the write
   * is synchronous and idempotent, so doing it twice costs one small file. */
  const flush = (): void => {
    rememberBounds();
    save();
  };
  win.on("close", flush);
  win.on("query-session-end", () => {
    /* NO event.preventDefault(): respect the user's choice to end the session. */
    flush();
  });
  win.on("session-end", flush);

  // External links open in the user's real browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1")) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);
}

async function start(): Promise<void> {
  /* Before anything else, including the missing-bundle check: `-l` and the usage
   * text must work on a checkout that has not built the renderer yet, the same
   * way `angband -l` never touches a display module. */
  if (handleEarlyExit()) return;

  /* One playing instance per install, taken AFTER the early-exit commands so that
   * `-l` and the usage text still work while the game is running (upstream's
   * `angband -l` does not care what else is open).
   *
   * Two windows on one install would share a savefile tree, a Chromium profile and
   * a roster, and the second would lose the race for the port; under a no-save-
   * scumming policy two processes autosaving one character is a corruption route,
   * not an inconvenience. */
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  if (!fs.existsSync(WEB_ROOT)) {
    // A helpful, honest error rather than a blank window.
    await dialog.showMessageBox({
      type: "error",
      title: "Neo Angband",
      message: "Web bundle not found.",
      detail:
        `Expected the built web app at:\n${WEB_ROOT}\n\n` +
        "Build it first:  pnpm --filter @neo-angband/web bundle",
    });
    app.quit();
    return;
  }

  /* init.c's create_needed_dirs, which quits with a message rather than running
   * on into a game that cannot save. A portable copy can easily be unzipped
   * somewhere read-only - Program Files, a mounted image, a CD - and under the
   * no-save-scumming policy the silent version of this failure is a character
   * lost at the first autosave. */
  const problem = checkWritable(USER_BASE);
  if (problem !== null) {
    await dialog.showMessageBox({
      type: "error",
      title: "Neo Angband",
      message: "The data folder cannot be written to.",
      detail:
        `Savefiles, scores and preferences would go here:\n${USER_BASE}\n\n` +
        `${problem}\n\n` +
        (DATA.portable
          ? "This is a portable install, so the folder travels with the game. " +
            "Move the game somewhere writable, or set NEO_ANGBAND_DATA to a " +
            "folder you can write to."
          : "Set NEO_ANGBAND_DATA to a folder you can write to."),
    });
    app.quit();
    return;
  }

  // Ensure the user mods directory exists so the folder is discoverable.
  try {
    fs.mkdirSync(MODS_DIR, { recursive: true });
  } catch {
    /* best-effort */
  }

  /* Stated on stdout as well as through the info channel: with a portable copy
   * the answer changes per install, and a player who cannot start the game has
   * only this to go on. */
  console.log(`[neo-angband] data (${DATA.kind}): ${USER_BASE}`);

  installHostBridge(DIR_OVERRIDES);

  /* The origin the roster lives under. Resolved and remembered BEFORE the server
   * binds, so the number is stable across launches; see loopback-port.ts for what
   * an ephemeral one cost. */
  const choice = resolveLoopbackPort({
    env: process.env,
    userDir: path.join(USER_BASE, "user"),
    sessionDir: app.getPath("sessionData"),
  });
  console.log(
    `[neo-angband] loopback port (${choice.source}): ${choice.port}` +
      (choice.known.length > 1 ? ` [storage also under: ${choice.known.join(", ")}]` : ""),
  );

  let port: number;
  try {
    port = await startServer(choice.port);
  } catch (err) {
    /* Deliberately fatal, and deliberately NOT a retry on another port. Binding
     * elsewhere would start the game against an empty storage area and present it
     * as a clean slate - which is the bug this whole mechanism exists to end. Far
     * better to refuse to start and say which port and how to change it. */
    await dialog.showMessageBox({
      type: "error",
      title: "Neo Angband",
      message: `Port ${choice.port} is not available.`,
      detail:
        "The game serves itself to its own window over this port, and your " +
        "characters are stored against it, so it cannot simply use another one " +
        "without hiding them.\n\n" +
        `${err instanceof Error ? err.message : String(err)}\n\n` +
        "Either close whatever is using the port, or choose a different one by " +
        `setting ${PORT_ENV} (it will be remembered).` +
        (choice.known.length > 1
          ? `\n\nThis copy has storage under these ports: ${choice.known.join(", ")}.`
          : ""),
    });
    app.quit();
    return;
  }
  rememberLoopbackPort(path.join(USER_BASE, "user"), port);

  /* Before the game opens, reunite anything the ephemeral-port era stranded. Never
   * allowed to stop the launch. */
  try {
    await recoverStrandedOrigins(path.join(USER_BASE, "user"), port, choice.known);
  } catch (err) {
    console.error(`[neo-angband] character recovery failed: ${String(err)}`);
  }

  await createWindow(port);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow(port);
  });
}

app.whenReady().then(
  () => void start(),
  () => app.quit(),
);

app.on("window-all-closed", () => {
  /* Not before the game has been opened at all. Startup uses hidden windows to
   * read and write an origin's localStorage (recoverStrandedOrigins), and
   * destroying the last of those counts as "all windows closed" - which quit the
   * app in the middle of recovering the player's characters. */
  if (!gameWindowOpened) return;
  // macOS apps conventionally stay alive until Cmd-Q.
  if (process.platform !== "darwin") app.quit();
});
