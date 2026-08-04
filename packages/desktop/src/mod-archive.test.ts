/**
 * Moving an imported archive aside, against a real filesystem.
 *
 * The behaviours here are the ones that cost a player something when they are wrong:
 * the file must still exist afterwards (it used to be deleted), an earlier archive
 * must not be overwritten by a later import of the same name, and a name the process
 * does not own must be refused rather than repaired into one it does.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { IMPORTED_DIRNAME, archiveModZip, freeArchiveName, isModZipName } from "./mod-archive.js";

let mods: string;
const imported = (): string => path.join(mods, IMPORTED_DIRNAME);

beforeEach(() => {
  mods = fs.mkdtempSync(path.join(os.tmpdir(), "neo-mods-"));
});

afterEach(() => {
  fs.rmSync(mods, { recursive: true, force: true });
});

function drop(name: string, body = "zip bytes"): string {
  const p = path.join(mods, name);
  fs.writeFileSync(p, body, "utf8");
  return p;
}

describe("the archive survives the import", () => {
  it("moves the zip into imported/ and says where it went", () => {
    drop("qol.zip");
    const r = archiveModZip(mods, "qol.zip");
    expect(r).toEqual({ ok: true, to: "imported/qol.zip" });
    /* BOTH halves, because the bug this replaces was a delete: gone from the top
     * level, and PRESENT with its bytes intact underneath. */
    expect(fs.existsSync(path.join(mods, "qol.zip"))).toBe(false);
    expect(fs.readFileSync(path.join(imported(), "qol.zip"), "utf8")).toBe("zip bytes");
  });

  it("creates imported/ on the first archive rather than needing it to exist", () => {
    drop("qol.zip");
    expect(fs.existsSync(imported())).toBe(false);
    expect(archiveModZip(mods, "qol.zip").ok).toBe(true);
    expect(fs.statSync(imported()).isDirectory()).toBe(true);
  });

  it("never overwrites an archive already put aside", () => {
    /* v1 is archived; v2 arrives under the same filename. Overwriting here would
     * destroy the older download, which is the thing this feature exists to keep. */
    drop("mod.zip", "version one");
    expect(archiveModZip(mods, "mod.zip")).toEqual({ ok: true, to: "imported/mod.zip" });
    drop("mod.zip", "version two");
    expect(archiveModZip(mods, "mod.zip")).toEqual({ ok: true, to: "imported/mod-1.zip" });
    expect(fs.readFileSync(path.join(imported(), "mod.zip"), "utf8")).toBe("version one");
    expect(fs.readFileSync(path.join(imported(), "mod-1.zip"), "utf8")).toBe("version two");
  });

  it("numbers before the extension, so the file is still a .zip", () => {
    fs.mkdirSync(imported(), { recursive: true });
    fs.writeFileSync(path.join(imported(), "a.zip"), "x");
    expect(freeArchiveName(imported(), "a.zip")).toBe("a-1.zip");
    /* A name with dots in the stem keeps them; only the LAST dot is the extension. */
    fs.writeFileSync(path.join(imported(), "neo-qol.v1.2.zip"), "x");
    expect(freeArchiveName(imported(), "neo-qol.v1.2.zip")).toBe("neo-qol.v1.2-1.zip");
  });

  it("gives up rather than looping when a hundred names are taken", () => {
    fs.mkdirSync(imported(), { recursive: true });
    fs.writeFileSync(path.join(imported(), "a.zip"), "x");
    for (let n = 1; n < 100; n++) fs.writeFileSync(path.join(imported(), `a-${String(n)}.zip`), "x");
    expect(freeArchiveName(imported(), "a.zip")).toBeNull();
    drop("a.zip");
    const r = archiveModZip(mods, "a.zip");
    expect(r.ok).toBe(false);
    /* And the archive is still where it was, which is the only outcome that does not
     * lose the file. */
    expect(fs.existsSync(path.join(mods, "a.zip"))).toBe(true);
  });
});

describe("a name this process does not own is refused, not repaired", () => {
  it("refuses traversal, separators, dotfiles and the wrong extension", () => {
    for (const bad of [
      "../../secret.zip",
      "sub/dir.zip",
      "sub\\dir.zip",
      ".hidden.zip",
      "notazip.txt",
      "",
      "a\0.zip",
      "x".repeat(256) + ".zip",
      42,
      null,
      undefined,
    ]) {
      expect(isModZipName(bad), JSON.stringify(bad)).toBe(false);
      const r = archiveModZip(mods, bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("proves the refusal by leaving a file outside the folder alone", () => {
    /* The failure mode a basename() "fix" would introduce: repairing `../x.zip` into
     * `x.zip` and moving something the renderer had no business naming. */
    const outside = path.join(mods, "..", `escape-${path.basename(mods)}.zip`);
    fs.writeFileSync(outside, "not yours");
    try {
      expect(archiveModZip(mods, `../${path.basename(outside)}`).ok).toBe(false);
      expect(fs.readFileSync(outside, "utf8")).toBe("not yours");
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("refuses a directory that happens to be named like an archive", () => {
    fs.mkdirSync(path.join(mods, "packish.zip"));
    const r = archiveModZip(mods, "packish.zip");
    expect(r).toEqual({ ok: false, error: "that is not a file in the mods folder" });
  });

  it("answers a reason for an archive that is not there, instead of throwing", () => {
    const r = archiveModZip(mods, "gone.zip");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).not.toBe("");
  });
});
