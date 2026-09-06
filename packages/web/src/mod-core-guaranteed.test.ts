/**
 * The named subset of `ctx.core` that the mod compatibility promise covers.
 *
 * THE SIBLING OF mod-core-surface.test.ts, and it exists for a different reason.
 * That file is a ratchet over the whole live namespace: a removal or addition
 * fails CI, the baseline is updated, and a known break is recorded. It does not
 * forbid a removal. This file does, for a named subset.
 *
 * WHY A SUBSET AND NOT THE WHOLE NAMESPACE. `ctx.core` is the live core module
 * namespace - every runtime export, around two thousand names - handed over
 * whole because a curated slice is the thing that drifts. A promise over that
 * entire set would freeze the port. First-party plugins call 23 of those names
 * at runtime (qol 7, bug-fixes 6, borg 7, feature-restoration 3,
 * upstream-catchup 1, linoleum 0, forge 0). Those 23 are the compatibility
 * surface of `ctx.core`. Everything else remains the escape hatch.
 *
 * WHAT FAILING HERE MEANS. A guaranteed name missing from the live namespace,
 * or whose `typeof` has changed, is a compatibility break. The fix is to keep
 * the old name as an alias, or to take the two-release `modApi` path. Updating
 * `packages/core/mod-api-surface.json` is not enough.
 *
 * IMPORTED THE WAY A PLUGIN GETS IT, same as the surface ratchet: `mod-context.ts`
 * builds `ctx.core` from exactly this import.
 */

import { describe, expect, it } from "vitest";
import * as core from "@rpgm-tools/neo-angband-core";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const GUARANTEED = resolve(here, "../../core/mod-core-guaranteed.json");
const SURFACE = resolve(here, "../../core/mod-api-surface.json");

/** First-party plugins call this many runtime names on `ctx.core`. */
const FIRST_PARTY_RUNTIME_COUNT = 23;

interface GuaranteedExport {
  name: string;
  kind: "function" | "object" | "number" | "string" | "boolean";
}

function guaranteed(): GuaranteedExport[] {
  return JSON.parse(readFileSync(GUARANTEED, "utf8")).exports as GuaranteedExport[];
}

function surfaceBaseline(): string[] {
  return JSON.parse(readFileSync(SURFACE, "utf8")).exports as string[];
}

describe("the guaranteed ctx.core subset remains", () => {
  it("still exports every name the compatibility promise covers", () => {
    const now = new Set(Object.keys(core));
    const gone = guaranteed()
      .map((entry) => entry.name)
      .filter((name) => !now.has(name));
    expect(
      gone,
      "guaranteed ctx.core export missing; keep the old name as an alias or take the two-release modApi path. See docs/modding/MOD_COMPATIBILITY.md",
    ).toEqual([]);
  });

  it("still has the recorded typeof for each guaranteed name", () => {
    const wrong: string[] = [];
    for (const entry of guaranteed()) {
      const actual = typeof (core as Record<string, unknown>)[entry.name];
      if (actual !== entry.kind) {
        wrong.push(`${entry.name}: ${actual} (expected ${entry.kind})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("only names exports the surface ratchet already records", () => {
    const recorded = new Set(surfaceBaseline());
    const unknown = guaranteed()
      .map((entry) => entry.name)
      .filter((name) => !recorded.has(name));
    expect(unknown).toEqual([]);
  });

  it("covers the first-party runtime set, and does not shrink by accident", () => {
    const names = guaranteed().map((entry) => entry.name);
    expect(names.length).toBeGreaterThanOrEqual(FIRST_PARTY_RUNTIME_COUNT);
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * Same stamp check as mod-core-surface.test.ts: this file reads the package
   * namespace, which is `packages/core/dist/index.js`, so it measures the last
   * build rather than the working tree.
   */
  it("is measuring the CURRENT build, not a stale dist (run `pnpm build`)", () => {
    const stamp = resolve(here, "../../core/tsconfig.tsbuildinfo");
    expect(existsSync(stamp), `no build stamp at ${stamp} - run \`pnpm build\``).toBe(true);
    const built = statSync(stamp).mtimeMs;

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
        "checking the guaranteed subset of the PREVIOUS build. Run `pnpm build` and re-run.",
    ).toBe(true);
  });
});
