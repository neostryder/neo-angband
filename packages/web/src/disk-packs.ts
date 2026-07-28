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
 *       monster.json
 *
 * Everything here is best-effort and reports rather than throws. A hand-edited
 * manifest, a truncated download, a folder that is not a mod at all: each becomes
 * one line the mod manager can show, and the game still boots. A mod directory is
 * player-supplied data, so a bad one must never be able to stop the game
 * starting - the same reasoning as z-file.c returning NULL instead of dying.
 */

import { validateManifest, type PackManifest } from "@neo-angband/mod-sdk";

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
}

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
}

export const NO_DISK_PACKS: DiskPackReport = {
  packs: [],
  order: [],
  problems: [],
  dir: null,
  available: false,
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

/**
 * Fetch and validate every pack in the mods directory.
 *
 * `scope` and `fetchImpl` are injected so this is testable without a browser;
 * production passes neither.
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

  const problems: string[] = [];
  let raw: RawIndex;
  try {
    const res = await doFetch(indexUrl);
    if (!res.ok) throw new Error(`index responded ${String(res.ok)}`);
    const parsed: unknown = await res.json();
    if (parsed === null || typeof parsed !== "object") throw new Error("index is not an object");
    raw = parsed as RawIndex;
  } catch (e) {
    return {
      packs: [],
      order: [],
      problems: [`Could not read the mods folder: ${message(e)}`],
      dir: null,
      available: true,
    };
  }

  const dir = typeof raw.dir === "string" ? raw.dir : null;
  const entries = Array.isArray(raw.packs) ? raw.packs : [];
  const packs: DiskPack[] = [];

  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== "string" || id === "") continue;
    const files = asStringArray((entry as { files?: unknown }).files);
    if (!files.some((f) => f.toLowerCase() === "manifest.json")) {
      problems.push(`${id}: no manifest.json, so it is not a mod folder`);
      continue;
    }
    const pack = await readPack(id, files, baseUrl, doFetch, problems);
    if (pack) packs.push(pack);
  }

  const known = new Set(packs.map((p) => p.manifest.id));
  const order: string[] = [];
  for (const id of asStringArray(raw.order)) {
    if (known.has(id)) order.push(id);
    else problems.push(`load-order.json lists "${id}", which is not installed`);
  }

  return { packs, order, problems, dir, available: true };
}

async function readPack(
  id: string,
  files: readonly string[],
  baseUrl: string,
  doFetch: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
  problems: string[],
): Promise<DiskPack | null> {
  let manifest: PackManifest;
  try {
    const res = await doFetch(`${baseUrl}/${id}/manifest.json`);
    if (!res.ok) throw new Error("could not be read");
    manifest = validateManifest(await res.json());
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
    try {
      const res = await doFetch(`${baseUrl}/${id}/${file}`);
      if (!res.ok) throw new Error("could not be read");
      out[stem] = await res.json();
    } catch (e) {
      /* One bad record file does not condemn the pack: the composer will simply
       * not see that contribution, and the player is told which file it was. */
      problems.push(`${id}/${file}: ${message(e)}`);
    }
  }
  return { manifest, files: out };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
