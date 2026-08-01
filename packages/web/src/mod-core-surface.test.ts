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
import { readFileSync } from "node:fs";
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
});
