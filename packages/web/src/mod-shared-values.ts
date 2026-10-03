/**
 * `ctx.shared`: named JSON values one mod publishes and other mods read (#365).
 *
 * One store per page, keyed by the publisher's id and then the name. A publish
 * goes through the publisher's own context, so the id it lands under is the id
 * that mod was loaded under and no mod can publish as another.
 *
 * WHY A READ NEEDS NOTHING FROM LOAD ORDER. A value exists only after a loaded
 * mod published it, and a reader asks at the moment it needs the value, so a
 * reader that loads first and a reader that loads last get the same answer. A
 * disabled mod is never loaded (a mod change reloads the page), so it never
 * publishes. A mod whose `register()` throws, and every mod at teardown, is
 * retired here: its values go, readers hear null, and a context it kept in a
 * closure can publish no more.
 *
 * WHAT A READER GETS. The stored record is a deep copy taken at publish time and
 * frozen all the way down, so a reader cannot change what the next reader sees,
 * and the publisher changing its own object afterwards changes nothing here. The
 * same frozen record is handed to every reader, which keeps a read free.
 */

import type { ModShared, ModSharedValue } from "@rpgm-tools/neo-angband-core";
import type { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";

export const SHARED_READ_CAPABILITY = "shared:read";
export const SHARED_PUBLISH_CAPABILITY = "shared:publish";

/**
 * The largest value one publish may hold, in UTF-8 bytes of its JSON text.
 * Room for an end-of-run summary with its history and item list several times
 * over, and small enough that a mod publishing every turn cannot grow the page
 * by much, since each publish replaces the last.
 */
export const SHARED_VALUE_MAX_BYTES = 256 * 1024;

/** Nesting past this is refused with a message instead of a stack overflow. */
const MAX_DEPTH = 64;

/** Lower case, digits, dots, dashes and underscores, as mod ids are written. */
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

type Listener = {
  readonly owner: string;
  readonly fn: (value: ModSharedValue | null) => void;
};
type ReportFault = (modId: string, message: string, error: unknown) => void;

const values = new Map<string, Map<string, ModSharedValue>>();
const listeners = new Map<string, Set<Listener>>();
const retired = new Set<string>();
let reportFault: ReportFault = () => {};

/** main.ts hands in the fault channel a throwing listener is reported on. */
export function setSharedValueFaultReporter(fault: ReportFault | undefined): void {
  reportFault = fault ?? (() => {});
}

function listenerKey(mod: string, name: string): string {
  return `${mod}\u0000${name}`;
}

function notify(mod: string, name: string, value: ModSharedValue | null): void {
  for (const listener of [...(listeners.get(listenerKey(mod, name)) ?? [])]) {
    try {
      listener.fn(value);
    } catch (error) {
      reportFault(listener.owner, `its listener for the value "${name}" shared by ${mod} failed`, error);
    }
  }
}

function describeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "function") return "a function";
  if (typeof value === "symbol") return "a symbol";
  if (typeof value === "bigint") return "a bigint";
  return String(value);
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/**
 * A frozen plain-JSON copy of `value`, or a TypeError naming the first part
 * that is not JSON. Stricter than JSON.stringify, which drops an undefined field
 * or a function without a word and turns a Date into a string: a reader should
 * get what the publisher passed or nothing.
 */
function frozenJsonCopy(value: unknown, path: string, depth: number, open: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} is ${value}, which JSON cannot hold`);
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`${path} is ${describeValue(value)}, which is not JSON`);
  if (depth >= MAX_DEPTH) throw new TypeError(`${path} is nested more than ${MAX_DEPTH} levels deep`);
  if (open.has(value)) throw new TypeError(`${path} contains itself`);
  open.add(value);
  try {
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i++) {
        if (!(i in value)) throw new TypeError(`${path}[${i}] is an empty array slot, which is not JSON`);
        out.push(frozenJsonCopy(value[i], `${path}[${i}]`, depth + 1, open));
      }
      return Object.freeze(out);
    }
    const proto = Object.getPrototypeOf(value) as unknown;
    if (proto !== Object.prototype && proto !== null) {
      const kind = (value as { constructor?: { name?: unknown } }).constructor?.name;
      throw new TypeError(`${path} is ${typeof kind === "string" && kind ? `a ${kind}` : "an object with a prototype"}, not a plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError(`${path} has a symbol key, which is not JSON`);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      /* defineProperty, so a key named "__proto__" stays a key instead of
       * replacing the copy's prototype. */
      Object.defineProperty(out, key, {
        value: frozenJsonCopy((value as Record<string, unknown>)[key], childPath(path, key), depth + 1, open),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return Object.freeze(out);
  } finally {
    open.delete(value);
  }
}

/** The UTF-8 size of `text`, or null when it is certainly within the limit. */
function oversizeBytes(text: string): number | null {
  /* A UTF-16 unit is at most three UTF-8 bytes, so most values skip the encode. */
  if (text.length * 3 <= SHARED_VALUE_MAX_BYTES) return null;
  const bytes = new TextEncoder().encode(text).length;
  return bytes > SHARED_VALUE_MAX_BYTES ? bytes : null;
}

function publish(mod: string, name: string, version: number, value: unknown): void {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    throw new TypeError(
      `shared value name ${JSON.stringify(name)} must be 1 to 64 characters of lower-case letters, digits, ".", "-" or "_", starting with a letter or digit`,
    );
  }
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new TypeError(`shared value "${name}": the version must be a whole number of 0 or more, not ${describeValue(version)}`);
  }
  const copy = frozenJsonCopy(value, `shared value "${name}"`, 0, new Set());
  const bytes = oversizeBytes(JSON.stringify(copy));
  if (bytes !== null) {
    throw new RangeError(`shared value "${name}" is ${bytes} bytes as JSON; the limit is ${SHARED_VALUE_MAX_BYTES}`);
  }
  /* After the checks, so a retired mod's mistakes still throw where its author
   * can see them. */
  if (retired.has(mod)) return;
  const record: ModSharedValue = Object.freeze({ mod, name, version, value: copy });
  let own = values.get(mod);
  if (!own) values.set(mod, (own = new Map()));
  own.set(name, record);
  notify(mod, name, record);
}

function withdraw(mod: string, name: string): void {
  if (typeof name !== "string") return;
  const own = values.get(mod);
  if (!own?.delete(name)) return;
  if (own.size === 0) values.delete(mod);
  notify(mod, name, null);
}

function read(mod: string, name: string): ModSharedValue | null {
  if (typeof mod !== "string" || typeof name !== "string") return null;
  return values.get(mod)?.get(name) ?? null;
}

function subscribe(owner: string, mod: string, name: string, fn: (value: ModSharedValue | null) => void): () => void {
  if (typeof fn !== "function" || typeof mod !== "string" || typeof name !== "string" || retired.has(owner)) return () => {};
  const key = listenerKey(mod, name);
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  const listener: Listener = { owner, fn };
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0 && listeners.get(key) === set) listeners.delete(key);
  };
}

/**
 * `ctx.shared` for mod `id`, or undefined when its manifest declares neither
 * `shared:read` nor `shared:publish`. Each method checks its own capability, so
 * a reader that never declared publishing gets a capability error naming it.
 */
export function sharedValuesFor(id: string, caps: CapabilitySet | undefined): ModShared | undefined {
  if (!caps || !(caps.has(SHARED_READ_CAPABILITY) || caps.has(SHARED_PUBLISH_CAPABILITY))) return undefined;
  return Object.freeze({
    publish: (name: string, version: number, value: unknown) => {
      caps.check(SHARED_PUBLISH_CAPABILITY);
      publish(id, name, version, value);
    },
    withdraw: (name: string) => {
      caps.check(SHARED_PUBLISH_CAPABILITY);
      withdraw(id, name);
    },
    read: (mod: string, name: string) => {
      caps.check(SHARED_READ_CAPABILITY);
      return read(mod, name);
    },
    onChange: (mod: string, name: string, listener: (value: ModSharedValue | null) => void) => {
      caps.check(SHARED_READ_CAPABILITY);
      return subscribe(id, mod, name, listener);
    },
  });
}

/**
 * Remove every value mod `id` published, tell its readers null, drop the
 * listeners it holds, and ignore anything it publishes afterwards. Called when
 * its `register()` throws and at teardown.
 */
export function retireSharedValues(id: string): void {
  retired.add(id);
  for (const [key, set] of listeners) {
    for (const listener of set) if (listener.owner === id) set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  }
  const own = values.get(id);
  if (!own) return;
  values.delete(id);
  for (const name of own.keys()) notify(id, name, null);
}

/** Forget every value, listener and retirement (tests only; a page starts empty). */
export function resetSharedValues(): void {
  values.clear();
  listeners.clear();
  retired.clear();
}
