/**
 * Ticket #133's BackupFolder, both platforms.
 *
 * Two claims matter enough to be load-bearing tests rather than trusted by
 * inspection: the desktop path never lets the folder's real PATH leak back
 * out of `neoDesktop.backup` (only a name and {ok} booleans cross it), and
 * `notifyBackupSinks` contains a throw to the ONE mod that threw, per the
 * fault table in CLOUD_BACKUP_DESIGN.md.
 *
 * Ticket #24 adds the read side: `list()`/`readBackupFiles` on both
 * platforms, and `newBackupArrivals`, the pure "who is worth asking about"
 * filter the host's own checkpoint is built on.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backupFilename,
  backupPickingSupported,
  clearBackupSinks,
  createBackupFolder,
  newBackupArrivals,
  notifyBackupSinks,
  readBackupFiles,
  type BackupFileRead,
} from "./mod-backup";
import { encodeTransfer, type TransferMeta } from "./save-transfer";

const META: TransferMeta = {
  name: "Bilbo",
  race: "Hobbit",
  cls: "Rogue",
  sex: "Male",
  level: 12,
  depth: 10,
  maxDepth: 10,
  turn: 5000,
  alive: true,
};

function neochar(lineage: string, meta: TransferMeta = META): string {
  return encodeTransfer({
    meta,
    save: "",
    engine: "0.10.0",
    exportedAt: "2026-07-31T12:00:00.000Z",
    lineage,
  });
}

afterEach(() => {
  clearBackupSinks();
});

describe("backupFilename", () => {
  it("is stable across levels - overwritten in place, not one file per level", () => {
    expect(backupFilename("Bilbo", "abcdef1234567890")).toBe("Bilbo-abcdef12.neochar");
    expect(backupFilename("Bilbo", "abcdef1234567890")).toBe(
      backupFilename("Bilbo", "abcdef1234567890"),
    );
  });

  it("sanitizes the name the same way transferFilename does", () => {
    expect(backupFilename("Sir Bilbo!!", "deadbeef00000000")).toBe(
      "Sir-Bilbo-deadbeef.neochar",
    );
  });
});

describe("desktop platform: the real path never crosses the bridge", () => {
  function desktopScope(chosen: string): { neoDesktop: { backup: ReturnType<typeof vi.fn> } } {
    let folder: string | null = null;
    return {
      neoDesktop: {
        backup: vi.fn(async (op: string, arg?: unknown) => {
          if (op === "name") return folder ? folder.split(/[\\/]/).pop() : null;
          if (op === "choose") {
            folder = chosen;
            return chosen.split(/[\\/]/).pop();
          }
          if (op === "forget") {
            folder = null;
            return { ok: true };
          }
          if (op === "write") {
            const { name } = (arg ?? {}) as { name?: string };
            return { ok: folder !== null && typeof name === "string" };
          }
          return { ok: false };
        }),
      },
    };
  }

  it("choose() and name() report a display name, never the folder passed in", async () => {
    const scope = desktopScope("C:\\Users\\player\\Dropbox\\NeoAngband");
    const backup = createBackupFolder("qol", scope);
    expect(backup).toBeDefined();
    const chosen = await backup?.choose();
    expect(chosen).toBe("NeoAngband");
    expect(await backup?.name()).toBe("NeoAngband");
    /* Every call into the bridge only ever carries op + a leaf/name/text - never
     * the chosen path back out. */
    for (const call of scope.neoDesktop.backup.mock.calls) {
      const [, arg] = call as [string, unknown];
      if (arg && typeof arg === "object") {
        expect(JSON.stringify(arg)).not.toContain("Dropbox");
      }
    }
  });

  it("write() reports the bridge's {ok}, and forget() clears the remembered folder", async () => {
    const scope = desktopScope("C:\\backups");
    const backup = createBackupFolder("qol", scope);
    expect(await backup?.write("Bilbo-abcdef12.neochar", "{}")).toBe(false); // no folder yet
    await backup?.choose();
    expect(await backup?.write("Bilbo-abcdef12.neochar", "{}")).toBe(true);
    await backup?.forget();
    expect(await backup?.name()).toBeNull();
  });

  it("returns undefined only when neither platform is available", () => {
    expect(createBackupFolder("qol", {})).toBeUndefined();
  });
});

describe("backupPickingSupported", () => {
  it("true only when showDirectoryPicker is a function", () => {
    expect(backupPickingSupported({})).toBe(false);
    expect(backupPickingSupported({ showDirectoryPicker: () => {} })).toBe(true);
  });
});

describe("notifyBackupSinks: per-mod fault containment", () => {
  it("every registered mod's onSave runs, in the order registered", async () => {
    const scope = {
      neoDesktop: { backup: vi.fn(async () => ({ ok: true })) },
    };
    const seen: string[] = [];
    createBackupFolder("a", scope)?.onSave((f) => seen.push(`a:${f.name}`));
    createBackupFolder("b", scope)?.onSave((f) => seen.push(`b:${f.name}`));
    notifyBackupSinks(() => ({ name: "Bilbo-abcdef12.neochar", text: "{}" }));
    expect(seen).toEqual(["a:Bilbo-abcdef12.neochar", "b:Bilbo-abcdef12.neochar"]);
  });

  it("a throw from one mod's onSave does not stop another mod's, and is reported once", () => {
    const scope = { neoDesktop: { backup: vi.fn(async () => ({ ok: true })) } };
    const seen: string[] = [];
    const reported: Array<{ id: string; err: unknown }> = [];
    createBackupFolder("bad", scope)?.onSave(() => {
      throw new Error("boom");
    });
    createBackupFolder("good", scope)?.onSave((f) => seen.push(f.name));
    notifyBackupSinks(
      () => ({ name: "x.neochar", text: "{}" }),
      (id, err) => reported.push({ id, err }),
    );
    expect(seen).toEqual(["x.neochar"]);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.id).toBe("bad");
  });

  it("a mod that threw once is dropped from the registry, not retried forever", () => {
    const scope = { neoDesktop: { backup: vi.fn(async () => ({ ok: true })) } };
    let calls = 0;
    createBackupFolder("bad", scope)?.onSave(() => {
      calls++;
      throw new Error("boom");
    });
    notifyBackupSinks(() => ({ name: "x.neochar", text: "{}" }));
    notifyBackupSinks(() => ({ name: "x.neochar", text: "{}" }));
    expect(calls).toBe(1);
  });
});

describe("list()/readBackupFiles: ticket #24's read side", () => {
  function desktopListScope(
    files: readonly { name: string; text: string }[],
  ): { neoDesktop: { backup: ReturnType<typeof vi.fn> } } {
    let chosen: string | null = null;
    return {
      neoDesktop: {
        backup: vi.fn(async (op: string) => {
          if (op === "choose") {
            chosen = "picked";
            return "picked";
          }
          if (op === "list") return chosen === null ? [] : files;
          return null;
        }),
      },
    };
  }

  it("desktop: identifies a file's lineage without decoding its save bytes", async () => {
    const scope = desktopListScope([{ name: "Bilbo-lin00001.neochar", text: neochar("lin-bilbo") }]);
    const backup = createBackupFolder("qol", scope);
    expect(await backup?.list()).toEqual([]); // no folder chosen yet
    await backup?.choose();
    const entries = await backup?.list();
    expect(entries).toEqual([
      { name: "Bilbo-lin00001.neochar", lineage: "lin-bilbo", characterName: "Bilbo", level: 12 },
    ]);
  });

  it("desktop: reports a file it could not parse by name, without a lineage", async () => {
    const scope = desktopListScope([{ name: "garbage.neochar", text: "not json" }]);
    const backup = createBackupFolder("qol", scope);
    await backup?.choose();
    expect(await backup?.list()).toEqual([
      { name: "garbage.neochar", characterName: "", level: 0 },
    ]);
  });

  it("browser: entries() lists every readable .neochar file, filtering anything else", async () => {
    const entries = new Map<string, { kind: "file"; name: string; getFile(): Promise<{ text(): Promise<string> }> }>();
    entries.set("Bilbo.neochar", {
      kind: "file",
      name: "Bilbo.neochar",
      getFile: async () => ({ text: async () => neochar("lin-bilbo") }),
    });
    entries.set("notes.txt", {
      kind: "file",
      name: "notes.txt",
      getFile: async () => ({ text: async () => "irrelevant" }),
    });
    const handle = {
      kind: "directory" as const,
      name: "NeoAngband",
      queryPermission: async () => "granted" as const,
      getFileHandle: async () => ({ createWritable: async () => ({ write: async () => undefined, close: async () => undefined }) }),
      values: () => entries.values(),
    };
    const stored = new Map<string, unknown>();
    stored.set("backup:qol", handle);
    const storeNames = new Set<string>();
    const db = {
      objectStoreNames: { contains: (n: string) => storeNames.has(n) },
      createObjectStore: (n: string) => storeNames.add(n),
      transaction: () => ({
        objectStore: () => ({
          get: (key: string) => fakeRequest(stored.get(key)),
          put: (value: unknown, key: string) => {
            stored.set(key, value);
            return fakeRequest(undefined);
          },
        }),
      }),
    };
    const scope = {
      indexedDB: {
        open: () => {
          const req: {
            result?: unknown;
            onsuccess?: (() => void) | null;
            onupgradeneeded?: (() => void) | null;
          } = {};
          queueMicrotask(() => {
            req.result = db;
            req.onupgradeneeded?.();
            req.onsuccess?.();
          });
          return req;
        },
      },
    };
    const files = await readBackupFiles("qol", scope);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("Bilbo.neochar");
    expect(files[0]?.peek.ok && files[0].peek.lineage).toBe("lin-bilbo");
  });

  /** A minimal IDBRequest-shaped object that resolves on the next microtask. */
  function fakeRequest<T>(value: T): { result?: T; onsuccess?: (() => void) | null } {
    const req: { result?: T; onsuccess?: (() => void) | null } = { result: value };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }
});

describe("newBackupArrivals: who is worth asking about", () => {
  function file(lineage: string | undefined, name = `${lineage ?? "unreadable"}.neochar`): BackupFileRead {
    return {
      name,
      text: lineage ? neochar(lineage) : "not json",
      peek: lineage
        ? { ok: true, meta: META, engine: "0.10.0", exportedAt: "", lineage }
        : { ok: false, why: "unreadable" },
    };
  }

  it("offers a lineage that is in neither the roster nor the death ledger", () => {
    const arrivals = newBackupArrivals([file("lin-new")], new Set(), new Set());
    expect(arrivals.map((f) => f.name)).toEqual(["lin-new.neochar"]);
  });

  it("does not offer a lineage already in the local roster", () => {
    const arrivals = newBackupArrivals([file("lin-here")], new Set(["lin-here"]), new Set());
    expect(arrivals).toEqual([]);
  });

  it("does not offer a lineage this roster has recorded a death for", () => {
    const arrivals = newBackupArrivals([file("lin-dead")], new Set(), new Set(["lin-dead"]));
    expect(arrivals).toEqual([]);
  });

  it("skips a file it could not even peek, rather than offering a nameless import", () => {
    const arrivals = newBackupArrivals([file(undefined)], new Set(), new Set());
    expect(arrivals).toEqual([]);
  });

  it("reports a lineage found twice (two mods, one folder) only once", () => {
    const arrivals = newBackupArrivals(
      [file("lin-dup", "a.neochar"), file("lin-dup", "b.neochar")],
      new Set(),
      new Set(),
    );
    expect(arrivals.map((f) => f.name)).toEqual(["a.neochar"]);
  });
});
