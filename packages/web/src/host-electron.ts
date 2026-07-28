/**
 * The full-capability HostIo, for when this bundle is running inside the
 * Electron shell rather than a browser tab.
 *
 * This is the point of parity/PLATFORM.md. The web bundle is ONE front end that
 * runs on two platforms, exactly as upstream's `main-*.c` are several front ends
 * over one z-file.c. On a static host it gets BrowserHost, which is honest about
 * having no real files. Under the desktop shell it gets this, and the eighteen
 * census absences that exist only because "a browser cannot do that" stop being
 * true of the program - they become true of one platform, recorded as such.
 *
 * There is no new z-file.c here. The rules live once in core's RawFsHost and the
 * wire format lives once in core's host/bridge; this module only finds the
 * bridge the preload exposed, checks it is really there, and reports what it
 * says the platform can do. A missing or malformed bridge means "not the desktop
 * shell", and the caller falls back to BrowserHost rather than installing a host
 * that would claim real files it does not have.
 */

import type { HostIo } from "@neo-angband/core";
import { RawFsHost, rawFsOverTransport } from "@neo-angband/core";

/**
 * What packages/desktop's preload exposes on `window`. Declared here rather than
 * imported, deliberately: the web build must not depend on the desktop build (it
 * has to keep building for a static host), so this is a structural contract that
 * the runtime check below enforces.
 */
export interface DesktopHostBridge {
  /** One synchronous round trip to the real filesystem. */
  call(op: string, args: readonly unknown[]): unknown;
  /** main.c's argv, minus the program name, as the MAIN process sees it. */
  argv?: unknown;
  /** How many terminals the shell can actually show. */
  termCount?: unknown;
  /** Whether the shell really forwards "the process is dying". */
  signals?: unknown;
}

/** The global the preload writes. Must match HOST_BRIDGE_GLOBAL in packages/desktop. */
export const HOST_BRIDGE_GLOBAL = "neoHostFs";

/**
 * Find the desktop bridge, or null when this is an ordinary browser tab.
 *
 * The only thing that makes a bridge usable is a callable `call`. Everything
 * else is optional and validated at use, because a shell that reports a
 * capability wrongly is worse than one that reports nothing.
 */
export function detectDesktopBridge(scope: unknown = globalThis): DesktopHostBridge | null {
  if (scope === null || typeof scope !== "object") return null;
  const candidate = (scope as Record<string, unknown>)[HOST_BRIDGE_GLOBAL];
  if (candidate === null || typeof candidate !== "object") return null;
  const call = (candidate as Record<string, unknown>)["call"];
  if (typeof call !== "function") return null;
  return candidate as DesktopHostBridge;
}

/** argv as a string list, dropping anything that is not one. */
function toArgv(v: unknown): readonly string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((a): a is string => typeof a === "string");
}

/**
 * How many terms the shell says it can show, clamped to something a term index
 * can mean. Upstream's ANGBAND_TERM_MAX is 8 (ui-term.h:244), so a shell
 * claiming more is claiming something the game has no slot for.
 */
function toTermCount(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return 1;
  return Math.min(v, 8);
}

/**
 * A full-capability host over the desktop bridge.
 *
 * `signals` and `termCount` come from the shell rather than being assumed,
 * because they are the two capabilities the shell can be part-way through
 * providing. The current shell reports one term and no signal delivery, and that
 * is the truth: it opens one window, and nothing yet holds a quit open long
 * enough for a panic save to land.
 */
export function makeDesktopHost(bridge: DesktopHostBridge): HostIo {
  return new RawFsHost(
    rawFsOverTransport((op, args) => bridge.call(op, args)),
    {
      argv: toArgv(bridge.argv),
      termCount: toTermCount(bridge.termCount),
      /* Only an explicit true counts. An older preload that predates this field
       * leaves it undefined, and undefined must not read as "yes". */
      signals: bridge.signals === true,
    },
  );
}
