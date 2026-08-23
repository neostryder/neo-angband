/**
 * Mods loaded for this browsing session only.
 *
 * WHAT IT IS FOR. An author who has just finished a mod wants to see it in the
 * game, now, without it becoming a permanent part of their install. So does
 * anybody handed a mod to try. The existing route is download, import, enable,
 * reload - four actions and a mod in the library afterwards whether it turned out
 * to be any good or not. This is the same route with the library step removed.
 *
 * WHAT IT IS NOT. It is not a sandbox, and nothing here should be read as one.
 * A pack loaded through this file composes into the game exactly as an installed
 * pack does, and a plugin loaded through it runs in the page's own realm with the
 * whole engine namespace, the same as every other plugin. The only thing that is
 * shorter is how long the ARCHIVE is remembered. What the code did while it ran -
 * a save it rewrote, a key it left in storage, a request it sent - outlives the
 * session exactly as it would have if the mod had been installed. Every sentence
 * this module shows a player says that, because "only for this session" is the
 * kind of phrase that reads as "so it cannot do much", and it does not mean that.
 *
 * HOW THE LIFETIME IS ENFORCED, and how exactly it is not. The archive is held in
 * `sessionStorage`, which survives `location.reload()` - that is the whole reason
 * this works, because a reload is what applies a mod - and is scoped to one
 * top-level browsing context. Two honest limits follow, and they are documented
 * rather than papered over:
 *
 *   - A browser that RESTORES a session (reopen-closed-window, crash recovery)
 *     restores session storage with it, so a session mod can come back. It is a
 *     reload bridge, not a guarantee that closing the window destroys anything.
 *   - A window the page itself opens inherits a COPY of session storage, so a
 *     session mod can be present in a window the player did not stage it in.
 *
 * The mitigation for both is visibility rather than a stronger claim: a session
 * mod is always listed, always marked, and can always be dropped, so it can never
 * be quietly resident. `dropSessionMods` is that door.
 *
 * WHERE IT PLUGS IN. Nothing new. `readModDir` decides what a usable mod folder
 * is, once, for the desktop shell, a picked folder and IndexedDB; this adds a
 * fourth source in front of it rather than a fourth idea of what a mod is. The
 * report it produces is latched with `setSessionPacks` and fused into `diskPacks()`
 * ahead of the boot report, so a session copy of an id shadows an installed one
 * and the collision is reported on the mod's row.
 */

import {
  NO_DISK_PACKS,
  readModDir,
  setSessionPacks,
  type DiskPackReport,
  type ModDirEntry,
  type ModDirSource,
} from "./disk-packs";
import { installBlocked } from "./mod-consent";
import { archiveFaults, importedOrigin, installedMods, sha256Hex } from "./mod-install";
import { buildModuleGraph } from "./mod-modules";
import { originConflict } from "./mod-source";
import { assetMime, sortPackFiles } from "./pack-files";
import { readModZip } from "./mod-zip";
import { setSessionConsents } from "./mod-store";
import { log } from "./logging";

/** Where the staged archives live. Session storage, so a reload keeps them. */
export const SESSION_MODS_KEY = "neo:sessionMods";

/**
 * The stored shape's version.
 *
 * Read and refused rather than migrated: the whole record is worth less than the
 * reload that would follow a migration, and a session mod the player staged under
 * a previous build of the game is not something to guess about.
 */
export const SESSION_SCHEMA = 1;

/**
 * How much archive one session may hold.
 *
 * Session storage is about 5 MB per origin in every browser that has been
 * measured, and base64 costs another third on top, so the real ceiling is around
 * 3.7 MB of archive. Held well under it, because the game's own session keys share
 * the same budget and a staging feature must not be the reason a save-adjacent
 * write fails. A mod that does not fit is refused with the number, and the
 * download-and-import door still takes it - that door goes through IndexedDB and
 * has the 64 MB ceiling `ZIP_LIMITS` sets.
 */
export const MAX_SESSION_ARCHIVE_BYTES = 1024 * 1024;
export const MAX_SESSION_TOTAL_BYTES = 2 * 1024 * 1024;

/** One staged archive, as it is held for the session. */
export interface SessionMod {
  /** The id its manifest declares, which is the id it loads under. */
  readonly id: string;
  /** The version its manifest declares, or null when it declares nothing usable. */
  readonly version: string | null;
  /**
   * Lower-case hex SHA-256 of the archive, or `""` where nothing could measure it.
   *
   * Recorded so a screen can name exactly what it is about to run and ask again
   * when the bytes change - re-staging a draft between two tests is the common
   * case, and a confirmation that does not notice new bytes is a confirmation for
   * the previous ones. Empty rather than absent on a host with no `crypto.subtle`,
   * because "not measured" and "measured as nothing" must not read alike.
   */
  readonly digest: string;
  /** Where the bytes came from, in words a player recognises. */
  readonly source: string;
  /** True when the archive ships code that will run in the page. */
  readonly code: boolean;
  /**
   * The capabilities the player granted for this session, verbatim.
   *
   * Held here rather than in the persistent consent store on purpose: a grant made
   * to test something must not become a standing grant for an id the player never
   * installed. `setSessionConsents` is how the loader sees these without
   * `neo:modConsents` ever being written.
   */
  readonly granted: readonly string[];
  /** The archive itself, base64. */
  readonly zip: string;
}

/** What staging an archive did, in the same shape an install answers with. */
export type SessionStageResult =
  | {
      readonly ok: true;
      readonly mod: SessionMod;
      /** True when the archive ships code, so the caller can say the harder thing. */
      readonly code: boolean;
    }
  | {
      readonly ok: false;
      readonly problem: string;
      /** Unmet requirements, when that is why it was refused. */
      readonly unmet?: readonly { readonly title: string; readonly problem: string }[];
    };

/* ------------------------------------------------------------------ *
 * The store.
 * ------------------------------------------------------------------ */

interface SessionStoreShape {
  readonly v: number;
  readonly mods: readonly SessionMod[];
}

/** The minimal Storage surface used here, so a test needs no browser. */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The in-memory fallback, for a browser that refuses session storage.
 *
 * A real fallback rather than a refusal, because a private window that blocks
 * storage still runs the game, and a session mod staged in one is still worth
 * loading - it simply will not survive the reload. Every caller is told which of
 * the two it got (`survivesReload`), because a staging screen that promised a
 * reload would apply the mod and then did not would be worse than saying so.
 */
const memory = new Map<string, string>();
const memoryStore: SessionStorageLike = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};

function storageOf(scope: unknown = globalThis): {
  store: SessionStorageLike;
  survivesReload: boolean;
} {
  try {
    const s = (scope as { sessionStorage?: SessionStorageLike }).sessionStorage;
    if (s) {
      /* Touched rather than trusted: a browser can expose the object and throw on
       * every write, which is indistinguishable from a working store until the
       * first save is lost. */
      s.setItem(`${SESSION_MODS_KEY}:probe`, "1");
      s.removeItem(`${SESSION_MODS_KEY}:probe`);
      return { store: s, survivesReload: true };
    }
  } catch {
    /* no session storage, or a store that refuses writes */
  }
  return { store: memoryStore, survivesReload: false };
}

/** True when a staged mod will still be there after a reload. */
export function sessionSurvivesReload(scope: unknown = globalThis): boolean {
  return storageOf(scope).survivesReload;
}

/** Every mod staged for this session. Never throws; a bad record reads as none. */
export function sessionMods(scope: unknown = globalThis): readonly SessionMod[] {
  const { store } = storageOf(scope);
  let raw: string | null = null;
  try {
    raw = store.getItem(SESSION_MODS_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== "object") return [];
  const rec = parsed as Partial<SessionStoreShape>;
  /* A record from another shape of this feature is dropped rather than read. The
   * cost is one staging gesture; the cost of reading it wrong is a mod loaded on
   * terms nobody wrote down. */
  if (rec.v !== SESSION_SCHEMA || !Array.isArray(rec.mods)) return [];
  return rec.mods.filter(isSessionMod);
}

function isSessionMod(value: unknown): value is SessionMod {
  if (value === null || typeof value !== "object") return false;
  const m = value as Partial<SessionMod>;
  if (typeof m.id !== "string" || m.id === "") return false;
  if (m.version !== null && typeof m.version !== "string") return false;
  if (typeof m.digest !== "string" || typeof m.source !== "string") return false;
  if (typeof m.code !== "boolean" || typeof m.zip !== "string") return false;
  if (!Array.isArray(m.granted)) return false;
  return m.granted.every((c) => typeof c === "string");
}

function writeSessionMods(mods: readonly SessionMod[], scope: unknown): boolean {
  const { store } = storageOf(scope);
  try {
    if (mods.length === 0) {
      store.removeItem(SESSION_MODS_KEY);
      return true;
    }
    const body: SessionStoreShape = { v: SESSION_SCHEMA, mods };
    store.setItem(SESSION_MODS_KEY, JSON.stringify(body));
    return true;
  } catch {
    /* Quota, or a store that refuses. Reported as a value: the caller has just
     * asked a player to wait while a mod was checked, and a throw here would look
     * like the mod was at fault. */
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Looking before staging.
 * ------------------------------------------------------------------ */

/** What an archive says about itself, for the screen that asks before it runs. */
export type SessionPreview =
  | {
      readonly ok: true;
      readonly id: string;
      readonly version: string | null;
      /** The code files it ships, by path. Empty for a content pack. */
      readonly code: readonly string[];
      /**
       * The capabilities its manifest asks for, verbatim, or null when the manifest
       * will not parse as JSON.
       *
       * Null rather than empty on a broken manifest, because "asks for nothing" and
       * "could not be read" must not look the same on a consent screen. The staging
       * call refuses the archive either way; this is what lets the screen say which.
       */
      readonly capabilities: readonly string[] | null;
      /** Lower-case hex SHA-256, or "" where nothing could measure one. */
      readonly digest: string;
      /** The archive's size, so the screen can name what it is holding. */
      readonly bytes: number;
    }
  | { readonly ok: false; readonly problem: string };

/**
 * Read an archive and say what it is, without staging it.
 *
 * SEPARATE FROM STAGING ON PURPOSE. A player cannot consent to what a mod asks for
 * until they have been shown it, and they cannot be shown it until something has
 * opened the archive - so the look has to come first and the staging call has to
 * validate for itself afterwards rather than trusting what the screen was told.
 * That is one extra unzip of an archive already bounded by the zip ceilings, and it
 * buys a consent screen that names the actual files and the actual grants.
 */
export async function previewSessionArchive(
  bytes: Uint8Array,
  scope: unknown = globalThis,
): Promise<SessionPreview> {
  if (bytes.length === 0) return { ok: false, problem: "there are no bytes here to load" };
  const read = readModZip(bytes);
  if (!read.ok) return { ok: false, problem: read.problem };
  return {
    ok: true,
    id: read.id,
    version: read.version,
    code: read.files.map(([p]) => p).filter(isCodePath),
    capabilities: manifestCapabilities(read.files),
    digest: await digestOf(bytes, scope),
    bytes: bytes.length,
  };
}

/**
 * The `capabilities` the archive's manifest requests, or null when it will not parse.
 *
 * A missing manifest reads as "asks for nothing" rather than as this function's
 * refusal to answer: `readModZip` already requires one to find the mod folder at
 * all, and the standards inspection downstream judges a malformed manifest and says
 * so better than this could.
 */
function manifestCapabilities(
  files: ReadonlyArray<readonly [string, Uint8Array]>,
): readonly string[] | null {
  const entry = files.find(([path]) => path.toLowerCase() === "manifest.json");
  if (!entry) return [];
  try {
    const parsed = JSON.parse(new TextDecoder().decode(entry[1])) as {
      readonly capabilities?: unknown;
    };
    const caps = parsed.capabilities;
    if (!Array.isArray(caps)) return [];
    return caps.map((cap) => String(cap));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Staging.
 * ------------------------------------------------------------------ */

/**
 * Check an archive and hold it for this session.
 *
 * Refuses everything a permanent install refuses, through the same functions: the
 * third-party switch before the archive is opened, `readModZip`'s ceilings and
 * zip-slip check, the origin pin against an installed copy of the same id, and
 * `archiveFaults`' standards inspection. A session load that accepted an archive
 * the install door refuses would teach an author that a passing test means nothing.
 *
 * `granted` is what the player agreed this mod may do, for this session. It is
 * stored beside the archive and never in `neo:modConsents`.
 *
 * `contentOnly` refuses an archive that ships code. It is what the mod-facing door
 * passes (session-runtime.ts) and what the player's own door does not: a mod
 * handing the engine another mod's code is a different act from a player choosing
 * a file, and only one of them is a decision the player made.
 */
export async function stageSessionMod(
  opts: {
    readonly bytes: Uint8Array;
    readonly source: string;
    readonly granted?: readonly string[];
    readonly contentOnly?: boolean;
    readonly allowed: boolean;
  },
  scope: unknown = globalThis,
): Promise<SessionStageResult> {
  const blocked = installBlocked("third-party", opts.allowed);
  /* Before the archive is opened, for the reason the install door gives: a refused
   * archive must not have been parsed. */
  if (blocked !== null) return { ok: false, problem: blocked };

  if (opts.bytes.length === 0) {
    return { ok: false, problem: "there are no bytes here to load" };
  }
  if (opts.bytes.length > MAX_SESSION_ARCHIVE_BYTES) {
    return {
      ok: false,
      problem:
        `this archive is ${kb(opts.bytes.length)} and a mod loaded for one session has to fit in ` +
        `${kb(MAX_SESSION_ARCHIVE_BYTES)}. Install it instead - that door keeps mods somewhere with room.`,
    };
  }

  /* A COPY, before anything is awaited, for the reason install-runtime.ts makes
   * one: the caller keeps a reference to the buffer and validating one set of
   * bytes while storing another is the whole class of bug that forecloses. */
  const own = new Uint8Array(opts.bytes);

  const read = readModZip(own);
  if (!read.ok) return { ok: false, problem: read.problem };

  const repo = importedOrigin(read.repository);
  const installed = (await installedMods(scope)).find((m) => m.id === read.id) ?? null;
  const conflict = originConflict(installed, repo);
  /* The origin pin applies here too. A session copy SHADOWS an installed mod of
   * the same id for the session, so letting an archive from anywhere shadow one
   * pinned to a repository would be a way round the pin rather than a shortcut
   * past the library. */
  if (conflict !== null) return { ok: false, problem: conflict };

  const fault = archiveFaults(read.id, read.files);
  if (fault !== null) {
    return {
      ok: false,
      problem: fault.problem,
      ...(fault.unmet === undefined ? {} : { unmet: fault.unmet }),
    };
  }

  const code = read.files.some(([p]) => isCodePath(p));
  if (opts.contentOnly === true && code) {
    return {
      ok: false,
      problem:
        `${read.id} ships code (${read.files.filter(([p]) => isCodePath(p)).map(([p]) => p).join(", ")}), ` +
        `and a mod cannot hand the game another mod's code to run. Save it as a file and load it yourself.`,
    };
  }

  const kept = sessionMods(scope).filter((m) => m.id !== read.id);
  const zip = toBase64(own);
  const total = zip.length + kept.reduce((n, m) => n + m.zip.length, 0);
  if (total > MAX_SESSION_TOTAL_BYTES) {
    return {
      ok: false,
      problem:
        `this session is already holding ${kb(total - zip.length)} of staged mods and there is room for ` +
        `${kb(MAX_SESSION_TOTAL_BYTES)}. Drop one you have finished with, or install this one.`,
    };
  }

  const mod: SessionMod = {
    id: read.id,
    version: read.version,
    digest: await digestOf(own, scope),
    source: opts.source,
    code,
    granted: [...(opts.granted ?? [])],
    zip,
  };
  if (!writeSessionMods([...kept, mod], scope)) {
    return {
      ok: false,
      problem:
        `${read.id} could not be held for this session - this browser would not take it. ` +
        `Saving it as a file and importing it works instead.`,
    };
  }
  return { ok: true, mod, code };
}

/** Forget every staged mod, or one by id. Takes effect on the next reload. */
export function dropSessionMods(scope: unknown = globalThis, id?: string): void {
  const kept = id === undefined ? [] : sessionMods(scope).filter((m) => m.id !== id);
  writeSessionMods(kept, scope);
}

function isCodePath(path: string): boolean {
  const p = path.toLowerCase();
  /* The same extension list `contentOnlyRefusal` uses, and for the same reason it
   * is by extension rather than by declared shape: an archive claiming to be
   * content while shipping a plugin.js is exactly the archive the check is for. */
  return (
    p.endsWith(".js") ||
    p.endsWith(".mjs") ||
    p.endsWith(".cjs") ||
    p.endsWith(".ts") ||
    p.endsWith(".wasm")
  );
}

/** The archive's digest, or "" on a host that cannot measure one. */
async function digestOf(bytes: Uint8Array, scope: unknown): Promise<string> {
  const subtle = (scope as { crypto?: { subtle?: Pick<SubtleCrypto, "digest"> } }).crypto
    ?.subtle;
  if (!subtle) return "";
  try {
    return await sha256Hex(bytes, subtle);
  } catch {
    /* An insecure context has `crypto` and no `subtle`, and some hosts have a
     * `subtle` that refuses. Neither is a reason to refuse the mod: the digest is
     * for what a screen can SAY, and saying nothing is better than not loading. */
    return "";
  }
}

function kb(bytes: number): string {
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/* ------------------------------------------------------------------ *
 * Loading.
 * ------------------------------------------------------------------ */

/**
 * A ModDirSource over the archives staged for this session.
 *
 * Mirrors `installedModSource`: the bytes have no URL of their own, so code and
 * assets are wrapped in blob: URLs with the same two lifetimes - a module URL may
 * be revoked once its import settles, an asset URL has to outlive the call that
 * asked for one and so is cached.
 */
export function sessionModSource(
  entries: ReadonlyArray<{
    readonly id: string;
    readonly files: ReadonlyMap<string, Uint8Array>;
  }>,
): ModDirSource {
  const byId = new Map(entries.map((e) => [e.id, e.files]));
  const assetUrls = new Map<string, string>();
  const graphUrls = new Map<string, readonly string[]>();

  const read = (id: string, path: string): Uint8Array | null =>
    byId.get(id)?.get(path) ?? null;
  const text = (id: string, path: string): string => {
    const bytes = read(id, path);
    if (!bytes) throw new Error("could not be read");
    return new TextDecoder().decode(bytes);
  };

  return {
    kind: "session",
    /* No path to show: these were never put anywhere. The manager says where the
     * bytes came from and how long they last instead. */
    dir: () => null,
    list: () =>
      Promise.resolve(
        entries.map((e): ModDirEntry => ({
          id: e.id,
          ...sortPackFiles([...e.files.keys()]),
        })),
      ),
    readJson: (id, file) => Promise.resolve(JSON.parse(text(id, file)) as unknown),
    /* A load-order.json inside a staged archive is the author's file and has no
     * business ordering the player's other mods - the same call installedModSource
     * makes. A staged mod loads last, which is what shadowing needs. */
    order: () => Promise.resolve([]),
    codeUrl: async (id, file) => {
      const made: string[] = [];
      const graph = await buildModuleGraph(file, {
        read: (path) => {
          const bytes = read(id, path);
          return Promise.resolve(bytes ? new TextDecoder().decode(bytes) : null);
        },
        urlFor: (_path, body) => {
          const url = URL.createObjectURL(new Blob([body], { type: "text/javascript" }));
          made.push(url);
          return url;
        },
      });
      if (graph.url === null) {
        for (const u of graph.urls) URL.revokeObjectURL(u);
        throw new Error(graph.problem ?? "could not be read");
      }
      graphUrls.set(graph.url, graph.urls);
      return graph.url;
    },
    releaseUrl: (url) => {
      for (const u of graphUrls.get(url) ?? [url]) {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      }
      graphUrls.delete(url);
    },
    assetUrl: (id, path) => {
      const key = `${id}/${path}`;
      const cached = assetUrls.get(key);
      if (cached !== undefined) return Promise.resolve(cached);
      const bytes = read(id, path);
      if (!bytes) return Promise.resolve(null);
      const type = assetMime(path);
      /* A copy of exactly this file's bytes: a stored Uint8Array may be a view onto
       * a larger buffer, and a Blob built from the buffer would carry its
       * neighbours' bytes into the image. */
      const part = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const url = URL.createObjectURL(type ? new Blob([part], { type }) : new Blob([part]));
      assetUrls.set(key, url);
      return Promise.resolve(url);
    },
  };
}

/**
 * Read every staged archive and latch the result. Called once at boot.
 *
 * RE-READ RATHER THAN TRUSTED. The archive goes back through `readModZip` and
 * `readModDir` on every launch, so a record edited in place - session storage is
 * ordinary page-realm storage, reachable by anything running in the page - is
 * validated again rather than believed. It also means a mod staged under an engine
 * that has since been updated is judged by the new engine's rules.
 */
export async function loadSessionMods(scope: unknown = globalThis): Promise<DiskPackReport> {
  const staged = sessionMods(scope);
  if (staged.length === 0) {
    setSessionPacks(NO_DISK_PACKS);
    setSessionConsents({});
    return NO_DISK_PACKS;
  }

  const entries: { id: string; files: Map<string, Uint8Array> }[] = [];
  const consents: Record<string, readonly string[]> = {};
  for (const mod of staged) {
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(mod.zip);
    } catch {
      log.warn("mods", `the archive staged for ${mod.id} could not be decoded; dropping it`);
      continue;
    }
    const read = readModZip(bytes);
    if (!read.ok || read.id !== mod.id) {
      log.warn(
        "mods",
        `the archive staged for ${mod.id} is not that mod any more; dropping it`,
      );
      continue;
    }
    entries.push({ id: read.id, files: new Map(read.files.map(([p, b]) => [p, b])) });
    consents[read.id] = mod.granted;
  }

  /* The consents go in even when the pack turns out to be unusable, because the
   * loader asks about ids and an id with no grant reads as "not consented", which
   * is the right answer and a different message from "not there". */
  setSessionConsents(consents);
  if (entries.length === 0) {
    setSessionPacks(NO_DISK_PACKS);
    return NO_DISK_PACKS;
  }
  const report = await readModDir(sessionModSource(entries));
  setSessionPacks(report);
  return report;
}

/* ------------------------------------------------------------------ *
 * base64, over bytes.
 * ------------------------------------------------------------------ */

/* Chunked, because `String.fromCharCode(...bytes)` on a megabyte overflows the
 * argument list and the failure is a RangeError from inside a spread, which reads
 * like anything but "the array was too long". */
const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
