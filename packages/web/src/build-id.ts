/**
 * Which BUILD this is, as distinct from which version.
 *
 * ENGINE_VERSION changes when somebody cuts a release. The web build changes on
 * every push to master, and every one of those deploys is `0.17.0` as far as the
 * version string is concerned. So "is the code running in this tab the code the
 * site is serving?" cannot be answered by the version, and until now it was not
 * answered at all - it was INFERRED from service-worker events, which is a
 * different question wearing the same clothes. A worker can take control without
 * the build changing, and a build can change without a worker event this page
 * ever sees.
 *
 * The build id makes it a comparison instead: the value baked into the bundle
 * versus the value in `build-id.json`, fetched with `cache: "no-store"`. Two
 * strings, one answer, no inference.
 *
 * IT IS NOT A SECRET AND IT IS NOT A VERSION. It is a commit SHA on CI and a
 * timestamp locally, and its only job is to be different when the build is
 * different. Nothing compares two of them for order.
 */

/**
 * Replaced at build time by vite's `define` (see vite.config.ts).
 *
 * Declared rather than imported so that a test, a Node import or the desktop
 * main process - none of which go through vite - gets the fallback instead of a
 * reference error. The fallback is a real value, not an empty string: a build id
 * of "" would compare equal to a fetch that failed, and "the check is off"
 * would look exactly like "you are up to date".
 */
declare const __NEO_BUILD_ID__: string | undefined;

/**
 * The file the built site serves next to index.html.
 *
 * `WEB_` on both names because `BUILD_ID` is already taken in this codebase, by
 * upstream's buildid.c string (`Neo Angband 4.2.6`) that heads a character dump.
 * The two are unrelated and the collision is the kind that reads fine at every
 * call site and is wrong at one of them.
 */
export const WEB_BUILD_ID_FILE = "build-id.json";

/** This bundle's build id. `dev` when nothing stamped one in. */
export const WEB_BUILD_ID: string =
  typeof __NEO_BUILD_ID__ === "string" && __NEO_BUILD_ID__ !== "" ? __NEO_BUILD_ID__ : "dev";

/** Whether this build was stamped at all - false in a dev server and in tests. */
export function isStampedBuild(id: string = WEB_BUILD_ID): boolean {
  return id !== "dev" && id !== "";
}

/**
 * Is the code running here older than what the server has?
 *
 * Answers false for anything it is not sure about, and every uncertainty is a
 * reason to be sure: an unstamped dev build has nothing to compare, a fetch that
 * failed proves nothing, and a malformed answer is a server this does not
 * understand. A false positive here puts an (U)pdate row in front of a player
 * that reloads them onto the same build, forever.
 */
export function isStale(mine: string, theirs: unknown): boolean {
  if (!isStampedBuild(mine)) return false;
  if (theirs === null || typeof theirs !== "object") return false;
  const id = (theirs as Record<string, unknown>)["buildId"];
  if (typeof id !== "string" || id === "" || id === "dev") return false;
  return id !== mine;
}
