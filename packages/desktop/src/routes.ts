/**
 * Which file on disk a loopback request is answered from.
 *
 * THE BUG THIS EXISTS TO FIX. `/mods/` means two different things on the desktop
 * build, and the server only knew about one of them:
 *
 *   - the player's mods FOLDER, `<data>/mods/`, which is what the mod manager
 *     installs into and what Vortex/MO2 write to;
 *   - the mod assets compiled into the WEB BUNDLE, which the browser build serves
 *     as ordinary static files from `public/mods/<id>/`. `BUNDLED_MODS_BASE` in
 *     packages/web/src/tile-mods.ts is the string `"mods"`, so a bundled tile
 *     pack asks for `/mods/<id>/<path>` on every host alike.
 *
 * The route claimed the whole prefix for the first meaning and answered 404 for
 * anything the player's folder did not hold, so every bundled mod asset was
 * unreachable on desktop while being served fine on Pages. Measured on the
 * running desktop build before the fix: `/mods/linoleum/original-tiles/
 * manifest.txt` and its 1499 PNGs all 404, `/tiles/old/8x8.png` 200. The bytes
 * were in `dist-web/mods/` the whole time; the route hid them. What the player
 * saw was the Linoleum mod appearing in the Graphics list, resolving zero
 * images, and drawing the map in ASCII glyphs as though the mod did nothing.
 *
 * So a `/mods/` request now names TWO candidates and the first that exists wins.
 * The player's folder comes first deliberately: a mod the player installed
 * shadows a bundled one of the same id, which is the same precedence the mod
 * manager already applies to records, and it is what makes a bundled mod
 * replaceable rather than privileged. Bundled assets are reached only when the
 * player's folder has nothing to say.
 *
 * Pure, and separate from main.ts, because the defect was a routing decision and
 * a routing decision should be testable without an Electron main process, an
 * HTTP server, or a mods directory on disk. See routes.test.ts.
 */
import * as path from "node:path";
import * as fs from "node:fs";
import { openPlainFile, plainPath } from "@rpgm-tools/neo-angband-cli/host-node";

/** A blank same-origin page; see ORIGIN_PROBE_ROUTE in main.ts. */
export const ORIGIN_PROBE_ROUTE = "/__origin-storage";

/** The user mods folder index, synthesised rather than read from disk. */
export const MODS_INDEX_ROUTE = "/mods/index.json";

/**
 * The web build's service worker registration, which the desktop answers with an
 * empty script.
 *
 * The game's scheme cannot host a service worker, so registering one fails with an
 * uncaught error on every launch. The desktop has no use for one either: its files
 * are already on the disk, and web/src/pwa.ts removes any worker it finds on boot.
 */
export const REGISTER_SW_ROUTE = "/registerSW.js";

/** The site path bundled mods hang under, both here and in the web build. */
export const MODS_PREFIX = "/mods/";

export type RoutePlan =
  /** Serve the fixed origin-probe page. */
  | { readonly kind: "origin-probe" }
  /** Serve the synthesised mods index. */
  | { readonly kind: "mods-index" }
  /** Serve an empty script in place of the service worker registration. */
  | { readonly kind: "no-worker" }
  /** Path traversal, or a root the request escaped. */
  | { readonly kind: "forbidden" }
  /**
   * Try each candidate in order; the first that reads wins. `fallbackIndex`
   * sends index.html when they all miss, which is the SPA route behaviour and
   * must stay OFF for assets - a 200 of index.html where a PNG was expected is
   * far more confusing to debug than a 404.
   */
  | {
      readonly kind: "file";
      readonly candidates: readonly string[];
      readonly fallbackIndex: boolean;
    };

export interface RouteRoots {
  /** `<data>/mods/` - the player's installed mods. */
  readonly modsDir: string;
  /** The built web app. */
  readonly webRoot: string;
}

/**
 * Resolve a request path safely under a root, rejecting traversal.
 *
 * Exported because the traversal rule is part of what routes.test.ts pins: a
 * `..` in either half of a two-candidate lookup has to be refused, not merely
 * refused by whichever root happens to be checked first.
 */
export function safeJoin(root: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "");
  const rel = decoded.replace(/^\/+/, "");
  const full = path.normalize(path.join(root, rel));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  try {
    plainPath(root, full, true);
    return full;
  } catch {
    return null;
  }
}

/** Decide where one request is answered from. */
export function planRequest(url: string, roots: RouteRoots): RoutePlan {
  if (url === ORIGIN_PROBE_ROUTE) return { kind: "origin-probe" };
  if (url === MODS_INDEX_ROUTE) return { kind: "mods-index" };
  if (url === REGISTER_SW_ROUTE) return { kind: "no-worker" };

  if (url.startsWith(MODS_PREFIX)) {
    /* Both roots, in precedence order. A traversal must be refused outright and
     * NOT quietly retried against the other root.
     *
     * `inMods` is the stricter of the two and does all the real work: its root is
     * `<data>/mods`, one level deeper than the `webRoot` that `inBundle` is
     * measured against, so any `..` that escapes the bundle escaped the mods
     * folder first. The `!inBundle` half is therefore unreachable today - a
     * mutation removing it kills no test, and that is expected rather than a
     * hole. It stays because it is what keeps the refusal correct if the two
     * roots ever stop being nested that way, and the invariant itself (no
     * returned candidate escapes its own root) is pinned by routes.test.ts
     * rather than left to this reasoning. */
    const inMods = safeJoin(roots.modsDir, url.slice("/mods".length));
    const inBundle = safeJoin(roots.webRoot, url);
    if (!inMods || !inBundle) return { kind: "forbidden" };
    return { kind: "file", candidates: [inMods, inBundle], fallbackIndex: false };
  }

  const target = url === "/" ? "/index.html" : url;
  const full = safeJoin(roots.webRoot, target);
  if (!full) return { kind: "forbidden" };
  return { kind: "file", candidates: [full], fallbackIndex: true };
}


/** The open file must still belong to the root the route authorized. */
export async function readStaticFile(root: string, file: string): Promise<Buffer> {
  const archive = process.versions.electron ? /^(.*?\.asar)[/\\]/u.exec(path.resolve(root))?.[1] : undefined;
  if (archive) return readArchiveFile(root, file, archive);
  const fd = openPlainFile(root, file, fs.constants.O_RDONLY);
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      fs.readFile(fd, (error, data) => error ? reject(error) : resolve(data));
    });
  } finally {
    fs.closeSync(fd);
  }
}


/** ASAR entries have synthetic inode numbers, so their physical archive is the identity boundary. */
async function readArchiveFile(root: string, file: string, archive: string): Promise<Buffer> {
  const physical = (): fs.Stats => {
    const proc = process as { noAsar?: boolean | undefined };
    const before = proc.noAsar;
    proc.noAsar = true;
    try {
      const stat = plainPath(path.dirname(archive), archive);
      if (!stat?.isFile()) throw new Error("refused");
      plainPath(path.dirname(archive), path.join(archive + ".unpacked", path.relative(archive, file)), true);
      return stat;
    } finally {
      proc.noAsar = before;
    }
  };
  const before = physical();
  const initial = plainPath(root, file);
  if (!initial?.isFile()) throw new Error("refused");
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    const after = physical();
    const named = plainPath(root, file);
    const opened = fs.fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        !named?.isFile() || !opened.isFile() || initial.size !== named.size || initial.size !== opened.size) throw new Error("refused");
    return await new Promise<Buffer>((resolve, reject) => {
      fs.readFile(fd, (error, data) => error ? reject(error) : resolve(data));
    });
  } finally {
    fs.closeSync(fd);
  }
}
