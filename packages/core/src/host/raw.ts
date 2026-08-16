/**
 * The real-filesystem HostIo, split so there is exactly ONE copy of the
 * semantics.
 *
 * WHY THIS EXISTS
 *
 * Two front ends have a real filesystem under them - the CLI (node:fs directly)
 * and the Electron desktop build (node:fs in the main process, reached from the
 * renderer over IPC). They are the same z-file.c, so they must not be two
 * hand-written adapters that agree today and drift tomorrow. `file_newer`'s
 * three-way rule is the clearest example: it is the gate on ui-game.c's
 * panic-save prompt, and "second is missing" returning TRUE rather than false
 * (z-file.c:952-967) is the kind of detail one of two copies would get wrong.
 *
 * So the split is:
 *
 *   RawFs      - the syscall surface. One method per operation, no rules.
 *                Each host implements this: node:fs directly, or an IPC hop.
 *   RawFsHost  - z-file.c's rules over any RawFs. Written once, tested once.
 *
 * The traversal guard deliberately lives in the RawFs implementations rather
 * than here, because on the Electron split it is a SECURITY boundary and has to
 * be enforced in the trusted process. Enforcing it here as well would read as if
 * the renderer's copy were the one that mattered.
 */

import type { HostCapabilities, HostIo, WriteOutcome } from "./io.js";
import { FileMode, FileType, HostDir } from "./io.js";

/**
 * The raw operations a real filesystem provides, addressed the way HostIo is:
 * by (directory, leaf name), never by a composed path. An implementation owns
 * path composition, because that is path_build's job and it is host-specific.
 *
 * Every method reports failure by return value; none throws. That mirrors
 * z-file.c, where file_open returns NULL rather than dying.
 */
export interface RawFs {
  /**
   * path_build(dir, name) for DISPLAY only - the text upstream prints in
   * "Cannot open '%s'." A name that escapes its directory still has to render
   * as something, so this never returns null.
   */
  displayPath(dir: HostDir, name: string): string;

  /** stat(p).isFile(). False for a directory, which is what file_exists means. */
  isFile(dir: HostDir, name: string): boolean;

  /** The whole file as text, or null if it cannot be read. */
  readText(dir: HostDir, name: string): string | null;

  /**
   * open + write + close, reporting WHICH phase failed. The two are separate
   * because upstream prints different messages for them at one call site
   * (wiz-spoil.c's "Cannot create spoiler file." / "Cannot close spoiler file.").
   */
  writeText(
    dir: HostDir,
    name: string,
    text: string,
    append: boolean,
    ftype: FileType,
  ): WriteOutcome;

  /** unlink. */
  unlink(dir: HostDir, name: string): boolean;

  /** rename within one directory. */
  rename(dir: HostDir, from: string, to: string): boolean;

  /** Modification time in milliseconds, or null when the file is not there. */
  mtime(dir: HostDir, name: string): number | null;

  /** The files (not subdirectories) in a directory. */
  listFiles(dir: HostDir): string[];
}

/** Every writable HostDir, for hosts that need to create the tree up front. */
export const ALL_HOST_DIRS: readonly HostDir[] = [
  HostDir.USER,
  HostDir.SAVE,
  HostDir.PANIC,
  HostDir.SCORES,
  HostDir.ARCHIVE,
];

export interface RawFsHostOpts {
  /** argv minus the program name. */
  argv?: readonly string[];
  /**
   * Terminals this front end can show. Upstream's ANGBAND_TERM_MAX is 8
   * (ui-term.h:244); a single-canvas front end is 1.
   */
  termCount?: number;
  /**
   * Whether this front end is actually told the process is dying, so a panic
   * save can be written. True for a process that installs handlers itself (the
   * CLI). A sandboxed renderer only has this if its host process forwards the
   * event, so it must declare what it really has rather than inherit a yes -
   * capabilities describe the platform, and a false yes here silently removes
   * ui-game.c's panic save instead of removing any code.
   */
  signals?: boolean;
}

/**
 * z-file.c's rules over any RawFs. This is the full-capability host: real
 * files, a command line, and a process that can be signalled.
 */
export class RawFsHost implements HostIo {
  readonly capabilities: HostCapabilities;
  private readonly raw: RawFs;
  private readonly cmdline: readonly string[];

  constructor(raw: RawFs, opts: RawFsHostOpts = {}) {
    this.raw = raw;
    this.cmdline = opts.argv ?? [];
    this.capabilities = {
      realFiles: true,
      argv: true,
      signals: opts.signals ?? true,
      termCount: opts.termCount ?? 1,
      directories: true,
    };
  }

  displayPath(dir: HostDir, name: string): string {
    return this.raw.displayPath(dir, name);
  }

  /** file_exists (z-file.h:135) - exists AND is a file. */
  exists(dir: HostDir, name: string): boolean {
    return this.raw.isFile(dir, name);
  }

  read(dir: HostDir, name: string): string | null {
    return this.raw.readText(dir, name);
  }

  write(
    dir: HostDir,
    name: string,
    text: string,
    mode: FileMode = FileMode.WRITE,
    ftype: FileType = FileType.TEXT,
  ): WriteOutcome {
    /* MODE_APPEND must not truncate: prefs_save appends its dump after
     * remove_old_dump has stripped the previous one. MODE_READ reaching a write
     * is a caller bug, and truncating on it would destroy the file, so it is
     * treated as the open failure it would be in C. */
    if (mode === FileMode.READ) return "create-failed";
    return this.raw.writeText(dir, name, text, mode === FileMode.APPEND, ftype);
  }

  remove(dir: HostDir, name: string): boolean {
    return this.raw.unlink(dir, name);
  }

  move(dir: HostDir, from: string, to: string): boolean {
    return this.raw.rename(dir, from, to);
  }

  /**
   * file_newer (z-file.c:952-967), all three branches:
   *
   *   if (stat(first,  ...) != 0) return false;   // first missing -> not newer
   *   if (stat(second, ...) != 0) return true;    // second missing -> newer
   *   return stat1.st_mtime > stat2.st_mtime;
   *
   * Never null here: a real filesystem always knows. The null in HostIo exists
   * for BrowserHost, which stores no mtime and must say "cannot tell" rather
   * than guess false - that guess would silently delete ui-game.c:709-720's
   * panic-save prompt.
   */
  newer(dir: HostDir, first: string, second: string): boolean {
    const a = this.raw.mtime(dir, first);
    if (a === null) return false;
    const b = this.raw.mtime(dir, second);
    if (b === null) return true;
    return a > b;
  }

  list(dir: HostDir): string[] {
    return this.raw.listFiles(dir);
  }

  argv(): readonly string[] {
    return this.cmdline;
  }
}
