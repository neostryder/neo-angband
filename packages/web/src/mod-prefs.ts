/**
 * A mod's preferences: its own data, kept OUTSIDE any character's save.
 *
 * WHY THIS EXISTS, AND WHY THE SAVE BAG IS NOT IT.
 *
 * A mod already has somewhere to keep data: its save bag, `game.mods[id]`, which
 * core round-trips verbatim and never reads. That bag belongs to a CHARACTER. It
 * is written into the save file, it travels with that save to another machine,
 * and it dies with the character - which is right for "what this mod did to this
 * game" and exactly wrong for "what this player likes".
 *
 * There was no second place, so a mod that wanted to remember anything past a
 * death had two options and both were bad: reach for `localStorage` itself,
 * which hard-codes a browser and quietly breaks on any front end that has no
 * such thing; or keep it in the bag and lose it with the character. This is the
 * second place, and the host owns it, so a mod asks for storage rather than for
 * a browser.
 *
 * SHAPE: one JSON value per mod, replaced whole. Not a key/value map, because a
 * map invites a mod to grow keys it never cleans up and gives the host no moment
 * at which it holds the whole picture; one blob is the same thing the bag is, so
 * a mod author has one model for both and the only difference is the lifetime.
 *
 * SCOPED BY MOD ID, fixed by the host at construction exactly like `assetUrl`:
 * the id a mod gets is the id it was loaded under, so no mod can read or write
 * another's preferences by passing a different one.
 *
 * NOT A SECURITY BOUNDARY. In-process plugin code can reach `localStorage`
 * regardless; the boundary for trusted code is the consent prompt. This is here
 * so the honest path is also the portable one.
 */

import { log } from "./logging";
import { api2NotGranted, api2Ok, api2Refused, api2Unavailable, modKeyValueFormat, parseDocument, serializeDocument, type Api2KeyValueStore, type JsonValue } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModPrefs } from "@rpgm-tools/neo-angband-core";
export type { ModPrefs } from "@rpgm-tools/neo-angband-core";

/** The per-mod storage key. One key per mod, so removing a mod is one delete. */
export function modPrefsKey(id: string): string {
  return `neo:modPrefs:${id}`;
}

let installBacking: PrefsStorage | null | undefined;

export function modKeyValueStore(id: string, lifetime: "kv" | "session", granted: () => boolean, storage?: PrefsStorage | null): Api2KeyValueStore {
  const capability = `store:${lifetime}`;
  const key = `neo:modStore:${lifetime}:${id}`;
  if (storage === undefined) {
    try {
      storage = lifetime === "kv" ? installBacking === undefined ? (typeof localStorage === "undefined" ? null : localStorage) : installBacking
        : typeof sessionStorage === "undefined" ? null : sessionStorage;
    } catch { storage = null; }
  }
  const backing = storage;
  const read = (): Record<string, JsonValue> => {
    const text = backing?.getItem(key);
    if (!text) return {};
    const envelope = parseDocument(text, modKeyValueFormat);
    if (!envelope.ok) throw new Error("Invalid stored records.");
    return envelope.data;
  };
  const validKey = (name: string): boolean => typeof name === "string" && name.length > 0 && name.length <= 128;
  const run = async <T>(body: () => T) => {
    if (!granted()) return api2NotGranted(capability);
    if (!backing) return api2Unavailable("The browser storage is unavailable.");
    try {
      const value = body();
      const freeze = (item: unknown): void => {
        if (!item || typeof item !== "object" || Object.isFrozen(item)) return;
        for (const child of Object.values(item)) freeze(child);
        Object.freeze(item);
      };
      freeze(value);
      return api2Ok(value);
    } catch (error) {
      return error instanceof RangeError ? api2Refused("size", "A mod store is limited to 256 keys and 1048576 bytes.")
        : api2Refused("storage", "The mod's records could not be read or saved.");
    }
  };
  return Object.freeze({
    get: async (name: string) => {
      if (!granted()) return api2NotGranted(capability);
      if (!validKey(name)) return api2Refused("key", "A record key has 1 to 128 characters.");
      return run(() => {
        const values = read();
        return Object.hasOwn(values, name) ? structuredClone(values[name]!) : null;
      });
    },
    keys: () => run(() => Object.freeze(Object.keys(read()))),
    set: async (name: string, value: JsonValue | null) => {
      if (!granted()) return api2NotGranted(capability);
      if (!validKey(name)) return api2Refused("key", "A record key has 1 to 128 characters.");
      if (!modKeyValueFormat.validator.validate({ record: value }).ok) return api2Refused("value", "A record value must be plain JSON.");
      if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 262144) return api2Refused("size", "A record value is limited to 262144 bytes.");
      return run(() => {
        const values = Object.fromEntries(Object.entries(read()).filter(([stored]) => stored !== name));
        if (value !== null) Object.defineProperty(values, name, { value, enumerable: true });
        const text = serializeDocument(modKeyValueFormat.format, values, { compact: true });
        if (Object.keys(values).length > 256 || new TextEncoder().encode(text).byteLength > 1048576) throw new RangeError("Storage limit.");
        backing!.setItem(key, text);
        if (backing!.getItem(key) !== text) throw new Error("Storage write failed.");
        return null;
      });
    },
  });
}

export function setInstallPrefsStorage(storage: PrefsStorage | null | undefined): void {
  installBacking = storage;
}

export function modInstallPrefs(id: string, storage?: PrefsStorage | null): ModPrefs {
  if (storage === undefined) storage = installBacking;
  if (storage === undefined) {
    try {
      storage = typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      storage = null;
    }
  }
  return modPrefs(`install:${id}`, storage);
}

/** The storage a ModPrefs reads and writes. `localStorage`, in both front ends. */
export type PrefsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

let backing: PrefsStorage | null | undefined;

/**
 * Point defaultPrefsStorage() at another storage - a profile-scoped view in
 * the real app (profiles.ts, neo-angband#163), a fake in tests. Every mod's
 * ctx.prefs is built fresh at boot (modPrefs is called once per plugin
 * instantiation, never cached across a reload), and a profile switch is
 * always a reload, so setting this once before any mod is instantiated is
 * enough - no already-built ModPrefs needs to notice a later change.
 */
export function setPrefsStorage(s: PrefsStorage | null): void {
  backing = s;
}

/**
 * The default backing store, or null where there is none.
 *
 * Null is a real answer, not a failure: a front end without storage (a private
 * window with it disabled, a future terminal shell) gets preferences that do not
 * persist, and a mod written against this seam still runs. The alternative -
 * throwing - would take down a mod for a facility it may only use at shutdown.
 */
export function defaultPrefsStorage(): PrefsStorage | null {
  if (backing !== undefined) return backing;
  try {
    backing = typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    /* Access itself throws in some embedded contexts, before any get/set. */
    backing = null;
  }
  return backing;
}

/**
 * Build the ModPrefs for one mod.
 *
 * Every failure is swallowed and logged rather than thrown. A quota error on
 * `set`, or a value some other tool corrupted on `get`, must not travel back
 * into plugin code that called this from inside a hook - the mod would take the
 * blame, and the guard would latch a hook that is not broken.
 */
export function modPrefs(
  id: string,
  storage: PrefsStorage | null = defaultPrefsStorage(),
): ModPrefs {
  const key = modPrefsKey(id);
  return {
    get(): unknown {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        return raw === null ? null : (JSON.parse(raw) as unknown);
      } catch (err) {
        log.warn(`mod:${id}`, "stored preferences could not be read", err);
        return null;
      }
    },
    set(value: unknown): void {
      if (!storage) return;
      try {
        if (value === null || value === undefined) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(value));
      } catch (err) {
        log.warn(`mod:${id}`, "preferences could not be saved", err);
      }
    },
  };
}
