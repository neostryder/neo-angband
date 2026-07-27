/**
 * The portable md5 is pinned to node's own md5.
 *
 * Every asset file name in a converted pack and every `stable` variant-pool
 * choice derives from this hash, so browser and converter MUST agree with each
 * other and with the hash the original PowerShell converter used (which was
 * node/.NET md5). A drift here renames assets and re-rolls pools silently.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { md5Hex } from "./md5.js";
import { deterministicAssetName, stableHashHex } from "./naming.js";

function nodeMd5(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

describe("md5Hex", () => {
  it("matches the RFC 1321 test vectors", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex("a")).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex("message digest")).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex("abcdefghijklmnopqrstuvwxyz")).toBe("c3fcd3d76192e4007dfb496cca67e13b");
    expect(md5Hex("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")).toBe(
      "d174ab98d277d9f5a5611c2c9f419d9f",
    );
    expect(md5Hex("12345678901234567890123456789012345678901234567890123456789012345678901234567890")).toBe(
      "57edf4a22be3c955ac49da2e2107b67a",
    );
  });

  it("matches node:crypto at every length across the block boundaries", () => {
    // 0..200 bytes covers empty, one block, the 55/56 padding split, and the
    // multi-block path (the three cases the padding arithmetic distinguishes).
    for (let n = 0; n <= 200; n++) {
      const text = "x".repeat(n);
      expect(md5Hex(text), `length ${n}`).toBe(nodeMd5(text));
    }
  });

  it("matches node:crypto on real selector seeds and multi-byte text", () => {
    const samples = [
      "feat:FLOOR:lit",
      "monster:Farmer Maggot",
      "GF:ELEC:0",
      "object:light:Wooden Torch",
      "flavor:12",
      "trap:pit:*",
      "pool:floor_pool:12,34",
      "Grond, 'Hammer of the Underworld'",
      "éèê",
      "日本語",
      "🐉 dragon",
      "  spaces  and\ttabs\n",
    ];
    for (const sample of samples) {
      expect(md5Hex(sample), sample).toBe(nodeMd5(sample));
    }
  });

  it("matches node:crypto over a generated corpus", () => {
    // Deterministic pseudo-random strings (no RNG): a linear congruential walk
    // over the printable range, so the corpus is identical on every run.
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let i = 0; i < 500; i++) {
      let text = "";
      const len = next() % 90;
      for (let j = 0; j < len; j++) text += String.fromCharCode(32 + (next() % 95));
      expect(md5Hex(text), JSON.stringify(text)).toBe(nodeMd5(text));
    }
  });
});

describe("stableHashHex", () => {
  it("is the first 8 hex characters of the md5", () => {
    expect(stableHashHex("feat:FLOOR:lit")).toBe(nodeMd5("feat:FLOOR:lit").slice(0, 8));
    expect(stableHashHex("")).toBe("d41d8cd9");
  });

  it("still produces the asset names the converter is pinned to", () => {
    // A long selector forces the truncate+hash branch, which is where a hash
    // change would rename a file.
    const selector = "A very long unique monster name that runs past the slug length cap";
    const seed = `monster:${selector}`.toLowerCase();
    const slug = seed.replace(/[^a-z0-9]+/g, "_").slice(0, 52);
    expect(deterministicAssetName("monster", selector)).toBe(
      `${slug}_${nodeMd5(seed).slice(0, 8)}_0`,
    );
  });
});
