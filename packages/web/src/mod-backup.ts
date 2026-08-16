/**
 * Ticket #133's cloud-backup folder: one `BackupFolder` implementation per
 * front end, plus the host-internal dispatch `persistSave` calls into after a
 * save lands. See docs/modding/CLOUD_BACKUP_DESIGN.md for the full design.
 *
 * TWO IMPLEMENTATIONS, NOT ONE, because the platform truth changed mid-design:
 * `showDirectoryPicker()` is confirmed broken in the Electron shell (verified
 * over CDP - the dialog opens, a folder can be chosen, and the promise then
 * never resolves), so desktop goes through `neoDesktop.backup(op, arg)`
 * instead (packages/desktop's native `dialog.showOpenDialog`). The browser tab
 * has no such bridge and keeps the File System Access path `mod-folder.ts`
 * already proved out for the (read-only) mods folder.
 */

import { STORE_HANDLES, idbDelete, idbGet, idbPut, openDb } from "./idb";
import type { BackupFolder } from "./mod-plugin";

/* ------------------------------------------------------------------ *
 * The desktop implementation: packages/desktop's BACKUP_CHANNEL, over the
 * preload bridge. The chosen folder's real path never reaches this module -
 * only a display name and {ok} booleans do, which is the main process's job
 * to guarantee (see bridge-channel.ts's BACKUP_CHANNEL doc comment).
 * ------------------------------------------------------------------ */

interface DesktopBackupBridge {
  backup(op: string, arg?: unknown): Promise<unknown>;
}

/**
 * Find the backup bridge, and do not confuse it with the host-fs bridge - the
 * same two-globals trap `updaterBridge` (update.ts) and `logBridge`
 * (logging.ts) already guard against. `neoHostFs` is z-file.c; `neoDesktop` is
 * "you are running under Electron, and here is what it can additionally do."
 */
export function backupBridge(scope: unknown = globalThis): DesktopBackupBridge | null {
  if (scope === null || typeof scope !== "object") return null;
  const desktop = (scope as Record<string, unknown>)["neoDesktop"];
  if (desktop === null || typeof desktop !== "object") return null;
  const backup = (desktop as Record<string, unknown>)["backup"];
  if (typeof backup !== "function") return null;
  return desktop as DesktopBackupBridge;
}

function desktopBackupFolder(id: string, scope: unknown): BackupFolder {
  return {
    async name(): Promise<string | null> {
      const bridge = backupBridge(scope);
      if (!bridge) return null;
      const r = await bridge.backup("name");
      return typeof r === "string" ? r : null;
    },
    async choose(): Promise<string | null> {
      const bridge = backupBridge(scope);
      if (!bridge) return null;
      const r = await bridge.backup("choose");
      return typeof r === "string" ? r : null;
    },
    async forget(): Promise<void> {
      const bridge = backupBridge(scope);
      if (bridge) await bridge.backup("forget");
    },
    async write(name: string, text: string): Promise<boolean> {
      const bridge = backupBridge(scope);
      if (!bridge) return false;
      const r = (await bridge.backup("write", { name, text })) as
        | { ok?: boolean }
        | undefined;
      return r?.ok === true;
    },
    onSave(fn) {
      setOnSave(id, fn);
    },
  };
}

/* ------------------------------------------------------------------ *
 * The browser-tab implementation: showDirectoryPicker({mode:"readwrite"}),
 * persisted in the SAME IndexedDB store mod-folder.ts uses for the (read-only)
 * mods-folder handle, under a `backup:<modId>` key rather than mod-folder.ts's
 * `modsDir` - one instance is capable of serving any number of consenting
 * mods, each with its own remembered handle.
 * ------------------------------------------------------------------ */

type PermState = "granted" | "denied" | "prompt";

interface FsWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface BackupDirHandle {
  readonly kind: "directory";
  readonly name: string;
  queryPermission?(desc: { mode: "readwrite" }): Promise<PermState>;
  requestPermission?(desc: { mode: "readwrite" }): Promise<PermState>;
  getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<{ createWritable(): Promise<FsWritable> }>;
}

interface PickerScope {
  showDirectoryPicker?(opts?: {
    id?: string;
    mode?: "readwrite";
  }): Promise<BackupDirHandle>;
  indexedDB?: IDBFactory;
}

function pickerScope(scope: unknown): PickerScope {
  return (scope ?? {}) as PickerScope;
}

/** A stored value is only a handle if it still behaves like one. */
function asBackupDirHandle(v: unknown): BackupDirHandle | null {
  if (v === null || typeof v !== "object") return null;
  const h = v as Partial<BackupDirHandle>;
  if (h.kind !== "directory" || typeof h.name !== "string") return null;
  if (typeof h.getFileHandle !== "function") return null;
  return v as BackupDirHandle;
}

/** Whether this engine can pick a directory at all - folderPickingSupported's own check. */
export function backupPickingSupported(scope: unknown = globalThis): boolean {
  return typeof pickerScope(scope).showDirectoryPicker === "function";
}

/**
 * The handle's readwrite permission. `request: true` may only be passed from a
 * user gesture - mirrors mod-folder.ts's `folderPermission`, but for
 * `"readwrite"` rather than `"read"`, since a backup with read-only access
 * could not do its one job.
 */
async function permission(
  handle: BackupDirHandle,
  opts: { request?: boolean } = {},
): Promise<PermState> {
  try {
    const query = handle.queryPermission?.bind(handle);
    const state = query ? await query({ mode: "readwrite" }) : "granted";
    if (state === "granted" || !opts.request) return state;
    const ask = handle.requestPermission?.bind(handle);
    return ask ? await ask({ mode: "readwrite" }) : "granted";
  } catch {
    return "prompt";
  }
}

function browserBackupFolder(id: string, scope: unknown): BackupFolder {
  const key = `backup:${id}`;

  async function saved(): Promise<BackupDirHandle | null> {
    const db = await openDb(scope);
    if (!db) return null;
    return asBackupDirHandle(await idbGet(db, STORE_HANDLES, key));
  }

  return {
    async name(): Promise<string | null> {
      const handle = await saved();
      return handle ? handle.name : null;
    },

    async choose(): Promise<string | null> {
      const pick = pickerScope(scope).showDirectoryPicker;
      if (typeof pick !== "function") return null;
      let handle: BackupDirHandle;
      try {
        handle = await pick.call(pickerScope(scope), {
          id: `neo-backup-${id}`,
          mode: "readwrite",
        });
      } catch {
        /* AbortError (cancelled) or SecurityError (gesture expired) - neither
         * is worth reporting, same rule mod-folder.ts's pickModFolder uses. */
        return null;
      }
      const db = await openDb(scope);
      if (db) await idbPut(db, STORE_HANDLES, key, handle);
      return handle.name;
    },

    async forget(): Promise<void> {
      const db = await openDb(scope);
      if (db) await idbDelete(db, STORE_HANDLES, key);
    },

    async write(name: string, text: string): Promise<boolean> {
      const handle = await saved();
      if (!handle) return false;
      if ((await permission(handle)) !== "granted") return false;
      try {
        const file = await handle.getFileHandle(name, { create: true });
        const w = await file.createWritable();
        await w.write(text);
        await w.close();
        return true;
      } catch {
        return false;
      }
    },

    onSave(fn) {
      setOnSave(id, fn);
    },
  };
}

/* ------------------------------------------------------------------ *
 * The per-mod onSave registry, and the dispatch persistSave calls after a
 * save lands. Shared across both implementations above (the desktop one
 * registers here too - see desktopBackupFolder.onSave) so persistSave has ONE
 * place to fire into regardless of which platform built the BackupFolder.
 * ------------------------------------------------------------------ */

const onSaveByMod = new Map<string, (f: { readonly name: string; readonly text: string }) => void>();

function setOnSave(
  id: string,
  fn: (f: { readonly name: string; readonly text: string }) => void,
): void {
  onSaveByMod.set(id, fn);
}

/**
 * Fire every registered mod's `onSave` callback with the same transfer file.
 *
 * `file` is a THUNK, not a value: persistSave calls this after EVERY
 * successful save (autosave included, every ~3 seconds during play), and
 * building the transfer file means encoding the whole save a second time.
 * With no mod enrolled - the common case, before any player installs a
 * backup mod - that cost must not be paid at all, so it is built only once
 * there is at least one callback to hand it to.
 *
 * FAULT-CONTAINED PER MOD: a throw from one mod's callback is reported once
 * by name and that mod's entry is removed (its backup stops for the rest of
 * the session); every other mod's callback still runs. Called from
 * `persistSave`, after `writeSlot`'s own `ok` - never allowed to affect
 * whether the save itself is reported successful.
 */
export function notifyBackupSinks(
  file: () => { readonly name: string; readonly text: string },
  report: (id: string, err: unknown) => void = () => {},
): void {
  if (onSaveByMod.size === 0) return;
  const built = file();
  for (const [id, fn] of [...onSaveByMod]) {
    try {
      fn(built);
    } catch (err) {
      onSaveByMod.delete(id);
      report(id, err);
    }
  }
}

/** Test-only: clear the registry between runs. */
export function clearBackupSinks(): void {
  onSaveByMod.clear();
}

/**
 * The backup file's name: lineage-stable, NOT level-suffixed like
 * `transferFilename`'s manual-export name. An automatic backup is overwritten
 * in place - every save replaces the same file - so it must be named from
 * something that does not change every level.
 */
export function backupFilename(name: string, lineage: string): string {
  const safe = name.replace(/[^\w.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return `${safe || "character"}-${lineage.slice(0, 8)}.neochar`;
}

/**
 * Build this mod's `BackupFolder`, or undefined when there is no platform
 * support at all (Firefox/Safari with no desktop bridge either). Capability
 * gating (does this mod's manifest declare `backup:folder`) is the CALLER's
 * job - mod-context.ts's `modPluginContext` - so this module stays a pure
 * platform-capability question.
 */
export function createBackupFolder(id: string, scope: unknown = globalThis): BackupFolder | undefined {
  if (backupBridge(scope)) return desktopBackupFolder(id, scope);
  if (backupPickingSupported(scope)) return browserBackupFolder(id, scope);
  return undefined;
}
