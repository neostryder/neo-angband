/**
 * WP-15 (unported commands), ported from Angband 4.2.6 reference/src:
 * - do_cmd_feeling / display_feeling (cmd-cave.c:1687-1780): the level-feeling
 *   text, town line, monster-only line below feeling_need, the joined line with
 *   the exact ", and" / ", yet" conjunction rule, birth_feelings gating, and the
 *   objOnly (display_feeling(true)) branch.
 * - do_cmd_jump (cmd-cave.c:1319): walk-into-a-trap steps onto the target grid.
 * - do_cmd_fire_at_nearest (player-attack.c:1412): requires a launcher, picks
 *   the first quiver ammo, targets the closest foe, and fires.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, TV } from "../generated";
import { loc } from "../loc";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson, ObjectKind } from "../obj/types";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import { displayFeeling } from "./cave-cmd";
import { createDefaultRegistry } from "./player-turn";
import { installRangedCommands } from "./ranged-cmd";
import { gearAdd } from "./gear";
import type { GameState } from "./context";
import { addMon, makeRace, makeState } from "./harness";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

const objReg = new ObjRegistry({
  objectBase: load("object_base"),
  object: load("object"),
  egoItem: load("ego_item"),
  artifact: load("artifact"),
  curse: load("curse"),
  brand: load("brand"),
  slay: load("slay"),
  activation: load("activation"),
  objectProperty: load("object_property"),
  flavor: load("flavor"),
} as ObjPackJson);

function bareObject(tval: number): GameObject {
  const kind = objReg.kinds.find(
    (kk): kk is ObjectKind => kk !== null && kk.tval === tval,
  );
  if (!kind) throw new Error(`no kind for tval ${tval}`);
  const o = objectNew(kind);
  o.tval = kind.tval;
  o.sval = kind.sval;
  o.dd = kind.dd;
  o.ds = kind.ds;
  o.weight = kind.weight;
  o.number = 1;
  return o;
}

function collectMsgs(state: GameState): string[] {
  const out: string[] = [];
  state.msg = (t: string): void => {
    out.push(t);
  };
  return out;
}

describe("do_cmd_feeling / display_feeling (cmd-cave.c:1729)", () => {
  it("gives the fixed town line at depth 0", () => {
    const state = makeState();
    state.chunk.depth = 0;
    const msgs = collectMsgs(state);
    displayFeeling(state);
    expect(msgs).toEqual(["Looks like a typical town."]);
  });

  it("shows only the monster feeling below feeling_need", () => {
    const state = makeState();
    state.chunk.depth = 5;
    state.chunk.feelingSquares = 3; // < feelingNeed (10)
    // feeling = obj*10 + mon; mon = 4 -> "You feel anxious about this place".
    state.chunk.feeling = 4 * 10 + 4;
    const msgs = collectMsgs(state);
    displayFeeling(state, { feelingNeed: 10 });
    expect(msgs).toEqual(["You feel anxious about this place."]);
  });

  it("joins mon + obj with ', and' when both agree in tone", () => {
    const state = makeState();
    state.chunk.depth = 5;
    state.chunk.feelingSquares = 20; // >= feelingNeed
    // obj = 2 (<=6), mon = 2 (<=5): neither cross condition -> ", and".
    state.chunk.feeling = 2 * 10 + 2;
    const msgs = collectMsgs(state);
    displayFeeling(state, { feelingNeed: 10 });
    expect(msgs).toEqual([
      "This place seems murderous, and there are superb treasures here.",
    ]);
  });

  it("joins with ', yet' when mon<=5 but obj>6", () => {
    const state = makeState();
    state.chunk.depth = 5;
    state.chunk.feelingSquares = 20;
    // obj = 8 (>6), mon = 3 (<=5) -> ", yet".
    state.chunk.feeling = 8 * 10 + 3;
    const msgs = collectMsgs(state);
    displayFeeling(state, { feelingNeed: 10 });
    expect(msgs).toEqual([
      "This place seems terribly dangerous, yet there aren't many treasures here.",
    ]);
  });

  it("says nothing when birth_feelings is off (cold-hearted)", () => {
    const state = makeState();
    state.chunk.depth = 5;
    state.options = { get: (n: string) => (n === "birth_feelings" ? false : undefined) } as never;
    const msgs = collectMsgs(state);
    displayFeeling(state);
    expect(msgs).toEqual([]);
  });

  it("objOnly emits the 'You feel that ...' object line (display_feeling(true))", () => {
    const state = makeState();
    state.chunk.depth = 5;
    state.chunk.feeling = 2 * 10 + 4; // obj = 2
    const msgs = collectMsgs(state);
    displayFeeling(state, { objOnly: true });
    expect(msgs).toEqual(["You feel that there are superb treasures here."]);
  });
});

describe("do_cmd_jump (cmd-cave.c:1319)", () => {
  it("is registered and steps the player onto the target grid", () => {
    const state = makeState();
    const reg = createDefaultRegistry();
    const jump = reg.get("jump");
    expect(jump).toBeTruthy();
    const start = { ...state.actor.grid };
    const used = jump!(state, { code: "jump", dir: 6 }); // east
    expect(used).toBeGreaterThan(0);
    expect(state.actor.grid).toEqual(loc(start.x + 1, start.y));
  });
});

describe("do_cmd_fire_at_nearest (player-attack.c:1412)", () => {
  function armArcher(state: GameState): void {
    const p = state.actor.player;
    const bow = bareObject(TV.BOW);
    const bowHandle = gearAdd(state.gear, bow);
    const bowSlot = p.body.slots.findIndex((s) => s.type === "BOW");
    p.equipment[bowSlot] = bowHandle;

    const arrows = bareObject(TV.ARROW);
    arrows.number = 10;
    const handle = gearAdd(state.gear, arrows);
    state.gear.quiver = [handle]; // the computed quiver view (WP-4 subsystem)

    state.actor.combat.ammoTval = TV.ARROW;
    state.actor.combat.numShots = 20;
  }

  it("targets the nearest foe and fires (monster takes a hit)", () => {
    const state = makeState();
    armArcher(state);
    const race = makeRace();
    const mon = addMon(state, race, loc(state.actor.grid.x + 3, state.actor.grid.y), {
      hp: 500,
    });
    mon.mflag.on(MFLAG.VISIBLE);
    const before = mon.hp;

    const reg = createDefaultRegistry();
    installRangedCommands(reg);
    const used = reg.get("fire-at-nearest")!(state, { code: "fire-at-nearest" });

    expect(used).toBeGreaterThan(0);
    expect(mon.hp).toBeLessThan(before);
    expect(state.target.set).toBe(true);
    expect(state.target.midx).toBe(mon.midx);
  });

  it("does nothing without a launcher", () => {
    const state = makeState();
    const msgs = collectMsgs(state);
    const reg = createDefaultRegistry();
    installRangedCommands(reg);
    const used = reg.get("fire-at-nearest")!(state, { code: "fire-at-nearest" });
    expect(used).toBe(0);
    expect(msgs).toContain("You have nothing to fire with.");
  });

  it("spends no turn when there is no visible target", () => {
    const state = makeState();
    armArcher(state);
    const reg = createDefaultRegistry();
    installRangedCommands(reg);
    const used = reg.get("fire-at-nearest")!(state, { code: "fire-at-nearest" });
    expect(used).toBe(0);
  });
});
