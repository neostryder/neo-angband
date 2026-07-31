/**
 * Installing a mod from its own repository, and reading one back.
 *
 * The catalogue (mod-registry.ts) says WHERE a mod is and what it must hash to. This
 * module fetches it, checks it, keeps it, and serves it back to the one validator
 * every front end shares (readModDir in disk-packs.ts) as a third ModDirSource:
 *
 *   "app"       the desktop shell's own mods folder, over its loopback server
 *   "picked"    a folder the player chose, through the File System Access API
 *   "installed" this: bytes downloaded from a repository, kept in IndexedDB
 *
 * A third SOURCE and not a third notion of what a mod is. Everything about validity -
 * that a folder needs a manifest, that the manifest's id must match the folder, which
 * files are records and which are assets - stays in readModDir, so an installed mod and
 * a hand-unzipped one are the same mod.
 *
 * THE ORDER IS THE POINT. Fetch, hash, COMPARE, and only then store; nothing is written
 * under the mod's name until every byte has matched the digest the game shipped with.
 * A partial or tampered download therefore cannot become an installed mod that runs
 * once and fails later - it never becomes an installed mod at all. And the store is
 * written in one transaction with the meta record LAST, so the presence of the meta
 * record is proof the install completed rather than a hint that it started.
 *
 * WHY THE BYTES ARE KEPT RATHER THAN REFETCHED. A mod's code has to be there at boot,
 * before anything is drawn, and boot cannot depend on the network: a player on a train
 * would otherwise lose their mods, and a rate-limited host would look like a corrupted
 * install. Keeping them also means the digest is checked ONCE, at install, rather than
 * on every launch - and re-verified on demand by the mod manager's own check.
 */

import { unzipSync } from "fflate";

import {
  type DiskPackReport,
  type ModDirEntry,
  type ModDirSource,
  NO_DISK_PACKS,
  readModDir,
} from "./disk-packs";
import {
  STORE_MODS,
  STORE_MOD_META,
  idbDelete,
  idbDeletePrefix,
  idbGet,
  idbKeys,
  idbPut,
  idbPutMany,
  openDb,
} from "./idb";
import { buildModuleGraph } from "./mod-modules";
import { type RecommendedMod, type RegistryFile, badPath, rawUrl } from "./mod-registry";
import { assetMime, sortPackFiles } from "./pack-files";

/** What is recorded about an installed mod, so the manager can say where it came from. */
export interface InstalledModMeta {
  readonly id: string;
  readonly repo: string;
  readonly tag: string;
  /** Every path stored for this mod, relative to its folder. */
  readonly files: readonly string[];
  /**
   * When it was installed, as an ISO string.
   *
   * Supplied by the caller rather than read from the clock here, so a test can assert
   * on it and so this module has no ambient dependency on time.
   */
  readonly installedAt: string;
}

/* ------------------------------------------------------------------ *
 * Hashing and fetching.
 * ------------------------------------------------------------------ */

/** The pieces of the platform this module touches, injected so it is testable. */
export interface InstallEnv {
  readonly fetch: (url: string) => Promise<FetchLike>;
  readonly subtle: Pick<SubtleCrypto, "digest">;
  /** The IndexedDB-bearing scope; production passes globalThis. */
  readonly scope?: unknown;
  /** ISO timestamp for the meta record. */
  readonly now: () => string;
}

export interface FetchLike {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Lower-case hex SHA-256 of these bytes. */
export async function sha256Hex(
  bytes: Uint8Array,
  subtle: Pick<SubtleCrypto, "digest">,
): Promise<string> {
  /* A fresh, exactly-sized copy: a Uint8Array may be a VIEW onto a larger buffer
   * (every slice of an unzip output is), and handing the whole buffer to digest would
   * hash bytes that are not part of this file. That failure is invisible in the happy
   * case and produces a mismatch nobody can explain in the unhappy one. */
  const exact = new Uint8Array(bytes.byteLength);
  exact.set(bytes);
  const digest = await subtle.digest("SHA-256", exact);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Raised when bytes arrived but are not the bytes the game expected. */
export class DigestMismatchError extends Error {
  constructor(
    readonly path: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    /* Both digests, in full, in the message. A player reporting this needs to be able
     * to paste something the author can act on, and "the download did not match" is
     * indistinguishable from a bug in the game. */
    super(
      `${path}: content does not match the expected checksum ` +
        `(expected ${expected}, got ${actual})`,
    );
    this.name = "DigestMismatchError";
  }
}

/**
 * Fetch one file and return its bytes only if they hash to `sha256`.
 *
 * Throws on every other outcome, with the reason, because each needs different advice:
 * a 404 means the tag or path in the catalogue is wrong, a network error means try
 * again, and a digest mismatch means do NOT try again.
 */
export async function fetchVerified(
  url: string,
  sha256: string,
  path: string,
  env: InstallEnv,
): Promise<Uint8Array> {
  let res: FetchLike;
  try {
    res = await env.fetch(url);
  } catch (e) {
    throw new Error(`${path}: could not be downloaded (${message(e)})`, { cause: e });
  }
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? `${path}: not found at this tag (HTTP 404)`
        : `${path}: the server refused it (HTTP ${res.status})`,
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const actual = await sha256Hex(bytes, env.subtle);
  if (actual !== sha256) throw new DigestMismatchError(path, sha256, actual);
  return bytes;
}

/* ------------------------------------------------------------------ *
 * Installing.
 * ------------------------------------------------------------------ */

export interface InstallProgress {
  /** Which file is being fetched, 1-based, and how many there are. */
  readonly done: number;
  readonly total: number;
  readonly path: string;
}

export type InstallResult =
  | { readonly ok: true; readonly meta: InstalledModMeta }
  | { readonly ok: false; readonly problem: string };

/**
 * Download, verify, and store one catalogue mod.
 *
 * Never throws: a failed install is one line the installer screen can show beside the
 * mod's row, and the other mods in the batch still install. A thrown error here would
 * abandon the whole batch on one bad row.
 */
export async function installRecommendedMod(
  mod: RecommendedMod,
  env: InstallEnv,
  onProgress?: (p: InstallProgress) => void,
): Promise<InstallResult> {
  try {
    const files = await downloadPayload(mod, env, onProgress);

    /* Re-checked here even though the catalogue was validated, because the archive
     * path produces paths that came from the ZIP rather than from the catalogue -
     * they are attacker-controlled in exactly the way the listed ones are not. This
     * is the zip-slip check, and it belongs after the unzip, not before it. */
    for (const [path] of files) {
      const bad = badPath(path);
      if (bad) return { ok: false, problem: `${mod.id}: ${path}: ${bad}` };
    }
    if (!files.some(([p]) => p.toLowerCase() === "manifest.json")) {
      return { ok: false, problem: `${mod.id}: the download has no manifest.json` };
    }

    const db = await openDb(env.scope ?? globalThis);
    if (!db) {
      return {
        ok: false,
        problem: `${mod.id}: this browser will not let the game store downloaded mods`,
      };
    }

    /* Any older copy goes first, so a reinstall at a different tag cannot leave files
     * from the previous one behind - a mod that is half v1 and half v2 is a mod whose
     * bug reports mean nothing. */
    await idbDeletePrefix(db, STORE_MODS, `${mod.id}/`);

    const stored = await idbPutMany(
      db,
      STORE_MODS,
      files.map(([path, bytes]) => [`${mod.id}/${path}`, bytes] as const),
    );
    if (!stored) {
      /* Reported, not swallowed. The usual cause is the storage quota, and a mod that
       * silently did not store is a mod the player enables and never sees work. */
      await idbDeletePrefix(db, STORE_MODS, `${mod.id}/`);
      return {
        ok: false,
        problem: `${mod.id}: could not be saved - the browser refused the write (out of storage?)`,
      };
    }

    const meta: InstalledModMeta = {
      id: mod.id,
      repo: mod.repo,
      tag: mod.tag,
      files: files.map(([p]) => p),
      installedAt: env.now(),
    };
    /* LAST, and only after the bytes are down: the meta record is what makes the mod
     * count as installed, so writing it first would advertise a mod whose files may
     * not be there. */
    if (!(await idbPut(db, STORE_MOD_META, mod.id, meta))) {
      await idbDeletePrefix(db, STORE_MODS, `${mod.id}/`);
      return { ok: false, problem: `${mod.id}: could not record the install` };
    }
    return { ok: true, meta };
  } catch (e) {
    return { ok: false, problem: message(e) };
  }
}

/** Fetch the payload, verified, as path/bytes pairs. */
async function downloadPayload(
  mod: RecommendedMod,
  env: InstallEnv,
  onProgress?: (p: InstallProgress) => void,
): Promise<Array<readonly [string, Uint8Array]>> {
  if (mod.payload.kind === "archive") {
    const archives = mod.payload.archives;
    const out: Array<readonly [string, Uint8Array]> = [];
    /* Which archive contributed each path, so a collision can name both. Two archives
     * writing one path is an authoring mistake in the mod (a root file duplicated
     * across packs, say) and the install would silently keep whichever unzipped last -
     * a mod that behaves differently depending on catalogue order. */
    const from = new Map<string, string>();

    for (let i = 0; i < archives.length; i++) {
      const { path, sha256 } = archives[i] as RegistryFile;
      onProgress?.({ done: i + 1, total: archives.length, path });
      const zip = await fetchVerified(rawUrl(mod.repo, mod.tag, path), sha256, path, env);
      /* Only now, with the digest matched, is the archive parsed. An unzip is the most
       * hostile thing this module does to untrusted bytes, and the whole point of
       * hashing the archive rather than its contents is that it never runs on bytes the
       * game did not expect. */
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(zip);
      } catch (e) {
        throw new Error(`${path}: is not a readable zip (${message(e)})`, { cause: e });
      }
      let kept = 0;
      for (const [name, bytes] of Object.entries(entries)) {
        /* Directory entries: zero-length and named with a trailing slash. Skipped
         * rather than stored as empty files. */
        if (name.endsWith("/")) continue;
        const owner = from.get(name);
        if (owner !== undefined) {
          throw new Error(`${name}: in both ${owner} and ${path}`);
        }
        from.set(name, path);
        out.push([name, bytes]);
        kept++;
      }
      /* Per archive, not just overall: five good packs and one empty one is a broken
       * install that a total count would call fine. */
      if (kept === 0) throw new Error(`${path}: the archive is empty`);
    }
    return out;
  }

  const list = mod.payload.files;
  const out: Array<readonly [string, Uint8Array]> = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i] as (typeof list)[number];
    onProgress?.({ done: i + 1, total: list.length, path: f.path });
    out.push([
      f.path,
      await fetchVerified(rawUrl(mod.repo, mod.tag, f.path), f.sha256, f.path, env),
    ]);
  }
  return out;
}

/** Every installed mod's provenance record. */
export async function installedMods(
  scope: unknown = globalThis,
): Promise<readonly InstalledModMeta[]> {
  const db = await openDb(scope);
  if (!db) return [];
  const out: InstalledModMeta[] = [];
  for (const id of await idbKeys(db, STORE_MOD_META)) {
    const meta = asMeta(await idbGet(db, STORE_MOD_META, id));
    if (meta) out.push(meta);
  }
  /* Sorted by id so the manager's list, and any test of it, is stable: IndexedDB key
   * order is not something to rely on for display. */
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Remove a mod's files and its record. Reports whether everything went. */
export async function uninstallMod(
  id: string,
  scope: unknown = globalThis,
): Promise<boolean> {
  const db = await openDb(scope);
  if (!db) return false;
  /* The meta record goes FIRST here - the mirror of install order. While files remain
   * without a record the mod simply does not load; a record without files would load
   * a mod that is not there. */
  await idbDelete(db, STORE_MOD_META, id);
  return await idbDeletePrefix(db, STORE_MODS, `${id}/`);
}

function asMeta(v: unknown): InstalledModMeta | null {
  if (v === null || typeof v !== "object") return null;
  const m = v as Partial<InstalledModMeta>;
  if (typeof m.id !== "string" || m.id === "") return null;
  if (typeof m.repo !== "string" || typeof m.tag !== "string") return null;
  if (!Array.isArray(m.files)) return null;
  if (typeof m.installedAt !== "string") return null;
  return m as InstalledModMeta;
}

/* ------------------------------------------------------------------ *
 * Reading installed mods back.
 * ------------------------------------------------------------------ */

/**
 * A ModDirSource over the installed mods in IndexedDB.
 *
 * Mirrors folderModSource: the bytes have no URL of their own, so code and assets are
 * wrapped in blob: URLs, with the same two lifetimes - a module URL may be revoked once
 * its import settles, an asset URL must outlive the call that asked for one and so is
 * cached. Getting those the same way round is why this reuses that file's reasoning
 * rather than inventing its own.
 */
export function installedModSource(
  metas: readonly InstalledModMeta[],
  read: (id: string, path: string) => Promise<Uint8Array | null>,
): ModDirSource {
  const assetUrls = new Map<string, string>();
  const graphUrls = new Map<string, readonly string[]>();

  const text = async (id: string, path: string): Promise<string> => {
    const bytes = await read(id, path);
    if (!bytes) throw new Error("could not be read");
    return new TextDecoder().decode(bytes);
  };

  return {
    kind: "installed",
    /* No path to show: these were downloaded, not put anywhere by the player. The
     * manager names the repository and tag instead, which is the honest answer to
     * "where did this come from" for an installed mod. */
    dir: () => null,
    list: () =>
      Promise.resolve(
        metas.map((meta): ModDirEntry => ({
          id: meta.id,
          ...sortPackFiles(meta.files),
        })),
      ),
    readJson: async (id, file) => JSON.parse(await text(id, file)) as unknown,
    /* An installed mod's order is the player's, kept by mod-store.ts. A load-order.json
     * inside a downloaded mod is the AUTHOR's file and has no business ordering the
     * player's other mods, so it is ignored rather than honoured. */
    order: () => Promise.resolve([]),
    codeUrl: async (id, file) => {
      const made: string[] = [];
      const graph = await buildModuleGraph(file, {
        read: async (path) => {
          const bytes = await read(id, path);
          return bytes ? new TextDecoder().decode(bytes) : null;
        },
        urlFor: (_path, body) => {
          const url = URL.createObjectURL(
            new Blob([body], { type: "text/javascript" }),
          );
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
    assetUrl: async (id, path) => {
      const key = `${id}/${path}`;
      const cached = assetUrls.get(key);
      if (cached !== undefined) return cached;
      const bytes = await read(id, path);
      if (!bytes) return null;
      const type = assetMime(path);
      /* A copy of exactly this file's bytes, for the same reason sha256Hex makes one:
       * a stored Uint8Array may be a view onto a larger buffer, and a Blob built from
       * the buffer would carry its neighbours' bytes into the image. */
      const part = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const url = URL.createObjectURL(
        type ? new Blob([part], { type }) : new Blob([part]),
      );
      assetUrls.set(key, url);
      return url;
    },
  };
}

/** Read every installed mod at boot. Never prompts, never touches the network. */
export async function loadInstalledMods(
  scope: unknown = globalThis,
): Promise<DiskPackReport> {
  const metas = await installedMods(scope);
  if (metas.length === 0) return NO_DISK_PACKS;
  const db = await openDb(scope);
  if (!db) return NO_DISK_PACKS;
  const read = async (id: string, path: string): Promise<Uint8Array | null> => {
    const v = await idbGet(db, STORE_MODS, `${id}/${path}`);
    if (v instanceof Uint8Array) return v;
    /* structuredClone may hand back an ArrayBuffer where a Uint8Array went in,
     * depending on the engine. Accepted rather than rejected: refusing here would
     * report every installed mod as unreadable on those engines. */
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    return null;
  };
  return await readModDir(installedModSource(metas, read));
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
