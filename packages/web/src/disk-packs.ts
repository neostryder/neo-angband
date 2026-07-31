/**
 * Mods from a real directory on disk.
 *
 * The recorded division of labour (docs/MODS.md, MOD_LIFECYCLE.md decision 9) is
 * that the in-game manager stays rudimentary - enable/disable, per-patch opt-out,
 * a one-step nudge - and that load-order sorting and bulk work belong to an
 * external mod manager (Vortex/MO2) over the shared ON-DISK pack format. That
 * decision was architecturally impossible in a browser, and it was also not yet
 * true on the desktop build: the shell served a `mods/` folder over the loopback
 * server and NOTHING read it. A folder dropped in there was listed by a server
 * nobody asked and loaded by nobody. This is the reader.
 *
 * The on-disk format is deliberately the SAME as a bundled pack's - a directory
 * holding `manifest.json` plus one `<record-type>.json` per contribution - so a
 * mod can be developed as a bundled pack and shipped as a folder with no
 * translation, and so this file adds a source of packs rather than a second kind
 * of pack.
 *
 *   <data>/mods/
 *     load-order.json          owned by the external manager (optional)
 *     my-mod/
 *       manifest.json
 *       monster.json           a record contribution (top-level .json)
 *       plugin.js              the code entry point (mod-code.ts)
 *       lib/dice.js            more code; imported relatively (mod-modules.ts)
 *       tiles/orc.png          an asset, reached through assetUrl
 *       data/spawns.json       nested .json is an ASSET, not a contribution
 *
 * A mod is data, images and scripts in a folder, so the reader walks the whole pack
 * rather than its top level. Only the record contributions are deliberately
 * top-level-only: `<record-type>.json` names what it contributes by its filename,
 * and a nested one would either need a second naming rule or silently not count.
 *
 * Everything here is best-effort and reports rather than throws. A hand-edited
 * manifest, a truncated download, a folder that is not a mod at all: each becomes
 * one line the mod manager can show, and the game still boots. A mod directory is
 * player-supplied data, so a bad one must never be able to stop the game
 * starting - the same reasoning as z-file.c returning NULL instead of dying.
 *
 * The reader is SOURCE-AGNOSTIC (2026-07-28), for the same reason z-file.c is one
 * file behind several `main-*.c`: the desktop shell hands over a directory as an
 * HTTP index on the loopback server, and a browser tab can hand over the very same
 * directory as a `FileSystemDirectoryHandle` the player picked (mod-folder.ts).
 * Those differ only in how five bytes are fetched. Every rule that decides what a
 * usable mod IS - the manifest, the id/folder-name agreement, which failures
 * condemn a pack and which merely lose one contribution, and who owns the load
 * order - lives once, here, and both platforms obey it identically. Duplicating
 * this loop per platform is how the two would have drifted.
 */

import { validateManifest, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { encodePackPath } from "./pack-files";

/** What the desktop shell exposes for the mods directory. */
interface DesktopModPaths {
  readonly modsIndexUrl?: unknown;
  readonly modsBaseUrl?: unknown;
}

/** One pack read off disk, in the same shape a bundled pack is discovered in. */
export interface DiskPack {
  readonly manifest: PackManifest;
  /** record type -> parsed JSON, keyed WITHOUT the .json suffix. */
  readonly files: Readonly<Record<string, unknown>>;
  /**
   * The pack's CODE files (`*.js`, `*.mjs`), by pack-relative path - so
   * `lib/dice.js` as readily as `plugin.js`. Listed rather than loaded: whether
   * to import a plugin depends on the mod being enabled, the ABI matching and the
   * player having consented, and every one of those has to be decided BEFORE the
   * module's top-level code runs (mod-code.ts). Empty for a pure content pack.
   */
  readonly code: readonly string[];
  /**
   * Everything else the folder holds, by pack-relative path: images, sounds,
   * fonts, and any `.json` in a subdirectory.
   *
   * A mod is data, images and scripts in a folder, and for a long time this list
   * did not exist - the readers collected `.json` and `.js` and nothing else, so a
   * `tiles/floor.png` sitting beside a manifest was invisible to every layer above.
   * Not a limit anybody chose; a file type nobody had listed.
   *
   * Nested `.json` is an asset rather than a record contribution on purpose: a
   * pack's record files are the top-level `<record-type>.json` ones, and a plugin's
   * own `data/spawn-table.json` is its business, fetched through assetUrl.
   */
  readonly assets: readonly string[];
}

/**
 * Which kind of directory a report came from. The mod manager says different
 * things about the three, and only this distinguishes them: `count === 0` is true
 * of a shell with an empty folder AND of a browser tab that has never been given
 * one, and those need opposite advice.
 */
export type ModDirKind =
  /** No directory at all (a browser tab that has not picked one). */
  | "none"
  /** The shell's own folder, beside the game (the desktop build). */
  | "app"
  /** A folder the player picked in the browser (mod-folder.ts). */
  | "picked"
  /**
   * Mods downloaded from their own repositories and kept in IndexedDB
   * (mod-install.ts). No path to show a player - they were never put anywhere -
   * so the manager names the repository and tag instead.
   */
  | "installed";

export interface DiskPackReport {
  readonly packs: readonly DiskPack[];
  /**
   * load-order.json's `order`, filtered to ids that actually resolved. Presence
   * in this list means the external manager deployed the pack AND wants it on -
   * one concept, the way a mod manager's active-plugin list is one concept.
   */
  readonly order: readonly string[];
  /** One line per pack that could not be used, and per unknown ordered id. */
  readonly problems: readonly string[];
  /** The directory these came from, to show a player where to put a mod. */
  readonly dir: string | null;
  /** False when this front end has no mods directory at all (a browser tab). */
  readonly available: boolean;
  /** Which of the three kinds of directory this is. */
  readonly kind: ModDirKind;
  /**
   * How to turn one of a pack's `code` files into a URL `import()` can take, or
   * null when this report's source cannot supply code at all.
   *
   * Carried on the report rather than looked up later because only the SOURCE
   * knows how: the desktop shell has a real same-origin URL under its loopback
   * server, and a folder the player picked in a browser has no URL at all until
   * its bytes are wrapped in a blob:. The plugin loader must not know which of
   * those it is talking to - that difference is exactly what this file exists to
   * absorb.
   */
  readonly codeUrl: CodeUrlResolver | null;
  /**
   * How to turn one of a pack's `assets` into a URL an `<img>`, an `Audio`, or a
   * `fetch` will take - or null when this report's source cannot serve them.
   *
   * Separate from codeUrl and with NO release, because the lifetimes differ and
   * getting that wrong is invisible until it is not: a module URL may be revoked
   * the moment its import settles, while an image URL has to survive for as long as
   * anything might draw it. So an asset URL is cached by the source and handed out
   * repeatedly rather than minted per call.
   */
  readonly assetUrl: AssetUrlResolver | null;
  /**
   * One entry per SOURCE that contributed packs to this report.
   *
   * A single report has one (or none, when this front end has no mods directory).
   * A COMBINED report has one per contributing source, and that is the point: with
   * a picked folder AND mods installed from repositories both live, `kind` and `dir`
   * can only describe one of them, so the manager would have to say something false
   * about where a player's mods came from. It says one line each instead.
   */
  readonly origins: readonly ModOrigin[];
}

/** Where one contributing source's packs came from, for the mod manager. */
export interface ModOrigin {
  readonly kind: ModDirKind;
  /** The directory, when there is one to name; null for installed mods. */
  readonly dir: string | null;
  /** How many usable packs this source contributed. */
  readonly count: number;
}

/** Resolve one asset file to a URL that stays valid. */
export type AssetUrlResolver = (id: string, path: string) => Promise<string | null>;

/**
 * Resolve one code file to an importable URL, plus how to let it go again.
 *
 * `release` matters for the blob: case: a blob URL pins its bytes in memory for
 * the lifetime of the document unless revoked, and a mods folder can hold many.
 * Revoking AFTER the import has settled is safe - the module graph is already
 * built and does not re-fetch.
 */
export interface CodeUrlResolver {
  (id: string, file: string): Promise<string | null>;
  readonly release?: (url: string) => void;
}

export const NO_DISK_PACKS: DiskPackReport = {
  packs: [],
  order: [],
  problems: [],
  dir: null,
  available: false,
  kind: "none",
  codeUrl: null,
  assetUrl: null,
  origins: [],
};

/** The latched result, so the synchronous composer can read it. */
let current: DiskPackReport = NO_DISK_PACKS;

/**
 * The packs found at boot.
 *
 * Synchronous on purpose. Content composition (pack.ts) runs at module load and
 * the game's own load path is synchronous throughout; making discovery async all
 * the way down would push `await` into the composer for the sake of one HTTP
 * round trip that happens once, before anything is drawn. So the entry module
 * awaits `loadDiskPacks()` ONCE and latches the answer here.
 */
export function diskPacks(): DiskPackReport {
  return current;
}

/** Install a report (the boot path, and the tests). */
export function setDiskPacks(report: DiskPackReport): void {
  current = report;
}

/** Back to "no directory", for tests. */
export function resetDiskPacks(): void {
  current = NO_DISK_PACKS;
}

/** The index endpoint's shape, as the desktop main process builds it. */
interface RawIndex {
  packs?: unknown;
  order?: unknown;
  dir?: unknown;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** One candidate pack folder: its folder name and the file names inside it. */
export interface ModDirEntry {
  readonly id: string;
  /** The TOP-LEVEL `.json` file names (manifest plus record files). */
  readonly files: readonly string[];
  /**
   * The `.js` / `.mjs` files, by pack-relative path so a subdirectory is expressible
   * (`lib/dice.js`). Absent from older sources, which is read as "this source offers
   * no code" rather than as an error - a content-only mods folder is the common case
   * and must not be reported as broken.
   */
  readonly code?: readonly string[];
  /**
   * Every other file, by pack-relative path: images, sounds, and nested data. Also
   * optional, and absent means the same thing - none, not broken.
   */
  readonly assets?: readonly string[];
  /**
   * Trouble the SOURCE hit while enumerating this one pack - a subtree it refused
   * to walk, a file it could not stat. Not fatal to the pack (the rest of it is
   * usable), and there was previously nowhere to put it: list() could only throw,
   * which condemns the whole directory, and readPack's problems come from reading
   * JSON. So a per-pack enumeration fault had to be either silence or a total
   * failure, and silence is what it got.
   */
  readonly problems?: readonly string[];
}

/**
 * Where a mods directory's bytes come from.
 *
 * Deliberately tiny: a source knows how to enumerate folders, read one JSON file,
 * and report a load order. It knows NOTHING about what makes a mod valid - that is
 * readModDir's job, once, for every platform.
 */
export interface ModDirSource {
  /** Which kind of directory this is, for the mod manager's wording. */
  readonly kind: Exclude<ModDirKind, "none">;
  /**
   * The location to show a player. Called AFTER list(), because a source may only
   * learn the real path while enumerating (the HTTP index carries it).
   */
  dir(): string | null;
  /**
   * The candidate pack folders. Throwing here means the DIRECTORY could not be
   * read at all, which is one problem line rather than a per-pack one.
   */
  list(): Promise<readonly ModDirEntry[]>;
  /** One JSON file inside a pack folder; throws when it cannot be read. */
  readJson(id: string, file: string): Promise<unknown>;
  /** load-order.json's `order` list, or [] when the folder has no such file. */
  order(): Promise<readonly string[]>;
  /**
   * A URL `import()` can take for one code file, or null when this source cannot
   * serve code. Optional so a source can honestly say "data only".
   */
  codeUrl?(id: string, file: string): Promise<string | null>;
  /** Let a URL from codeUrl go (revoke a blob:). Omit when there is nothing to free. */
  releaseUrl?(url: string): void;
  /**
   * A lasting URL for one asset file, or null when this source cannot serve them.
   * Optional for the same reason codeUrl is: a source is allowed to be data-only.
   */
  assetUrl?(id: string, path: string): Promise<string | null>;
}

/**
 * Validate every pack a source offers.
 *
 * This is the whole definition of "a usable mod folder", and it runs identically
 * on the desktop shell and in a browser tab.
 */
export async function readModDir(source: ModDirSource): Promise<DiskPackReport> {
  const problems: string[] = [];

  const codeUrl = resolverFor(source);
  const assetUrl = assetResolverFor(source);

  let entries: readonly ModDirEntry[];
  try {
    entries = await source.list();
  } catch (e) {
    return {
      packs: [],
      order: [],
      problems: [`Could not read the mods folder: ${message(e)}`],
      dir: source.dir(),
      available: true,
      kind: source.kind,
      codeUrl,
      assetUrl,
      /* Available but contributing nothing: the folder IS there and could not be
       * read, which is a different thing from having no folder, and the manager says
       * different things about the two. */
      origins: [{ kind: source.kind, dir: source.dir(), count: 0 }],
    };
  }

  const packs: DiskPack[] = [];
  for (const entry of entries) {
    const { id, files } = entry;
    if (id === "") continue;
    for (const p of entry.problems ?? []) problems.push(p);
    if (!files.some((f) => f.toLowerCase() === "manifest.json")) {
      problems.push(`${id}: no manifest.json, so it is not a mod folder`);
      continue;
    }
    const pack = await readPack(
      id,
      files,
      entry.code ?? [],
      entry.assets ?? [],
      source,
      problems,
    );
    if (pack) packs.push(pack);
  }

  const known = new Set(packs.map((p) => p.manifest.id));
  const order: string[] = [];
  let wanted: readonly string[] = [];
  try {
    wanted = await source.order();
  } catch (e) {
    /* A load-order.json that exists and cannot be parsed is worth saying, but it
     * must not cost the player their packs - the enabled set falls back to their
     * own stored choices, which is what a folder with no load order does. */
    problems.push(`load-order.json could not be read: ${message(e)}`);
  }
  for (const id of wanted) {
    if (known.has(id)) order.push(id);
    else problems.push(`load-order.json lists "${id}", which is not installed`);
  }

  return {
    packs,
    order,
    problems,
    dir: source.dir(),
    available: true,
    kind: source.kind,
    codeUrl,
    assetUrl,
    origins: [{ kind: source.kind, dir: source.dir(), count: packs.length }],
  };
}

/**
 * One report over several sources - a picked folder AND mods installed from their own
 * repositories, both live at once.
 *
 * WHY THIS EXISTS. Boot used to CHOOSE: the shell's folder if it had one, else a
 * picked folder, and installed mods were nowhere - `loadInstalledMods` had no
 * production caller at all, so a mod could be downloaded, digest-checked, stored, and
 * then reach nothing. Choosing is right between the shell's folder and a picked one
 * (they are two answers to the same question, and a stale handle must not shadow the
 * folder beside the game). It is wrong for installed mods, which are not an
 * alternative to having a folder.
 *
 * THE RESOLVERS ROUTE PER MOD ID, and that is the whole difficulty. Each source
 * reaches bytes its own way - a loopback URL, a blob over a picked File, an IndexedDB
 * read - so a single `assetUrl(id, path)` has to ask the source that OWNS that id.
 * Concatenating packs while keeping one source's resolver would serve one mod's files
 * from another mod's storage, or more likely nothing at all, and a tile pack that
 * silently draws no tiles is the exact failure this whole seam was built to stop.
 *
 * FIRST WINS on a duplicate id, in the order given, and the loser is reported rather
 * than dropped in silence: the player has two mods claiming one name and needs to know
 * which one is running. The same rule pack.ts applies when a disk pack collides with a
 * bundled one.
 */
export function combineDiskReports(
  reports: readonly DiskPackReport[],
): DiskPackReport {
  const live = reports.filter((r) => r.available);
  if (live.length === 0) return NO_DISK_PACKS;
  if (live.length === 1) return live[0] as DiskPackReport;

  const packs: DiskPack[] = [];
  const problems: string[] = [];
  const order: string[] = [];
  const owner = new Map<string, DiskPackReport>();

  for (const report of live) {
    problems.push(...report.problems);
    for (const pack of report.packs) {
      const id = pack.manifest.id;
      const held = owner.get(id);
      if (held !== undefined) {
        problems.push(
          `${id}: two sources offer this mod (${describe(held)} and ` +
            `${describe(report)}); the ${describe(held)} one is loaded`,
        );
        continue;
      }
      owner.set(id, report);
      packs.push(pack);
    }
  }
  /* Order after the packs, so an id that lost a collision is still ordered once - by
   * the copy that actually loaded. */
  const seenOrder = new Set<string>();
  for (const report of live) {
    for (const id of report.order) {
      if (owner.has(id) && !seenOrder.has(id)) {
        seenOrder.add(id);
        order.push(id);
      }
    }
  }

  const codeUrl = combinedCodeUrl(owner, live);
  const assetUrl = live.some((r) => r.assetUrl !== null)
    ? async (id: string, path: string): Promise<string | null> => {
        const src = owner.get(id);
        return src?.assetUrl ? await src.assetUrl(id, path) : null;
      }
    : null;

  return {
    packs,
    order,
    problems,
    /* The PRIMARY source's directory, because that is the one a player can copy a mod
     * into; `origins` carries the rest, and the manager reads that rather than
     * pretending one line covers every source. */
    dir: live[0]?.dir ?? null,
    available: true,
    kind: live[0]?.kind ?? "none",
    codeUrl,
    assetUrl,
    origins: live.flatMap((r) => r.origins),
  };
}

/** How a report is named in a collision message. */
function describe(report: DiskPackReport): string {
  switch (report.kind) {
    case "app":
      return "mods folder";
    case "picked":
      return "folder you chose";
    case "installed":
      return "installed";
    default:
      return report.kind;
  }
}

/**
 * The combined code resolver, routed by id, with `release` routed by URL.
 *
 * The URL is remembered against the source that minted it because releasing is
 * destructive: a blob URL revoked by the wrong source would be revoked anyway (the
 * string is unique) but its module GRAPH would not be, leaking one blob per
 * dependency per launch - invisible, and exactly how a mod system comes to feel
 * slower the more mods are installed.
 */
function combinedCodeUrl(
  owner: ReadonlyMap<string, DiskPackReport>,
  live: readonly DiskPackReport[],
): CodeUrlResolver | null {
  if (!live.some((r) => r.codeUrl !== null)) return null;
  const mintedBy = new Map<string, DiskPackReport>();
  const fn = (async (id: string, file: string): Promise<string | null> => {
    const src = owner.get(id);
    if (!src?.codeUrl) return null;
    const url = await src.codeUrl(id, file);
    if (url !== null) mintedBy.set(url, src);
    return url;
  }) as {
    (id: string, file: string): Promise<string | null>;
    release?: (url: string) => void;
  };
  if (live.some((r) => r.codeUrl?.release !== undefined)) {
    fn.release = (url: string): void => {
      mintedBy.get(url)?.codeUrl?.release?.(url);
      mintedBy.delete(url);
    };
  }
  return fn;
}

/** Lift a source's optional codeUrl/releaseUrl into the report's resolver. */
function resolverFor(source: ModDirSource): CodeUrlResolver | null {
  const resolve = source.codeUrl;
  if (!resolve) return null;
  const fn = ((id: string, file: string) => resolve.call(source, id, file)) as {
    (id: string, file: string): Promise<string | null>;
    release?: (url: string) => void;
  };
  const release = source.releaseUrl;
  if (release) fn.release = (url: string) => release.call(source, url);
  return fn as CodeUrlResolver;
}

/** Lift a source's optional assetUrl into the report's resolver. */
function assetResolverFor(source: ModDirSource): AssetUrlResolver | null {
  const resolve = source.assetUrl;
  if (!resolve) return null;
  return (id: string, path: string) => resolve.call(source, id, path);
}

/**
 * The desktop shell's mods folder, served as an index plus one URL per file.
 *
 * The index is fetched once and cached, because it carries three answers (the
 * folders, the load order, and the real path) that used to be one round trip and
 * must stay one.
 */
export function httpModsSource(
  indexUrl: string,
  baseUrl: string,
  doFetch: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
): ModDirSource {
  let index: RawIndex | null = null;
  const fetchJson = async (url: string): Promise<unknown> => {
    const res = await doFetch(url);
    if (!res.ok) throw new Error("could not be read");
    return await res.json();
  };
  return {
    kind: "app",
    dir: () => (typeof index?.dir === "string" ? index.dir : null),
    list: async () => {
      const parsed: unknown = await fetchJson(indexUrl).catch((e: unknown) => {
        throw new Error(message(e));
      });
      if (parsed === null || typeof parsed !== "object") {
        throw new Error("index is not an object");
      }
      index = parsed as RawIndex;
      const raw = Array.isArray(index.packs) ? index.packs : [];
      const out: ModDirEntry[] = [];
      for (const entry of raw) {
        if (entry === null || typeof entry !== "object") continue;
        const id = (entry as { id?: unknown }).id;
        if (typeof id !== "string" || id === "") continue;
        out.push({
          id,
          files: asStringArray((entry as { files?: unknown }).files),
          code: asStringArray((entry as { code?: unknown }).code),
          assets: asStringArray((entry as { assets?: unknown }).assets),
        });
      }
      return out;
    },
    readJson: (id, file) => fetchJson(`${baseUrl}/${id}/${file}`),
    order: () => Promise.resolve(asStringArray(index?.order)),
    /* The shell's mods folder is served over its own loopback HTTP server, so a
     * code file already HAS a same-origin URL with a JavaScript content type -
     * `import()` takes it directly and there is nothing to release. A relative
     * import inside it resolves against that URL like any other module's, which is
     * why the desktop build needs no part of mod-modules.ts. */
    codeUrl: (id, file) => Promise.resolve(`${baseUrl}/${id}/${encodePackPath(file)}`),
    assetUrl: (id, path) => Promise.resolve(`${baseUrl}/${id}/${encodePackPath(path)}`),
  };
}

/**
 * Fetch and validate every pack in the mods directory the SHELL provides.
 *
 * `scope` and `fetchImpl` are injected so this is testable without a browser;
 * production passes neither. A browser tab has no shell folder and resolves to
 * NO_DISK_PACKS here - it reaches a folder through mod-folder.ts instead.
 */
export async function loadDiskPacks(opts: {
  scope?: unknown;
  fetchImpl?: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
} = {}): Promise<DiskPackReport> {
  const scope = opts.scope ?? (typeof globalThis === "undefined" ? {} : globalThis);
  const desktop = (scope as { neoDesktop?: DesktopModPaths }).neoDesktop;
  const indexUrl = desktop?.modsIndexUrl;
  const baseUrl = desktop?.modsBaseUrl;
  if (typeof indexUrl !== "string" || typeof baseUrl !== "string") {
    /* No mods directory: a browser tab, or a shell that does not offer one.
     * Reported as unavailable rather than as an empty directory, because the mod
     * manager says different things about the two. */
    return NO_DISK_PACKS;
  }
  const doFetch =
    opts.fetchImpl ??
    ((url: string) => (scope as { fetch: typeof fetch }).fetch(url));
  return await readModDir(httpModsSource(indexUrl, baseUrl, doFetch));
}

async function readPack(
  id: string,
  files: readonly string[],
  code: readonly string[],
  assets: readonly string[],
  source: ModDirSource,
  problems: string[],
): Promise<DiskPack | null> {
  let manifest: PackManifest;
  try {
    manifest = validateManifest(await source.readJson(id, "manifest.json"));
  } catch (e) {
    problems.push(`${id}: ${message(e)}`);
    return null;
  }
  /* The folder name and the manifest id must agree, because every other surface
   * - the enabled set, the load order, a save's provenance - keys off the
   * manifest id, and a folder that claims a different one would be enabled under
   * a name the player never sees in their file manager. */
  if (manifest.id !== id) {
    problems.push(`${id}: manifest says id "${manifest.id}"; rename the folder to match`);
    return null;
  }

  const out: Record<string, unknown> = {};
  for (const file of files) {
    if (!file.toLowerCase().endsWith(".json")) continue;
    const stem = file.slice(0, -".json".length);
    if (stem === "manifest") continue;
    /* load-order.json belongs to the DIRECTORY, not to a pack. A pack folder that
     * happens to hold one must not have it bound as a record file. */
    if (stem === "load-order") continue;
    try {
      out[stem] = await source.readJson(id, file);
    } catch (e) {
      /* One bad record file does not condemn the pack: the composer will simply
       * not see that contribution, and the player is told which file it was. */
      problems.push(`${id}/${file}: ${message(e)}`);
    }
  }
  return { manifest, files: out, code, assets };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
