/**
 * A mods folder in a browser tab.
 *
 * Three claims are load-bearing here, and each is the kind that fails silently:
 *
 * 1. The folder is REMEMBERED. A handle that has to be re-picked every launch is
 *    not a mods folder, so there is a fake IndexedDB below rather than a mock of
 *    the module's own persistence - the persistence IS the feature.
 * 2. A lapsed permission reports itself. The browser can stop reading a folder it
 *    read yesterday, and the failure mode that matters is the quiet one: no packs,
 *    no complaint, and a player who concludes their mods vanished.
 * 3. The rules about what a usable mod is are disk-packs.ts', not a second copy.
 *    These tests go through readModDir for exactly that reason: if this file grew
 *    its own validation, the two platforms would drift and only a player would
 *    find out.
 */

import { describe, expect, it } from "vitest";
import {
  folderModSource,
  folderPermission,
  folderPickingSupported,
  forgetModFolder,
  loadPickedModFolder,
  pickModFolder,
  rememberModFolder,
  savedModFolder,
  type FsDirHandle,
} from "./mod-folder";
import { readModDir } from "./disk-packs";

/* ------------------------------------------------------------------ *
 * A fake File System Access directory tree.
 * ------------------------------------------------------------------ */

/** A directory is a record of name -> JSON text (a file) or another tree. */
type Tree = { [name: string]: string | Tree };

interface FakeHandle extends FsDirHandle {
  /** How many times the directory has been enumerated, to catch re-scan bugs. */
  scans: number;
}

function dirHandle(
  name: string,
  tree: Tree,
  perm: { state: "granted" | "denied" | "prompt"; onRequest?: "granted" | "denied" } = {
    state: "granted",
  },
): FakeHandle {
  const handle: FakeHandle = {
    kind: "directory",
    name,
    scans: 0,
    values: () => {
      handle.scans++;
      return (async function* () {
        for (const [child, val] of Object.entries(tree)) {
          if (typeof val === "string") {
            yield {
              kind: "file" as const,
              name: child,
              /* A real File IS a Blob, and the asset path mints its URL from the
               * Blob rather than from text() - an image's bytes are not UTF-8 and a
               * text round trip would replace every invalid sequence. So the fake
               * hands back a real Blob, which has text() of its own. */
              getFile: () => Promise.resolve(new Blob([val])),
            };
          } else {
            yield dirHandle(child, val, perm);
          }
        }
      })();
    },
    queryPermission: () => Promise.resolve(perm.state),
    requestPermission: () => {
      const next = perm.onRequest ?? "denied";
      perm.state = next;
      return Promise.resolve(next);
    },
  };
  return handle;
}

const MANIFEST = (id: string): string =>
  JSON.stringify({ id, name: `Mod ${id}`, version: "1.0.0", shape: "content" });

/* ------------------------------------------------------------------ *
 * A fake IndexedDB, enough for one object store of structured values.
 *
 * Written out rather than stubbed because the module's contract is "the handle
 * survives a reload", and a stub of its own getter would assert nothing about that.
 * Callbacks fire on a later microtask, like the real thing, so a test that attached
 * its handler too late would fail here as it would in a browser.
 * ------------------------------------------------------------------ */

interface FakeRequest<T> {
  result?: T;
  onsuccess?: (() => void) | null;
  onerror?: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
  onblocked?: (() => void) | null;
}

function fakeIndexedDb(opts: { openFails?: boolean; putFails?: boolean } = {}): {
  factory: IDBFactory;
  data: Map<string, unknown>;
} {
  const data = new Map<string, unknown>();
  const stores = new Set<string>();
  const factory = {
    open(_name: string, _version?: number) {
      const req: FakeRequest<unknown> = {};
      queueMicrotask(() => {
        if (opts.openFails) {
          req.onerror?.();
          return;
        }
        const db = {
          objectStoreNames: { contains: (n: string) => stores.has(n) },
          createObjectStore: (n: string) => {
            stores.add(n);
            return {};
          },
          transaction(_store: string, _mode?: string) {
            const tx: {
              oncomplete?: (() => void) | null;
              onerror?: (() => void) | null;
              onabort?: (() => void) | null;
              objectStore(): unknown;
            } = {
              objectStore: () => ({
                get(key: string) {
                  const r: FakeRequest<unknown> = {};
                  queueMicrotask(() => {
                    r.result = data.get(key);
                    r.onsuccess?.();
                  });
                  return r;
                },
                put(value: unknown, key: string) {
                  queueMicrotask(() => {
                    if (opts.putFails) {
                      tx.onerror?.();
                      return;
                    }
                    data.set(key, value);
                    tx.oncomplete?.();
                  });
                  return {};
                },
                delete(key: string) {
                  queueMicrotask(() => {
                    data.delete(key);
                    tx.oncomplete?.();
                  });
                  return {};
                },
              }),
            };
            return tx;
          },
        };
        req.result = db;
        /* The real sequence: upgrade first (so the store exists), then success. */
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  } as unknown as IDBFactory;
  return { factory, data };
}

/** A scope that can pick `handle`, with a working IndexedDB. */
function scopeWith(
  handle: FsDirHandle | null,
  opts: { idb?: IDBFactory; noPicker?: boolean; pickerThrows?: boolean } = {},
): { showDirectoryPicker?: unknown; indexedDB: IDBFactory } {
  const { factory } = fakeIndexedDb();
  return {
    ...(opts.noPicker
      ? {}
      : {
          showDirectoryPicker: () => {
            if (opts.pickerThrows || handle === null) {
              const e = new Error("The user aborted a request.");
              e.name = "AbortError";
              return Promise.reject(e);
            }
            return Promise.resolve(handle);
          },
        }),
    indexedDB: opts.idb ?? factory,
  };
}

/* ------------------------------------------------------------------ *
 * Capability reporting.
 * ------------------------------------------------------------------ */

describe("folderPickingSupported", () => {
  it("is false on an engine with no picker", () => {
    expect(folderPickingSupported({})).toBe(false);
    expect(folderPickingSupported(undefined)).toBe(false);
  });

  it("is true when the engine can pick a directory", () => {
    expect(folderPickingSupported(scopeWith(dirHandle("mods", {})))).toBe(true);
  });

  it("never fetches or reads storage when unsupported", async () => {
    const { factory, data } = fakeIndexedDb();
    const r = await loadPickedModFolder({ indexedDB: factory });
    expect(r.available).toBe(false);
    expect(r.kind).toBe("none");
    /* An engine that cannot pick must not even open the database: this is the
     * "no folder" answer, and it has to be reachable with storage disabled. */
    expect(data.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Remembering the folder.
 * ------------------------------------------------------------------ */

describe("remembering the picked folder", () => {
  it("survives a reload: pick once, read it on the next launch", async () => {
    const handle = dirHandle("mods", { "my-mod": { "manifest.json": MANIFEST("my-mod") } });
    const scope = scopeWith(handle);

    const picked = await pickModFolder(scope);
    expect(picked?.name).toBe("mods");

    /* A "later launch" is a fresh call against the same storage - nothing carried
     * over in a module variable. */
    expect((await savedModFolder(scope))?.name).toBe("mods");
    const report = await loadPickedModFolder(scope);
    expect(report.available).toBe(true);
    expect(report.kind).toBe("picked");
    expect(report.packs.map((p) => p.manifest.id)).toEqual(["my-mod"]);
  });

  it("reports a cancelled picker as no choice, not as a failure", async () => {
    const scope = scopeWith(null); /* the picker rejects with AbortError */
    expect(await pickModFolder(scope)).toBeNull();
    expect(await savedModFolder(scope)).toBeNull();
  });

  it("still uses a folder this session when storage cannot keep it", async () => {
    /* Private-browsing / storage-blocked: the pick must still work, because the
     * alternative is refusing a folder the player just chose. */
    const handle = dirHandle("mods", {});
    const { factory } = fakeIndexedDb({ openFails: true });
    const scope = scopeWith(handle, { idb: factory });
    expect((await pickModFolder(scope))?.name).toBe("mods");
    expect(await rememberModFolder(handle, scope)).toBe(false);
    expect(await savedModFolder(scope)).toBeNull();
  });

  it("forgets on request, and says there is no folder afterwards", async () => {
    const handle = dirHandle("mods", { m: { "manifest.json": MANIFEST("m") } });
    const scope = scopeWith(handle);
    await pickModFolder(scope);
    expect((await loadPickedModFolder(scope)).packs).toHaveLength(1);
    await forgetModFolder(scope);
    expect(await savedModFolder(scope)).toBeNull();
    expect((await loadPickedModFolder(scope)).available).toBe(false);
  });

  it("ignores a stored value that is not a directory handle", async () => {
    /* Anything else in that slot - an older format, another tab's write - must read
     * as "no folder" rather than being called through and throwing at boot. */
    const { factory, data } = fakeIndexedDb();
    data.set("modsDir", { kind: "file", name: "not-a-dir" });
    expect(await savedModFolder({ showDirectoryPicker: () => {}, indexedDB: factory })).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Permission.
 * ------------------------------------------------------------------ */

describe("permission", () => {
  it("treats a handle with no permission methods as readable", () => {
    /* Refusing it would report no mods for a folder that reads perfectly well. */
    const bare = {
      kind: "directory" as const,
      name: "mods",
      values: () => (async function* () {})(),
    };
    return expect(folderPermission(bare)).resolves.toBe("granted");
  });

  it("does not ask unless asked to", async () => {
    const perm = { state: "prompt" as const, onRequest: "granted" as const };
    const handle = dirHandle("mods", {}, perm);
    expect(await folderPermission(handle)).toBe("prompt");
    expect(perm.state).toBe("prompt");
  });

  it("asks when requested, and reports the answer", async () => {
    const granting = { state: "prompt" as const, onRequest: "granted" as const };
    expect(
      await folderPermission(dirHandle("mods", {}, granting), { request: true }),
    ).toBe("granted");
    const refusing = { state: "prompt" as const, onRequest: "denied" as const };
    expect(
      await folderPermission(dirHandle("mods", {}, refusing), { request: true }),
    ).toBe("denied");
  });

  it("reports a lapsed permission as an available folder with a problem", async () => {
    /* The quiet failure this exists to prevent: the handle is remembered, the
     * browser will not read it, and the player must be told rather than shown an
     * empty mod list. */
    const handle = dirHandle("mods", { m: { "manifest.json": MANIFEST("m") } }, {
      state: "prompt",
    });
    const scope = scopeWith(handle);
    await pickModFolder(scope);
    const r = await loadPickedModFolder(scope);
    expect(r.available).toBe(true);
    expect(r.kind).toBe("picked");
    expect(r.packs).toEqual([]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("Reconnect");
  });

  it("says so when permission was refused outright", async () => {
    const handle = dirHandle("mods", {}, { state: "denied" });
    const r = await readModDir(folderModSource(handle));
    expect(r.problems[0]).toContain("refused");
  });
});

/* ------------------------------------------------------------------ *
 * Reading the folder.
 * ------------------------------------------------------------------ */

describe("reading a mods folder", () => {
  it("reads every pack and its record files", async () => {
    const handle = dirHandle("mods", {
      "hound-mod": {
        "manifest.json": MANIFEST("hound-mod"),
        "monster.json": JSON.stringify({ records: [{ name: "Disk Hound" }] }),
      },
      "shiny-mod": { "manifest.json": MANIFEST("shiny-mod") },
    });
    const r = await readModDir(folderModSource(handle));
    expect(r.problems).toEqual([]);
    expect(r.packs.map((p) => p.manifest.id).sort()).toEqual(["hound-mod", "shiny-mod"]);
    const hound = r.packs.find((p) => p.manifest.id === "hound-mod");
    /* Keyed WITHOUT .json - the same keys a bundled pack's glob produces. */
    expect(Object.keys(hound!.files)).toEqual(["monster"]);
    expect(hound!.files["monster"]).toEqual({ records: [{ name: "Disk Hound" }] });
  });

  it("names the folder, since the browser will not say where it is", async () => {
    const r = await readModDir(folderModSource(dirHandle("my-mods", {})));
    expect(r.dir).toBe("my-mods/");
  });

  it("accepts a single mod's own folder, named after it", async () => {
    /* "Pick the mod you just unzipped" is the obvious first attempt, and reporting
     * nothing found for a folder that plainly holds a mod is the worse answer. */
    const handle = dirHandle("hound-mod", {
      "manifest.json": MANIFEST("hound-mod"),
      "monster.json": JSON.stringify({ records: [] }),
    });
    const r = await readModDir(folderModSource(handle));
    expect(r.problems).toEqual([]);
    expect(r.packs.map((p) => p.manifest.id)).toEqual(["hound-mod"]);
    expect(r.dir).toBe("hound-mod");
  });

  it("refuses a single mod folder whose manifest id is not its name", async () => {
    /* The same folder-name/id rule every other pack obeys: the enabled set, the
     * load order and a save's provenance all key off the id. */
    const handle = dirHandle("downloads", { "manifest.json": MANIFEST("hound-mod") });
    const r = await readModDir(folderModSource(handle));
    expect(r.packs).toEqual([]);
    expect(r.problems[0]).toContain("rename the folder");
  });

  it("honours load-order.json and reports an id that is not installed", async () => {
    const handle = dirHandle("mods", {
      "load-order.json": JSON.stringify({ order: ["b-mod", "ghost", "a-mod"] }),
      "a-mod": { "manifest.json": MANIFEST("a-mod") },
      "b-mod": { "manifest.json": MANIFEST("b-mod") },
    });
    const r = await readModDir(folderModSource(handle));
    expect(r.order).toEqual(["b-mod", "a-mod"]);
    expect(r.problems).toEqual(['load-order.json lists "ghost", which is not installed']);
  });

  it("keeps the packs when load-order.json is corrupt", async () => {
    const handle = dirHandle("mods", {
      "load-order.json": "{ this is not json",
      "a-mod": { "manifest.json": MANIFEST("a-mod") },
    });
    const r = await readModDir(folderModSource(handle));
    expect(r.packs.map((p) => p.manifest.id)).toEqual(["a-mod"]);
    expect(r.order).toEqual([]);
    expect(r.problems[0]).toContain("load-order.json could not be read");
  });

  it("never binds a pack's own load-order.json as a record file", async () => {
    const handle = dirHandle("mods", {
      "a-mod": {
        "manifest.json": MANIFEST("a-mod"),
        "load-order.json": JSON.stringify({ order: ["a-mod"] }),
      },
    });
    const r = await readModDir(folderModSource(handle));
    expect(Object.keys(r.packs[0]!.files)).toEqual([]);
  });

  it("reports a folder that is not a mod, and loads the others anyway", async () => {
    const handle = dirHandle("mods", {
      screenshots: { "notes.json": "{}" },
      "a-mod": { "manifest.json": MANIFEST("a-mod") },
    });
    const r = await readModDir(folderModSource(handle));
    expect(r.packs.map((p) => p.manifest.id)).toEqual(["a-mod"]);
    expect(r.problems).toEqual(["screenshots: no manifest.json, so it is not a mod folder"]);
  });

  it("reports a hand-edited manifest instead of booting with it", async () => {
    const handle = dirHandle("mods", {
      "a-mod": { "manifest.json": "{ oops" },
      "b-mod": { "manifest.json": MANIFEST("b-mod") },
    });
    const r = await readModDir(folderModSource(handle));
    expect(r.packs.map((p) => p.manifest.id)).toEqual(["b-mod"]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toContain("a-mod:");
  });

  it("loses one bad record file, not the whole pack", async () => {
    const handle = dirHandle("mods", {
      "a-mod": {
        "manifest.json": MANIFEST("a-mod"),
        "monster.json": "{ truncated",
        "object.json": JSON.stringify({ records: [] }),
      },
    });
    const r = await readModDir(folderModSource(handle));
    expect(r.packs).toHaveLength(1);
    expect(Object.keys(r.packs[0]!.files)).toEqual(["object"]);
    expect(r.problems[0]).toContain("a-mod/monster.json");
  });

  it("ignores files that are not JSON at all", async () => {
    const handle = dirHandle("mods", {
      "a-mod": {
        "manifest.json": MANIFEST("a-mod"),
        "README.txt": "hello",
        "cover.png": "PNG",
      },
    });
    const r = await readModDir(folderModSource(handle));
    expect(r.problems).toEqual([]);
    expect(Object.keys(r.packs[0]!.files)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * A mod is data, images and scripts in a FOLDER.
 * ------------------------------------------------------------------ */

describe("a picked folder's whole tree", () => {
  /** A pack with every kind of file, two levels deep. */
  const FULL: Tree = {
    "manifest.json": JSON.stringify({
      id: "full",
      name: "Full",
      version: "1.0.0",
      shape: "plugin",
      modApi: 1,
    }),
    "monster.json": "[]",
    "plugin.js": 'import { greet } from "./lib/greet.js";\nexport default { api: 1, hooks: () => ({}) };',
    lib: {
      "greet.js": 'import { B } from "./format.js";\nexport const greet = B;',
      "format.js": "export const B = (s) => s;",
    },
    tiles: { "orc.png": "PNG-BYTES" },
    data: { "spawns.json": '{"orc":3}' },
  };

  it("lists nested scripts and assets by path, and keeps record files top-level", async () => {
    /* Before this, both readers collected the top level only, so `lib/` and
     * `tiles/` were invisible - a mod system that silently drops half of a mod. */
    const report = await readModDir(folderModSource(dirHandle("mods", { full: FULL })));
    const pack = report.packs[0];
    expect(report.problems).toEqual([]);
    expect(pack?.code).toEqual(
      expect.arrayContaining(["plugin.js", "lib/greet.js", "lib/format.js"]),
    );
    /* A record contribution names its type by its filename, so only the top-level
     * ones count; a nested .json is the mod's own data. */
    expect(Object.keys(pack?.files ?? {})).toEqual(["monster"]);
    expect(pack?.assets).toEqual(
      expect.arrayContaining(["tiles/orc.png", "data/spawns.json"]),
    );
    expect(pack?.assets).not.toContain("plugin.js");
  });

  it("resolves the whole module graph into one importable URL", async () => {
    const report = await readModDir(folderModSource(dirHandle("mods", { full: FULL })));
    const url = await report.codeUrl?.("full", "plugin.js");
    expect(url).toMatch(/^blob:/u);
    /* Releasing the ENTRY releases the dependencies too: the graph made three blob
     * URLs and handing back only one would leak two per mod, per launch. */
    expect(() => report.codeUrl?.release?.(url as string)).not.toThrow();
  });

  it("reports which script is missing instead of failing anonymously", async () => {
    const broken: Tree = {
      "manifest.json": JSON.stringify({
        id: "broken",
        name: "B",
        version: "1.0.0",
        shape: "plugin",
        modApi: 1,
      }),
      "plugin.js": 'import "./lib/gone.js";',
    };
    const report = await readModDir(folderModSource(dirHandle("mods", { broken })));
    await expect(report.codeUrl?.("broken", "plugin.js")).rejects.toThrow(
      /lib\/gone\.js.*not in the mod folder/u,
    );
  });

  it("hands out ONE URL per asset, however often it is asked for", async () => {
    /* An <img src> may load long after the call that made the URL, so an asset URL
     * is never revoked - which makes minting a fresh one per call a leak that grows
     * with how often a mod draws. */
    const report = await readModDir(folderModSource(dirHandle("mods", { full: FULL })));
    const a = await report.assetUrl?.("full", "tiles/orc.png");
    const b = await report.assetUrl?.("full", "tiles/orc.png");
    expect(a).toMatch(/^blob:/u);
    expect(b).toBe(a);
  });

  it("returns null for an asset the pack does not have", async () => {
    const report = await readModDir(folderModSource(dirHandle("mods", { full: FULL })));
    expect(await report.assetUrl?.("full", "tiles/nope.png")).toBeNull();
    expect(await report.assetUrl?.("no-such-mod", "tiles/orc.png")).toBeNull();
  });

  it("finds a nested file case-insensitively, like every other lookup here", async () => {
    /* A mod authored on Windows and read on a case-sensitive volume must not lose
     * half its files, and the manifest lookup has always been caseless. */
    const report = await readModDir(folderModSource(dirHandle("mods", { full: FULL })));
    expect(await report.assetUrl?.("full", "TILES/Orc.PNG")).not.toBeNull();
  });
});
