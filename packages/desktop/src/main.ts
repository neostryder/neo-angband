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
} from "@rpgm-tools/neo-angband-core/host";
import { NodeRawFs } from "@rpgm-tools/neo-angband-cli/host-node";
import { LAUNCH_MODULES } from "./modules.js";
import { agentQuery } from "./agent-mode.js";
import {
  BACKUP_CHANNEL,
  HOST_BRIDGE_CHANNEL,
  HOST_INFO_CHANNEL,
  HOST_QUIT_CHANNEL,
  HOST_SHELL_LIMITS,
  LOG_CHANNEL,
  MOD_ZIP_CHANNEL,
  REPORT_CHANNEL,
  UPDATE_CHANNEL,
  UPDATE_PROGRESS_CHANNEL,
} from "./bridge-channel.js";
import type { BackupOp } from "./bridge-channel.js";
import {
  backupFolderDisplayName,
  isBackupFileName,
  readBackupFolder,
  writeBackupFolder,
} from "./backup-folder.js";
import type { HostBridgeInfo } from "./bridge-channel.js";
import { LOG_DIRNAME, openLogFile, writeReportFile } from "./log-file.js";
import { describeValue, formatLogLine } from "@rpgm-tools/neo-angband-core/log";
import type { LogLevel } from "@rpgm-tools/neo-angband-core/log";
import {
  UPDATE_REPO,
  downloadArchive,
  launchSwap,
  shapeOf,
  stageArchive,
} from "./updater.js";
import { checkWritable, resolveDataBase } from "./data-dir.js";
import { IMPORTED_DIRNAME, archiveModZip, isModZipName } from "./mod-archive.js";
import {
  PORT_ENV,
  portLadder,
  rememberLoopbackPort,
  resolveLoopbackPort,
} from "./loopback-port.js";
import { handledPorts, planOriginMerge } from "./origin-merge.js";
import {
  MOD_DB_NAME,
  MOD_DB_STORES,
  MOD_DB_VERSION,
  STORE_MODS,
  STORE_MOD_META,
  modMergeLines,
  planModMerge,
} from "./mod-origin-merge.js";
import type { ModRecord, ModSnapshot } from "./mod-origin-merge.js";
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
 * "@rpgm-tools/neo-angband-desktop". That path is where saves live for the lifetime of an
 * install, so it is not a cosmetic detail.
 */
app.setName("Neo Angband");

/**
 * init.c's writable tree, chosen per launch: beside the install by default, under
 * the user's application data only for a copy the installer put there. See
 * data-dir.ts for the order and why. The five ANGBAND_DIR_* subdirectories are
 * made under whichever base wins - each on its first write, not at startup, so a
 * folder a player sees is one the game actually uses (NodeRawFs.ensureRoot) - and
 * the mods folder sits alongside them, so an unzipped folder holds the program,
 * its data and its mods together.
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
 * This launch's log, opened before anything else can want to write to it.
 *
 * Beside the saves rather than in Electron's `app.getPath("logs")`: that one is
 * Chromium's, and it stays under the user profile even for a portable copy - so
 * "send me the logs folder from your game folder" would have found an empty
 * directory. See log-file.ts.
 *
 * Opened at module scope because a failure to open it is not a failure to
 * launch. `openLogFile` answers a working object that writes nowhere if the
 * folder cannot be made, so a read-only install still starts.
 */
const LOGS_DIR = path.join(USER_BASE, LOG_DIRNAME);
const LOG_FILE = openLogFile(LOGS_DIR, new Date(), process.pid);

/**
 * The main process's own log line: to the file AND to stdout.
 *
 * BOTH, not one. The file is what a player can send; stdout is what somebody
 * running the game from a terminal to diagnose a launch failure is looking at,
 * and the launch-failure case is exactly when the file may not exist yet
 * (openLogFile is inert if the folder cannot be made). Dropping the console half
 * would have taken the diagnostics away from the only situation that has no
 * other channel.
 *
 * Deliberately NOT the renderer's `log` from core: this process has no ring to
 * keep, no level to filter by and no player looking at a screen. It formats one
 * line the same way, and formatLogLine is the shared part so the two halves of
 * the file cannot drift into two formats.
 */
function mainLog(level: LogLevel, area: string, msg: string, data?: unknown): void {
  const line = formatLogLine({
    at: Date.now(),
    level,
    area,
    msg,
    ...(data === undefined ? {} : { data: describeValue(data) }),
  });
  LOG_FILE.append([line]);
  /* eslint-disable-next-line no-console -- this IS the console half of the
   * dual write; every other caller in this process goes through mainLog. */
  if (level === "error") console.error(line);
  // eslint-disable-next-line no-console -- as above.
  else console.log(line);
}

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
  /**
   * Archives sitting in the mods folder, waiting to be imported.
   *
   * REPORTED, NOT UNPACKED. Nothing here opens them: they are listed so the import
   * screen can offer them, and they are only read - over the ordinary /mods/<name>
   * route, like any other file in this folder - when the player picks one. A shell
   * that unpacked whatever it found at startup would parse an arbitrary archive on
   * the one path that must never do anything surprising.
   */
  readonly zips: readonly { readonly name: string; readonly bytes: number }[];
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
  const zips: { name: string; bytes: number }[] = [];
  try {
    const entries = fs.readdirSync(MODS_DIR, { withFileTypes: true });
    names = entries
      .filter((d) => d.isDirectory())
      /* NOT a mod: it is where imported archives are moved to. Every other
       * directory in here is a mod folder, which is why this one has to be named. */
      .filter((d) => d.name !== IMPORTED_DIRNAME)
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
    for (const e of entries) {
      /* Files only, and not through a symlink: a link called `x.zip` pointing at
       * something outside this folder would otherwise be served by the loopback
       * route and then moved by the archive op, which is two holes for the price
       * of one convenience nobody asked for. */
      if (!e.isFile() || !isModZipName(e.name)) continue;
      try {
        zips.push({ name: e.name, bytes: fs.statSync(path.join(MODS_DIR, e.name)).size });
      } catch {
        /* Vanished between the listing and the stat. Not an error worth reporting -
         * it simply is not there to import. */
      }
    }
    zips.sort((a, b) => a.name.localeCompare(b.name));
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
  return { packs, order: readLoadOrder(), dir: MODS_DIR, zips };
}

/**
 * Move one imported archive out of the way, into `mods/imported/`.
 *
 * IT USED TO DELETE IT. That was the wrong call and the reason is not tidiness: the
 * zip is the player's own copy of somebody else's work, and the game had already
 * taken what it needed from it. Deleting it made the game's copy the only one, so a
 * mod that turned out to be broken, or an install undone later, left the player with
 * nothing to go back to and a download to find again.
 *
 * The file work is mod-archive.ts, which is where its rules are tested. This is only
 * the channel: one operation, one leaf name, and a log line.
 */
function installModZipChannel(): void {
  ipcMain.handle(MOD_ZIP_CHANNEL, (_event, op: unknown, arg: unknown) => {
    if (op !== "archive") return { ok: false, error: `unknown operation ${String(op)}` };
    const result = archiveModZip(MODS_DIR, arg);
    LOG_FILE.append([
      result.ok
        ? `${new Date().toISOString()} INFO  [mods] moved ${String(arg)} to ${result.to} after importing it`
        : `${new Date().toISOString()} WARN  [mods] could not move ${String(arg)} aside: ${result.error}`,
    ]);
    return result;
  });
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
    logsDir: LOGS_DIR,
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

  installLogging();
  installUpdater();
  installModZipChannel();
  installBackupChannel();
}

/**
 * Ticket #133's cloud-backup folder. See BACKUP_CHANNEL's doc comment
 * (bridge-channel.ts) for why this is a native dialog rather than the browser's
 * `showDirectoryPicker()`.
 *
 * `dialog.showOpenDialog(win, ...)`, not the no-window overload: passing the
 * window makes the native picker modal to it, matching every other dialog this
 * process already opens (`dialog.showMessageBox(win, ...)` at the crash and
 * load-failure sites below).
 */
function installBackupChannel(): void {
  ipcMain.handle(BACKUP_CHANNEL, async (event, op: unknown, arg: unknown) => {
    const folder = readBackupFolder(USER_BASE);
    switch (op as BackupOp) {
      case "name":
        return folder === null ? null : backupFolderDisplayName(folder);

      case "choose": {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = win
          ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
          : await dialog.showOpenDialog({ properties: ["openDirectory"] });
        if (result.canceled || result.filePaths.length === 0) return null;
        const chosen = result.filePaths[0] as string;
        writeBackupFolder(USER_BASE, chosen);
        return backupFolderDisplayName(chosen);
      }

      case "forget":
        writeBackupFolder(USER_BASE, null);
        return { ok: true };

      case "write": {
        const { name, text } = (arg ?? {}) as { name?: unknown; text?: unknown };
        if (!isBackupFileName(name) || typeof text !== "string") {
          return { ok: false };
        }
        if (folder === null) return { ok: false };
        try {
          fs.writeFileSync(path.join(folder, name), text, "utf8");
          return { ok: true };
        } catch {
          /* Permission lapsed, folder removed, disk full: answered false, never
           * thrown - the fault table's "write() resolves false without prompting". */
          return { ok: false };
        }
      }

      default:
        return { ok: false, error: `unknown operation ${String(op)}` };
    }
  });
}

/**
 * The renderer's log lines, and the reports a player writes.
 *
 * NOTHING IS VALIDATED INTO A STRUCTURE here, on purpose: the renderer has
 * already rendered each record to its final line (core/log.ts formatLogLine), so
 * the main process's whole job is to put text in a file. Re-parsing it here
 * would be a second implementation of the format, which is the shape this
 * project keeps finding bugs in - two copies of a check, and only one learns.
 *
 * What IS checked is that the payload is strings, because the renderer is the
 * untrusted side of this boundary and `undefined.join` in an IPC handler takes
 * the main process down.
 */
function installLogging(): void {
  ipcMain.on(LOG_CHANNEL, (_event, payload: unknown) => {
    if (!Array.isArray(payload)) return;
    LOG_FILE.append((payload as unknown[]).filter((l): l is string => typeof l === "string"));
  });

  ipcMain.handle(REPORT_CHANNEL, (_event, text: unknown) => {
    if (typeof text !== "string" || text === "") {
      return { ok: false, error: "there was nothing in the report to write" };
    }
    try {
      const file = writeReportFile(LOGS_DIR, text, new Date());
      LOG_FILE.append([`${new Date().toISOString()} INFO  [report] wrote ${file}`]);
      return { ok: true, path: file };
    } catch (err) {
      /* Reported rather than swallowed: unlike a log line, this one was asked
       * for, and "saved" with nothing saved is worse than an error message. */
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/**
 * The in-place updater (packages/desktop/src/updater.ts).
 *
 * `handle`, not `on`: this one downloads 160 MB, and the synchronous bridge next
 * to it would freeze the renderer for the duration with no way to report
 * progress - which is most of what the player is owed while it happens.
 *
 * Every operation answers `{ ok, ... }` rather than throwing. A rejected invoke
 * arrives in the renderer as an Error whose message has been mangled through
 * IPC, and the renderer's job here is to put a sentence on the screen; giving it
 * a string it can print is better than giving it a stack it cannot.
 */
function installUpdater(): void {
  /* Held between `download` and `apply` so the renderer cannot ask us to swap in
   * a directory it names. The only path ever swapped is one this process
   * extracted itself, this session, from an archive it verified. */
  let staged: string | null = null;

  ipcMain.handle(UPDATE_CHANNEL, async (event, op: unknown, arg: unknown) => {
    const shape = shapeOf({
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      execPath: app.getPath("exe"),
      env: process.env,
    });
    try {
      if (op === "shape") return { ok: true, shape };
      if (op === "download") {
        if (shape.how !== "swap") return { ok: false, error: "this install cannot update itself" };
        const a = (arg ?? {}) as { url?: unknown; sha256?: unknown; size?: unknown };
        const archive = await downloadArchive({
          url: typeof a.url === "string" ? a.url : "",
          sha256: typeof a.sha256 === "string" ? a.sha256 : "",
          size: typeof a.size === "number" ? a.size : 0,
          repo: UPDATE_REPO,
          root: shape.installRoot,
          platform: process.platform,
          onProgress: (received, total) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(UPDATE_PROGRESS_CHANNEL, { received, total });
            }
          },
        });
        staged = await stageArchive(archive, shape.installRoot, process.platform);
        return { ok: true };
      }
      if (op === "apply") {
        if (staged === null) return { ok: false, error: "nothing has been downloaded" };
        /* AWAITED, and the quit is downstream of it. launchSwap rejects unless
         * the installer is confirmed running, and quitting anyway would put the
         * player back on the title screen of the old version with no error and
         * no way to tell that anything went wrong - which is precisely how this
         * failed silently on Windows for four releases. */
        await launchSwap({
          root: shape.installRoot,
          staging: staged,
          platform: process.platform,
          execPath: app.getPath("exe"),
          pid: process.pid,
        });
        /* The script's first act is to wait for THIS pid, so quitting is not a
         * side effect of applying - it is the second half of it. */
        app.quit();
        return { ok: true };
      }
      if (op === "reveal") {
        await shell.openExternal(typeof arg === "string" ? arg : `https://github.com/${UPDATE_REPO}/releases`);
        return { ok: true };
      }
      return { ok: false, error: `unknown update op` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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
  /*
   * THE ONE PLACE THE CONSOLE IS THE INTERFACE, not a log.
   *
   * These three branches are main.c's own: `usage` is its puts() loop, `quit` is
   * quit_fmt() going to stderr through plog, and `list-saves` is list_saves()
   * (main.c:301-333). Somebody typed `--help` or `-l` at a terminal and is
   * waiting for the answer THERE - routing it through mainLog would stamp a
   * timestamp and a level onto upstream's usage text and file a copy in a log
   * nobody asked for.
   */
  /* eslint-disable no-console -- see above: this is main.c's stdout, not logging. */
  switch (outcome.kind) {
    case "run":
      /* change_path's directory overrides, which the host layer needs before the
       * first file is touched - an override has to be in place before anything
       * creates a directory, and NodeRawFs creates one on its first write. */
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
  /* eslint-enable no-console */
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

/**
 * The death ledger: character ids this install has ever seen a tombstone for.
 *
 * OUTSIDE EVERY ORIGIN, because that is the whole point. A tombstone can only bury
 * a living copy of itself while the origin holding it is still being read, and
 * MERGED_FILE means an origin is read exactly once. So without this file the single
 * record proving a character is dead can end up sealed inside a handled origin,
 * with a living copy of that character in another one and the check that would
 * catch it permanently switched off. See MergePlan.deaths.
 *
 * Ids only. No names, no turns, nothing a player would mind being written down,
 * and nothing that could be used to reconstruct a character.
 */
const DEATHS_FILE = "deaths.txt";

function knownDeaths(userDir: string): Set<string> {
  try {
    const raw = fs.readFileSync(path.join(userDir, DEATHS_FILE), "utf8");
    return new Set(raw.split(/\s+/).filter((s) => s !== ""));
  } catch {
    return new Set();
  }
}

/** Union the ledger with `ids`. Never removes: a death is not revisable. */
function rememberDeaths(userDir: string, ids: Iterable<string>): void {
  const all = knownDeaths(userDir);
  let added = false;
  for (const id of ids) {
    if (!all.has(id)) {
      all.add(id);
      added = true;
    }
  }
  if (!added) return;
  try {
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, DEATHS_FILE), `${[...all].join("\n")}\n`, "utf8");
  } catch {
    /* Best effort, and the failure is visible in the log below rather than here:
     * losing this file costs the burial rule its memory, not a character. */
    mainLog("error", "recovery", "could not write the death ledger");
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
  removes: readonly string[] = [],
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
    /*
     * REMOVALS LAST, and this order is the whole of the crash story.
     *
     * These are the only deletions this shell performs: a save slot whose character
     * a tombstone elsewhere reports dead (origin-merge.ts buriedIds). Killed between
     * the two halves, the two orders leave very different wreckage:
     *
     *   writes then removes  -> the roster says dead, the bytes are still there. The
     *                           picker will not offer a dead row, so nothing is
     *                           resumable, and the next launch plans the same
     *                           removal again. Self-healing.
     *   removes then writes  -> the roster still says ALIVE and the bytes are gone.
     *                           A row the player will click that cannot load, and
     *                           the reason it cannot is a file this process deleted.
     *
     * The first sentence of the first version of this comment argued for the second
     * order, on the grounds that a dead row must not sit in front of live bytes.
     * That window is harmless; the other one is a broken character.
     */
    for (const key of removes) {
      const gone = (await win.webContents.executeJavaScript(
        `(() => { try { localStorage.removeItem(${JSON.stringify(key)});
                        return localStorage.getItem(${JSON.stringify(key)}) === null; }
                  catch { return false; } })()`,
      )) as boolean;
      /* A removal that did not happen is reported the same way a refused write is,
       * so it reaches handledPorts and the origin that justified it stays
       * outstanding. Silently swallowing it would let the marker claim the job was
       * finished while the resumable bytes are still sitting there. */
      if (!gone) failed.push(key);
    }
  } finally {
    win.destroy();
  }
  return failed;
}

/**
 * The shared preamble of both IndexedDB scripts: open the mod database in whatever
 * origin this hidden window is pointed at, creating the stores if it is a fresh one.
 *
 * Opened WITH the version, and creating every store, because the target origin may
 * never have run the game: opening versionless would create the database at version 1
 * with no stores, and the game's own later open at version 2 would then be the only
 * thing that could add them - after this write had already failed. The constants come
 * from mod-origin-merge.ts, which a test pins to web/idb.ts.
 */
const MOD_DB_PREAMBLE = `
  const wrap = (r) => new Promise((res) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  });
  const db = await new Promise((res) => {
    let r;
    try { r = indexedDB.open(${JSON.stringify(MOD_DB_NAME)}, ${String(MOD_DB_VERSION)}); }
    catch { res(null); return; }
    r.onupgradeneeded = () => {
      for (const n of ${JSON.stringify(MOD_DB_STORES)}) {
        if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n);
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
    r.onblocked = () => res(null);
  });
  /* One transaction PER REQUEST. A transaction auto-commits as soon as it has no
   * pending request, so reusing one across two awaited calls throws
   * TransactionInactiveError on the second - intermittently, depending on timing. */
  const store = (name, mode) => db.transaction(name, mode).objectStore(name);
`;

/**
 * Read the installed mods out of the origin served on `port`.
 *
 * Bytes come back base64: a Uint8Array does not survive `executeJavaScript` as itself,
 * and silently arriving as `{}` is exactly the kind of empty success that would let the
 * merge report mods it never carried.
 */
async function readOriginMods(port: number): Promise<ModRecord[]> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL(`http://127.0.0.1:${port}${ORIGIN_PROBE_ROUTE}`);
    return (await win.webContents.executeJavaScript(
      `(async () => {
        ${MOD_DB_PREAMBLE}
        if (!db) return [];
        const b64 = (v) => {
          const u = v instanceof Uint8Array ? v : new Uint8Array(v);
          let s = "";
          /* Chunked: String.fromCharCode.apply on a multi-megabyte mod overflows the
           * argument stack, and a mod that big is exactly the one worth carrying. */
          const C = 0x8000;
          for (let i = 0; i < u.length; i += C) {
            s += String.fromCharCode.apply(null, u.subarray(i, i + C));
          }
          return btoa(s);
        };
        const metaKeys = (await wrap(store(${JSON.stringify(STORE_MOD_META)}, "readonly").getAllKeys())) ?? [];
        const metaVals = (await wrap(store(${JSON.stringify(STORE_MOD_META)}, "readonly").getAll())) ?? [];
        const fileKeys = (await wrap(store(${JSON.stringify(STORE_MODS)}, "readonly").getAllKeys())) ?? [];
        const fileVals = (await wrap(store(${JSON.stringify(STORE_MODS)}, "readonly").getAll())) ?? [];
        /* Driven by the META keys: that store is what "installed" MEANS. Loose bytes
         * with no metadata row are not an installed mod and carrying them would put
         * files in the new origin that nothing there will ever read or clean up. */
        return metaKeys.map((id, i) => {
          const files = {};
          for (let j = 0; j < fileKeys.length; j++) {
            const k = String(fileKeys[j]);
            if (k.startsWith(id + "/")) files[k.slice(String(id).length + 1)] = b64(fileVals[j]);
          }
          return { id: String(id), meta: metaVals[i] ?? null, files };
        });
      })()`,
    )) as ModRecord[];
  } catch (err) {
    /* An origin whose mods could not be read has NOT been handled. Returning [] here
     * would be indistinguishable from "it had none", and the caller would mark the
     * port done and strand them - so this rethrows and the caller leaves the job
     * outstanding, exactly as a failed localStorage read does. */
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    win.destroy();
  }
}

/**
 * Write whole mods into the origin served on `port`. Returns the ids that did not land.
 *
 * FILES FIRST, METADATA LAST, and the order is the crash story again (see
 * writeOriginStorage). Killed between the two halves:
 *
 *   files then meta -> loose bytes and no metadata row. The mod is not listed, nothing
 *                      loads it, and the next launch plans the same copy again.
 *   meta then files -> the Mods screen lists a mod whose files are absent, which fails
 *                      at load time for a reason the player cannot act on.
 */
async function writeOriginMods(port: number, records: readonly ModRecord[]): Promise<string[]> {
  if (records.length === 0) return [];
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const failed: string[] = [];
  try {
    await win.loadURL(`http://127.0.0.1:${port}${ORIGIN_PROBE_ROUTE}`);
    for (const rec of records) {
      /* One mod per evaluation, so a quota refusal names the mod that hit it instead
       * of losing the whole batch - a mod can be megabytes. */
      const ok = (await win.webContents.executeJavaScript(
        `(async () => {
          ${MOD_DB_PREAMBLE}
          if (!db) return false;
          const rec = ${JSON.stringify(rec)};
          const bytes = (s) => {
            const bin = atob(s);
            const u = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
            return u;
          };
          try {
            for (const [path, b] of Object.entries(rec.files)) {
              const put = store(${JSON.stringify(STORE_MODS)}, "readwrite")
                .put(bytes(b), rec.id + "/" + path);
              if ((await wrap(put)) === null) return false;
            }
            const m = store(${JSON.stringify(STORE_MOD_META)}, "readwrite").put(rec.meta, rec.id);
            return (await wrap(m)) !== null;
          } catch { return false; }
        })()`,
      )) as boolean;
      if (!ok) failed.push(rec.id);
    }
  } catch (err) {
    /* The whole batch is unproven, so every id is reported failed rather than the
     * loop's progress being trusted. */
    mainLog("error", "recovery", `could not write mods into port ${String(port)}`, err);
    for (const rec of records) if (!failed.includes(rec.id)) failed.push(rec.id);
  } finally {
    win.destroy();
  }
  return failed;
}

/** The ids the target origin already has installed, so the merge never displaces one. */
async function readOriginModIds(port: number): Promise<string[]> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL(`http://127.0.0.1:${port}${ORIGIN_PROBE_ROUTE}`);
    return (await win.webContents.executeJavaScript(
      `(async () => {
        ${MOD_DB_PREAMBLE}
        if (!db) return [];
        const ks = (await wrap(store(${JSON.stringify(STORE_MOD_META)}, "readonly").getAllKeys())) ?? [];
        return ks.map(String);
      })()`,
    )) as string[];
  } finally {
    win.destroy();
  }
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
  const dead = knownDeaths(userDir);
  const todo = knownPorts.filter((p) => p !== stablePort && !done.has(p));
  /*
   * NOT `if (todo.length === 0) return`, which is what this used to be. The ledger
   * makes this pass useful with no sources at all: the target may hold a living row
   * for a character this install has already recorded as dead, in an origin that was
   * marked handled long ago and will never be read again. That is exactly the case
   * the ledger exists for, so it has to be checked even when there is nothing to
   * harvest.
   */
  if (todo.length === 0 && dead.size === 0) return;

  const sources: OriginSnapshot[] = [];
  const modSources: ModSnapshot[] = [];
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
      /* Both stores, while the throwaway server for this port is still up: the roster
       * from localStorage and the installed mods from IndexedDB. Reading them in one
       * visit is not an optimisation - the server is closed in the `finally` below, so
       * a second pass would have nothing to connect to. */
      sources.push({ port, entries: await readOriginStorage(port) });
      modSources.push({ port, mods: await readOriginMods(port) });
    } catch (err) {
      /* NOT marked handled - see the `read` set below. Reaching this means the port
       * could not be bound, and the commonest reason now is that ANOTHER COPY of the
       * game is serving itself on it, which is exactly the case the port ladder
       * creates. The characters are still there and still readable once that copy is
       * closed, so the only correct thing to do is leave the job outstanding. */
      mainLog("error", "recovery", `could not read storage on port ${String(port)}`, err);
    } finally {
      server.close();
    }
  }

  const plan = planOriginMerge(await readOriginStorage(stablePort), sources, dead);
  const modPlan = planModMerge(await readOriginModIds(stablePort), modSources);
  /* BEFORE any origin can be marked handled. Marking is what makes a tombstone
   * unreadable forever, so the ledger has to have the ids first or the marker can
   * seal away the only record of a death. */
  rememberDeaths(userDir, plan.deaths);
  const keys = Object.keys(plan.writes);
  /* `plan.removes` counts as work: a plan that only deletes bytes must not take the
   * "nothing to do" exit, which would mark the sources handled without performing
   * the deletion the tombstone in one of them justified.
   *
   * AND SO DO MODS. An origin can easily hold installed mods and no characters at all
   * - the player who tried a tileset and never finished a birth - and before the mod
   * half existed this exit was reached for exactly that origin, marking it handled and
   * making its mods unreachable forever. */
  if (keys.length === 0 && plan.removes.length === 0 && modPlan.install.length === 0) {
    /* `sources`, not `todo`: only origins that were actually read. See handledPorts
     * for why the difference is a character. */
    const mark = handledPorts(done, sources, { failedKeys: [], missingKeys: [] });
    if (mark) rememberMergedPorts(userDir, mark);
    return;
  }

  const failed = await writeOriginStorage(stablePort, plan.writes, plan.removes);
  /* Mods carried in the same pass, and their failures are keys as far as handledPorts
   * is concerned: a mod that did not land leaves the only copy in the source origin,
   * so marking that origin handled would strand it exactly as a refused save key
   * would. `mod:` prefixed so a log line says which kind of thing failed. */
  const failedMods = await writeOriginMods(stablePort, modPlan.install);
  for (const id of failedMods) failed.push(`mod:${id}`);
  /* NOT logged here. The read-back below can still move a mod from brought-over to
   * failed, and a log line written before it would contradict the dialog the player is
   * about to read - see the log next to `modLines`. */
  if (plan.removes.length > 0) {
    /* Worth a line of its own: it is the one thing here that destroys bytes, and
     * a player who finds a character gone deserves to be able to read why. */
    mainLog(
      "info",
      "recovery",
      `dropped ${String(plan.removes.length)} resumable save(s) for characters another ` +
        "origin records as dead (decision 16: death is permanent)",
      { removed: plan.removes },
    );
  }

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
  /* The same read-back for mods, by metadata key rather than by comparing bytes: a mod
   * is megabytes and re-reading every one to diff it would cost more than it proves.
   * The key is what makes a mod installed, and its absence is what the durable failure
   * looks like - a whole database that did not persist. */
  if (modPlan.install.length > 0) {
    const idsAfter = new Set(await readOriginModIds(stablePort));
    for (const rec of modPlan.install) {
      if (!idsAfter.has(rec.id) && !failed.includes(`mod:${rec.id}`)) {
        missing.push(`mod:${rec.id}`);
        if (!failedMods.includes(rec.id)) failedMods.push(rec.id);
      }
    }
  }
  if (missing.length > 0) {
    mainLog(
      "error",
      "recovery",
      `did not stick for ${String(missing.length)} key(s) - the old storage is untouched ` +
        "and it will be retried",
      { missing },
    );
  }

  /* Only mark the sources handled if everything landed AND is still there, and only
   * the ones that were read. Both rules live in handledPorts, which is testable;
   * this used to be two inline conditions and one of them was wrong. */
  const mark = handledPorts(done, sources, { failedKeys: failed, missingKeys: missing });
  if (mark) rememberMergedPorts(userDir, mark);

  const names = plan.recovered.map((r) => `${r.name}${r.hasSave ? "" : " (memorial)"}`);
  mainLog(
    "info",
    "recovery",
    `recovered ${String(plan.recovered.length)} character(s) from ` +
      `${sources.map((s) => String(s.port)).join(", ")}: ${names.join(", ")}`,
    plan.skippedUnplayed.length > 0
      ? { leftBehind: plan.skippedUnplayed.map((r) => r.name) }
      : undefined,
  );
  /* Mods alone are enough to speak. An origin can hold installed mods and no
   * characters, and that recovery was silent before the mod half existed - the player
   * saw their tileset come back with nothing to explain why it had gone. */
  const modLines = modMergeLines(modPlan, failedMods);
  if (modLines.length > 0) {
    mainLog("info", "recovery", modLines.join(" | "), {
      brought: modPlan.install.filter((m) => !failedMods.includes(m.id)).map((m) => m.id),
      failed: failedMods,
    });
  }
  if (plan.recovered.length > 0 || modPlan.install.length > 0) {
    const chars =
      plan.recovered.length > 0
        ? `${String(plan.recovered.length)} character(s)`
        : "";
    const mods =
      modPlan.install.length > 0
        ? `${String(modPlan.install.length - failedMods.length)} mod(s)`
        : "";
    const both = [chars, mods].filter((s) => s !== "").join(" and ");
    await dialog.showMessageBox({
      type: failed.length === 0 ? "info" : "warning",
      title: "Neo Angband",
      message:
        failed.length === 0 ? `Recovered ${both}.` : `Recovered ${both}, with problems.`,
      detail:
        /* Two things now put characters in another origin: the ephemeral-port era,
         * and this copy stepping to a free port because its usual one was in use.
         * Worded to be true of both rather than naming the first and being wrong
         * half the time - the port numbers are the part a player can act on.
         *
         * "characters and mods" TOGETHER in the opening sentence, because the two live
         * in one origin bucket and go missing as one event. A player who was told only
         * about characters would reasonably conclude their mods were uninstalled by
         * something else. */
        "Your characters and installed mods were stored against a different port " +
        `number (${sources.map((s) => String(s.port)).join(", ")}) than this copy is ` +
        `now using (${String(stablePort)}), which is why they stopped appearing. They ` +
        "have been moved into this copy's own storage." +
        (names.length > 0 ? `\n\nOn the character screen now:\n${names.join("\n")}` : "") +
        (modLines.length > 0 ? `\n\n${modLines.join("\n")}` : "") +
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

  /* THE THREE WAYS THIS WINDOW GOES BLANK WITHOUT SAYING ANYTHING.
   *
   * The renderer has its own crash screen (web/src/crash-screen.ts) and it
   * handles everything the page can catch. These three it cannot: the renderer
   * process dying takes the crash screen with it, a wedged renderer never runs
   * it, and a failed load means there is no page to run it in. All three
   * present identically to a player - a black window - and all three used to
   * present that way with no message at all.
   *
   * A dialog rather than a log line, for the same reason the missing-bundle and
   * read-only-folder checks above use one: this is a packaged desktop app, and
   * a player has no terminal to read. */
  win.webContents.on("render-process-gone", (_event, details) => {
    void dialog.showMessageBox(win, {
      type: "error",
      title: "Neo Angband",
      message: "The game stopped unexpectedly.",
      detail:
        `The window's process ended (${details.reason}` +
        (details.exitCode ? `, exit ${String(details.exitCode)}` : "") +
        ").\n\nYour saved characters are on disk and were not touched. Restart " +
        "the game and it will pick up from your last save.\n\n" +
        "Please report this: github.com/neostryder/neo-angband/issues",
    });
  });

  win.on("unresponsive", () => {
    /* Not fatal, and not necessarily a bug - level generation on a slow machine
     * can hold the thread. Ask rather than announce. */
    void dialog
      .showMessageBox(win, {
        type: "warning",
        buttons: ["Keep waiting", "Reload from the last save"],
        defaultId: 0,
        cancelId: 0,
        title: "Neo Angband",
        message: "The game has stopped responding.",
        detail:
          "It may just be busy. If it does not come back, reloading starts " +
          "again from your last save - which is untouched either way.",
      })
      .then((r) => {
        if (r.response === 1) win.webContents.reload();
      });
  });

  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    /* -3 is ERR_ABORTED, which is what a navigation replaced by another one
     * reports. Not a failure, and firing a dialog for it would make the app
     * shout during its own startup. */
    if (!isMainFrame || code === -3) return;
    void dialog.showMessageBox(win, {
      type: "error",
      title: "Neo Angband",
      message: "The game could not load.",
      detail:
        `${description} (${String(code)})\n${url}\n\n` +
        "This is the local server the app runs for itself, so a firewall or " +
        "security tool blocking 127.0.0.1 is the usual cause. Your saves are " +
        "not involved and were not touched.",
    });
  });

  await win.loadURL(`http://127.0.0.1:${port}/${agentQuery()}`);
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
        "Build it first:  pnpm --filter @rpgm-tools/neo-angband-web bundle",
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
  mainLog("info", "data", `(${DATA.kind}) ${USER_BASE}`);

  installHostBridge(DIR_OVERRIDES);

  /* The origin the roster lives under. Resolved and remembered BEFORE the server
   * binds, so the number is stable across launches; see loopback-port.ts for what
   * an ephemeral one cost. */
  const choice = resolveLoopbackPort({
    env: process.env,
    userDir: path.join(USER_BASE, "user"),
    sessionDir: app.getPath("sessionData"),
  });
  mainLog("info", "port", `loopback port (${choice.source}): ${String(choice.port)}`, {
    /* The other origins matter: a save lives under ONE of them and an ephemeral
     * port once meant a new origin per launch, so which ports have ever been
     * used is the first thing to ask when a character has gone. */
    known: choice.known,
  });

  /* The ladder, and why moving is safe now when it was not before.
   *
   * A busy port used to be fatal, because binding elsewhere would have opened a
   * different origin and shown the player an empty character screen. That reasoning
   * held until recoverStrandedOrigins existed; it has run on every launch for
   * several releases, and it is what carries the roster from the origin this copy
   * used to be on to the one it lands on - the call is a few lines below.
   *
   * The case that reported this: two DIFFERENT copies of the game, each with its own
   * profile and its own roster, both wanting DEFAULT_PORT. Nothing is shared between,
   * so the second one stepping to the next rung costs nothing at all. One copy
   * launched twice does not reach here - the single-instance lock above sends the
   * second process away before the port is even resolved.
   *
   * An explicit NEO_ANGBAND_PORT never moves (choice.mayMove), and whatever is bound
   * is remembered, so a copy that stepped to 45872 stays there rather than drifting
   * back the next time 45871 happens to be free. Drifting would be a merge every
   * launch and two origins forever taking turns. */
  const ladder = choice.mayMove ? portLadder(choice.port) : [choice.port];
  let port: number | null = null;
  let lastErr: unknown = null;
  for (const candidate of ladder) {
    try {
      port = await startServer(candidate);
      break;
    } catch (err) {
      lastErr = err;
      /* Only "somebody has it" is a reason to try the next one. Anything else is a
       * problem with this machine's networking that the next port will hit too, and
       * hiding it behind sixteen identical failures would make it unreadable.
       * EACCES is included because Windows reports an excluded port range - a
       * Hyper-V or WSL reservation - that way rather than as EADDRINUSE. */
      const code = (err as NodeJS.ErrnoException | null)?.code;
      if (code !== "EADDRINUSE" && code !== "EACCES") break;
      mainLog("info", "port", `port ${String(candidate)} is taken (${code}), trying the next`);
    }
  }

  if (port === null) {
    /* Every rung refused. Still fatal, and still says which number and how to
     * choose one, because at this point the machine is the problem. */
    await dialog.showMessageBox({
      type: "error",
      title: "Neo Angband",
      message: `Port ${choice.port} is not available.`,
      detail:
        "The game serves itself to its own window over this port, and your " +
        "characters are stored against it.\n\n" +
        `${lastErr instanceof Error ? lastErr.message : String(lastErr)}\n\n` +
        (ladder.length > 1
          ? `Ports ${String(ladder[0])} to ${String(ladder[ladder.length - 1])} were all ` +
            "refused, so this is unlikely to be another copy of the game.\n\n"
          : "") +
        "Either close whatever is using the port, or choose a different one by " +
        `setting ${PORT_ENV} (it will be remembered).` +
        (choice.known.length > 1
          ? `\n\nThis copy has storage under these ports: ${choice.known.join(", ")}.`
          : ""),
    });
    app.quit();
    return;
  }

  if (port !== choice.port) {
    mainLog(
      "info",
      "port",
      `port ${String(choice.port)} was taken, so this copy is on ${String(port)}; ` +
        "the character roster follows below",
    );
  }
  rememberLoopbackPort(path.join(USER_BASE, "user"), port);

  /* Before the game opens, reunite anything the ephemeral-port era stranded. Never
   * allowed to stop the launch. */
  try {
    await recoverStrandedOrigins(path.join(USER_BASE, "user"), port, choice.known);
  } catch (err) {
    mainLog("error", "recovery", "character recovery failed", err);
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
