/**
 * The full-capability HostIo: node:fs, the real thing.
 *
 * This is z-file.c on a POSIX/Windows host, which is what upstream actually
 * runs on. It backs the CLI harness and the Electron main process.
 *
 * Only the SYSCALLS live here. z-file.c's rules - the create/close distinction,
 * file_exists being "is a file", file_newer's three branches - live once in
 * core's RawFsHost, because the Electron build reaches the same filesystem over
 * an IPC hop and two hand-written copies of those rules would drift. See
 * packages/core/src/host/raw.ts.
 *
 * The directory root follows upstream's layout under a single base:
 *   <base>/user  <base>/save  <base>/panic  <base>/scores  <base>/archive
 * matching init.c's ANGBAND_DIR_USER / _SAVE / _PANIC / _SCORES / _ARCHIVE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
/* The host subpath, not the barrel: the Electron main process bundles this file
 * and needs z-file.c, not the game engine. Going through core's index dragged
 * the whole of core into that bundle. */
import type { FileType, HostDir, RawFs, WriteOutcome } from "@rpgm-tools/neo-angband-core/host";
import { RawFsHost } from "@rpgm-tools/neo-angband-core/host";

/**
 * node:fs as a RawFs. Every method reports failure by return value, the way
 * z-file.c does - file_open returns NULL rather than dying - so a read-only
 * base directory is a legitimate host state rather than a crash.
 */
export class NodeRawFs implements RawFs {
  private readonly base: string;
  /**
   * Per-directory overrides, from main.c's `-d<dir>=<path>` (change_path).
   *
   * Upstream's ANGBAND_DIR_* are independent strings, not a base plus five
   * suffixes - which is precisely what makes `-d` possible: the save directory
   * can be somewhere else entirely from the user directory. The base is the
   * default for the ones nobody overrode.
   */
  private readonly overrides: Readonly<Partial<Record<HostDir, string>>>;

  constructor(base: string, overrides: Readonly<Partial<Record<HostDir, string>>> = {}) {
    this.base = base;
    this.overrides = overrides;
    /* NO create_needed_dirs here. This used to mkdir all five ANGBAND_DIR_* at
     * construction, which is what init.c:411 does - and which left `save/`,
     * `panic/` and `scores/` sitting empty in a player's game folder for the
     * whole life of an install, because nothing in this port writes to them yet.
     * init.c carries its own answer as a comment: "ToDo: Only create the
     * directories when actually writing files." That is what `ensureRoot` below
     * does, and it is not a behaviour divergence - no caller can tell an absent
     * directory from an empty one, because every reader here already answers for
     * a directory that is not there (isFile false, readText null, listFiles []).
     *
     * The startup failure upstream gets from this - quit rather than run on into
     * a game that cannot save - is not lost either: the desktop shell probes the
     * base with checkWritable() before it opens a window (main.ts), which is a
     * better test anyway because it writes a file rather than making a folder. */
  }

  /**
   * path_build's directory, created if it is not there yet.
   *
   * Called only from the WRITE paths. Silent on failure: the caller's own
   * open/rename is the thing that reports, and a base that cannot be created
   * fails that call for the same reason it failed this one.
   */
  private ensureRoot(dir: HostDir): void {
    try {
      fs.mkdirSync(this.root(dir), { recursive: true });
    } catch {
      /* reported by the write that needed it */
    }
  }

  /** ANGBAND_DIR_x itself: the override if there is one, else base/<dir>. */
  private root(dir: HostDir): string {
    const over = this.overrides[dir];
    return over !== undefined && over !== "" ? path.resolve(over) : path.resolve(this.base, dir);
  }

  /**
   * path_build(ANGBAND_DIR_x, leaf), with the traversal guard the leaf-only
   * contract implies: a name that escapes its directory resolves to null and
   * every caller then reports failure.
   */
  private full(dir: HostDir, name: string): string | null {
    const root = this.root(dir);
    const full = path.resolve(root, name);
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    return full;
  }

  displayPath(dir: HostDir, name: string): string {
    return this.full(dir, name) ?? `${dir}/${name}`;
  }

  isFile(dir: HostDir, name: string): boolean {
    const p = this.full(dir, name);
    if (p === null) return false;
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }

  readText(dir: HostDir, name: string): string | null {
    const p = this.full(dir, name);
    if (p === null) return null;
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  }

  writeText(
    dir: HostDir,
    name: string,
    text: string,
    append: boolean,
    _ftype: FileType,
  ): WriteOutcome {
    /* ftype reaches the platform through upstream's file_open_hook, which only
     * the Mac front end ever set (it stamped a type/creator code). Accepted and
     * unused rather than dropped from the signature, so the seam stays visible. */
    void _ftype;
    const p = this.full(dir, name);
    if (p === null) return "create-failed";
    /* file_open's directory, made now rather than at startup - see the
     * constructor. `rename` needs no such thing: it moves a file that is already
     * in this directory, so the directory exists or the rename was going to fail
     * on the source anyway. */
    this.ensureRoot(dir);
    let fd: number | undefined;
    try {
      fd = fs.openSync(p, append ? "a" : "w");
    } catch {
      return "create-failed";
    }
    try {
      fs.writeFileSync(fd, text, "utf8");
    } catch {
      /* The bytes did not all land - upstream's file_close failure. */
      try {
        fs.closeSync(fd);
      } catch {
        /* already reporting */
      }
      return "close-failed";
    }
    try {
      /* file_close: this is where a full disk actually surfaces, which is why
       * the two outcomes are reported separately. */
      fs.closeSync(fd);
    } catch {
      return "close-failed";
    }
    return "ok";
  }

  unlink(dir: HostDir, name: string): boolean {
    const p = this.full(dir, name);
    if (p === null) return false;
    try {
      fs.unlinkSync(p);
      return true;
    } catch {
      return false;
    }
  }

  rename(dir: HostDir, from: string, to: string): boolean {
    const a = this.full(dir, from);
    const b = this.full(dir, to);
    if (a === null || b === null) return false;
    try {
      fs.renameSync(a, b);
      return true;
    } catch {
      return false;
    }
  }

  mtime(dir: HostDir, name: string): number | null {
    const p = this.full(dir, name);
    if (p === null) return null;
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return null;
    }
  }

  listFiles(dir: HostDir): string[] {
    try {
      return fs
        .readdirSync(this.root(dir), { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }
}

export interface NodeHostOpts {
  /** The base directory the five ANGBAND_DIR_* subdirectories live under. */
  base: string;
  /** main.c's -d<dir>=<path> overrides, for the directories this port has. */
  dirs?: Readonly<Partial<Record<HostDir, string>>>;
  /** argv minus the program name; defaults to process.argv.slice(2). */
  argv?: readonly string[];
  /** Terminals this front end can show. The CLI is one; Electron overrides it. */
  termCount?: number;
}

/** A HostIo over node:fs: core's z-file.c rules on NodeRawFs' syscalls. */
export class NodeHost extends RawFsHost {
  constructor(opts: NodeHostOpts) {
    super(new NodeRawFs(opts.base, opts.dirs ?? {}), {
      argv: opts.argv ?? process.argv.slice(2),
      termCount: opts.termCount ?? 1,
    });
  }
}
