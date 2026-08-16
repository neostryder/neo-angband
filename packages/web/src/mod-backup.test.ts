/**
 * Ticket #133's BackupFolder, both platforms.
 *
 * Two claims matter enough to be load-bearing tests rather than trusted by
 * inspection: the desktop path never lets the folder's real PATH leak back
 * out of `neoDesktop.backup` (only a name and {ok} booleans cross it), and
 * `notifyBackupSinks` contains a throw to the ONE mod that threw, per the
 * fault table in CLOUD_BACKUP_DESIGN.md.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backupFilename,
  backupPickingSupported,
  clearBackupSinks,
  createBackupFolder,
  notifyBackupSinks,
} from "./mod-backup";

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
