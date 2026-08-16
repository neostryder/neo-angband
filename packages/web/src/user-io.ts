/**
 * ANGBAND_DIR_USER as the front end reaches it: through the installed host.
 *
 * WHAT WAS WRONG. userdir.ts implements a user directory over localStorage, and
 * host-browser.ts wraps it as the reduced-capability HostIo's HostDir.USER - that
 * part is right. But every screen that writes a user file imported userdir.ts
 * DIRECTLY, so the localStorage directory was not the browser's implementation of
 * the user directory, it was the only one that existed. Under the desktop shell,
 * where makeDesktopHost installs a RawFsHost over real node:fs, the character
 * dump, the equipment dump, the screen dump, the spoilers and the level map ALL
 * still went into localStorage:
 *
 *   - the file was invisible on disk, so it could not be posted to a ladder,
 *     read by another program, or found by the player at all;
 *   - it competed for the origin's quota with the savefiles;
 *   - get_file's "Replace existing file?" asked about a file in the wrong
 *     directory, and its "Saving as ..." printed "user/dump.txt" rather than the
 *     real path;
 *   - and the download offered afterwards was the only real output, which is the
 *     "a platform limit quietly edits the game" failure host/io.ts was written to
 *     stop - reproduced one layer above the seam that stopped it.
 *
 * prefs-ui.ts was already doing this correctly, which is why the pref files - the
 * one kind of user file the game reads BACK - worked on both platforms. The rest
 * followed the older path.
 *
 * So: every user-directory access goes through host(). The web build behaves
 * exactly as before, because BrowserHost delegates HostDir.USER to userdir.ts;
 * the desktop build writes real files, because RawFsHost does.
 *
 * This module must NOT be imported by host-browser.ts. That direction is the
 * delegation (BrowserHost -> userdir.ts) and closing the loop would recurse.
 */

import {
  FileMode,
  FileType,
  HostDir,
  host,
  textLinesToFile as coreTextLinesToFile,
} from "@rpgm-tools/neo-angband-core";
import type { WriteOutcome } from "@rpgm-tools/neo-angband-core";
import { downloadUserFile } from "./userdir";

/* Re-exported so a screen that needs to tag its dump (the HTML screen dump, the
 * wizard level map) reaches file_open's ftype through the same module as the
 * write itself, rather than importing half the call from core. */
export { FileType };

/** path_build(ANGBAND_DIR_USER, name), for prompts and messages only. */
export function userPath(name: string): string {
  return host().displayPath(HostDir.USER, name);
}

/** file_exists in the user directory. */
export function userExists(name: string): boolean {
  return host().exists(HostDir.USER, name);
}

/** file_open(MODE_READ) + a file_getl loop. */
export function userRead(name: string): string | null {
  return host().read(HostDir.USER, name);
}

/**
 * file_open(MODE_WRITE, ftype) + file_put + file_close, keeping upstream's two
 * failure modes apart - wiz-spoil.c prints a different message for each.
 *
 * `ftype` is passed rather than dropped because a host may act on it: upstream
 * tags the screen dump and the level map FTYPE_HTML through file_open_hook.
 */
export function userWriteChecked(
  name: string,
  text: string,
  ftype: FileType = FileType.TEXT,
): WriteOutcome {
  return host().write(HostDir.USER, name, text, FileMode.WRITE, ftype);
}

/** userWriteChecked for the callers that only report success or failure. */
export function userWrite(name: string, text: string, ftype?: FileType): boolean {
  return userWriteChecked(name, text, ftype) === "ok";
}

/**
 * text_lines_to_file (z-textblock.c L703-737) against the user directory,
 * returning an `errr` - 0 on success, -1 when the staged file could not be
 * opened - because callers read it the way the C does.
 */
export function userTextLinesToFile(name: string, text: string): number {
  return coreTextLinesToFile(host(), HostDir.USER, name, text);
}

/**
 * Offer the bytes to the platform as well, when the file the game just wrote is
 * not one the player can reach.
 *
 * Upstream has no download: it writes into a directory the player already has
 * open. So this fires only when the host reports `realFiles: false`, which is the
 * browser. On desktop the file IS the output and a second copy in Downloads would
 * be an invention - the same kind of invented stand-in host/io.ts records as
 * worse than an admitted gap.
 *
 * Returns whether an export was made, which is NOT a success/failure signal: on
 * desktop, false means "no export was needed".
 */
export function exportUserFile(name: string, text: string, mime?: string): boolean {
  if (host().capabilities.realFiles) return false;
  return downloadUserFile(name, text, mime);
}
