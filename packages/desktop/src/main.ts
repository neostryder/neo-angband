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

import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
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
import { LAUNCH_MODULES } from "./modules";
import {
  HOST_BRIDGE_CHANNEL,
  HOST_INFO_CHANNEL,
  HOST_SHELL_LIMITS,
} from "./bridge-channel";
import type { HostBridgeInfo } from "./bridge-channel";
import { checkWritable, resolveDataBase } from "./data-dir";

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
 * init.c's writable tree, chosen per launch: beside the install for a portable
 * copy, under the user's application data for an installed one. See data-dir.ts
 * for the order and why. NodeRawFs creates the five ANGBAND_DIR_* subdirectories
 * under whichever base wins.
 */
const DATA = resolveDataBase({
  env: process.env,
  exeDir: path.dirname(app.getPath("exe")),
  userData: app.getPath("userData"),
});
const USER_BASE = DATA.base;
const MODS_DIR = path.join(USER_BASE, "mods");

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
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

/** Resolve a request path safely under a root, rejecting traversal. */
function safeJoin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "");
  const rel = decoded.replace(/^\/+/, "");
  const full = path.normalize(path.join(root, rel));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

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

function serveFile(
  res: http.ServerResponse,
  filePath: string,
  fallbackIndex: boolean,
): void {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (fallbackIndex) {
        // SPA-style fallback to index.html for unknown non-asset routes.
        serveFile(res, path.join(WEB_ROOT, "index.html"), false);
        return;
      }
      send(res, 404, "Not found");
      return;
    }
    send(res, 200, data, MIME[path.extname(filePath).toLowerCase()]);
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
function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      // User mods folder (read-only), for the filesystem-mod path.
      if (url === "/mods/index.json") {
        let list: string[] = [];
        try {
          list = fs
            .readdirSync(MODS_DIR, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);
        } catch {
          /* no mods dir yet */
        }
        send(res, 200, JSON.stringify(list), MIME[".json"]);
        return;
      }
      if (url.startsWith("/mods/")) {
        const full = safeJoin(MODS_DIR, url.slice("/mods".length));
        if (!full) {
          send(res, 403, "Forbidden");
          return;
        }
        serveFile(res, full, false);
        return;
      }
      // The web bundle.
      const target = url === "/" ? "/index.html" : url;
      const full = safeJoin(WEB_ROOT, target);
      if (!full) {
        send(res, 403, "Forbidden");
        return;
      }
      serveFile(res, full, true);
    });
    server.on("error", reject);
    // Ephemeral port on loopback only.
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
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

async function createWindow(port: number): Promise<void> {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: "#0b0b0b",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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
  const port = await startServer();
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
  // macOS apps conventionally stay alive until Cmd-Q.
  if (process.platform !== "darwin") app.quit();
});
