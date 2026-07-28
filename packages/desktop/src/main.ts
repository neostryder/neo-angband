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
import { serveRawFs } from "@neo-angband/core/host";
import { NodeRawFs } from "@neo-angband/cli/host-node";
import {
  HOST_BRIDGE_CHANNEL,
  HOST_INFO_CHANNEL,
  HOST_SHELL_LIMITS,
} from "./bridge-channel";
import type { HostBridgeInfo } from "./bridge-channel";

const WEB_ROOT = path.join(__dirname, "..", "..", "web", "dist-web");

/**
 * Set BEFORE the first app.getPath("userData"), which derives from it and then
 * caches. Without this, Electron takes the name from package.json - which is the
 * scoped workspace name - and a player's savefiles land in a directory called
 * "@neo-angband/desktop". That path is where saves live for the lifetime of an
 * install, so it is not a cosmetic detail.
 */
app.setName("Neo Angband");

/**
 * init.c's writable tree. userData is Electron's per-user application data
 * directory (%APPDATA% / ~/Library/Application Support / ~/.config), which is
 * where a desktop game's savefiles belong; NodeRawFs creates the five
 * ANGBAND_DIR_* subdirectories under it.
 */
const USER_BASE = app.getPath("userData");
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
function installHostBridge(): void {
  const serve = serveRawFs(new NodeRawFs(USER_BASE));
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

  /* main.c's argv. Only this process sees the real command line: `electron .
   * -f Bilbo` in development puts the app path at argv[1], while a packaged
   * build does not have it, so the two cases drop a different amount. */
  const argv: readonly string[] = app.isPackaged
    ? process.argv.slice(1)
    : process.argv.slice(2);
  const info: HostBridgeInfo = { argv, ...HOST_SHELL_LIMITS };
  ipcMain.on(HOST_INFO_CHANNEL, (event) => {
    event.returnValue = info;
  });
}

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

  // Ensure the user mods directory exists so the folder is discoverable.
  try {
    fs.mkdirSync(MODS_DIR, { recursive: true });
  } catch {
    /* best-effort */
  }

  installHostBridge();
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
