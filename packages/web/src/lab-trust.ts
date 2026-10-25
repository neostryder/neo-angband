/**
 * Playing a work-branch build of a first-party mod in a lab build.
 *
 * A mod in the data folder's `mods` folder is measured as sideloaded, because a
 * folder copy has no repository fetch to prove where it came from. That is right
 * for a player and wrong for an author who is testing the game's own mod: the
 * presenters, the manage namespace, the controller and the engine domain all
 * need the first-party tier. A lab build can be told, for one launch, that named
 * folder mods are first-party.
 *
 * Two gates keep this out of a player's game. The flag only exists in a build
 * compiled with `NEO_ANGBAND_LAB_BUILD=1` (the vite and desktop builds both
 * read it; a release build never sets it, so the check below is dead code
 * there), and the desktop shell passes the ids only from its `--lab-trust=`
 * switch. A hand-edited address in a release build changes nothing.
 */

declare const __NEO_LAB_BUILD__: boolean | undefined;

export const LAB_TRUST_PARAM = "labtrust";

/** True only in a build compiled for the lab. */
export function labBuild(): boolean {
  return typeof __NEO_LAB_BUILD__ === "boolean" && __NEO_LAB_BUILD__;
}

/** The mod ids a lab launch names, or none when this is not a lab build. */
export function parseLabTrust(search: string, compiledForLab: boolean): ReadonlySet<string> {
  if (!compiledForLab) return new Set();
  const raw = new URLSearchParams(search).get(LAB_TRUST_PARAM) ?? "";
  return new Set(raw.split(",").map((id) => id.trim()).filter((id) => id !== ""));
}

/** The folder mods this launch treats as first-party. */
export function labTrust(): ReadonlySet<string> {
  try {
    return parseLabTrust(location.search, labBuild());
  } catch {
    return new Set();
  }
}
