/**
 * Ticket #133's cloud-backup folder: the name rule and the small persisted record,
 * kept separate from main.ts so both are testable without an Electron process.
 *
 * See BACKUP_CHANNEL's doc comment (bridge-channel.ts) for why this exists at all:
 * `showDirectoryPicker()` is confirmed broken in this Electron build, and this is
 * the native replacement. The one property that matters is the same one
 * `mod-archive.ts` already established for MOD_ZIP_CHANNEL - the renderer is the
 * untrusted side of this boundary, so a file name it supplies is checked as if it
 * were hostile, and the chosen folder's real path never crosses the channel toward
 * the renderer at all.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The file this module persists the chosen folder's path in, beside `mods/`. */
export const BACKUP_FOLDER_FILE = "backup-folder.json";

/**
 * Is this a name `write()` may create inside the chosen folder?
 *
 * One path segment, no separators, no traversal, no leading dot, the extension the
 * backup writer actually produces - the same shape `isModZipName` checks, adapted to
 * `.neochar` because that is the one file type this channel ever writes.
 */
export function isBackupFileName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.startsWith(".") &&
    !name.includes("\0") &&
    name.endsWith(".neochar")
  );
}

/** The persisted folder path, or null if none is chosen or the record is unreadable. */
export function readBackupFolder(userBase: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(userBase, BACKUP_FOLDER_FILE), "utf8");
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

/** Remember `folderPath`, or forget it when `folderPath` is null. */
export function writeBackupFolder(userBase: string, folderPath: string | null): void {
  const file = path.join(userBase, BACKUP_FOLDER_FILE);
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
