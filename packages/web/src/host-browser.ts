/**
 * The reduced-capability HostIo: localStorage, one key per file.
 *
 * This is the adapter that has to be HONEST rather than complete. It wraps the
 * virtual user directory that userdir.ts already implements, and adds the four
 * remaining HostDirs so the shape matches upstream's - but it reports
 * `realFiles: false`, `argv: false`, `signals: false` and `termCount: 1`,
 * because every one of those is a true statement about a browser tab:
 *
 *   - realFiles: localStorage is private to the origin, invisible on disk and
 *     evictable, so no mod manager can deploy into it and "clear browsing data"
 *     destroys it. Files here are real to the game and to nothing else.
 *   - argv: there is no command line, so main.c's switches (-f, -u, -w, ...)
 *     have no way to be given.
 *   - signals: a closed tab does not notify anyone, so upstream's signal-handler
 *     panic save has no trigger.
 *   - termCount: one canvas is one term; upstream's ANGBAND_TERM_MAX is 8.
 *
 * Reporting those honestly is the whole point. Previously each of them was an
 * unwritten assumption at a call site, and an unwritten assumption is what let a
 * platform limit quietly edit the game instead of being recorded as a limit.
 *
 * `newer` returns null: localStorage stores no mtime, so this host genuinely
 * cannot tell, and null is not false.
 */

import type { HostCapabilities, HostIo, WriteOutcome } from "@neo-angband/core";
import { FileMode, HostDir } from "@neo-angband/core";
import {
  deleteUserFile,
  listUserFiles,
  readUserFile,
  userPath,
  writeUserFileChecked,
} from "./userdir";
import type { UserStorage } from "./userdir";

/**
 * One storage namespace per HostDir except USER, which userdir.ts already owns:
 * every USER access below delegates to it so the pref files a player has
 * already saved stay readable under their existing prefix.
 *
 * USER is deliberately EXCLUDED from the type rather than mapped to "". An
 * empty prefix would make `list` match every key in localStorage - saves,
 * colours, keymaps - the moment anyone touched the delegation, so the compiler
 * enforces it instead of a comment asking nicely.
 */
const PREFIX: Record<Exclude<HostDir, HostDir.USER>, string> = {
  [HostDir.SAVE]: "neo-angband-save:",
  [HostDir.PANIC]: "neo-angband-panic:",
  [HostDir.SCORES]: "neo-angband-scores:",
  [HostDir.ARCHIVE]: "neo-angband-archive:",
};

/**
 * A HostIo over localStorage, delegating HostDir.USER to userdir.ts.
 *
 * The backing store for the other four directories is injectable for the same
 * reason userdir.ts's is (setUserStorage): the interesting behaviour here is the
 * FAILURE behaviour - a quota-exceeded setItem that throws, and the worse one
 * that does not throw and stores nothing anyway - and neither can be provoked
 * against a real localStorage. An untestable failure path is how a write that
 * silently stored nothing got to claim success at every layer above it.
 */
export class BrowserHost implements HostIo {
  readonly capabilities: HostCapabilities = {
    realFiles: false,
    argv: false,
    signals: false,
    termCount: 1,
    directories: false,
  };

  /** undefined = not yet resolved; null = no storage available at all. */
  private backing: UserStorage | null | undefined;

  /** Pass a store for the non-USER directories; omit it for localStorage. */
  constructor(store?: UserStorage | null) {
    this.backing = store;
  }

  private storage(): UserStorage | null {
    if (this.backing !== undefined) return this.backing;
    try {
      this.backing = localStorage;
    } catch {
      this.backing = null; /* private mode / no DOM */
    }
    return this.backing;
  }

  displayPath(dir: HostDir, name: string): string {
    return dir === HostDir.USER ? userPath(name) : `${dir}/${name}`;
  }

  exists(dir: HostDir, name: string): boolean {
    return this.read(dir, name) !== null;
  }

  read(dir: HostDir, name: string): string | null {
    if (dir === HostDir.USER) return readUserFile(name);
    const s = this.storage();
    if (!s) return null;
    try {
      return s.getItem(PREFIX[dir] + name);
    } catch {
      return null;
    }
  }

  write(
    dir: HostDir,
    name: string,
    text: string,
    mode: FileMode = FileMode.WRITE,
  ): WriteOutcome {
    /* MODE_APPEND: localStorage has no append, so read-modify-write. prefs_save
     * depends on this, and a host that silently truncated instead would lose
     * every earlier dump block in the file. */
    const body =
      mode === FileMode.APPEND ? (this.read(dir, name) ?? "") + text : text;
    if (dir === HostDir.USER) return writeUserFileChecked(name, body);
    const s = this.storage();
    if (!s) return "create-failed";
    try {
      s.setItem(PREFIX[dir] + name, body);
    } catch {
      return "create-failed"; /* quota exceeded */
    }
    /* A quota-evicted or truncated write does not throw; only the read-back
     * sees it, which is what file_close's flush would have caught. */
    return this.read(dir, name) === body ? "ok" : "close-failed";
  }

  remove(dir: HostDir, name: string): boolean {
    if (dir === HostDir.USER) return deleteUserFile(name);
    const s = this.storage();
    if (!s) return false;
    try {
      s.removeItem(PREFIX[dir] + name);
    } catch {
      return false;
    }
    return this.read(dir, name) === null;
  }

  move(dir: HostDir, from: string, to: string): boolean {
    const text = this.read(dir, from);
    if (text === null) return false;
    if (this.write(dir, to, text) !== "ok") return false;
    return this.remove(dir, from);
  }

  /**
   * localStorage keeps no modification time, so this host cannot answer
   * file_newer at all. null - "cannot tell" - is the honest result; returning
   * false would silently delete ui-game.c:709-720's panic-save prompt, and
   * returning true would offer a save that may not exist.
   */
  newer(dir: HostDir, first: string, second: string): boolean | null {
    /* The parameters are declared and unused deliberately: narrowing this to
     * newer() would compile against HostIo but break every caller holding a
     * BrowserHost directly. */
    void dir;
    void first;
    void second;
    return null;
  }

  list(dir: HostDir): string[] {
    if (dir === HostDir.USER) return listUserFiles();
    const s = this.storage();
    if (!s) return [];
    const prefix = PREFIX[dir];
    const names: string[] = [];
    try {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k !== null && k.startsWith(prefix)) names.push(k.slice(prefix.length));
      }
    } catch {
      return [];
    }
    return names.sort((a, b) => a.localeCompare(b));
  }

  /** No command line exists in a browser tab. */
  argv(): readonly string[] {
    return [];
  }
}
