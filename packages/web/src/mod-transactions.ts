import { installedModFormat, satisfies, validateManifest, type InstallListing, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { STORE_HANDLES, STORE_MODS, STORE_MOD_META, STORE_MOD_VERSIONS, idbApply, idbGet, idbKeys, idbPut, openDb } from "./idb";
import { archiveCurrent, archivedMod, archivedVersions, readArchivedVersion, restoreArchivedVersion, versionKey, markInstallRevision, installModFromRepo, installedMeta, installedMods, sha256Hex, type ArchivedVersion, type InstallEnv, type InstallProgress, type InstallResult, type InstalledModMeta } from "./mod-install";
import { installedDigestsMatch } from "./mod-tier";
import type { ModConfiguration, ModStore, ConsentRecord } from "./mod-store";
import type { InstallPlan } from "./mod-manager/types";
import type { BrowseEntry } from "./mod-manager/browse-types";
import type { ModOrigin } from "./mod-consent";
import { installBlocked } from "./mod-consent";
import { originConflict } from "./mod-source";
import { matchesSavedVersion } from "./mod-manager/mod-lists";

const PENDING = "neo-angband:mod-transaction/pending";
const LOCK = "neo-angband:mod-transaction";
const FORMAT = "neo-angband/web/mod-transaction";

interface Version {
  readonly meta: InstalledModMeta;
  readonly files: ReadonlyArray<readonly [string, Uint8Array]>;
}

interface Transaction {
  readonly id: string;
  readonly profileId: string | null;
  readonly plan: InstallPlan;
  readonly permissions: Readonly<Record<string, ConsentRecord>>;
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
  readonly saveReferences?: (id: string, tag: string) => boolean | Promise<boolean>;
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
    try { await migrateRetainedVersions(db, env); return await body(db); }
    finally { db.close?.(); }
  });
}

async function migrateRetainedVersions(db: IDBDatabase, env: ModTransactionEnvironment): Promise<void> {
  const keys = (await idbKeys(db, STORE_HANDLES)).filter((key) => key.startsWith("neo-angband:mod-transaction/previous/")).sort();
  if (!keys.length) return;
  const rows: Array<readonly [string, ArchivedVersion]> = [];
  let next = await sequence(db);
  for (const key of keys) {
    const old = transaction(await idbGet(db, STORE_HANDLES, key)) as (Transaction & { previous?: readonly Version[] }) | null;
    if (!old?.previous) throw new Error("A previous mod file could not be read.");
    for (const payload of old.previous) {
      if (payload.meta.digests && !await verified(payload, env)) throw new Error("A previous mod file failed its digest check.");
      const digests: Record<string, string> = {};
      for (const [path, bytes] of payload.files) digests[path] = await sha256Hex(bytes, env.install.subtle);
      rows.push([versionKey(payload.meta), { meta: { format: installedModFormat.format, schemaVersion: installedModFormat.schemaVersion, data: payload.meta }, files: payload.files, digests, configuration: old.configuration, profileId: old.profileId, sequence: next++ }]);
    }
  }
  if (!await idbApply(db, [{ store: STORE_MOD_VERSIONS, put: rows }, { store: STORE_HANDLES, del: keys }])) throw new Error("The previous mod versions could not be restored.");
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
  if (pending.plan.modList) {
    for (const saved of pending.plan.modList.mods.filter((mod) => pending.plan.modList!.resolvedOrder.includes(mod.id))) {
      const payload = pending.payloads.find((entry) => entry.meta.id === saved.id);
      const meta = payload?.meta ?? pending.installedSet.find((entry) => entry.id === saved.id);
      const manifest = payload ? manifestOf(payload) : meta ? manifestOf(await currentVersion(meta, env)) : pending.plan.keptManifests?.find((entry) => entry.id === saved.id);
      if (!matchesSavedVersion(saved, manifest ? { id: manifest.id, version: manifest.version, manifest } : undefined, meta)) throw new Error("The downloaded mod does not match the saved version.");
    }
  }
}

async function sequence(db: IDBDatabase): Promise<number> {
  let next = 1;
  for (const key of await idbKeys(db, STORE_MOD_VERSIONS)) {
    const value = await idbGet(db, STORE_MOD_VERSIONS, key) as ArchivedVersion | undefined;
    if (value) next = Math.max(next, (value.sequence ?? 0) + 1);
  }
  return next;
}

async function currentVersion(meta: InstalledModMeta, env: ModTransactionEnvironment): Promise<Version> {
  const db = await openDb(env.install.scope ?? globalThis);
  if (!db) throw new Error("The mod transaction store could not be opened.");
  try { return await version(db, meta); }
  finally { db.close?.(); }
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
      const ids = [...new Set([...plan.downloads.map((download) => download.mod.id), ...(plan.removeIds ?? []), ...(plan.modList ? [...plan.modList.mods.map((mod) => mod.id), ...env.store.getEnabled(), ...plan.effectiveEnabled ?? []] : [])])];
      const previous = await Promise.all(metas.filter((meta) => ids.includes(meta.id)).map((meta) => version(db, meta)));
      for (const payload of previous) {
        if (payload.meta.digests && !await verified(payload, env)) throw new Error("A previous mod file failed its digest check.");
      }
      let pending: Transaction = {
        id: globalThis.crypto.randomUUID(), installedSet: metas, profileId: env.profileId ?? null, plan, permissions,
        configuration: env.store.captureConfiguration(ids, ruleFlags([...previous.map(manifestOf), ...plan.downloads.map((download) => download.manifest), ...plan.keptManifests ?? []])),
        payloads: [], downloads: [], phase: "downloading",
      };
      await save(db, pending);
      try {
        const results: InstallResult[] = [];
        for (const download of plan.downloads) {
          const current = metas.find((meta) => meta.id === download.mod.id) ?? null;
          const blocked = installBlocked(download.origin, env.allowed()) ?? originConflict(current, download.mod.repo);
          if (blocked) throw new Error(blocked);
          const install = {
            ...env.install,
            downloaded: async (path: string, bytes: Uint8Array) => {
              const digest = await sha256Hex(bytes, env.install.subtle);
              pending = { ...pending, downloads: [...pending.downloads, { id: download.mod.id, path, bytes, digest }] };
              await save(db, pending);
              await env.install.downloaded?.(path, bytes);
            },
            stage: async (meta: InstalledModMeta, files: ReadonlyArray<readonly [string, Uint8Array]>) => {
              pending = { ...pending, payloads: [...pending.payloads, { meta, files }] };
              await save(db, pending);
              return true;
            },
          };
          const cached = await archivedMod({ repo: download.mod.repo, tag: download.mod.tag.startsWith("archive:") ? download.mod.tag : download.mod.sha ?? download.mod.tag }, env.install.scope ?? globalThis);
          if (download.mod.tag.startsWith("archive:") && !cached) throw new Error("The saved mod version is unavailable.");
          const result = cached ? await restoreArchivedVersion(cached.meta, env.install.scope ?? globalThis, install.stage, env.install.subtle)
            : await installModFromRepo(download.mod, current, install, { origin: download.origin, allowed: env.allowed(), ...(env.listing ? { listing: env.listing(download.mod.repo, download.origin) } : {}) }, progress);
          if (!result.ok) throw new Error(result.problem);
          results.push(result);
        }
        const stored = transaction(await idbGet(db, STORE_HANDLES, PENDING));
        if (!stored) throw new Error("The staged mod set is incomplete.");
        await verifySet(stored, env);
        if (plan.configurationRevision && plan.configurationRevision !== env.store.configurationRevision()) throw new Error("The mod configuration changed in another window. Review it again.");
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
      if (pending.phase === "committed") markInstallRevision(env.install.scope ?? globalThis);
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
      if (pending.plan.configurationRevision && pending.plan.configurationRevision !== store.configurationRevision()) throw new Error("The mod configuration changed in another window. Review it again.");
      await verifySet(pending, env);
      const configuration = store.captureConfiguration(pending.configuration.ids, pending.configuration.ruleFlags);
      const activating = { ...pending, configuration, phase: "activating" as const };
      await save(db, activating);
      try {
        const ids = new Set([...pending.plan.downloads.map((download) => download.mod.id), ...(pending.plan.removeIds ?? [])]);
        const retained = (await Promise.all([...ids].map((id) => archiveCurrent(db, id, { configuration, profileId: pending.profileId })))).flat();
        const next = await sequence(db);
        const archive = retained.map(([key, row]) => [key, { ...row, sequence: next }] as const);
        for (const payload of pending.payloads) archive.push([versionKey(payload.meta), { meta: { format: installedModFormat.format, schemaVersion: installedModFormat.schemaVersion, data: payload.meta }, files: payload.files, sequence: 0 }]);
        if (pending.restore && !store.restoreConfiguration(pending.restore)) throw new Error("The previous mod configuration could not be restored.");
        if (pending.plan.modList && !store.applyModList(pending.plan.modList, store.configurationRevision(), pending.plan.effectiveEnabled)) throw new Error("The mod list could not be activated.");
        for (const [id, choices] of Object.entries(pending.permissions)) {
          const manifest = pending.plan.downloads.find((download) => download.mod.id === id)?.manifest ?? pending.plan.keptManifests?.find((entry) => entry.id === id) ?? manifestOf(await version(db, current.find((meta) => meta.id === id)!));
          if (!choices) continue;
          store.setDecisions(id, choices, manifest.version);
          const written = store.getDecisions(id);
          if (choices.granted.some((cap) => !written.granted.includes(cap)) || choices.refused.some((cap) => !written.refused.includes(cap)) || store.getConsentVersion(id) !== manifest.version) {
            throw new Error("The mod permissions could not be saved.");
          }
        }
        for (const id of pending.plan.enableIds ?? []) {
          store.setModEnabled(id, true);
          if (!store.isEnabled(id)) throw new Error("The mod enablement could not be saved.");
        }
        for (const id of pending.plan.removeIds ?? []) store.setModEnabled(id, false);
        const stale = (await idbKeys(db, STORE_MODS)).filter((key) => ids.has(key.split("/")[0]!));
        if (!await idbApply(db, [
          { store: STORE_MODS, del: stale, put: pending.payloads.flatMap((payload) => payload.files.map(([path, bytes]) => [`${payload.meta.id}/${path}`, bytes] as const)) },
          { store: STORE_MOD_META, del: [...pending.plan.removeIds ?? []], put: pending.payloads.map((payload) => [payload.meta.id, { format: installedModFormat.format, schemaVersion: installedModFormat.schemaVersion, data: payload.meta }] as const) },
          { store: STORE_MOD_VERSIONS, put: archive },
          { store: STORE_HANDLES, put: [[PENDING, document({ ...activating, phase: "committed" })]] },
        ])) throw new Error("The staged mod set could not be activated.");
        markInstallRevision(env.install.scope ?? globalThis);
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

async function previous(db: IDBDatabase, id: string, env: ModTransactionEnvironment): Promise<{ row: ArchivedVersion; meta: InstalledModMeta; version: Version } | null> {
  const current = await installedMeta(id, env.install.scope ?? globalThis);
  for (const meta of [...await archivedVersions(env.install.scope ?? globalThis)].reverse()) {
    if (meta.id !== id || current && versionKey(meta) === versionKey(current)) continue;
    const row = await readArchivedVersion(db, meta, env.install.subtle);
    return { row, meta, version: { meta: { ...meta, digests: meta.digests ?? row.digests ?? {} }, files: row.files } };
  }
  return null;
}

export async function previousModVersion(id: string, env: ModTransactionEnvironment): Promise<BrowseEntry | null> {
  return locked(env, async (db) => {
    const retained = await previous(db, id, env);
    if (!retained) return null;
    const cached = await archivedMod({ repo: retained.meta.repo, tag: `archive:${encodeURIComponent(versionKey(retained.meta))}` }, env.install.scope ?? globalThis);
    return cached ? { ok: true, ref: { repo: cached.mod.repo, tag: cached.mod.tag }, mod: cached.mod } : null;
  });
}

export async function stageModRollback(id: string, env: ModTransactionEnvironment): Promise<StageResult> {
  try {
    return await locked(env, async (db) => {
      if (transaction(await idbGet(db, STORE_HANDLES, PENDING))) throw new Error("A mod transaction is staged, applies on next start.");
      const retained = await previous(db, id, env);
      if (!retained) throw new Error("No previous version is available.");
      if (retained.version.meta.digests && !await verified(retained.version, env)) throw new Error("A previous mod file failed its digest check.");
      const current = await installedMeta(id, env.install.scope ?? globalThis);
      const bytes = retained.version.files.find(([path]) => path.toLowerCase() === "manifest.json")?.[1];
      if (!bytes) throw new Error("A previous mod manifest could not be read.");
      const manifest = validateManifest(JSON.parse(new TextDecoder().decode(bytes)));
      const store = env.configurationStore?.(retained.row.profileId ?? env.profileId ?? null) ?? env.store;
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
      const cached = await archivedMod({ repo: retained.meta.repo, tag: `archive:${encodeURIComponent(versionKey(retained.meta))}` }, env.install.scope ?? globalThis);
      if (!cached) throw new Error("A previous mod manifest could not be read.");
      const pending: Transaction = {
        id: globalThis.crypto.randomUUID(), installedSet, profileId: retained.row.profileId ?? env.profileId ?? null,
        plan: { id: 0, operation: "rollback", downloads: [{ manifest, mod: cached.mod, origin: "third-party", bytes: null, files: retained.meta.files }], newGrants: [], conflicts: [] },
        payloads: [retained.version], downloads: [], permissions: {},
        configuration: store.captureConfiguration([id], flags), ...(retained.row.configuration ? { restore: { ...retained.row.configuration, ids: [id], ruleFlags: flags } } : {}), phase: "ready",
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
    const deleted: string[] = [];
    const current = await installedMeta(id, env.install.scope ?? globalThis);
    for (const meta of await archivedVersions(env.install.scope ?? globalThis)) {
      if (meta.id !== id || current && versionKey(meta) === versionKey(current)) continue;
      if (await env.saveReferences?.(id, meta.tag)) continue;
      deleted.push(versionKey(meta));
    }
    return deleted.length === 0 || await idbApply(db, [{ store: STORE_MOD_VERSIONS, del: deleted }]);
  });
}
