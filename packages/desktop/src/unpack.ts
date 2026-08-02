/**
 * Unpacking an update WITHOUT shelling out to anything.
 *
 * WHY THIS EXISTS. `extractCommand` used to answer `{cmd: "tar"}`, and PATH does
 * not promise which tar that is: a POSIX-style shell puts GNU tar first, and GNU
 * tar cannot read zip at all and reads any `C:\...` path as a remote host (the
 * colon is what does it). That was
 * pinned to System32's bsdtar, which fixed it - and left the shape of the
 * problem in place. The game still depended on a program it did not ship,
 * resolved at runtime, on a machine nobody here can inspect.
 *
 * The rule this is built to, stated by neostryder: the game must not expect the
 * player to have any command-line tool installed. Windows and Linux updates are
 * now unpacked by this module, using `node:zlib` - which is inside the runtime
 * Electron already is.
 *
 * MACOS IS DELIBERATELY STILL `ditto`, AT ITS ABSOLUTE PATH. Not an oversight
 * and not laziness: `ditto` preserves the symlinks, permissions and AppleDouble
 * metadata a `.app` bundle needs, and nobody on this project has a Mac to prove
 * that a hand-rolled unzip produces a bundle that still LAUNCHES. The reader
 * below does handle symlinks and mode bits, so switching macOS over is a one-line
 * change - but it should be made by somebody who can then run the app, not by
 * somebody who can only run the tests. `/usr/bin/ditto` ships with macOS, so the
 * rule above is still met; what is not met is the stronger version of it, and
 * saying which is which is the point.
 *
 * WHAT IS NOT TRUSTED. An archive is a downloaded file. Every entry name is
 * checked against the destination before anything is written, so `../` and an
 * absolute path are refused rather than escaping the staging directory, and a
 * symlink whose target leaves the tree is refused for the same reason - a link
 * is a path that gets followed later, which is the part that makes it worth
 * checking. The digest was already verified before we got here; that proves the
 * bytes are the ones GitHub described, not that they are harmless.
 *
 * MEMORY IS BOUNDED. These archives are 120-165 MB and the single largest file
 * inside one is most of that. Nothing here reads a whole archive, or a whole
 * entry, into a Buffer: the central directory (tens of kilobytes) is parsed in
 * memory and every entry's bytes are streamed from one file to another.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { pipeline } from "node:stream/promises";

/** What one archive member is. */
export type EntryKind = "file" | "dir" | "symlink";

/** One member of an archive, before anything is written. */
export interface ArchiveEntry {
  /** Normalised to forward slashes, with no leading slash. */
  readonly name: string;
  readonly kind: EntryKind;
  /**
   * Unix permission bits, or 0 when the archive did not record any.
   *
   * A zip written on Windows carries MS-DOS attributes rather than a Unix mode,
   * and 0 is the honest answer there - the caller applies a default rather than
   * inventing 0o644 and calling it recorded.
   */
  readonly mode: number;
  readonly size: number;
  /** Where in the file the entry's bytes are, for a zip. */
  readonly offset: number;
  readonly compressedSize: number;
  /** 0 stored, 8 deflate. */
  readonly method: number;
}

/** The subset of a mode that says what kind of thing this is. */
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const S_IFDIR = 0o040000;

/**
 * Is this name safe to write under `root`?
 *
 * Returns the absolute path, or null when the entry must be refused. Absolute
 * names, drive letters, UNC paths and any `..` segment are all refused - and the
 * final answer is checked against the resolved root as well, because the list of
 * ways to spell "somewhere else" is not one worth trying to enumerate.
 */
export function safeEntryPath(root: string, name: string): string | null {
  if (name === "" || name.includes("\0")) return null;
  const norm = name.replace(/\\/gu, "/");
  if (norm.startsWith("/") || /^[A-Za-z]:/u.test(norm)) return null;
  if (norm.split("/").some((seg) => seg === "..")) return null;
  const full = path.resolve(root, norm);
  const base = path.resolve(root);
  /* The separator matters: `<root>-evil` starts with `<root>` as a string. */
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

/**
 * Is this symlink target safe?
 *
 * Resolved against the link's own directory, because that is how the OS will
 * resolve it. Every link inside an Electron `.app` is relative and stays inside
 * the bundle (`Versions/Current -> A`), so refusing the ones that leave costs
 * nothing real and closes a link-following escape.
 */
export function safeLinkTarget(root: string, linkPath: string, target: string): boolean {
  if (target === "" || target.includes("\0")) return false;
  if (path.isAbsolute(target)) return false;
  const resolved = path.resolve(path.dirname(linkPath), target);
  const base = path.resolve(root);
  return resolved === base || resolved.startsWith(base + path.sep);
}

/* ------------------------------------------------------------------ zip --- */

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * Find the End Of Central Directory record.
 *
 * It is at the end of the file, but a zip may carry a trailing comment of up to
 * 65535 bytes, so the signature has to be searched for backwards. Scanning the
 * last 64 KiB + 22 covers every legal comment length.
 */
function findEocd(fd: number, fileSize: number): { buf: Buffer; at: number } {
  const want = Math.min(fileSize, 0xffff + 22);
  const buf = Buffer.alloc(want);
  fs.readSync(fd, buf, 0, want, fileSize - want);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return { buf, at: i };
  }
  throw new Error("this does not look like a zip archive (no end-of-directory record)");
}

/**
 * Every entry in a zip, read from the CENTRAL directory and not the local
 * headers.
 *
 * The distinction is load-bearing. A local header is allowed to carry zeroes for
 * the sizes and the CRC, with the real values in a data descriptor AFTER the
 * compressed bytes - which is what a zip written by a streaming writer does, and
 * it is unreadable forwards. The central directory always has them.
 */
export function readZipEntries(fd: number, fileSize: number): ArchiveEntry[] {
  const { buf: tail, at } = findEocd(fd, fileSize);

  /*
   * Zip64 is REFUSED rather than half-supported. Every field it widens is one
   * this reader would otherwise take a 0xFFFFFFFF placeholder for and treat as a
   * real offset, which is a corrupt extraction that looks like a successful one.
   * Our archives are ~160 MB with a couple of thousand entries, well inside the
   * 32-bit limits, so reaching this is a change in how releases are built and
   * deserves to stop rather than to be guessed at.
   */
  const totalEntries = tail.readUInt16LE(at + 10);
  const centralSize = tail.readUInt32LE(at + 12);
  const centralOffset = tail.readUInt32LE(at + 16);
  const zip64 =
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    (at >= 20 && tail.readUInt32LE(at - 20) === EOCD64_LOCATOR_SIG);
  if (zip64) throw new Error("this archive uses zip64, which this unpacker does not read");

  const central = Buffer.alloc(centralSize);
  fs.readSync(fd, central, 0, centralSize, centralOffset);

  const out: ArchiveEntry[] = [];
  let p = 0;
  while (p + 46 <= central.length) {
    if (central.readUInt32LE(p) !== CENTRAL_SIG) break;
    const madeBy = central.readUInt16LE(p + 4);
    const method = central.readUInt16LE(p + 10);
    const compressedSize = central.readUInt32LE(p + 20);
    const size = central.readUInt32LE(p + 24);
    const nameLen = central.readUInt16LE(p + 28);
    const extraLen = central.readUInt16LE(p + 30);
    const commentLen = central.readUInt16LE(p + 32);
    const external = central.readUInt32LE(p + 38);
    const localOffset = central.readUInt32LE(p + 42);
    const name = central.toString("utf8", p + 46, p + 46 + nameLen).replace(/\\/gu, "/");

    /*
     * The Unix mode is in the HIGH sixteen bits of the external attributes, and
     * only when the archive says it was made on a Unix host (the high byte of
     * `version made by` is 3). A zip written on Windows puts MS-DOS attribute
     * flags in the low byte instead, and reading those as a mode produces
     * plausible nonsense - 0o000 or 0o020 - rather than an obvious failure.
     */
    const mode = (madeBy >> 8) === 3 ? (external >>> 16) & 0xffff : 0;
    const kind: EntryKind =
      (mode & S_IFMT) === S_IFLNK
        ? "symlink"
        : name.endsWith("/") || (mode & S_IFMT) === S_IFDIR
          ? "dir"
          : "file";

    out.push({
      name: kind === "dir" ? name.replace(/\/+$/u, "") : name,
      kind,
      mode: mode & 0o7777,
      size,
      offset: localOffset,
      compressedSize,
      method,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Where an entry's compressed bytes actually start, past its local header. */
function dataStart(fd: number, localOffset: number): number {
  const head = Buffer.alloc(30);
  fs.readSync(fd, head, 0, 30, localOffset);
  if (head.readUInt32LE(0) !== LOCAL_SIG) {
    throw new Error("the archive's directory points at something that is not an entry");
  }
  /* The LOCAL header's name and extra lengths, which are allowed to differ from
   * the central directory's - the extra field commonly does. */
  return localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
}

/** Read one entry's bytes into memory. Only ever called for a symlink target. */
function readEntryBytes(fd: number, archive: string, e: ArchiveEntry): Buffer {
  const start = dataStart(fd, e.offset);
  const raw = Buffer.alloc(e.compressedSize);
  fs.readSync(fd, raw, 0, e.compressedSize, start);
  if (e.method === 0) return raw;
  if (e.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`${archive}: unsupported compression method ${String(e.method)}`);
}

/** Stream one entry's bytes to a file, inflating on the way if it is deflated. */
async function writeEntry(
  archive: string,
  fd: number,
  e: ArchiveEntry,
  dest: string,
): Promise<void> {
  const start = dataStart(fd, e.offset);
  if (e.compressedSize === 0) {
    fs.writeFileSync(dest, "");
    return;
  }
  const read = fs.createReadStream(archive, { start, end: start + e.compressedSize - 1 });
  const write = fs.createWriteStream(dest);
  if (e.method === 0) {
    await pipeline(read, write);
    return;
  }
  if (e.method !== 8) {
    read.destroy();
    write.destroy();
    throw new Error(`unsupported compression method ${String(e.method)} in ${e.name}`);
  }
  await pipeline(read, zlib.createInflateRaw(), write);
}

/**
 * Apply an entry's recorded permissions, where there were any.
 *
 * Silently skipped on Windows, which has no Unix mode and where `chmod` only
 * ever toggles the read-only attribute. Skipped for mode 0 too: that means the
 * archive did not record one, and forcing a default would be inventing an
 * answer.
 */
function applyMode(dest: string, mode: number, platform: string): void {
  if (platform === "win32" || mode === 0) return;
  try {
    fs.chmodSync(dest, mode);
  } catch {
    /* A filesystem that will not take it (an exFAT stick) is not a reason to
     * fail an update that has otherwise been written. */
  }
}

/** Entries that are metadata about other entries rather than files to write. */
function isMetadataEntry(name: string): boolean {
  /* macOS AppleDouble sidecars: `__MACOSX/._Foo` carries the resource fork and
   * extended attributes of `Foo`, which only `ditto` can reattach. Writing them
   * as ordinary files would litter the install with `._` files that are not part
   * of the app. This is one of the reasons macOS still uses ditto. */
  return name === "__MACOSX" || name.startsWith("__MACOSX/") || name.endsWith("/.DS_Store");
}

/**
 * Unpack a zip into a directory that already exists.
 *
 * Directories first, then files, then symlinks. The order matters twice: a zip
 * is not required to list a directory before the files in it, and a symlink may
 * point at a file that has not been written yet - on a filesystem that checks,
 * creating it early fails.
 */
export async function unpackZip(archive: string, into: string, platform: string): Promise<number> {
  const fd = fs.openSync(archive, "r");
  try {
    const size = fs.statSync(archive).size;
    const entries = readZipEntries(fd, size).filter((e) => !isMetadataEntry(e.name));
    if (entries.length === 0) throw new Error("the archive was empty");

    const resolve = (e: ArchiveEntry): string => {
      const dest = safeEntryPath(into, e.name);
      if (dest === null) throw new Error(`the archive contains an unsafe path: ${e.name}`);
      return dest;
    };

    for (const e of entries) {
      if (e.kind !== "dir") continue;
      fs.mkdirSync(resolve(e), { recursive: true });
    }
    for (const e of entries) {
      if (e.kind !== "file") continue;
      const dest = resolve(e);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      await writeEntry(archive, fd, e, dest);
      applyMode(dest, e.mode, platform);
    }
    for (const e of entries) {
      if (e.kind !== "symlink") continue;
      const dest = resolve(e);
      const target = readEntryBytes(fd, archive, e).toString("utf8");
      if (!safeLinkTarget(into, dest, target)) {
        throw new Error(`the archive contains a link out of the folder: ${e.name} -> ${target}`);
      }
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.rmSync(dest, { force: true });
      fs.symlinkSync(target, dest);
    }
    return entries.length;
  } finally {
    fs.closeSync(fd);
  }
}

/* ------------------------------------------------------------------ tar --- */

const TAR_BLOCK = 512;

/** An octal field, space- and NUL-padded as tar writes them. */
function octal(buf: Buffer, at: number, len: number): number {
  const text = buf.toString("ascii", at, at + len).replace(/\0.*$/u, "").trim();
  if (text === "") return 0;
  const n = Number.parseInt(text, 8);
  return Number.isFinite(n) ? n : 0;
}

/** One tar header, or null at the end-of-archive marker. */
export function readTarHeader(
  block: Buffer,
): { name: string; size: number; mode: number; type: string; link: string } | null {
  /* Two 512-byte blocks of zeroes end an archive; one is enough to stop at. */
  if (block.every((b) => b === 0)) return null;
  const str = (at: number, len: number): string =>
    block.toString("utf8", at, at + len).replace(/\0.*$/u, "");
  const name = str(0, 100);
  /* ustar splits a long name across `prefix` and `name`, and the join is a
   * slash that is stored in neither. A reader that ignores prefix silently
   * flattens deep paths into the root, which for an app bundle means writing
   * `Electron Framework` over and over. */
  const prefix = block.toString("ascii", 257, 262) === "ustar" ? str(345, 155) : "";
  return {
    name: prefix === "" ? name : `${prefix}/${name}`,
    mode: octal(block, 100, 8) & 0o7777,
    size: octal(block, 124, 12),
    type: block.toString("ascii", 156, 157),
    link: str(157, 100),
  };
}

/**
 * Unpack a .tar.gz.
 *
 * TWO PASSES, VIA A TEMPORARY .tar, and the reason is worth stating because the
 * one-pass version looks obviously better. Gzip only decompresses forwards, so a
 * single pass means a state machine that carries a partially-read 512-byte
 * header and a partially-written file across arbitrary chunk boundaries, with
 * backpressure - which is precisely where this kind of code goes wrong, and the
 * failure is a silently truncated file inside an app that then does not start.
 * Decompressing to a temporary file first makes the tar reader random-access and
 * boring. It costs disk that the download already needed, transiently, on the
 * one platform whose archive is a tarball.
 */
export async function unpackTarGz(
  archive: string,
  into: string,
  platform: string,
): Promise<number> {
  const plain = `${archive}.plain`;
  try {
    await pipeline(
      fs.createReadStream(archive),
      zlib.createGunzip(),
      fs.createWriteStream(plain),
    );
    return unpackTar(plain, into, platform);
  } finally {
    fs.rmSync(plain, { force: true });
  }
}

/** Unpack an uncompressed tar. Also the second half of unpackTarGz. */
export function unpackTar(archive: string, into: string, platform: string): number {
  const fd = fs.openSync(archive, "r");
  try {
    const total = fs.statSync(archive).size;
    const header = Buffer.alloc(TAR_BLOCK);
    const copy = Buffer.alloc(64 * 1024);
    const links: { dest: string; target: string; name: string }[] = [];
    let at = 0;
    let count = 0;
    /* GNU tar writes a name longer than 100 bytes as an 'L' entry whose CONTENT
     * is the name, immediately before the entry it belongs to. */
    let pendingName: string | null = null;

    while (at + TAR_BLOCK <= total) {
      if (fs.readSync(fd, header, 0, TAR_BLOCK, at) < TAR_BLOCK) break;
      const h = readTarHeader(header);
      at += TAR_BLOCK;
      if (!h) break;
      const dataAt = at;
      at += Math.ceil(h.size / TAR_BLOCK) * TAR_BLOCK;

      if (h.type === "L" || h.type === "K") {
        const buf = Buffer.alloc(h.size);
        fs.readSync(fd, buf, 0, h.size, dataAt);
        pendingName = buf.toString("utf8").replace(/\0.*$/u, "");
        continue;
      }
      /* pax extended headers ('x'/'g') describe the NEXT entry in a key=value
       * block. Skipped rather than parsed: everything they can override is
       * something the ustar fields already carry for our archives, and a
       * half-read pax record is worse than none. */
      if (h.type === "x" || h.type === "g") continue;

      const name = pendingName ?? h.name;
      pendingName = null;
      if (name === "" || isMetadataEntry(name)) continue;
      const dest = safeEntryPath(into, name);
      if (dest === null) throw new Error(`the archive contains an unsafe path: ${name}`);

      if (h.type === "5") {
        fs.mkdirSync(dest, { recursive: true });
        applyMode(dest, h.mode, platform);
        count++;
        continue;
      }
      if (h.type === "2") {
        links.push({ dest, target: h.link, name });
        count++;
        continue;
      }
      /* '1' is a hard link and '3'-'7' are devices and FIFOs. None appears in a
       * build artifact, and creating one from a downloaded archive is not
       * something this needs to be able to do. */
      if (h.type !== "0" && h.type !== "\0" && h.type !== "") continue;

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.openSync(dest, "w");
      try {
        let left = h.size;
        let from = dataAt;
        while (left > 0) {
          const n = fs.readSync(fd, copy, 0, Math.min(copy.length, left), from);
          if (n <= 0) throw new Error(`the archive ended inside ${name}`);
          fs.writeSync(out, copy, 0, n);
          from += n;
          left -= n;
        }
      } finally {
        fs.closeSync(out);
      }
      applyMode(dest, h.mode, platform);
      count++;
    }

    /* Links last, for the same reason as in a zip: a link may point at a file
     * that had not been written when its own header went past. */
    for (const l of links) {
      if (!safeLinkTarget(into, l.dest, l.target)) {
        throw new Error(`the archive contains a link out of the folder: ${l.name} -> ${l.target}`);
      }
      fs.mkdirSync(path.dirname(l.dest), { recursive: true });
      fs.rmSync(l.dest, { force: true });
      fs.symlinkSync(l.target, l.dest);
    }
    if (count === 0) throw new Error("the archive was empty");
    return count;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Unpack whichever of the two formats this is, by name.
 *
 * By EXTENSION rather than by sniffing the first bytes, because the name came
 * from the release asset we chose deliberately (`pickAsset`) and a file whose
 * contents disagree with its name is a release that is wrong in a way an
 * unpacker should not paper over.
 */
export async function unpackArchive(
  archive: string,
  into: string,
  platform: string,
): Promise<number> {
  if (archive.endsWith(".tar.gz") || archive.endsWith(".tgz")) {
    return unpackTarGz(archive, into, platform);
  }
  if (archive.endsWith(".zip")) return unpackZip(archive, into, platform);
  throw new Error(`there is no way to unpack ${path.basename(archive)}`);
}
