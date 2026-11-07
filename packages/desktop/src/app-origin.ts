/**
 * The address the game window loads from: `neo-angband://game`.
 *
 * Characters, settings and installed mods live in the window's localStorage and
 * IndexedDB, and the browser engine files both under the page's origin. The game
 * used to be served from `http://127.0.0.1:<port>`, so the port was part of that
 * origin. Another program holding the port meant a different origin and an empty
 * character list (neostryder/neo-angband#323). A custom scheme has no port, so the
 * origin is the same on every launch whatever else is running, and the game binds
 * no TCP port at all.
 *
 * The scheme is registered as standard and secure. Standard gives it an origin
 * with storage of its own, and secure makes it a secure context, which the COOP and
 * COEP headers need before they turn on crossOriginIsolated. It has no service
 * worker privilege on purpose: the desktop shell already removes the worker on
 * every boot (web/src/pwa.ts), and without the privilege none is registered.
 *
 * Storage under the old `http://127.0.0.1:<port>` origins is carried over once by
 * recoverStrandedOrigins in main.ts. The helpers at the end of this file are for
 * that: they recognise the blank page a hidden window loads to reach one of those
 * origins, which is answered without binding the port.
 */

import { ORIGIN_PROBE_ROUTE } from "./routes.js";

export const APP_SCHEME = "neo-angband";
export const APP_HOST = "game";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** The privileges `protocol.registerSchemesAsPrivileged` grants the scheme. */
export const APP_SCHEME_PRIVILEGES = Object.freeze({
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true,
  codeCache: true,
});

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * True only for a page of the game's own origin.
 *
 * The URL is parsed and its parts compared, because a prefix test would also
 * accept `neo-angband://game.example/`.
 */
export function isGameUrl(url: string): boolean {
  const u = parse(url);
  return u !== null && u.protocol === `${APP_SCHEME}:` && u.host === APP_HOST;
}

/** The path and query a game URL asks for, as routes.ts expects them, or null. */
export function appRequestPath(url: string): string | null {
  if (!isGameUrl(url)) return null;
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
}

/** The old origin a copy of the game used while it was served on `port`. */
export function legacyOrigin(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}

/**
 * True when `url` is the blank page on one of the old origins being read.
 *
 * Only the ports in `ports`, and only the probe route: anything else is passed on
 * untouched, so the interception cannot serve a page anywhere it was not asked to.
 */
export function isLegacyProbe(url: string, ports: ReadonlySet<number>): boolean {
  const u = parse(url);
  if (u === null || u.protocol !== "http:" || u.hostname !== "127.0.0.1") return false;
  if (u.pathname !== ORIGIN_PROBE_ROUTE || u.search !== "") return false;
  return ports.has(Number(u.port));
}
