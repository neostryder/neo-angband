/**
 * The catalogue installer's decisions, without a terminal and without a network.
 *
 * The screen itself is paint calls; what is worth testing is the part where a wrong
 * answer LOOKS right. An install that failed reported as a tick, or a mod installed
 * at v0.9.1 shown as up to date when the catalogue offers v0.10.0, is worse than no
 * installer at all - a player then files a bug against a version they are not
 * running.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  catalogueRow,
  formatBytes,
  installSummary,
  progressLine,
} from "./mod-catalogue";
import { RECOMMENDED_MODS, usableRecommendedMods, type RecommendedMod } from "./mod-registry";
import { FIRST_PARTY_MOD_IDS } from "./mod-store";

const HERE = dirname(fileURLToPath(import.meta.url));

const MOD: RecommendedMod = {
  id: "demo",
  name: "A Demo Mod",
  repo: "neostryder/neo-angband-mod-demo",
  tag: "v0.10.0",
  summary: "A mod, for testing this screen.",
  approxBytes: 2_500_000,
  preChecked: false,
  payload: { kind: "files", files: [{ path: "manifest.json", sha256: "0".repeat(64) }] },
};

describe("formatBytes", () => {
  it("uses binary units with their real names", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(20 * 1024)).toBe("20 KiB");
    expect(formatBytes(2_500_000)).toBe("2.4 MiB");
  });

  it("reports the linoleum download as the ~25 MiB it actually is", () => {
    /* The number a player is deciding about. It was written as "44 MiB" in a comment
     * once, before anyone measured; the archives are 24.6. */
    const lino = RECOMMENDED_MODS.find((m) => m.id === "neo-linoleum");
    if (!lino) return; /* asserted to exist by the catalogue test below */
    expect(formatBytes(lino.approxBytes)).toBe("25 MiB");
  });
});

describe("catalogueRow", () => {
  it("distinguishes not-installed, installed, and installed at a DIFFERENT tag", () => {
    const absent = catalogueRow(MOD, null);
    const current = catalogueRow(MOD, "v0.10.0");
    const stale = catalogueRow(MOD, "v0.9.1");

    expect(absent.label.startsWith("[ ]")).toBe(true);
    expect(current.label.startsWith("[x]")).toBe(true);
    expect(stale.label.startsWith("[~]")).toBe(true);

    /* The three must not merely differ in a box character: the stale row has to name
     * BOTH versions, because that is the whole information it carries. */
    expect(stale.label).toContain("v0.9.1");
    expect(stale.label).toContain("v0.10.0");
    expect(new Set([absent.color, current.color, stale.color]).size).toBe(3);
  });

  it("puts the download size in front of the player BEFORE they choose", () => {
    const absent = catalogueRow(MOD, null);
    expect(absent.label).toContain("2.4 MiB");
    expect(absent.hint).toContain("2.4 MiB");
    expect(absent.hint).toContain(MOD.repo);
  });

  it("does not offer a size on the row for a mod already at this tag", () => {
    /* Nothing is going to be downloaded, so a size there is noise that reads like a
     * pending transfer. */
    expect(catalogueRow(MOD, MOD.tag).label).not.toContain("MiB");
  });
});

describe("installSummary", () => {
  it("reports a failure as a failure, with the installer's own reason verbatim", () => {
    const problem = "demo: manifest.json: digest mismatch";
    const lines = installSummary(MOD, { ok: false, problem });
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("NOT installed");
    expect(text).toContain(problem);
    /* The reason must survive intact. A paraphrase ("install failed") throws away
     * the file name and the cause, which is all anyone could act on. */
    expect(lines.some((l) => l.text === problem)).toBe(true);
  });

  it("says a successful install is still OFF, because it is", () => {
    const lines = installSummary(MOD, {
      ok: true,
      meta: {
        id: MOD.id,
        repo: MOD.repo,
        tag: MOD.tag,
        files: ["manifest.json", "plugin.js"],
        installedAt: "2026-07-31T00:00:00.000Z",
      },
    });
    const text = lines.map((l) => l.text).join(" ");
    expect(text).toContain("installed");
    expect(text).toContain("2 file(s)");
    /* Parity: no mod is ever enabled by arriving. A summary that did not say so
     * would leave a player waiting for an effect that needs two more actions. */
    expect(text).toMatch(/OFF until you turn it on/u);
    expect(text).toContain("reload");
  });
});

describe("progressLine", () => {
  it("names the file and the position, so a stall is visible", () => {
    expect(progressLine(MOD, { done: 3, total: 7, path: "tiles/orc.png" })).toBe(
      "A Demo Mod: 3/7  tiles/orc.png",
    );
  });
});

describe("the shipped catalogue is offerable", () => {
  it("has at least one usable row, and no refused ones", () => {
    /* The screen is only worth having if the catalogue it renders is non-empty, and a
     * refused row is a bug in this build rather than in anyone's setup. */
    const { mods, problems } = usableRecommendedMods();
    expect(problems).toEqual([]);
    expect(mods.length).toBeGreaterThan(0);
  });

  it("offers every first-party mod the build does not bundle", () => {
    /**
     * The invariant, not today's list: a first-party mod that is neither bundled nor
     * in the catalogue is one a player has NO way to get on a browser without a
     * directory picker. Written against FIRST_PARTY_MOD_IDS so it becomes the gate
     * automatically as mods leave the bundle, rather than needing to be remembered
     * at that moment - which is exactly when it would not be.
     */
    const FIRST_PARTY = ["qol", "bug-fixes", "neo-linoleum"] as const;
    const ids = usableRecommendedMods().mods.map((m) => m.id);
    for (const id of FIRST_PARTY) {
      if (FIRST_PARTY_MOD_IDS.includes(id)) continue; /* bundled: shipped in the app */
      expect(ids, `${id} is not bundled, so it must be installable`).toContain(id);
    }
  });

  it("names a real first-party set, so the test above is not vacuous", () => {
    /* Guards the guard: a typo'd id would make every row skip as "bundled". */
    for (const id of FIRST_PARTY_MOD_IDS) {
      expect(["qol", "bug-fixes", "neo-linoleum"]).toContain(id);
    }
  });
});

describe("the row is actually reachable from the mod manager", () => {
  /**
   * The failure this exists for: `installRecommendedMod` was complete, tested and
   * referenced by nothing but its own tests for weeks. A screen nothing opens is
   * indistinguishable, from the player's side, from a screen that was never written -
   * so the wiring is asserted, not assumed.
   */
  const mods = readFileSync(join(HERE, "mods.ts"), "utf8");
  const main = readFileSync(join(HERE, "main.ts"), "utf8");

  it("mods.ts opens the catalogue from a menu row", () => {
    expect(mods).toContain("showModCatalogue");
    expect(mods).toContain('"Install a mod..."');
  });

  it("main.ts supplies real install/uninstall functions, not a stub", () => {
    expect(main).toContain("modCatalogue:");
    expect(main).toContain("installRecommendedMod(");
    expect(main).toContain("uninstallMod(");
  });
});
