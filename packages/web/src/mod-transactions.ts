import { installedModFormat, satisfies, validateManifest, type InstallListing, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { STORE_HANDLES, STORE_MODS, STORE_MOD_META, idbApply, idbGet, idbKeys, idbPut, openDb } from "./idb";
import { installModFromRepo, installedMeta, installedMods, sha256Hex, type InstallEnv, type InstallProgress, type InstallResult, type InstalledModMeta } from "./mod-install";
import { installedDigestsMatch } from "./mod-tier";
import type { ModConfiguration, ModStore, ConsentRecord } from "./mod-store";
import type { InstallPlan } from "./mod-manager/types";
import type { BrowseEntry } from "./mod-manager/browse-types";
import type { ModOrigin } from "./mod-consent";

const PENDING = "neo-angband:mod-transaction/pending";
const HISTORY = "neo-angband:mod-transaction/previous/";
const LOCK = "neo-angband:mod-transaction";
const FORMAT = "neo-angband/web/mod-transaction";

interface Version {
  readonly meta: InstalledModMeta;
  readonly files: ReadonlyArray<readonly [string, Uint8Array]>;
}

interface Transaction {
  readonly id: string;
  readonly sequence: number;
  readonly profileId: string | null;
  readonly plan: InstallPlan;
  readonly permissions: Readonly<Record<string, ConsentRecord>>;
  readonly previous: readonly Version[];
  readonly installedSet: readonly InstalledModMeta[];
  readonly configuration: ModConfiguration;
  readonly payloads: readonly Version[];
  readonly downloads: readonly { readonly id: string; readonly path: string; readonly bytes: Uint8Array; readonly digest: string }[];
  readonly phase: "downloading" | "ready" | "activating" | "committed";
  readonly restore?: ModConfiguration;
}

export interface ModTransactionEnvironment {
  readonly install: InstallEnv;
  readonly store: ModStore;
  readonly profileId?: string | null;
  readonly configurationStore?: (profileId: string | null) => ModStore;
  readonly allowed: () => boolean;
  readonly listing?: (repo: string, origin: ModOrigin) => InstallListing;
  readonly saveReferences?: (id: string, tag: string) => boolean;
}

export type StageResult = { readonly ok: true; readonly results: readonly InstallResult[] } | { readonly ok: false; readonly problem: string };

function document(data: Transaction): unknown {
  return { format: FORMAT, schemaVersion: 1, data };
}

function transaction(value: unknown): Transaction | null {
  const doc = value as { format?: unknown; schemaVersion?: unknown; data?: Transaction } | null;
  return doc?.format === FORMAT && doc.schemaVersion === 1 && doc.data ? doc.data : null;
}

async function locked<T>(env: ModTransactionEnvironment, body: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const scope = (env.install.scope ?? globalThis) as { navigator?: { locks?: Pick<LockManager, "request"> } };
  if (!scope.navigator?.locks) throw new Error("This browser cannot stage mod transactions.");
  return scope.navigator.locks.request(LOCK, async () => {
    const db = await openDb(env.install.scope ?? globalThis);
    if (!db) throw new Error("The mod transaction store could not be opened.");
    try { return await body(db); }
    finally { db.close?.(); }
  });
}

async function version(db: IDBDatabase, meta: InstalledModMeta): Promise<Version> {
  const files: Array<readonly [string, Uint8Array]> = [];
  for (const path of meta.files) {
    const value = await idbGet(db, STORE_MODS, `${meta.id}/${path}`);
    const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
    if (!bytes) throw new Error("A previous mod file could not be read.");
    files.push([path, new Uint8Array(bytes)]);
  }
  return { meta, files };
}

async function verified(payload: Version, env: ModTransactionEnvironment): Promise<boolean> {
  if (payload.files.length !== payload.meta.files.length || new Set(payload.files.map(([path]) => path)).size !== payload.files.length) return false;
  const read = (_id: string, path: string): Promise<Uint8Array | null> => Promise.resolve(payload.files.find(([file]) => file === path)?.[1] ?? null);
  return installedDigestsMatch(payload.meta, read, (bytes) => sha256Hex(bytes, env.install.subtle));
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, part: unknown) => {
    if (part !== null && typeof part === "object" && !Array.isArray(part)) {
      return Object.fromEntries(Object.entries(part).sort(([a], [b]) => a.localeCompare(b)));
    }
    return part;
  });
}

async function verifySet(pending: Transaction, env: ModTransactionEnvironment): Promise<void> {
  for (const download of pending.downloads) {
    if (await sha256Hex(download.bytes, env.install.subtle) !== download.digest) throw new Error("A staged download failed its digest check.");
  }
  if (pending.payloads.length !== pending.plan.downloads.length) throw new Error("The staged mod set is incomplete.");
  for (const download of pending.plan.downloads) {
    const payload = pending.payloads.find((entry) => entry.meta.id === download.mod.id);
    if (!payload || !await verified(payload, env)) throw new Error("A staged mod file failed its digest check.");
    const bytes = payload.files.find(([path]) => path.toLowerCase() === "manifest.json")?.[1];
    if (!bytes || canonical(validateManifest(JSON.parse(new TextDecoder().decode(bytes)))) !== canonical(download.manifest)) {
      throw new Error("The manifest changed after the mod plan was resolved.");
    }
  }
}

async function sequence(db: IDBDatabase): Promise<number> {
  let next = 1;
  for (const key of await idbKeys(db, STORE_HANDLES)) {
    if (!key.startsWith(HISTORY)) continue;
    const value = transaction(await idbGet(db, STORE_HANDLES, key));
    if (value) next = Math.max(next, value.sequence + 1);
  }
  return next;
}

function manifestOf(payload: Version): PackManifest {
  const bytes = payload.files.find(([path]) => path.toLowerCase() === "manifest.json")?.[1];
  if (!bytes) throw new Error("A previous mod manifest could not be read.");
  return validateManifest(JSON.parse(new TextDecoder().decode(bytes)));
}

function ruleFlags(manifests: readonly PackManifest[]): string[] {
  return manifests.flatMap((manifest) => [
    ...(manifest.rules ?? []).map((rule) => rule.flag),
    ...(manifest.sections ?? []).flatMap((section) => section.flag ? [section.flag] : []),
  ]);
}

async function save(db: IDBDatabase, pending: Transaction): Promise<void> {
  if (!await idbPut(db, STORE_HANDLES, PENDING, document(pending))) throw new Error("The mod transaction could not be saved.");
}

async function clear(db: IDBDatabase): Promise<void> {
  if (!await idbApply(db, [{ store: STORE_HANDLES, del: [PENDING] }])) throw new Error("The mod transaction could not be cleared.");
}

export async function stageModPlan(
  plan: InstallPlan,
  permissions: Readonly<Record<string, ConsentRecord>>,
  env: ModTransactionEnvironment,
  progress: (progress: InstallProgress) => void = () => {},
): Promise<StageResult> {
  try {
    return await locked(env, async (db) => {
      const existing = transaction(await idbGet(db, STORE_HANDLES, PENDING));
      if (existing && existing.phase !== "downloading") throw new Error("A mod transaction is staged, applies on next start.");
      const metas = await installedMods(env.install.scope ?? globalThis);
      if (plan.installedSet && canonical(plan.installedSet) !== canonical(metas)) throw new Error("The installed mod set changed before staging.");
      const previous = await Promise.all(metas.filter((meta) => plan.downloads.some((download) => download.mod.id === meta.id)).map((meta) => version(db, meta)));
      for (const payload of previous) {
        if (payload.meta.digests && !await verified(payload, env)) throw new Error("A previous mod file failed its digest check.");
      }
      let pending: Transaction = {
        id: globalThis.crypto.randomUUID(), sequence: await sequence(db), installedSet: metas, profileId: env.profileId ?? null, plan, permissions,
        previous, configuration: env.store.captureConfiguration(plan.downloads.map((download) => download.mod.id), ruleFlags([...previous.map(manifestOf), ...plan.downloads.map((download) => download.manifest)])),
        payloads: [], downloads: [], phase: "downloading",
      };
      await save(db, pending);
      try {
        const results: InstallResult[] = [];
        for (const download of plan.downloads) {
          const result = await installModFromRepo(download.mod, metas.find((meta) => meta.id === download.mod.id) ?? null, {
            ...env.install,
            downloaded: async (path, bytes) => {
              const digest = await sha256Hex(bytes, env.install.subtle);
              pending = { ...pending, downloads: [...pending.downloads, { id: download.mod.id, path, bytes, digest }] };
              await save(db, pending);
              await env.install.downloaded?.(path, bytes);
            },
            stage: async (meta, files) => {
              pending = { ...pending, payloads: [...pending.payloads, { meta, files }] };
              await save(db, pending);
              return true;
            },
          }, { origin: download.origin, allowed: env.allowed(), ...(env.listing ? { listing: env.listing(download.mod.repo, download.origin) } : {}) }, progress);
          if (!result.ok) throw new Error(result.problem);
          results.push(result);
        }
        const stored = transaction(await idbGet(db, STORE_HANDLES, PENDING));
        if (!stored) throw new Error("The staged mod set is incomplete.");
        await verifySet(stored, env);
        await save(db, { ...stored, phase: "ready" });
        return { ok: true as const, results };
      } catch (error) {
        await clear(db);
        throw error;
      }
    });
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) };
  }
}

function notice(pending: Transaction): string {
  const names = pending.plan.downloads.map((download) => download.mod.name).join(", ");
  return `The mod update for ${names} failed. The previous versions were restored.`;
}

export async function activateModTransaction(env: ModTransactionEnvironment): Promise<string | null> {
  const probe = await openDb(env.install.scope ?? globalThis);
  if (!probe) return null;
  const exists = await idbGet(probe, STORE_HANDLES, PENDING);
  probe.close?.();
  if (!exists) return null;
  return locked(env, async (db) => {
    const pending = transaction(await idbGet(db, STORE_HANDLES, PENDING));
    if (!pending) return null;
    if (pending.phase === "downloading" || pending.phase === "committed") {
      await clear(db);
      return null;
    }
    const store = env.configurationStore?.(pending.profileId) ?? env.store;
    if (pending.phase === "activating") {
      if (!store.restoreConfiguration(pending.configuration)) throw new Error("The previous mod configuration could not be restored.");
      await clear(db);
      return notice(pending);
    }
    try {
      const current = await installedMods(env.install.scope ?? globalThis);
      if (canonical(pending.installedSet) !== canonical(current)) throw new Error("The installed mod set changed before activation.");
      await verifySet(pending, env);
      const configuration = store.captureConfiguration(pending.configuration.ids, pending.configuration.ruleFlags);
      const activating = { ...pending, configuration, phase: "activating" as const };
      await save(db, activating);
      try {
        if (pending.restore && !store.restoreConfiguration(pending.restore)) throw new Error("The previous mod configuration could not be restored.");
        for (const download of pending.plan.downloads) {
          const choices = pending.permissions[download.mod.id];
          if (!choices) continue;
          store.setDecisions(download.mod.id, choices, download.mod.version);
          const written = store.getDecisions(download.mod.id);
          if (choices.granted.some((cap) => !written.granted.includes(cap)) || choices.refused.some((cap) => !written.refused.includes(cap)) || store.getConsentVersion(download.mod.id) !== download.mod.version) {
            throw new Error("The mod permissions could not be saved.");
          }
        }
        for (const id of pending.plan.enableIds ?? []) {
          store.setModEnabled(id, true);
          if (!store.isEnabled(id)) throw new Error("The mod enablement could not be saved.");
        }
        const ids = new Set(pending.plan.downloads.map((download) => download.mod.id));
        const stale = (await idbKeys(db, STORE_MODS)).filter((key) => ids.has(key.split("/")[0]!));
        if (!await idbApply(db, [
          { store: STORE_MODS, del: stale, put: pending.payloads.flatMap((payload) => payload.files.map(([path, bytes]) => [`${payload.meta.id}/${path}`, bytes] as const)) },
          { store: STORE_MOD_META, put: pending.payloads.map((payload) => [payload.meta.id, { format: installedModFormat.format, schemaVersion: installedModFormat.schemaVersion, data: payload.meta }] as const) },
          { store: STORE_HANDLES, put: [[`${HISTORY}${String(pending.sequence).padStart(12, "0")}`, document({ ...activating, payloads: [], downloads: [], permissions: {} })], [PENDING, document({ ...activating, phase: "committed" })]] },
        ])) throw new Error("The staged mod set could not be activated.");
      } catch (error) {
        if (!store.restoreConfiguration(configuration)) throw new Error("The previous mod configuration could not be restored.", { cause: error });
        await clear(db);
        return notice(pending);
      }
    } catch (error) {
      const recovery = transaction(await idbGet(db, STORE_HANDLES, PENDING));
      if (recovery?.phase === "activating") throw error;
      await clear(db);
      return notice(pending);
    }
    await clear(db);
    return null;
  });
}

async function previous(db: IDBDatabase, id: string): Promise<{ pending: Transaction; version: Version } | null> {
  const entries: Transaction[] = [];
  for (const key of await idbKeys(db, STORE_HANDLES)) {
    if (!key.startsWith(HISTORY)) continue;
    const pending = transaction(await idbGet(db, STORE_HANDLES, key));
    if (pending) entries.push(pending);
  }
  entries.sort((a, b) => b.sequence - a.sequence);
  for (const pending of entries) {
    const payload = pending.previous.find((entry) => entry.meta.id === id);
    if (payload) return { pending, version: payload };
  }
  return null;
}

export async function previousModVersion(id: string, env: ModTransactionEnvironment): Promise<BrowseEntry | null> {
  return locked(env, async (db) => {
    const retained = await previous(db, id);
    if (!retained) return null;
    const { meta, files } = retained.version;
    const bytes = files.find(([path]) => path.toLowerCase() === "manifest.json")?.[1];
    if (!bytes) return null;
    const manifest = validateManifest(JSON.parse(new TextDecoder().decode(bytes)));
    return { ok: true, ref: { repo: meta.repo, tag: meta.tag }, mod: {
      id: meta.id, name: manifest.name, version: manifest.version, repo: meta.repo, tag: meta.tag,
      tags: [meta.tag], author: manifest.author ?? "", description: manifest.description ?? "",
      engine: null, screenshots: [], compatible: true, engineNote: null, channelHeld: null, engineHeld: null,
      payload: meta.files.map((path) => ({ kind: "file" as const, path })), bytes: null, guessedPayload: false,
      sha: meta.sha ?? null, capabilities: manifest.capabilities ?? [], compat: manifest.compat ?? [],
    } };
  });
}

export async function stageModRollback(id: string, env: ModTransactionEnvironment): Promise<StageResult> {
  try {
    return await locked(env, async (db) => {
      if (transaction(await idbGet(db, STORE_HANDLES, PENDING))) throw new Error("A mod transaction is staged, applies on next start.");
      const retained = await previous(db, id);
      if (!retained) throw new Error("No previous version is available.");
      if (retained.version.meta.digests && !await verified(retained.version, env)) throw new Error("A previous mod file failed its digest check.");
      const current = await installedMeta(id, env.install.scope ?? globalThis);
      const download = retained.pending.plan.downloads.find((entry) => entry.mod.id === id)!;
      const bytes = retained.version.files.find(([path]) => path.toLowerCase() === "manifest.json")?.[1];
      if (!bytes) throw new Error("A previous mod manifest could not be read.");
      const manifest = validateManifest(JSON.parse(new TextDecoder().decode(bytes)));
      const store = env.configurationStore?.(retained.pending.profileId) ?? env.store;
      const currentPayload = current ? await version(db, current) : null;
      const flags = ruleFlags([manifest, ...(currentPayload ? [manifestOf(currentPayload)] : [])]);
      const installedSet = await installedMods(env.install.scope ?? globalThis);
      const manifests = await Promise.all(installedSet.filter((meta) => meta.id !== id).map(async (meta) => manifestOf(await version(db, meta))));
      manifests.push(manifest);
      for (const entry of manifests) {
        for (const [dependency, range] of Object.entries(entry.dependencies ?? {})) {
          if (dependency === "core") continue;
          const found = manifests.find((candidate) => candidate.id === dependency);
          if (!found || !satisfies(found.version, range)) throw new Error("The previous mod version conflicts with an installed dependency.");
        }
      }
      const digests: Record<string, string> = {};
      for (const [path, body] of retained.version.files) digests[path] = await sha256Hex(body, env.install.subtle);
      const restored = { ...retained.version, meta: { ...retained.version.meta, digests: retained.version.meta.digests ?? digests } };
      const pending: Transaction = {
        ...retained.pending, id: globalThis.crypto.randomUUID(), sequence: await sequence(db), installedSet,
        plan: { id: retained.pending.plan.id, operation: "rollback", downloads: [{ ...download, manifest, mod: { ...download.mod, tag: retained.version.meta.tag, version: manifest.version } }], newGrants: [], conflicts: [] },
        previous: currentPayload ? [currentPayload] : [], payloads: [restored], downloads: [], permissions: {},
        configuration: store.captureConfiguration([id], flags), restore: { ...retained.pending.configuration, ids: [id], ruleFlags: flags }, phase: "ready",
      };
      await save(db, pending);
      return { ok: true as const, results: [{ ok: true as const, meta: retained.version.meta, staged: true }] };
    });
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) };
  }
}

export async function releasePreviousModVersions(id: string, env: ModTransactionEnvironment): Promise<boolean> {
  return locked(env, async (db) => {
    const writes: Array<readonly [string, unknown]> = [];
    const deleted: string[] = [];
    for (const key of await idbKeys(db, STORE_HANDLES)) {
      if (!key.startsWith(HISTORY)) continue;
      const pending = transaction(await idbGet(db, STORE_HANDLES, key));
      if (!pending) continue;
      const keep = pending.previous.filter((entry) => entry.meta.id !== id || env.saveReferences?.(id, entry.meta.tag));
      if (keep.length === 0) deleted.push(key);
      else if (keep.length !== pending.previous.length) writes.push([key, document({ ...pending, previous: keep })]);
    }
    return writes.length === 0 && deleted.length === 0 || await idbApply(db, [{ store: STORE_HANDLES, put: writes, del: deleted }]);
  });
}
