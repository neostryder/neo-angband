import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELEM, FEAT, PROJ, SQUARE, TRF, TV } from "../generated";
import { loc } from "../loc";
import { EL_INFO_HATES, EL_INFO_IGNORE } from "../obj/types";
import type { ObjectKind } from "../obj/types";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import { bindTraps, lookupTrap } from "../world/trap";
import type { TrapRecordJson } from "../world/trap";
import { makeState } from "./harness";
import { floorCarry, floorPile } from "./floor";
import { gearAdd } from "./gear";
import { placeTrap, squareTrap } from "./trap";
import type { TrapDeps } from "./trap";
import { invenDamage, projectObject } from "./project-obj";
import { projectFeature } from "./project-feat";

const trapKinds = bindTraps(
  (
    JSON.parse(
      readFileSync(
        new URL("../../../content/pack/trap.json", import.meta.url),
        "utf8",
      ),
    ) as { records: TrapRecordJson[] }
  ).records,
);
const trapDeps: TrapDeps = { kinds: trapKinds };

/** A bare object of a synthetic kind, optionally hating an element. */
let nextKidx = 1;
function makeObj(
  tval: number,
  hates: number[] = [],
  ignores: number[] = [],
): GameObject {
  const kind = {
    kidx: nextKidx++,
    tval,
    name: "Widget",
    toH: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    base: { maxStack: 40 },
  } as unknown as ObjectKind;
  const obj = objectNew(kind);
  obj.tval = tval;
  for (const e of hates) obj.elInfo[e]!.flags |= EL_INFO_HATES;
  for (const e of ignores) obj.elInfo[e]!.flags |= EL_INFO_IGNORE;
  return obj;
}

describe("project_o (project-obj.c)", () => {
  it("fire burns a flammable floor object and spares an ignoring one", () => {
    const state = makeState();
    const grid = loc(5, 5);
    const burns = makeObj(TV.SCROLL, [ELEM.FIRE]);
    const proofed = makeObj(TV.SCROLL, [ELEM.FIRE], [ELEM.FIRE]);
    floorCarry(state, grid, burns);
    floorCarry(state, grid, proofed);

    projectObject(state, 0, grid, 20, PROJ.FIRE);
    const left = floorPile(state, grid);
    expect(left).toContain(proofed);
    expect(left).not.toContain(burns);
  });

  it("an artifact resists, and unrelated projections leave the pile alone", () => {
    const state = makeState();
    const grid = loc(5, 5);
    const art = makeObj(TV.SWORD, [ELEM.FIRE]);
    art.artifact = { aidx: 1 } as GameObject["artifact"];
    floorCarry(state, grid, art);

    projectObject(state, 0, grid, 20, PROJ.FIRE);
    expect(floorPile(state, grid)).toContain(art);

    const potion = makeObj(TV.POTION, [ELEM.COLD]);
    floorCarry(state, grid, potion);
    projectObject(state, 0, grid, 20, PROJ.NEXUS);
    expect(floorPile(state, grid)).toContain(potion);
  });

  it("mana destroys anything", () => {
    const state = makeState();
    const grid = loc(6, 6);
    const sturdy = makeObj(TV.SWORD);
    floorCarry(state, grid, sturdy);
    projectObject(state, 0, grid, 20, PROJ.MANA);
    expect(floorPile(state, grid)).toHaveLength(0);
  });
});

describe("inven_damage (project-obj.c L42)", () => {
  it("destroys vulnerable pack items and damages weapons instead", () => {
    const state = makeState();
    const player = state.actor.player;

    const potion = makeObj(TV.POTION, [ELEM.FIRE]);
    potion.number = 3;
    const sword = makeObj(TV.SWORD, [ELEM.FIRE]);
    sword.toH = 2;
    sword.toD = 2;
    const safe = makeObj(TV.POTION); /* does not hate fire */
    for (const o of [potion, sword, safe]) {
      state.gear.pack.push(gearAdd(state.gear, o));
    }

    /* cperc 10000 = a certain roll for every item. */
    const killed = invenDamage(state, ELEM.FIRE, 10000);

    expect(killed).toBe(3); /* the whole potion stack */
    expect([...state.gear.store.values()]).not.toContain(potion);
    /* The sword is damaged, not destroyed. */
    expect([...state.gear.store.values()]).toContain(sword);
    expect(sword.toH).toBe(1);
    expect(sword.toD).toBe(1);
    /* The fireproof potion is untouched. */
    expect([...state.gear.store.values()]).toContain(safe);
    expect(player.chp).toBe(player.chp); /* no player side effects here */
  });

  it("no chance means no damage", () => {
    const state = makeState();
    const potion = makeObj(TV.POTION, [ELEM.FIRE]);
    state.gear.pack.push(gearAdd(state.gear, potion));
    expect(invenDamage(state, ELEM.FIRE, 0)).toBe(0);
    expect([...state.gear.store.values()]).toContain(potion);
  });
});

describe("project_f (project-feat.c)", () => {
  it("LIGHT_WEAK lights the grid; DARK_WEAK darkens it", () => {
    const state = makeState();
    const grid = loc(4, 4);
    projectFeature(state, 0, grid, 0, PROJ.LIGHT_WEAK);
    expect(state.chunk.sqinfoHas(grid, SQUARE.GLOW)).toBe(true);
    projectFeature(state, 0, grid, 0, PROJ.DARK_WEAK);
    expect(state.chunk.sqinfoHas(grid, SQUARE.GLOW)).toBe(false);
  });

  it("KILL_WALL melts granite but never permanent rock", () => {
    const state = makeState();
    const wall = loc(1, 1); /* the field's granite border */
    expect(state.chunk.isGranite(wall)).toBe(false); /* interior is floor */
    state.chunk.setFeat(wall, FEAT.GRANITE);
    projectFeature(state, 0, wall, 100, PROJ.KILL_WALL);
    expect(state.chunk.isFloor(wall)).toBe(true);

    state.chunk.setFeat(wall, FEAT.PERM);
    projectFeature(state, 0, wall, 100, PROJ.KILL_WALL);
    expect(state.chunk.isPerm(wall)).toBe(true);
  });

  it("KILL_DOOR and KILL_WALL destroy doors", () => {
    const state = makeState();
    const a = loc(3, 3);
    const b = loc(4, 3);
    state.chunk.setFeat(a, FEAT.CLOSED);
    state.chunk.setFeat(b, FEAT.CLOSED);
    projectFeature(state, 0, a, 0, PROJ.KILL_DOOR);
    expect(state.chunk.isFloor(a)).toBe(true);
    projectFeature(state, 0, b, 0, PROJ.KILL_WALL);
    expect(state.chunk.isFloor(b)).toBe(true);
  });

  it("MAKE_DOOR creates a closed door and pushes objects aside", () => {
    const state = makeState();
    const grid = loc(8, 8);
    const obj = makeObj(TV.POTION);
    floorCarry(state, grid, obj);

    projectFeature(state, 0, grid, 0, PROJ.MAKE_DOOR);
    expect(state.chunk.isClosedDoor(grid)).toBe(true);
    expect(floorPile(state, grid)).toHaveLength(0);
    expect(obj.grid).not.toBeNull(); /* moved to a nearby grid */

    /* The player's own grid is refused. */
    projectFeature(state, 0, state.actor.grid, 0, PROJ.MAKE_DOOR);
    expect(state.chunk.isClosedDoor(state.actor.grid)).toBe(false);
  });

  it("KILL_TRAP seizes up a revealed trap", () => {
    const state = makeState({ seed: 11 });
    const grid = loc(7, 7);
    placeTrap(state, grid, -1, 5, trapDeps);
    for (const t of squareTrap(state, grid)) t.flags.on(TRF.VISIBLE);

    projectFeature(state, 0, grid, 0, PROJ.KILL_TRAP, { trapDeps });
    for (const t of squareTrap(state, grid)) {
      expect(t.timeout).toBe(10);
    }
  });

  it("fire clears webs and extreme heat makes lava", () => {
    const state = makeState({ seed: 3 });
    const grid = loc(9, 9);
    const web = lookupTrap(trapKinds, "web");
    expect(web).not.toBeNull();
    placeTrap(state, grid, web!.tidx, 5, trapDeps);
    expect(squareTrap(state, grid).length).toBe(1);

    /* Overwhelming damage: always beats randint1(1800) + 600. */
    projectFeature(state, 0, grid, 5000, PROJ.FIRE, { trapDeps });
    expect(squareTrap(state, grid)).toHaveLength(0);
    expect(state.chunk.isFiery(grid)).toBe(true);

    /* And intense cold solidifies it again (beats randint1(900) + 300). */
    projectFeature(state, 0, grid, 5000, PROJ.COLD, { trapDeps });
    expect(state.chunk.isFiery(grid)).toBe(false);
  });
});
