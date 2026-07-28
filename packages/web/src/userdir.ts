/**
 * ANGBAND_DIR_USER, ported.
 *
 * Census block E, host-io. Aaron's disposition: "Must not deviate from
 * upstream - port the equivalents, do not excuse."
 *
 * Upstream keeps a USER DIRECTORY next to the savefile and writes real files
 * into it: character dumps, equipment dumps, screen dumps, level maps,
 * lore.txt, and the .prf pref files it can later read back. The port used to
 * answer that with "the browser has no filesystem" and hand every dump straight
 * to a download with an auto-generated name, which quietly deleted four things:
 *
 *   - get_file's whole prompt (File name: / Replace existing file?),
 *   - the read side - a pref file the game writes and later LOADS cannot exist
 *     if the only sink is the user's Downloads folder,
 *   - text_lines_to_file's staged write, and with it the one message its
 *     callers print when it fails,
 *   - any way to see what the game has written.
 *
 * So the user directory is a real (virtual) directory here: one storage key per
 * file under USER_PREFIX, with file_exists / file_open+write / file_read /
 * file_delete / file_move equivalents and upstream's own staged-write rotation.
 * A download is still offered on top of it, because a dump is written to be
 * shared - but the download is the EXPORT, not the file.
 *
 * Storage is injectable (setUserStorage) so the failure paths are testable;
 * without a DOM it degrades to "no directory", and every accessor reports
 * failure rather than throwing.
 */

/** The Storage subset the user directory needs (localStorage satisfies it). */
export interface UserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

/** One storage key per file in the directory. */
const USER_PREFIX = "neo-angband-user:";

/**
 * The directory name shown in prompts and messages. Upstream prints the full
 * path_build result (~/.angband/Angband/user/dump.txt); the port has one fixed
 * user directory, so the displayed path is "user/<name>".
 */
export const USER_DIR = "user";

let backing: UserStorage | null | undefined;

/** Point the directory at another storage (tests); null = no directory. */
export function setUserStorage(s: UserStorage | null): void {
  backing = s;
}

function store(): UserStorage | null {
  if (backing !== undefined) return backing;
  try {
    backing = localStorage;
  } catch {
    backing = null; /* private mode / no DOM */
  }
  return backing;
}

/** path_build(ANGBAND_DIR_USER, name) - what the messages and prompts print. */
export function userPath(name: string): string {
  return `${USER_DIR}/${name}`;
}

/** file_exists. */
export function userFileExists(name: string): boolean {
  return readUserFile(name) !== null;
}

/** file_open(MODE_READ) + file_getl loop: the whole text, or null if absent. */
export function readUserFile(name: string): string | null {
  const s = store();
  if (!s) return null;
  try {
    return s.getItem(USER_PREFIX + name);
  } catch {
    return null;
  }
}

/** file_open(MODE_WRITE) + file_put + file_close, verified by a read-back. */
export function writeUserFile(name: string, text: string): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(USER_PREFIX + name, text);
  } catch {
    return false; /* quota exceeded */
  }
  /* A truncated or evicted write does not throw; only the read-back sees it. */
  return readUserFile(name) === text;
}

/** file_delete. */
export function deleteUserFile(name: string): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.removeItem(USER_PREFIX + name);
  } catch {
    return false;
  }
  return readUserFile(name) === null;
}

/** file_move. */
function moveUserFile(from: string, to: string): boolean {
  const text = readUserFile(from);
  if (text === null) return false;
  if (!writeUserFile(to, text)) return false;
  return deleteUserFile(from);
}

/** The directory listing, sorted by name. */
export function listUserFiles(): string[] {
  const s = store();
  if (!s) return [];
  const names: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k !== null && k.startsWith(USER_PREFIX)) names.push(k.slice(USER_PREFIX.length));
    }
  } catch {
    return [];
  }
  return names.sort((a, b) => a.localeCompare(b));
}

/**
 * text_lines_to_file (z-textblock.c L703-737): write <name>.new, then rotate it
 * into place over the existing file, keeping <name>.old only long enough for the
 * rename. Returns an `errr` - 0 on success, -1 when the staged file could not be
 * opened - so callers read it exactly as the C does:
 *
 *     if (text_lines_to_file(path, writer)) msg("Failed to create file %s.new", path);
 */
export function textLinesToFile(name: string, text: string): number {
  const newName = `${name}.new`;
  const oldName = `${name}.old`;

  /* Write new file (L714-724). */
  if (!writeUserFile(newName, text)) return -1;

  /* Move files around (L726-734). */
  if (!userFileExists(name)) {
    moveUserFile(newName, name);
  } else if (moveUserFile(name, oldName)) {
    moveUserFile(newName, name);
    deleteUserFile(oldName);
  } else {
    deleteUserFile(newName);
  }

  return 0;
}

/**
 * Hand a user-directory file to the browser as a download - the port's only way
 * to get bytes OUT to the host, and the reason a dump is worth writing at all.
 * Never fatal: a blocked download leaves the file in the user directory.
 */
export function downloadUserFile(name: string, text: string, mime = "text/plain"): boolean {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}
