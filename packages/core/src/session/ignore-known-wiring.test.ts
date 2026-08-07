/**
 * obj-ignore.yaml: ignore_level_of reads obj->known, and the LIVE wire supplies
 * it.
 *
 * This is a wiring test on a real booted game for the reason
 * describe-wiring.test.ts is: the unit tests in obj/ignore.test.ts pin the
 * predicate, but they build the ObjectKnownView themselves. Nothing they do can
 * tell whether session/game.ts's `state.isIgnored` passes the SYNTHESISED twin
 * or a hand-rolled fully-known stand-in - and a stand-in restores exactly the
 * defect the fix removes, silently, on the one path the whole game reads
 * through (autopickup, the run loop, the item lists, ignore_drop).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";
import { ITYPE } from "../generated/index.js";
import { TV } from "../generated/index.js";
import { IGNORE } from "../obj/ignore.js";
import { OBJ_NOTICE, playerLearnAllRunes } from "../obj/knowledge.js";
import { objectPrep } from "../obj/make.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  obj: {
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
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
};

describe("state.isIgnored gates on real object knowledge (obj-ignore.c L464)", () => {
  /**
   * A dagger with a to-dam penalty the player has no way to see. Fully known it
   * is IGNORE_BAD; unidentified, object_fully_known is false and upstream
   * "return[s] the maximum possible value" (obj-ignore.c L461), which no
   * threshold below MAX ignores.
   */
  function badDagger(state: ReturnType<typeof startGame>["state"], booted: ReturnType<typeof startGame>["booted"]) {
    const reg = booted.registries.objects;
    const kind = reg.kinds.find((k) => k.name === "& Dagger~" && k.tval === TV.SWORD);
    expect(kind, "fixture: the pack has a Dagger").toBeDefined();
    const obj = objectPrep(state.rng, reg, booted.registries.constants, kind!, 0, "minimise");
    obj.toD = -3;
    return obj;
  }

  it("does not ignore an unidentified bad weapon at the BAD threshold", () => {
    const { state, booted } = startGame(pack, { seed: 21, depth: 1 });
    state.ignore.level[ITYPE.SHARP] = IGNORE.BAD;
    const obj = badDagger(state, booted);

    /* Ground truth for the fixture: this dagger really is not fully known yet,
     * or the assertion below would hold for the wrong reason. */
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(0);
    expect(state.isIgnored!(obj)).toBe(false);
  });

  it("ignores the SAME weapon once it is identified", () => {
    const { state, booted } = startGame(pack, { seed: 21, depth: 1 });
    state.ignore.level[ITYPE.SHARP] = IGNORE.BAD;
    const obj = badDagger(state, booted);

    playerLearnAllRunes(state.actor.player, state.runeEnv);
    obj.notice |= OBJ_NOTICE.ASSESSED;
    expect(state.isIgnored!(obj)).toBe(true);
  });
});
