/**
 * A purpose-keyed, per-platform "player-chosen folder" primitive (#158).
 *
 * THIS LIFTS THE MECHANISM ticket #133's cloud backup proved out
 * (`mod-backup.ts`, `packages/desktop/src/backup-folder.ts`): on the browser
 * tab, `showDirectoryPicker({mode:"readwrite"})` with the returned handle
 * persisted in IndexedDB because a directory handle is a live object, not a
 * path that can go in `localStorage`; on the desktop shell, a native
 * `dialog.showOpenDialog` over `BACKUP_CHANNEL` instead, because
 * `showDirectoryPicker` is confirmed broken there (the dialog opens and the
 * underlying promise never resolves - see `docs/modding/CLOUD_BACKUP_DESIGN.md`).
 *
 * Browser handles remain purpose-keyed. Desktop profile sync obtains an
 * installation handle from the main process, which measures the host payload
 * and confirms backup authority natively. Other desktop purposes fail closed.
 */

import { STORE_HANDLES, idbDelete, idbGet, idbPut, openDb } from "./idb";
import { desktopHostInstallation, type DesktopConsentBridge } from "./host-electron";

/** One purpose's folder, however the platform actually stores it. */
export interface HostFolder {
  /** The remembered folder's display name, or null if none is chosen. Never prompts. */
  name(): Promise<string | null>;
  /** Ask the player to choose (or replace) the folder. MUST be called from a
   *  user gesture on the browser tab (showDirectoryPicker's own requirement).
   *  Null means the player cancelled, which is not an error. */
  choose(): Promise<string | null>;
  /** Forget the folder. `write` becomes a silent no-op until `choose` runs again. */
  forget(): Promise<void>;
  /** Write one file into the chosen folder, creating it if absent. Never
   *  throws; false if there is no folder, permission has lapsed, or the
   *  write failed. */
  write(name: string, text: string): Promise<boolean>;
  /** Every file matching this purpose's extension currently readable in the
   *  chosen folder, name plus full text. Never throws; empty when there is
   *  no folder, no permission, or nothing readable. */
  list(): Promise<readonly HostFolderEntry[]>;
}

export interface HostFolderEntry {
  readonly name: string;
  readonly text: string;
}

/* ------------------------------------------------------------------ *
 * The desktop implementation uses the same authority checks as mod backups.
 * ------------------------------------------------------------------ */

interface DesktopBackupBridge extends DesktopConsentBridge {
  backup(op: string, arg?: unknown): Promise<unknown>;
}

/**
 * The same two-globals guard `mod-backup.ts`'s own `backupBridge` already
 * uses, so a scope with neither bridge (a browser tab, or a test with no
 * `neoDesktop`) is told apart from one with a malformed bridge rather than
 * throwing.
 */
function desktopBridge(scope: unknown): DesktopBackupBridge | null {
  if (scope === null || typeof scope !== "object") return null;
  const desktop = (scope as Record<string, unknown>)["neoDesktop"];
  if (desktop === null || typeof desktop !== "object") return null;
  const backup = (desktop as Record<string, unknown>)["backup"];
  if (typeof backup !== "function") return null;
  return desktop as DesktopBackupBridge;
}

function desktopHostFolder(purpose: string, ext: string, scope: unknown): HostFolder {
  const bridge = desktopBridge(scope)!;
  const installation = desktopHostInstallation(purpose, bridge);
  const call = async (op: string, arg: Record<string, unknown> = {}): Promise<unknown> => {
    const authority = await installation();
    return authority ? bridge.backup(op, { ...authority, ext, ...arg }) : null;
  };
  return {
    async name(): Promise<string | null> {
      const bridge = desktopBridge(scope);
      if (!bridge) return null;
      const r = await call("name");
      return typeof r === "string" ? r : null;
    },
    async choose(): Promise<string | null> {
      const bridge = desktopBridge(scope);
      if (!bridge) return null;
      const r = await call("choose");
      return typeof r === "string" ? r : null;
    },
    async forget(): Promise<void> {
      const bridge = desktopBridge(scope);
      if (bridge) await call("forget");
    },
    async write(name: string, text: string): Promise<boolean> {
      const bridge = desktopBridge(scope);
      if (!bridge) return false;
      const r = (await call("write", { name, text })) as
        | { ok?: boolean }
        | undefined;
      return r?.ok === true;
    },
    async list(): Promise<readonly HostFolderEntry[]> {
      const bridge = desktopBridge(scope);
      if (!bridge) return [];
      const r = await call("list");
      if (!Array.isArray(r)) return [];
      const out: HostFolderEntry[] = [];
      for (const item of r) {
        if (item !== null && typeof item === "object") {
          const { name, size } = item as { name?: unknown; size?: unknown };
          if (typeof name !== "string" || typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) continue;
          const read = await call("read", { name }) as { name?: unknown; text?: unknown } | null;
          if (read?.name === name && typeof read.text === "string") out.push({ name, text: read.text });
        }
      }
      return out;
    },
  };
}

/* ------------------------------------------------------------------ *
 * The browser-tab implementation: showDirectoryPicker, one IndexedDB
 * handle per PURPOSE (`folder:<purpose>`, the same STORE_HANDLES store
 * mod-backup.ts and mod-folder.ts already share, under its own key
 * namespace so neither collides with the other's).
 * ------------------------------------------------------------------ */

type PermState = "granted" | "denied" | "prompt";

interface FsWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface HostFolderDirEntry {
  readonly kind: "file" | "directory";
  readonly name: string;
  getFile?(): Promise<{ text(): Promise<string> }>;
}

interface HostFolderDirHandle {
  readonly kind: "directory";
  readonly name: string;
  queryPermission?(desc: { mode: "readwrite" }): Promise<PermState>;
  requestPermission?(desc: { mode: "readwrite" }): Promise<PermState>;
  getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<{ createWritable(): Promise<FsWritable> }>;
  values?(): AsyncIterable<HostFolderDirEntry>;
}

interface PickerScope {
  showDirectoryPicker?(opts?: { id?: string; mode?: "readwrite" }): Promise<HostFolderDirHandle>;
  indexedDB?: IDBFactory;
}

function pickerScope(scope: unknown): PickerScope {
  return (scope ?? {}) as PickerScope;
}

function asHostFolderDirHandle(v: unknown): HostFolderDirHandle | null {
  if (v === null || typeof v !== "object") return null;
  const h = v as Partial<HostFolderDirHandle>;
  if (h.kind !== "directory" || typeof h.name !== "string") return null;
  if (typeof h.getFileHandle !== "function") return null;
  return v as HostFolderDirHandle;
}

/** Whether this engine can pick a directory at all. */
export function hostFolderPickingSupported(scope: unknown = globalThis): boolean {
  return typeof pickerScope(scope).showDirectoryPicker === "function";
}

async function permission(
  handle: HostFolderDirHandle,
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

function handleKey(purpose: string): string {
  return `folder:${purpose}`;
}

async function savedHandle(purpose: string, scope: unknown): Promise<HostFolderDirHandle | null> {
  const db = await openDb(scope);
  if (!db) return null;
  return asHostFolderDirHandle(await idbGet(db, STORE_HANDLES, handleKey(purpose)));
}

function browserHostFolder(purpose: string, ext: string, scope: unknown): HostFolder {
  const looksLikeMatch = (name: string): boolean => name.endsWith(ext) && !name.startsWith(".");

  return {
    async name(): Promise<string | null> {
      const handle = await savedHandle(purpose, scope);
      return handle ? handle.name : null;
    },

    async choose(): Promise<string | null> {
      const pick = pickerScope(scope).showDirectoryPicker;
      if (typeof pick !== "function") return null;
      let handle: HostFolderDirHandle;
      try {
        handle = await pick.call(pickerScope(scope), {
          id: `neo-host-folder-${purpose}`,
          mode: "readwrite",
        });
      } catch {
        /* AbortError (cancelled) or SecurityError (gesture expired) - neither
         * is worth reporting, same rule mod-folder.ts's pickModFolder uses. */
        return null;
      }
      const db = await openDb(scope);
      if (db) await idbPut(db, STORE_HANDLES, handleKey(purpose), handle);
      return handle.name;
    },

    async forget(): Promise<void> {
      const db = await openDb(scope);
      if (db) await idbDelete(db, STORE_HANDLES, handleKey(purpose));
    },

    async write(name: string, text: string): Promise<boolean> {
      const handle = await savedHandle(purpose, scope);
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

    async list(): Promise<readonly HostFolderEntry[]> {
      const handle = await savedHandle(purpose, scope);
      if (!handle) return [];
      if ((await permission(handle)) !== "granted") return [];
      const iterate = handle.values?.bind(handle);
      if (!iterate) return [];
      const out: HostFolderEntry[] = [];
      try {
        for await (const entry of iterate()) {
          if (!looksLikeMatch(entry.name) || entry.kind !== "file" || !entry.getFile) continue;
          try {
            const file = await entry.getFile();
            out.push({ name: entry.name, text: await file.text() });
          } catch {
            /* One unreadable file does not fail the rest of the listing. */
          }
        }
      } catch {
        return []; // the iterator itself failed: report an empty folder, not a crash
      }
      return out;
    },
  };
}

/**
 * Build a purpose's `HostFolder`, or undefined when there is no platform
 * support at all (Firefox/Safari with no desktop bridge either). Two calls
 * with the SAME `purpose` on the SAME platform read and write the SAME
 * remembered browser folder. Desktop profile sync uses its own installation
 * allocation after native consent.
 */
export function createHostFolder(
  purpose: string,
  ext: string,
  scope: unknown = globalThis,
): HostFolder | undefined {
  if (desktopBridge(scope)) return desktopHostFolder(purpose, ext, scope);
  if (hostFolderPickingSupported(scope)) return browserHostFolder(purpose, ext, scope);
  return undefined;
}
