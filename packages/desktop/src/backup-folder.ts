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
import { backupFolderFormat, parseDocument, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";

/** The file this module persists the chosen folder's path in, beside `mods/`. */
export const BACKUP_FOLDER_FILE = "backup-folder.json";

/**
 * The original ticket #133 caller's purpose id. Kept as the one purpose that
 * maps to the legacy fixed file name, so nothing about an existing install's
 * remembered folder changes shape from this generalisation.
 */
export const CHARACTER_BACKUP_PURPOSE = "character-backup";

/**
 * Is this a purpose id the host will turn into a file name? Lowercase letters, digits, and
 * hyphens, starting with a letter or digit. A purpose arrives from any script in the page,
 * so a separator or a `..` in it must never reach a path join.
 */
export function isBackupPurpose(purpose: unknown): purpose is string {
  return typeof purpose === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(purpose);
}

/** Which file a purpose's remembered-folder record lives in. */
export function hostFolderRecordFile(purpose: string): string {
  if (!isBackupPurpose(purpose)) throw new Error("the backup purpose is not a valid id");
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
    /^\.[a-z0-9]{1,16}$/u.test(ext) &&
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes(":") &&
    !name.includes("..") &&
    !/[<>"|?*]/u.test(name) &&
    ![...name].some((char) => char.charCodeAt(0) < 32) &&
    !/^(con|prn|aux|nul|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])[ .]*(\.|$)/iu.test(name) &&
    !name.endsWith(" ") &&
    !name.endsWith(".") &&
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
    const document = parseDocument(raw, backupFolderFormat);
    if (document.ok) return document.data.path.length > 0 ? document.data.path : null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const p = (parsed as { path?: unknown }).path;
    if (typeof p !== "string" || p.length === 0) return null;
    const encoded = serializeDocument(backupFolderFormat, { path: p });
    fs.writeFileSync(path.join(userBase, hostFolderRecordFile(purpose)), encoded, "utf8");
    const checked = parseDocument(fs.readFileSync(path.join(userBase, hostFolderRecordFile(purpose)), "utf8"), backupFolderFormat);
    return checked.ok ? checked.data.path : null;
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
  const encoded = serializeDocument(backupFolderFormat, { path: folderPath });
  fs.writeFileSync(file, encoded, "utf8");
  const checked = parseDocument(fs.readFileSync(file, "utf8"), backupFolderFormat);
  if (!checked.ok) return;
}

/** The display name for a chosen folder: its basename, never the full path. */
export function backupFolderDisplayName(folderPath: string): string {
  return path.basename(folderPath);
}

export const BACKUP_LIMITS = Object.freeze({ files: 200, fileBytes: 8 * 1024 * 1024, totalBytes: 256 * 1024 * 1024 });

function plainFolder(folder: string): boolean {
  const stat = fs.lstatSync(folder);
  return stat.isDirectory() && !stat.isSymbolicLink() && path.relative(path.resolve(folder), fs.realpathSync(folder)) === "";
}

function plainFile(file: string): fs.Stats | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("The backup file is not a plain file.");
    return stat;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function sameFile(a: fs.Stats, b: fs.Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && b.isFile() && b.nlink === 1;
}

/** The dialog must finish before a replacement opens the existing file for writing. */
export async function writeBackupFile(
  folder: string,
  name: unknown,
  text: unknown,
  ext: string,
  confirmReplace: () => Promise<boolean>,
): Promise<boolean> {
  if (!isHostFolderFileName(name, ext) || typeof text !== "string") return false;
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > BACKUP_LIMITS.fileBytes) return false;
  try {
    if (!plainFolder(folder)) return false;
    const full = path.join(folder, name);
    const initial = plainFile(full);
    if (initial && !(await confirmReplace())) return false;
    if (!plainFolder(folder)) return false;
    const existing = plainFile(full);
    if (!initial && existing) return false;
    let count = 0;
    let total = bytes;
    for (const entry of fs.readdirSync(folder)) {
      if (!isHostFolderFileName(entry, ext)) continue;
      const stat = plainFile(path.join(folder, entry));
      if (!stat) continue;
      count++;
      if (entry !== name) total += stat.size;
    }
    if (count + (existing ? 0 : 1) > BACKUP_LIMITS.files || total > BACKUP_LIMITS.totalBytes) return false;
    const fd = fs.openSync(full, existing ? "r+" : "wx", 0o600);
    try {
      if (existing && !sameFile(existing, fs.fstatSync(fd))) return false;
      fs.ftruncateSync(fd, 0);
      fs.writeFileSync(fd, text, "utf8");
      return true;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * Ticket #24 (the read side of #133): every file matching `ext` currently
 * readable in `folderPath`, name plus its full text - the renderer's own
 * `readBackupFiles` (mod-backup.ts) does the header peek; this only reads
 * bytes off disk. `ext` defaults to `.neochar`, the original caller's own
 * extension.
 *
 * The text is the file as stored. A current character file is a JSON
 * document and an older `.neochar` is still listed; this function does not
 * parse either one.
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
    if (!plainFolder(folderPath)) return [];
    names = fs.readdirSync(folderPath);
  } catch {
    return [];
  }
  const out: { name: string; text: string }[] = [];
  let total = 0;
  for (const name of names) {
    if (out.length >= BACKUP_LIMITS.files) break;
    if (!isHostFolderFileName(name, ext)) continue;
    try {
      const full = path.join(folderPath, name);
      const stat = plainFile(full);
      if (!stat || stat.size > BACKUP_LIMITS.fileBytes || total + stat.size > BACKUP_LIMITS.totalBytes) continue;
      const fd = fs.openSync(full, "r");
      try {
        if (!sameFile(stat, fs.fstatSync(fd))) continue;
        const bytes = Buffer.alloc(stat.size);
        const read = fs.readSync(fd, bytes, 0, bytes.length, 0);
        out.push({ name, text: bytes.subarray(0, read).toString("utf8") });
        total += read;
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      /* unreadable: skip it, keep the rest of the listing */
    }
  }
  return out;
}
