/**
 * The three facts about fetching a mod from GitHub that every install path needs:
 * where a file lives at a tag, whether a path is safe to write, and how two tags
 * order.
 *
 * WHAT THIS FILE USED TO BE, because the deletion is the interesting part. It held
 * RECOMMENDED_MODS: a catalogue compiled into the game build naming every mod, its
 * tag, and a SHA-256 for each of its files. The digest shipped INSIDE the build, so
 * bytes were checked against a value that had not travelled over the connection that
 * delivered them - a genuinely stronger check than what replaced it, and it is worth
 * being blunt about that rather than describing the change as an upgrade.
 *
 * WHY IT WENT ANYWAY. A shipped digest pins a mod to a VERSION, and a version is the
 * thing a mod is supposed to be able to change on its own. Under that model:
 *
 *   - a mod could never be newer than the game, so "check for updates" was a local
 *     comparison that could only ever offer what this build already knew. Its silence
 *     meant "nothing newer shipped HERE" and it said "you are up to date";
 *   - a fix to a mod needed a game release to reach anyone;
 *   - and a third-party mod was structurally second class - it could not appear in a
 *     list compiled into somebody else's build, so it arrived by a different path
 *     with different code and different guarantees.
 *
 * What stands in its place is TRUST ON FIRST USE, pinned on ORIGIN rather than on
 * bytes (mod-install.ts installModFromRepo): a mod may only ever be replaced by a
 * copy from the same repository it was installed from, which survives a version bump
 * where a digest cannot. The digest of what actually arrived is recorded at install,
 * so "has this changed since I installed it" stays answerable; "is this what the
 * author published" is what was given up, and the curated list at mods/registry.json
 * now names repositories and nothing else.
 *
 * WHY raw.githubusercontent.com AND NOT A RELEASE ZIP. Measured from the real origin
 * (https://neostryder.github.io) rather than assumed, because the answer decides
 * whether the static web build can install a mod AT ALL:
 *
 *   raw.githubusercontent.com at a tag  Access-Control-Allow-Origin: *   works
 *   api.github.com                      Access-Control-Allow-Origin: *   works
 *   a release ASSET                     (no CORS header)                 blocked
 *   codeload zipball                    ACAO: render.githubusercontent    blocked
 *
 * A release asset is the obvious choice and it is the one that cannot work: the
 * browser refuses the read. So a mod's payload is its committed files, fetched at a
 * tag - and a large pack travels as ONE committed archive rather than hundreds of
 * files, because hundreds of round trips is its own kind of broken.
 *
 * Binary bytes survive this path intact: the same measurement fetched a committed PNG
 * cross-origin and confirmed the signature (89 50 4e 47) and content-type, so an
 * archive and a tile are as fetchable as a manifest.
 */

import { compareSemver } from "@rpgm-tools/neo-angband-mod-sdk";

/**
 * Why this path may not be written, or null when it is safe.
 *
 * A downloaded path becomes a key under the mod's own prefix, and on the desktop
 * build the same shape becomes a real filename. `..` is the whole reason this
 * function exists: a mod shipping `../../saves/x` would otherwise escape its folder.
 * Rejected rather than normalised, because a path that needed normalising was written
 * by something with intent, and quietly repairing it hides that.
 *
 * It matters MORE under trust-on-first-use than it did under the shipped catalogue.
 * Those paths had been read by whoever wrote the catalogue entry; these come from a
 * manifest, or from inside a zip, and nobody has looked at them.
 */
export function badPath(path: string): string | null {
  if (path === "") return "empty path";
  if (path.startsWith("/") || /^[A-Za-z]:/u.test(path)) return "absolute path";
  if (path.includes("\\")) return "backslash in path";
  const segments = path.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    return "path escapes the mod folder";
  }
  /* NUL and the Windows-reserved set: a mod installed in a browser and then exported
   * to a desktop mods folder has to be writable on both. */
  if (/[\0<>:"|?*]/u.test(path)) return "path has a character a filesystem refuses";
  return null;
}

/**
 * The URL for one file of a mod, at a tag.
 *
 * `refs/tags/` is spelled out rather than left to raw.githubusercontent's shorthand,
 * because the short form resolves a BRANCH of the same name first - so a repository
 * with both `v1.0.0` the tag and `v1.0.0` the branch would serve the branch. That was
 * a way round the pinned digest when there was one; it is now a way to serve
 * something other than the release the player chose, which is the same problem
 * wearing different clothes.
 */
export function rawUrl(repo: string, tag: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${repo}/refs/tags/${encodeURIComponent(tag)}/${encoded}`;
}

/**
 * Order two release tags: negative if `a` is older, 0 if equal, positive if `a`
 * is newer, and null when they cannot be ordered.
 *
 * WHY ORDER THEM AT ALL, when noticing a difference sounds like enough. Because
 * "different" was being RENDERED as "update", and the two are not the same claim. A
 * player whose installed tag is newer than the one on offer would be shown their
 * newer copy with an arrow pointing at the older one and the word "update" next to
 * it - and pressing Enter would quietly roll them back. A string `!==` cannot tell
 * those apart, and neither can a string `<`: it puts v0.9.0 above v0.10.0.
 *
 * Null is a real answer, not a fallback. A tag need not be a version at all
 * (`latest`, a date, a commit-ish), and saying "these differ, in an order I
 * cannot work out" is honest where guessing a direction is not.
 */
export function compareTags(a: string, b: string): number | null {
  /* The one convention this strips: a leading `v`, which is how every tag this
   * project publishes is written and is not part of the version. Nothing else is
   * normalised - a tag that is not a version should come back null rather than be
   * bent into one. */
  const version = (tag: string): string => (/^v\d/u.test(tag) ? tag.slice(1) : tag);
  return compareSemver(version(a), version(b));
}
