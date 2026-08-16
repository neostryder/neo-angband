/**
 * The codec envelope. What is under test is mostly COMPATIBILITY: the two
 * directions in which a build and a savefile can disagree about compression, and
 * the requirement that neither one is ever mistaken for a corrupt save.
 */

import { describe, expect, it } from "vitest";
import {
  applyCodec,
  assertCodecId,
  findCodec,
  stripCodec,
} from "./compress.js";
import type { SaveCodec } from "./compress.js";

/** A reversible stand-in: byte-wise complement, so the body is not plain JSON. */
const flip: SaveCodec = {
  id: "flip",
  compress: (b) => b.map((v) => v ^ 0xff),
  decompress: (b) => b.map((v) => v ^ 0xff),
};

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

describe("codec envelope", () => {
  it("round trips through the envelope", () => {
    const json = enc('{"version":3}');
    const wrapped = applyCodec(json, flip);
    const { codecId, body } = stripCodec(wrapped);
    expect(codecId).toBe("flip");
    expect(dec(flip.decompress(body))).toBe('{"version":3}');
  });

  it("names the codec in a readable header", () => {
    /* Diagnosability: someone looking at a savefile's first bytes in any tool
     * should be able to see what wrote it. */
    expect(dec(applyCodec(enc("{}"), flip).subarray(0, 11))).toBe("NGSC1:flip\n");
  });

  it("treats a bare JSON save as uncompressed, not as a broken header", () => {
    /* Every save written before compression existed. A JSON document starts with
     * '{', which cannot be the magic, so this is decided rather than guessed. */
    const { codecId, body } = stripCodec(enc('{"version":3,"turn":100}'));
    expect(codecId).toBeNull();
    expect(dec(body)).toBe('{"version":3,"turn":100}');
  });

  it("survives a payload shorter than the magic", () => {
    const { codecId, body } = stripCodec(enc("{}"));
    expect(codecId).toBeNull();
    expect(dec(body)).toBe("{}");
  });

  it("reports an empty payload as uncompressed rather than throwing", () => {
    expect(stripCodec(new Uint8Array(0))).toEqual({
      codecId: null,
      body: new Uint8Array(0),
    });
  });

  it("reports a magic with no terminator as an unknown codec", () => {
    /* Not as JSON: parsing would fail and blame the wrong layer, so the player
     * would be told their save is damaged when the header is what is wrong. */
    const { codecId } = stripCodec(enc("NGSC1:missing-newline-forever"));
    expect(codecId).toBe("");
  });

  it("does not scan a whole file looking for the terminator", () => {
    /* A bounded search: an id is short, and a 400 KiB save whose header lost its
     * newline must not have its every byte considered part of the id. */
    const { codecId } = stripCodec(enc(`NGSC1:${"a".repeat(500)}\nrest`));
    expect(codecId).toBe("");
  });

  it("finds a known codec and refuses an unknown one", () => {
    expect(findCodec("flip", [flip])).toBe(flip);
    expect(findCodec("gzip", [flip])).toBeUndefined();
  });

  it("rejects a codec id that would corrupt the envelope", () => {
    /* ':' and '\n' are the delimiters; an id containing either would produce a
     * header that strips back to something else entirely. */
    for (const bad of ["gz:1", "gz\n1", "GZIP", "gz 1", ""]) {
      expect(() => assertCodecId(bad)).toThrow(/invalid save codec id/);
    }
    expect(() => assertCodecId("gzip-1")).not.toThrow();
  });

  it("refuses to write an envelope it could not read back", () => {
    expect(() =>
      applyCodec(enc("{}"), { ...flip, id: "Bad:Id" }),
    ).toThrow(/invalid save codec id/);
  });
});
