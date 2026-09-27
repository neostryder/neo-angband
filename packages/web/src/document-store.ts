/**
 * Read a house document from browser storage, converting the previous value
 * once.
 *
 * The new key is written and read back before the old key is removed. A
 * document that does not parse is left where it is and this read returns
 * null, which callers treat as the empty default for the session.
 */

import {
  parseDocument,
  serializeDocument,
  type FormatDefinition,
} from "@rpgm-tools/neo-angband-mod-sdk";

export interface DocumentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readStoredDocument<T>(
  storage: DocumentStorage,
  key: string,
  legacyKey: string,
  format: FormatDefinition<T>,
  fromLegacy: (raw: string) => T | null,
): T | null {
  const current = readKey(storage, key);
  if (current !== null) {
    const parsed = parseDocument(current, format);
    if (!parsed.ok) return null;
    if (readKey(storage, legacyKey) !== null) removeKey(storage, legacyKey);
    return parsed.data;
  }

  const legacy = readKey(storage, legacyKey);
  if (legacy === null) return null;
  const data = fromLegacy(legacy);
  if (data === null) return null;

  let text: string;
  try {
    text = serializeDocument(format, data, { compact: true });
  } catch {
    return data;
  }
  if (!writeKey(storage, key, text)) return data;
  const written = readKey(storage, key);
  if (written !== text) return data;
  const back = parseDocument(written, format);
  if (!back.ok) {
    return data;
  }
  removeKey(storage, legacyKey);
  return back.data;
}

/** Keep writers from replacing an unreadable document or bypassing conversion. */
export function canWriteStoredDocument<T>(
  storage: DocumentStorage,
  key: string,
  legacyKey: string,
  format: FormatDefinition<T>,
): boolean {
  const current = readKey(storage, key);
  if (current !== null) return parseDocument(current, format).ok;
  return readKey(storage, legacyKey) === null;
}

function readKey(storage: DocumentStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(storage: DocumentStorage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeKey(storage: DocumentStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* The next read tries the removal again. */
  }
}
