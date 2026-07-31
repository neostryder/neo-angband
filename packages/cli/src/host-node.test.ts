/**
 * The full-capability host, against a real filesystem in a temp directory.
 *
 * This is the adapter that makes the 18 host-shaped census absences reachable,
 * so the things asserted here are the ones those features depend on: that
 * MODE_APPEND does not truncate (prefs_save appends), that file_newer really
 * compares mtimes (upstream's panic-save prompt is gated on it), and that a
 * leaf name cannot escape its directory.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { FileMode, HostDir, RawFsHost, rawFsOverTransport, serveRawFs } from "@rpgm-tools/neo-angband-core";
import { NodeHost, NodeRawFs } from "./host-node.js";

let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "neo-host-"));
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("NodeHost", () => {
  it("creates the five ANGBAND_DIR_* subdirectories at construction", () => {
    /* init.c's create_needed_dirs. A dump that had to mkdir first would fail
     * on a fresh install. */
    new NodeHost({ base });
    for (const d of ["user", "save", "panic", "scores", "archive"]) {
      expect(fs.statSync(path.join(base, d)).isDirectory()).toBe(true);
    }
  });

  it("declares full capability, and argv passes through", () => {
    const h = new NodeHost({ base, argv: ["-f", "-uAdventurer"] });
    expect(h.capabilities.realFiles).toBe(true);
    expect(h.capabilities.argv).toBe(true);
    expect(h.capabilities.signals).toBe(true);
    expect(h.capabilities.directories).toBe(true);
    /* This is what makes ui-player.c:1250's "You are not allowed to change your
     * name!" reachable at all - it fires only under -f / arg_force_name. */
    expect(h.argv()).toEqual(["-f", "-uAdventurer"]);
  });

  it("round-trips a real file and lists it under its own directory", () => {
    const h = new NodeHost({ base });
    expect(h.write(HostDir.USER, "Adventurer.prf", "body")).toBe("ok");
    expect(h.read(HostDir.USER, "Adventurer.prf")).toBe("body");
    expect(h.exists(HostDir.USER, "Adventurer.prf")).toBe(true);
    /* The bytes are on disk, which is the entire point of this adapter. */
    expect(fs.readFileSync(path.join(base, "user", "Adventurer.prf"), "utf8")).toBe("body");
    expect(h.list(HostDir.USER)).toEqual(["Adventurer.prf"]);
    expect(h.list(HostDir.SAVE)).toEqual([]);
  });

  it("MODE_APPEND appends and MODE_WRITE truncates", () => {
    /* prefs_save is strip-then-append (ui-prefs.c): an adapter that opened "w"
     * for APPEND would silently drop every earlier dump block. */
    const h = new NodeHost({ base });
    h.write(HostDir.USER, "f.prf", "one\n");
    h.write(HostDir.USER, "f.prf", "two\n", FileMode.APPEND);
    expect(h.read(HostDir.USER, "f.prf")).toBe("one\ntwo\n");
    h.write(HostDir.USER, "f.prf", "three\n", FileMode.WRITE);
    expect(h.read(HostDir.USER, "f.prf")).toBe("three\n");
  });

  it("exists is false for a directory, matching file_exists", () => {
    /* z-file.h L135: "exists (and is a file)". */
    const h = new NodeHost({ base });
    fs.mkdirSync(path.join(base, "user", "subdir"));
    expect(h.exists(HostDir.USER, "subdir")).toBe(false);
  });

  it("rejects a leaf name that escapes its directory", () => {
    const h = new NodeHost({ base });
    /* The contract is leaf names within a HostDir; traversal must fail closed
     * rather than write outside the tree. */
    expect(h.write(HostDir.USER, "../escaped.txt", "x")).toBe("create-failed");
    expect(h.read(HostDir.USER, "../escaped.txt")).toBeNull();
    expect(h.exists(HostDir.USER, "../escaped.txt")).toBe(false);
    expect(h.remove(HostDir.USER, "../escaped.txt")).toBe(false);
    expect(fs.existsSync(path.join(base, "escaped.txt"))).toBe(false);
  });

  it("reports create-failed rather than throwing on an unwritable path", () => {
    const h = new NodeHost({ base });
    /* A name that cannot be a file because a directory already holds it. */
    fs.mkdirSync(path.join(base, "user", "taken"));
    expect(h.write(HostDir.USER, "taken", "x")).toBe("create-failed");
  });

  it("move relocates on disk and leaves nothing behind", () => {
    const h = new NodeHost({ base });
    h.write(HostDir.SAVE, "a", "text");
    expect(h.move(HostDir.SAVE, "a", "b")).toBe(true);
    expect(h.read(HostDir.SAVE, "a")).toBeNull();
    expect(h.read(HostDir.SAVE, "b")).toBe("text");
    expect(h.move(HostDir.SAVE, "missing", "c")).toBe(false);
    expect(h.exists(HostDir.SAVE, "c")).toBe(false);
  });

  it("newer compares real mtimes, and handles a missing side", () => {
    /* This one is load-bearing: ui-game.c:709-720 offers the panic save only
     * when file_newer(panicfile, loadpath) is true. */
    const h = new NodeHost({ base });
    h.write(HostDir.SAVE, "old", "x");
    h.write(HostDir.SAVE, "new", "x");
    /* mtime granularity can tie on a fast filesystem, so set them explicitly
     * rather than relying on wall-clock separation. */
    const p = (n: string) => path.join(base, "save", n);
    fs.utimesSync(p("old"), new Date(1000), new Date(1000));
    fs.utimesSync(p("new"), new Date(2000), new Date(2000));
    expect(h.newer(HostDir.SAVE, "new", "old")).toBe(true);
    expect(h.newer(HostDir.SAVE, "old", "new")).toBe(false);
    /* first absent -> false (there is nothing to offer); second absent -> true. */
    expect(h.newer(HostDir.SAVE, "gone", "old")).toBe(false);
    expect(h.newer(HostDir.SAVE, "old", "gone")).toBe(true);
  });

  it("list returns only files, sorted, ignoring subdirectories", () => {
    const h = new NodeHost({ base });
    h.write(HostDir.USER, "b.txt", "x");
    h.write(HostDir.USER, "a.txt", "x");
    fs.mkdirSync(path.join(base, "user", "zdir"));
    expect(h.list(HostDir.USER)).toEqual(["a.txt", "b.txt"]);
  });

  it("defaults to one term, so subwindow screens stay gated until asked for", () => {
    /* The CLI is a single terminal; the Electron shell passes termCount 8. */
    expect(new NodeHost({ base }).capabilities.termCount).toBe(1);
    expect(new NodeHost({ base, termCount: 8 }).capabilities.termCount).toBe(8);
  });
});

/**
 * The exact stack the desktop build runs, minus the Electron IPC hop:
 *
 *   RawFsHost  (core: z-file.c's rules)
 *     -> rawFsOverTransport  (core: the renderer's end of the wire)
 *       -> serveRawFs        (core: the main process's end)
 *         -> NodeRawFs       (here: real syscalls)
 *
 * The unit tests either side of the wire use in-memory fakes, so this is the
 * only place that proves bytes reach a real disk through the whole chain. What
 * Electron adds on top is one structured-clone round trip over a synchronous
 * channel, and every value crossing it is a string, boolean, number or array.
 */
describe("the desktop stack against a real filesystem", () => {
  const wired = (): RawFsHost =>
    new RawFsHost(rawFsOverTransport(serveRawFs(new NodeRawFs(base))), {
      argv: ["-f", "Bilbo"],
    });

  it("writes a real file to a real directory", () => {
    const h = wired();
    expect(h.write(HostDir.USER, "Bilbo.prf", "# Options\n\n")).toBe("ok");
    /* Read with plain fs, not through the host: the host agreeing with itself
     * would prove nothing about what is on disk. */
    expect(fs.readFileSync(path.join(base, "user", "Bilbo.prf"), "utf8")).toBe(
      "# Options\n\n",
    );
    expect(h.read(HostDir.USER, "Bilbo.prf")).toBe("# Options\n\n");
  });

  it("appends across the wire without truncating", () => {
    const h = wired();
    h.write(HostDir.USER, "dump.prf", "first\n");
    h.write(HostDir.USER, "dump.prf", "second\n", FileMode.APPEND);
    expect(fs.readFileSync(path.join(base, "user", "dump.prf"), "utf8")).toBe(
      "first\nsecond\n",
    );
  });

  it("compares real mtimes across the wire", () => {
    /* Stamps are set explicitly: two writes in the same millisecond would tie,
     * and a tie is not "newer". */
    const h = wired();
    h.write(HostDir.PANIC, "Bilbo", "panic");
    h.write(HostDir.SAVE, "Bilbo", "save");
    fs.utimesSync(path.join(base, "panic", "Bilbo"), new Date(2000), new Date(2000));
    fs.utimesSync(path.join(base, "save", "Bilbo"), new Date(1000), new Date(1000));
    /* Same directory, since HostIo compares within one. */
    h.write(HostDir.USER, "newer.txt", "x");
    h.write(HostDir.USER, "older.txt", "x");
    fs.utimesSync(path.join(base, "user", "newer.txt"), new Date(2000), new Date(2000));
    fs.utimesSync(path.join(base, "user", "older.txt"), new Date(1000), new Date(1000));
    expect(h.newer(HostDir.USER, "newer.txt", "older.txt")).toBe(true);
    expect(h.newer(HostDir.USER, "older.txt", "newer.txt")).toBe(false);
    expect(h.newer(HostDir.USER, "newer.txt", "absent.txt")).toBe(true);
    expect(h.newer(HostDir.USER, "absent.txt", "newer.txt")).toBe(false);
  });

  it("moves, lists and removes real files", () => {
    const h = wired();
    h.write(HostDir.SAVE, "a", "body");
    expect(h.move(HostDir.SAVE, "a", "b")).toBe(true);
    expect(fs.existsSync(path.join(base, "save", "a"))).toBe(false);
    expect(fs.readFileSync(path.join(base, "save", "b"), "utf8")).toBe("body");
    expect(h.list(HostDir.SAVE)).toEqual(["b"]);
    expect(h.remove(HostDir.SAVE, "b")).toBe(true);
    expect(fs.existsSync(path.join(base, "save", "b"))).toBe(false);
  });

  it("still refuses to escape a directory when the request comes over the wire", () => {
    /* The renderer is the untrusted side of this transport, so the guard has to
     * hold on the far end - not just in the client that is being bypassed. */
    const h = wired();
    expect(h.write(HostDir.USER, "../escaped.txt", "x")).toBe("create-failed");
    expect(h.read(HostDir.USER, "../../secret")).toBeNull();
    expect(fs.existsSync(path.join(base, "escaped.txt"))).toBe(false);
    expect(fs.readdirSync(base).sort()).toEqual([
      "archive",
      "panic",
      "save",
      "scores",
      "user",
    ]);
  });

  it("reports the real host path for messages, and passes argv through", () => {
    const h = wired();
    expect(h.displayPath(HostDir.USER, "a.prf")).toBe(path.join(base, "user", "a.prf"));
    expect(h.argv()).toEqual(["-f", "Bilbo"]);
  });
});
