/**
 * RFC 1321 md5, in portable TypeScript.
 *
 * The Linoleum pack format hashes strings in two places that MUST agree
 * everywhere a pack is read or written: `deterministicAssetName` (naming.ts,
 * the converter's file names) and the `stable` variant-pool rule
 * (targets.ts:selectPoolMember, resolved live while drawing a map). The
 * converter runs in Node, the renderer runs in a browser, and a browser has no
 * md5 - Web Crypto deliberately omits it - so `node:crypto` cannot be the one
 * implementation. This is that one implementation.
 *
 * Byte-for-byte agreement with `crypto.createHash("md5")` is asserted over the
 * RFC test vectors plus a large generated corpus in md5.test.ts; that test is
 * the contract, since a divergence here would silently rename every asset in a
 * pack and re-roll every pool.
 *
 * Deterministic and side-effect free: no RNG, no I/O, no globals beyond
 * TextEncoder (universal since Node 11 / all browsers).
 */

/** Per-round left-rotation amounts (RFC 1321 section 3.4). */
const SHIFTS: readonly number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
  14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
  21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** K[i] = floor(abs(sin(i + 1)) * 2^32), the RFC's sine table, precomputed. */
const K: readonly number[] = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** Lowercase hex of a word, least-significant byte first (md5's output order). */
function wordToHexLE(word: number): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}

/** md5 of a byte sequence, as 32 lowercase hex characters. */
export function md5HexBytes(bytes: Uint8Array): string {
  // Padding (RFC 1321 section 3.1-3.2): a 0x80 byte, zeros to 56 mod 64, then
  // the message length in BITS as a 64-bit little-endian integer.
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array((Math.floor(bytes.length / 64) + (bytes.length % 64 < 56 ? 1 : 2)) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // Lengths beyond 2^32 bits (512 MiB) cannot occur for the strings this hashes,
  // so the high word is written from the float form rather than 64-bit maths.
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Array<number>(16);
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let j = 0; j < 16; j++) words[j] = view.getUint32(chunk + j * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + (K[i] as number) + (words[g] as number)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(f, SHIFTS[i] as number)) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return wordToHexLE(a0) + wordToHexLE(b0) + wordToHexLE(c0) + wordToHexLE(d0);
}

/** md5 of a string's UTF-8 bytes, as 32 lowercase hex characters. */
export function md5Hex(text: string): string {
  return md5HexBytes(new TextEncoder().encode(text));
}
