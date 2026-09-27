/**
 * One house JSON document whose fields each replace an older browser-storage
 * key of their own (#288).
 *
 * A read that finds no field in the document falls back to that field's old
 * key, so a value saved by an earlier build is never lost. A write merges the
 * field into the document and removes the old key once the document reads
 * back. `convert` moves every old key in at once, for a boot-time pass. A
 * stored document this build cannot read (a newer schema version, or damage)
 * is never written over: reads go around it to the old keys, and writes
 * report failure.
 */

import { parseDocument, serializeDocument, type FormatDefinition } from "@rpgm-tools/neo-angband-mod-sdk";

/** A store fields can be read from. */
export type FieldReader = Pick<Storage, "getItem">;
/** A store fields can be written to; `removeItem` lets the old key be cleared. */
export type FieldWriter = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;

/** Where one field lived before the document, and how it was spelled there. */
export interface LegacyField<V> {
  readonly key: string;
  parse(raw: string): V | undefined;
}

export type LegacyFields<T> = { readonly [K in keyof T]-?: LegacyField<Exclude<T[K], undefined>> };

/** A legacy value stored as bare JSON, which is how most old keys were written. */
export function legacyJson<V>(key: string): LegacyField<V> {
  return {
    key,
    parse(raw) {
      try {
        return JSON.parse(raw) as V;
      } catch {
        return undefined;
      }
    },
  };
}

export interface FieldDocument<T extends object> {
  readonly storageKey: string;
  /** One field, or undefined when it is not set. Never throws. */
  read<K extends keyof T>(store: FieldReader | null | undefined, name: K): Exclude<T[K], undefined> | undefined;
  /** Whether the field is set, in the document or under its old key. */
  has(store: FieldReader | null | undefined, name: keyof T): boolean;
  /** Store one field; `undefined` clears it. Returns whether the value was stored. */
  write<K extends keyof T>(store: FieldWriter | null | undefined, name: K, value: T[K] | undefined): boolean;
  /** Move every field still under its old key into the document. */
  convert(store: Pick<Storage, "getItem" | "setItem" | "removeItem">): void;
}

type DocumentRead<T> = { readonly kind: "absent" } | { readonly kind: "ok"; readonly data: T } | { readonly kind: "blocked" };

export function fieldDocument<T extends object>(options: {
  readonly format: FormatDefinition<T>;
  readonly storageKey: string;
  /** The document's content before any field is set. */
  readonly empty: T;
  readonly legacy: LegacyFields<T>;
}): FieldDocument<T> {
  const { format, storageKey, empty, legacy } = options;

  function load(store: FieldReader): DocumentRead<T> {
    const raw = store.getItem(storageKey);
    if (raw === null) return { kind: "absent" };
    const parsed = parseDocument(raw, format);
    return parsed.ok ? { kind: "ok", data: parsed.data } : { kind: "blocked" };
  }

  function fromLegacy<K extends keyof T>(store: FieldReader, name: K): Exclude<T[K], undefined> | undefined {
    const old = legacy[name];
    const raw = store.getItem(old.key);
    return raw === null ? undefined : old.parse(raw);
  }

  /**
   * What a write starts from. With no document yet, that is `empty` with every
   * older key's value laid over it, so a field whose empty value is not
   * `undefined` (an empty map, say) never hides the older value it replaces.
   */
  function base(target: FieldReader, doc: DocumentRead<T>): Record<keyof T, unknown> {
    if (doc.kind === "ok") return { ...doc.data } as Record<keyof T, unknown>;
    const next = { ...empty } as Record<keyof T, unknown>;
    for (const name of Object.keys(legacy) as (keyof T)[]) {
      const value = fromLegacy(target, name);
      if (value !== undefined && format.validator.validate({ ...next, [name]: value }).ok) next[name] = value;
    }
    return next;
  }

  /** Serialize, store, and read back. The value is stored only if it validates and survives. */
  function store(target: FieldWriter, next: T): T | null {
    target.setItem(storageKey, serializeDocument(format, next, { compact: true }));
    const back = load(target);
    return back.kind === "ok" ? back.data : null;
  }

  return {
    storageKey,
    read(target, name) {
      if (!target) return undefined;
      try {
        const doc = load(target);
        const value = doc.kind === "ok" ? doc.data[name] : undefined;
        if (value !== undefined) return value as Exclude<T[typeof name], undefined>;
        return fromLegacy(target, name);
      } catch {
        return undefined;
      }
    },
    has(target, name) {
      if (!target) return false;
      try {
        const doc = load(target);
        if (doc.kind === "ok" && doc.data[name] !== undefined) return true;
        return target.getItem(legacy[name].key) !== null;
      } catch {
        return false;
      }
    },
    write(target, name, value) {
      if (!target) return false;
      try {
        const doc = load(target);
        if (doc.kind === "blocked") return false;
        const next = base(target, doc);
        if (value === undefined) delete next[name];
        else next[name] = value;
        const back = store(target, next as T);
        if (back === null) return false;
        target.removeItem?.(legacy[name].key);
        return true;
      } catch {
        return false;
      }
    },
    convert(target) {
      try {
        const doc = load(target);
        if (doc.kind === "blocked") return;
        /* base() has already taken every older value the document can hold. One
         * it cannot hold is dropped with its key, rather than holding every
         * other field back; a document that already has the field keeps its own. */
        const next = base(target, doc);
        const moved: string[] = [];
        for (const name of Object.keys(legacy) as (keyof T)[]) {
          if (target.getItem(legacy[name].key) !== null) moved.push(legacy[name].key);
        }
        if (moved.length === 0) return;
        if (store(target, next as T) === null) return;
        for (const key of moved) target.removeItem(key);
      } catch {
        /* A field that stays under its old key still reads through the fallback. */
      }
    },
  };
}
