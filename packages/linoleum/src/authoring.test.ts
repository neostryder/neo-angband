/**
 * End-to-end test for the additive authoring layer (variant pools +
 * per-object / pooled target rules). Converts the original-tiles pack twice
 * against the real reference data: once with no authoring (proving the pool
 * files stay absent, i.e. the regression bar holds) and once with an authored
 * pool built from assets the export actually produced.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { convertPacks } from "./convert.js";
import { parsePoolsFile, parseTargetsFile } from "./targets.js";

const tilesRoot = fileURLToPath(new URL("../../../reference/lib/tiles", import.meta.url));
const outputRoot = fileURLToPath(new URL("../.test-out-authoring", import.meta.url));

const packRoot = (): string => join(outputRoot, "original-tiles");
const read = (path: string): string => readFileSync(path, "utf8");

// Real assets the original-tiles export produces (FLOOR carries dark/lit/los/
// torch variants; a lit torch object exists). Used both as pool members and as
// a per-object asset override.
const FLOOR_LIT = "feat_floor_lit_0";
const FLOOR_DARK = "feat_floor_dark_0";
const FLOOR_LOS = "feat_floor_los_0";

describe("no authoring: pool files stay absent (regression bar)", () => {
  beforeAll(() => {
    rmSync(outputRoot, { recursive: true, force: true });
    convertPacks({ tilesRoot, outputRoot, packKeys: ["original-tiles"] });
  }, 60_000);

  it("writes no maps/pools.txt", () => {
    expect(existsSync(join(packRoot(), "maps", "pools.txt"))).toBe(false);
  });

  it("does not register a pools map in the manifest", () => {
    expect(read(join(packRoot(), "manifest.txt"))).not.toContain("map:pools");
  });

  it("reports zero authored pools/targets", () => {
    const summary = convertPacks({ tilesRoot, outputRoot, packKeys: ["original-tiles"] });
    const r = summary.results[0];
    expect(r?.poolCount).toBe(0);
    expect(r?.authoredTargetCount).toBe(0);
  });
});

describe("with authoring: pools + per-object rules are emitted", () => {
  beforeAll(() => {
    rmSync(outputRoot, { recursive: true, force: true });
    convertPacks({
      tilesRoot,
      outputRoot,
      packKeys: ["original-tiles"],
      authoring: {
        "original-tiles": {
          pools: [
            {
              poolId: "floor_variants",
              selection: "stable",
              members: [FLOOR_LIT, FLOOR_DARK, FLOOR_LOS],
            },
          ],
          targets: [
            // A variant pool bound to the FLOOR feature.
            { type: "feat", selector: "FLOOR", kind: "pool", value: "floor_variants" },
            // A distinct per-object image addressed by object:<tval>:<name>.
            {
              type: "object",
              selector: "light:Wooden Torch",
              kind: "asset",
              value: FLOOR_LIT,
            },
          ],
        },
      },
    });
  }, 60_000);

  it("registers the pools map in the manifest", () => {
    expect(read(join(packRoot(), "manifest.txt"))).toContain("map:pools:maps/pools.txt");
  });

  it("writes maps/pools.txt with the authored pool", () => {
    const pools = parsePoolsFile(read(join(packRoot(), "maps", "pools.txt")));
    expect(pools).toEqual([
      {
        poolId: "floor_variants",
        selection: "stable",
        members: [FLOOR_LIT, FLOOR_DARK, FLOOR_LOS],
      },
    ]);
  });

  it("appends the pool and per-object target rules", () => {
    const rules = parseTargetsFile(read(join(packRoot(), "maps", "targets.txt")));
    expect(rules).toContainEqual({
      type: "feat",
      selector: "FLOOR",
      kind: "pool",
      value: "floor_variants",
    });
    expect(rules).toContainEqual({
      type: "object",
      selector: "light:Wooden Torch",
      kind: "asset",
      value: FLOOR_LIT,
    });
  });

  it("reports the authored counts", () => {
    const summary = convertPacks({
      tilesRoot,
      outputRoot,
      packKeys: ["original-tiles"],
      authoring: {
        "original-tiles": {
          pools: [
            { poolId: "floor_variants", selection: "stable", members: [FLOOR_LIT, FLOOR_DARK] },
          ],
          targets: [{ type: "feat", selector: "FLOOR", kind: "pool", value: "floor_variants" }],
        },
      },
    });
    const r = summary.results[0];
    expect(r?.poolCount).toBe(1);
    expect(r?.authoredTargetCount).toBe(1);
  });
});

describe("authoring validation", () => {
  it("throws when a pool references an unknown asset", () => {
    expect(() =>
      convertPacks({
        tilesRoot,
        outputRoot,
        packKeys: ["original-tiles"],
        authoring: {
          "original-tiles": {
            pools: [{ poolId: "bad", selection: "stable", members: ["not_a_real_asset"] }],
          },
        },
      }),
    ).toThrow(/unknown asset/);
  });

  it("throws when a target references an unknown pool", () => {
    expect(() =>
      convertPacks({
        tilesRoot,
        outputRoot,
        packKeys: ["original-tiles"],
        authoring: {
          "original-tiles": {
            targets: [{ type: "feat", selector: "FLOOR", kind: "pool", value: "nope" }],
          },
        },
      }),
    ).toThrow(/unknown pool/);
  });
});
