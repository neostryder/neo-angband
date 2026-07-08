/**
 * Savefile serialization primitives - a faithful port of the block-based
 * reader/writer in reference/src/savefile.c.
 *
 * The upstream format (unchanged here):
 * - A 4-byte file magic {83,97,118,101} = "Save", then a 4-byte version
 *   stamp.
 * - A sequence of blocks. Each block is a 28-byte header (16-byte
 *   zero-padded name, u32 version, u32 payload size, u32 checksum) then
 *   the payload, then zero-to-three padding bytes so the payload aligns
 *   to a 4-byte boundary. Padding is not part of the payload or checksum.
 * - Every multi-byte value is little-endian.
 * - The block checksum is a running uint32 additive sum of every payload
 *   byte, matching savefile.c's `buffer_check += v`. It detects
 *   CORRUPTION; it is trivially recomputable and is NOT tamper-proof.
 *   For a tamper deterrent, see ./integrity (a whole-file hash seam);
 *   for real anti-tamper, saves must be server-authoritative.
 *
 * Parity note: the upstream 4-byte alignment padding is the literal byte
 * 'x' (0x78). We reproduce that so byte streams match upstream exactly.
 */

/** File magic: the ASCII bytes of "Save". */
export const SAVEFILE_MAGIC: readonly number[] = [83, 97, 118, 101];

/** Fixed block-header size: 16-byte name + three u32 fields. */
export const SAVEFILE_HEAD_SIZE = 28;

/** The upstream alignment padding byte ('x'). */
const PAD_BYTE = 0x78;

/** A parsed block header. */
export interface BlockHeader {
  name: string;
  version: number;
  size: number;
  check: number;
}

/**
 * Writes a single block's payload while maintaining the additive
 * checksum, exactly like savefile.c's sf_put path.
 */
export class SaveWriter {
  private buf: number[] = [];
  private check = 0;

  /** wr_byte: append one byte and fold it into the checksum. */
  putByte(v: number): void {
    const b = v & 0xff;
    this.buf.push(b);
    this.check = (this.check + b) >>> 0;
  }

  /** wr_u16b: little-endian unsigned 16-bit. */
  putU16(v: number): void {
    this.putByte(v & 0xff);
    this.putByte((v >> 8) & 0xff);
  }

  /** wr_s16b: signed 16-bit (same bytes as u16). */
  putS16(v: number): void {
    this.putU16(v & 0xffff);
  }

  /** wr_u32b: little-endian unsigned 32-bit. */
  putU32(v: number): void {
    this.putByte(v & 0xff);
    this.putByte((v >>> 8) & 0xff);
    this.putByte((v >>> 16) & 0xff);
    this.putByte((v >>> 24) & 0xff);
  }

  /** wr_s32b: signed 32-bit (same bytes as u32). */
  putS32(v: number): void {
    this.putU32(v >>> 0);
  }

  /** wr_string: bytes of the string then a null terminator. */
  putString(str: string): void {
    for (let i = 0; i < str.length; i++) {
      this.putByte(str.charCodeAt(i) & 0xff);
    }
    this.putByte(0);
  }

  /** pad_bytes: n zero bytes (checksummed, as upstream pads inside blocks). */
  pad(n: number): void {
    for (let i = 0; i < n; i++) this.putByte(0);
  }

  /** Current checksum (uint32) over everything written so far. */
  checksum(): number {
    return this.check >>> 0;
  }

  /** The payload bytes written so far. */
  payload(): Uint8Array {
    return Uint8Array.from(this.buf);
  }

  /** Byte length of the payload. */
  get length(): number {
    return this.buf.length;
  }
}

/**
 * Reads a block's payload while maintaining the additive checksum, so a
 * caller can compare it against the header's stored checksum. Mirrors
 * savefile.c's sf_get path. Reading past the end throws, matching the
 * upstream "Broken savefile" quit.
 */
export class SaveReader {
  private pos = 0;
  private check = 0;

  constructor(private readonly buf: Uint8Array) {}

  private next(): number {
    if (this.pos >= this.buf.length) {
      throw new RangeError("Broken savefile: read past end of block");
    }
    const b = this.buf[this.pos++] as number;
    this.check = (this.check + b) >>> 0;
    return b;
  }

  /** rd_byte. */
  getByte(): number {
    return this.next();
  }

  /** rd_u16b: little-endian unsigned 16-bit. */
  getU16(): number {
    const lo = this.next();
    const hi = this.next();
    return (lo | (hi << 8)) >>> 0;
  }

  /** rd_s16b: signed 16-bit. */
  getS16(): number {
    const v = this.getU16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  /** rd_u32b: little-endian unsigned 32-bit. */
  getU32(): number {
    const b0 = this.next();
    const b1 = this.next();
    const b2 = this.next();
    const b3 = this.next();
    return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
  }

  /** rd_s32b: signed 32-bit. */
  getS32(): number {
    return this.getU32() | 0;
  }

  /** rd_string: read up to a null terminator, capping at max chars. */
  getString(max: number): string {
    let out = "";
    for (;;) {
      const b = this.next();
      if (b === 0) break;
      if (out.length < max - 1) out += String.fromCharCode(b);
    }
    return out;
  }

  /** strip_bytes: discard n bytes (still checksummed). */
  strip(n: number): void {
    for (let i = 0; i < n; i++) this.next();
  }

  /** Running checksum (uint32) over everything read so far. */
  checksum(): number {
    return this.check >>> 0;
  }

  /** Bytes consumed so far. */
  get position(): number {
    return this.pos;
  }
}

/** A block ready to serialize: name, version, and a payload writer. */
export interface SaveBlock {
  name: string;
  version: number;
  write(w: SaveWriter): void;
}

/** A loader for one block name+version: reads from a SaveReader. */
export type BlockLoader<T> = (r: SaveReader, header: BlockHeader) => T;

function writeU32LE(out: number[], v: number): void {
  out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

/**
 * Assemble the full savefile byte stream: magic + version stamp + each
 * block framed exactly as try_save does (28-byte header, payload,
 * 4-byte alignment padding of 'x').
 */
export function writeSavefile(version: number, blocks: SaveBlock[]): Uint8Array {
  const out: number[] = [...SAVEFILE_MAGIC];
  writeU32LE(out, version);

  for (const block of blocks) {
    const w = new SaveWriter();
    block.write(w);
    const payload = w.payload();

    // 16-byte zero-padded name.
    for (let i = 0; i < 16; i++) {
      out.push(i < block.name.length ? block.name.charCodeAt(i) & 0xff : 0);
    }
    writeU32LE(out, block.version);
    writeU32LE(out, payload.length);
    writeU32LE(out, w.checksum());

    for (const b of payload) out.push(b);

    // Align the payload to a 4-byte boundary with 'x' padding.
    const rem = payload.length % 4;
    if (rem) for (let i = 0; i < 4 - rem; i++) out.push(PAD_BYTE);
  }
  return Uint8Array.from(out);
}

/** The result of splitting a savefile into its framed blocks. */
export interface ParsedSavefile {
  version: number;
  blocks: Array<{ header: BlockHeader; payload: Uint8Array }>;
}

function readU32LE(buf: Uint8Array, pos: number): number {
  return (
    ((buf[pos] as number) |
      ((buf[pos + 1] as number) << 8) |
      ((buf[pos + 2] as number) << 16) |
      ((buf[pos + 3] as number) << 24)) >>>
    0
  );
}

/**
 * Split a savefile stream into blocks and VERIFY each block's additive
 * checksum. Throws on a bad magic or a checksum mismatch (the corruption
 * signal). Callers then feed each payload to a SaveReader + BlockLoader.
 */
export function readSavefile(buf: Uint8Array): ParsedSavefile {
  for (let i = 0; i < 4; i++) {
    if (buf[i] !== SAVEFILE_MAGIC[i]) {
      throw new Error("Not a Neo Angband savefile (bad magic)");
    }
  }
  const version = readU32LE(buf, 4);
  let pos = 8;
  const blocks: ParsedSavefile["blocks"] = [];

  while (pos < buf.length) {
    let name = "";
    for (let i = 0; i < 16; i++) {
      const c = buf[pos + i] as number;
      if (c) name += String.fromCharCode(c);
    }
    const bversion = readU32LE(buf, pos + 16);
    const size = readU32LE(buf, pos + 20);
    const check = readU32LE(buf, pos + 24);
    pos += SAVEFILE_HEAD_SIZE;

    const payload = buf.subarray(pos, pos + size);
    let sum = 0;
    for (const b of payload) sum = (sum + b) >>> 0;
    if (sum !== check) {
      throw new Error(`Savefile block "${name}" failed its checksum`);
    }
    blocks.push({ header: { name, version: bversion, size, check }, payload });

    pos += size;
    if (size % 4) pos += 4 - (size % 4);
  }
  return { version, blocks };
}
