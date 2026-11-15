/**
 * The cloud-backup name rule and the persisted-folder record, against a real
 * filesystem - same instrument mod-archive.test.ts already uses for the sibling
 * channel this one is modeled on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  CHARACTER_BACKUP_PURPOSE,
  BACKUP_LIMITS,
  backupFolderDisplayName,
  hostFolderRecordFile,
  isBackupPurpose,
  isBackupFileName,
  isHostFolderFileName,
  listBackupFiles,
  readBackupFolder,
  writeBackupFolder,
  writeBackupFile,
  createBackupRelay,
  readModBackupFolder,
} from "./backup-folder.js";
import { createDesktopAuthority } from "./net-relay.js";

const [{ createBackupFolder }, bindings, snapshots, store] = await Promise.all([
  "../../web/src/mod-backup.ts", "../../web/src/mod-consent-binding.ts", "../../web/src/mod-code-snapshot.ts", "../../web/src/mod-store.ts",
].map((modulePath) => import(modulePath)));

const openRace = vi.hoisted(() => ({ beforeOpen: undefined as ((file: unknown) => void) | undefined }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, openSync: (...args: Parameters<typeof actual.openSync>) => {
    openRace.beforeOpen?.(args[0]);
    return actual.openSync(...args);
  } };
});

let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(process.cwd(), "neo-backup-"));
});

afterEach(() => {
  openRace.beforeOpen = undefined;
  if (path.dirname(path.resolve(base)) !== process.cwd()) throw new Error("The fixture left the workspace.");
  fs.rmSync(base, { recursive: true, force: true });
});

describe("isBackupFileName", () => {
  it("accepts a plain .neochar leaf", () => {
    expect(isBackupFileName("Bilbo-a1b2c3d4.neochar")).toBe(true);
  });

  it("rejects a path, traversal, a leading dot, and the wrong extension", () => {
    expect(isBackupFileName("../x.neochar")).toBe(false);
    expect(isBackupFileName("a/b.neochar")).toBe(false);
    expect(isBackupFileName("a\\b.neochar")).toBe(false);
    expect(isBackupFileName(".hidden.neochar")).toBe(false);
    expect(isBackupFileName("Bilbo.zip")).toBe(false);
    expect(isBackupFileName(42)).toBe(false);
  });
});

describe("the persisted folder record", () => {
  it("has no folder before one is chosen", () => {
    expect(readBackupFolder(base)).toBeNull();
  });

  it("remembers a chosen folder across a fresh read", () => {
    const chosen = path.join(base, "Dropbox", "NeoAngband");
    writeBackupFolder(base, chosen);
    expect(readBackupFolder(base)).toBe(chosen);
    expect(backupFolderDisplayName(readBackupFolder(base) as string)).toBe(
      "NeoAngband",
    );
  });

  it("converts the previous pointer and drops malformed legacy pointers", () => {
    const file = path.join(base, "backup-folder.json");
    fs.writeFileSync(file, JSON.stringify({ path: path.join(base, "Old") }), "utf8");
    expect(readBackupFolder(base)).toBe(path.join(base, "Old"));
    expect(fs.readFileSync(file, "utf8")).toContain('"format": "neo-angband/desktop/backup-folder"');
    fs.writeFileSync(file, "{broken", "utf8");
    expect(() => readBackupFolder(base)).not.toThrow();
    expect(readBackupFolder(base)).toBeNull();
  });

  it("forgetting clears it, and forgetting twice is not an error", () => {
    writeBackupFolder(base, path.join(base, "x"));
    writeBackupFolder(base, null);
    expect(readBackupFolder(base)).toBeNull();
    expect(() => writeBackupFolder(base, null)).not.toThrow();
  });

  it("an unreadable or non-JSON record reads as no folder, not a crash", () => {
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, "backup-folder.json"), "not json", "utf8");
    expect(readBackupFolder(base)).toBeNull();
  });
});

describe("listBackupFiles: ticket #24's read side", () => {
  it("reads every .neochar file's name and text out of the folder", () => {
    fs.writeFileSync(path.join(base, "Bilbo-abcdef12.neochar"), '{"a":1}', "utf8");
    fs.writeFileSync(path.join(base, "Frodo-00112233.neochar"), '{"b":2}', "utf8");
    const files = listBackupFiles(base).sort((a, b) => a.name.localeCompare(b.name));
    expect(files).toEqual([
      { name: "Bilbo-abcdef12.neochar", text: '{"a":1}' },
      { name: "Frodo-00112233.neochar", text: '{"b":2}' },
    ]);
  });

  it("ignores anything that is not a plain .neochar leaf name", () => {
    fs.writeFileSync(path.join(base, "Bilbo-abcdef12.neochar"), "{}", "utf8");
    fs.writeFileSync(path.join(base, "notes.txt"), "not a character file", "utf8");
    fs.writeFileSync(path.join(base, ".hidden.neochar"), "{}", "utf8");
    expect(listBackupFiles(base)).toEqual([{ name: "Bilbo-abcdef12.neochar", text: "{}" }]);
  });

  it("reports an empty list for a folder that does not exist, not a crash", () => {
    expect(listBackupFiles(path.join(base, "does-not-exist"))).toEqual([]);
  });

  it("skips one unreadable file rather than failing the whole listing", () => {
    fs.writeFileSync(path.join(base, "Bilbo-abcdef12.neochar"), "{}", "utf8");
    /* A directory with a .neochar-shaped name: readdirSync lists it, and
     * reading it as a file throws - the race/permissions case this exists
     * to tolerate. */
    fs.mkdirSync(path.join(base, "Frodo-00112233.neochar"));
    expect(listBackupFiles(base)).toEqual([{ name: "Bilbo-abcdef12.neochar", text: "{}" }]);
  });
});

describe("purpose-keying (#158): two callers, two remembered folders", () => {
  it("the original character-backup purpose keeps the legacy fixed file name", () => {
    expect(hostFolderRecordFile(CHARACTER_BACKUP_PURPOSE)).toBe("backup-folder.json");
    expect(hostFolderRecordFile("character-backup")).toBe("backup-folder.json");
  });

  it("any other purpose gets its own file, named from the purpose", () => {
    expect(hostFolderRecordFile("mod-profile-sync")).toBe("backup-folder-mod-profile-sync.json");
  });

  it("refuses a purpose that would leave the user folder", () => {
    for (const bad of ["x/../../sentinel", "..", "a/b", "a\b", "A", "", "-x", "x.json", "x".repeat(65)]) {
      expect(isBackupPurpose(bad), bad).toBe(false);
      expect(() => hostFolderRecordFile(bad), bad).toThrow();
    }
    const sentinel = path.join(path.dirname(base), "sentinel.json");
    fs.writeFileSync(sentinel, "keep");
    try {
      expect(() => writeBackupFolder(base, null, "x/../../sentinel")).toThrow();
      expect(fs.existsSync(sentinel)).toBe(true);
    } finally {
      fs.rmSync(sentinel, { force: true });
    }
    expect(isBackupPurpose("mod-profile-sync")).toBe(true);
    expect(isBackupPurpose(CHARACTER_BACKUP_PURPOSE)).toBe(true);
  });

  it("a mod-profile-sync folder and a character-backup folder do not collide", () => {
    writeBackupFolder(base, path.join(base, "Characters"), CHARACTER_BACKUP_PURPOSE);
    writeBackupFolder(base, path.join(base, "ModSync"), "mod-profile-sync");
    expect(readBackupFolder(base, CHARACTER_BACKUP_PURPOSE)).toBe(path.join(base, "Characters"));
    expect(readBackupFolder(base, "mod-profile-sync")).toBe(path.join(base, "ModSync"));
    /* Forgetting one purpose's folder leaves the other's completely alone. */
    writeBackupFolder(base, null, "mod-profile-sync");
    expect(readBackupFolder(base, "mod-profile-sync")).toBeNull();
    expect(readBackupFolder(base, CHARACTER_BACKUP_PURPOSE)).toBe(path.join(base, "Characters"));
  });

  it("readBackupFolder/writeBackupFolder default to the original purpose untouched", () => {
    /* Every existing call site (main.ts, before #158) calls these with no
     * purpose argument at all - this is the backward-compatibility contract
     * the generalisation must not break. */
    writeBackupFolder(base, path.join(base, "Legacy"));
    expect(readBackupFolder(base)).toBe(path.join(base, "Legacy"));
    expect(fs.existsSync(path.join(base, "backup-folder.json"))).toBe(true);
  });

  it("isHostFolderFileName generalises isBackupFileName to an arbitrary extension", () => {
    expect(isHostFolderFileName("ironman.ndelve", ".ndelve")).toBe(true);
    expect(isHostFolderFileName("ironman.neochar", ".ndelve")).toBe(false);
    expect(isHostFolderFileName("../x.ndelve", ".ndelve")).toBe(false);
    /* The original wrapper is unchanged: still .neochar-only. */
    expect(isBackupFileName("ironman.ndelve")).toBe(false);
  });

  it("refuses Windows devices, alternate streams, traversal, and invalid extensions", () => {
    for (const name of ["CON.neochar", "aux.neochar", "LPT1.neochar", "COM\u00b9.neochar", "CON .neochar", "CONIN$.neochar", "C:x.neochar", "a:stream.neochar", "a..b.neochar", "a/b.neochar", "a\\b.neochar", "a?.neochar", "a\n.neochar"]) {
      expect(isHostFolderFileName(name, ".neochar"), name).toBe(false);
    }
    expect(isHostFolderFileName("x.exe", "")).toBe(false);
    expect(isHostFolderFileName("x.exe", ".exe/..")).toBe(false);
  });

  it("listBackupFiles reads a purpose's own extension, not .neochar unconditionally", () => {
    fs.writeFileSync(path.join(base, "ruleset.ndelve"), "{}", "utf8");
    fs.writeFileSync(path.join(base, "Bilbo-abcdef12.neochar"), "{}", "utf8");
    expect(listBackupFiles(base, ".ndelve")).toEqual([{ name: "ruleset.ndelve", text: "{}" }]);
    expect(listBackupFiles(base, ".neochar")).toEqual([
      { name: "Bilbo-abcdef12.neochar", text: "{}" },
    ]);
  });
});

describe("backup writes", () => {
  it("requires a fresh host confirmation for each replacement and leaves declined writes unchanged", async () => {
    let asks = 0;
    const decline = async () => { asks++; return false; };
    const accept = async () => { asks++; return true; };
    expect(await writeBackupFile(base, "Bilbo.neochar", "first", ".neochar", decline)).toBe(true);
    expect(asks).toBe(0);
    expect(await writeBackupFile(base, "Bilbo.neochar", "second", ".neochar", decline)).toBe(false);
    expect(fs.readFileSync(path.join(base, "Bilbo.neochar"), "utf8")).toBe("first");
    expect(await writeBackupFile(base, "Bilbo.neochar", "second", ".neochar", accept)).toBe(true);
    expect(await writeBackupFile(base, "Bilbo.neochar", "third", ".neochar", decline)).toBe(false);
    expect(asks).toBe(3);
    expect(fs.readFileSync(path.join(base, "Bilbo.neochar"), "utf8")).toBe("second");
    expect(await writeBackupFile(base, "Bilbo.neochar", "third", ".neochar", async () => { throw new Error("dialog failed"); })).toBe(false);
    expect(fs.readFileSync(path.join(base, "Bilbo.neochar"), "utf8")).toBe("second");
  });

  it("rejects invalid names and oversized UTF-8 text without creating files or asking", async () => {
    const confirm = async () => { throw new Error("The dialog must not open."); };
    expect(await writeBackupFile(base, "../x.neochar", "bad", ".neochar", confirm)).toBe(false);
    expect(await writeBackupFile(base, "big.neochar", "\u00e9".repeat(BACKUP_LIMITS.fileBytes / 2 + 1), ".neochar", confirm)).toBe(false);
    expect(fs.readdirSync(base)).toEqual([]);
  });

  it("enforces the file count and total byte quotas without creating another file", async () => {
    for (let i = 0; i < BACKUP_LIMITS.files; i++) fs.writeFileSync(path.join(base, `${i}.neochar`), "");
    expect(await writeBackupFile(base, "extra.neochar", "x", ".neochar", async () => true)).toBe(false);
    expect(fs.existsSync(path.join(base, "extra.neochar"))).toBe(false);
    fs.truncateSync(path.join(base, "0.neochar"), BACKUP_LIMITS.totalBytes);
    expect(await writeBackupFile(base, "1.neochar", "x", ".neochar", async () => true)).toBe(false);
    expect(fs.statSync(path.join(base, "1.neochar")).size).toBe(0);
  });

  it("does not read or overwrite a hard link and refuses a linked directory", async () => {
    const target = path.join(base, "target");
    fs.mkdirSync(target);
    const sentinel = path.join(target, "outside.neochar");
    fs.writeFileSync(sentinel, "keep");
    const link = path.join(base, "linked.neochar");
    fs.linkSync(sentinel, link);
    expect(await writeBackupFile(base, "linked.neochar", "stolen", ".neochar", async () => true)).toBe(false);
    expect(listBackupFiles(base)).toEqual([]);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("keep");
    const linkedDir = path.join(base, "linked-dir");
    fs.symlinkSync(target, linkedDir, "junction");
    expect(await writeBackupFile(linkedDir, "new.neochar", "bad", ".neochar", async () => true)).toBe(false);
    expect(listBackupFiles(linkedDir)).toEqual([]);
    expect(fs.existsSync(path.join(target, "new.neochar"))).toBe(false);
  });

  it("checks the file again after the confirmation yields", async () => {
    const file = path.join(base, "Bilbo.neochar");
    const sentinel = path.join(base, "sentinel.txt");
    fs.writeFileSync(file, "original");
    fs.writeFileSync(sentinel, "keep");
    const result = await writeBackupFile(base, "Bilbo.neochar", "bad", ".neochar", async () => {
      fs.unlinkSync(file);
      fs.linkSync(sentinel, file);
      return true;
    });
    expect(result).toBe(false);
    expect(fs.readFileSync(sentinel, "utf8")).toBe("keep");
  });
});

describe("installation backup allocations", () => {
  const decision = (modId: string, digest = "a".repeat(64)) => ({ modId, digest, grants: ["backup:folder"], destinations: [] });
  const folderKey = (modId: string) => createHash("sha256").update(JSON.stringify(["backup-folder", modId])).digest("hex");

  it.each(["a", "@host/mod-profile-sync"])("remembers %s across digests while requiring fresh consent", async (modId) => {
    const authority = createDesktopAuthority();
    const original = await authority.report(decision(modId), 1, async () => true) as Record<string, unknown>;
    const choose = vi.fn(async () => base);
    const relay = createBackupRelay({ authority, userBase: path.join(base, "records"), choose,
      confirmReplace: async () => true, confirmRead: async () => true });
    const name = modId.startsWith("@host/") ? "keep.ndelve" : "keep.neochar";
    expect(await relay.handle("choose", original, 1)).toBe(path.basename(base));
    expect(await relay.handle("write", { ...original, name, text: "keep" }, 1)).toEqual({ ok: true });
    const changed = decision(modId, "b".repeat(64));
    const decline = vi.fn(async () => false);
    const refused = await authority.report({ ...changed, installation: original["installation"] }, 1, decline);
    expect(decline).toHaveBeenCalledOnce();
    expect(await relay.handle("list", refused, 1)).toEqual({ ok: false });
    expect(await relay.handle("list", { ...original, digest: changed.digest }, 1)).toEqual({ ok: false });
    const approve = vi.fn(async () => true);
    const updated = await authority.report(changed, 1, approve) as Record<string, unknown>;
    expect(approve).toHaveBeenCalledOnce();
    expect(await relay.handle("name", updated, 1)).toBe(path.basename(base));
    expect(await relay.handle("list", updated, 1)).toEqual([{ name, size: 4 }]);
    expect(await relay.handle("read", { ...updated, name }, 1)).toEqual({ name, text: "keep" });
    expect(await relay.handle("list", original, 1)).toEqual({ ok: false });
    expect(choose).toHaveBeenCalledOnce();
    expect(readBackupFolder(path.join(base, "records"), folderKey(modId))).toBe(path.join(base, folderKey(modId)));
    const other = await authority.report(decision(modId, "c".repeat(64)), 2, async () => true);
    const otherMachine = createBackupRelay({ authority, userBase: path.join(base, "other-records"), choose,
      confirmReplace: async () => true, confirmRead: async () => true });
    await otherMachine.handle("choose", other, 2);
    expect(await otherMachine.handle("list", other, 2)).toEqual([{ name, size: 4 }]);
  });

  it("adopts the current digest record and renames its folder without losing files", async () => {
    const { authority, relay, a } = await fixture();
    const legacyKey = authority.lookup(a, 1)!.key;
    const legacy = path.join(base, legacyKey);
    const stable = path.join(base, folderKey("a"));
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, "keep.neochar"), "keep");
    fs.writeFileSync(path.join(legacy, "unrelated.txt"), "also keep");
    writeBackupFolder(path.join(base, "records"), legacy, legacyKey);
    expect(await relay.handle("list", a, 1)).toEqual([{ name: "keep.neochar", size: 4 }]);
    expect(readBackupFolder(path.join(base, "records"), folderKey("a"))).toBe(stable);
    expect(readBackupFolder(path.join(base, "records"), legacyKey)).toBe(legacy);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(path.join(stable, "unrelated.txt"), "utf8")).toBe("also keep");
    const updated = await authority.report(decision("a", "b".repeat(64)), 1, async () => true) as Record<string, unknown>;
    expect(await relay.handle("read", { ...updated, name: "keep.neochar" }, 1)).toEqual({ name: "keep.neochar", text: "keep" });
    expect(await relay.handle("forget", updated, 1)).toEqual({ ok: true });
    expect(await relay.handle("name", updated, 1)).toBeNull();
    const original = await authority.report(decision("a"), 1, async () => true);
    expect(await relay.handle("name", original, 1)).toBeNull();
    expect(fs.readFileSync(path.join(stable, "keep.neochar"), "utf8")).toBe("keep");
  });

  it.each([false, true])("adopts a known old subfolder when choosing again, prepared=%s", async (prepared) => {
    const { authority, relay, a } = await fixture();
    const legacy = path.join(base, authority.lookup(a, 1)!.key);
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, "keep.neochar"), "keep");
    if (prepared) {
      const plan = await relay.handle("prepareChoose", a, 1) as { ticket: string };
      expect(fs.existsSync(legacy)).toBe(true);
      expect(await relay.handle("commit", { ...a, ticket: plan.ticket }, 1)).toMatchObject({ ok: true });
    } else {
      expect(await relay.handle("choose", a, 1)).toBe(path.basename(base));
    }
    expect(await relay.handle("list", a, 1)).toEqual([{ name: "keep.neochar", size: 4 }]);
    expect(fs.readFileSync(path.join(base, folderKey("a"), "keep.neochar"), "utf8")).toBe("keep");
  });

  it("keeps reading the legacy folder if a safe rename fails, including after an update", async () => {
    const { authority, relay, a } = await fixture();
    const legacyKey = authority.lookup(a, 1)!.key;
    const legacy = path.join(base, legacyKey);
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, "keep.neochar"), "keep");
    writeBackupFolder(path.join(base, "records"), legacy, legacyKey);
    const rename = vi.spyOn(fs, "renameSync").mockImplementation(() => { throw new Error("busy"); });
    try {
      expect(await relay.handle("list", a, 1)).toEqual([{ name: "keep.neochar", size: 4 }]);
      expect(readBackupFolder(path.join(base, "records"), folderKey("a"))).toBe(legacy);
      const updated = await authority.report(decision("a", "b".repeat(64)), 1, async () => true) as Record<string, unknown>;
      expect(await relay.handle("read", { ...updated, name: "keep.neochar" }, 1)).toEqual({ name: "keep.neochar", text: "keep" });
      expect(fs.readFileSync(path.join(legacy, "keep.neochar"), "utf8")).toBe("keep");
    } finally { rename.mockRestore(); }
  });

  it("preserves both folders when the stable destination already exists", async () => {
    const { authority, relay, a } = await fixture();
    const legacyKey = authority.lookup(a, 1)!.key;
    const legacy = path.join(base, legacyKey);
    const stable = path.join(base, folderKey("a"));
    fs.mkdirSync(legacy);
    fs.mkdirSync(stable);
    fs.writeFileSync(path.join(legacy, "keep.neochar"), "old");
    fs.writeFileSync(path.join(stable, "keep.neochar"), "new");
    writeBackupFolder(path.join(base, "records"), legacy, legacyKey);
    expect(await relay.handle("read", { ...a, name: "keep.neochar" }, 1)).toEqual({ name: "keep.neochar", text: "new" });
    expect(fs.readFileSync(path.join(legacy, "keep.neochar"), "utf8")).toBe("old");
    expect(fs.readFileSync(path.join(stable, "keep.neochar"), "utf8")).toBe("new");
  });

  it("leaves an unknown digest record and its files untouched", async () => {
    const { relay, a } = await fixture();
    const legacyKey = createHash("sha256").update(JSON.stringify(["a", "b".repeat(64)])).digest("hex");
    const legacy = path.join(base, legacyKey);
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, "keep.neochar"), "keep");
    writeBackupFolder(path.join(base, "records"), legacy, legacyKey);
    expect(await relay.handle("name", a, 1)).toBeNull();
    await relay.handle("choose", a, 1);
    expect(await relay.handle("list", a, 1)).toEqual([]);
    expect(fs.readFileSync(path.join(legacy, "keep.neochar"), "utf8")).toBe("keep");
    expect(readBackupFolder(path.join(base, "records"), legacyKey)).toBe(legacy);
  });

  it("refuses a linked legacy folder and leaves its target untouched", async () => {
    const { authority, relay, a } = await fixture();
    const legacyKey = authority.lookup(a, 1)!.key;
    const legacy = path.join(base, legacyKey);
    const target = path.join(base, "outside");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "keep.neochar"), "keep");
    fs.symlinkSync(target, legacy, "junction");
    writeBackupFolder(path.join(base, "records"), legacy, legacyKey);
    expect(await relay.handle("read", { ...a, name: "keep.neochar" }, 1)).toEqual({ ok: false });
    expect(await relay.handle("write", { ...a, name: "new.neochar", text: "bad" }, 1)).toEqual({ ok: false });
    expect(fs.lstatSync(legacy).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(target)).toEqual(["keep.neochar"]);
    expect(fs.existsSync(path.join(base, folderKey("a")))).toBe(false);
  });

  it("reads the known legacy folder without following a linked stable destination", async () => {
    const { authority, relay, a } = await fixture();
    const legacyKey = authority.lookup(a, 1)!.key;
    const legacy = path.join(base, legacyKey);
    const target = path.join(base, "outside");
    fs.mkdirSync(legacy);
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(legacy, "keep.neochar"), "keep");
    fs.writeFileSync(path.join(target, "outside.neochar"), "private");
    fs.symlinkSync(target, path.join(base, folderKey("a")), "junction");
    writeBackupFolder(path.join(base, "records"), legacy, legacyKey);
    expect(await relay.handle("list", a, 1)).toEqual([{ name: "keep.neochar", size: 4 }]);
    expect(await relay.handle("read", { ...a, name: "outside.neochar" }, 1)).toEqual({ ok: false });
    expect(fs.readFileSync(path.join(target, "outside.neochar"), "utf8")).toBe("private");
    expect(fs.readFileSync(path.join(legacy, "keep.neochar"), "utf8")).toBe("keep");
  });

  it("keeps hard-link refusal and replacement confirmation after migration", async () => {
    const { authority, relay, a } = await fixture();
    const legacyKey = authority.lookup(a, 1)!.key;
    const legacy = path.join(base, legacyKey);
    const sentinel = path.join(base, "sentinel.txt");
    fs.mkdirSync(legacy);
    fs.writeFileSync(sentinel, "private");
    fs.linkSync(sentinel, path.join(legacy, "linked.neochar"));
    fs.writeFileSync(path.join(legacy, "keep.neochar"), "keep");
    writeBackupFolder(path.join(base, "records"), legacy, legacyKey);
    expect(readModBackupFolder(path.join(base, "records"), "a", "a".repeat(64))).toBe(path.join(base, folderKey("a")));
    expect(await relay.handle("read", { ...a, name: "linked.neochar" }, 1)).toEqual({ ok: false });
    expect(await relay.handle("write", { ...a, name: "linked.neochar", text: "bad" }, 1)).toEqual({ ok: false });
    const confirmReplace = vi.fn(async () => false);
    const guarded = createBackupRelay({ authority, userBase: path.join(base, "records"), choose: async () => base,
      confirmReplace, confirmRead: async () => true });
    expect(await guarded.handle("write", { ...a, name: "keep.neochar", text: "bad" }, 1)).toEqual({ ok: false });
    expect(confirmReplace).toHaveBeenCalledOnce();
    expect(fs.readFileSync(sentinel, "utf8")).toBe("private");
    expect(fs.readFileSync(path.join(base, folderKey("a"), "keep.neochar"), "utf8")).toBe("keep");
  });

  async function fixture() {
    const authority = createDesktopAuthority();
    const a = await authority.report(decision("a"), 1, async () => true) as Record<string, unknown>;
    const b = await authority.report(decision("b"), 1, async () => true) as Record<string, unknown>;
    const relay = createBackupRelay({ authority, userBase: path.join(base, "records"), choose: async () => base,
      confirmReplace: async () => true, confirmRead: async () => true });
    return { authority, relay, a: { installation: a["installation"] }, b: { installation: b["installation"] } };
  }

  it("preserves the renderer backup path through native consent, metadata listing, and confirmed reads", async () => {
    const digest = vi.spyOn(snapshots, "modPayloadDigest").mockReturnValue("a".repeat(64));
    const { authority, relay } = await fixture();
    const scope = { neoDesktop: {
      consent: (arg: unknown) => authority.report(arg, 1, async () => true),
      backup: (op: unknown, arg: unknown) => relay.handle(op, arg, 1),
    } };
    try {
      bindings.setConsentBindings(new Map([["a", "binding"]]));
      store.setModStorage(null);
      store.setSessionConsents({ a: ["backup:folder"] });
      const folder = createBackupFolder("a", scope);
      expect(await folder.choose()).toBe(path.basename(base));
      expect(await folder.write("own.neochar", "not a character file")).toBe(true);
      expect(await folder.list()).toEqual([{ name: "own.neochar", characterName: "", level: 0 }]);
      store.setSessionConsents({});
      bindings.invalidateModConsent("a");
      expect(await folder.write("blocked.neochar", "bad")).toBe(false);
    } finally {
      bindings.setConsentBindings(new Map());
      store.setSessionConsents({});
      digest.mockRestore();
    }
  });

  it("lists names and sizes from one allocation and refuses identity, purpose, and path spoofing", async () => {
    const { authority, relay, a, b } = await fixture();
    await relay.handle("choose", a, 1);
    await relay.handle("choose", b, 1);
    expect(await relay.handle("write", { ...b, name: "victim.neochar", text: "private" }, 1)).toEqual({ ok: true });
    expect(await relay.handle("list", a, 1)).toEqual([]);
    expect(await relay.handle("list", b, 1)).toEqual([{ name: "victim.neochar", size: 7 }]);
    const key = folderKey(authority.lookup(b, 1)!.modId);
    for (const arg of [
      { ...a, modId: "b", name: "victim.neochar", text: "bad" },
      { ...a, purpose: key, name: "victim.neochar", text: "bad" },
      { ...a, name: `../${key}/victim.neochar`, text: "bad" },
      { modId: "b", digest: "a".repeat(64), name: "victim.neochar", text: "bad" },
    ]) {
      expect(await relay.handle("write", arg, 1)).toEqual({ ok: false });
      expect(await relay.handle("list", arg, 1)).not.toEqual([{ name: "victim.neochar", size: 7 }]);
    }
    expect(await relay.handle("write", { ...a, name: "own.neochar", text: "own" }, 1)).toEqual({ ok: true });
    expect(await relay.handle("list", a, 1)).toEqual([{ name: "own.neochar", size: 3 }]);
    expect(await relay.handle("read", { ...a, name: "victim.neochar" }, 1)).toEqual({ ok: false });
    expect(fs.readFileSync(path.join(base, key, "victim.neochar"), "utf8")).toBe("private");
    expect(await relay.handle("list", b, 2)).toEqual({ ok: false });
  });

  it("fails closed without backup consent and preserves files across approved payload versions", async () => {
    const { authority, relay, a } = await fixture();
    const noBackup = await authority.report({ ...decision("network"), grants: ["network:*"] }, 1, async () => true);
    expect(await relay.handle("choose", noBackup, 1)).toEqual({ ok: false });
    await relay.handle("choose", a, 1);
    expect(await relay.handle("write", { ...a, name: "big.neochar", text: "x".repeat(BACKUP_LIMITS.fileBytes + 1) }, 1)).toEqual({ ok: false });
    expect(await relay.handle("write", { ...a, ext: ".exe", name: "bad.exe", text: "bad" }, 1)).toEqual({ ok: false });
    expect(await relay.handle("list", a, 1)).toEqual([]);
    await relay.handle("write", { ...a, name: "old.neochar", text: "old" }, 1);
    const updated = await authority.report(decision("a", "b".repeat(64)), 1, async () => true);
    await relay.handle("choose", updated, 1);
    expect(await relay.handle("list", updated, 1)).toEqual([{ name: "old.neochar", size: 3 }]);
    expect(await relay.handle("list", a, 1)).toEqual({ ok: false });
    authority.revokeWindow(1);
    expect(await relay.handle("list", a, 1)).toEqual({ ok: false });
  });

  it("checks revocation after replacement and read confirmations and never releases text from list", async () => {
    const { authority, relay, a } = await fixture();
    await relay.handle("choose", a, 1);
    await relay.handle("write", { ...a, name: "keep.neochar", text: "keep" }, 1);
    const key = folderKey(authority.lookup(a, 1)!.modId);
    const guarded = createBackupRelay({ authority, userBase: path.join(base, "records"), choose: async () => base,
      confirmReplace: async () => { await authority.report({ ...decision("a"), revoke: true }, 1, async () => true); return true; },
      confirmRead: async () => false });
    expect(await guarded.handle("read", { ...a, name: "keep.neochar" }, 1)).toEqual({ ok: false });
    expect(await guarded.handle("list", a, 1)).toEqual([{ name: "keep.neochar", size: 4 }]);
    expect(await guarded.handle("write", { ...a, name: "keep.neochar", text: "bad" }, 1)).toEqual({ ok: false });
    expect(fs.readFileSync(path.join(base, key, "keep.neochar"), "utf8")).toBe("keep");
  });

  it("rejects overlapping writes and cancels a pending file read on revocation", async () => {
    const { authority, relay, a } = await fixture();
    const key = folderKey(authority.lookup(a, 1)!.modId);
    await relay.handle("choose", a, 1);
    await relay.handle("write", { ...a, name: "keep.neochar", text: "keep" }, 1);
    let finish: (allowed: boolean) => void = () => {};
    const guarded = createBackupRelay({ authority, userBase: path.join(base, "records"), choose: async () => base,
      confirmReplace: async () => true, confirmRead: () => new Promise((resolve) => { finish = resolve; }) });
    const reading = guarded.handle("read", { ...a, name: "keep.neochar" }, 1);
    expect(await guarded.handle("write", { ...a, name: "extra.neochar", text: "bad" }, 1)).toEqual({ ok: false });
    await authority.report({ ...decision("a"), revoke: true }, 1, async () => true);
    finish(true);
    expect(await reading).toEqual({ ok: false });
    expect(fs.existsSync(path.join(base, key, "extra.neochar"))).toBe(false);
  });

  it("keeps a folder plan inert until a single host commit and rejects foreign or widened authority", async () => {
    const { authority, relay, a, b } = await fixture();
    const key = folderKey(authority.lookup(a, 1)!.modId);
    const plan = await relay.handle("prepareChoose", a, 1) as { ticket: string };
    expect(fs.existsSync(path.join(base, key))).toBe(false);
    expect(readBackupFolder(path.join(base, "records"), key)).toBeNull();
    for (const identity of [b, { ...a, modId: "b" }, { ...a, grants: ["backup:folder", "network:*"] }]) {
      expect(await relay.handle("commit", { ...identity, ticket: plan.ticket }, 1)).toEqual({ ok: false });
    }
    expect(await relay.handle("commit", { ...a, ticket: plan.ticket }, 2)).toEqual({ ok: false });
    expect(await relay.handle("commit", { ...a, ticket: plan.ticket }, 1)).toEqual({ ok: true, name: path.basename(base) });
    expect(await relay.handle("commit", { ...a, ticket: plan.ticket }, 1)).toEqual({ ok: false });
  });

  it("binds prepared writes to the confirmed bytes, folder, and current native authorization", async () => {
    const { authority, relay, a } = await fixture();
    await relay.handle("choose", a, 1);
    const confirmWrite = vi.fn(async (_entry: unknown, _name: string, _folder: string, _owner: number) => true);
    const guarded = createBackupRelay({ authority, userBase: path.join(base, "records"), choose: async () => base,
      confirmReplace: async () => true, confirmRead: async () => false, confirmWrite });
    const key = folderKey(authority.lookup(a, 1)!.modId);
    const plan = await guarded.handle("prepareWrite", { ...a, name: "own.neochar", text: "confirmed" }, 1) as { ticket: string };
    expect(confirmWrite).toHaveBeenCalledWith(expect.objectContaining({ modId: "a" }), "own.neochar", path.join(base, key), 1);
    expect(fs.existsSync(path.join(base, key, "own.neochar"))).toBe(false);
    expect(await guarded.handle("commit", { ...a, ticket: plan.ticket, name: "spoof.neochar", text: "bad" }, 1)).toEqual({ ok: false });
    expect(await guarded.handle("commit", { ...a, ticket: plan.ticket }, 1)).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(base, key, "own.neochar"), "utf8")).toBe("confirmed");
    const old = await guarded.handle("prepareWrite", { ...a, name: "own.neochar", text: "bad" }, 1) as { ticket: string };
    await authority.report({ ...decision("a"), revoke: true }, 1, async () => true);
    const renewed = await authority.report(decision("a"), 1, async () => true) as Record<string, unknown>;
    expect(await guarded.handle("commit", { ...renewed, ticket: old.ticket }, 1)).toEqual({ ok: false });
    expect(fs.readFileSync(path.join(base, key, "own.neochar"), "utf8")).toBe("confirmed");
  });

  it("refuses oversized, malformed, and path-bearing native plans before confirmation", async () => {
    const { authority, relay, a } = await fixture(); await relay.handle("choose", a, 1);
    const confirmWrite = vi.fn(async () => true);
    const guarded = createBackupRelay({ authority, userBase: path.join(base, "records"), choose: async () => base,
      confirmReplace: async () => true, confirmRead: async () => false, confirmWrite });
    for (const extra of [{ name: "../out.neochar", text: "bad" }, { name: "x.neochar", text: "x".repeat(BACKUP_LIMITS.fileBytes + 1) },
      { name: "x.neochar", text: "bad", folder: base }, { name: "x.neochar", text: "bad", purpose: "victim" }, { name: "x.neochar", text: {} }]) {
      expect(await guarded.handle("prepareWrite", { ...a, ...extra }, 1)).toEqual({ ok: false });
    }
    expect(confirmWrite).not.toHaveBeenCalled(); expect(await guarded.handle("list", a, 1)).toEqual([]);
  });

  it("expires native plans and refuses excess confirmation requests without a folder mutation", async () => {
    const { relay, a, authority } = await fixture();
    const key = folderKey(authority.lookup(a, 1)!.modId);
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const plan = await relay.handle("prepareChoose", a, 1) as { ticket: string };
      now.mockReturnValue(31_001);
      expect(await relay.handle("commit", { ...a, ticket: plan.ticket }, 1)).toEqual({ ok: false });
      for (let i = 0; i < 30; i += 1) expect(await relay.handle("prepareChoose", a, 1)).toMatchObject({ ok: true });
      expect(await relay.handle("prepareChoose", a, 1)).toEqual({ ok: false });
      expect(fs.existsSync(path.join(base, key))).toBe(false);
    } finally { now.mockRestore(); }
  });
});


describe("new backup directory identity", () => {
  it.each([false, true])("refuses a directory replaced immediately before open, junction=%s", async (junction) => {
    const folder = path.join(base, "chosen");
    const held = path.join(base, "held");
    const outside = path.join(base, "outside");
    fs.mkdirSync(folder);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "keep.neochar"), "original");
    const full = path.join(folder, "new.neochar");
    openRace.beforeOpen = (file) => {
      if (file !== full) return;
      openRace.beforeOpen = undefined;
      fs.renameSync(folder, held);
      if (junction) fs.symlinkSync(outside, folder, "junction");
      else fs.mkdirSync(folder);
    };
    expect(await writeBackupFile(folder, "new.neochar", "private backup bytes", ".neochar", async () => true)).toBe(false);
    expect(fs.readFileSync(path.join(outside, "keep.neochar"), "utf8")).toBe("original");
    expect(fs.readFileSync(full, "utf8")).toBe("");
    expect(fs.readdirSync(held)).toEqual([]);
  });
});
