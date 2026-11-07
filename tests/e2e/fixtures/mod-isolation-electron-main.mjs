// Electron main process for the isolation probe. It registers the desktop
// shell's own `neo-angband://` scheme with the shell's own privileges (imported
// from packages/desktop/src/app-origin.ts), serves the probe page from it with
// the same cross-origin isolation headers the shell sends, and opens a window
// with the shell's webPreferences. Every request that reaches the scheme handler
// or the network is counted, and the spec reads the counts back.
import { app, BrowserWindow, protocol, session } from "electron";
import * as fs from "node:fs";
import { APP_HOST, APP_SCHEME, APP_SCHEME_PRIVILEGES } from "../../../packages/desktop/src/app-origin.ts";

// Bundled to CommonJS by the spec with esbuild, the desktop shell's own bundler.

const files = JSON.parse(fs.readFileSync(process.env.NEO_ANGBAND_PROBE_FILES ?? "", "utf8"));
const hits = {};
globalThis.probeHits = hits;
const count = (key) => { hits[key] = (hits[key] ?? 0) + 1; };

protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: APP_SCHEME_PRIVILEGES }]);

void app.whenReady().then(async () => {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    if (["/secret.txt", "/remote-module.js", "/events"].includes(url.pathname)) count(url.pathname);
    const file = files[url.pathname];
    return new Response(file?.body ?? "Not found", {
      status: file === undefined ? 404 : 200,
      headers: {
        "Content-Type": file?.type ?? "text/plain; charset=utf-8",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    });
  });
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] }, (details, callback) => {
    count(new URL(details.url).host);
    callback({ cancel: true });
  });
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadURL(`${APP_SCHEME}://${APP_HOST}/`);
});

app.on("window-all-closed", () => app.quit());
