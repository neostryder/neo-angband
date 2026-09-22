/**
 * The cloud-backup name rule and the persisted-folder record, against a real
 * filesystem - same instrument mod-archive.test.ts already uses for the sibling
 * channel this one is modeled on.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  backupFolderDisplayName,
  isBackupFileName,
  listBackupFiles,
  readBackupFolder,
  writeBackupFolder,
} from "./backup-folder.js";

let base: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "neo-backup-"));
});

afterEach(() => {
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
