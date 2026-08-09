/**
 * The moddability gap list needs a DENOMINATOR nobody maintains by hand.
 *
 * MOD_REACH.md's inventory of dispatch switches was written by reading the
 * code, and a hand-written inventory only ever gets smaller: converting one to
 * a registry gets its row updated, ADDING one gets no row at all, and the list
 * quietly stops being a census while still reading like one. Several rows in
 * that document have already gone stale exactly that way.
 *
 * So `tools/switch-census.json` records every switch of >= 8 cases with a
 * hand-written verdict, and this test fails when the tree and the manifest
 * disagree. A new switch, or one that grew or shrank, breaks the list compare;
 * regenerating stamps it UNADJUDICATED, which breaks the backlog ratchet; the
 * only way to green is to write a verdict.
 *
 * The backlog is 36 of 51 and that is the honest number, not a target. 15 rows
 * carry a verdict because MOD_REACH already covers them; the rest have never
 * been looked at, and a test that asserted zero would be a red build nobody
 * could clear rather than a ratchet anybody could turn.
 *
 * Lives in packages/web because that is where the other repo-wide ratchets run
 * (mod-core-surface.test.ts); it reads the source tree, not this package.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const manifestPath = fileURLToPath(new URL("tools/switch-census.json", root));

interface Row {
  file: string;
  cases: number;
  hasDefault: boolean;
  verdict: string;
}
interface Manifest {
  threshold: number;
  unadjudicated: number;
  switches: Row[];
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;

/** Re-run the census over the CURRENT tree. */
function live(): { file: string; cases: number }[] {
  const out = execFileSync(
    process.execPath,
    [fileURLToPath(new URL("tools/switch-census.mjs", root))],
    { encoding: "utf8" },
  );
  return out
    .split("\n")
    .slice(1)
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const [cases, file] = l.trim().split(/\s+/);
      return { file: file as string, cases: Number(cases) };
    });
}

describe("the switch census", () => {
  it("matches the tree (run `node tools/switch-census.mjs --update`)", () => {
    const now = live().map((r) => `${r.file} ${String(r.cases)}`);
    const was = manifest.switches.map((r) => `${r.file} ${String(r.cases)}`);
    /* Both directions in one compare: a switch added, removed, grown or shrunk
     * all surface here. */
    expect(now).toEqual(was);
  });

  it("never has MORE unadjudicated rows than the recorded backlog", () => {
    /* A RATCHET, NOT A WALL, and the difference is deliberate. 36 of the 51
     * rows have no verdict yet - that is the honest state of the codebase, and
     * a test asserting zero would just be a red build nobody could go green.
     * What must not happen is the number going UP.
     *
     * A new switch cannot sneak past this by being unadjudicated, because the
     * test above already fails on the file/case list: the author has to run
     * --update, which stamps the new row UNADJUDICATED, which trips this. The
     * only way through is to write a verdict. */
    const unadjudicated = manifest.switches.filter(
      (r) => r.verdict === "UNADJUDICATED",
    ).length;
    expect(unadjudicated).toBe(manifest.unadjudicated);
    expect(unadjudicated).toBeLessThanOrEqual(36);
  });

  it("has adjudicated the rows MOD_REACH already covers", () => {
    /* Control for the backlog: "36 remaining" is only meaningful if the other
     * 15 carry a real verdict rather than a placeholder. */
    const adjudicated = manifest.switches.filter(
      (r) => r.verdict !== "UNADJUDICATED",
    );
    expect(adjudicated).toHaveLength(15);
    expect(adjudicated.every((r) => r.verdict.length > 20)).toBe(true);
    /* The biggest switch in the tree is one of them. */
    expect(manifest.switches[0]?.verdict).toContain("gap 14");
  });

  it("is measuring something: 51 switches, 794 case labels", () => {
    /* Control for the census ITSELF. A scanner that silently matched nothing -
     * a broken regex, a wrong root - would make both tests above pass forever
     * against an empty tree. */
    expect(manifest.threshold).toBe(8);
    expect(manifest.switches.length).toBeGreaterThanOrEqual(40);
    expect(
      manifest.switches.reduce((sum, r) => sum + r.cases, 0),
    ).toBeGreaterThanOrEqual(700);
    /* And it finds the biggest one we know about by name. */
    expect(manifest.switches[0]?.file).toBe("packages/core/src/obj/randart-build.ts");
  });

  it("no longer lists the two switches that became registries", () => {
    /* project-feat.ts and project-obj.ts are the two converted so far. Their
     * absence is the census agreeing with MOD_REACH rows 11 and 12 - and it is
     * derived rather than declared, which is the whole point of this file. */
    const files = new Set(manifest.switches.map((r) => r.file));
    expect(files.has("packages/core/src/game/project-feat.ts")).toBe(false);
    expect(files.has("packages/core/src/game/project-obj.ts")).toBe(false);
  });
});
