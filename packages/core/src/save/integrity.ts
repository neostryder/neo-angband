/**
 * Save integrity: a tamper-DETERRENT layer over the raw savefile bytes.
 *
 * Context (see ./buffer and the save-scum policy): upstream Angband
 * stamps each block with a 32-bit additive checksum for corruption
 * detection. That is trivially recomputable. This module adds an
 * optional whole-file digest so that a casual hand-edit of the stored
 * bytes (e.g. via browser DevTools on an IndexedDB save) no longer
 * verifies, which raises the bar against save-scumming.
 *
 * HONEST CEILING: any verifier that runs on the client also ships to the
 * client, so a determined user can read it and recompute the digest.
 * This is a DETERRENT, not real protection. Unforgeable anti-tamper
 * requires a secret the client never holds - i.e. server-authoritative
 * saves, which belong to the networking seam (a plugin), not core.
 *
 * MODDABILITY: the digest is a seam. A host or mod may inject a stronger
 * provider (for example SHA-256 via SubtleCrypto, or an HMAC keyed by a
 * server secret in a networked deployment) by implementing SaveIntegrity.
 */

/** A pluggable save-integrity provider. Digests are hex strings. */
export interface SaveIntegrity {
  /** Stable identifier persisted alongside the digest. */
  readonly id: string;
  /** Compute a digest over the given bytes. */
  digest(bytes: Uint8Array): string;
}

/**
 * The built-in default: FNV-1a (64-bit, emitted as 16 hex chars). It is
 * a NON-CRYPTOGRAPHIC hash - far more diffusing than an additive sum, so
 * it catches casual edits, but not a security primitive. Zero-dependency
 * and synchronous so core stays environment-neutral.
 */
export const fnv1aIntegrity: SaveIntegrity = {
  id: "fnv1a-64",
  digest(bytes: Uint8Array): string {
    // 64-bit FNV-1a maintained as two 32-bit halves (hi, lo) to stay in
    // safe integer math. offset basis 0xcbf29ce484222325, prime 0x100000001b3.
    let hi = 0xcbf29ce4;
    let lo = 0x84222325;
    for (let i = 0; i < bytes.length; i++) {
      lo ^= bytes[i] as number;
      // Multiply the 64-bit value by the FNV prime (0x100000001b3):
      // that is 2^40 + 2^8 + 0x1b3. Do it via 16-bit limbs to be exact.
      const a0 = lo & 0xffff;
      const a1 = lo >>> 16;
      const a2 = hi & 0xffff;
      const a3 = hi >>> 16;
      // prime limbs: p0=0x01b3, p1=0x0001, p2=0x0100, p3=0x0000
      let c0 = a0 * 0x01b3;
      let c1 = a1 * 0x01b3 + a0 * 0x0001 + (c0 >>> 16);
      let c2 = a2 * 0x01b3 + a1 * 0x0001 + a0 * 0x0100 + (c1 >>> 16);
      let c3 = a3 * 0x01b3 + a2 * 0x0001 + a1 * 0x0100 + (c2 >>> 16);
      lo = ((c1 & 0xffff) << 16) | (c0 & 0xffff);
      hi = ((c3 & 0xffff) << 16) | (c2 & 0xffff);
      lo >>>= 0;
      hi >>>= 0;
    }
    const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");
    return hex(hi) + hex(lo);
  },
};

/** Marker appended after the digest so the trailer is self-describing. */
const TRAILER_MAGIC = "\nNGISTMP1\n";

/**
 * Append an integrity trailer (provider id + digest) to a savefile byte
 * stream. The trailer sits after the block data and is excluded from the
 * digest, so verification digests exactly the original bytes.
 */
export function stampSavefile(
  bytes: Uint8Array,
  provider: SaveIntegrity = fnv1aIntegrity,
): Uint8Array {
  const digest = provider.digest(bytes);
  const trailer = `${TRAILER_MAGIC}${provider.id}:${digest}`;
  const tbytes = new TextEncoder().encode(trailer);
  const out = new Uint8Array(bytes.length + tbytes.length);
  out.set(bytes, 0);
  out.set(tbytes, bytes.length);
  return out;
}

/** The outcome of checking a stamped savefile. */
export interface IntegrityResult {
  /** The original savefile bytes with the trailer removed. */
  payload: Uint8Array;
  /** True when a trailer was present and its digest matched. */
  verified: boolean;
  /** True when no trailer was found (an unstamped/legacy save). */
  unstamped: boolean;
  /** Provider id recorded in the trailer, if any. */
  providerId?: string;
}

/**
 * Split off and verify an integrity trailer. A caller decides policy: a
 * no-save-scum build should reject `verified === false`, while still
 * tolerating `unstamped` legacy saves if it chooses. Verification uses
 * the supplied provider (whose id must match the trailer's).
 */
export function verifyStampedSavefile(
  bytes: Uint8Array,
  provider: SaveIntegrity = fnv1aIntegrity,
): IntegrityResult {
  const magicBytes = new TextEncoder().encode(TRAILER_MAGIC);
  const at = lastIndexOf(bytes, magicBytes);
  if (at < 0) {
    return { payload: bytes, verified: false, unstamped: true };
  }
  const payload = bytes.subarray(0, at);
  const trailer = new TextDecoder().decode(bytes.subarray(at + magicBytes.length));
  const colon = trailer.indexOf(":");
  const providerId = colon >= 0 ? trailer.slice(0, colon) : trailer;
  const recorded = colon >= 0 ? trailer.slice(colon + 1) : "";
  const verified =
    providerId === provider.id && provider.digest(payload) === recorded;
  return { payload, verified, unstamped: false, providerId };
}

/** Find the last occurrence of `needle` in `hay`, or -1. */
function lastIndexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = hay.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}
