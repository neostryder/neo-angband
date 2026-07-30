/**
 * The recommended-mod catalogue: what first run offers to download.
 *
 * The game does not bundle its own mods. Instead it ships this catalogue - a list of
 * repositories, a tag in each, and a SHA-256 for every file - and offers to fetch
 * them. That trade is deliberate and worth stating, because it moves code out of the
 * build and onto the network:
 *
 *   - A mod is developed, versioned, released and reported against on its own, at its
 *     own pace, in its own repository. A fix to the QoL mod is not a game release.
 *   - Third-party mods are then not a second-class path. The catalogue's entries and
 *     someone else's mod are the same shape, installed by the same code.
 *
 * WHY THE HASHES ARE HERE AND NOT FETCHED. This is the only thing standing between
 * "download from the internet" and "execute arbitrary code as the player". The digest
 * ships INSIDE the game build, so the bytes are checked against a value that did not
 * come over the same connection that delivered them: a compromised repository, a
 * replaced tag, or an intercepted response all fail the comparison. A hash fetched
 * alongside the file would authenticate nothing at all - whoever supplied the file
 * supplied the hash.
 *
 * That is also why entries pin a TAG and not a branch. `refs/heads/master` is whatever
 * the author pushed last, so its bytes change under a fixed digest and every install
 * would break on the next commit; and pinning a moving target is how a mod that was
 * reviewed becomes a mod that was not.
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

/** Where one file of a mod lives, and what it must hash to. */
export interface RegistryFile {
  /** Path inside the repository, which is also the path inside the mod folder. */
  readonly path: string;
  /** Lower-case hex SHA-256 of the exact bytes. 64 characters. */
  readonly sha256: string;
}

/**
 * A mod's payload: either its files listed one by one, or one committed archive.
 *
 * Two shapes rather than one because the sizes differ by three orders of magnitude. A
 * code mod is a manifest and a script - listing them is clearer, and each file gets
 * its own digest. A converted tile pack is 1505 files and 2.3 MB, where listing them
 * would mean 1505 requests and a catalogue longer than the game.
 */
export type RegistryPayload =
  | { readonly kind: "files"; readonly files: readonly RegistryFile[] }
  /**
   * A ZIP committed in the repository, unpacked after the digest matches. The digest
   * covers the ARCHIVE, so one comparison authenticates every file inside it - and it
   * is checked before a single entry is decompressed, so a malicious archive never
   * gets to be parsed.
   */
  | { readonly kind: "archive"; readonly archive: RegistryFile };

export interface RecommendedMod {
  /** The mod id, which is also its folder name and its manifest's `id`. */
  readonly id: string;
  /** Human name, as the manifest says it. */
  readonly name: string;
  /** `owner/repo` on GitHub. */
  readonly repo: string;
  /** The tag to install. Never a branch - see the header. */
  readonly tag: string;
  /**
   * One line for the checkbox row. The long description comes from the manifest once
   * the mod is installed, so it is not duplicated here and cannot disagree with it.
   */
  readonly summary: string;
  /**
   * Whether this row starts CHECKED on first run.
   *
   * Only for a mod whose absence a player would experience as the game being worse
   * rather than as the game being faithful. A pre-checked row is still a row they can
   * clear, and nothing installs without them pressing the button.
   */
  readonly preChecked: boolean;
  /** Roughly how big the download is, so the row can say so before it starts. */
  readonly approxBytes: number;
  readonly payload: RegistryPayload;
}

/**
 * The catalogue this build ships.
 *
 * EMPTY, deliberately and temporarily. The three mods (qol, bug-fixes, linoleum) are
 * still built into this bundle; they move to their own repositories next, and an entry
 * may only be added here once that repository has a real tag and the digests have been
 * computed from the bytes at it.
 *
 * A placeholder entry with an invented tag or digest would be worse than an empty
 * list: it would fail verification, and a verification failure is the signal that
 * something has TAMPERED with a download. Filling this with fake hashes would train
 * whoever sees it to ignore the one alarm that matters.
 */
export const RECOMMENDED_MODS: readonly RecommendedMod[] = [];

const SHA256_HEX = /^[0-9a-f]{64}$/u;
/* `owner/repo`, GitHub's own character set for both halves. */
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/u;

/**
 * Why this entry is unusable, or null when it is fine.
 *
 * Exists because the catalogue will eventually be editable outside a TypeScript build
 * - a private registry, a mod manager's own list - and because a typo in a digest here
 * would otherwise surface as an install that fails with "the bytes do not match",
 * pointing the player at the mod author for a mistake in the game.
 *
 * Returns a message rather than throwing, so a single bad row costs one row.
 */
export function validateRecommendedMod(mod: RecommendedMod): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(mod.id)) {
    return `id "${mod.id}" is not a lower-case folder-safe name`;
  }
  if (!REPO_RE.test(mod.repo)) return `${mod.id}: repo "${mod.repo}" is not owner/name`;
  if (mod.tag === "") return `${mod.id}: no tag`;
  /* A ref that is a branch or a bare SHA is the mistake this catches: both resolve
   * over HTTP and both make the pinned digest a lie the moment anything is pushed. */
  if (mod.tag.includes("/")) return `${mod.id}: tag "${mod.tag}" looks like a ref path`;

  const seen = new Set<string>();
  const files =
    mod.payload.kind === "files" ? mod.payload.files : [mod.payload.archive];
  if (files.length === 0) return `${mod.id}: nothing to download`;
  for (const f of files) {
    if (!SHA256_HEX.test(f.sha256)) {
      return `${mod.id}/${f.path}: "${f.sha256}" is not a lower-case hex SHA-256`;
    }
    const bad = badPath(f.path);
    if (bad) return `${mod.id}/${f.path}: ${bad}`;
    if (seen.has(f.path)) return `${mod.id}: ${f.path} is listed twice`;
    seen.add(f.path);
  }
  if (mod.payload.kind === "files" && !seen.has("manifest.json")) {
    /* Caught here rather than at load time so the catalogue cannot describe an
     * install that readModDir will then reject as "not a mod folder". */
    return `${mod.id}: no manifest.json in the file list`;
  }
  return null;
}

/**
 * Why this path may not be written, or null when it is safe.
 *
 * A path from the catalogue becomes a key under the mod's own prefix, and on the
 * desktop build the same shape becomes a real filename. `..` is the whole reason this
 * function exists: a mod that lists `../../saves/x` would otherwise escape its folder.
 * Rejected rather than normalised, because a path that needed normalising was written
 * by something with intent, and quietly repairing it hides that.
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

/** The catalogue rows that are actually usable, and one message per row that is not. */
export function usableRecommendedMods(
  catalogue: readonly RecommendedMod[] = RECOMMENDED_MODS,
): { readonly mods: readonly RecommendedMod[]; readonly problems: readonly string[] } {
  const mods: RecommendedMod[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const mod of catalogue) {
    const bad = validateRecommendedMod(mod);
    if (bad !== null) {
      problems.push(bad);
      continue;
    }
    if (seen.has(mod.id)) {
      problems.push(`${mod.id}: listed twice in the catalogue`);
      continue;
    }
    seen.add(mod.id);
    mods.push(mod);
  }
  return { mods, problems };
}

/**
 * The URL for one file of a mod, at its pinned tag.
 *
 * `refs/tags/` is spelled out rather than left to raw.githubusercontent's shorthand,
 * because the short form resolves a BRANCH of the same name first - so a repository
 * with both `v1.0.0` the tag and `v1.0.0` the branch would serve the branch, which is
 * exactly the moving target the pinned digest is meant to exclude.
 */
export function rawUrl(repo: string, tag: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${repo}/refs/tags/${encodeURIComponent(tag)}/${encoded}`;
}

/** Where a player can go to read the mod's own page. */
export function repoUrl(mod: RecommendedMod): string {
  return `https://github.com/${mod.repo}/tree/${encodeURIComponent(mod.tag)}`;
}
