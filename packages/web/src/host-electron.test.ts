/**
 * The renderer half of the desktop bridge.
 *
 * Two things matter here and they pull in opposite directions. The desktop shell
 * must actually GET real files - otherwise the whole phase bought nothing - and
 * a browser tab must never be handed a host that claims real files it does not
 * have, because that claim is what would let a screen skip its reduced path and
 * silently do nothing. So detection has to be strict, and every capability the
 * shell reports has to be checked rather than trusted.
 */

import { describe, expect, it } from "vitest";
import { FileMode, HostDir, serveRawFs } from "@neo-angband/core";
import type { RawFs } from "@neo-angband/core";
import {
  HOST_BRIDGE_GLOBAL,
  detectDesktopBridge,
  makeDesktopHost,
} from "./host-electron";
import type { DesktopHostBridge } from "./host-electron";

/** A stand-in for the real filesystem the main process would serve. */
function memRaw(): RawFs {
  const files = new Map<string, string>();
  const stamps = new Map<string, number>();
  let clock = 0;
  const key = (d: HostDir, n: string): string => `${d}/${n}`;
  return {
    displayPath: (d, n) => `C:\\Users\\test\\AppData\\neo\\${d}\\${n}`,
    isFile: (d, n) => files.has(key(d, n)),
    readText: (d, n) => files.get(key(d, n)) ?? null,
    writeText: (d, n, t, append) => {
      const k = key(d, n);
      files.set(k, append ? (files.get(k) ?? "") + t : t);
      stamps.set(k, ++clock);
      return "ok";
    },
    unlink: (d, n) => files.delete(key(d, n)),
    rename: (d, a, b) => {
      const text = files.get(key(d, a));
      if (text === undefined) return false;
      files.delete(key(d, a));
      files.set(key(d, b), text);
      return true;
    },
    mtime: (d, n) => stamps.get(key(d, n)) ?? null,
    listFiles: (d) =>
      [...files.keys()].filter((k) => k.startsWith(`${d}/`)).map((k) => k.slice(d.length + 1)),
  };
}

/** A bridge wired to a real serveRawFs, the way the preload's is. */
function liveBridge(extra: Partial<DesktopHostBridge> = {}): DesktopHostBridge {
  const serve = serveRawFs(memRaw());
  return { call: (op, args) => serve(op, args), ...extra };
}

describe("detectDesktopBridge", () => {
  it("finds a bridge with a callable call()", () => {
    const bridge = liveBridge();
    expect(detectDesktopBridge({ [HOST_BRIDGE_GLOBAL]: bridge })).toBe(bridge);
  });

  it("is null in an ordinary browser tab", () => {
    expect(detectDesktopBridge({})).toBeNull();
  });

  it("rejects anything that is not a usable bridge", () => {
    /* A truthy global is not a bridge. Accepting one would install a host that
     * claims real files and then throws on the first write. */
    for (const v of [true, 1, "yes", null, [], {}, { call: 42 }, { call: null }]) {
      expect(detectDesktopBridge({ [HOST_BRIDGE_GLOBAL]: v })).toBeNull();
    }
  });

  it("tolerates a scope that is not an object", () => {
    for (const s of [null, undefined, 42, "window"]) {
      expect(detectDesktopBridge(s)).toBeNull();
    }
  });
});

describe("makeDesktopHost capabilities", () => {
  it("declares real files, because the shell has them", () => {
    const h = makeDesktopHost(liveBridge());
    expect(h.capabilities.realFiles).toBe(true);
    expect(h.capabilities.directories).toBe(true);
    expect(h.capabilities.argv).toBe(true);
  });

  it("takes argv from the shell and drops non-strings", () => {
    expect(makeDesktopHost(liveBridge({ argv: ["-f", "Bilbo"] })).argv()).toEqual([
      "-f",
      "Bilbo",
    ]);
    expect(makeDesktopHost(liveBridge({ argv: ["-f", 7, null, "x"] })).argv()).toEqual([
      "-f",
      "x",
    ]);
  });

  it("reports no argv when the shell did not send one", () => {
    for (const v of [undefined, null, "-f Bilbo", 42, {}]) {
      expect(makeDesktopHost(liveBridge({ argv: v })).argv()).toEqual([]);
    }
  });

  it("only accepts an explicit true for signal delivery", () => {
    /* A preload that predates the field leaves it undefined, and undefined must
     * not read as yes - claiming a panic save that never fires would remove
     * ui-game.c's prompt without removing any code. */
    expect(makeDesktopHost(liveBridge({ signals: true })).capabilities.signals).toBe(true);
    for (const v of [undefined, false, 1, "true", null]) {
      expect(makeDesktopHost(liveBridge({ signals: v })).capabilities.signals).toBe(false);
    }
  });

  it("clamps termCount to a real term slot", () => {
    /* ANGBAND_TERM_MAX is 8 (ui-term.h:244), so a shell claiming more is
     * claiming windows the game has no index for. */
    expect(makeDesktopHost(liveBridge({ termCount: 8 })).capabilities.termCount).toBe(8);
    expect(makeDesktopHost(liveBridge({ termCount: 99 })).capabilities.termCount).toBe(8);
    for (const v of [undefined, 0, -1, 1.5, NaN, "4", null]) {
      expect(makeDesktopHost(liveBridge({ termCount: v })).capabilities.termCount).toBe(1);
    }
  });
});

describe("makeDesktopHost reaches the real filesystem", () => {
  it("round-trips a file through the bridge", () => {
    const h = makeDesktopHost(liveBridge());
    expect(h.write(HostDir.USER, "Bilbo.prf", "# Options\n")).toBe("ok");
    expect(h.read(HostDir.USER, "Bilbo.prf")).toBe("# Options\n");
    expect(h.exists(HostDir.USER, "Bilbo.prf")).toBe(true);
    expect(h.list(HostDir.USER)).toEqual(["Bilbo.prf"]);
  });

  it("appends without truncating, so prefs_save keeps its own file", () => {
    const h = makeDesktopHost(liveBridge());
    h.write(HostDir.USER, "a.prf", "one\n");
    h.write(HostDir.USER, "a.prf", "two\n", FileMode.APPEND);
    expect(h.read(HostDir.USER, "a.prf")).toBe("one\ntwo\n");
  });

  it("shows the real host path in messages, not a virtual one", () => {
    /* This is what upstream prints in "Cannot open '%s'.", and on the desktop it
     * should be a path the player can actually go and look at. */
    expect(makeDesktopHost(liveBridge()).displayPath(HostDir.USER, "a.prf")).toBe(
      "C:\\Users\\test\\AppData\\neo\\user\\a.prf",
    );
  });

  it("answers file_newer with a real boolean, not 'cannot tell'", () => {
    /* BrowserHost has to return null here because localStorage keeps no mtime.
     * The desktop host having a real answer is the difference that restores
     * ui-game.c:709-720's panic-save prompt. */
    const h = makeDesktopHost(liveBridge());
    h.write(HostDir.PANIC, "Bilbo", "x");
    expect(h.newer(HostDir.PANIC, "Bilbo", "absent")).toBe(true);
    expect(h.newer(HostDir.PANIC, "absent", "Bilbo")).toBe(false);
  });

  it("keeps the five directories apart", () => {
    const h = makeDesktopHost(liveBridge());
    h.write(HostDir.SAVE, "Bilbo", "save");
    h.write(HostDir.ARCHIVE, "Bilbo", "archive");
    expect(h.read(HostDir.SAVE, "Bilbo")).toBe("save");
    expect(h.read(HostDir.ARCHIVE, "Bilbo")).toBe("archive");
    expect(h.list(HostDir.PANIC)).toEqual([]);
  });
});

describe("a bridge that breaks mid-session", () => {
  it("reports failure rather than throwing when call() throws", () => {
    /* The main process can go away - a crash, a reload, a version mismatch. A
     * save must then FAIL visibly, not take the renderer down and not silently
     * claim to have worked. */
    const h = makeDesktopHost({
      call: () => {
        throw new Error("IPC channel closed");
      },
    });
    expect(h.write(HostDir.SAVE, "Bilbo", "x")).toBe("create-failed");
    expect(h.read(HostDir.SAVE, "Bilbo")).toBeNull();
    expect(h.exists(HostDir.SAVE, "Bilbo")).toBe(false);
    expect(h.list(HostDir.SAVE)).toEqual([]);
  });

  it("never turns a rubbish reply into a successful write", () => {
    for (const v of [undefined, true, 1, "fine", {}]) {
      expect(makeDesktopHost({ call: () => v }).write(HostDir.SAVE, "B", "x")).toBe(
        "create-failed",
      );
    }
  });
});
