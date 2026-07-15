/**
 * Neo Angband desktop (Electron) wrapper.
 *
 * This is a DISTRIBUTION track over the SAME web app, not a fork: it serves the
 * production web bundle (packages/web/dist-web, built with base "./") from a
 * tiny in-process localhost server and loads it in a native window. Because the
 * bundle is identical to the one deployed to GitHub Pages / installed as a PWA,
 * play, content, and the whole mod framework behave the same on every surface.
 *
 * Why a localhost server instead of file:// -
 *  - service workers, fetch, and ES modules behave normally on http://127.0.0.1
 *    but are restricted or quirky under file://;
 *  - it lets us send Cross-Origin-Isolation headers (COOP + COEP), which turn on
 *    crossOriginIsolated and therefore SharedArrayBuffer. That is a genuine
 *    desktop parity-PLUS: a static host (Pages) cannot send those headers, so
 *    the untrusted-Worker deep-override path that needs SAB is only possible on
 *    the desktop build (documented in the parity matrix). Nothing REQUIRES it -
 *    the trusted in-process tier works everywhere - but the door is open here.
 *
 * The server binds to an ephemeral port on the loopback interface only, so
 * nothing is exposed off the machine. Path traversal is rejected. A user mods/
 * directory under userData is served read-only under /mods for the (documented,
 * follow-up) filesystem-mod-loading path.
 */

const { app, BrowserWindow, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const WEB_ROOT = path.join(__dirname, "..", "web", "dist-web");
const MODS_DIR = path.join(app.getPath("userData"), "mods");

const MIME = {
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
function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = decoded.replace(/^\/+/, "");
  const full = path.normalize(path.join(root, rel));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type ?? "text/plain; charset=utf-8",
    // Cross-origin isolation -> crossOriginIsolated -> SharedArrayBuffer.
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  res.end(body);
}

function serveFile(res, filePath, fallbackIndex) {
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

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? "/";
      // User mods folder (read-only), for the filesystem-mod path.
      if (url === "/mods/index.json") {
        let list = [];
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

async function createWindow() {
  if (!fs.existsSync(WEB_ROOT)) {
    // A helpful, honest error rather than a blank window.
    const { dialog } = require("electron");
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

  const port = await startServer();
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

app.whenReady().then(() => {
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  // macOS apps conventionally stay alive until Cmd-Q.
  if (process.platform !== "darwin") app.quit();
});
