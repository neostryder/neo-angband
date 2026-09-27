/**
 * Ticket #133's cloud-backup folder, generalised into a purpose-keyed
 * primitive (#158): the name rule and the small persisted record, kept
 * separate from main.ts so both are testable without an Electron process.
 *
 * See BACKUP_CHANNEL's doc comment (bridge-channel.ts) for why this exists at
 * all: `showDirectoryPicker()` is confirmed broken in this Electron build,
 * and this is the native replacement. The one property that matters is the
 * same one `mod-archive.ts` already established for MOD_ZIP_CHANNEL - the
 * renderer is the untrusted side of this boundary, so a file name it
 * supplies is checked as if it were hostile, and the chosen folder's real
 * path never crosses the channel toward the renderer at all.
 *
 * ONE MECHANISM, TWO CALLERS, EACH WITH ITS OWN REMEMBERED FOLDER.
 * `neo-angband-mod-qol`'s character backup (ticket #133) was the only caller
 * when this module had one fixed record file; a mod-profile sync (#158, a
 * portable Delve snapshot rather than a save) is the second, and the two
 * must not be forced to share a folder just because they share a mechanism.
 * `purpose` is the key: the ORIGINAL purpose keeps the ORIGINAL fixed file
 * name (`BACKUP_FOLDER_FILE`), so an existing install's remembered backup
 * folder survives this change untouched, and any other purpose gets its own
 * file, named from the purpose rather than a second constant per caller.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The file this module persists the chosen folder's path in, beside `mods/`. */
export const BACKUP_FOLDER_FILE = "backup-folder.json";

/**
 * The original ticket #133 caller's purpose id. Kept as the one purpose that
 * maps to the legacy fixed file name, so nothing about an existing install's
 * remembered folder changes shape from this generalisation.
 */
export const CHARACTER_BACKUP_PURPOSE = "character-backup";

/** Which file a purpose's remembered-folder record lives in. */
export function hostFolderRecordFile(purpose: string): string {
  return purpose === CHARACTER_BACKUP_PURPOSE
    ? BACKUP_FOLDER_FILE
    : `backup-folder-${purpose}.json`;
}

/**
 * Is this a name `write()` may create inside the chosen folder, for the
 * given extension?
 *
 * One path segment, no separators, no traversal, no leading dot, the
 * extension this purpose's writer actually produces - the same shape
 * `isModZipName` checks, generalised from the single `.neochar` it used to
 * be hardcoded to so a second purpose can supply its own.
 */
export function isHostFolderFileName(name: unknown, ext: string): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.startsWith(".") &&
    !name.includes("\0") &&
    name.endsWith(ext)
  );
}

/** The original, `.neochar`-specific check - a thin wrap so every existing caller is unchanged. */
export function isBackupFileName(name: unknown): name is string {
  return isHostFolderFileName(name, ".neochar");
}

/**
 * The persisted folder path for `purpose`, or null if none is chosen or the
 * record is unreadable. `purpose` defaults to the original ticket #133
 * caller, so every existing call site keeps reading the same file it always did.
 */
export function readBackupFolder(
  userBase: string,
  purpose: string = CHARACTER_BACKUP_PURPOSE,
): string | null {
  try {
    const raw = fs.readFileSync(path.join(userBase, hostFolderRecordFile(purpose)), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const p = (parsed as { path?: unknown }).path;
    return typeof p === "string" && p.length > 0 ? p : null;
  } catch {
    /* absent, unreadable, or not JSON: no folder chosen yet. Not an error - the
     * fault table's own first row. */
    return null;
  }
}

/** Remember `folderPath` for `purpose`, or forget it when `folderPath` is null. */
export function writeBackupFolder(
  userBase: string,
  folderPath: string | null,
  purpose: string = CHARACTER_BACKUP_PURPOSE,
): void {
  const file = path.join(userBase, hostFolderRecordFile(purpose));
  if (folderPath === null) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already absent: forgetting an unset folder is a no-op, not an error. */
    }
    return;
  }
  fs.mkdirSync(userBase, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ path: folderPath }), "utf8");
}

/** The display name for a chosen folder: its basename, never the full path. */
export function backupFolderDisplayName(folderPath: string): string {
  return path.basename(folderPath);
}

/**
 * Ticket #24 (the read side of #133): every file matching `ext` currently
 * readable in `folderPath`, name plus its full text - the renderer's own
 * `readBackupFiles` (mod-backup.ts) does the header peek; this only reads
 * bytes off disk. `ext` defaults to `.neochar`, the original caller's own
 * extension.
 *
 * BEST-EFFORT, LIKE `write()`'s OWN FAILURE MODE. One unreadable file
 * (permissions, a race with deletion between the `readdirSync` and the
 * `readFileSync`) is skipped rather than failing the whole listing - the
 * same tolerance `write()`'s caller already extends to a lapsed grant. An
 * unreadable FOLDER answers an empty list, never a throw: this feeds a boot
 * checkpoint, and a folder that went missing must not be the thing that
 * stops the game from finishing loading.
 */
export function listBackupFiles(
  folderPath: string,
  ext = ".neochar",
): { name: string; text: string }[] {
  let names: string[];
  try {
    names = fs.readdirSync(folderPath);
  } catch {
    return [];
  }
  const out: { name: string; text: string }[] = [];
  for (const name of names) {
    if (!isHostFolderFileName(name, ext)) continue;
    try {
      out.push({ name, text: fs.readFileSync(path.join(folderPath, name), "utf8") });
    } catch {
      /* unreadable: skip it, keep the rest of the listing */
    }
  }
  return out;
}
