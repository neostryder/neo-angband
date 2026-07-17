import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELEM, PROJ, SQUARE, TV } from "../generated";
import { loc } from "../loc";
import { EL_INFO_HATES } from "../obj/types";
import type { ObjPackJson, ObjectKind } from "../obj/types";
import { ObjRegistry } from "../obj/bind";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import { makeState } from "./harness";
import { floorCarry, floorPile } from "./floor";
import { gearAdd } from "./gear";
import { invenDamage, projectObject } from "./project-obj";

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

/** A real object of the first kind with `tval`, optionally hating elements. */
function makeObj(tval: number, hates: number[] = []): GameObject {
  const kind = reg.kinds.find((k) => k.tval === tval);
  if (!kind) throw new Error(`no kind with tval ${tval}`);
  const obj = objectNew(kind as ObjectKind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.number = 1;
  for (const e of hates) obj.elInfo[e]!.flags |= EL_INFO_HATES;
  return obj;
}

describe("inven_damage gear_to_label lettering (project-obj.c L143, gap 6.12)", () => {
  it("labels a destroyed pack item with its listing letter", () => {
    const state = makeState();
    const potion = makeObj(TV.POTION, [ELEM.FIRE]);
    state.gear.pack.push(gearAdd(state.gear, potion)); /* first pack slot -> 'a' */

    const msgs: string[] = [];
    const killed = invenDamage(state, ELEM.FIRE, 10000, {
      msg: (t) => msgs.push(t),
    });
    expect(killed).toBe(1);
    expect(msgs.some((m) => m.includes("(a)"))).toBe(true);
  });

  it("uses the quiver slot digit (I2D) for a quiver handle", () => {
    const state = makeState();
    const ammo = makeObj(TV.POTION, [ELEM.FIRE]);
    const handle = gearAdd(state.gear, ammo);
    state.gear.pack.push(handle);
    state.gear.quiver = [handle]; /* now assigned quiver slot 0 -> '0' */

    const msgs: string[] = [];
    invenDamage(state, ELEM.FIRE, 10000, { msg: (t) => msgs.push(t) });
    expect(msgs.some((m) => m.includes("(0)"))).toBe(true);
  });
});

describe("project_o honours ignore_item_ok (project-obj.c L546-569, gap 6.12)", () => {
  function burnable() {
    const state = makeState();
    const grid = loc(5, 5);
    state.chunk.sqinfoOn(grid, SQUARE.SEEN);
    const obj = makeObj(TV.SCROLL, [ELEM.FIRE]);
    floorCarry(state, grid, obj);
    return { state, grid, obj };
  }

  it("still destroys an ignored object but shows no message and is not obvious", () => {
    const { state, grid, obj } = burnable();
    state.isIgnored = () => true;
    const msgs: string[] = [];
    const obvious = projectObject(state, 0, grid, 20, PROJ.FIRE, {
      msg: (t) => msgs.push(t),
    });
    expect(floorPile(state, grid)).not.toContain(obj); /* destroyed regardless */
    expect(msgs).toEqual([]);
    expect(obvious).toBe(false);
  });

  it("a non-ignored object burns with a message and is obvious", () => {
    const { state, grid, obj } = burnable();
    state.isIgnored = () => false;
    const msgs: string[] = [];
    const obvious = projectObject(state, 0, grid, 20, PROJ.FIRE, {
      msg: (t) => msgs.push(t),
    });
    expect(floorPile(state, grid)).not.toContain(obj);
    expect(msgs.length).toBe(1);
    expect(obvious).toBe(true);
  });

  it("suppresses the 'unaffected' message for an ignored artifact", () => {
    const state = makeState();
    const grid = loc(5, 5);
    state.chunk.sqinfoOn(grid, SQUARE.SEEN);
    const art = makeObj(TV.SWORD, [ELEM.FIRE]);
    art.artifact = { aidx: 1 } as GameObject["artifact"];
    floorCarry(state, grid, art);
    state.isIgnored = () => true;

    const msgs: string[] = [];
    projectObject(state, 0, grid, 20, PROJ.FIRE, { msg: (t) => msgs.push(t) });
    expect(floorPile(state, grid)).toContain(art); /* artifact resists */
    expect(msgs).toEqual([]); /* but no "unaffected!" while ignored */
  });
});

describe("KILL_TRAP chest unlock honours ignore_item_ok (project-obj.c L363-364)", () => {
  function lockedChest(ignored: boolean) {
    const state = makeState();
    const grid = loc(5, 5);
    state.chunk.sqinfoOn(grid, SQUARE.SEEN);
    const chest = makeObj(TV.CHEST);
    chest.pval = 5; /* locked */
    floorCarry(state, grid, chest);
    state.isIgnored = () => ignored;
    const msgs: string[] = [];
    projectObject(state, 0, grid, 0, PROJ.KILL_TRAP, { msg: (t) => msgs.push(t) });
    return { chest, msgs };
  }

  it("clicks when the chest is not ignored", () => {
    const { chest, msgs } = lockedChest(false);
    expect(chest.pval).toBe(-5); /* unlocked either way */
    expect(msgs).toContain("Click!");
  });

  it("stays silent for an ignored chest (still unlocked)", () => {
    const { chest, msgs } = lockedChest(true);
    expect(chest.pval).toBe(-5);
    expect(msgs).not.toContain("Click!");
  });
});
