/**
 * The half of "a mod can add an object" that composition cannot answer.
 *
 * `mod-sdk/src/loader.test.ts` proves the merge: core's 375 objects plus a
 * mod's one comes out 376. It says nothing about whether CORE can bind that
 * array, and binding is where the parity risk lives - upstream's `sval` is not
 * a field in the data, it is a COUNTER, bumped per object base in file order
 * (`parse_object_type`, reference/src/obj-init.c). So a new object is only safe
 * if it lands at the END: appended, core's svals and kidxs are untouched and a
 * savefile written before the mod was installed still names the same items;
 * prepended, every sword in the game would shift by one and every saved
 * character would be holding something else.
 *
 * Composition appends, because core is pack zero and a mod declaring core as a
 * dependency loads after it. This measures that rather than trusting it.
 */

import { describe, expect, it } from "vitest";
import { bindCore } from "@rpgm-tools/neo-angband-core";
import type { GamePack } from "@rpgm-tools/neo-angband-core";
import { loadGamePack } from "./pack";

/** A plain new weapon, of a tval core already ships. */
const SLUDGE_DAGGER = {
  name: "& Sludge Dagger~",
  type: "sword",
  graphics: { glyph: "|", color: "W" },
  level: 20,
  weight: 140,
  cost: 300,
  alloc: { common: 20, minmax: "20 to 100" },
  attack: { hd: "3d5", "to-h": "0", "to-d": "0" },
  "desc-x": "A dagger that drips.",
};

/** How many object RECORDS a pack carries, which is not how many kinds bind. */
function objectCount(pack: GamePack): number {
  const file = pack.obj.object as unknown;
  return (Array.isArray(file) ? file : (file as { records: unknown[] }).records).length;
}

/** The base pack, and the same pack with one object appended. */
function packs(): { base: GamePack; modded: GamePack } {
  const base = loadGamePack();
  /* `composedFile` hands core the pack file in its on-disk shape, which is a
   * `{records: [...]}` wrapper for some files and a bare array for others.
   * Appending has to preserve whichever it is. */
  const file = base.obj.object as unknown;
  const objects = (Array.isArray(file) ? file : (file as { records: unknown[] }).records) ?? [];
  const grown = [...objects, SLUDGE_DAGGER];
  const modded = {
    ...base,
    obj: {
      ...base.obj,
      object: Array.isArray(file) ? grown : { ...(file as object), records: grown },
    },
  } as unknown as GamePack;
  return { base, modded };
}

const identity = (k: { name: string; tval: number; sval: number }): string =>
  `${k.name}|${k.tval}|${k.sval}`;

describe("core binds an object a mod added", () => {
  it("leaves every one of core's own kinds at its index, name, tval and sval", () => {
    const { base, modded } = packs();
    const before = bindCore(base).objects.kinds;
    const after = bindCore(modded).objects.kinds;
    const n = objectCount(base);

    expect(after).toHaveLength(before.length + 1);
    /* THE PARITY CLAIM, over every kind rather than a sample: a spot check
     * would pass while a whole tval's svals had shifted by one. */
    expect(after.slice(0, n).map(identity)).toEqual(before.slice(0, n).map(identity));
  });

  it("lands where the file put it: after core's objects, before the artifact dummies", () => {
    /* bindCore appends a dummy kind for each special artifact whose base sval
     * `object.txt` never defines (write_dummy_object_record: the Phial, the
     * Star, the Arkenstone, the rings of power). Those sit AFTER the real
     * objects, so a mod's object shifts their ARRAY INDEX by one.
     *
     * That is safe, and the reason is worth naming because it was not always
     * true: a savefile stores `kindId`, a namespaced string, not `kidx`
     * (`serializeObject`, core/src/session/save.ts) - save format 2 replaced
     * every numeric content index with a string id for exactly this class of
     * problem. The index is rebuilt from the current bind at load. What the
     * assertion below holds is that the tail's NAME, tval and sval are
     * untouched, which is what that string id is derived from. */
    const { base, modded } = packs();
    const before = bindCore(base).objects.kinds;
    const after = bindCore(modded).objects.kinds;
    const n = objectCount(base);

    expect(after[n]?.name).toContain("Sludge Dagger");
    expect(after.slice(n + 1).map(identity)).toEqual(before.slice(n).map(identity));
  });

  it("gives it the next free sval of its own base, not one core is using", () => {
    const { base, modded } = packs();
    const beforeKinds = bindCore(base).objects.kinds;
    const added = bindCore(modded).objects.kinds[objectCount(base)];

    const taken = beforeKinds.filter((k) => k.tval === added?.tval).map((k) => k.sval);
    expect(taken.length).toBeGreaterThan(0); // control: "sword" is a real tval
    expect(taken).not.toContain(added?.sval);
    expect(added?.sval).toBe(Math.max(...taken) + 1);
  });
});
