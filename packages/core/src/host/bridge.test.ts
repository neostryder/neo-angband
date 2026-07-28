/**
 * The bridge has to be TRANSPARENT: a RawFsHost over the transport must behave
 * exactly like a RawFsHost over the filesystem directly, or the desktop build
 * quietly plays a different game from the CLI.
 *
 * So the main test here is a differential one - every assertion is made twice,
 * once direct and once through the wire - rather than a list of round trips.
 * The rest covers what a wire can do that a function call cannot: vanish,
 * answer with rubbish, or be handed arguments by an untrusted caller.
 */

import { describe, expect, it } from "vitest";
import { FileMode, FileType, HostDir } from "./io";
import { RawFsHost } from "./raw";
import type { RawFs } from "./raw";
import { isHostDir, rawFsOverTransport, serveRawFs } from "./bridge";

/** A minimal in-memory RawFs, standing in for the real filesystem. */
function memRaw(): RawFs {
  const files = new Map<string, string>();
  const stamps = new Map<string, number>();
  let clock = 0;
  const key = (d: HostDir, n: string): string => `${d}/${n}`;
  return {
    displayPath: (d, n) => `/base/${d}/${n}`,
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
      const from = key(d, a);
      const text = files.get(from);
      if (text === undefined) return false;
      files.delete(from);
      files.set(key(d, b), text);
      stamps.set(key(d, b), ++clock);
      return true;
    },
    mtime: (d, n) => stamps.get(key(d, n)) ?? null,
    listFiles: (d) =>
      [...files.keys()]
        .filter((k) => k.startsWith(`${d}/`))
        .map((k) => k.slice(d.length + 1))
        .sort(),
  };
}

/** The same RawFs reached directly, and reached over the wire. */
function bothWays(): { direct: RawFsHost; wired: RawFsHost } {
  const raw = memRaw();
  return {
    direct: new RawFsHost(raw),
    wired: new RawFsHost(rawFsOverTransport(serveRawFs(raw))),
  };
}

describe("isHostDir", () => {
  it("accepts exactly init.c's five writable directories", () => {
    for (const d of [HostDir.USER, HostDir.SAVE, HostDir.PANIC, HostDir.SCORES, HostDir.ARCHIVE]) {
      expect(isHostDir(d)).toBe(true);
    }
  });

  it("rejects anything else, including the read-only gamedata roots", () => {
    for (const v of ["gamedata", "customize", "", "../save", null, undefined, 0, {}]) {
      expect(isHostDir(v)).toBe(false);
    }
  });
});

describe("the bridge is transparent", () => {
  it("gives the same answers direct and over the wire", () => {
    const { direct, wired } = bothWays();
    /* Both hosts share one backing store, so each step is performed once and
     * observed from both sides - which is the property that matters. */
    expect(wired.write(HostDir.USER, "a.prf", "line one\n")).toBe("ok");
    expect(direct.read(HostDir.USER, "a.prf")).toBe("line one\n");
    expect(wired.read(HostDir.USER, "a.prf")).toBe("line one\n");

    expect(wired.write(HostDir.USER, "a.prf", "line two\n", FileMode.APPEND)).toBe("ok");
    expect(direct.read(HostDir.USER, "a.prf")).toBe("line one\nline two\n");

    expect(direct.exists(HostDir.USER, "a.prf")).toBe(wired.exists(HostDir.USER, "a.prf"));
    expect(direct.exists(HostDir.USER, "nope")).toBe(wired.exists(HostDir.USER, "nope"));
    expect(direct.displayPath(HostDir.USER, "a.prf")).toBe(
      wired.displayPath(HostDir.USER, "a.prf"),
    );
    expect(direct.list(HostDir.USER)).toEqual(wired.list(HostDir.USER));
  });

  it("keeps each directory separate across the wire", () => {
    const { direct, wired } = bothWays();
    wired.write(HostDir.SAVE, "Bilbo", "save");
    wired.write(HostDir.PANIC, "Bilbo", "panic");
    expect(direct.read(HostDir.SAVE, "Bilbo")).toBe("save");
    expect(direct.read(HostDir.PANIC, "Bilbo")).toBe("panic");
    expect(wired.list(HostDir.SAVE)).toEqual(["Bilbo"]);
    expect(wired.list(HostDir.ARCHIVE)).toEqual([]);
  });

  it("carries file_newer's three branches unchanged", () => {
    /* The branch that matters is "second missing -> TRUE": it is the gate on
     * ui-game.c:709-720's panic-save prompt, so a transport that flattened it
     * would delete the prompt without deleting any code. */
    const { direct, wired } = bothWays();
    wired.write(HostDir.PANIC, "old", "x");
    wired.write(HostDir.SAVE, "new", "x");
    expect(wired.newer(HostDir.PANIC, "old", "absent")).toBe(true);
    expect(direct.newer(HostDir.PANIC, "old", "absent")).toBe(true);
    expect(wired.newer(HostDir.PANIC, "absent", "old")).toBe(false);
    expect(direct.newer(HostDir.PANIC, "absent", "old")).toBe(false);
    expect(wired.newer(HostDir.PANIC, "absent", "alsoabsent")).toBe(false);
  });

  it("carries move and remove", () => {
    const { direct, wired } = bothWays();
    wired.write(HostDir.SAVE, "a", "body");
    expect(wired.move(HostDir.SAVE, "a", "b")).toBe(true);
    expect(direct.read(HostDir.SAVE, "b")).toBe("body");
    expect(direct.exists(HostDir.SAVE, "a")).toBe(false);
    expect(wired.move(HostDir.SAVE, "ghost", "c")).toBe(false);
    expect(wired.remove(HostDir.SAVE, "b")).toBe(true);
    expect(direct.exists(HostDir.SAVE, "b")).toBe(false);
  });

  it("carries the append flag and the file type", () => {
    const seen: unknown[] = [];
    const raw = memRaw();
    const spy: RawFs = {
      ...raw,
      writeText: (d, n, t, append, ftype) => {
        seen.push({ append, ftype });
        return raw.writeText(d, n, t, append, ftype);
      },
    };
    const wired = new RawFsHost(rawFsOverTransport(serveRawFs(spy)));
    wired.write(HostDir.USER, "d.html", "<html>", FileMode.WRITE, FileType.HTML);
    wired.write(HostDir.USER, "d.html", "more", FileMode.APPEND, FileType.TEXT);
    expect(seen).toEqual([
      { append: false, ftype: FileType.HTML },
      { append: true, ftype: FileType.TEXT },
    ]);
  });
});

describe("a transport that misbehaves", () => {
  /** A host whose wire always answers with the given value. */
  const answering = (v: unknown): RawFsHost =>
    new RawFsHost(rawFsOverTransport(() => v));

  it("reports failure rather than throwing when the channel is not there", () => {
    /* undefined is what an unregistered Electron sync channel returns. */
    const h = answering(undefined);
    expect(h.read(HostDir.USER, "a")).toBeNull();
    expect(h.exists(HostDir.USER, "a")).toBe(false);
    expect(h.write(HostDir.USER, "a", "x")).toBe("create-failed");
    expect(h.remove(HostDir.USER, "a")).toBe(false);
    expect(h.move(HostDir.USER, "a", "b")).toBe(false);
    expect(h.list(HostDir.USER)).toEqual([]);
    expect(h.newer(HostDir.USER, "a", "b")).toBe(false);
  });

  it("reports failure rather than throwing when the transport throws", () => {
    const h = new RawFsHost(
      rawFsOverTransport(() => {
        throw new Error("channel closed");
      }),
    );
    expect(h.read(HostDir.USER, "a")).toBeNull();
    expect(h.write(HostDir.USER, "a", "x")).toBe("create-failed");
    expect(h.displayPath(HostDir.USER, "a")).toBe("user/a");
  });

  it("never turns an unknown write reply into success", () => {
    for (const v of [true, 1, "fine", null, undefined, {}]) {
      expect(answering(v).write(HostDir.USER, "a", "x")).toBe("create-failed");
    }
    /* Only the two real outcomes pass through. */
    expect(answering("ok").write(HostDir.USER, "a", "x")).toBe("ok");
    expect(answering("close-failed").write(HostDir.USER, "a", "x")).toBe("close-failed");
  });

  it("does not accept a truthy non-true as a successful boolean", () => {
    expect(answering(1).exists(HostDir.USER, "a")).toBe(false);
    expect(answering("true").remove(HostDir.USER, "a")).toBe(false);
  });

  it("treats a non-finite mtime as 'cannot tell' rather than comparing it", () => {
    /* NaN > NaN is false and Infinity > Infinity is false, so a raw comparison
     * would silently answer "not newer" for both. */
    expect(answering(NaN).newer(HostDir.USER, "a", "b")).toBe(false);
    expect(answering(Infinity).newer(HostDir.USER, "a", "b")).toBe(false);
  });

  it("drops non-string entries out of a listing", () => {
    const h = new RawFsHost(rawFsOverTransport(() => ["a.prf", 7, null, "b.prf"]));
    expect(h.list(HostDir.USER)).toEqual(["a.prf", "b.prf"]);
  });

  it("falls back to a printable path when displayPath comes back wrong", () => {
    expect(answering(42).displayPath(HostDir.SAVE, "Bilbo")).toBe("save/Bilbo");
  });
});

describe("the server validates what the untrusted side sends", () => {
  it("refuses a directory it does not own, without touching the filesystem", () => {
    const touched: string[] = [];
    const raw = memRaw();
    const serve = serveRawFs({
      ...raw,
      readText: (d, n) => {
        touched.push(`${d}/${n}`);
        return raw.readText(d, n);
      },
      listFiles: (d) => {
        touched.push(`list ${d}`);
        return raw.listFiles(d);
      },
    });
    /* The traversal attempt a leaf-only API is meant to make impossible. */
    expect(serve("readText", ["../../etc", "passwd"])).toBeNull();
    expect(serve("readText", ["gamedata", "monster.txt"])).toBeNull();
    expect(serve("listFiles", ["/"])).toEqual([]);
    expect(serve("writeText", ["..", "x", "y", false, 1])).toBe("create-failed");
    expect(serve("isFile", [null, "x"])).toBe(false);
    expect(touched).toEqual([]);
  });

  it("refuses a malformed argument list", () => {
    const serve = serveRawFs(memRaw());
    expect(serve("readText", [HostDir.USER, 42])).toBeNull();
    expect(serve("readText", [HostDir.USER])).toBeNull();
    expect(serve("writeText", [HostDir.USER, "a", 42, false, 1])).toBe("create-failed");
    expect(serve("rename", [HostDir.USER, "a", null])).toBe(false);
    expect(serve("mtime", [HostDir.USER, {}])).toBeNull();
    expect(serve("displayPath", [HostDir.USER, 42])).toBe("");
  });

  it("refuses an op it does not know", () => {
    const serve = serveRawFs(memRaw());
    expect(serve("evalThis", [HostDir.USER, "x"])).toBe(false);
    expect(serve("__proto__", [HostDir.USER, "x"])).toBe(false);
    expect(serve("", [HostDir.USER, "x"])).toBe(false);
  });

  it("serves every op the client sends, so neither end can drift", () => {
    /* If a future op is added to RawFs and only the client learns about it, this
     * fails: the server's default branch answers false for a name it does not
     * know, and a real op never legitimately answers false to a valid call. */
    const raw = memRaw();
    raw.writeText(HostDir.USER, "a.prf", "x", false, FileType.TEXT);
    const serve = serveRawFs(raw);
    const client = rawFsOverTransport((op, args) => {
      const r = serve(op, args);
      if (r === false && op !== "isFile") throw new Error(`server does not serve '${op}'`);
      return r;
    });
    expect(() => {
      client.displayPath(HostDir.USER, "a.prf");
      client.isFile(HostDir.USER, "a.prf");
      client.readText(HostDir.USER, "a.prf");
      client.writeText(HostDir.USER, "b.prf", "y", false, FileType.TEXT);
      client.mtime(HostDir.USER, "a.prf");
      client.listFiles(HostDir.USER);
      client.rename(HostDir.USER, "b.prf", "c.prf");
      client.unlink(HostDir.USER, "c.prf");
    }).not.toThrow();
  });
});
