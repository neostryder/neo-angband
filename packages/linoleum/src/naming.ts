/**
 * Deterministic asset naming for Linoleum loose packs.
 *
 * Faithful port of New-DeterministicAssetName / Get-StableHashHex from
 * the upstream fork's scripts/build-linoleum-packs.ps1.
 */

import { createHash } from "node:crypto";

/** Slug length cap before the md5 suffix kicks in. */
const MAX_SLUG_LENGTH = 61;

/**
 * md5 of the UTF-8 text, first 4 bytes as lowercase hex (8 characters).
 */
export function stableHashHex(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex").slice(0, 8);
}

/**
 * Build the deterministic asset name for a selector.
 *
 * seed  = lowercase "type:selectorValue"
 * slug  = seed with [^a-z0-9]+ runs replaced by "_", trimmed of "_"
 * When the slug exceeds 61 chars it is truncated to (61 - 9) chars and gets
 * "_" plus the 8-hex-char stable hash of the seed. "_0" is always appended.
 */
export function deterministicAssetName(type: string, selectorValue: string): string {
  const seed = `${type}:${selectorValue}`.toLowerCase();
  let slug = seed.replace(/[^a-z0-9]+/g, "_").replace(/^_+/, "").replace(/_+$/, "");
  if (slug.length === 0) {
    slug = type.toLowerCase();
  }

  if (slug.length > MAX_SLUG_LENGTH) {
    const hash = stableHashHex(seed);
    const prefixLength = MAX_SLUG_LENGTH - hash.length - 1;
    slug = `${slug.slice(0, prefixLength)}_${hash}`;
  }

  return `${slug}_0`;
}

/**
 * Dedupe key for (type, selectorValue) pairs. PowerShell hashtables compare
 * string keys case-insensitively, so the key is lowercased.
 */
export function selectorKey(type: string, selectorValue: string): string {
  return `${type}\n${selectorValue}`.toLowerCase();
}
