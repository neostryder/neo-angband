/**
 * A mod, learned from its own repository.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE. The game knows that mods exist and how
 * to install and talk to them. It does not know WHAT mods there are, what they
 * are called, what they do, or which versions of Core they work with, until one
 * is installed and tells it. Everything a row on the mod screen says about a mod
 * comes from that mod: its id and name and description from its manifest, its
 * compatible engine range from its manifest, and the versions available from the
 * tags in its own repository. The build contributes nothing but the ability to
 * ask. (`mod-registry.ts` is the previous model, where the build shipped a
 * catalogue of names, tags and digests; it is on its way out.)
 *
 * WHAT REPLACES THE SHIPPED DIGEST. The old model's security came from the
 * SHA-256 travelling inside the build rather than over the connection that
 * delivered the file - which is real, and which is also why the game could only
 * ever offer versions it was built knowing about. Trust-on-first-use replaces it:
 * an install records WHERE the mod came from, and every later fetch for that mod
 * must come from the same place. A digest cannot survive a version bump (new
 * version, new bytes, new hash, legitimately), but an origin can and does. So
 * what is pinned is the origin, and what is recorded per install is the digest of
 * what actually arrived - so "has this copy changed under me" stays answerable.
 *
 * WHAT CAN AND CANNOT BE FETCHED, measured from the real origin rather than
 * assumed, because it decides whether the static web build can install at all:
 *
 *   raw.githubusercontent.com at a tag  Access-Control-Allow-Origin: *   works
 *   api.github.com                      Access-Control-Allow-Origin: *   works
 *   a release ASSET                     (no CORS header)                 blocked
 *   codeload zipball                    ACAO: render.githubusercontent    blocked
 *
 * So a mod's payload is its committed files at a tag, and the tag list comes from
 * the API. Neither needs a token; both are rate-limited per IP, which is why a
 * discovery is one tags call plus one tree call and not one per file.
 */

import { compareTags } from "./mod-registry";
import type { InstalledModMeta } from "./mod-install";

/** A repository, and optionally the one tag the player asked for. */
export interface RepoRef {
  /** `owner/repo` on GitHub. */
  readonly repo: string;
  /** A tag the player named explicitly; absent means "whatever is newest". */
  readonly tag?: string;
}

/** Why an input is not a repository reference, or the reference it is. */
export type RepoRefResult = { readonly ok: true; readonly ref: RepoRef } | {
  readonly ok: false;
  readonly problem: string;
};

const OWNER_REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/u;

/**
 * What a player can type into "install from a repository".
 *
 * Accepts the three things anyone actually has to hand: `owner/repo`, the URL of
 * the repository page, and the URL of a tag's tree (which pins that tag). A
 * `github.com/owner/repo/tree/<ref>` is read as a TAG, not a branch, because a
 * branch is a moving target and installing one would mean an installed mod whose
 * bytes change under it - see the tag discussion in mod-registry.ts.
 */
export function parseRepoRef(input: string): RepoRefResult {
  const text = input.trim().replace(/\/+$/u, "");
  if (text === "") return { ok: false, problem: "Nothing typed." };

  let rest = text;
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/iu.exec(text);
  if (url) rest = url[1] as string;
  else if (/^https?:\/\//iu.test(text)) {
    return {
      ok: false,
      problem: "Only github.com repositories can be installed from a URL.",
    };
  }

  const parts = rest.split("/");
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/iu, "");
  if (owner === "" || repo === "") {
    return { ok: false, problem: `Not a repository: "${input.trim()}"` };
  }
  const slug = `${owner}/${repo}`;
  if (!OWNER_REPO.test(slug)) {
    return { ok: false, problem: `Not a repository name: "${slug}"` };
  }

  /* .../tree/<ref> and .../releases/tag/<ref> both name one version. */
  const pinned =
    parts[2] === "tree" || (parts[2] === "releases" && parts[3] === "tag")
      ? parts[parts[2] === "tree" ? 3 : 4]
      : undefined;
  if (pinned !== undefined && pinned !== "") {
    return { ok: true, ref: { repo: slug, tag: decodeURIComponent(pinned) } };
  }
  return { ok: true, ref: { repo: slug } };
}

/** github.com/<repo>, for "go and read about it yourself". */
export function repoPageUrl(repo: string, tag?: string): string {
  const base = `https://github.com/${repo}`;
  return tag === undefined ? base : `${base}/tree/${encodeURIComponent(tag)}`;
}

/** The tag list API. 100 per page is plenty; a mod with more has other problems. */
export function tagsApiUrl(repo: string): string {
  return `https://api.github.com/repos/${repo}/tags?per_page=100`;
}

/** The recursive tree API at a tag: every file in the repo, with its size. */
export function treeApiUrl(repo: string, tag: string): string {
  return `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(tag)}?recursive=1`;
}

/**
 * The newest tag that can be ORDERED, or null.
 *
 * `compareTags` returns null for a tag that is not a version, and those are
 * skipped rather than guessed at: `latest` and `nightly` sort nowhere in
 * particular, and picking one because it happened to come back first would make
 * "the newest version" mean "whatever the API listed first". A repository with no
 * orderable tag at all has nothing this can install, and saying so is better than
 * installing an arbitrary one.
 */
export function newestTag(tags: readonly string[]): string | null {
  let best: string | null = null;
  for (const tag of tags) {
    if (best === null) {
      /* Orderable against itself is the cheapest test for "is this a version". */
      if (compareTags(tag, tag) !== null) best = tag;
      continue;
    }
    const order = compareTags(tag, best);
    if (order !== null && order > 0) best = tag;
  }
  return best;
}

/**
 * Paths in a repository that are not part of the mod.
 *
 * Only reached when a manifest does NOT declare its payload - a mod that says
 * what it ships gets exactly that. This is the fallback for a repository that
 * knows nothing about Neo Angband, so it is deliberately dull: build scaffolding,
 * dependencies, and TypeScript sources whose compiled output is what actually
 * ships. Everything else is installed, README and licence included, because a
 * mod folder is friendlier with them and they cost nothing.
 *
 * It cannot know that a .zip is a pack to UNPACK rather than a file to store -
 * only a manifest can say that - so a mod whose payload is archives has to
 * declare it. That is stated in the docs rather than guessed at here.
 */
const NOT_PAYLOAD: readonly RegExp[] = [
  /(^|\/)\./u, // dotfiles and dot-directories, at any depth
  /^node_modules\//u,
  /^tools\//u,
  /^(package|package-lock)\.json$/u,
  /^tsconfig[^/]*\.json$/u,
  /^vitest\.config\.[cm]?[jt]s$/u,
  /\.ts$/u,
];

/** Whether this repository path belongs in the installed mod folder. */
export function isPayloadPath(path: string): boolean {
  return !NOT_PAYLOAD.some((re) => re.test(path));
}

/** One entry of the tree API's response that this module cares about. */
export interface TreeEntry {
  readonly path: string;
  readonly type: string;
  readonly size?: number;
}

/** The payload derived from a repository tree, when the manifest declared none. */
export function payloadFromTree(entries: readonly TreeEntry[]): {
  readonly files: readonly string[];
  readonly bytes: number;
} {
  const files: string[] = [];
  let bytes = 0;
  for (const e of entries) {
    if (e.type !== "blob") continue;
    if (!isPayloadPath(e.path)) continue;
    files.push(e.path);
    bytes += e.size ?? 0;
  }
  /* Codepoint order, not localeCompare: the point of sorting here is that two
   * runs agree, and localeCompare answers by LOCALE - it sorted README.md after
   * plugin.js on this machine and would not have to on another. A stored file
   * list that depends on the host's collation is a diff nobody can reproduce. */
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { files, bytes };
}

/**
 * Trust on first use: whether this fetch may proceed.
 *
 * The first install of a mod decides where that mod comes from, and nothing
 * afterwards may change it. Returns the reason to refuse, or null to go ahead.
 *
 * Compared case-insensitively because GitHub owner and repository names are, so
 * `NeoStryder/x` and `neostryder/x` are the same origin and refusing that pair
 * would be a false alarm - and a false alarm here teaches the player to click
 * through the one warning that matters.
 */
export function originConflict(
  installed: InstalledModMeta | null,
  repo: string,
): string | null {
  if (installed === null) return null;
  const was = installed.repo.toLowerCase();
  const now = repo.toLowerCase();
  if (was === now) return null;
  return (
    `${installed.id} is already installed from ${installed.repo}, and this ` +
    `would replace it with a copy from ${repo}. ` +
    `Uninstall it first if that is really what you want.`
  );
}
