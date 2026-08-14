/**
 * `build_freq_table`'s item-class reach.
 *
 * WHY THIS FILE EXISTS. `registry:randart` opened four dispatches - abilities
 * by `ART_IDX`, prep by tval, the census by tval, and the redundancy test by
 * `EFPROP`. It did NOT open `buildFreqTable`, which is the table the design
 * loop SPENDS: a mod item class with prep and census both registered still got
 * only the generic ability menu, because this function asked
 * `art.tval === TV.HELM || art.tval === TV.CROWN` directly. That is a
 * `registry:tval` question, not a `registry:randart` one, and the two seams
 * were answering differently about the same item.
 *
 * WHAT THE GOLDEN VECTORS CANNOT SAY. `randart-vectors.json` replays
 * byte-identical after the conversion, which is the point - but a no-op edit
 * replays byte-identical too. This is the other direction: a class widened
 * through `registry:tval` now reaches the group, where before it could not.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { ART_IDX } from "../generated/randart-properties.js";
import { TV } from "../generated/index.js";
import { ObjRegistry } from "./bind.js";
import { buildFreqTable } from "./randart-build.js";
import { artifactSetDataNew } from "./randart-data.js";
import type { ArtifactSetData } from "./randart-data.js";
import { resetTvalRegistry, tvalRegistry } from "./tval-registry.js";
import type { Artifact, ObjPackJson } from "./types.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const reg = new ObjRegistry({
  objectBase: loadJson("object_base"),
  object: loadJson("object"),
  egoItem: loadJson("ego_item"),
  artifact: loadJson("artifact"),
  curse: loadJson("curse"),
  brand: loadJson("brand"),
  slay: loadJson("slay"),
  activation: loadJson("activation"),
  objectProperty: loadJson("object_property"),
  flavor: loadJson("flavor"),
} as ObjPackJson);

/** A tval beyond everything core defines - a mod's own. */
const MOD_TVAL = 200;

/**
 * Every learned probability set to 1, so the cumulative table's step at index
 * `i` is exactly "is ability `i` in this item's menu" - one, or zero. A table
 * built from real learned frequencies would confuse "not in the menu" with
 * "in the menu but never seen in the standard set".
 */
function flatData(): ArtifactSetData {
  const data = artifactSetDataNew(reg);
  data.artProbs.fill(1);
  return data;
}

/** The per-index frequencies, recovered from the cumulative table. */
function menu(art: Artifact, data: ArtifactSetData): Set<number> {
  const freq = buildFreqTable(art, data);
  const on = new Set<number>();
  for (let i = 0; i < freq.length; i++) {
    const step = i === 0 ? freq[0]! : freq[i]! - freq[i - 1]!;
    if (step > 0) on.add(i);
  }
  return on;
}

function artifactOf(tval: number): Artifact {
  return { tval } as Artifact;
}

describe("build_freq_table reaches a MOD's item class", () => {
  afterEach(() => {
    resetTvalRegistry();
  });

  it("is measuring something: core's own headgear already gets the group", () => {
    /* The control that makes the widening test mean anything. If a HELM did
     * not carry the headgear group either, the test below would be measuring a
     * broken table rather than a closed seam. */
    const data = flatData();
    const helm = menu(artifactOf(TV.HELM), data);
    const crown = menu(artifactOf(TV.CROWN), data);
    for (const idx of [ART_IDX.HELM_AC, ART_IDX.HELM_ESP, ART_IDX.HELM_WIS]) {
      expect({ idx, helm: helm.has(idx), crown: crown.has(idx) }).toEqual({
        idx,
        helm: true,
        crown: true,
      });
    }
  });

  it("gives a widened headgear class the headgear abilities", () => {
    const data = flatData();

    /* BEFORE: a mod tval takes the non-weapon menu and nothing else. */
    const before = menu(artifactOf(MOD_TVAL), data);
    expect(before.has(ART_IDX.HELM_AC)).toBe(false);
    expect(before.has(ART_IDX.HELM_ESP)).toBe(false);
    expect(before.has(ART_IDX.ALLARMOR_WEIGHT)).toBe(false);

    const inner = tvalRegistry().classes.handlerFor("tvalIsHeadArmor")!;
    tvalRegistry().classes.set(
      "tvalIsHeadArmor",
      (tval) => tval === MOD_TVAL || inner(tval),
    );

    /* AFTER: exactly the six headgear indices arrived, and nothing else moved
     * - a widening that leaked into the armour or melee group would fail here
     * rather than pass as a success. */
    const after = menu(artifactOf(MOD_TVAL), data);
    const gained = [...after].filter((i) => !before.has(i)).sort((a, b) => a - b);
    const lost = [...before].filter((i) => !after.has(i));
    expect({ gained, lost }).toEqual({
      gained: [
        ART_IDX.HELM_AC,
        ART_IDX.HELM_RBLIND,
        ART_IDX.HELM_ESP,
        ART_IDX.HELM_SINV,
        ART_IDX.HELM_WIS,
        ART_IDX.HELM_INT,
      ].sort((a, b) => a - b),
      lost: [],
    });
  });

  it("gives a widened melee class the weapon and melee groups, and ammo neither", () => {
    /* THE TRAP THIS GUARDS, which the golden vectors provably cannot see. The
     * general-weapon group is upstream's BOW plus the four melee tvals, which
     * is `tvalIsLauncher || tvalIsMeleeWeapon` - NOT `tvalIsWeapon`, which
     * also answers yes for SHOT, ARROW and BOLT. Writing the shorter, wronger
     * predicate replays `randart-vectors.json` byte-identical, because the
     * 4.2.6 pack has no ammo artifact and `doRandart` never generates one, so
     * the vectors have no subject that could exhibit the difference. This
     * assertion is that subject. */
    const data = flatData();
    for (const ammo of [TV.SHOT, TV.ARROW, TV.BOLT]) {
      const m = menu(artifactOf(ammo), data);
      expect({ ammo, weapon: m.has(ART_IDX.WEAPON_HIT) }).toEqual({
        ammo,
        weapon: false,
      });
    }

    const before = menu(artifactOf(MOD_TVAL), data);
    expect(before.has(ART_IDX.MELEE_DICE)).toBe(false);

    const inner = tvalRegistry().classes.handlerFor("tvalIsMeleeWeapon")!;
    tvalRegistry().classes.set(
      "tvalIsMeleeWeapon",
      (tval) => tval === MOD_TVAL || inner(tval),
    );

    const after = menu(artifactOf(MOD_TVAL), data);
    expect({
      weapon: after.has(ART_IDX.WEAPON_HIT),
      melee: after.has(ART_IDX.MELEE_DICE),
      /* And the non-weapon group it used to take is gone, because the two are
       * an if/else in upstream. */
      nonweapon: after.has(ART_IDX.NONWEAPON_HIT),
    }).toEqual({ weapon: true, melee: true, nonweapon: false });
  });
});
