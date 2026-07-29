/**
 * A mods folder in a browser tab: the static build's answer to the desktop
 * shell's `mods/` directory.
 *
 * parity/PLATFORM.md recorded that the Vortex/MO2 division of labour was
 * "architecturally impossible in a browser" because "a browser origin cannot read
 * a directory a mod manager writes". That was true of the platform the sentence was
 * written against and is no longer true of the one shipping: the File System Access
 * API hands a page a real `FileSystemDirectoryHandle` the user chose, and the handle
 * can be persisted, so the SAME folder is readable on every later launch without
 * asking again. The bytes an external mod manager deploys into that folder are the
 * bytes this reads.
 *
 * So the reduction here is not "no mods folder". It is narrower and worth stating
 * precisely, because a vague limit is how a platform quietly edits the game:
 *
 *   - The player must PICK the folder once, because a tab may not go looking
 *     through a filesystem uninvited. The desktop build knows its own folder.
 *   - The browser may ask again after the permission lapses (a long gap, or a
 *     policy that does not persist grants). Re-granting needs a keypress, so the
 *     mod manager offers a Reconnect row rather than silently showing no mods.
 *   - Firefox and Safari do not implement directory picking at all. There the
 *     honest answer is the old one, and `folderPickingSupported` reports it.
 *
 * Everything past the handle is shared: disk-packs.ts owns every rule about what a
 * usable mod folder IS, and this module only supplies bytes to it. A second copy of
 * those rules for the browser is exactly how the two platforms would have drifted.
 */

import {
  type ModDirEntry,
  type ModDirSource,
  type DiskPackReport,
  NO_DISK_PACKS,
  readModDir,
} from "./disk-packs";
import { buildModuleGraph } from "./mod-modules";

/* ------------------------------------------------------------------ *
 * The File System Access API, declared structurally.
 *
 * Declared here rather than imported from a DOM lib for the same reason
 * host-electron.ts declares its bridge: the build must not gain a dependency on
 * types for an API two of the three engines do not ship, and every field below is
 * checked at runtime before it is used. A tab that lies about having them gets the
 * unsupported path, not a crash.
 * ------------------------------------------------------------------ */

/** PermissionState, as queryPermission/requestPermission report it. */
type PermState = "granted" | "denied" | "prompt";

interface FsFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<FsFile>;
}

/**
 * The bits of File this module uses. `text()` for JSON and scripts; the File object
 * itself is what a Blob URL is minted from for an asset, because re-reading an image
 * through text() would corrupt it - a PNG is not UTF-8.
 */
interface FsFile extends Blob {
  text(): Promise<string>;
}

export interface FsDirHandle {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterable<FsDirHandle | FsFileHandle>;
  queryPermission?(desc: { mode: "read" | "readwrite" }): Promise<PermState>;
  requestPermission?(desc: { mode: "read" | "readwrite" }): Promise<PermState>;
}

interface PickerScope {
  showDirectoryPicker?(opts?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: string;
  }): Promise<FsDirHandle>;
  indexedDB?: IDBFactory;
}

function pickerScope(scope: unknown): PickerScope {
  return (scope ?? {}) as PickerScope;
}

/**
 * Whether this engine can pick a directory at all.
 *
 * Checked as a capability rather than assumed, because the answer decides what the
 * mod manager OFFERS: a Reconnect row on an engine that can never grant one is a
 * dead end, and a "this build has no mods folder" line on an engine that can pick
 * one is a false statement about the program.
 */
export function folderPickingSupported(scope: unknown = globalThis): boolean {
  return typeof pickerScope(scope).showDirectoryPicker === "function";
}

/* ------------------------------------------------------------------ *
 * Persisting the handle.
 *
 * A directory handle is a live object, not a path: it cannot be stringified into
 * localStorage, and IndexedDB's structured clone is the only store that keeps one.
 * That is the entire reason this module touches IndexedDB - a mods folder the
 * player has to re-pick every launch is not a mods folder.
 * ------------------------------------------------------------------ */

const DB_NAME = "neo-angband";
const DB_VERSION = 1;
const STORE = "handles";
const HANDLE_KEY = "modsDir";

function openDb(scope: unknown): Promise<IDBDatabase | null> {
  const idb = pickerScope(scope).indexedDB;
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    /* Every failure resolves null rather than rejecting: private-browsing modes
     * and storage-blocking policies fail here, and neither may stop the game. */
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** A stored value is only a handle if it still behaves like one. */
function asDirHandle(v: unknown): FsDirHandle | null {
  if (v === null || typeof v !== "object") return null;
  const h = v as Partial<FsDirHandle>;
  if (h.kind !== "directory" || typeof h.name !== "string") return null;
  if (typeof h.values !== "function") return null;
  return v as FsDirHandle;
}

/** The saved folder handle, or null when there is none. */
export async function savedModFolder(
  scope: unknown = globalThis,
): Promise<FsDirHandle | null> {
  const db = await openDb(scope);
  if (!db) return null;
  return asDirHandle(await idbGet(db, HANDLE_KEY));
}

/** Remember this folder for later launches. Reports whether it stuck. */
export async function rememberModFolder(
  handle: FsDirHandle,
  scope: unknown = globalThis,
): Promise<boolean> {
  const db = await openDb(scope);
  if (!db) return false;
  return await idbPut(db, HANDLE_KEY, handle);
}

/** Forget the saved folder (the mod manager's "use no folder" action). */
export async function forgetModFolder(scope: unknown = globalThis): Promise<void> {
  const db = await openDb(scope);
  if (db) await idbDelete(db, HANDLE_KEY);
}

/**
 * The handle's read permission.
 *
 * `request: true` may only be passed from a user gesture - the browser rejects it
 * otherwise, which is why boot never asks and the mod manager's Reconnect row does.
 * A handle with no permission methods at all counts as granted: it came from a
 * picker that does not gate reads, and refusing it would report no mods for a folder
 * that reads perfectly well.
 */
export async function folderPermission(
  handle: FsDirHandle,
  opts: { request?: boolean } = {},
): Promise<PermState> {
  try {
    const query = handle.queryPermission?.bind(handle);
    const state = query ? await query({ mode: "read" }) : "granted";
    if (state === "granted" || !opts.request) return state;
    const ask = handle.requestPermission?.bind(handle);
    return ask ? await ask({ mode: "read" }) : "granted";
  } catch {
    /* A revoked handle throws here rather than answering. Treat it as needing a
     * prompt, which is what the Reconnect row is for. */
    return "prompt";
  }
}

/**
 * Ask the player for a folder, and remember it.
 *
 * Returns null when they cancel - which is not an error and must not be reported as
 * one. `id` keeps the browser's own "last folder" memory scoped to this picker, so
 * re-picking starts where they left off.
 */
export async function pickModFolder(
  scope: unknown = globalThis,
): Promise<FsDirHandle | null> {
  const pick = pickerScope(scope).showDirectoryPicker;
  if (typeof pick !== "function") return null;
  let handle: FsDirHandle;
  try {
    handle = await pick.call(pickerScope(scope), { id: "neo-mods", mode: "read" });
  } catch {
    /* AbortError when the player closes the dialogue; also a SecurityError when the
     * gesture has already expired. Neither is worth a message: they pressed cancel,
     * or they can press the row again. */
    return null;
  }
  await rememberModFolder(handle, scope);
  return handle;
}

/* ------------------------------------------------------------------ *
 * The source.
 * ------------------------------------------------------------------ */

const LOAD_ORDER = "load-order.json";

/**
 * The separator shown after a picked folder's name.
 *
 * A picked handle exposes only its own `name`, never its path - the browser will not
 * say where it is, and inventing a plausible one would be a paraphrase of a fact
 * this front end does not have. So the display shows the folder's name with a
 * trailing separator, which reads as a folder without claiming a location.
 */
const SEP = "/";

/**
 * Find one file by pack-relative PATH, case-insensitively at every segment.
 *
 * Case-insensitive because the rest of this reader is (a manifest may be
 * `Manifest.json`) and because a mod authored on Windows and read on a
 * case-sensitive volume must not lose half its files. Path-aware because a mod
 * holds subdirectories: `lib/dice.js`, `tiles/orc.png`.
 */
async function findFile(
  dir: FsDirHandle,
  path: string,
): Promise<FsFileHandle | null> {
  const segments = path.split("/").filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) return null;
  let here = dir;
  for (let i = 0; i < segments.length - 1; i++) {
    const want = (segments[i] as string).toLowerCase();
    let next: FsDirHandle | null = null;
    for await (const child of here.values()) {
      if (child.kind === "directory" && child.name.toLowerCase() === want) {
        next = child;
        break;
      }
    }
    if (!next) return null;
    here = next;
  }
  const want = (segments[segments.length - 1] as string).toLowerCase();
  for await (const child of here.values()) {
    if (child.kind === "file" && child.name.toLowerCase() === want) return child;
  }
  return null;
}

/**
 * Every file under `dir`, by path relative to it.
 *
 * DEPTH-LIMITED, and the limit is the point rather than a formality: this walks a
 * directory tree the player chose, an `await` per entry, and a deep or
 * symlink-looped tree would hang boot with no message. Twelve levels is far past
 * any real mod layout, and hitting it is reported as a fact about the folder.
 */
async function walkFiles(
  dir: FsDirHandle,
  prefix = "",
  depth = 0,
  out: string[] = [],
  tooDeep: string[] = [],
): Promise<{ files: string[]; tooDeep: string[] }> {
  if (depth > MAX_PACK_DEPTH) {
    tooDeep.push(prefix.replace(/\/$/u, ""));
    return { files: out, tooDeep };
  }
  for await (const child of dir.values()) {
    if (child.kind === "file") out.push(`${prefix}${child.name}`);
    else await walkFiles(child, `${prefix}${child.name}/`, depth + 1, out, tooDeep);
  }
  return { files: out, tooDeep };
}

const MAX_PACK_DEPTH = 12;

async function readJsonFile(dir: FsDirHandle, name: string): Promise<unknown> {
  const file = await findFile(dir, name);
  if (!file) throw new Error("could not be read");
  const text = await (await file.getFile()).text();
  /* JSON.parse's own message ("Unexpected token } in JSON at position 41") is more
   * use to someone who hand-edited a manifest than any wording of mine. */
  return JSON.parse(text) as unknown;
}

/**
 * Read the packs in a picked folder.
 *
 * Two shapes are accepted, because both are what a player actually does:
 *
 *   - a MODS folder holding one directory per mod, which is the desktop layout and
 *     what a mod manager deploys into;
 *   - a single MOD folder (it has a manifest.json of its own), because "pick the
 *     mod you just unzipped" is the obvious first attempt, and reporting no mods
 *     found for a folder that plainly contains one is a worse answer than reading
 *     it. Its id is the folder's name, so the same folder-name/manifest-id rule
 *     applies to it as to every other pack.
 */
export function folderModSource(handle: FsDirHandle): ModDirSource {
  /* Cached across list()/readJson()/order() so one read is one enumeration: the
   * async iterator is a fresh directory scan each time it is walked. */
  const dirs = new Map<string, FsDirHandle>();
  let single = false;
  /* Asset URLs are CACHED, not minted per call, because they have to outlive the
   * call that asked for one: an <img src> may load long after, and a plugin that
   * asks twice for the same tile must not pin two copies of it in memory. Nothing
   * revokes these - an asset URL is live for as long as the document is, which is
   * the correct lifetime and the whole reason it is separate from codeUrl's. */
  const assetUrls = new Map<string, string>();
  /** Entry URL -> every URL its graph made, so releasing the entry releases all. */
  const graphUrls = new Map<string, readonly string[]>();
  /** Directories the walk refused to go into, reported per pack. */
  const deep: string[] = [];

  /**
   * Sort one pack's whole file tree into the three kinds.
   *
   * Record contributions are the TOP-LEVEL `.json` files only, because a pack names
   * what it contributes by the filename (`monster.json` -> monsters) and there is no
   * second rule for a nested one. Everything else nested - including `.json` - is an
   * asset the mod reads itself.
   */
  const classify = async (id: string, dir: FsDirHandle): Promise<ModDirEntry> => {
    const walked = await walkFiles(dir);
    for (const d of walked.tooDeep) {
      deep.push(
        `${id}: "${d}" is nested more than ${MAX_PACK_DEPTH} levels deep and was not read`,
      );
    }
    const files: string[] = [];
    const code: string[] = [];
    const assets: string[] = [];
    for (const path of walked.files) {
      const nested = path.includes("/");
      if (isJs(path)) code.push(path);
      else if (isJson(path) && !nested) files.push(path);
      else assets.push(path);
    }
    return { id, files, code, assets, problems: deep.filter((p) => p.startsWith(`${id}:`)) };
  };

  return {
    kind: "picked",
    dir: () => (single ? handle.name : `${handle.name}${SEP}`),
    list: async () => {
      const state = await folderPermission(handle);
      if (state !== "granted") {
        throw new Error(
          state === "denied"
            ? "permission to read it was refused"
            : "the browser needs permission again - use Reconnect",
        );
      }
      dirs.clear();
      single = false;
      deep.length = 0;
      const entries: ModDirEntry[] = [];
      const topFiles: string[] = [];
      for await (const child of handle.values()) {
        if (child.kind === "directory") dirs.set(child.name, child);
        else topFiles.push(child.name);
      }
      /* A single mod folder: the picked directory IS the pack. */
      if (topFiles.some((f) => f.toLowerCase() === "manifest.json")) {
        single = true;
        dirs.clear();
        dirs.set(handle.name, handle);
        return [await classify(handle.name, handle)];
      }
      for (const [name, sub] of dirs) {
        entries.push(await classify(name, sub));
      }
      return entries;
    },
    readJson: async (id, file) => {
      const dir = dirs.get(id);
      if (!dir) throw new Error("could not be read");
      return await readJsonFile(dir, file);
    },
    order: async () => {
      /* A single-mod folder has no load order of its own, and the top-level
       * load-order.json of a mods folder is the external manager's file. */
      if (single) return [];
      const file = await findFile(handle, LOAD_ORDER);
      if (!file) return [];
      const parsed = JSON.parse(await (await file.getFile()).text()) as unknown;
      const order = (parsed as { order?: unknown })?.order;
      return Array.isArray(order)
        ? order.filter((x): x is string => typeof x === "string")
        : [];
    },
    /**
     * A picked file has no URL of any kind - it is a handle, not a location - so
     * its bytes are read and wrapped in a blob: URL, which `import()` accepts as a
     * module. The type MUST be a JavaScript one or the import is rejected on MIME
     * grounds exactly as a mis-served .js would be.
     *
     * AND ITS DEPENDENCIES TOO. A blob URL is opaque, so a relative specifier
     * inside one resolves against nothing; the graph is therefore resolved first
     * (mod-modules.ts) and each specifier rewritten to its dependency's own blob
     * URL. A mod may have as many scripts, in as many subdirectories, as it likes.
     *
     * The one thing that still cannot work here is a BARE specifier: it resolves
     * against the document, where nothing is published. There is nothing to import
     * anyway - the engine is handed to the plugin as `ctx.core` (mod-plugin.ts).
     *
     * `_release` collects every URL the graph made, so releaseUrl can revoke the
     * dependencies as well as the entry. Handing back only the entry would leak one
     * blob per dependency, per launch - invisible, and exactly the kind of thing
     * that shows up as a mod system that gets slower the more mods you install.
     */
    codeUrl: async (id, file) => {
      const dir = dirs.get(id);
      if (!dir) return null;
      const made: string[] = [];
      const graph = await buildModuleGraph(file, {
        read: async (path) => {
          const found = await findFile(dir, path);
          return found ? await (await found.getFile()).text() : null;
        },
        urlFor: (_path, text) => {
          const url = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
          made.push(url);
          return url;
        },
      });
      if (graph.url === null) {
        for (const u of graph.urls) URL.revokeObjectURL(u);
        /* Thrown rather than returned as null so the loader reports the REASON -
         * which file is missing, which two import each other - instead of the
         * generic "listed in the folder but could not be opened". */
        throw new Error(graph.problem ?? "could not be read");
      }
      graphUrls.set(graph.url, graph.urls);
      return graph.url;
    },
    releaseUrl: (url) => {
      /* A blob URL pins its bytes for the document's lifetime until revoked, and a
       * mods folder can hold many. Safe once the import has settled: the module
       * graph is already built and never re-fetches. Every module the graph wrapped
       * goes, not just the entry. */
      for (const u of graphUrls.get(url) ?? [url]) {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      }
      graphUrls.delete(url);
    },
    /**
     * An asset's URL: a blob over the FILE OBJECT, not over text.
     *
     * Reading a PNG through `text()` and re-wrapping the string would corrupt it -
     * the bytes are not UTF-8, and the round trip replaces every invalid sequence
     * with U+FFFD. A File is already a Blob, so it needs no conversion at all; the
     * browser reads it lazily when something actually fetches the URL.
     *
     * The type comes from the extension because a picked File's own `type` is
     * whatever the OS guessed, which for an unregistered extension is the empty
     * string - and an <img> will not load an untyped blob.
     */
    assetUrl: async (id, path) => {
      const key = `${id}/${path}`;
      const cached = assetUrls.get(key);
      if (cached !== undefined) return cached;
      const dir = dirs.get(id);
      if (!dir) return null;
      const found = await findFile(dir, path);
      if (!found) return null;
      const file = await found.getFile();
      const type = assetMime(path);
      const url = URL.createObjectURL(type ? new Blob([file], { type }) : file);
      assetUrls.set(key, url);
      return url;
    },
  };
}

/**
 * The content type for an asset, by extension, or "" to use the File's own.
 *
 * Only the types a mod plausibly ships. Anything unlisted keeps whatever the
 * platform said, which is the right answer for a file this build has no opinion
 * about - guessing octet-stream would stop a `fetch().json()` that works today.
 */
function assetMime(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot < 0 ? "" : path.slice(dot).toLowerCase();
  return ASSET_MIME[ext] ?? "";
}

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

function isJson(name: string): boolean {
  return name.toLowerCase().endsWith(".json");
}

function isJs(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".js") || lower.endsWith(".mjs");
}

/**
 * Read a picked folder at boot, without ever prompting.
 *
 * Boot has no user gesture, so a lapsed permission cannot be re-granted here; it
 * comes back as an available directory with one problem line, which is what puts
 * the Reconnect row in front of the player instead of silently losing their mods.
 */
export async function loadPickedModFolder(
  scope: unknown = globalThis,
): Promise<DiskPackReport> {
  if (!folderPickingSupported(scope)) return NO_DISK_PACKS;
  const handle = await savedModFolder(scope);
  if (!handle) return NO_DISK_PACKS;
  return await readModDir(folderModSource(handle));
}
