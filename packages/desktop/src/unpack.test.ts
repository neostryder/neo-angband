/**
 * The unpacker, tested on fixtures this file builds itself.
 *
 * NOTHING HERE SPAWNS A PROGRAM, which is the same property the module under
 * test exists to have. The previous extractor's test built its fixture with a
 * bare `tar`, and that is precisely how the GNU-tar defect stayed hidden for
 * weeks: under a POSIX shell the test failed with `Cannot connect to C:` and
 * read as a flaky test about the fixture rather than as the extractor being the
 * wrong program.
 *
 * SYMLINKS ARE TESTED IN TWO HALVES, deliberately. Reading one out of an archive
 * is arithmetic and is asserted everywhere; CREATING one needs a privilege
 * Windows does not grant by default, so that half is skipped where the OS
 * refuses. Conflating the two would mean a Windows run silently proving nothing
 * about the parse, which is the half that can actually be wrong.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readTarHeader,
  readZipEntries,
  safeEntryPath,
  safeLinkTarget,
  unpackArchive,
  unpackTar,
  unpackZip,
} from "./unpack.js";
import { makeTar, makeZip } from "./zip-fixture.js";

const made: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neo-unpack-"));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Can this machine make a symlink at all? Windows needs a privilege for it. */
const CAN_SYMLINK = ((): boolean => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neo-symlink-probe-"));
  try {
    fs.symlinkSync("target", path.join(dir, "link"));
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

function writeZip(dir: string, entries: Parameters<typeof makeZip>[0]): string {
  const p = path.join(dir, "a.zip");
  fs.writeFileSync(p, makeZip(entries));
  return p;
}

describe("refusing a path that leaves the folder", () => {
  const root = path.resolve("/tmp/staging");

  it("takes an ordinary relative name", () => {
    expect(safeEntryPath(root, "locales/en-US.pak")).toBe(
      path.join(root, "locales", "en-US.pak"),
    );
    /* A zip may spell separators either way; both mean the same nesting. */
    expect(safeEntryPath(root, "locales\\en-US.pak")).toBe(
      path.join(root, "locales", "en-US.pak"),
    );
  });

  it("refuses every way of naming somewhere else", () => {
    for (const bad of [
      "../escape",
      "a/../../escape",
      "/etc/passwd",
      "C:\\Windows\\System32\\x",
      "\\\\server\\share\\x",
      "",
      "a\0b",
    ]) {
      expect(safeEntryPath(root, bad), bad).toBeNull();
    }
  });

  it("is not fooled by a sibling whose name starts with the root", () => {
    /* `<root>-evil` passes a naive startsWith check, which is why the separator
     * is part of the comparison. */
    expect(safeEntryPath(root, "..\\staging-evil\\x")).toBeNull();
    expect(safeEntryPath(root, "../staging-evil/x")).toBeNull();
  });

  it("allows a link inside the tree and refuses one that points out", () => {
    /* Every link in an Electron .app is relative and stays inside it
     * (`Versions/Current -> A`), so refusing the ones that leave costs nothing
     * real and closes a follow-the-link escape. */
    const link = path.join(root, "Frameworks", "Foo.framework", "Foo");
    expect(safeLinkTarget(root, link, "Versions/Current/Foo")).toBe(true);
    expect(safeLinkTarget(root, link, "../../lib.dylib")).toBe(true);
    expect(safeLinkTarget(root, link, "../../../../../../etc/passwd")).toBe(false);
    expect(safeLinkTarget(root, link, "/etc/passwd")).toBe(false);
    expect(safeLinkTarget(root, link, "")).toBe(false);
  });
});

describe("reading a zip's directory", () => {
  function entriesOf(dir: string, spec: Parameters<typeof makeZip>[0]) {
    const p = writeZip(dir, spec);
    const fd = fs.openSync(p, "r");
    try {
      return readZipEntries(fd, fs.statSync(p).size);
    } finally {
      fs.closeSync(fd);
    }
  }

  it("finds every entry with its name, size and kind", () => {
    const got = entriesOf(tmp(), [
      { name: "a.txt", data: "hello" },
      { name: "sub/", kind: "dir" },
      { name: "sub/b.txt", data: "world!" },
    ]);
    expect(got.map((e) => [e.name, e.kind, e.size])).toEqual([
      ["a.txt", "file", 5],
      ["sub", "dir", 0],
      ["sub/b.txt", "file", 6],
    ]);
  });

  it("reads the unix mode out of the HIGH bits of the external attributes", () => {
    /* The low bits are MS-DOS attribute flags. Reading those as a mode gives
     * plausible nonsense - 0 or 0o020 - rather than an obvious failure, so the
     * executable bit on every binary in the archive would silently vanish. */
    const got = entriesOf(tmp(), [
      { name: "run.sh", data: "#!/bin/sh\n", mode: 0o100755 },
      { name: "plain.txt", data: "x", mode: 0o100644 },
    ]);
    expect(got[0]?.mode).toBe(0o755);
    expect(got[1]?.mode).toBe(0o644);
  });

  it("recognises a symlink by its mode, not by its content", () => {
    const got = entriesOf(tmp(), [
      { name: "Current", data: "A", kind: "symlink" },
      /* A regular file whose contents happen to look like a path is NOT a link. */
      { name: "note.txt", data: "A" },
    ]);
    expect(got[0]?.kind).toBe("symlink");
    expect(got[1]?.kind).toBe("file");
  });

  it("refuses a zip64 archive rather than reading a placeholder as an offset", () => {
    /* Every field zip64 widens is one this reader would otherwise take a
     * 0xFFFFFFFF placeholder for and treat as real - a corrupt extraction that
     * looks like a successful one. */
    const dir = tmp();
    const p = writeZip(dir, [{ name: "a.txt", data: "x" }]);
    const buf = fs.readFileSync(p);
    buf.writeUInt32LE(0xffffffff, buf.length - 22 + 16);
    fs.writeFileSync(p, buf);
    const fd = fs.openSync(p, "r");
    try {
      expect(() => readZipEntries(fd, buf.length)).toThrow(/zip64/u);
    } finally {
      fs.closeSync(fd);
    }
  });

  it("says so plainly when the file is not a zip at all", () => {
    const dir = tmp();
    const p = path.join(dir, "not.zip");
    fs.writeFileSync(p, "this is a text file");
    const fd = fs.openSync(p, "r");
    try {
      expect(() => readZipEntries(fd, fs.statSync(p).size)).toThrow(/does not look like a zip/u);
    } finally {
      fs.closeSync(fd);
    }
  });
});

describe("unpacking a zip", () => {
  it("writes the files, with their nesting", async () => {
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeZip(dir, [
      { name: "Neo Angband.exe", data: "pretend binary" },
      { name: "locales/en-US.pak", data: "pak" },
      { name: "resources/app.asar", data: "asar" },
    ]);
    await expect(unpackZip(p, into, "linux")).resolves.toBe(3);
    expect(fs.readFileSync(path.join(into, "Neo Angband.exe"), "utf8")).toBe("pretend binary");
    expect(fs.readFileSync(path.join(into, "locales", "en-US.pak"), "utf8")).toBe("pak");
  });

  it("creates a directory the archive never listed", async () => {
    /* A zip is not required to carry an entry for a directory before the files
     * inside it, and plenty of writers do not. */
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeZip(dir, [{ name: "deep/deeper/x.txt", data: "x" }]);
    await unpackZip(p, into, "linux");
    expect(fs.readFileSync(path.join(into, "deep", "deeper", "x.txt"), "utf8")).toBe("x");
  });

  it("writes an empty file as an empty file", async () => {
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeZip(dir, [{ name: "empty", data: "" }]);
    await unpackZip(p, into, "linux");
    expect(fs.readFileSync(path.join(into, "empty"), "utf8")).toBe("");
  });

  it("refuses an archive that tries to write outside the folder", async () => {
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeZip(dir, [{ name: "../escaped.txt", data: "pwned" }]);
    await expect(unpackZip(p, into, "linux")).rejects.toThrow(/unsafe path/u);
    expect(fs.existsSync(path.join(dir, "escaped.txt"))).toBe(false);
  });

  it("skips the AppleDouble sidecars a mac zip carries", async () => {
    /* `__MACOSX/._Foo` holds the resource fork and extended attributes of `Foo`,
     * which only ditto can reattach. Written as ordinary files they would litter
     * the install with `._` files that are not part of the app. */
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeZip(dir, [
      { name: "Neo Angband.app/Contents/Info.plist", data: "<plist/>" },
      { name: "__MACOSX/Neo Angband.app/Contents/._Info.plist", data: "\0\0" },
    ]);
    await expect(unpackZip(p, into, "linux")).resolves.toBe(1);
    expect(fs.existsSync(path.join(into, "__MACOSX"))).toBe(false);
  });

  it("says the archive was empty rather than reporting success", async () => {
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeZip(dir, []);
    await expect(unpackZip(p, into, "linux")).rejects.toThrow(/empty/u);
  });

  it.skipIf(!CAN_SYMLINK)("recreates a symlink with its target", async () => {
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeZip(dir, [
      { name: "Versions/A/Foo", data: "the real one" },
      { name: "Versions/Current", data: "A", kind: "symlink" },
    ]);
    await unpackZip(p, into, "linux");
    const link = path.join(into, "Versions", "Current");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(link)).toBe("A");
    expect(fs.readFileSync(path.join(link, "Foo"), "utf8")).toBe("the real one");
  });

  it.skipIf(!CAN_SYMLINK)("refuses a symlink that points out of the folder", async () => {
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeZip(dir, [
      { name: "escape", data: "../../../../etc/passwd", kind: "symlink" },
    ]);
    await expect(unpackZip(p, into, "linux")).rejects.toThrow(/link out of the folder/u);
  });

  it.skipIf(process.platform === "win32")("applies the executable bit", async () => {
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeZip(dir, [
      { name: "neo-angband", data: "#!/bin/sh\n", mode: 0o100755 },
      { name: "readme.txt", data: "hi", mode: 0o100644 },
    ]);
    await unpackZip(p, into, process.platform);
    expect(fs.statSync(path.join(into, "neo-angband")).mode & 0o777).toBe(0o755);
    expect(fs.statSync(path.join(into, "readme.txt")).mode & 0o777).toBe(0o644);
  });
});

describe("reading a tar header", () => {
  it("joins the ustar prefix to the name", () => {
    /* A name over 100 bytes is split across `prefix` and `name` with a slash
     * that is stored in neither. A reader that ignores prefix flattens every
     * deep path into the root, which for an app bundle means writing one file
     * over another until only the last survives. */
    const block = Buffer.alloc(512, 0);
    block.write("Foo", 0);
    block.write("resources/app/lib", 345);
    block.write("ustar\0", 257);
    block.write("00000644\0", 100);
    block.write("00000000000\0", 124);
    block.write("0", 156);
    expect(readTarHeader(block)?.name).toBe("resources/app/lib/Foo");
  });

  it("stops at the end-of-archive marker", () => {
    expect(readTarHeader(Buffer.alloc(512, 0))).toBeNull();
  });
});

describe("unpacking a tar", () => {
  function writeTar(dir: string, entries: Parameters<typeof makeTar>[0]): string {
    const p = path.join(dir, "a.tar");
    fs.writeFileSync(p, makeTar(entries));
    return p;
  }

  it("writes files and directories", () => {
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeTar(dir, [
      { name: "neo-angband", data: "pretend binary" },
      { name: "locales", kind: "dir" },
      { name: "locales/en-US.pak", data: "pak" },
    ]);
    expect(unpackTar(p, into, "linux")).toBe(3);
    expect(fs.readFileSync(path.join(into, "neo-angband"), "utf8")).toBe("pretend binary");
    expect(fs.readFileSync(path.join(into, "locales", "en-US.pak"), "utf8")).toBe("pak");
  });

  it("writes a file whose size is not a multiple of the block", () => {
    /* Every tar body is padded to 512 bytes. Copying the padding as content is
     * the classic bug and it produces a file that is right at the front, wrong
     * at the back, and passes any test that only checks the first line. */
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const body = "x".repeat(700);
    const p = writeTar(dir, [{ name: "odd", data: body }]);
    unpackTar(p, into, "linux");
    expect(fs.readFileSync(path.join(into, "odd"), "utf8")).toBe(body);
  });

  it("refuses a path that leaves the folder", () => {
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeTar(dir, [{ name: "../escaped", data: "pwned" }]);
    expect(() => unpackTar(p, into, "linux")).toThrow(/unsafe path/u);
    expect(fs.existsSync(path.join(dir, "escaped"))).toBe(false);
  });

  it.skipIf(!CAN_SYMLINK)("recreates a symlink", () => {
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const p = writeTar(dir, [
      { name: "real", data: "content" },
      { name: "alias", data: "real", kind: "symlink" },
    ]);
    unpackTar(p, into, "linux");
    expect(fs.readlinkSync(path.join(into, "alias"))).toBe("real");
  });
});

describe("choosing the reader", () => {
  it("goes by the name, and says so when it does not know one", async () => {
    /* By extension rather than by sniffing, because the name came from the
     * release asset pickAsset chose deliberately - a file whose contents
     * disagree with its name is a broken release, not something to paper over. */
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const zip = writeZip(dir, [{ name: "a.txt", data: "x" }]);
    await expect(unpackArchive(zip, into, "linux")).resolves.toBe(1);
    await expect(unpackArchive(path.join(dir, "x.dmg"), into, "darwin")).rejects.toThrow(
      /no way to unpack x\.dmg/u,
    );
  });

  it("round-trips a real gzip, which is the Linux path end to end", async () => {
    const dir = tmp();
    const into = path.join(dir, "out");
    fs.mkdirSync(into);
    const { gzipSync } = await import("node:zlib");
    const p = path.join(dir, "payload.tar.gz");
    fs.writeFileSync(p, gzipSync(makeTar([{ name: "neo-angband", data: "binary" }])));
    await expect(unpackArchive(p, into, "linux")).resolves.toBe(1);
    expect(fs.readFileSync(path.join(into, "neo-angband"), "utf8")).toBe("binary");
    /* And the temporary .tar it decompressed through is gone. */
    expect(fs.existsSync(`${p}.plain`)).toBe(false);
  });
});
