/**
 * The surface a mod's code can reach through `ctx.core`, pinned.
 *
 * WHAT WAS UNGUARDED. `ModPluginContext.core` is the LIVE core module namespace -
 * the whole engine, deliberately, because a curated slice is the thing that drifts
 * and because ratified decision 18 says the engine does not fence its own API off
 * from mods. What follows from that, and had no answer at all until 2026-08-02, is
 * that every one of those names is load-bearing for somebody's plugin. Rename a
 * function and the mod using it throws at runtime, in a player's browser, with
 * nothing in this repository able to have known.
 *
 * `MOD_API_VERSION` does not cover this. It versions the SHAPE of the plugin
 * contract - the members of ModPlugin, what the host passes, when it calls them -
 * and a core export can be renamed without touching any of that. So the one
 * version number a mod author checks says nothing about the surface they spend
 * all their time calling.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT. It does not forbid a
 * removal; that would freeze the port, which is still growing. It makes one
 * DELIBERATE: a rename now fails here, with the names, and the fix is either to
 * keep the old name as an alias or to record the break in the compatibility doc
 * and take it knowingly.
 *
 * IMPORTED THE WAY A PLUGIN GETS IT, not read off the source. `mod-context.ts`
 * builds `ctx.core` from exactly this import, so measuring the same object is the
 * only way the count cannot be right about a file and wrong about the package -
 * which is the shipped-is-not-reachable failure in its other direction.
 */

import { describe, expect, it } from "vitest";
import * as core from "@rpgm-tools/neo-angband-core";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(here, "../../core/mod-api-surface.json");

/** What a plugin actually receives, sorted. */
function surface(): string[] {
  return Object.keys(core).sort();
}

function baseline(): string[] {
  return JSON.parse(readFileSync(BASELINE, "utf8")).exports as string[];
}

describe("the ctx.core surface does not move by accident", () => {
  /* THE ONE THAT MATTERS. Split from the additions check so a failure says which
   * of the two happened without anyone reading a diff: an addition is a chore and
   * a removal is somebody's mod breaking. */
  it("has not dropped or renamed anything a plugin could be calling", () => {
    const now = new Set(surface());
    const gone = baseline().filter((name) => !now.has(name));
    expect(gone).toEqual([]);
  });

  /* Failing on additions is what keeps the baseline COMPLETE, and a baseline that
   * is not complete makes the check above meaningless: an export added in one
   * release and removed in the next would never have been recorded, so nothing
   * would notice it going. One `--update` per release is the price. */
  it("records everything, so the removal check has something to compare against", () => {
    const was = new Set(baseline());
    const added = surface().filter((name) => !was.has(name));
    expect(added, "run `node tools/api-surface.mjs --update`").toEqual([]);
  });

  /* The baseline is only worth anything if it is measuring the real namespace.
   * A path typo, a moved dist, or an import that resolved to a stub would leave
   * both assertions above passing over an empty set. */
  it("is measuring a real and large namespace, not an empty one", () => {
    expect(surface().length).toBeGreaterThan(1000);
    expect(surface()).toContain("ENGINE_VERSION");
  });

  /**
   * AND IT MUST BE MEASURING THE CURRENT SOURCE. `surface()` reads the package
   * namespace, which resolves to `packages/core/dist/index.js` - so this whole
   * file measures the last BUILD, not the working tree.
   *
   * CI runs `pnpm build` before `pnpm test` (.github/workflows/ci.yml) and a
   * developer running `pnpm test` alone does not, so the two commands are not the
   * same measurement. That difference shipped a red CI on 2026-08-04: a new core
   * export passed every local run against a dist built before it existed, and
   * failed the moment CI built first. A guard whose subject is a build artifact is
   * only as current as the artifact, and it cannot say so unless it checks.
   */
  it("is measuring the CURRENT build, not a stale dist (run `pnpm build`)", () => {
    /*
     * The build STAMP, not dist/index.js. `tsc -b` is incremental and does not
     * rewrite an output whose emitted text is unchanged - and index.js is a
     * `export *` barrel, so adding an export to a module leaves it byte-identical
     * and back-dated. The first draft of this check compared against it and
     * reported a fresh build as stale. tsconfig.tsbuildinfo is rewritten by every
     * `tsc -b` that does any work, which is the thing being asked about.
     */
    const stamp = resolve(here, "../../core/tsconfig.tsbuildinfo");
    expect(existsSync(stamp), `no build stamp at ${stamp} - run \`pnpm build\``).toBe(true);
    const built = statSync(stamp).mtimeMs;

    /* The newest mtime under packages/core/src. Cheap, and precise enough: any
     * source edit after the build makes every assertion above a statement about
     * the past. */
    const src = resolve(here, "../../core/src");
    let newest = 0;
    let newestFile = "";
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) {
          walk(p);
        } else if (e.name.endsWith(".ts") && !e.name.includes(".test.")) {
          const m = statSync(p).mtimeMs;
          if (m > newest) {
            newest = m;
            newestFile = p;
          }
        }
      }
    };
    walk(src);

    expect(
      newest <= built,
      `packages/core/src is newer than its build (${newestFile}), so this file is ` +
        "checking the API surface of the PREVIOUS build. Run `pnpm build` and re-run; " +
        "if a new export is intentional, `node tools/api-surface.mjs --update`.",
    ).toBe(true);
  });
});
