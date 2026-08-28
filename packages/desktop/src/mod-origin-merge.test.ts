import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MOD_DB_NAME,
  MOD_DB_STORES,
  MOD_DB_VERSION,
  STORE_MODS,
  STORE_MOD_META,
  modMergeLines,
  planModMerge,
  type ModRecord,
  type ModSnapshot,
} from "./mod-origin-merge";

const mod = (id: string, files: Record<string, string> = { "mod.json": "e30=" }): ModRecord => ({
  id,
  meta: { id, version: "1.0.0" },
  files,
});

const from = (port: number, ...mods: ModRecord[]): ModSnapshot => ({ port, mods });

describe("the schema copy, pinned to web/idb.ts", () => {
  /* This module's reader is an injected script in a hidden window and cannot import
   * from the web package, so the schema exists twice. Opening with the wrong version
   * is not a soft failure: too low is refused outright, too high stops the GAME's own
   * open from triggering its upgrade. So the copy is checked against the original
   * rather than kept in step by hand. */
  const idb = (): string =>
    readFileSync(join(import.meta.dirname, "..", "..", "web", "src", "idb.ts"), "utf8");

  it("agrees on the database name and version", () => {
    expect(idb()).toContain(`const DB_NAME = "${MOD_DB_NAME}"`);
    expect(idb()).toContain(`const DB_VERSION = ${String(MOD_DB_VERSION)}`);
  });

  it("agrees on every store name, and knows about all of them", () => {
    const body = idb();
    expect(body).toContain(`export const STORE_MODS = "${STORE_MODS}"`);
    expect(body).toContain(`export const STORE_MOD_META = "${STORE_MOD_META}"`);
    /* The count matters as much as the names: a store added to idb.ts and not here
     * would not be created by a write into a fresh origin, and the game's later open
     * would find the version already current and never run its upgrade. */
    const declared = [...body.matchAll(/export const STORE_[A-Z_]+ = "([a-zA-Z]+)"/gu)].map(
      (m) => m[1],
    );
    expect(new Set(MOD_DB_STORES)).toEqual(new Set(["handles", ...declared]));
  });
});

describe("planModMerge: the loss this closes", () => {
  it("carries a mod that only the abandoned origin has", () => {
    /* THE DEFECT, stated as a test: before this module existed the roster crossed and
     * the mods did not, so a port move kept every character and lost every mod with
     * nothing said. */
    const plan = planModMerge([], [from(45871, mod("linoleum"), mod("qol"))]);
    expect(plan.install.map((m) => m.id)).toEqual(["linoleum", "qol"]);
    expect(plan.skipped).toEqual([]);
  });

  it("carries the bytes, not just the metadata", () => {
    const plan = planModMerge([], [from(45871, mod("qol", { "plugin.js": "YWJj", "mod.json": "e30=" }))]);
    expect(plan.install[0]?.files).toEqual({ "plugin.js": "YWJj", "mod.json": "e30=" });
    expect(plan.install[0]?.meta).toEqual({ id: "qol", version: "1.0.0" });
  });
});

describe("planModMerge: what it refuses to do", () => {
  it("never displaces a mod already installed in the target", () => {
    /* The update machinery owns versions - catalogue, digests, the author's tags. A
     * recovery pass that rolled a mod back to whatever an abandoned origin held would
     * be an invisible downgrade performed by the conservative half of the shell. */
    const plan = planModMerge(["qol"], [from(45871, mod("qol"))]);
    expect(plan.install).toEqual([]);
    expect(plan.skipped[0]?.why).toMatch(/already installed here/u);
  });

  it("takes the newest origin's copy when two sources both have one", () => {
    const plan = planModMerge(
      [],
      [from(45872, mod("qol", { "new.js": "bmV3" })), from(45871, mod("qol", { "old.js": "b2xk" }))],
    );
    expect(plan.install).toHaveLength(1);
    expect(plan.install[0]?.files).toEqual({ "new.js": "bmV3" });
    /* And the loser is REPORTED. The player cannot otherwise tell which of two copies
     * they ended up with. */
    expect(plan.skipped[0]).toMatchObject({ id: "qol", fromPort: 45871 });
  });

  it("skips a metadata row with no files rather than importing half a mod", () => {
    /* Half a mod fails at load time, for a reason the player cannot act on, in a mod
     * they never chose to break. */
    const plan = planModMerge([], [from(45871, mod("ghost", {}))]);
    expect(plan.install).toEqual([]);
    expect(plan.skipped[0]?.why).toMatch(/files were missing/u);
  });

  it("does not carry the folder handle", () => {
    /* `handles` is origin-bound: copied elsewhere it either fails or yields a handle
     * with no permission, and this module cannot tell those apart. It is also the one
     * entry that IS trivially re-derivable - the player re-picks the folder. The test
     * is that nothing in this module's surface can express one. */
    const plan = planModMerge([], [from(45871, mod("qol"))]);
    for (const m of plan.install) {
      expect(Object.keys(m.files).every((k) => typeof k === "string")).toBe(true);
      expect(JSON.stringify(m)).not.toMatch(/FileSystemDirectoryHandle/u);
    }
  });
});

describe("modMergeLines: a silent outcome must be unwritable", () => {
  it("says nothing only when there was genuinely nothing", () => {
    expect(modMergeLines({ install: [], skipped: [] })).toEqual([]);
  });

  it("speaks for a plan that moved nothing but skipped something", () => {
    /* The exact case the old code got wrong by having no code at all. */
    const lines = modMergeLines(planModMerge(["qol"], [from(45871, mod("qol"))]));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).toMatch(/qol/u);
  });

  it("counts what arrived", () => {
    const lines = modMergeLines(planModMerge([], [from(45871, mod("a"), mod("b"))]));
    expect(lines[0]).toBe("Brought 2 installed mods over:");
    expect(lines).toContain("  a");
  });

  it("uses the singular for one mod", () => {
    const lines = modMergeLines(planModMerge([], [from(45871, mod("a"))]));
    expect(lines[0]).toBe("Brought 1 installed mod over:");
  });

  it("NAMES what failed to arrive, and does not count it as brought over", () => {
    /* A bare number tells the player they have a problem without telling them which
     * mod to re-install. */
    const plan = planModMerge([], [from(45871, mod("a"), mod("b"))]);
    const lines = modMergeLines(plan, ["b"]);
    expect(lines[0]).toBe("Brought 1 installed mod over:");
    expect(lines).toContain("  a");
    expect(lines.join("\n")).toMatch(/Could not bring 1 over - re-install it/u);
    expect(lines).toContain("  b");
  });

  it("does not claim a success when every mod failed", () => {
    const plan = planModMerge([], [from(45871, mod("a"))]);
    const lines = modMergeLines(plan, ["a"]);
    expect(lines.join("\n")).not.toMatch(/Brought/u);
    expect(lines.join("\n")).toMatch(/Could not bring 1 over/u);
  });
});
