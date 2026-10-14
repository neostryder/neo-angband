/**
 * The mod API's own version, apart from the game's.
 *
 * A manifest names the API versions it was written for as a semver range
 * (`"api": ">=2.0.0 <3.0.0"`), and that range decides whether the mod loads.
 * The game's version is a diagnostic only. The API version moves on its own: a
 * game release that leaves the API alone does not change it.
 *
 * The minor number rises when the API gains something; the major number rises
 * only when an existing call changes what it does or goes away.
 */

import { satisfies, SemverError } from "../semver.js";

/** The API version this build of the SDK describes and the in-process host implements. */
export const MOD_API2_VERSION = "2.0.0";

/** The range a new mod should declare. */
export const MOD_API2_DEFAULT_RANGE = ">=2.0.0 <3.0.0";

/** Whether a mod's declared API range admits the host's API version. */
export type ApiRangeVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "malformed" | "too-old" | "too-new" | "outside"; readonly why: string };

function major(version: string): number {
  return Number(version.split(".")[0]);
}

/**
 * Judge a manifest's `api` range against the host's API version. Loaders call
 * this before importing any mod code. The answer names both sides, because a
 * mod built for a newer API needs a game update and one built for an older API
 * needs a mod update, and only the pair says which.
 */
export function apiRangeVerdict(range: string, host: string = MOD_API2_VERSION): ApiRangeVerdict {
  if (typeof range !== "string" || range.trim() === "") {
    return { ok: false, code: "malformed", why: `declares no API range; this game implements mod API ${host}` };
  }
  let fits: boolean;
  try {
    fits = satisfies(host, range);
  } catch (e) {
    if (!(e instanceof SemverError)) throw e;
    return { ok: false, code: "malformed", why: `declares the API range "${range}", which is not a valid range (${e.message})` };
  }
  if (fits) return { ok: true };
  const hostMajor = major(host);
  const mentioned = [...range.matchAll(/(<=|>=|<|>)?(\d+)(?:\.(\d+))?(?:\.(\d+))?/gu)].map((m) =>
    Number(m[2]) - (m[1] === "<" && Number(m[3] ?? 0) === 0 && Number(m[4] ?? 0) === 0 ? 1 : 0),
  );
  if (mentioned.length > 0 && mentioned.every((m) => m > hostMajor)) {
    return { ok: false, code: "too-new", why: `needs mod API ${range}; this game implements ${host}, so the mod needs a newer game` };
  }
  if (mentioned.length > 0 && mentioned.every((m) => m < hostMajor)) {
    return { ok: false, code: "too-old", why: `needs mod API ${range}; this game implements ${host}, so the mod needs an update for this game` };
  }
  return { ok: false, code: "outside", why: `needs mod API ${range}; this game implements ${host}` };
}
