/**
 * Golden vectors for RANDOM ARTIFACT construction: MOD_REACH gap 14.
 *
 * WHY THIS EXISTS. Four closed `switch` statements build every random artifact
 * in the game, and they are the largest dispatch left in the tree:
 *
 *   - `addAbilityAux`  (randart-build.ts, keyed on the `ART_IDX` ability, 87
 *     cases) - what "add this ability" actually does to the artifact.
 *   - `artifactPrep`   (randart-build.ts, keyed on the base item's tval, 15) -
 *     the starting to-hit / to-dam / AC an item class is given.
 *   - the item-class census (randart-data.ts, keyed on tval, 14) - which
 *     `data.*Total` bucket a standard artifact counts toward, which feeds the
 *     frequency table the design loop spends.
 *   - the redundancy test (randart-build.ts, keyed on the `EFPROP` kind, 9) -
 *     whether an activation only duplicates something the artifact already has.
 *
 * Converting them into keyed registries so a mod can define a NEW ability, or a
 * new item class, is a refactor of the most RNG-dense code in the port. What has
 * to be proven is not "the randart tests still pass" but "the same seed still
 * produces the same artifacts, drawn in the same order".
 *
 * WHY THE EXISTING TESTS ARE NOT THAT. `randart.test.ts` asserts do_randart is
 * deterministic by running it TWICE IN ONE PROCESS and comparing. That is a real
 * property and it catches real bugs - but it cannot fail across a refactor,
 * because a change that moves every artifact moves both runs identically.
 * Agreement is symmetric; a fixture recorded on disk is not.
 *
 * THE PROBE IS THE POINT, AND IT NEEDED A SEAM TO EXIST. `doRandart` owns its
 * Rng internally, so the whole-set family below has no probe: what defends it is
 * that all ~130 artifacts come off ONE stream in sequence, so a changed draw
 * count anywhere but after the final draw moves everything downstream of it. The
 * blind spot that leaves - a draw added at the very end - is closed by the
 * per-arm families, which drive `artifactPrep` and `addAbilityAux` with an Rng
 * this module owns and probe it afterwards. That is also what makes those two
 * families per-ARM coverage rather than aggregate: a vector per `ART_IDX` fails
 * naming the ability that moved.
 *
 * Fixtures are INJECTED rather than loaded here, so this module pulls in no
 * node:fs and no content pack, and can be imported from anywhere.
 *
 * Regenerate with `node packages/core/scripts/gen-randart-vectors.mjs` - which
 * OVERWRITES the evidence, so only do it when artifact generation is
 * deliberately changing, and say so in the commit.
 */

import { FLAG_START, NO_FLAG } from "../bitflag.js";
import type { FlagSet } from "../bitflag.js";
import { ART_IDX, TV } from "../generated/index.js";
import { Rng } from "../rng.js";
import type { Constants } from "../constants.js";
import type { ObjRegistry } from "./bind.js";
import type { Artifact } from "./types.js";
import { addAbilityAux, artifactPrep, getBaseItem } from "./randart-build.js";
import { collectArtifactData } from "./randart-data.js";
import { cloneArtifact, doRandart } from "./randart.js";

/** One recorded call. Flat and all-string so a diff names what moved. */
export interface RandartVector {
  /** Which family: "set" | "prep" | "ability" | "data". */
  kind: string;
  /** The artifact, the tval name, or the ART_IDX name. */
  subject: string;
  /** The inputs, spelled out. */
  scenario: string;
  /** What the code produced. */
  out: string;
  /**
   * One draw taken from an Rng THIS MODULE owns, after the call - it can only
   * match if the stream is at the same position. Absent for the whole-set
   * family, whose Rng lives inside `doRandart`; see the module header for what
   * defends that one instead.
   */
  probe?: number;
}

/** What the vectors need from the shipped pack. */
export interface RandartVectorFixtures {
  /** A registry with projections bound - `add_brand` cannot run without them. */
  registry(): ObjRegistry;
  /** z_info, which `artifact_power` reaches through `make_fake_artifact`. */
  constants(): Constants;
}

/** The seeds the whole-set family runs. Three, because a set is expensive. */
export const RANDART_VECTOR_SEEDS = [1, 4242, 999999] as const;

/** The seeds the cheap per-arm families run, on both sides of a coin flip. */
export const RANDART_ARM_SEEDS = [7, 31337] as const;

/**
 * The target powers the ability family runs at, and the second one is not
 * decoration. `ART_IDX.WEAPON_AGGR` / `NONWEAPON_AGGR` only grant AGGRAVATE
 * when `targetPower > AGGR_POWER` (300, obj-randart.h L47), so a family run at
 * one low power records those two arms doing NOTHING - indistinguishable from
 * the `*_SUPER` frequency-table indices that genuinely have no case. The first
 * recording of these vectors had exactly that hole. This is the same failure
 * the glyph work found the expensive way: a scenario grid that never reaches
 * the arm it was written to defend.
 */
export const RANDART_TARGET_POWERS = [100, 500] as const;

/**
 * Every tval `artifactPrep`'s switch names, plus RING, AMULET and LIGHT -
 * which it does NOT name and which therefore take its default arm. A vector
 * that only covers the listed cases cannot tell a missing default from a
 * present one.
 */
const PREP_TVALS: readonly (readonly [string, number])[] = [
  ["BOW", TV.BOW],
  ["DIGGING", TV.DIGGING],
  ["HAFTED", TV.HAFTED],
  ["SWORD", TV.SWORD],
  ["POLEARM", TV.POLEARM],
  ["BOOTS", TV.BOOTS],
  ["GLOVES", TV.GLOVES],
  ["HELM", TV.HELM],
  ["CROWN", TV.CROWN],
  ["SHIELD", TV.SHIELD],
  ["CLOAK", TV.CLOAK],
  ["SOFT_ARMOR", TV.SOFT_ARMOR],
  ["HARD_ARMOR", TV.HARD_ARMOR],
  ["DRAG_ARMOR", TV.DRAG_ARMOR],
  ["RING", TV.RING],
  ["AMULET", TV.AMULET],
  ["LIGHT", TV.LIGHT],
];

/** ART_IDX names in index order, so a vector names the ability that moved. */
function abilityNames(): readonly string[] {
  const byIndex: string[] = [];
  for (const [name, value] of Object.entries(
    ART_IDX as unknown as Record<string, number>,
  )) {
    if (typeof value !== "number" || name === "MAX") continue;
    byIndex[value] = name;
  }
  return byIndex;
}

/**
 * The flags actually SET, as a list of indices.
 *
 * `FlagSet` has no toString and the default one produces "[object Object]" - a
 * field that is identical for every artifact in the file and therefore cannot
 * disagree. That is not hypothetical: the first recording of these vectors
 * carried exactly that string in all 644 rows, which would have let an ability
 * stop granting its flag without moving a single vector.
 */
function flagList(set: FlagSet): number[] {
  const on: number[] = [];
  for (let f = set.next(FLAG_START); f !== NO_FLAG; f = set.next(f + 1)) {
    on.push(f);
  }
  return on;
}

/**
 * Everything observable about one artifact. Deliberately EVERY field of the
 * struct rather than the handful `randart.test.ts`'s fingerprint uses: an
 * ability that stops granting a curse, a brand or an activation would otherwise
 * move nothing this file can see.
 */
function fingerprint(a: Artifact | null): string {
  if (!a) return "null";
  return JSON.stringify({
    name: a.name,
    tval: a.tval,
    sval: a.sval,
    toH: a.toH,
    toD: a.toD,
    toA: a.toA,
    ac: a.ac,
    dd: a.dd,
    ds: a.ds,
    weight: a.weight,
    cost: a.cost,
    level: a.level,
    alloc: [a.allocProb, a.allocMin, a.allocMax],
    flags: flagList(a.flags),
    mods: a.modifiers,
    el: a.elInfo.map((e) => [e.resLevel, e.flags]),
    brands: a.brands ? a.brands.map((b) => (b ? 1 : 0)) : null,
    slays: a.slays ? a.slays.map((s) => (s ? 1 : 0)) : null,
    curses: a.curses,
    act: a.activation ? a.activation.name : null,
    altMsg: a.altMsg,
    time: [a.time.base, a.time.dice, a.time.sides, a.time.mBonus],
  });
}

/* ------------------------------------------------------------------ *
 * Family 1: whole sets, end to end.
 * ------------------------------------------------------------------ */

/** do_randart at each seed, one vector per generated artifact. */
export function computeSetVectors(
  fixtures: RandartVectorFixtures,
): RandartVector[] {
  const constants = fixtures.constants();
  const out: RandartVector[] = [];
  for (const seed of RANDART_VECTOR_SEEDS) {
    /* A fresh registry per seed: do_randart is asserted elsewhere not to mutate
     * the standard artifacts, and this file must not be the thing that would
     * hide it if that stopped being true. */
    const arts = doRandart(fixtures.registry(), constants, seed, false);
    arts.forEach((art, i) => {
      out.push({
        kind: "set",
        subject: art ? art.name : `#${String(i)}`,
        scenario: `seed=${String(seed)} aidx=${String(i)}`,
        out: fingerprint(art),
      });
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Family 2 and 3: the per-arm families, with a probe.
 * ------------------------------------------------------------------ */

/**
 * A prepped artifact to start an arm from. Cloned from a standard artifact,
 * which is the same object shape `doRandart`'s design loop mutates - derived
 * from the real producer rather than hand-built, so the vector cannot pass
 * against a struct production never sees.
 */
function seedArtifact(reg: ObjRegistry): Artifact {
  const src = reg.artifacts.find((a) => a !== null);
  if (!src) throw new Error("randart-vectors: the pack has no artifacts");
  return cloneArtifact(src);
}

/** artifact_prep per item class, with the RNG position afterwards. */
export function computePrepVectors(
  fixtures: RandartVectorFixtures,
): RandartVector[] {
  const reg = fixtures.registry();
  const constants = fixtures.constants();
  const data = collectArtifactData(reg, constants, reg.artifacts, new Rng(11));
  const out: RandartVector[] = [];

  for (const [name, tval] of PREP_TVALS) {
    for (const seed of RANDART_ARM_SEEDS) {
      const rng = new Rng(seed);
      const art = seedArtifact(reg);
      const kind = getBaseItem(reg, tval, rng);
      artifactPrep(reg, art, kind, data, rng);
      out.push({
        kind: "prep",
        subject: name,
        scenario: `tval=${name} seed=${String(seed)}`,
        out: fingerprint(art),
        probe: rng.randint0(1 << 24),
      });
    }
  }
  return out;
}

/** add_ability_aux per ART_IDX, with the RNG position afterwards. */
export function computeAbilityVectors(
  fixtures: RandartVectorFixtures,
): RandartVector[] {
  const reg = fixtures.registry();
  const constants = fixtures.constants();
  const data = collectArtifactData(reg, constants, reg.artifacts, new Rng(11));
  const names = abilityNames();
  const out: RandartVector[] = [];

  for (let r = 0; r < names.length; r++) {
    const name = names[r] ?? `ART_IDX_${String(r)}`;
    for (const seed of RANDART_ARM_SEEDS) {
      for (const power of RANDART_TARGET_POWERS) {
        /* A SWORD base, because most abilities are reachable on a weapon and
         * the ones that are not still have to be recorded doing nothing. */
        const rng = new Rng(seed);
        const art = seedArtifact(reg);
        artifactPrep(reg, art, getBaseItem(reg, TV.SWORD, rng), data, rng);
        /* Re-seed AFTER the prep so the probe measures this ability's draws
         * alone, not the base item's. */
        const abilityRng = new Rng(seed + 1);
        addAbilityAux(reg, art, r, power, data, abilityRng);
        out.push({
          kind: "ability",
          subject: name,
          scenario: `r=${String(r)} seed=${String(seed)} power=${String(power)}`,
          out: fingerprint(art),
          probe: abilityRng.randint0(1 << 24),
        });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Family 4: the item-class census the frequency table rests on.
 * ------------------------------------------------------------------ */

/** collect_artifact_data over the standard set: every scalar it produces. */
export function computeDataVectors(
  fixtures: RandartVectorFixtures,
): RandartVector[] {
  const reg = fixtures.registry();
  const rng = new Rng(11);
  const data = collectArtifactData(reg, fixtures.constants(), reg.artifacts, rng);
  return [
    {
      kind: "data",
      subject: "totals",
      scenario: "standard set, seed=11",
      out: JSON.stringify({
        bow: data.bowTotal,
        melee: data.meleeTotal,
        boot: data.bootTotal,
        glove: data.gloveTotal,
        headgear: data.headgearTotal,
        shield: data.shieldTotal,
        cloak: data.cloakTotal,
        armor: data.armorTotal,
        other: data.otherTotal,
        total: data.total,
        negPower: data.negPowerTotal,
      }),
      probe: rng.randint0(1 << 24),
    },
    {
      kind: "data",
      subject: "power-profile",
      scenario: "standard set, seed=11",
      out: JSON.stringify({
        hitIncrement: data.hitIncrement,
        damIncrement: data.damIncrement,
        hitStartval: data.hitStartval,
        damStartval: data.damStartval,
        acStartval: data.acStartval,
        acIncrement: data.acIncrement,
        maxPower: data.maxPower,
        minPower: data.minPower,
        avgPower: data.avgPower,
        varPower: data.varPower,
      }),
    },
    {
      kind: "data",
      subject: "frequencies",
      scenario: "standard set, seed=11",
      out: JSON.stringify({
        artProbs: data.artProbs,
        tvProbs: data.tvProbs,
        tvNum: data.tvNum,
        tvFreq: data.tvFreq,
      }),
    },
  ];
}

/** Every family, in a stable order. */
export function computeRandartVectors(
  fixtures: RandartVectorFixtures,
): RandartVector[] {
  return [
    ...computeDataVectors(fixtures),
    ...computePrepVectors(fixtures),
    ...computeAbilityVectors(fixtures),
    ...computeSetVectors(fixtures),
  ];
}
