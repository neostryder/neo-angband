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

import { BACKUP_LIMITS, isHostFolderFileName } from "@rpgm-tools/neo-angband-mod-sdk/backup-policy";
import { STORE_HANDLES, idbDelete, idbGet, idbPut, openDb } from "./idb";
import type { BackupFolder, BackupFolderEntry } from "./mod-plugin";
import { MAX_TRANSFER_TEXT_BYTES, peekTransferMeta, type TransferPeek } from "./save-transfer";
import { desktopInstallation, type DesktopConsentBridge } from "./host-electron";

/* ------------------------------------------------------------------ *
 * The desktop implementation: packages/desktop's BACKUP_CHANNEL, over the
 * preload bridge. The chosen folder's real path never reaches this module -
 * only a display name and {ok} booleans do, which is the main process's job
 * to guarantee (see bridge-channel.ts's BACKUP_CHANNEL doc comment).
 * ------------------------------------------------------------------ */

interface DesktopBackupBridge extends DesktopConsentBridge {
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
  const call = async (op: string, arg: Record<string, unknown> = {}): Promise<unknown> => {
    const bridge = backupBridge(scope);
    if (!bridge) return null;
    const installation = await desktopInstallation(id, bridge, [], op === "name");
    return installation ? bridge.backup(op, { ...installation, ...arg }) : null;
  };
  return {
    async name(): Promise<string | null> {
      const bridge = backupBridge(scope);
      if (!bridge) return null;
      const r = await call("name");
      return typeof r === "string" ? r : null;
    },
    async choose(): Promise<string | null> {
      const bridge = backupBridge(scope);
      if (!bridge) return null;
      const r = await call("choose");
      return typeof r === "string" ? r : null;
    },
    async forget(): Promise<void> {
      const bridge = backupBridge(scope);
      if (bridge) await call("forget");
    },
    async write(name: string, text: string): Promise<boolean> {
      const bridge = backupBridge(scope);
      if (!bridge) return false;
      const r = (await call("write", { name, text })) as
        | { ok?: boolean }
        | undefined;
      return r?.ok === true;
    },
    onSave(fn) {
      setOnSave(id, fn);
    },
    async list(): Promise<readonly BackupFolderEntry[]> {
      return (await readBackupFiles(id, scope)).map(toEntry);
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
  abort?(): Promise<void>;
}

/**
 * One entry a directory handle's own async iteration hands back - the same
 * shape mod-folder.ts's `FsDirHandle.values()` already yields, so a fake
 * folder built for one reads for the other.
 */
interface BackupDirEntry {
  readonly kind: "file" | "directory";
  readonly name: string;
  getFile?(): Promise<{ readonly size?: number; text(): Promise<string> }>;
}

interface BackupDirHandle {
  readonly kind: "directory";
  readonly name: string;
  queryPermission?(desc: { mode: "readwrite" }): Promise<PermState>;
  requestPermission?(desc: { mode: "readwrite" }): Promise<PermState>;
  getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<BrowserBackupFileHandle>;
  /**
   * The File System Access directory's own async-iterable listing of its
   * entries, each already carrying its own name. Optional in this interface
   * only because a test fixture may not need it - every real
   * `FileSystemDirectoryHandle` has it.
   */
  values?(): AsyncIterable<BackupDirEntry>;
}

interface PickerScope {
  showDirectoryPicker?(opts?: {
    id?: string;
    mode?: "readwrite";
  }): Promise<BackupDirHandle>;
  indexedDB?: IDBFactory;
  confirm?(message: string): boolean;
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

/** The saved directory handle for this mod, or null if none is chosen / unreadable. */
async function savedHandle(id: string, scope: unknown): Promise<BackupDirHandle | null> {
  const db = await openDb(scope);
  if (!db) return null;
  return asBackupDirHandle(await idbGet(db, STORE_HANDLES, `backup:${id}`));
}

/**
 * Every `.neochar` file the browser tab's directory handle can currently see,
 * name plus full text - read-only, no permission REQUEST (no user gesture is
 * available at a checkpoint like boot), so a lapsed grant reads as "nothing
 * here" rather than reprompting the player unasked.
 */
async function browserBackupFiles(id: string, scope: unknown, requireReadable = false): Promise<RawBackupFile[]> {
  const handle = await savedHandle(id, scope);
  if (!handle) {
    if (requireReadable) throw new Error("The backup folder could not be read.");
    return [];
  }
  return listBrowserBackupFiles(handle, ".neochar", requireReadable, MAX_TRANSFER_TEXT_BYTES);
}

/** Metadata ceilings bound reads before a File is decoded into text. */
export async function listBrowserBackupFiles(handle: BackupDirHandle, ext: string, requireReadable = false, fileLimit: number = BACKUP_LIMITS.fileBytes): Promise<RawBackupFile[]> {
  const files: RawBackupFile[] = [];
  let total = 0;
  try {
    if (await permission(handle) !== "granted" || !handle.values) throw new Error("The backup folder could not be read.");
    for await (const entry of handle.values()) {
      if (!isHostFolderFileName(entry.name, ext) || entry.kind !== "file") continue;
      if (files.length >= BACKUP_LIMITS.files) {
        if (requireReadable) throw new Error("The backup folder could not be read.");
        break;
      }
      try {
        if (!entry.getFile) throw new Error("The backup folder could not be read.");
        const file = await entry.getFile();
        const size = file.size;
        /* The boot character scan passes the 5 MiB import limit, which is below
         * the facade's general per-file ceiling (#473). */
        const limit = Math.min(fileLimit, BACKUP_LIMITS.fileBytes);
        const tooLarge = typeof size === "number" && Number.isSafeInteger(size) && size > limit;
        if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || tooLarge || total + size > BACKUP_LIMITS.totalBytes) {
          if (requireReadable) throw new Error(tooLarge && limit === MAX_TRANSFER_TEXT_BYTES ? "The file is larger than the 5 MiB limit." : "The backup folder could not be read.");
          continue;
        }
        const text = await file.text();
        const bytes = new TextEncoder().encode(text).length;
        if (bytes > limit || total + Math.max(bytes, size) > BACKUP_LIMITS.totalBytes) {
          if (requireReadable) throw new Error("The backup folder could not be read.");
          continue;
        }
        files.push({ name: entry.name, text });
        total += Math.max(bytes, size);
      } catch (error) {
        if (requireReadable) throw error;
        /* One unreadable file cannot prevent the remaining backups from loading. */
      }
    }
  } catch (error) {
    if (requireReadable) throw error;
    return [];
  }
  return files;
}

interface BrowserBackupFileHandle {
  getFile?(): Promise<{ readonly size?: number; text(): Promise<string> }>;
  isSameEntry?(other: BrowserBackupFileHandle): Promise<boolean>;
  createWritable(): Promise<FsWritable>;
}

let browserWrites: Promise<unknown> = Promise.resolve();

/** Serialization keeps simultaneous facade calls within one folder budget. */
export function writeBrowserBackupFile(handle: BackupDirHandle, name: string, text: string, ext: string, scope: unknown): Promise<boolean> {
  const write = async (): Promise<boolean> => {
    if (!isHostFolderFileName(name, ext) || typeof text !== "string" || text.length > BACKUP_LIMITS.fileBytes) return false;
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > BACKUP_LIMITS.fileBytes) return false;
    try {
      if (await permission(handle) !== "granted" || !handle.values) return false;
      const find = async (): Promise<BrowserBackupFileHandle | null> => {
        try { return await handle.getFileHandle(name); }
        catch (error) {
          if ((error as { name?: string }).name === "NotFoundError") return null;
          throw error;
        }
      };
      const initial = await find();
      if (initial) {
        const host = pickerScope(scope);
        if (typeof host.confirm !== "function" || host.confirm("Replace the backup " + name + " in " + handle.name + "? The older backup in that file is overwritten.") !== true) return false;
      }
      if (await permission(handle) !== "granted") return false;
      const existing = await find();
      if (initial ? !existing || !initial.isSameEntry || !await initial.isSameEntry(existing) : existing !== null) return false;
      let count = 0;
      let total = bytes;
      for await (const entry of handle.values()) {
        if (!isHostFolderFileName(entry.name, ext) || entry.kind !== "file") continue;
        if (!entry.getFile) return false;
        const file = await entry.getFile();
        const size = file.size;
        if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return false;
        count++;
        if (entry.name !== name) total += size;
        if (count + (existing ? 0 : 1) > BACKUP_LIMITS.files || total > BACKUP_LIMITS.totalBytes) return false;
      }
      if (await permission(handle) !== "granted") return false;
      const current = await find();
      if (existing ? !current || !existing.isSameEntry || !await existing.isSameEntry(current) : current !== null) return false;
      const file = current ?? await handle.getFileHandle(name, { create: true });
      const w = await file.createWritable();
      try {
        await w.write(text);
        await w.close();
        return true;
      } catch {
        await w.abort?.().catch(() => undefined);
        return false;
      }
    } catch {
      return false;
    }
  };
  const locks = (scope as { navigator?: { locks?: { request<T>(name: string, action: () => Promise<T>): Promise<T> } } } | null)?.navigator?.locks;
  const pending = browserWrites.then(() => locks ? locks.request("neo-backup-folder-write", write) : write()).catch(() => false);
  browserWrites = pending;
  return pending;
}

function browserBackupFolder(id: string, scope: unknown): BackupFolder {
  return {
    async name(): Promise<string | null> {
      const handle = await savedHandle(id, scope);
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
      if (db) await idbPut(db, STORE_HANDLES, `backup:${id}`, handle);
      return handle.name;
    },

    async forget(): Promise<void> {
      const db = await openDb(scope);
      if (db) await idbDelete(db, STORE_HANDLES, `backup:${id}`);
    },

    async write(name: string, text: string): Promise<boolean> {
      const handle = await savedHandle(id, scope);
      if (!handle) return false;
      return writeBrowserBackupFile(handle, name, text, ".neochar", scope);
    },

    onSave(fn) {
      setOnSave(id, fn);
    },

    async list(): Promise<readonly BackupFolderEntry[]> {
      return (await readBackupFiles(id, scope)).map(toEntry);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Ticket #24: listing what is already in the folder, shared by both
 * platforms. `BackupFolder.list()` on each implementation above is a thin
 * wrapper over `readBackupFiles` below, trimmed down to `BackupFolderEntry`;
 * the host's own "offer what is in the folder" checkpoint calls
 * `readBackupFiles` directly, since it needs the full text to hand a chosen
 * candidate to the existing import path without reading the file twice.
 * ------------------------------------------------------------------ */

/** Name + full text, before any peek at what is inside. */
interface RawBackupFile {
  readonly name: string;
  readonly text: string;
}

/** One file `readBackupFiles` read, with a cheap peek at its header already done. */
export interface BackupFileRead {
  readonly name: string;
  readonly text: string;
  readonly peek: TransferPeek;
}

/**
 * Listing exposes names and sizes. Legacy metadata and import callers need a
 * separate native confirmation before the main process releases each file.
 */
async function desktopBackupFiles(id: string, scope: unknown, requireReadable = false, quiet = false): Promise<RawBackupFile[]> {
  const bridge = backupBridge(scope);
  if (!bridge) return [];
  const installation = await desktopInstallation(id, bridge, [], quiet);
  if (!installation) {
    if (requireReadable) throw new Error("The backup folder is not authorized.");
    return [];
  }
  const r = await bridge.backup("list", installation);
  if (!Array.isArray(r)) {
    if (requireReadable) throw new Error("The backup folder could not be read.");
    return [];
  }
  const out: RawBackupFile[] = [];
  for (const item of r) {
    if (item !== null && typeof item === "object") {
      const { name, size } = item as { name?: unknown; size?: unknown };
      if (typeof name !== "string" || typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) continue;
      // File reads need their own native consent, so boot only queries authorization.
      if (quiet) continue;
      const read = await bridge.backup("read", { ...installation, name }) as { name?: unknown; text?: unknown } | null;
      if (read?.name === name && typeof read.text === "string") out.push({ name, text: read.text });
      else if (requireReadable) throw new Error("The backup file could not be read.");
    }
  }
  return out;
}

/** `BackupFileRead` trimmed to the mod-facing shape - see `BackupFolderEntry`'s own doc comment. */
function toEntry(f: BackupFileRead): BackupFolderEntry {
  return {
    name: f.name,
    ...(f.peek.ok && f.peek.lineage !== undefined ? { lineage: f.peek.lineage } : {}),
    characterName: f.peek.ok ? f.peek.meta.name : "",
    level: f.peek.ok ? f.peek.meta.level : 0,
  };
}

/**
 * Every `.neochar` file readable in this mod's chosen backup folder right
 * now, with a cheap header peek at each (never a full decode, never an
 * import) - host-internal, one level more detailed than `BackupFolder.list()`
 * because the host's own checkpoint needs the full text and `list()`'s mod
 * consumers do not. Never throws; empty when there is no folder, no
 * permission, or nothing readable.
 */
export async function readBackupFiles(
  id: string,
  scope: unknown = globalThis,
  requireReadable = false,
  quiet = false,
): Promise<readonly BackupFileRead[]> {
  const raw = backupBridge(scope)
    ? await desktopBackupFiles(id, scope, requireReadable, quiet)
    : await browserBackupFiles(id, scope, requireReadable);
  return raw.map(({ name, text }) => ({ name, text, peek: peekTransferMeta(text) }));
}

/**
 * Which of `files` are worth OFFERING: readable, carrying a lineage, and that
 * lineage is neither already in this roster nor already recorded as dead here.
 *
 * Pure and host-agnostic - the "offer what is in the folder" checkpoint's own
 * "who do I even ask about" decision, factored out so it is testable without
 * booting main.ts (which cannot be imported in a test - it boots a game on
 * import) and without a real folder of any kind.
 *
 * A file whose peek failed (unparsable, wrong magic, too large to peek at) is
 * left out: there is nothing to offer for a file this build could not even
 * identify. A lineage that appears twice - two mods pointed at the same
 * folder, say - is reported once, in the order `files` gave it.
 */
export function newBackupArrivals(
  files: readonly BackupFileRead[],
  knownLineages: ReadonlySet<string>,
  deadLineages: ReadonlySet<string>,
): BackupFileRead[] {
  const seen = new Set<string>();
  const out: BackupFileRead[] = [];
  for (const file of files) {
    if (!file.peek.ok || file.peek.lineage === undefined) continue;
    const lineage = file.peek.lineage;
    if (knownLineages.has(lineage) || deadLineages.has(lineage) || seen.has(lineage)) continue;
    seen.add(lineage);
    out.push(file);
  }
  return out;
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

export function removeBackupSink(id: string): void {
  onSaveByMod.delete(id);
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
