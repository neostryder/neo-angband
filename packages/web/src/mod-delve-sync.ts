/**
 * Syncing a mod profile across machines/platforms via a player-chosen folder
 * (#158): the revision/origin-device envelope around a Part 1 Delve, and the
 * pure decisions the write checkpoint and the arrival banner both need.
 *
 * BUILDS ON #87's `.ndelve` FORMAT RATHER THAN INVENTING A SECOND ONE. The
 * file this module writes IS a Delve - `decodeDelve` (mod-delve.ts) reads it
 * with no changes, and the existing Load-a-Delve wizard is exactly how a
 * player REVIEWS an arrival (no new wizard, per the design). `revision` and
 * `originDevice` travel as two extra top-level fields on the same JSON
 * object: unknown fields are already ignored by `decodeDelve`'s per-field
 * reads, so this envelope costs the base format nothing and a plain Delve
 * (no sync fields) is read by this module as revision-less - never present
 * as an "arrival" at all, since there is no revision to compare.
 *
 * THE FOLDER ITSELF IS `host-folder.ts`'s, under its own purpose
 * (`DELVE_SYNC_PURPOSE`) - independent of the character-backup folder and of
 * any mod, per #158's own scope.
 */

import { buildDelveFile, decodeDelve, type DelveFile, type DelveMod } from "./mod-delve";
import type { HostFolder } from "./host-folder";

/** This purpose's `host-folder.ts` key and file. One file per folder: a
 * Delve is a snapshot of the WHOLE mod set, not a per-mod record. */
export const DELVE_SYNC_PURPOSE = "mod-profile-sync";
export const DELVE_SYNC_EXT = ".ndelve";
export const DELVE_SYNC_FILENAME = `mod-profile${DELVE_SYNC_EXT}`;

/** The sync-only envelope fields, alongside a Delve's own top-level ones. */
export interface DelveSyncMeta {
  /** Monotonic: strictly greater than every revision written before it, from
   * either device - never reset, never reused. */
  readonly revision: number;
  /** A label for the device/install that wrote this revision, shown on the
   * arrival banner ("newer set from <label>"). Not a stable identifier
   * anything else keys off; purely for a player to read. */
  readonly originDevice: string;
  /**
   * True when the WRITING install's enabled set is not authoritative in its
   * own `ModStore` (a desktop folder under active Vortex/MO2 management -
   * see `docs/MODS.md`'s "external manager... deploys into it"). The mods
   * list still travels, so a receiving device can see what was running
   * there, but auto-apply must never be offered for it: there is nothing
   * this build can confirm locally matches what the managed folder actually
   * loaded, only what `ModStore` happened to have recorded.
   */
  readonly enabledSetInformational: boolean;
}

export interface DelveSyncFile {
  readonly file: DelveFile;
  readonly meta: DelveSyncMeta;
}

/** Serialise a Delve plus its sync envelope. Still a plain Delve to any other reader. */
export function encodeDelveSync(file: DelveFile, meta: DelveSyncMeta): string {
  return `${JSON.stringify({ ...file, ...meta }, null, 2)}\n`;
}

/**
 * Read a synced file back: the Delve itself (via the unmodified `decodeDelve`
 * gate - wrong magic or unparseable is refused exactly as any other Delve
 * is), plus the sync envelope. `meta` is null when the envelope fields are
 * missing or malformed - a plain Delve a player dropped into the same
 * folder by hand, say - which the caller reads as "nothing to compare a
 * revision against", never as a decode failure.
 */
export function decodeDelveSync(text: string): { file: DelveFile; meta: DelveSyncMeta | null } | null {
  const decoded = decodeDelve(text);
  if (!decoded.ok) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { file: decoded.file, meta: null };
  }
  if (raw === null || typeof raw !== "object") return { file: decoded.file, meta: null };
  const o = raw as Record<string, unknown>;
  const revision = o["revision"];
  const originDevice = o["originDevice"];
  const informational = o["enabledSetInformational"];
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0) {
    return { file: decoded.file, meta: null };
  }
  if (typeof originDevice !== "string" || originDevice === "") {
    return { file: decoded.file, meta: null };
  }
  return {
    file: decoded.file,
    meta: { revision, originDevice, enabledSetInformational: informational === true },
  };
}

/** The next revision to write, given the current file's (if any). Never repeats, never resets. */
export function nextDelveSyncRevision(current: number | null): number {
  return (current ?? 0) + 1;
}

/**
 * WHETHER THIS INSTALL'S ENABLED SET IS AUTHORITATIVE in its own `ModStore` -
 * false exactly when the EFFECTIVE enabled set (what actually composed and
 * loaded, `resolveEnabledIds`'s own result) contains an id `ModStore.getEnabled()`
 * itself does not: a mod that arrived by disk deployment (an external
 * manager's `load-order.json`, `docs/MODS.md`) with no explicit player choice
 * recorded for it. `ModStore` is the source `saveDelveCandidates` (mods.ts)
 * reads from, so when this is false, that read is missing exactly the mods a
 * managed folder is running.
 */
export function delveSyncEnabledIsAuthoritative(
  storedEnabled: readonly string[],
  effectiveEnabled: readonly string[],
): boolean {
  const stored = new Set(storedEnabled);
  return effectiveEnabled.every((id) => stored.has(id));
}

/**
 * Build this write's sync envelope. `currentText` is the folder's existing
 * file's text, if any (read once by the caller, so this stays a pure
 * function rather than reaching for the folder itself).
 */
export function buildDelveSyncMeta(opts: {
  readonly currentText: string | null;
  readonly originDevice: string;
  readonly enabledSetInformational: boolean;
}): DelveSyncMeta {
  const current = opts.currentText === null ? null : decodeDelveSync(opts.currentText);
  const revision = nextDelveSyncRevision(current?.meta?.revision ?? null);
  return {
    revision,
    originDevice: opts.originDevice,
    enabledSetInformational: opts.enabledSetInformational,
  };
}

/**
 * Write a mod-profile snapshot to `folder`, computing the next revision from
 * whatever is already there. Called on the "Apply changes and reload"
 * checkpoint (mods.ts), never per-toggle - the caller decides when, this
 * only decides what the bytes are. Never throws; resolves false exactly when
 * `HostFolder.write` itself does (no folder chosen, permission lapsed, disk
 * full).
 */
export async function writeDelveSync(
  folder: HostFolder,
  file: DelveFile,
  opts: { readonly originDevice: string; readonly enabledSetInformational: boolean },
): Promise<{ readonly ok: boolean; readonly revision: number }> {
  const existing = await folder.list();
  const currentText = existing.find((e) => e.name === DELVE_SYNC_FILENAME)?.text ?? null;
  const meta = buildDelveSyncMeta({
    currentText,
    originDevice: opts.originDevice,
    enabledSetInformational: opts.enabledSetInformational,
  });
  const ok = await folder.write(DELVE_SYNC_FILENAME, encodeDelveSync(file, meta));
  return { ok, revision: meta.revision };
}

export type DelveSyncArrivalState =
  | { readonly kind: "none" }
  | { readonly kind: "not-newer" }
  | { readonly kind: "newer"; readonly file: DelveFile; readonly meta: DelveSyncMeta };

/**
 * What a remembered folder's synced file says relative to the last revision
 * this device has seen - the boot/Mods-menu-open checkpoint's whole
 * decision, as a pure function of what was read. `lastSeenRevision` is
 * null the first time this device ever checks (nothing seen yet, so any
 * real revision counts as newer).
 */
export function classifyDelveSyncArrival(
  found: { readonly name: string; readonly text: string } | undefined,
  lastSeenRevision: number | null,
): DelveSyncArrivalState {
  if (!found) return { kind: "none" };
  const read = decodeDelveSync(found.text);
  if (!read || read.meta === null) return { kind: "none" }; // unreadable, or no envelope to compare
  if (lastSeenRevision !== null && read.meta.revision <= lastSeenRevision) {
    return { kind: "not-newer" };
  }
  return { kind: "newer", file: read.file, meta: read.meta };
}

/**
 * Whether the arrival banner may offer "Apply" outright, versus routing to
 * "Review..." (the existing Load-a-Delve preview screen, mods.ts - no new
 * wizard). Two independent reasons this is false: the file's OWN enabled set
 * is informational (a Vortex/MO2-managed writer), or a named, ENABLED mod is
 * not installed here at exactly the tag the file names - either one means a
 * decision (a fetch, a version choice, a merge choice) the player has to
 * make, which "Apply" from a banner must never make silently.
 */
export function delveSyncCanAutoApply(
  file: DelveFile,
  meta: DelveSyncMeta,
  installed: ReadonlyMap<string, string>,
): boolean {
  if (meta.enabledSetInformational) return false;
  return file.mods.every((m: DelveMod) => !m.enabled || installed.get(m.id) === m.tag);
}

/* ------------------------------------------------------------------ *
 * The device label, and the "what has this device already seen" mark -
 * both small, local, per-device records that have nothing to do with the
 * synced folder itself and so are kept in `localStorage`, the same way
 * every other per-device UI preference in this codebase is.
 * ------------------------------------------------------------------ */

const DEVICE_LABEL_KEY = "neo-delve-sync-device";
const LAST_SEEN_KEY = "neo-delve-sync-last-seen";

function localStorageOf(scope: unknown): Storage | null {
  if (scope === null || typeof scope !== "object") return null;
  const storage = (scope as { localStorage?: unknown }).localStorage;
  return storage && typeof storage === "object" ? (storage as Storage) : null;
}

/**
 * A stable, human-readable label for THIS device/install: generated once,
 * written to `localStorage`, and reused after that - never regenerated, so
 * it never changes underneath a revision this device already wrote. Falls
 * back to a fixed, honest "This device" when there is no `localStorage` to
 * persist into (desktop's renderer always has one; this only guards a test
 * scope or a storage-denied browser tab).
 */
export function delveSyncDeviceLabel(scope: unknown = globalThis): string {
  try {
    const storage = localStorageOf(scope);
    if (!storage) return "This device";
    const existing = storage.getItem(DEVICE_LABEL_KEY);
    if (existing) return existing;
    const platform = (
      (scope as { navigator?: { platform?: string } }).navigator?.platform ?? ""
    ).trim();
    const suffix = Math.random().toString(36).slice(2, 8);
    const label = `${platform || "Device"}-${suffix}`;
    storage.setItem(DEVICE_LABEL_KEY, label);
    return label;
  } catch {
    return "This device";
  }
}

/** The last synced revision THIS device has already shown a banner for, or
 * null when it has never checked (or storage is unavailable) - in which
 * case any real revision counts as new. */
export function delveSyncLastSeenRevision(scope: unknown = globalThis): number | null {
  try {
    const storage = localStorageOf(scope);
    const raw = storage?.getItem(LAST_SEEN_KEY);
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/** Record that this device has now seen `revision` - whether by applying
 * it, reviewing it, or dismissing the banner outright. Never throws. */
export function markDelveSyncSeen(revision: number, scope: unknown = globalThis): void {
  try {
    localStorageOf(scope)?.setItem(LAST_SEEN_KEY, String(revision));
  } catch {
    /* no localStorage: nothing to persist, the banner simply reappears */
  }
}

/* ------------------------------------------------------------------ *
 * The two orchestrators: write on the Apply checkpoint, and check on
 * boot/menu-open. Both are thin - the real decisions above are already
 * pure functions - and both are safe to call with no folder configured.
 * ------------------------------------------------------------------ */

/**
 * Write this install's current mod set to its remembered sync folder, if
 * one is configured. Called from the "Apply changes and reload" checkpoint
 * (mods.ts's `applyModChanges`), never per-toggle. A no-op, never a thrown
 * error, when there is no folder support, none chosen, or nothing enabled
 * worth exporting (the same "nothing to save yet" case Save-a-Delve itself
 * reports) - sync is opportunistic and must never be why applying a mod
 * change fails.
 */
export async function performDelveSyncWrite(opts: {
  readonly folder: HostFolder | undefined;
  readonly candidates: readonly DelveMod[];
  readonly storedEnabled: readonly string[];
  readonly effectiveEnabled: readonly string[];
  readonly originDevice: string;
  readonly engineVersion: string;
  readonly delveName: string;
}): Promise<{ readonly ok: boolean; readonly revision: number } | null> {
  if (!opts.folder || opts.candidates.length === 0) return null;
  if ((await opts.folder.name()) === null) return null;
  const file = buildDelveFile({
    name: opts.delveName,
    createdAt: new Date().toISOString(),
    createdWithEngine: opts.engineVersion,
    mods: opts.candidates,
  });
  const enabledSetInformational = !delveSyncEnabledIsAuthoritative(
    opts.storedEnabled,
    opts.effectiveEnabled,
  );
  return writeDelveSync(opts.folder, file, {
    originDevice: opts.originDevice,
    enabledSetInformational,
  });
}

/**
 * Read the remembered sync folder's file, if any, and classify it against
 * what this device has already seen. The boot/Mods-menu-open checkpoint's
 * whole read side - a thin wrapper around `folder.list()` plus
 * `classifyDelveSyncArrival`, so the pure classification stays unit-testable
 * on its own with no folder involved at all.
 */
export async function loadDelveSyncArrival(
  folder: HostFolder | undefined,
  lastSeenRevision: number | null,
): Promise<DelveSyncArrivalState> {
  if (!folder) return { kind: "none" };
  const entries = await folder.list();
  const found = entries.find((e) => e.name === DELVE_SYNC_FILENAME);
  return classifyDelveSyncArrival(found, lastSeenRevision);
}
