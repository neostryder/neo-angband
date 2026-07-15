/**
 * Preload bridge for the desktop build (contextIsolation on, nodeIntegration
 * off). It exposes a small, read-only surface the web app can feature-detect to
 * tell it is running under Electron and where the user mods folder is served.
 *
 * The renderer stays the ordinary web bundle: it treats window.neoDesktop as an
 * optional capability. On the web/PWA surface window.neoDesktop is simply
 * undefined, so the same code degrades cleanly. This is the seam the
 * filesystem/URL mod-install path (surfaced but not implemented in the web
 * build) will use on desktop: the local server already serves the user mods
 * directory under /mods, and /mods/index.json lists the installed mod folders.
 */

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("neoDesktop", {
  isDesktop: true,
  platform: process.platform,
  /** Where the local server exposes the user's mods/ directory. */
  modsBaseUrl: "/mods",
  /** The listing endpoint (returns a JSON array of mod folder names). */
  modsIndexUrl: "/mods/index.json",
});
