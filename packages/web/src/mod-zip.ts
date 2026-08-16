/**
 * Reading a mod out of a .zip the player handed the game.
 *
 * THE DIFFERENCE FROM EVERY OTHER ARCHIVE THIS CODEBASE OPENS. mod-install.ts already
 * unzips archives: the ones a mod's own manifest DECLARES, fetched from a pinned tag and
 * matched against a digest before a single byte is parsed. Those paths are hostile in
 * principle and vouched-for in practice. This file's input is neither - it is a file a
 * player found somewhere, and the only thing standing between its entry names and the
 * mod store is what is written here. So the rules below are deliberately stricter than
 * badPath, and every one of them REFUSES rather than repairs: a path that needed
 * normalising was written by something with intent, and quietly fixing it hides that.
 *
 * WHAT THIS IS NOT. It is not a second opinion about what a mod is. Nothing here reads
 * a record file, decides whether a plugin is usable, or looks at an engine range -
 * readModDir and the SDK's checkMod own all of that, and storeMod runs checkMod on the
 * bytes this produces. This answers exactly two questions: which entries of the archive
 * are the mod, and what is the mod called.
 *
 * WHY THERE IS NO DISCOVERY-ON-LOAD. The obvious shape - watch the mods folder, unpack
 * anything zip-like at startup - makes every launch parse whatever is lying in a folder,
 * which is a startup cost and an attack surface on the one path that must never be
 * either. Import is a thing the player does once, on purpose, from a screen. The zip is
 * then deleted (see mod-zip-import.ts), so the folder does not accumulate a second copy
 * of every installed mod.
 *
 * WHAT IS OUT OF SCOPE, SAID PLAINLY RATHER THAN IMPLIED. A zip can mark an entry as a
 * symlink, in the external-attributes field. fflate does not expose that field, so this
 * module cannot see it, and a symlink entry arrives here as an ordinary file whose
 * contents are the link target. That is harmless HERE and only here: an imported mod's
 * bytes go into IndexedDB under the mod's own key, never onto a filesystem, so there is
 * no place for a link to point. Anything that ever writes these bytes to disk must do
 * its own check - do not read this paragraph as "symlinks are handled".
 */

import { unzipSync } from "fflate";

import { badPath } from "./mod-registry";

/** The file every mod folder must have at its root, in the one spelling that counts. */
const MANIFEST = "manifest.json";

/**
 * Code points that occupy no width, listed by number so the list is readable.
 *
 * Zero-width space through right-to-left mark, the bidirectional overrides, the
 * isolates, and the byte-order mark. Every one of them is legal in a filename on every
 * platform the game runs on, and none of them is visible in any list the player will
 * ever see the file in.
 */
const INVISIBLE = new Set([
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
  0x2067, 0x2068, 0x2069, 0xfeff,
]);

/**
 * Ceilings on what an archive may expand to.
 *
 * Present because an archive declares its own uncompressed size and a small download
 * can promise a large one. Two of these are checked twice, before and after: the
 * declared size decides whether an entry is decompressed at all (fflate's filter runs
 * on the header, which is the only point where refusing still costs nothing), and the
 * measured size is checked again afterwards, because the header is written by whoever
 * made the file and a lying header is the interesting case.
 *
 * The numbers are set by what a real mod is rather than by what feels safe. A tile mod
 * ships PNGs, and the largest tileset the game itself carries is 17.5 MB, so a 64 MB
 * ceiling on one file is generous without being unbounded.
 */
export interface ZipLimits {
  /** The .zip itself, refused before it is opened. */
  readonly maxArchiveBytes: number;
  readonly maxEntries: number;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
  /**
   * How much bigger than its compressed form one entry may claim to be.
   *
   * The ceilings above bound the total; this bounds the SHAPE. A 40 KB archive that
   * declares a 60 MB file is under every other limit and is still nothing a mod has
   * ever looked like. Deflate manages about 1000:1 on a file of one repeated byte, so
   * 200 leaves ordinary text and JSON far below the line.
   */
  readonly maxRatio: number;
}

export const ZIP_LIMITS: ZipLimits = {
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntries: 4096,
  maxFileBytes: 64 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024,
  maxRatio: 200,
};

/** What came out of an archive that is a mod, or the reason it is not one. */
export type ZipRead =
  | {
      readonly ok: true;
      /** The id the manifest declares, which is the name the mod is stored under. */
      readonly id: string;
      /**
       * The version the manifest declares, or null when it declares nothing usable.
       *
       * Not validated here, and deliberately not a reason to refuse: the SDK's checkMod
       * runs on these bytes before they are stored and its complaint about a bad version
       * is better than any this module could write. This is only what the import screen
       * shows and what the record remembers as "the version you imported".
       */
      readonly version: string | null;
      /**
       * The repository the manifest names, verbatim and unresolved.
       *
       * Carried out of the archive so the installer can pin the mod's origin to it. A
       * zip is the one door where the mod cannot be asked where it came from, so what
       * it SAYS about itself is the only provenance there is - which is exactly why
       * `declare-a-repository` is enforced on these bytes before this is acted on.
       * Left as written: turning it into an owner/name is the installer's decision,
       * and a reader that resolved it would be a second place that could disagree.
       */
      readonly repository: string | null;
      /**
       * The directory the mod was found in, `""` when the archive IS the mod folder.
       * Reported so the screen can tell the player which shape it recognised.
       */
      readonly root: string;
      /** Every file of the mod, by path relative to the mod folder. */
      readonly files: ReadonlyArray<readonly [string, Uint8Array]>;
      /** Entries dropped as packaging noise, so nothing vanishes silently. */
      readonly ignored: readonly string[];
    }
  | { readonly ok: false; readonly problem: string };

/**
 * Entries that are not the mod and never were.
 *
 * Dropped rather than refused, which is the one place this module repairs instead of
 * complaining, and it earns the exception: every one of these is written by an
 * operating system behind the player's back when they right-click a folder. Refusing
 * them would mean every archive made on a Mac fails, and the player has no way to see
 * the files they would have to remove.
 */
function isNoise(name: string): boolean {
  const segments = name.split("/");
  if (segments[0] === "__MACOSX") return true;
  const base = segments[segments.length - 1] ?? "";
  if (base.startsWith("._")) return true; // AppleDouble sidecar
  return [".ds_store", "thumbs.db", "desktop.ini"].includes(base.toLowerCase());
}

/**
 * Why this entry name may not become a file, beyond what badPath already refuses.
 *
 * badPath is the rule for a path the CATALOGUE named, and it covers the structural
 * attacks: absolute paths, drive letters, backslashes, `..`, and the characters no
 * filesystem accepts. What it does not cover is the set of names that are legal to
 * write and then behave as a different name - which only matters once the path came
 * out of an archive somebody else built.
 */
function badArchivePath(path: string): string | null {
  const bad = badPath(path);
  if (bad !== null) return bad;
  /* Invisible characters, checked by code point rather than by a regex, because a
   * character class of control codes is a smudge in the source that the next reader
   * has to decode with a hex editor. badPath rejects NUL because a filesystem does;
   * these are the ones a filesystem ACCEPTS and a player cannot see - which is how a
   * second plugin.js comes to look identical to the first in every list there is.
   * The second set are the zero-width and bidirectional formatting characters, worse
   * than invisible: they make a name RENDER as a different name. */
  for (const ch of path) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return "path has a control character";
    if (INVISIBLE.has(code)) return "path has an invisible character";
  }
  for (const segment of path.split("/")) {
    /* Windows silently strips these when creating a file, so `plugin.js.` and
     * `plugin.js` are one file there and two everywhere else. A mod whose contents
     * depend on which platform unpacked it is not a mod. */
    if (/[. ]$/u.test(segment)) return `"${segment}" ends with a dot or a space`;
    /* The DOS device names, still reserved: opening `aux.json` on Windows talks to a
     * device rather than a file, whatever the extension says. */
    if (/^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/iu.test(segment)) {
      return `"${segment}" is a name Windows reserves for a device`;
    }
    if (segment.length > 255) return "a name in the path is too long";
  }
  /* Room for the mod's own prefix when these become keys, and for a mods folder path
   * when a player exports one. 240 is not a filesystem limit; it is headroom. */
  if (path.length > 240) return "the path is too long";
  return null;
}

/** The `id` and `version` the manifest declares, as far as they can be read. */
function manifestNames(bytes: Uint8Array): ManifestNames {
  const none: ManifestNames = { id: null, version: null, repository: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return none;
  }
  if (parsed === null || typeof parsed !== "object") return none;
  const str = (k: string): string | null => {
    const v = (parsed as Record<string, unknown>)[k];
    return typeof v === "string" && v !== "" ? v : null;
  };
  return { id: str("id"), version: str("version"), repository: str("repository") };
}

/**
 * The three things read out of the archive's manifest, and nothing else.
 *
 * Read HERE rather than left to the installer because these decide what the mod is
 * INSTALLED AS - its id, its version, and the repository its origin is pinned to. The
 * rest of the manifest is validated downstream by the same checkMod every other door
 * runs, so this deliberately does not become a second, weaker parser of the same file.
 */
interface ManifestNames {
  readonly id: string | null;
  readonly version: string | null;
  /** Verbatim, as written. Resolving it to an owner/name is the installer's job. */
  readonly repository: string | null;
}

/**
 * Find the mod folder inside the archive: the root itself, or one directory down.
 *
 * TWO SHAPES AND NO GUESSING. Depth 0 is an archive of the mod folder's CONTENTS - the
 * shape a player gets by selecting the files inside the folder. Depth 1 is an archive of
 * the folder itself, which is what GitHub's "Download ZIP" produces and what right-
 * clicking a folder produces on both desktops. Those two cover every archive a mod is
 * actually distributed as, and stopping there is the point: a search that walks deeper
 * would eventually find a manifest.json belonging to something else - an example, a
 * vendored copy, a second mod - and install it without the player ever knowing which of
 * the several mods in the file they got.
 *
 * A root manifest WINS over a nested one, because an archive with a manifest at its root
 * is unambiguously a mod folder and whatever is nested is that mod's business. Only when
 * there is no root manifest do the top-level directories get looked at, and then exactly
 * one of them may have a manifest: two is two mods, and the player has to say which.
 */
function findRoot(names: readonly string[]): { root: string } | { problem: string } {
  const atRoot = names.find((n) => !n.includes("/") && n.toLowerCase() === MANIFEST);
  if (atRoot !== undefined) {
    if (atRoot !== MANIFEST) {
      return { problem: `the archive has "${atRoot}", but it must be spelled ${MANIFEST}` };
    }
    return { root: "" };
  }
  const dirs: string[] = [];
  for (const name of names) {
    const cut = name.indexOf("/");
    if (cut <= 0) continue;
    const rest = name.slice(cut + 1);
    if (rest.includes("/") || rest.toLowerCase() !== MANIFEST) continue;
    if (rest !== MANIFEST) {
      return { problem: `the archive has "${name}", but it must be spelled ${MANIFEST}` };
    }
    dirs.push(name.slice(0, cut));
  }
  if (dirs.length === 1) return { root: `${dirs[0] as string}/` };
  if (dirs.length > 1) {
    return {
      problem:
        `this archive holds more than one mod (${dirs.sort().join(", ")}). ` +
        `Import them one at a time, each in its own zip.`,
    };
  }
  return {
    problem:
      `no ${MANIFEST} in this archive. It has to be either at the top of the zip, ` +
      `or inside a single folder at the top of the zip - nowhere deeper.`,
  };
}

/**
 * Read a mod out of an archive, or say why the archive is not one.
 *
 * Nothing is stored and nothing is fetched: this is bytes in, bytes out, so the whole
 * decision about whether an archive is acceptable can be made - and tested - without a
 * database, a network, or a screen.
 */
export function readModZip(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipRead {
  /* Collected by the filter, which is the only place that sees an entry BEFORE it is
   * decompressed and the only place that sees an entry TWICE. fflate hands back a plain
   * object, so two entries with one name have already become one by the time the result
   * exists - and a zip whose central directory lists a file twice is the classic way to
   * make a reader and a verifier disagree about what is inside. Caught here or not at
   * all. */
  if (bytes.length > limits.maxArchiveBytes) {
    return {
      ok: false,
      problem: `this file is ${mb(bytes.length)}, over the ${mb(limits.maxArchiveBytes)} limit for a mod`,
    };
  }
  const seen = new Set<string>();
  let refusal: string | null = null;
  let count = 0;
  const refuse = (why: string): boolean => {
    refusal ??= why;
    return false;
  };

  let unpacked: Record<string, Uint8Array>;
  try {
    unpacked = unzipSync(bytes, {
      filter: (file) => {
        if (refusal !== null) return false;
        if (++count > limits.maxEntries) {
          return refuse(`the archive has more than ${limits.maxEntries} entries`);
        }
        if (seen.has(file.name)) {
          return refuse(`"${file.name}" appears twice in the archive`);
        }
        seen.add(file.name);
        if (file.name.endsWith("/")) return false; // a directory record, not a file
        if (isNoise(file.name)) return false;
        if (file.originalSize > Math.max(file.size, 1) * limits.maxRatio) {
          return refuse(
            `"${file.name}" is ${mb(file.size)} compressed and claims to unpack to ` +
              `${mb(file.originalSize)}, which no mod file does`,
          );
        }
        if (file.originalSize > limits.maxFileBytes) {
          return refuse(
            `"${file.name}" says it unpacks to ${mb(file.originalSize)}, ` +
              `over the ${mb(limits.maxFileBytes)} limit for one file`,
          );
        }
        return true;
      },
    });
  } catch (e) {
    return { ok: false, problem: `this is not a readable zip (${message(e)})` };
  }
  if (refusal !== null) return { ok: false, problem: refusal };

  /* The declared sizes are checked again as measured sizes, because the header that
   * declared them was written by whoever made the file. A bomb with honest headers is
   * refused above without decompressing anything; a bomb that lies about its headers
   * has to actually carry the bytes, and is refused here. */
  let total = 0;
  for (const [name, body] of Object.entries(unpacked)) {
    if (body.length > limits.maxFileBytes) {
      return { ok: false, problem: `"${name}" unpacked to ${mb(body.length)}, over the limit` };
    }
    total += body.length;
    if (total > limits.maxTotalBytes) {
      return {
        ok: false,
        problem: `the archive unpacks to more than ${mb(limits.maxTotalBytes)}`,
      };
    }
  }

  const names = Object.keys(unpacked);
  if (names.length === 0) return { ok: false, problem: "the archive has no files in it" };

  const found = findRoot(names);
  if ("problem" in found) return { ok: false, problem: found.problem };
  const { root } = found;

  const files: Array<readonly [string, Uint8Array]> = [];
  /* Lower-cased path -> the path that claimed it. Two entries differing only in case
   * are two files in this archive and one file on Windows and on a default macOS disk,
   * so which one the player ends up with would depend on their operating system. */
  const claimed = new Map<string, string>();
  const outside: string[] = [];
  for (const name of names.sort()) {
    if (root !== "" && !name.startsWith(root)) {
      outside.push(name);
      continue;
    }
    const path = name.slice(root.length);
    if (path === "") continue;
    const bad = badArchivePath(path);
    if (bad !== null) return { ok: false, problem: `"${name}": ${bad}` };
    const key = path.toLowerCase();
    const owner = claimed.get(key);
    if (owner !== undefined) {
      return {
        ok: false,
        problem: `"${path}" and "${owner}" are the same file on Windows and on a Mac`,
      };
    }
    /* A file and a directory cannot share a name, and this is the only place the
     * clash is visible: fflate discards directory records, so `docs` the file and
     * `docs/read.md` arrive as two unrelated keys and collide only once something
     * tries to lay them out. */
    for (const [other] of claimed) {
      if (key.startsWith(`${other}/`) || other.startsWith(`${key}/`)) {
        return {
          ok: false,
          problem: `"${path}" and "${claimed.get(other) ?? other}" cannot both exist - ` +
            `one is a folder and the other is a file with the same name`,
        };
      }
    }
    claimed.set(key, path);
    files.push([path, unpacked[name] as Uint8Array]);
  }
  /* A stray file beside the mod folder is refused rather than dropped. It is one of two
   * things - a second mod's leftovers, or a readme the player meant to keep - and the
   * game cannot tell which, so the one answer that is never wrong is to say what is in
   * the way. Dropping it silently would install a mod the archive does not describe. */
  if (outside.length > 0) {
    return {
      ok: false,
      problem:
        `the mod is in "${root.slice(0, -1)}", but the zip also holds ` +
        `${outside.slice(0, 3).map((n) => `"${n}"`).join(", ")}` +
        `${outside.length > 3 ? ` and ${outside.length - 3} more` : ""}. ` +
        `Zip up the mod's folder on its own.`,
    };
  }

  const manifest = files.find(([p]) => p === MANIFEST);
  /* findRoot only promised a manifest AT the root it chose; this is the same fact read
   * from the kept files, and it costs one lookup to not depend on that agreement. */
  if (!manifest) return { ok: false, problem: `no ${MANIFEST} in the mod folder` };
  const { id, version, repository } = manifestNames(manifest[1]);
  if (id === null) {
    return {
      ok: false,
      problem: `${MANIFEST} does not name a mod id, so there is nothing to install it as`,
    };
  }

  const ignored = [...seen].filter((n) => !n.endsWith("/") && isNoise(n)).sort();
  return { ok: true, id, version, repository, root, files, ignored };
}

/** Sizes as a player reads them, so a refusal names a number they can act on. */
function mb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
