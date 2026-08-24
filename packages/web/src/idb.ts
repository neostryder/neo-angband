/**
 * The one IndexedDB wrapper this front end has.
 *
 * Extracted from mod-folder.ts rather than written a second time. That file needed
 * IndexedDB for exactly one reason - a FileSystemDirectoryHandle is a live object
 * that only structured clone can persist - and mod-install.ts needs the same store
 * for a different reason: the bytes of a mod downloaded from a repository have to
 * survive a reload, and localStorage cannot hold a Uint8Array.
 *
 * Two private copies of this plumbing is how the two would drift: one bumps the
 * version and the other's `onupgradeneeded` never runs, so the second store is
 * missing on exactly the machines that had the first. One module, one version
 * number, every store created in one place.
 *
 * EVERY FAILURE RESOLVES RATHER THAN REJECTS. Private-browsing modes, storage
 * policies and quota refusals all fail here, and none of them may stop the game -
 * the caller's fallback is "no saved folder" or "nothing installed", which is a
 * usable game. The one exception is `put`, which reports a boolean, because a
 * caller that just downloaded and verified 2 MB of mod needs to know it did not
 * land. A silent failure there is the mistake fixed once already: reporting
 * success on top of an IO call that returned void.
 */

const DB_NAME = "neo-angband";

/**
 * Bump this when adding a store, and add the store to `upgrade` below.
 *
 * v1: "handles"  - the picked mods-folder handle (mod-folder.ts)
 * v2: "mods", "modsMeta" - downloaded mod bytes and their provenance
 *     (mod-install.ts)
 */
const DB_VERSION = 2;

export const STORE_HANDLES = "handles";
/** One entry per file: key `<modId>/<path>`, value Uint8Array. */
export const STORE_MODS = "mods";
/** One entry per installed mod: key `<modId>`, value InstalledModMeta. */
export const STORE_MOD_META = "modsMeta";

const ALL_STORES = [STORE_HANDLES, STORE_MODS, STORE_MOD_META] as const;

interface IdbScope {
  indexedDB?: IDBFactory;
}

function idbOf(scope: unknown): IDBFactory | null {
  return (scope as IdbScope | null | undefined)?.indexedDB ?? null;
}

/**
 * Create any store this version wants that is not already there.
 *
 * Written as "create what is missing" rather than a per-version migration ladder
 * because every store here is a CACHE of something re-derivable: a folder the player
 * can re-pick, and mods that can be re-downloaded. There is no user data to migrate,
 * so the upgrade that matters is only ever "the store does not exist yet". A save
 * would need the ladder; these do not, and pretending otherwise would be a migration
 * framework with nothing to migrate.
 */
function upgrade(db: IDBDatabase): void {
  for (const name of ALL_STORES) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
  }
}

/** Open the database, or null when this engine has no usable IndexedDB. */
export function openDb(scope: unknown = globalThis): Promise<IDBDatabase | null> {
  const idb = idbOf(scope);
  if (!idb) return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = idb.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    /* onblocked fires when another tab holds the old version open. Resolving null
     * degrades this tab to "no store" rather than hanging boot behind a tab the
     * player may have forgotten about. */
    req.onblocked = () => resolve(null);
  });
}

export function idbGet(db: IDBDatabase, store: string, key: string): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** Reports whether the write actually committed. See the header. */
export function idbPut(
  db: IDBDatabase,
  store: string,
  key: string,
  value: unknown,
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Write many entries in ONE transaction.
 *
 * A mod is hundreds of files (the converted tile pack is 1505), and one transaction
 * each would be hundreds of round trips AND hundreds of chances to land half a mod.
 * One transaction is atomic: either every file of this mod is stored or none is,
 * which is what lets the meta record be written as the last step and treated as proof
 * the install is complete.
 */
export function idbPutMany(
  db: IDBDatabase,
  store: string,
  entries: ReadonlyArray<readonly [string, unknown]>,
): Promise<boolean> {
  if (entries.length === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      const os = tx.objectStore(store);
      for (const [key, value] of entries) os.put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Puts and deletes for one store, as one step of an idbApply. */
export interface IdbWrite {
  readonly store: string;
  readonly put?: ReadonlyArray<readonly [string, unknown]>;
  readonly del?: readonly string[];
}

/**
 * Every write, across every store named, in ONE transaction.
 *
 * WHY THIS EXISTS RATHER THAN A SEQUENCE OF THE CALLS ABOVE. Upgrading an installed
 * mod is a SWAP, and a swap done as separate transactions has a moment in the
 * middle where the player owns neither version. mod-install.ts used to delete the
 * old copy and then write the new one, so a quota refusal on the write - the most
 * likely failure there is, since the new copy is what would not fit - destroyed a
 * mod that had been working, in the name of upgrading it.
 *
 * The fix cannot be "write first, then delete", because the meta record lives in a
 * SECOND store and it is what makes the mod count as installed; two transactions
 * means a window where the files are v2 and the meta says v1. IndexedDB will span
 * stores in one transaction, so the honest fix is to ask it to: either the whole
 * swap lands or none of it does, and a failure leaves the previous install exactly
 * as it was.
 *
 * Deletes run before puts within a store, so a caller can express "replace this
 * set" without having to order the two lists itself.
 */
export function idbApply(db: IDBDatabase, writes: readonly IdbWrite[]): Promise<boolean> {
  const stores = [...new Set(writes.map((w) => w.store))];
  if (stores.length === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(stores, "readwrite");
      for (const w of writes) {
        const os = tx.objectStore(w.store);
        for (const key of w.del ?? []) os.delete(key);
        for (const [key, value] of w.put ?? []) os.put(value, key);
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export function idbDelete(db: IDBDatabase, store: string, key: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Every key in a store, or [] when it cannot be read. */
export function idbKeys(db: IDBDatabase, store: string): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      const req = db.transaction(store, "readonly").objectStore(store).getAllKeys();
      req.onsuccess = () =>
        resolve(req.result.filter((k): k is string => typeof k === "string"));
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Delete every key with this prefix, in one transaction.
 *
 * Uninstalling a mod means removing its files, and its files are the keys under
 * `<id>/`. One transaction for the same reason idbPutMany has one: a half-removed
 * mod is a mod that still half-loads.
 */
export function idbDeletePrefix(
  db: IDBDatabase,
  store: string,
  prefix: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    void (async () => {
      const keys = (await idbKeys(db, store)).filter((k) => k.startsWith(prefix));
      if (keys.length === 0) {
        resolve(true);
        return;
      }
      try {
        const tx = db.transaction(store, "readwrite");
        const os = tx.objectStore(store);
        for (const k of keys) os.delete(k);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    })();
  });
}
