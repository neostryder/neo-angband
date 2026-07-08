import { describe, expect, it } from "vitest";
import {
  SAVEFILE_HEAD_SIZE,
  SAVEFILE_MAGIC,
  SaveReader,
  SaveWriter,
  readSavefile,
  writeSavefile,
} from "./buffer";
import type { SaveBlock } from "./buffer";

describe("SaveWriter / SaveReader primitives", () => {
  it("round-trips every width, including signed values", () => {
    const w = new SaveWriter();
    w.putByte(0xab);
    w.putU16(0x1234);
    w.putS16(-2);
    w.putU32(0xdeadbeef);
    w.putS32(-123456);
    w.putString("Gandalf");

    const r = new SaveReader(w.payload());
    expect(r.getByte()).toBe(0xab);
    expect(r.getU16()).toBe(0x1234);
    expect(r.getS16()).toBe(-2);
    expect(r.getU32()).toBe(0xdeadbeef);
    expect(r.getS32()).toBe(-123456);
    expect(r.getString(32)).toBe("Gandalf");
  });

  it("computes the same additive checksum on write and read", () => {
    const w = new SaveWriter();
    w.putU32(0x01020304);
    w.putString("orc");
    const r = new SaveReader(w.payload());
    r.getU32();
    r.getString(16);
    expect(r.checksum()).toBe(w.checksum());
  });

  it("caps rd_string at max and still consumes the terminator", () => {
    const w = new SaveWriter();
    w.putString("abcdef");
    w.putByte(0x99);
    const r = new SaveReader(w.payload());
    expect(r.getString(4)).toBe("abc"); // max-1 chars kept
    expect(r.getByte()).toBe(0x99); // reader advanced past the null
  });

  it("throws when reading past the end of a block", () => {
    const r = new SaveReader(Uint8Array.from([1, 2]));
    r.getU16();
    expect(() => r.getByte()).toThrow(/past end/);
  });
});

interface Named {
  name: string;
  level: number;
}

function block(p: Named): SaveBlock {
  return {
    name: "player",
    version: 1,
    write(w) {
      w.putString(p.name);
      w.putU16(p.level);
    },
  };
}

describe("writeSavefile / readSavefile framing", () => {
  it("emits the magic and version stamp", () => {
    const bytes = writeSavefile(7, []);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([...SAVEFILE_MAGIC]);
    expect(bytes[4]).toBe(7);
  });

  it("round-trips multiple blocks with headers intact", () => {
    const bytes = writeSavefile(1, [
      block({ name: "Frodo", level: 3 }),
      { name: "rng", version: 2, write: (w) => w.putU32(0xcafef00d) },
    ]);
    const parsed = readSavefile(bytes);
    expect(parsed.version).toBe(1);
    expect(parsed.blocks).toHaveLength(2);

    const [b0, b1] = parsed.blocks;
    expect(b0?.header.name).toBe("player");
    const r0 = new SaveReader(b0!.payload);
    expect(r0.getString(16)).toBe("Frodo");
    expect(r0.getS16()).toBe(3);

    expect(b1?.header.name).toBe("rng");
    expect(b1?.header.version).toBe(2);
    const r1 = new SaveReader(b1!.payload);
    expect(r1.getU32()).toBe(0xcafef00d);
  });

  it("aligns unaligned payloads to a 4-byte boundary", () => {
    // "player" block payload is a 6-char string (7 bytes) + u16 = 9 bytes.
    const bytes = writeSavefile(1, [block({ name: "Bilbo", level: 1 })]);
    // header is 28 bytes; total up to and including padding must be a
    // multiple of 4 after the 8-byte file header.
    const afterHeader = bytes.length - 8 - SAVEFILE_HEAD_SIZE;
    expect(afterHeader % 4).toBe(0);
    // Still parses cleanly.
    expect(() => readSavefile(bytes)).not.toThrow();
  });

  it("rejects a corrupted payload via the block checksum", () => {
    const bytes = writeSavefile(1, [block({ name: "Sam", level: 5 })]);
    const tampered = Uint8Array.from(bytes);
    // Flip a byte inside the first block's payload (past the 8-byte file
    // header and 28-byte block header).
    const at = 8 + SAVEFILE_HEAD_SIZE;
    tampered[at] = (tampered[at] as number) ^ 0xff;
    expect(() => readSavefile(tampered)).toThrow(/checksum/);
  });

  it("rejects a bad magic", () => {
    const bytes = writeSavefile(1, []);
    const bad = Uint8Array.from(bytes);
    bad[0] = 0;
    expect(() => readSavefile(bad)).toThrow(/magic/);
  });
});
