/**
 * The purpose-keyed host-folder primitive (#158): the two platform
 * implementations, and the one claim that matters most - two different
 * purposes never collide over the same remembered folder, on either
 * platform, even when the caller never says so explicitly.
 */

import { describe, expect, it, vi } from "vitest";
import { createHostFolder, hostFolderPickingSupported } from "./host-folder";

describe("createHostFolder: platform selection", () => {
  it("returns undefined when neither platform is available", () => {
    expect(createHostFolder("mod-profile-sync", ".ndelve", {})).toBeUndefined();
  });

  it("prefers the desktop bridge when both are somehow present", async () => {
    const scope = {
      neoDesktop: { backup: vi.fn(async () => null) },
      showDirectoryPicker: () => Promise.reject(new Error("should not be called")),
    };
    const folder = createHostFolder("mod-profile-sync", ".ndelve", scope);
    await folder?.name();
    expect(scope.neoDesktop.backup).toHaveBeenCalled();
  });
});

describe("hostFolderPickingSupported", () => {
  it("true only when showDirectoryPicker is a function", () => {
    expect(hostFolderPickingSupported({})).toBe(false);
    expect(hostFolderPickingSupported({ showDirectoryPicker: () => {} })).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Desktop platform: a fake neoDesktop.backup bridge, keyed by (purpose,
 * name) pairs so it can serve more than one purpose in the same test,
 * exactly as the real IPC handler now does.
 * ------------------------------------------------------------------ */

function desktopScope(): { neoDesktop: { backup: ReturnType<typeof vi.fn> } } {
  const folders = new Map<string, string>();
  return {
    neoDesktop: {
      backup: vi.fn(async (op: string, arg?: unknown) => {
        const { purpose, name, text } = (arg ?? {}) as {
          purpose?: string;
          ext?: string;
          name?: string;
          text?: string;
        };
        const p = purpose ?? "";
        if (op === "name") return folders.get(p) ?? null;
        if (op === "choose") {
          folders.set(p, `Folder-${p}`);
          return folders.get(p);
        }
        if (op === "forget") {
          folders.delete(p);
          return { ok: true };
        }
        if (op === "write") {
          return { ok: folders.has(p) && typeof name === "string" && typeof text === "string" };
        }
        if (op === "list") return folders.has(p) ? [{ name: "x", text: "{}" }] : [];
        return null;
      }),
    },
  };
}

describe("desktop platform: purpose threads through every op", () => {
  it("choose()/name() are scoped per purpose, not shared globally", async () => {
    const scope = desktopScope();
    const a = createHostFolder("character-backup", ".neochar", scope);
    const b = createHostFolder("mod-profile-sync", ".ndelve", scope);
    expect(await a?.name()).toBeNull();
    expect(await b?.name()).toBeNull();
    await a?.choose();
    expect(await a?.name()).toBe("Folder-character-backup");
    /* The OTHER purpose was never touched by choosing this one. */
    expect(await b?.name()).toBeNull();
    await b?.choose();
    expect(await b?.name()).toBe("Folder-mod-profile-sync");
    expect(await a?.name()).toBe("Folder-character-backup");
  });

  it("forget() only clears its own purpose's folder", async () => {
    const scope = desktopScope();
    const a = createHostFolder("character-backup", ".neochar", scope);
    const b = createHostFolder("mod-profile-sync", ".ndelve", scope);
    await a?.choose();
    await b?.choose();
    await a?.forget();
    expect(await a?.name()).toBeNull();
    expect(await b?.name()).toBe("Folder-mod-profile-sync");
  });

  it("write() and list() report false/empty before a folder is chosen, for this purpose only", async () => {
    const scope = desktopScope();
    const a = createHostFolder("character-backup", ".neochar", scope);
    const b = createHostFolder("mod-profile-sync", ".ndelve", scope);
    expect(await b?.write("ruleset.ndelve", "{}")).toBe(false);
    await a?.choose();
    expect(await b?.write("ruleset.ndelve", "{}")).toBe(false); // still b's own folder unset
    await b?.choose();
    expect(await b?.write("ruleset.ndelve", "{}")).toBe(true);
    expect(await b?.list()).toEqual([{ name: "x", text: "{}" }]);
  });

  it("every call carries this instance's own purpose and ext, never the other one's", async () => {
    const scope = desktopScope();
    const b = createHostFolder("mod-profile-sync", ".ndelve", scope);
    await b?.choose();
    await b?.write("ruleset.ndelve", "{}");
    await b?.list();
    for (const call of scope.neoDesktop.backup.mock.calls) {
      const [, arg] = call as [string, { purpose?: string; ext?: string } | undefined];
      expect(arg?.purpose).toBe("mod-profile-sync");
      expect(arg?.ext).toBe(".ndelve");
    }
  });
});

/* ------------------------------------------------------------------ *
 * Browser platform: a fake IndexedDB, the same minimal shape
 * mod-backup.test.ts already proves out, extended to hold more than one
 * purpose's handle so collision is directly observable.
 * ------------------------------------------------------------------ */

interface FakeDirHandle {
  kind: "directory";
  name: string;
  queryPermission: () => Promise<"granted">;
  getFileHandle: () => Promise<{ createWritable: () => Promise<{ write: () => Promise<void>; close: () => Promise<void> }> }>;
  values: () => IterableIterator<{ kind: "file"; name: string; getFile(): Promise<{ text(): Promise<string> }> }>;
}

function fakeHandle(name: string, files: Record<string, string> = {}): FakeDirHandle {
  const entries = new Map(
    Object.entries(files).map(([n, text]) => [
      n,
      { kind: "file" as const, name: n, getFile: async () => ({ text: async () => text }) },
    ]),
  );
  return {
    kind: "directory",
    name,
    queryPermission: async () => "granted",
    getFileHandle: async () => ({
      createWritable: async () => ({ write: async () => undefined, close: async () => undefined }),
    }),
    values: () => entries.values(),
  };
}

function fakeRequest<T>(value: T): { result?: T; onsuccess?: (() => void) | null } {
  const req: { result?: T; onsuccess?: (() => void) | null } = { result: value };
  queueMicrotask(() => req.onsuccess?.());
  return req;
}

/** A fake browser scope: a real-enough IndexedDB, plus a directory picker
 * that always returns `nextPick` (settable between calls, for `choose()`). */
function browserScope(): {
  scope: {
    indexedDB: { open: () => unknown };
    showDirectoryPicker: () => Promise<FakeDirHandle>;
  };
  stored: Map<string, unknown>;
  setNextPick: (h: FakeDirHandle) => void;
} {
  const stored = new Map<string, unknown>();
  const storeNames = new Set<string>();
  const db = {
    objectStoreNames: { contains: (n: string) => storeNames.has(n) },
    createObjectStore: (n: string) => storeNames.add(n),
    transaction: () => {
      /* idbPut/idbDelete resolve on the TRANSACTION's own `oncomplete`, not
       * the request's `onsuccess` - a gap the read-only mod-backup.test.ts
       * fake never had to cover, since it never exercises `choose()`/`forget()`.
       * Queued here, at transaction-creation time, so it fires only after the
       * caller's own synchronous `tx.oncomplete = ...` assignment has run. */
      const tx: {
        objectStore: () => {
          get: (key: string) => unknown;
          put: (value: unknown, key: string) => unknown;
          delete: (key: string) => unknown;
        };
        oncomplete?: (() => void) | null;
        onerror?: (() => void) | null;
        onabort?: (() => void) | null;
      } = {
        objectStore: () => ({
          get: (key: string) => fakeRequest(stored.get(key)),
          put: (value: unknown, key: string) => {
            stored.set(key, value);
            return fakeRequest(undefined);
          },
          delete: (key: string) => {
            stored.delete(key);
            return fakeRequest(undefined);
          },
        }),
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  let nextPick: FakeDirHandle = fakeHandle("default");
  return {
    scope: {
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
      showDirectoryPicker: () => Promise.resolve(nextPick),
    },
    stored,
    setNextPick: (h) => {
      nextPick = h;
    },
  };
}

describe("browser platform: two purposes, two independent handles", () => {
  it("choosing one purpose's folder never touches another purpose's stored handle", async () => {
    const { scope, setNextPick } = browserScope();
    const a = createHostFolder("character-backup", ".neochar", scope);
    const b = createHostFolder("mod-profile-sync", ".ndelve", scope);

    setNextPick(fakeHandle("Characters"));
    await a?.choose();
    setNextPick(fakeHandle("ModSync"));
    await b?.choose();

    expect(await a?.name()).toBe("Characters");
    expect(await b?.name()).toBe("ModSync");
  });

  it("forgetting one purpose leaves the other's handle in the SAME IndexedDB store untouched", async () => {
    const { scope, stored, setNextPick } = browserScope();
    const a = createHostFolder("character-backup", ".neochar", scope);
    const b = createHostFolder("mod-profile-sync", ".ndelve", scope);
    setNextPick(fakeHandle("Characters"));
    await a?.choose();
    setNextPick(fakeHandle("ModSync"));
    await b?.choose();

    await a?.forget();
    expect(await a?.name()).toBeNull();
    expect(await b?.name()).toBe("ModSync");
    /* Both keys really did live in the one shared store, under distinct names. */
    expect([...stored.keys()].some((k) => k.includes("mod-profile-sync"))).toBe(true);
  });

  it("list() filters by this purpose's own extension, not the other purpose's", async () => {
    const { scope, setNextPick } = browserScope();
    const b = createHostFolder("mod-profile-sync", ".ndelve", scope);
    setNextPick(
      fakeHandle("ModSync", {
        "ruleset.ndelve": "{}",
        "Bilbo-abcdef12.neochar": "{}",
        "notes.txt": "irrelevant",
      }),
    );
    await b?.choose();
    const entries = await b?.list();
    expect(entries).toEqual([{ name: "ruleset.ndelve", text: "{}" }]);
  });

  it("write() resolves false with no folder chosen, true once one is", async () => {
    const { scope, setNextPick } = browserScope();
    const b = createHostFolder("mod-profile-sync", ".ndelve", scope);
    expect(await b?.write("ruleset.ndelve", "{}")).toBe(false);
    setNextPick(fakeHandle("ModSync"));
    await b?.choose();
    expect(await b?.write("ruleset.ndelve", "{}")).toBe(true);
  });
});
