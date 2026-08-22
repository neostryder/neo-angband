/**
 * The surface a mod's code can reach through `ctx.authoring`, pinned.
 *
 * THE SIBLING OF mod-core-surface.test.ts, and it exists for the same reason
 * that one does rather than for a new one. `ctx.authoring` is the mod SDK's
 * public barrel handed over whole, deliberately, because a curated slice is the
 * thing that drifts. What follows is that every name in it is load-bearing for
 * somebody's authoring tool: rename a function and the mod calling it throws at
 * runtime, in a player's browser, with nothing in this repository able to have
 * known.
 *
 * WHAT WAS DIFFERENT UNTIL THE SEAM LANDED. The SDK was a build-time dependency
 * of the host and of the mod builders, so a rename inside it was caught by
 * `tsc -b` over this repository. Handing the namespace to a plugin at runtime
 * removes that: a plugin ships as built JavaScript and resolves no specifier, so
 * the compiler never sees the call. The core surface has been in exactly that
 * position since 2026-08-02, and this is the same guard over the second door.
 *
 * IMPORTED THE WAY A PLUGIN GETS IT, not read off the source. `mod-context.ts`
 * builds `ctx.authoring` from exactly this import, so measuring the same object
 * is the only way the count cannot be right about a file and wrong about the
 * package.
 */

import { describe, expect, it } from "vitest";
import * as authoring from "@rpgm-tools/neo-angband-mod-sdk";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = resolve(here, "../../mod-sdk/mod-sdk-api-surface.json");

/** What a plugin actually receives, sorted. */
function surface(): string[] {
  return Object.keys(authoring).sort();
}

function baseline(): string[] {
  return JSON.parse(readFileSync(BASELINE, "utf8")).exports as string[];
}

describe("the ctx.authoring surface does not move by accident", () => {
  /* THE ONE THAT MATTERS, split from the additions check so a failure says which
   * of the two happened: an addition is a chore and a removal is somebody's mod
   * breaking. */
  it("has not dropped or renamed anything a plugin could be calling", () => {
    const now = new Set(surface());
    const gone = baseline().filter((name) => !now.has(name));
    expect(gone).toEqual([]);
  });

  it("records everything, so the removal check has something to compare against", () => {
    const was = new Set(baseline());
    const added = surface().filter((name) => !was.has(name));
    expect(added, "run `node tools/api-surface.mjs --update`").toEqual([]);
  });

  /* A path typo or an import that resolved to a stub would leave both assertions
   * above passing over an empty set. The names checked here are the ones
   * docs/modding/AUTHORING.md tells an author to call. */
  it("is measuring the real barrel, not an empty one", () => {
    expect(surface().length).toBeGreaterThan(50);
    for (const name of ["checkRecords", "composedObjects", "modProject", "peersFor"]) {
      expect(surface(), name).toContain(name);
    }
  });

  /**
   * AND IT MUST BE MEASURING THE CURRENT SOURCE. `surface()` reads the package
   * namespace, which resolves to `packages/mod-sdk/dist/index.js` - so this file
   * measures the last BUILD, not the working tree. The same reasoning, and the
   * same build stamp rather than `dist/index.js`, as mod-core-surface.test.ts:
   * `tsc -b` leaves an unchanged barrel byte-identical and back-dated, and
   * tsconfig.tsbuildinfo is rewritten by every build that does any work.
   */
  it("is measuring the CURRENT build, not a stale dist (run `pnpm build`)", () => {
    const stamp = resolve(here, "../../mod-sdk/tsconfig.tsbuildinfo");
    expect(existsSync(stamp), `no build stamp at ${stamp} - run \`pnpm build\``).toBe(true);
    const built = statSync(stamp).mtimeMs;

    const src = resolve(here, "../../mod-sdk/src");
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
      `packages/mod-sdk/src is newer than its build (${newestFile}), so this file is ` +
        "checking the API surface of the PREVIOUS build. Run `pnpm build` and re-run; " +
        "if a new export is intentional, `node tools/api-surface.mjs --update`.",
    ).toBe(true);
  });
});
