/**
 * The real content a project_p vector is run against.
 *
 * SEPARATE FILE, and it reads the disk: keeping node:fs out of
 * `player-side-vectors.ts` means that module stays importable from anywhere.
 * ONE copy, shared by `player-side-vectors.test.ts` and by
 * `scripts/gen-player-side-vectors.mjs`, so the test and the generator cannot
 * disagree about what they are measuring - which is the whole point of a
 * recording.
 *
 * FOUR ARMS THIS FILE EXISTS TO REACH. The first recording ran 2,304 scenarios
 * in which the pack was never damaged, the worn armour was never disenchanted,
 * minus_ac never bit and every teleport failed - four whole handler arms
 * recorded as dead code, and a vector file that would have replayed forever
 * without noticing. Each of the four is deliberate here:
 *
 *  - PACK KINDS ARE PICKED FROM PREPPED OBJECTS. `object_prep` ORs the object
 *    BASE's el_info into the kind's (obj-make.c), which is where scrolls learn
 *    to hate fire and potions to hate cold. Filtering on `kind.el_info` alone
 *    found six ELEC kinds and three FIRE ones, and nothing at all for ACID or
 *    COLD.
 *  - THE ARMOUR GOES IN THE ARMOUR SLOTS. Both minus_ac and
 *    disenchant_equipment pick a random slot BY TYPE and then look for an item
 *    in it; a suit of armour parked in slot 0 (WEAPON) is invisible to both.
 *  - THE CHUNK IS DUNGEON-SIZED. NEXUS teleports 200 grids and
 *    chooseTeleportDestination simply fails on a 40x25 field, so every teleport
 *    row recorded "Failed to find teleport destination!".
 *  - AND IT IS BELOW THE TOWN. teleport_player_level cannot go UP from depth 0,
 *    so the up/down coin flip - a real RNG draw - never happened.
 */

import { readFileSync } from "node:fs";
import { bindConstants } from "../constants.js";
import { OF, TV } from "../generated/index.js";
import { EL_INFO_HATES, EL_INFO_IGNORE } from "../obj/types.js";
import type { ObjPackJson, ObjectKind } from "../obj/types.js";
import { ObjRegistry } from "../obj/bind.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import { Rng } from "../rng.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import type { Loc } from "../loc.js";
import type { GameState } from "./context.js";
import { addMon, makeRace, makeState, plReg } from "./harness.js";
import { gearAdd } from "./gear.js";
import { PACK_DAMAGE_ELEMENTS, VECTOR_DEPTH } from "./player-side-vectors.js";
import type { PlayerSideFixtures } from "./player-side-vectors.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

function records<T>(name: string): T[] {
  const raw = loadJson<T[] | { records: T[] }>(name);
  return Array.isArray(raw) ? raw : raw.records;
}

/**
 * Every protective flag project_p reads, in one place.
 *
 * The five sustains are here because EF_DRAIN_STAT's sustain arm (FIRE's STR,
 * COLD's DEX, POIS's CON) prints a different message and skips the drain, and
 * without them that arm is unreachable in every row.
 */
const WARD_FLAGS: readonly number[] = [
  OF.HOLD_LIFE,
  OF.PROT_STUN,
  OF.PROT_CONF,
  OF.PROT_BLIND,
  OF.FREE_ACT,
  OF.SUST_STR,
  OF.SUST_INT,
  OF.SUST_WIS,
  OF.SUST_DEX,
  OF.SUST_CON,
];

/**
 * The dungeon the vectors run in: upstream's DUNGEON_WID x DUNGEON_HGT
 * (cave.h). Not a round number chosen for comfort - NEXUS asks for a 200-grid
 * teleport and the search either has that much room or reports failure.
 */
const CHUNK_W = 198;
const CHUNK_H = 66;

/** The armour slot types minus_ac and disenchant_equipment can pick. */
const ARMOUR_SLOTS: readonly string[] = [
  "BODY_ARMOR",
  "CLOAK",
  "SHIELD",
  "HAT",
  "GLOVES",
  "BOOTS",
];

export function playerSideFixtures(): PlayerSideFixtures {
  const objPack: ObjPackJson = {
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
  } as ObjPackJson;

  const reg = new ObjRegistry(objPack);
  const constants = bindConstants(loadJson("constants"));
  const projections = bindProjections(
    records<ProjectionRecordJson>("projection"),
  );

  const prep = (rng: Rng, kind: ObjectKind): GameObject =>
    objectPrep(rng, reg, constants, kind, 20, "average");

  /**
   * One destroyable kind per element inven_damage is called with, selected by
   * running the real object_prep and reading the resulting el_info.
   *
   * DERIVED, NOT NAMED. A fixed sval would be an assertion about the content
   * pack, and an unchecked one; picked this way, a content change that stopped
   * making scrolls flammable moves the fixture instead of silently emptying it.
   * The selection runs on its own throwaway Rng so it cannot perturb a
   * scenario's stream.
   */
  const scratch = new Rng(999);
  const destroyedBy = new Map<number, ObjectKind>();
  for (const kind of reg.kinds) {
    /* Weapons and armour take inven_damage's DAMAGE arm (to_h/to_d/to_a--)
     * rather than the destruction arm; both are wanted, but separately. */
    if (kind.tval === TV.SOFT_ARMOR || kind.tval === TV.SWORD) continue;
    const obj = prep(scratch, kind);
    for (const elem of PACK_DAMAGE_ELEMENTS) {
      if (destroyedBy.has(elem)) continue;
      const info = obj.elInfo[elem];
      if (
        info &&
        info.flags & EL_INFO_HATES &&
        !(info.flags & EL_INFO_IGNORE)
      ) {
        destroyedBy.set(elem, kind);
      }
    }
  }

  const armourKind = reg.kinds.find((k) => k.tval === TV.SOFT_ARMOR);
  const weaponKind = reg.kinds.find((k) => k.tval === TV.SWORD);
  if (!armourKind || !weaponKind) {
    throw new Error("the content pack has no soft armour or no sword");
  }

  return {
    makeState: (seed: number): GameState => {
      const state = makeState({ seed, w: CHUNK_W, h: CHUNK_H });
      /* Below the town, so teleport_player_level has an UP to choose and the
       * up/down coin flip is a real draw. */
      state.chunk.depth = VECTOR_DEPTH;
      return state;
    },
    timed: plReg.timed,
    projections,
    destroyedByElement: destroyedBy,

    fillPack: (state: GameState): void => {
      for (const elem of PACK_DAMAGE_ELEMENTS) {
        const kind = destroyedBy.get(elem);
        if (!kind) continue;
        const obj = prep(state.rng, kind);
        /* A BIG stack. inven_damage rolls randint0(10000) < cperc PER ITEM, and
         * cperc peaks at 300 - so a stack of five destroyed nothing in 2,304
         * scenarios and the whole destruction arm recorded as dead code. Twenty
         * makes it near-certain in the high-damage rows, and its "All of your" /
         * "Some of your" / "One of your" prefixes all reachable. */
        obj.number = 20;
        state.gear.pack.push(gearAdd(state.gear, obj));
      }
      /* A weapon and a spare suit of armour take inven_damage's DAMAGE arm
       * instead: a different branch, a different message, a different number of
       * draws. */
      state.gear.pack.push(gearAdd(state.gear, prep(state.rng, weaponKind)));
      state.gear.pack.push(gearAdd(state.gear, prep(state.rng, armourKind)));
    },

    equipArmour: (state: GameState, warded: boolean): void => {
      const p = state.actor.player;
      for (let slot = 0; slot < p.body.count; slot++) {
        const type = p.body.slots[slot]?.type;
        if (type !== "WEAPON" && !ARMOUR_SLOTS.includes(type ?? "")) continue;
        const obj = prep(state.rng, type === "WEAPON" ? weaponKind : armourKind);
        /* Real enchantment, so disenchant_equipment and minus_ac both have
         * something to remove; at to_a 0 minus_ac declines outright and DISEN
         * records nothing but a message. */
        obj.toA = 8;
        obj.toH = 5;
        obj.toD = 5;
        if (warded) for (const f of WARD_FLAGS) obj.flags.on(f);
        p.equipment[slot] = gearAdd(state.gear, obj);
      }
    },

    addMonster: (state: GameState, grid: Loc): number => {
      const mon = addMon(state, makeRace(), grid);
      return state.monsters.indexOf(mon);
    },
  };
}
