/**
 * A zip WRITER, for tests only.
 *
 * The unpacker has to be provable on any machine, and every obvious way to build
 * a zip fixture reaches for a program: `Compress-Archive` is Windows-only,
 * bsdtar can write one and GNU tar cannot, and a library would be a dependency
 * added to the package whose whole point is not needing one. Building the bytes
 * here is forty lines and it removes the question - which is the same argument
 * the module it tests is built on.
 *
 * It writes STORED entries only (no compression). Deflate is exercised by the
 * real release archives, not by a fixture; what a fixture is good for is the
 * structure - directory ordering, unix modes, symlinks, and the paths a hostile
 * archive would use. Those are all in the headers, not in the compressor.
 *
 * Not imported by main.ts or preload.ts, so it is not in either bundle.
 */

import { crc32 } from "node:zlib";

/** One member to write. `data` is the content, or a symlink's target. */
export interface ZipFixtureEntry {
  readonly name: string;
  readonly data?: string | Buffer;
  /** Full unix mode including the type bits. Defaults by kind. */
  readonly mode?: number;
  readonly kind?: "file" | "dir" | "symlink";
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

/** Version-made-by: high byte 3 says "unix", which is what puts a mode in. */
const MADE_BY_UNIX = (3 << 8) | 20;

const DEFAULT_MODE = { file: 0o100644, dir: 0o040755, symlink: 0o120777 } as const;

export function makeZip(entries: readonly ZipFixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const kind = e.kind ?? (e.name.endsWith("/") ? "dir" : "file");
    const name = kind === "dir" && !e.name.endsWith("/") ? `${e.name}/` : e.name;
    const body = kind === "dir" ? Buffer.alloc(0) : Buffer.from(e.data ?? "");
    const nameBytes = Buffer.from(name, "utf8");
    const sum = body.length === 0 ? 0 : crc32(body);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // no flags: sizes are here, no data descriptor
    local.writeUInt16LE(0, 10); // stored
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(MADE_BY_UNIX, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    /* The mode goes in the HIGH sixteen bits of the external attributes. The
     * `>>> 0` is not decoration: `<< 16` in JavaScript yields a SIGNED 32-bit
     * result, so any mode with the type bits set (0o100644 and up) comes out
     * negative and writeUInt32LE throws. */
    central.writeUInt32LE(((((e.mode ?? DEFAULT_MODE[kind]) & 0xffff) << 16) >>> 0), 38);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

/**
 * A minimal ustar tar, for the Linux path's tests.
 *
 * Same argument as makeZip: GNU tar and bsdtar disagree about enough that a
 * fixture built by "whichever one is here" is a fixture that tests a different
 * thing on each machine.
 */
export function makeTar(entries: readonly ZipFixtureEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const kind = e.kind ?? (e.name.endsWith("/") ? "dir" : "file");
    const body = kind === "dir" ? Buffer.alloc(0) : Buffer.from(e.data ?? "");
    const size = kind === "symlink" ? 0 : body.length;
    const head = Buffer.alloc(512, 0);
    const put = (text: string, at: number, len: number): void => {
      head.write(text.slice(0, len - 1), at, "utf8");
    };
    const oct = (n: number, at: number, len: number): void => {
      head.write(n.toString(8).padStart(len - 1, "0"), at, "ascii");
    };
    put(e.name, 0, 100);
    oct((e.mode ?? DEFAULT_MODE[kind]) & 0o7777, 100, 8);
    oct(0, 108, 8);
    oct(0, 116, 8);
    oct(size, 124, 12);
    oct(0, 136, 12);
    head.write(kind === "dir" ? "5" : kind === "symlink" ? "2" : "0", 156, "ascii");
    if (kind === "symlink") put(String(e.data ?? ""), 157, 100);
    head.write("ustar\0", 257, "ascii");
    head.write("00", 263, "ascii");
    /* The checksum is computed with the field itself read as spaces, then
     * written back as octal followed by NUL and a space. Nothing here verifies
     * it, but a fixture that gets it wrong is a fixture no other reader can
     * open, which makes it useless for checking this one against them. */
    head.write(" ".repeat(8), 148, "ascii");
    let sum = 0;
    for (const b of head) sum += b;
    head.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");

    blocks.push(head);
    if (size > 0) {
      const pad = Buffer.alloc(Math.ceil(size / 512) * 512, 0);
      body.copy(pad);
      blocks.push(pad);
    }
  }
  /* Two zero blocks end an archive. */
  blocks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(blocks);
}
