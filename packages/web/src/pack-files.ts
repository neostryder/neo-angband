/**
 * How a mod folder's file paths sort into the three kinds, what type each asset is
 * served as, and how a pack-relative path becomes a URL.
 *
 * ONE copy, because there are now three sources that enumerate a pack's files - the
 * desktop shell's folder, a folder the player picked, and a mod downloaded from a
 * repository - and the rule that decides which files are record contributions is not
 * a rule any of them should own. When this lived privately in mod-folder.ts and was
 * about to be written a second time in mod-install.ts, the failure mode was concrete
 * and silent: a mod whose PNG loads from a picked folder and not from an installed one,
 * or whose nested JSON is a record on one path and an asset on the other.
 */

/**
 * How one of a pack's files is turned into a URL, or null when it cannot be.
 *
 * A pack used to be addressed by a base URL, and that quietly assumed the pack sits
 * somewhere the page can spell as a path. Two of the three places a mod can come
 * from cannot: a folder the player picked has no URL until its bytes are wrapped in
 * a `blob:`, and a mod installed from GitHub lives in IndexedDB, which has no path
 * at all. So a pack takes a resolver instead of a base, and the SOURCE decides how
 * bytes are reached - the same seam, and the same reason, as `codeUrl`/`assetUrl` on
 * a DiskPackReport.
 *
 * `relPath` is an UNENCODED pack-relative path (`maps/targets.txt`,
 * `images/8/feat_floor_lit_0.png`); a resolver that builds a URL must encode it,
 * which is what encodePackPath is for.
 *
 * Lives here, beside the file-sorting rule, because both tile engines and all three
 * mod sources need it and none of them should own it.
 */
export type PackFileResolver = (relPath: string) => Promise<string | null>;

/**
 * Percent-encode each segment of a pack-relative path, leaving the separators.
 *
 * A mod folder is named by whoever wrote it, so `tiles/dark elf.png` and a `#` in a
 * filename are both things that will happen; unencoded, the first breaks the path
 * and the second truncates it at a fragment. Per SEGMENT, so a `/` stays a
 * separator while everything else is escaped.
 */
export function encodePackPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Reach a pack's files under a base URL - the site-root case, and what a bundled
 * pack served out of `public/` uses. Also the desktop shell's case, where the mods
 * folder has a real loopback URL.
 */
export function urlBaseResolver(baseUrl: string): PackFileResolver {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return (relPath) => Promise.resolve(`${base}${encodePackPath(relPath)}`);
}

/**
 * Reach the files under one SUBDIRECTORY of what `resolve` reaches.
 *
 * This is what makes a manifest's `tilePacks[].path` mod-relative: the mod's own
 * asset resolver answers for the whole mod folder, and a tile pack lives in a
 * directory inside it. Composing rather than string-joining is the point - the
 * outer resolver may be an IndexedDB read or a blob mint, neither of which has a
 * base a caller could concatenate onto.
 *
 * An empty (or `.`) dir returns the resolver unchanged, so a pack that IS the mod
 * root needs no special case at the call site - and, more to the point, so the
 * source is never asked for a path with a `//` in it, which a source that looks its
 * files up by name would miss every time.
 */
export function subPackResolver(
  resolve: PackFileResolver,
  dir: string,
): PackFileResolver {
  const trimmed = dir.replace(/^\.?\/+/u, "").replace(/\/+$/u, "");
  if (trimmed === "" || trimmed === ".") return resolve;
  return (relPath) => resolve(`${trimmed}/${relPath}`);
}

/** A pack's files, sorted into what the loader does with each. */
export interface SortedPackFiles {
  /** TOP-LEVEL `.json`: the manifest, plus the record contributions. */
  readonly files: readonly string[];
  /** `.js` / `.mjs` at any depth, by pack-relative path. */
  readonly code: readonly string[];
  /** Everything else, by pack-relative path: images, sounds, nested data. */
  readonly assets: readonly string[];
}

/**
 * Sort one pack's whole file list.
 *
 * Record contributions are the TOP-LEVEL `.json` files only, because a pack names what
 * it contributes by the filename (`monster.json` -> monsters) and there is no second
 * rule for a nested one. Everything else nested - `.json` included - is an asset the
 * mod reads itself through ctx.assetUrl.
 */
export function sortPackFiles(paths: readonly string[]): SortedPackFiles {
  const files: string[] = [];
  const code: string[] = [];
  const assets: string[] = [];
  for (const path of paths) {
    if (isJs(path)) code.push(path);
    else if (isJson(path) && !path.includes("/")) files.push(path);
    else assets.push(path);
  }
  return { files, code, assets };
}

export function isJson(name: string): boolean {
  return name.toLowerCase().endsWith(".json");
}

export function isJs(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".js") || lower.endsWith(".mjs");
}

/**
 * The content type for an asset, by extension, or "" to use whatever the platform said.
 *
 * By extension rather than by what the source reports, because a picked File's own
 * `type` is whatever the OS guessed and is the empty string for an unregistered
 * extension - and an <img> will not load an untyped blob. Anything unlisted keeps the
 * platform's answer, which is right for a file this build has no opinion about:
 * guessing octet-stream would break a `fetch().json()` that works today.
 */
export function assetMime(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot < 0 ? "" : path.slice(dot).toLowerCase();
  return ASSET_MIME[ext] ?? "";
}

/** Only the types a mod plausibly ships. See assetMime for why it is a short list. */
const ASSET_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
