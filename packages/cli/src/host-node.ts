/**
 * The full-capability HostIo: node:fs, the real thing.
 *
 * This is z-file.c on a POSIX/Windows host, which is what upstream actually
 * runs on. It backs the CLI harness today and the Electron main process (which
 * imports it rather than reimplementing it) - so there is ONE real-filesystem
 * adapter, not two that drift.
 *
 * The directory root follows upstream's layout under a single base:
 *   <base>/user  <base>/save  <base>/panic  <base>/scores  <base>/archive
 * matching init.c's ANGBAND_DIR_USER / _SAVE / _PANIC / _SCORES / _ARCHIVE.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { HostCapabilities, HostIo, WriteOutcome } from "@neo-angband/core";
import { FileMode, HostDir } from "@neo-angband/core";

/** Every HostDir, so the tree can be created up front. */
const ALL_DIRS: readonly HostDir[] = [
  HostDir.USER,
  HostDir.SAVE,
  HostDir.PANIC,
  HostDir.SCORES,
  HostDir.ARCHIVE,
];

export interface NodeHostOpts {
  /** The base directory the five ANGBAND_DIR_* subdirectories live under. */
  base: string;
  /** argv minus the program name; defaults to process.argv.slice(2). */
  argv?: readonly string[];
  /** Terminals this front end can show. The CLI is one; Electron overrides it. */
  termCount?: number;
}

/** A HostIo over node:fs. */
export class NodeHost implements HostIo {
  readonly capabilities: HostCapabilities;
  private readonly base: string;
  private readonly cmdline: readonly string[];

  constructor(opts: NodeHostOpts) {
    this.base = opts.base;
    this.cmdline = opts.argv ?? process.argv.slice(2);
    this.capabilities = {
      realFiles: true,
      argv: true,
      signals: true,
      termCount: opts.termCount ?? 1,
      directories: true,
    };
    /* Upstream's init.c creates the user directories at startup (create_needed_
     * dirs). Best-effort: a read-only base is a legitimate host state and every
     * accessor below already reports failure rather than throwing. */
    for (const d of ALL_DIRS) {
      try {
        fs.mkdirSync(path.join(this.base, d), { recursive: true });
      } catch {
        /* reported per-call instead */
      }
    }
  }

  /**
   * path_build(ANGBAND_DIR_x, leaf), with the traversal guard the leaf-only
   * contract implies: a name that escapes its directory resolves to null and
   * every caller then reports failure.
   */
  private full(dir: HostDir, name: string): string | null {
    const root = path.resolve(this.base, dir);
    const full = path.resolve(root, name);
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    return full;
  }

  displayPath(dir: HostDir, name: string): string {
    return this.full(dir, name) ?? `${dir}/${name}`;
  }

  exists(dir: HostDir, name: string): boolean {
    const p = this.full(dir, name);
    if (p === null) return false;
    try {
      /* file_exists is "exists AND is a file" (z-file.h L135). */
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }

  read(dir: HostDir, name: string): string | null {
    const p = this.full(dir, name);
    if (p === null) return null;
    try {
      return fs.readFileSync(p, "utf8");
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
    const p = this.full(dir, name);
    if (p === null) return "create-failed";
    let fd: number | undefined;
    try {
      /* MODE_APPEND must not truncate: prefs_save appends its dump after
       * remove_old_dump has stripped the previous one. */
      fd = fs.openSync(p, mode === FileMode.APPEND ? "a" : "w");
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

  remove(dir: HostDir, name: string): boolean {
    const p = this.full(dir, name);
    if (p === null) return false;
    try {
      fs.unlinkSync(p);
      return true;
    } catch {
      return false;
    }
  }

  move(dir: HostDir, from: string, to: string): boolean {
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

  /** file_newer (z-file.c): true only when `first` exists and out-dates `second`. */
  newer(dir: HostDir, first: string, second: string): boolean {
    const a = this.full(dir, first);
    const b = this.full(dir, second);
    if (a === null || b === null) return false;
    let sa: fs.Stats;
    try {
      sa = fs.statSync(a);
    } catch {
      return false;
    }
    try {
      return sa.mtimeMs > fs.statSync(b).mtimeMs;
    } catch {
      /* Second missing: the first is trivially newer, which is the state
       * ui-game.c's panic prompt is really asking about. */
      return true;
    }
  }

  list(dir: HostDir): string[] {
    try {
      return fs
        .readdirSync(path.join(this.base, dir), { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  argv(): readonly string[] {
    return this.cmdline;
  }
}
