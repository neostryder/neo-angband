/**
 * The manifest's restored-art declarations: restoredItemArt, restoredMonsterArt
 * and restoredFlavorArt. A bad entry fails the manifest, so the shell never goes
 * looking for a file a mod never meant to name.
 */

import { describe, expect, it } from "vitest";
import { validateManifest } from "./manifest.js";

const bare = { id: "restorer", name: "Restorer", version: "1.0.0", shape: "content" };

function check(fields: Record<string, unknown>) {
  return () => validateManifest({ ...bare, ...fields });
}

describe("restored art in the manifest", () => {
  it("accepts a cell or an asset per pack, with or without a hue", () => {
    const m = validateManifest({
      ...bare,
      restoredItemArt: [{ kind: "restorer:food:apple-juice", packs: { old: { row: 1, col: 2 } } }],
      restoredMonsterArt: [{ race: "restorer:mature-bronze-dragon", packs: { nomad: { asset: "art/dragon.png" } }, hue: 40 }],
      restoredFlavorArt: [
        { flavor: 303, drawAs: 28, hue: 90 },
        { flavor: 304, packs: { old: { row: 3, col: 4 } } },
      ],
    });
    expect(m.restoredMonsterArt?.[0]?.hue).toBe(40);
    expect(m.restoredFlavorArt).toHaveLength(2);
  });

  it("refuses a race that is not a namespaced id, or one named twice", () => {
    expect(check({ restoredMonsterArt: [{ race: "dragon", packs: {} }] })).toThrow(/race must be a namespaced id/u);
    const twice = { race: "restorer:x", packs: {} };
    expect(check({ restoredMonsterArt: [twice, twice] })).toThrow(/repeats race restorer:x/u);
  });

  it("refuses a pack entry with both a cell and an asset, or an asset outside the mod", () => {
    expect(check({ restoredMonsterArt: [{ race: "restorer:x", packs: { old: { row: 1, col: 1, asset: "a.png" } } }] })).toThrow(
      /exactly one of row\/col or asset/u,
    );
    expect(check({ restoredItemArt: [{ kind: "restorer:a:b", packs: { old: { asset: "../a.png" } } }] })).toThrow(
      /stay inside the mod folder/u,
    );
  });

  it("refuses a hue that is not a number", () => {
    expect(check({ restoredItemArt: [{ kind: "restorer:a:b", packs: {}, hue: "red" }] })).toThrow(/hue must be a number/u);
  });

  it("refuses a flavour with neither packs nor drawAs, or drawing as itself", () => {
    expect(check({ restoredFlavorArt: [{ flavor: 303 }] })).toThrow(/needs a packs map or drawAs/u);
    expect(check({ restoredFlavorArt: [{ flavor: 303, drawAs: 303 }] })).toThrow(/drawAs must be another flavour/u);
    expect(check({ restoredFlavorArt: [{ flavor: -1, drawAs: 2 }] })).toThrow(/flavor must be a flavour index/u);
  });
});
