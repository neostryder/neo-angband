/**
 * Preload bridge for the desktop build (contextIsolation on, nodeIntegration
 * off, sandbox on).
 *
 * Two globals, and the difference between them is the whole point of
 * parity/PLATFORM.md:
 *
 *   window.neoDesktop - "you are running under Electron", plus where the mods
 *                       folder is served. Informational; it existed before.
 *   window.neoHostFs  - z-file.c. The renderer's host layer talks through this,
 *                       so the desktop build gets REAL files rather than
 *                       discovering it has none and reshaping the game to fit.
 *
 * The renderer feature-detects both. On the web/PWA surface they are simply
 * undefined and the reduced BrowserHost is installed instead, so one bundle
 * serves every front end - which is upstream's arrangement, not a compromise.
 *
 * Nothing is computed here. A sandboxed preload has no node:fs (hence the
 * filesystem channel) and its own `process.argv` is the RENDERER's Chromium
 * switch list, not the user's command line (hence the info channel). Reading
 * argv here would have produced a plausible-looking array that never contains
 * the user's arguments, which is a stand-in, and a stand-in is worse than an
 * absence because it fills the slot where the census would have seen a gap.
 */

import { contextBridge, ipcRenderer } from "electron";
import {
  HOST_BRIDGE_CHANNEL,
  HOST_BRIDGE_GLOBAL,
  HOST_INFO_CHANNEL,
  HOST_SHELL_LIMITS,
} from "./bridge-channel";
import type { HostBridgeInfo } from "./bridge-channel";

/** Ask the main process what the platform is, once, at preload time. */
function platformInfo(): HostBridgeInfo {
  try {
    const r: unknown = ipcRenderer.sendSync(HOST_INFO_CHANNEL);
    if (r !== null && typeof r === "object") return r as HostBridgeInfo;
  } catch {
    /* fall through to the honest minimum */
  }
  /* The channel is not there, so this is not the shell we think it is. Report
   * no argv rather than an empty-but-supported one. */
  return { argv: [], ...HOST_SHELL_LIMITS };
}

const info = platformInfo();

contextBridge.exposeInMainWorld("neoDesktop", {
  isDesktop: true,
  platform: process.platform,
  /** Where the local server exposes the user's mods/ directory. */
  modsBaseUrl: "/mods",
  /** The listing endpoint (returns a JSON array of mod folder names). */
  modsIndexUrl: "/mods/index.json",
});

contextBridge.exposeInMainWorld(HOST_BRIDGE_GLOBAL, {
  /**
   * One synchronous round trip to the real filesystem.
   *
   * sendSync blocks the renderer, deliberately: z-file.c blocks too, and every
   * caller of it - prefs_save inside a menu handler, the game loop reading a
   * pref file inline - is written for a call that has finished when it returns.
   * The alternative is an async host, which would push `await` up through the
   * command layer and let the transport reshape the game's control flow.
   */
  call(op: string, args: readonly unknown[]): unknown {
    return ipcRenderer.sendSync(HOST_BRIDGE_CHANNEL, op, args);
  },

  /** main.c's argv, minus the program name, as the MAIN process sees it. */
  argv: info.argv,

  /** What this shell can do. See HOST_SHELL_LIMITS for why these are not 8/true. */
  termCount: info.termCount,
  signals: info.signals,
});
