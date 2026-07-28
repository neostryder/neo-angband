/**
 * The host contract, and the two things it exists to stop:
 *
 *  1. a write that reports success while storing nothing (the persistSave
 *     failure mode - a setItem returning void under every layer that claimed
 *     to have worked), and
 *  2. an absent host silently behaving like an empty-but-working one.
 *
 * textLinesToFile is tested against z-textblock.c L703-737 directly, because it
 * was previously duplicated in the web layer where core could not reach it.
 */

import { describe, expect, it } from "vitest";
import { HostDir, FileMode, NULL_HOST, host, setHost, textLinesToFile } from "./io";
import { MemoryHost } from "./memory";

describe("NULL_HOST", () => {
  it("fails every write rather than reporting a silent success", () => {
    /* The whole point: a missing host must be indistinguishable from a broken
     * disk, never from an empty working one. */
    expect(NULL_HOST.write(HostDir.USER, "dump.txt", "x")).toBe("create-failed");
    expect(NULL_HOST.exists(HostDir.USER, "dump.txt")).toBe(false);
    expect(NULL_HOST.read(HostDir.USER, "dump.txt")).toBeNull();
    expect(NULL_HOST.list(HostDir.USER)).toEqual([]);
  });

  it("reports no capabilities, so no screen can mistake it for a real host", () => {
    expect(NULL_HOST.capabilities.realFiles).toBe(false);
    expect(NULL_HOST.capabilities.argv).toBe(false);
    expect(NULL_HOST.capabilities.signals).toBe(false);
    expect(NULL_HOST.capabilities.termCount).toBe(1);
    expect(NULL_HOST.capabilities.directories).toBe(false);
  });

  it("cannot compare timestamps, and says so with null rather than false", () => {
    /* ui-game.c:709-720 offers the panic save only when file_newer is TRUE. A
     * host that guessed `false` would silently delete the prompt; null is the
     * honest answer and forces the caller to handle "cannot tell". */
    expect(NULL_HOST.newer(HostDir.PANIC, "a", "b")).toBeNull();
  });
});

describe("setHost / host", () => {
  it("defaults to NULL_HOST and returns what was installed", () => {
    expect(host()).toBe(NULL_HOST);
    const mem = new MemoryHost();
    setHost(mem);
    expect(host()).toBe(mem);
    setHost(NULL_HOST);
    expect(host()).toBe(NULL_HOST);
  });
});

describe("MemoryHost", () => {
  it("round-trips a file and lists it under its own directory only", () => {
    const h = new MemoryHost();
    expect(h.write(HostDir.USER, "Adventurer.prf", "body")).toBe("ok");
    expect(h.read(HostDir.USER, "Adventurer.prf")).toBe("body");
    expect(h.exists(HostDir.USER, "Adventurer.prf")).toBe(true);
    /* Same leaf name, different directory: a savefile is not a pref file. */
    expect(h.read(HostDir.SAVE, "Adventurer.prf")).toBeNull();
    expect(h.list(HostDir.USER)).toEqual(["Adventurer.prf"]);
    expect(h.list(HostDir.SAVE)).toEqual([]);
  });

  it("MODE_APPEND keeps the current contents, MODE_WRITE replaces them", () => {
    /* prefs_save is strip-then-APPEND, not overwrite (ui-prefs.c), so an
     * adapter that ignored the mode would silently lose the earlier dump. */
    const h = new MemoryHost();
    h.write(HostDir.USER, "f", "one\n");
    h.write(HostDir.USER, "f", "two\n", FileMode.APPEND);
    expect(h.read(HostDir.USER, "f")).toBe("one\ntwo\n");
    h.write(HostDir.USER, "f", "three\n", FileMode.WRITE);
    expect(h.read(HostDir.USER, "f")).toBe("three\n");
  });

  it("keeps open-failure and close-failure distinct", () => {
    /* wiz-spoil.c prints different messages for the two, so one boolean would
     * collapse two upstream messages into one. */
    const h = new MemoryHost({ failWrites: ["nope"], truncateWrites: ["trunc"] });
    expect(h.write(HostDir.USER, "nope", "x")).toBe("create-failed");
    expect(h.write(HostDir.USER, "trunc", "x")).toBe("close-failed");
    /* A close-failure stores nothing - the point of detecting it at all. */
    expect(h.read(HostDir.USER, "trunc")).toBeNull();
    expect(h.write(HostDir.USER, "fine", "x")).toBe("ok");
  });

  it("move relocates the text and leaves nothing behind", () => {
    const h = new MemoryHost();
    h.write(HostDir.USER, "a", "text");
    expect(h.move(HostDir.USER, "a", "b")).toBe(true);
    expect(h.read(HostDir.USER, "a")).toBeNull();
    expect(h.read(HostDir.USER, "b")).toBe("text");
    /* file_move on a missing source fails rather than creating an empty file. */
    expect(h.move(HostDir.USER, "missing", "c")).toBe(false);
    expect(h.exists(HostDir.USER, "c")).toBe(false);
  });

  it("newer follows file_newer: later write wins, missing first is false", () => {
    const h = new MemoryHost();
    h.write(HostDir.SAVE, "old", "x");
    h.write(HostDir.SAVE, "new", "x");
    expect(h.newer(HostDir.SAVE, "new", "old")).toBe(true);
    expect(h.newer(HostDir.SAVE, "old", "new")).toBe(false);
    /* first absent -> false (nothing to offer); second absent -> true. */
    expect(h.newer(HostDir.SAVE, "gone", "old")).toBe(false);
    expect(h.newer(HostDir.SAVE, "old", "gone")).toBe(true);
  });

  it("reports the full capability set, including 8 terms", () => {
    /* ui-term.h:244 ANGBAND_TERM_MAX 8. A host claiming fewer is what makes
     * the subwindow screens legitimately unavailable. */
    const h = new MemoryHost();
    expect(h.capabilities.termCount).toBe(8);
    const one = new MemoryHost({ capabilities: { termCount: 1 } });
    expect(one.capabilities.termCount).toBe(1);
    expect(one.capabilities.realFiles).toBe(true);
  });

  it("argv is empty by default and passes through what was given", () => {
    expect(new MemoryHost().argv()).toEqual([]);
    expect(new MemoryHost({ argv: ["-f", "-uAdventurer"] }).argv()).toEqual([
      "-f",
      "-uAdventurer",
    ]);
  });
});

describe("textLinesToFile (z-textblock.c L703-737)", () => {
  it("writes through to the target and leaves no staging files", () => {
    const h = new MemoryHost();
    expect(textLinesToFile(h, HostDir.USER, "dump.txt", "body")).toBe(0);
    expect(h.read(HostDir.USER, "dump.txt")).toBe("body");
    expect(h.exists(HostDir.USER, "dump.txt.new")).toBe(false);
    expect(h.exists(HostDir.USER, "dump.txt.old")).toBe(false);
  });

  it("replaces an existing file and removes the .old rotation", () => {
    const h = new MemoryHost();
    h.write(HostDir.USER, "dump.txt", "previous");
    expect(textLinesToFile(h, HostDir.USER, "dump.txt", "next")).toBe(0);
    expect(h.read(HostDir.USER, "dump.txt")).toBe("next");
    expect(h.exists(HostDir.USER, "dump.txt.old")).toBe(false);
    expect(h.exists(HostDir.USER, "dump.txt.new")).toBe(false);
  });

  it("returns -1 when the staged write fails, and touches nothing", () => {
    /* The C's callers test the return: `if (text_lines_to_file(...)) msg(...)`.
     * The pre-existing file must survive a failed replacement. */
    const h = new MemoryHost({ failWrites: ["dump.txt.new"] });
    h.write(HostDir.USER, "dump.txt", "previous");
    expect(textLinesToFile(h, HostDir.USER, "dump.txt", "next")).toBe(-1);
    expect(h.read(HostDir.USER, "dump.txt")).toBe("previous");
  });
});
