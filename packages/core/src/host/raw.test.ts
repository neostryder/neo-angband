/**
 * RawFsHost holds the only copy of z-file.c's rules for a real filesystem, so
 * these tests are what keeps the CLI host and the Electron host from drifting.
 * They drive it over a recording fake, which lets the two things a real fs
 * cannot easily be made to do - a close that fails, an mtime that is missing on
 * exactly one side - be exercised directly.
 */

import { describe, expect, it } from "vitest";
import { FileMode, FileType, HostDir } from "./io.js";
import { ALL_HOST_DIRS, RawFsHost } from "./raw.js";
import type { RawFs } from "./raw.js";

interface Call {
  op: string;
  args: unknown[];
}

/** A RawFs that records every call and lets each result be dictated. */
function fakeRaw(over: Partial<RawFs> = {}): RawFs & { calls: Call[] } {
  const calls: Call[] = [];
  const rec = (op: string, ...args: unknown[]): void => {
    calls.push({ op, args });
  };
  const base: RawFs = {
    displayPath: (d, n) => {
      rec("displayPath", d, n);
      return `/base/${d}/${n}`;
    },
    isFile: (d, n) => {
      rec("isFile", d, n);
      return false;
    },
    readText: (d, n) => {
      rec("readText", d, n);
      return null;
    },
    writeText: (d, n, t, a, f) => {
      rec("writeText", d, n, t, a, f);
      return "ok";
    },
    unlink: (d, n) => {
      rec("unlink", d, n);
      return true;
    },
    rename: (d, a, b) => {
      rec("rename", d, a, b);
      return true;
    },
    mtime: (d, n) => {
      rec("mtime", d, n);
      return null;
    },
    listFiles: (d) => {
      rec("listFiles", d);
      return [];
    },
  };
  return Object.assign({ calls }, base, over);
}

describe("ALL_HOST_DIRS", () => {
  it("is init.c's five writable directories", () => {
    /* The read-only gamedata roots are bundled JSON in this port; these five
     * are the ones the game writes to (init.h:229-241). */
    expect([...ALL_HOST_DIRS]).toEqual(["user", "save", "panic", "scores", "archive"]);
  });
});

describe("RawFsHost capabilities", () => {
  it("declares full capability, because a real filesystem is behind it", () => {
    const h = new RawFsHost(fakeRaw());
    expect(h.capabilities.realFiles).toBe(true);
    expect(h.capabilities.argv).toBe(true);
    expect(h.capabilities.signals).toBe(true);
    expect(h.capabilities.directories).toBe(true);
  });

  it("lets a front end without signal delivery say so", () => {
    /* A sandboxed renderer does not receive SIGINT. Claiming it does would
     * remove ui-game.c's panic save by making a screen believe it is covered. */
    expect(new RawFsHost(fakeRaw(), { signals: false }).capabilities.signals).toBe(false);
  });

  it("defaults to one term and takes ANGBAND_TERM_MAX when the front end has it", () => {
    expect(new RawFsHost(fakeRaw()).capabilities.termCount).toBe(1);
    expect(new RawFsHost(fakeRaw(), { termCount: 8 }).capabilities.termCount).toBe(8);
  });

  it("passes argv through and defaults it to empty", () => {
    expect(new RawFsHost(fakeRaw()).argv()).toEqual([]);
    expect(new RawFsHost(fakeRaw(), { argv: ["-f", "Bilbo"] }).argv()).toEqual(["-f", "Bilbo"]);
  });
});

describe("RawFsHost delegation", () => {
  it("routes each HostIo call to its raw operation, with the directory intact", () => {
    const raw = fakeRaw();
    const h = new RawFsHost(raw);
    h.displayPath(HostDir.USER, "a.prf");
    h.exists(HostDir.SAVE, "Bilbo");
    h.read(HostDir.USER, "a.prf");
    h.remove(HostDir.PANIC, "p");
    h.move(HostDir.ARCHIVE, "x", "y");
    h.list(HostDir.SCORES);
    expect(raw.calls.map((c) => c.op)).toEqual([
      "displayPath",
      "isFile",
      "readText",
      "unlink",
      "rename",
      "listFiles",
    ]);
    expect(raw.calls[1]!.args).toEqual([HostDir.SAVE, "Bilbo"]);
    expect(raw.calls[4]!.args).toEqual([HostDir.ARCHIVE, "x", "y"]);
  });

  it("exists() is file_exists: a directory is not a file", () => {
    /* z-file.h:135 - file_exists is "exists AND is a file", so the raw layer's
     * isFile is the whole answer and RawFsHost must not soften it. */
    const h = new RawFsHost(fakeRaw({ isFile: () => false }));
    expect(h.exists(HostDir.USER, "somedir")).toBe(false);
  });
});

describe("RawFsHost.write", () => {
  it("defaults to MODE_WRITE + FTYPE_TEXT and does not append", () => {
    const raw = fakeRaw();
    new RawFsHost(raw).write(HostDir.USER, "a.prf", "body");
    expect(raw.calls[0]!.args).toEqual([HostDir.USER, "a.prf", "body", false, FileType.TEXT]);
  });

  it("maps MODE_APPEND to append, so prefs_save does not truncate its own file", () => {
    const raw = fakeRaw();
    new RawFsHost(raw).write(HostDir.USER, "a.prf", "more", FileMode.APPEND);
    expect(raw.calls[0]!.args[3]).toBe(true);
  });

  it("passes the file type through, so an HTML dump can be tagged", () => {
    const raw = fakeRaw();
    new RawFsHost(raw).write(
      HostDir.USER,
      "dump.html",
      "<html>",
      FileMode.WRITE,
      FileType.HTML,
    );
    expect(raw.calls[0]!.args[4]).toBe(FileType.HTML);
  });

  it("refuses MODE_READ rather than truncating the file", () => {
    const raw = fakeRaw();
    const h = new RawFsHost(raw);
    expect(h.write(HostDir.USER, "a.prf", "body", FileMode.READ)).toBe("create-failed");
    expect(raw.calls).toEqual([]);
  });

  it("keeps the open failure and the close failure distinct", () => {
    /* wiz-spoil.c prints "Cannot create spoiler file." for one and "Cannot close
     * spoiler file." for the other at the SAME call site, so collapsing these
     * into a boolean would lose a message the census can see. */
    expect(new RawFsHost(fakeRaw({ writeText: () => "create-failed" })).write(
      HostDir.USER, "x", "y",
    )).toBe("create-failed");
    expect(new RawFsHost(fakeRaw({ writeText: () => "close-failed" })).write(
      HostDir.USER, "x", "y",
    )).toBe("close-failed");
  });
});

describe("RawFsHost.newer (file_newer, z-file.c:952-967)", () => {
  /** An mtime table keyed by leaf name; absent means the file is not there. */
  const withTimes = (times: Record<string, number>): RawFsHost =>
    new RawFsHost(fakeRaw({ mtime: (_d, n) => times[n] ?? null }));

  it("is false when the FIRST file is missing", () => {
    /* if (stat(first, &stat1) != 0) return false; */
    expect(withTimes({ second: 100 }).newer(HostDir.SAVE, "first", "second")).toBe(false);
  });

  it("is TRUE when the second file is missing", () => {
    /* if (stat(second, &stat2) != 0) return true; -- this is the branch that
     * decides whether the panic-save prompt appears at all. */
    expect(withTimes({ first: 100 }).newer(HostDir.SAVE, "first", "second")).toBe(true);
  });

  it("is false when NEITHER file exists", () => {
    /* The first stat fails first, so the missing-second branch is never reached. */
    expect(withTimes({}).newer(HostDir.SAVE, "first", "second")).toBe(false);
  });

  it("compares modification times strictly", () => {
    expect(withTimes({ first: 200, second: 100 }).newer(HostDir.SAVE, "first", "second")).toBe(true);
    expect(withTimes({ first: 100, second: 200 }).newer(HostDir.SAVE, "first", "second")).toBe(false);
    /* st_mtime > st_mtime, not >=: an equal stamp is NOT newer. */
    expect(withTimes({ first: 100, second: 100 }).newer(HostDir.SAVE, "first", "second")).toBe(false);
  });

  it("does not stat the second file when the first is already missing", () => {
    /* Records here rather than through fakeRaw's default, because an override
     * replaces the recording implementation rather than wrapping it. */
    const asked: string[] = [];
    const raw = fakeRaw({
      mtime: (_d, n) => {
        asked.push(n);
        return null;
      },
    });
    new RawFsHost(raw).newer(HostDir.SAVE, "first", "second");
    expect(asked).toEqual(["first"]);
  });

  it("never answers null, because a real filesystem always knows", () => {
    /* null is BrowserHost's honest "cannot tell". A real host returning it would
     * make callers take the cannot-tell path they only have for localStorage. */
    const h = withTimes({ first: 200, second: 100 });
    expect(h.newer(HostDir.SAVE, "first", "second")).not.toBeNull();
    expect(h.newer(HostDir.SAVE, "nope", "second")).not.toBeNull();
  });
});
