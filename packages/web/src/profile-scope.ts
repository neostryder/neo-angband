/**
 * The storage seam every per-profile module is threaded through
 * (neo-angband#163, player/testing profiles).
 *
 * A profile is a NAMESPACE, not a copy: wrapping a real Storage with a key
 * prefix means every module above it (roster.ts, mod-store.ts, userdir.ts,
 * mod-prefs.ts) keeps reading and writing exactly the keys it always has -
 * the same bytes just live under a different name per profile. The DEFAULT
 * profile uses no prefix at all, so an existing install's current state
 * requires no migration the day this ships: it already IS the default
 * profile's data, unprefixed, before anything about profiles exists.
 *
 * This wraps the full enumerable Storage shape (getItem/setItem/removeItem
 * plus length/key), because roster.ts's dynamic per-slot keys
 * (`neo-angband-save:<uuid>`) and userdir.ts's per-file keys need to be
 * enumerable under one profile's scope - for a profile deletion, or for
 * copying one profile's data into a freshly created one - without either
 * module's own key-building logic changing at all.
 */

/** The Storage subset this module needs; a real Storage satisfies it. */
export interface ScopedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

const PROFILE_PREFIX = "profile:";

/**
 * Wrap `storage` so every key it sees is scoped to one profile. `profileId`
 * of `null` is the default profile - returns `storage` itself, unwrapped,
 * since the default owns the plain unprefixed keys.
 */
export function scopedStorage(
  storage: ScopedStorage,
  profileId: string | null,
): ScopedStorage {
  if (profileId === null) return storage;
  const prefix = `${PROFILE_PREFIX}${profileId}:`;
  return {
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key),
    get length() {
      let n = 0;
      for (let i = 0; i < storage.length; i++) {
        if (storage.key(i)?.startsWith(prefix)) n++;
      }
      return n;
    },
    key: (index) => {
      let n = 0;
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k !== null && k.startsWith(prefix)) {
          if (n === index) return k.slice(prefix.length);
          n++;
        }
      }
      return null;
    },
  };
}

/**
 * Copy every key belonging to `fromId`'s scope into `toId`'s scope, over the
 * same real `storage`. Used when a new profile is created starting from the
 * current one rather than a full reset - see profiles.ts's `create`.
 */
export function copyScopedStorage(
  storage: ScopedStorage,
  fromId: string | null,
  toId: string,
): void {
  const from = scopedStorage(storage, fromId);
  const to = scopedStorage(storage, toId);
  const keys: string[] = [];
  for (let i = 0; i < from.length; i++) {
    const k = from.key(i);
    if (k !== null) keys.push(k);
  }
  for (const k of keys) {
    const v = from.getItem(k);
    if (v !== null) to.setItem(k, v);
  }
}

/**
 * Remove every key belonging to `profileId`'s scope over the real `storage`.
 * `profileId` must not be `null` - the default profile's data is never
 * bulk-erased through this path (see profiles.ts's `remove`, which refuses to
 * delete the default profile at all).
 */
export function clearScopedStorage(storage: ScopedStorage, profileId: string): void {
  const view = scopedStorage(storage, profileId);
  const keys: string[] = [];
  for (let i = 0; i < view.length; i++) {
    const k = view.key(i);
    if (k !== null) keys.push(k);
  }
  for (const k of keys) view.removeItem(k);
}
