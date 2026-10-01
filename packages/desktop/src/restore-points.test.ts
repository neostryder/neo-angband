import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KEEP,
  RESTORE_DIR,
  lastRunVersion,
  listRestorePoints,
  pruneRestorePoints,
  rememberRunVersion,
  requestedRestorePoint,
  restoreFrom,
  takeRestorePoint,
  type RestorePaths,
} from "./restore-points.js";

let base: string;
let paths: RestorePaths;

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "neo-restore-"));
  paths = {
    base,
    sessionDir: path.join(base, "chromium"),
    gameDirs: { user: path.join(base, "user"), save: path.join(base, "save") },
  };
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const update = (toVersion: string, fromVersion?: string) => ({ fromVersion, toVersion, reason: "update" as const });

describe("restore points (#330)", () => {
  it("takes nothing on a first install, which has nothing stored", () => {
    expect(takeRestorePoint(paths, update("1.20.1"))).toBeNull();
    expect(fs.existsSync(path.join(base, RESTORE_DIR))).toBe(false);
  });

  it("copies Chromium's storage folders and the game's folders, and only those", () => {
    write(path.join(base, "chromium", "Local Storage", "leveldb", "000003.log"), "ls");
    write(path.join(base, "chromium", "IndexedDB", "x.leveldb", "CURRENT"), "idb");
    write(path.join(base, "chromium", "Service Worker", "big"), "cache");
    write(path.join(base, "user", "window.json"), "{}");

    const name = takeRestorePoint(paths, update("1.20.1", "1.20.0"), Date.UTC(2026, 9, 1, 3, 15, 0))!;
    expect(name).toBe("1.20.1-20261001-031500");
    const dir = path.join(base, RESTORE_DIR, name);
    expect(read(path.join(dir, "chromium", "Local Storage", "leveldb", "000003.log"))).toBe("ls");
    expect(read(path.join(dir, "chromium", "IndexedDB", "x.leveldb", "CURRENT"))).toBe("idb");
    expect(read(path.join(dir, "game", "user", "window.json"))).toBe("{}");
    expect(fs.existsSync(path.join(dir, "chromium", "Service Worker"))).toBe(false);
    expect(listRestorePoints(base)).toEqual([
      { name, fromVersion: "1.20.0", toVersion: "1.20.1", createdAt: Date.UTC(2026, 9, 1, 3, 15, 0), reason: "update" },
    ]);
  });

  it("does not count a copy that never finished", () => {
    write(path.join(base, RESTORE_DIR, "1.20.1-20261001-031500.partial", "game", "user", "a"), "a");
    expect(listRestorePoints(base)).toEqual([]);
    expect(pruneRestorePoints(base)).toEqual(["1.20.1-20261001-031500.partial"]);
  });

  it(`keeps the newest ${String(KEEP)}`, () => {
    write(path.join(base, "user", "a"), "a");
    const names = [1, 2, 3, 4, 5].map((n) => takeRestorePoint(paths, update(`1.${String(n)}.0`), n * 1000)!);
    const removed = pruneRestorePoints(base);
    expect(removed.sort()).toEqual([names[0], names[1]].sort());
    expect(listRestorePoints(base).map((p) => p.name)).toEqual([names[4], names[3], names[2]]);
  });

  it("restores the chosen point, saving the current state first", () => {
    write(path.join(base, "user", "settings.json"), "before");
    write(path.join(base, "chromium", "Local Storage", "db"), "old storage");
    const point = takeRestorePoint(paths, update("1.20.1", "1.20.0"), 1000)!;
    write(path.join(base, "user", "settings.json"), "after");
    write(path.join(base, "user", "new-file.json"), "added later");
    write(path.join(base, "chromium", "Local Storage", "db"), "new storage");

    const { restored, safety } = restoreFrom(paths, point, "1.20.1", 2000);

    expect(restored).toBe(point);
    expect(read(path.join(base, "user", "settings.json"))).toBe("before");
    expect(fs.existsSync(path.join(base, "user", "new-file.json"))).toBe(false);
    expect(read(path.join(base, "chromium", "Local Storage", "db"))).toBe("old storage");
    const undo = path.join(base, RESTORE_DIR, safety!);
    expect(read(path.join(undo, "game", "user", "settings.json"))).toBe("after");
    expect(read(path.join(undo, "chromium", "Local Storage", "db"))).toBe("new storage");
    expect(fs.readdirSync(base).filter((n) => n.endsWith(".restoring") || n.endsWith(".replaced"))).toEqual([]);
  });

  it("leaves a folder alone when the restore point does not have it", () => {
    write(path.join(base, "user", "a"), "a");
    const point = takeRestorePoint(paths, update("1.20.1"), 1000)!;
    write(path.join(base, "save", "char"), "a save made later");
    restoreFrom(paths, point, "1.20.1", 2000);
    expect(read(path.join(base, "save", "char"))).toBe("a save made later");
  });

  it("restores `latest` from the newest update point, not the undo point a restore made", () => {
    write(path.join(base, "user", "a"), "v1");
    const first = takeRestorePoint(paths, update("1.20.1"), 1000)!;
    restoreFrom(paths, first, "1.20.1", 2000);
    expect(restoreFrom(paths, "latest", "1.20.1", 3000).restored).toBe(first);
  });

  it("never prunes the point just restored from", () => {
    write(path.join(base, "user", "a"), "a");
    const oldest = takeRestorePoint(paths, update("1.0.0"), 1000)!;
    for (const n of [2, 3, 4]) takeRestorePoint(paths, update(`1.${String(n)}.0`), n * 1000);
    restoreFrom(paths, oldest, "1.4.0", 9000);
    expect(listRestorePoints(base).map((p) => p.name)).toContain(oldest);
  });

  it("refuses a name it does not have", () => {
    expect(() => restoreFrom(paths, "nope", "1.20.1")).toThrow(/no restore point named "nope"/u);
  });

  it("remembers the version that last ran", () => {
    expect(lastRunVersion(path.join(base, "user"))).toBeUndefined();
    rememberRunVersion(path.join(base, "user"), "1.20.1");
    expect(lastRunVersion(path.join(base, "user"))).toBe("1.20.1");
  });

  it("reads the switch only in its = form", () => {
    expect(requestedRestorePoint(["--restore-point=latest"])).toBe("latest");
    expect(requestedRestorePoint(["--restore-point", "latest"])).toBeUndefined();
    expect(requestedRestorePoint([])).toBeUndefined();
  });
});
