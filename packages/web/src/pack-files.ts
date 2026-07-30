/**
 * How a mod folder's file paths sort into the three kinds, and what type each asset
 * is served as.
 *
 * ONE copy, because there are now three sources that enumerate a pack's files - the
 * desktop shell's folder, a folder the player picked, and a mod downloaded from a
 * repository - and the rule that decides which files are record contributions is not
 * a rule any of them should own. When this lived privately in mod-folder.ts and was
 * about to be written a second time in mod-install.ts, the failure mode was concrete
 * and silent: a mod whose PNG loads from a picked folder and not from an installed one,
 * or whose nested JSON is a record on one path and an asset on the other.
 */

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
