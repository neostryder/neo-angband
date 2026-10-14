import { githubRepo, modListValidator, modListsFormat, parseDocument, serializeDocument, sortModOrder, type SaveModList } from "@rpgm-tools/neo-angband-mod-sdk";
import type { InstalledModMeta } from "../mod-install";
import type { CatalogMod, ModStore, StorageLike } from "../mod-store";
import { decodeSavedGame } from "@rpgm-tools/neo-angband-core";
import { STORE_HANDLES, idbKeys, openDb } from "../idb";
import { backupBridge, readBackupFiles } from "../mod-backup";
import { listOrphanedSaves } from "../orphan-saves";
import { decodeTransfer } from "../save-transfer";
import { SAVE_CODECS } from "../save-codec";
import type { ScopedStorage } from "../profile-scope";

export const MOD_LISTS_STORAGE_KEY = "neo-angband:mod-lists";

export async function savedModReferences(id: string, tag: string | undefined, storage: ScopedStorage | null, scope: unknown = globalThis): Promise<boolean> {
  const references = (text: string): boolean => {
    const save = decodeSavedGame(Uint8Array.from(atob(text), (char) => char.charCodeAt(0)), undefined, SAVE_CODECS).save;
    if (!save) return true;
    return save.modList?.mods.some((mod) => mod.id === id && (tag === undefined || mod.tag === null || mod.tag === tag || mod.commit === tag)) ?? false;
  };
  try {
    if (!storage) return true;
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key || !(key === "neo-angband-save" || key.startsWith("neo-angband-save:") || key.includes(":neo-angband-save:"))) continue;
      const stored = storage.getItem(key);
      if (stored && references(stored)) return true;
    }
    if (listOrphanedSaves(storage).some((orphan) => references(orphan.save))) return true;
    const db = await openDb(scope);
    if (!db) return true;
    let folders: string[];
    try { folders = backupBridge(scope) ? [""] : (await idbKeys(db, STORE_HANDLES)).filter((key) => key.startsWith("backup:")).map((key) => key.slice(7)); }
    finally { db.close?.(); }
    for (const folder of folders) {
      for (const file of await readBackupFiles(folder, scope, true)) {
        const transfer = decodeTransfer(file.text);
        if (!transfer.ok || references(transfer.file.save)) return true;
      }
    }
    return false;
  } catch {
    // An unreadable save or backup cannot prove that a retained version is unused.
    return true;
  }
}

export function captureModList(name: string, store: ModStore, catalog: readonly CatalogMod[], metadata: readonly InstalledModMeta[]): SaveModList {
  const enabled = catalog.filter((m) => m.enabled && !m.missing && !m.session);
  const order = sortModOrder(enabled.map((mod) => mod.manifest), { pins: store.getPins(), current: store.getEnabled() }).order;
  return {
    name, resolvedOrder: order, orderPins: store.getPins().map((pin) => ({ id: pin.id, ...(pin.before ? { before: [...pin.before] } : {}), ...(pin.after ? { after: [...pin.after] } : {}) })), conflictOverrides: store.getConflictOverrides(), ruleChoices: store.getRuleChoices(),
    mods: order.map((id) => {
      const mod = enabled.find((m) => m.id === id)!;
      const meta = metadata.find((m) => m.id === id);
      return { id, name: mod.name, version: mod.version, repository: meta?.repo ?? (mod.manifest.repository ? githubRepo(mod.manifest.repository) : null), tag: meta?.tag ?? null,
        commit: meta?.sha ?? null, payloadDigest: meta?.digests ? { ...meta.digests } : null,
        api: mod.manifest.api ?? "*", settings: store.getSettingValues()[id] ?? {}, sections: store.getSectionChoices()[id] ?? {} };
    }),
  };
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
}

export function sameModList(a: SaveModList, b: SaveModList): boolean {
  return canonical({ ...a, name: "" }) === canonical({ ...b, name: "" });
}

export function sameModSet(a: SaveModList, b: SaveModList): boolean {
  const identity = (list: SaveModList): unknown => ({ order: list.resolvedOrder, mods: list.mods.filter((m) => list.resolvedOrder.includes(m.id)).map(({ id, version, repository, commit, payloadDigest }) => ({ id, version, repository, commit, payloadDigest })) });
  return canonical(identity(a)) === canonical(identity(b));
}

export function matchesSavedVersion(saved: SaveModList["mods"][number], manifest: (Pick<CatalogMod, "id" | "version"> & { readonly manifest?: { readonly repository?: string } }) | undefined, meta: InstalledModMeta | undefined): boolean {
  const repository = meta?.repo ?? (manifest?.manifest?.repository ? githubRepo(manifest.manifest.repository) : null);
  return manifest?.id === saved.id && manifest.version === saved.version &&
    (saved.repository === null || saved.repository === repository) &&
    (saved.commit === null || saved.commit === meta?.sha) &&
    (saved.payloadDigest === null || canonical(saved.payloadDigest) === canonical(meta?.digests));
}

export function retainMissingModList(current: SaveModList, saved: SaveModList | undefined): SaveModList {
  if (!saved) return current;
  const missing = saved.mods.filter((mod) => !current.mods.some((m) => m.id === mod.id));
  const order = [...current.resolvedOrder];
  for (const id of saved.resolvedOrder) if (missing.some((m) => m.id === id)) order.splice(Math.min(saved.resolvedOrder.indexOf(id), order.length), 0, id);
  return { ...current, mods: [...current.mods, ...missing], resolvedOrder: order,
    orderPins: [...current.orderPins, ...saved.orderPins.filter((pin) => missing.some((m) => m.id === pin.id))],
    conflictOverrides: { ...Object.fromEntries(Object.entries(saved.conflictOverrides).filter(([, winner]) => missing.some((m) => m.id === winner))), ...current.conflictOverrides },
    ruleChoices: { ...saved.ruleChoices, ...current.ruleChoices } };
}

export class ModListStore {
  constructor(private readonly storage: StorageLike | null) {}
  list(): Record<string, SaveModList> {
    const raw = this.storage?.getItem(MOD_LISTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = parseDocument(raw, modListsFormat);
    return parsed.ok ? parsed.data.lists : {};
  }
  save(list: SaveModList): void {
    const valid = modListValidator.validate(list);
    if (!valid.ok) throw new Error("The mod list is invalid.");
    this.storage?.setItem(MOD_LISTS_STORAGE_KEY, serializeDocument(modListsFormat, { lists: { ...this.list(), [list.name]: list } }, { compact: true }));
  }
}

export class ModSaveGuard {
  #revision: string;
  #installationRevision: string | null;
  constructor(private readonly store: ModStore) { this.#revision = store.saveRevision(); this.#installationRevision = store.installationRevision(); }
  current(): boolean { return this.#revision === this.store.saveRevision() && this.#installationRevision === this.store.installationRevision(); }
  acknowledge(): void { this.#revision = this.store.saveRevision(); this.#installationRevision = this.store.installationRevision(); }
  canOverwrite(saved: SaveModList | undefined, current: SaveModList, approved: boolean): boolean {
    return this.current() && (approved || saved === undefined || sameModSet(saved, current));
  }
}
