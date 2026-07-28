/**
 * An in-memory HostIo: the reference implementation of the host contract, and
 * the one the tests drive.
 *
 * It exists so the file-shaped code paths can be exercised WITHOUT a platform.
 * Before the host seam, the only way to test a dump was to reach into the web
 * layer's localStorage shim, so core code that wrote files could not be tested
 * from core at all - and the failure paths (a write that fails, a file that is
 * older than another) had no way to be provoked deliberately.
 *
 * Capabilities default to full, because this host really can do everything the
 * contract asks; `failWrites` and `truncateWrites` let a test provoke
 * upstream's two distinct write failures on demand.
 */

import type { HostCapabilities, HostIo, WriteOutcome } from "./io";
import { FileMode, HostDir } from "./io";

/** Knobs a test uses to provoke the failure paths. */
export interface MemoryHostOpts {
  /** Override any capability; the rest stay at full. */
  capabilities?: Partial<HostCapabilities>;
  /** argv, minus the program name. */
  argv?: readonly string[];
  /** Names whose write fails at open - upstream's "can't open" message. */
  failWrites?: readonly string[];
  /**
   * Names whose write appears to succeed but stores nothing - upstream's
   * "can't close" message, and the real localStorage failure mode where a
   * quota-evicted setItem does not throw.
   */
  truncateWrites?: readonly string[];
}

const FULL: HostCapabilities = {
  realFiles: true,
  argv: true,
  signals: true,
  /** ANGBAND_TERM_MAX (ui-term.h:244). */
  termCount: 8,
  directories: true,
};

/** A HostIo backed by a Map per directory, with an inspectable file table. */
export class MemoryHost implements HostIo {
  readonly capabilities: HostCapabilities;
  private readonly files = new Map<string, string>();
  /** Monotonic write counter, standing in for an mtime so `newer` is decidable. */
  private readonly stamps = new Map<string, number>();
  private clock = 0;
  private readonly cmdline: readonly string[];
  private readonly failSet: ReadonlySet<string>;
  private readonly truncSet: ReadonlySet<string>;

  constructor(opts: MemoryHostOpts = {}) {
    this.capabilities = { ...FULL, ...opts.capabilities };
    this.cmdline = opts.argv ?? [];
    this.failSet = new Set(opts.failWrites ?? []);
    this.truncSet = new Set(opts.truncateWrites ?? []);
  }

  private key(dir: HostDir, name: string): string {
    return `${dir}/${name}`;
  }

  displayPath(dir: HostDir, name: string): string {
    return `${dir}/${name}`;
  }

  exists(dir: HostDir, name: string): boolean {
    return this.files.has(this.key(dir, name));
  }

  read(dir: HostDir, name: string): string | null {
    return this.files.get(this.key(dir, name)) ?? null;
  }

  write(
    dir: HostDir,
    name: string,
    text: string,
    mode: FileMode = FileMode.WRITE,
  ): WriteOutcome {
    if (this.failSet.has(name)) return "create-failed";
    const k = this.key(dir, name);
    /* MODE_APPEND keeps the current contents; MODE_WRITE overwrites them. */
    const body = mode === FileMode.APPEND ? (this.files.get(k) ?? "") + text : text;
    if (this.truncSet.has(name)) return "close-failed";
    this.files.set(k, body);
    this.stamps.set(k, ++this.clock);
    return "ok";
  }

  remove(dir: HostDir, name: string): boolean {
    const k = this.key(dir, name);
    this.stamps.delete(k);
    return this.files.delete(k);
  }

  move(dir: HostDir, from: string, to: string): boolean {
    const text = this.read(dir, from);
    if (text === null) return false;
    if (this.write(dir, to, text) !== "ok") return false;
    return this.remove(dir, from);
  }

  newer(dir: HostDir, first: string, second: string): boolean | null {
    const a = this.stamps.get(this.key(dir, first));
    const b = this.stamps.get(this.key(dir, second));
    /* file_newer's own answer when either side is missing: it stats both and
     * returns false unless the first exists and is strictly newer. */
    if (a === undefined) return false;
    if (b === undefined) return true;
    return a > b;
  }

  list(dir: HostDir): string[] {
    const prefix = `${dir}/`;
    const out: string[] = [];
    for (const k of this.files.keys()) {
      if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
    return out.sort((x, y) => x.localeCompare(y));
  }

  argv(): readonly string[] {
    return this.cmdline;
  }

  /** Test helper: every file, as dir/name -> text. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}
