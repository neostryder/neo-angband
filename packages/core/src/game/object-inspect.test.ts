/**
 * makeObjectInfoDeps' hypothetical derive is calc_bonuses with known_only set
 * (obj-info.c:888, 914, 1056, 1296, 1738, 1839), so a bonus on another worn
 * item that the player has not learned moves none of a weapon's numbers. Like
 * every calc_bonuses pass it also walks each worn item's curses.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STAT, TV } from "../generated/index.js";
import { OBJ_NOTICE, playerLearnCombat } from "../obj/knowledge.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import { textblockToString } from "../obj/object-info.js";
import { Rng } from "../rng.js";
import { startGame } from "../session/game.js";
import type { GamePack } from "../session/game.js";
import type { GameState } from "./context.js";
import { invenCarry, wieldObject } from "./gear.js";
import { invenTakeoff } from "./obj-cmd.js";
import { objectInfoTextblock, type ObjectInfoExtras } from "./object-inspect.js";

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

interface Worn {
  state: GameState;
  extras: ObjectInfoExtras;
  dagger: GameObject;
}

/**
 * A character who has learned neither the to-hit nor the to-dam rune, wearing
 * soft leather armour with `toH` and `toD` on it, and a dagger to describe.
 */
function wearing(toH: number, toD: number, curse?: string): Worn {
  const { state, booted } = startGame(pack, { seed: 4242, depth: 1 });
  const reg = booted.registries;
  const p = state.actor.player;
  p.objKnown.toH = 0;
  p.objKnown.toD = 0;
  const prep = (tval: number, name: string): GameObject => {
    const kind = reg.objects.kinds.find(
      (k) => k.tval === tval && k.name.replace(/[~&]/g, "").trim().toLowerCase() === name,
    );
    if (!kind) throw new Error(`no kind ${name}`);
    const obj = objectPrep(new Rng(1), reg.objects, reg.constants, kind, 1, "minimise");
    obj.notice |= OBJ_NOTICE.ASSESSED;
    obj.number = 1;
    return obj;
  };
  const armour = prep(TV.SOFT_ARMOR, "soft leather armour");
  armour.toH = toH;
  armour.toD = toD;
  if (curse) {
    const index = state.curses.findIndex((c) => c?.name === curse);
    expect(index).toBeGreaterThan(0);
    armour.curses = state.curses.map((_, i) => ({ power: i === index ? 20 : 0, timeout: 0 }));
  }
  const bodySlot = p.body.slots.findIndex((s) => s.type === "BODY_ARMOR");
  const occupant = p.equipment[bodySlot];
  if (occupant) expect(invenTakeoff(state, occupant)).toBe(true);
  const handle = invenCarry(state.gear, p, armour, {
    quiverSlotSize: reg.constants.quiverSlotSize,
    thrownQuiverMult: reg.constants.thrownQuiverMult,
  });
  expect(wieldObject(state.gear, p, handle)).toBeGreaterThanOrEqual(0);
  state.updateBonuses!();
  const extras: ObjectInfoExtras = { projections: reg.projections ?? [], constants: reg.constants };
  return { state, extras, dagger: prep(TV.SWORD, "dagger") };
}

const describeIt = ({ state, extras, dagger }: Worn): string =>
  textblockToString(objectInfoTextblock(state, dagger, extras));

const line = (text: string, label: string): string | undefined =>
  text.split("\n").find((l) => l.startsWith(label));

describe("an item description counts only the bonuses the player has learned", () => {
  it("describes a weapon the same beside an unlearned +to-dam as beside a plain twin", () => {
    const runed = wearing(0, 9);
    const twin = wearing(0, 0);

    /* The real state carries the bonus; the description does not. */
    expect(runed.state.playerState!.toD - twin.state.playerState!.toD).toBe(9);
    const text = describeIt(runed);
    expect(line(text, "Average damage/round:")).toBeDefined();
    expect(text).toBe(describeIt(twin));

    /* Once the player learns the rune, the weapon's melee damage moves. */
    playerLearnCombat(runed.state.actor.player, runed.state.runeEnv, "toD", false);
    runed.state.updateBonuses!();
    const damage = (t: string) => Number(/Average damage\/round: (\d+(?:\.\d+)?)/.exec(t)?.[1]);
    expect(damage(describeIt(runed))).toBeGreaterThan(damage(describeIt(twin)));
  });

  it("leaves the melee lines alone for an unlearned +to-hit, and the thrown line reads the real state as upstream does", () => {
    const runed = wearing(20, 0);
    const twin = wearing(0, 0);
    expect(runed.state.playerState!.toH - twin.state.playerState!.toH).toBe(20);
    const text = describeIt(runed);
    const plain = describeIt(twin);
    expect(line(text, "Average damage/round:")).toBe(line(plain, "Average damage/round:"));
    expect(line(text, "1.3 blows")).toBe(line(plain, "1.3 blows"));
    /* calculate_missile_crits(&player->state, ...) (obj-info.c:1087) takes the
       thrown crit chance from player->state.to_h, the real state, so 4.2.6's
       own text moves here. */
    expect(line(text, "Average thrown damage:")).not.toBe(line(plain, "Average thrown damage:"));

    playerLearnCombat(runed.state.actor.player, runed.state.runeEnv, "toH", false);
    runed.state.updateBonuses!();
    expect(line(describeIt(runed), "Average damage/round:")).not.toBe(line(plain, "Average damage/round:"));
  });

  it("counts a worn item's curse in a weapon's blows, as calc_bonuses does", () => {
    /* The strength rune is learned on both sides, so the curse's STR[-10]
       counts on the known pass too. */
    const strength = (w: Worn): Worn => {
      w.state.actor.player.objKnown.modifiers[STAT.STR] = 1;
      w.state.updateBonuses!();
      return w;
    };
    const cursed = describeIt(strength(wearing(0, 0, "weakness")));
    const plain = describeIt(strength(wearing(0, 0)));
    expect(line(cursed, "Combat info:")).toBeDefined();
    expect(cursed).not.toBe(plain);
  });
});
