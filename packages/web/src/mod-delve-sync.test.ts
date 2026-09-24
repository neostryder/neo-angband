/**
 * The revision/origin-device envelope around a synced Delve (#158), and the
 * pure decisions the "Apply changes and reload" checkpoint and the arrival
 * banner both need - kept separate from `host-folder.test.ts` (which proves
 * the folder primitive itself never collides across purposes) and from
 * `mod-delve.test.ts` (which owns the base `.ndelve` format this builds on).
 */

import { describe, expect, it } from "vitest";
import {
  DELVE_SYNC_FILENAME,
  classifyDelveSyncArrival,
  decodeDelveSync,
  delveSyncCanAutoApply,
  delveSyncDeviceLabel,
  delveSyncEnabledIsAuthoritative,
  delveSyncLastSeenRevision,
  encodeDelveSync,
  loadDelveSyncArrival,
  markDelveSyncSeen,
  nextDelveSyncRevision,
  performDelveSyncWrite,
  writeDelveSync,
  type DelveSyncMeta,
} from "./mod-delve-sync";
import { buildDelveFile, decodeDelve, type DelveFile, type DelveMod } from "./mod-delve";
import type { HostFolder, HostFolderEntry } from "./host-folder";

function mod(id: string, overrides: Partial<DelveMod> = {}): DelveMod {
  return {
    id,
    name: id,
    repo: `neostryder/neo-angband-mod-${id}`,
    tag: "v1.0.0",
    version: "1.0.0",
    enabled: true,
    flags: {},
    consents: [],
    ...overrides,
  };
}

function file(mods: readonly DelveMod[] = [mod("qol")]): DelveFile {
  return buildDelveFile({
    name: "Sync",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdWithEngine: "0.20.0",
    mods,
  });
}

/** An in-memory HostFolder, standing in for either real platform. */
function fakeFolder(opts: { chosen?: boolean; files?: Record<string, string> } = {}): HostFolder {
  let named = opts.chosen === false ? null : "Synced";
  const files = new Map(Object.entries(opts.files ?? {}));
  return {
    async name() {
      return named;
    },
    async choose() {
      named = "Synced";
      return named;
    },
    async forget() {
      named = null;
    },
    async write(name, text) {
      if (named === null) return false;
      files.set(name, text);
      return true;
    },
    async list(): Promise<readonly HostFolderEntry[]> {
      if (named === null) return [];
      return [...files.entries()].map(([name, text]) => ({ name, text }));
    },
  };
}

describe("encodeDelveSync / decodeDelveSync: round-trip the envelope", () => {
  it("reads back the same revision, origin device, and informational flag", () => {
    const meta: DelveSyncMeta = { revision: 7, originDevice: "Laptop-ab12cd", enabledSetInformational: false };
    const text = encodeDelveSync(file(), meta);
    const read = decodeDelveSync(text);
    expect(read?.meta).toEqual(meta);
    expect(read?.file.mods.map((m) => m.id)).toEqual(["qol"]);
  });

  it("the same file still decodes as a plain Delve, via the unmodified decodeDelve gate", () => {
    const text = encodeDelveSync(file(), { revision: 1, originDevice: "X", enabledSetInformational: false });
    const plain = decodeDelve(text);
    expect(plain.ok).toBe(true);
  });

  it("a plain Delve with no envelope fields decodes with meta: null, not a failure", () => {
    const text = JSON.stringify(file());
    const read = decodeDelveSync(text);
    expect(read).not.toBeNull();
    expect(read?.meta).toBeNull();
  });

  it("wrong magic is refused before the envelope is even considered", () => {
    expect(decodeDelveSync(JSON.stringify({ magic: "nope" }))).toBeNull();
  });

  it("a negative or non-integer revision reads as no envelope", () => {
    const bad = { ...file(), revision: -1, originDevice: "X" };
    expect(decodeDelveSync(JSON.stringify(bad))?.meta).toBeNull();
    const bad2 = { ...file(), revision: 1.5, originDevice: "X" };
    expect(decodeDelveSync(JSON.stringify(bad2))?.meta).toBeNull();
  });
});

describe("nextDelveSyncRevision", () => {
  it("starts at 1 with nothing written yet, and always increments by exactly one", () => {
    expect(nextDelveSyncRevision(null)).toBe(1);
    expect(nextDelveSyncRevision(1)).toBe(2);
    expect(nextDelveSyncRevision(41)).toBe(42);
  });
});

describe("delveSyncEnabledIsAuthoritative", () => {
  it("true when the effective set is exactly the stored set", () => {
    expect(delveSyncEnabledIsAuthoritative(["qol", "bug-fixes"], ["qol", "bug-fixes"])).toBe(true);
  });

  it("true when the effective set is a subset of the stored set", () => {
    expect(delveSyncEnabledIsAuthoritative(["qol", "bug-fixes"], ["qol"])).toBe(true);
  });

  it("false when the effective set contains an id the stored set does not - a disk-deployed extra", () => {
    expect(delveSyncEnabledIsAuthoritative(["qol"], ["qol", "vortex-deployed"])).toBe(false);
  });
});

describe("classifyDelveSyncArrival", () => {
  it("kind none when the folder has no synced file", () => {
    expect(classifyDelveSyncArrival(undefined, null)).toEqual({ kind: "none" });
  });

  it("kind none when the file is unreadable or has no envelope", () => {
    const found = { name: DELVE_SYNC_FILENAME, text: "not json" };
    expect(classifyDelveSyncArrival(found, null)).toEqual({ kind: "none" });
    const plain = { name: DELVE_SYNC_FILENAME, text: JSON.stringify(file()) };
    expect(classifyDelveSyncArrival(plain, null)).toEqual({ kind: "none" });
  });

  it("kind newer the first time this device has ever checked (lastSeenRevision null)", () => {
    const text = encodeDelveSync(file(), { revision: 1, originDevice: "X", enabledSetInformational: false });
    const result = classifyDelveSyncArrival({ name: DELVE_SYNC_FILENAME, text }, null);
    expect(result.kind).toBe("newer");
  });

  it("kind not-newer when the revision is equal to or older than last seen", () => {
    const text = encodeDelveSync(file(), { revision: 5, originDevice: "X", enabledSetInformational: false });
    expect(classifyDelveSyncArrival({ name: DELVE_SYNC_FILENAME, text }, 5).kind).toBe("not-newer");
    expect(classifyDelveSyncArrival({ name: DELVE_SYNC_FILENAME, text }, 9).kind).toBe("not-newer");
  });

  it("kind newer when the revision is strictly greater than last seen", () => {
    const text = encodeDelveSync(file(), { revision: 6, originDevice: "X", enabledSetInformational: false });
    const result = classifyDelveSyncArrival({ name: DELVE_SYNC_FILENAME, text }, 5);
    expect(result.kind).toBe("newer");
    if (result.kind === "newer") {
      expect(result.meta.revision).toBe(6);
      expect(result.file.mods.map((m) => m.id)).toEqual(["qol"]);
    }
  });
});

describe("delveSyncCanAutoApply", () => {
  const installed = new Map([["qol", "v1.0.0"], ["bug-fixes", "v2.0.0"]]);

  it("true when every enabled mod is installed at exactly the named tag", () => {
    const f = file([mod("qol", { tag: "v1.0.0" }), mod("bug-fixes", { tag: "v2.0.0" })]);
    const meta: DelveSyncMeta = { revision: 1, originDevice: "X", enabledSetInformational: false };
    expect(delveSyncCanAutoApply(f, meta, installed)).toBe(true);
  });

  it("false when a named, enabled mod is not installed here at all", () => {
    const f = file([mod("missing-mod", { tag: "v1.0.0" })]);
    const meta: DelveSyncMeta = { revision: 1, originDevice: "X", enabledSetInformational: false };
    expect(delveSyncCanAutoApply(f, meta, installed)).toBe(false);
  });

  it("false when a named, enabled mod is installed at a different tag", () => {
    const f = file([mod("qol", { tag: "v9.9.9" })]);
    const meta: DelveSyncMeta = { revision: 1, originDevice: "X", enabledSetInformational: false };
    expect(delveSyncCanAutoApply(f, meta, installed)).toBe(false);
  });

  it("a mismatched DISABLED entry does not block auto-apply", () => {
    const f = file([mod("qol", { tag: "v1.0.0" }), mod("uninstalled", { tag: "v1.0.0", enabled: false })]);
    const meta: DelveSyncMeta = { revision: 1, originDevice: "X", enabledSetInformational: false };
    expect(delveSyncCanAutoApply(f, meta, installed)).toBe(true);
  });

  it("false outright when the file's enabled set is informational, regardless of compatibility", () => {
    const f = file([mod("qol", { tag: "v1.0.0" })]);
    const meta: DelveSyncMeta = { revision: 1, originDevice: "X", enabledSetInformational: true };
    expect(delveSyncCanAutoApply(f, meta, installed)).toBe(false);
  });
});

describe("delveSyncDeviceLabel", () => {
  it("generates a label once and reuses it on every later call", () => {
    const store = new Map<string, string>();
    const scope = { localStorage: fakeStorage(store), navigator: { platform: "Win32" } };
    const first = delveSyncDeviceLabel(scope);
    const second = delveSyncDeviceLabel(scope);
    expect(second).toBe(first);
    expect(first).toContain("Win32");
  });

  it("falls back to a fixed label when there is no localStorage to persist into", () => {
    expect(delveSyncDeviceLabel({})).toBe("This device");
  });
});

describe("delveSyncLastSeenRevision / markDelveSyncSeen", () => {
  it("null before anything has ever been marked seen", () => {
    const scope = { localStorage: fakeStorage(new Map()) };
    expect(delveSyncLastSeenRevision(scope)).toBeNull();
  });

  it("round-trips whatever was last marked", () => {
    const scope = { localStorage: fakeStorage(new Map()) };
    markDelveSyncSeen(3, scope);
    expect(delveSyncLastSeenRevision(scope)).toBe(3);
    markDelveSyncSeen(4, scope);
    expect(delveSyncLastSeenRevision(scope)).toBe(4);
  });
});

describe("writeDelveSync", () => {
  it("writes revision 1 to an empty folder, and increments on a second write", async () => {
    const folder = fakeFolder();
    const first = await writeDelveSync(folder, file(), { originDevice: "A", enabledSetInformational: false });
    expect(first).toEqual({ ok: true, revision: 1 });
    const second = await writeDelveSync(folder, file(), { originDevice: "A", enabledSetInformational: false });
    expect(second).toEqual({ ok: true, revision: 2 });
  });
});

describe("performDelveSyncWrite: the Apply-checkpoint orchestrator", () => {
  const common = {
    storedEnabled: ["qol"],
    effectiveEnabled: ["qol"],
    originDevice: "Device-1",
    engineVersion: "0.20.0",
    delveName: "Mod profile sync",
  };

  it("no-op (null) when there is no folder configured", async () => {
    expect(
      await performDelveSyncWrite({ ...common, folder: undefined, candidates: [mod("qol")] }),
    ).toBeNull();
  });

  it("no-op when a folder exists but none is chosen yet", async () => {
    const folder = fakeFolder({ chosen: false });
    expect(await performDelveSyncWrite({ ...common, folder, candidates: [mod("qol")] })).toBeNull();
  });

  it("no-op when there is nothing enabled worth exporting", async () => {
    const folder = fakeFolder();
    expect(await performDelveSyncWrite({ ...common, folder, candidates: [] })).toBeNull();
  });

  it("writes a readable synced Delve, labelled informational when the enabled set is not authoritative", async () => {
    const folder = fakeFolder();
    const result = await performDelveSyncWrite({
      ...common,
      folder,
      candidates: [mod("qol")],
      storedEnabled: ["qol"],
      effectiveEnabled: ["qol", "vortex-deployed"], // an extra the store never recorded
    });
    expect(result).toEqual({ ok: true, revision: 1 });
    const [entry] = await folder.list();
    const read = decodeDelveSync(entry?.text ?? "");
    expect(read?.meta?.enabledSetInformational).toBe(true);
    expect(read?.file.mods.map((m) => m.id)).toEqual(["qol"]);
  });

  it("labels the write authoritative when the stored and effective sets agree", async () => {
    const folder = fakeFolder();
    const result = await performDelveSyncWrite({ ...common, folder, candidates: [mod("qol")] });
    expect(result?.ok).toBe(true);
    const [entry] = await folder.list();
    const read = decodeDelveSync(entry?.text ?? "");
    expect(read?.meta?.enabledSetInformational).toBe(false);
  });
});

describe("loadDelveSyncArrival: the boot/menu-open read side", () => {
  it("kind none with no folder configured", async () => {
    expect(await loadDelveSyncArrival(undefined, null)).toEqual({ kind: "none" });
  });

  it("kind none with a folder but nothing synced into it yet", async () => {
    const folder = fakeFolder();
    expect(await loadDelveSyncArrival(folder, null)).toEqual({ kind: "none" });
  });

  it("kind newer once a write lands and this device has not seen it", async () => {
    const folder = fakeFolder();
    await writeDelveSync(folder, file(), { originDevice: "A", enabledSetInformational: false });
    const result = await loadDelveSyncArrival(folder, null);
    expect(result.kind).toBe("newer");
  });

  it("kind not-newer once this device has already seen that revision", async () => {
    const folder = fakeFolder();
    await writeDelveSync(folder, file(), { originDevice: "A", enabledSetInformational: false });
    const result = await loadDelveSyncArrival(folder, 1);
    expect(result.kind).toBe("not-newer");
  });
});

/** A minimal, real-enough `Storage` over a plain Map, for the two localStorage-backed helpers. */
function fakeStorage(backing: Map<string, string>): Storage {
  return {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => {
      backing.set(k, v);
    },
    removeItem: (k: string) => {
      backing.delete(k);
    },
    clear: () => backing.clear(),
    key: (i: number) => [...backing.keys()][i] ?? null,
    get length() {
      return backing.size;
    },
  } as Storage;
}
