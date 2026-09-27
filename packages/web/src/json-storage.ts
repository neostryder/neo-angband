/**
 * Browser-storage reads and writes for one house JSON document.
 *
 * A value that already has a format tag is the document. If it does not
 * parse, it stays where it is: a future or damaged document is not replaced
 * and is not treated as the older shape. A value with no format tag is the
 * older shape. It is converted, written, read back, and only then may the
 * caller drop any other legacy key.
 */

import {
  parseDocument,
  serializeDocument,
  type FormatDefinition,
} from "@rpgm-tools/neo-angband-mod-sdk";

export interface DocumentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** True when the text is a document envelope, or is not JSON at all. */
export function looksLikeEnvelope(raw: string): boolean {
  try {
    const value = JSON.parse(raw) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) &&
      ("format" in value || "schemaVersion" in value || "data" in value);
  } catch {
    return true;
  }
}

export interface StoredRead<T> {
  readonly data: T | null;
  /** A document is stored and did not parse. Nothing may write over it. */
  readonly blocked: boolean;
}

/**
 * Read `key`. When the stored text is the older shape, `convert` turns it
 * into current data and this writes the document back. `convert` returns
 * null when the older text is not that shape.
 */
export function readStoredDocument<T>(
  storage: DocumentStorage,
  key: string,
  format: FormatDefinition<T>,
  convert: (legacy: string) => T | null,
  extraLegacyKeys: readonly string[] = [],
): StoredRead<T> {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { data: null, blocked: false };
  }
  if (raw === null) return { data: null, blocked: false };
  if (looksLikeEnvelope(raw)) {
    const parsed = parseDocument(raw, format);
    return parsed.ok ? { data: parsed.data, blocked: false } : { data: null, blocked: true };
  }
  let converted: T | null;
  try {
    converted = convert(raw);
  } catch {
    converted = null;
  }
  if (converted === null) return { data: null, blocked: false };
  const written = writeStoredDocument(storage, key, format, converted, extraLegacyKeys);
  return { data: written, blocked: written === null };
}

/**
 * Write the document. Returns the data read back, or null when the stored
 * document is already unreadable or the write did not read back.
 * A legacy value at `key` is replaced. Extra legacy keys are removed only
 * after that read-back.
 */
export function writeStoredDocument<T>(
  storage: DocumentStorage,
  key: string,
  format: FormatDefinition<T>,
  data: T,
  extraLegacyKeys: readonly string[] = [],
): T | null {
  try {
    const existing = storage.getItem(key);
    if (existing !== null && looksLikeEnvelope(existing)) {
      const parsed = parseDocument(existing, format);
      if (!parsed.ok) return null;
    }
    storage.setItem(key, serializeDocument(format, data, { compact: true }));
    const back = parseDocument(storage.getItem(key) ?? "", format);
    if (!back.ok) return null;
    for (const extra of extraLegacyKeys) {
      if (extra !== key) storage.removeItem?.(extra);
    }
    return back.data;
  } catch {
    return null;
  }
}
