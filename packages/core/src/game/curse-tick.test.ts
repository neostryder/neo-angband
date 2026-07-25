import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TMD, TV } from "../generated";
import { loc } from "../loc";
import { EffectRegistry } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import { bindConstants } from "../constants";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { registerAttackHandlers } from "./effect-attack";
import { registerMonsterHandlers } from "./effect-monster";
import { registerTeleportHandlers } from "./effect-teleport";
import { basicPlayerActor } from "./project-cast";
import { makeState, plReg } from "./harness";
import { processCurseTimeouts } from "./curse-tick";
import type { CurseTickDeps } from "./curse-tick";
import type { GameState } from "./context";
import { Rng } from "../rng";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

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
  loadJson<{ records: ProjectionRecordJson[] }>("projection").records,
);

/** The exact effect bundle traps / objects / curses share. */
function effectDeps(state: GameState): CurseTickDeps["effects"] {
  const registry = new EffectRegistry();
  registerCoreHandlers(registry);
  registerAttackHandlers(registry);
  registerMonsterHandlers(registry);
  registerTeleportHandlers(registry);
  return {
    registry,
    cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) },
    envDeps: { timedTable: plReg.timed },
  };
}

function curseIndexByName(name: string): number {
  const idx = reg.curses.findIndex((c) => c?.name === name);
  if (idx < 0) throw new Error(`no curse named ${name}`);
  return idx;
}

/** Equip a fresh item of `tval` in slot 0 and give it curse `curseIdx`. */
function equipCursed(
  state: GameState,
  tval: number,
  curseIdx: number,
  power: number,
  timeout: number,
): void {
  const kind = reg.kinds.find((k) => k.tval === tval);
  if (!kind) throw new Error(`no kind of tval ${tval}`);
  const obj = objectPrep(new Rng(7), reg, constants, kind, 0, "average");
  /* One curse-data slot per registered curse, powered at curseIdx. */
  obj.curses = reg.curses.map(() => ({ power: 0, timeout: 0 }));
  obj.curses[curseIdx] = { power, timeout };

  const handle = state.gear.next++;
  state.gear.store.set(handle, obj);
  state.actor.player.equipment[0] = handle;
  state.actor.player.body.count = Math.max(state.actor.player.body.count, 1);
}

describe("processCurseTimeouts (game-world.c decrease_timeouts curse loop)", () => {
  it("a live curse timeout just counts down when it has not expired", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const poison = curseIndexByName("poison");
    equipCursed(state, TV.AMULET, poison, 10, 5);
    const msgs: string[] = [];
    state.msg = (t): void => {
      msgs.push(t);
    };

    processCurseTimeouts(state, {
      curses: reg.curses,
      effects: effectDeps(state),
    });

    const data = state.gear.store.get(state.actor.player.equipment[0]!)!.curses![
      poison
    ]!;
    expect(data.timeout).toBe(4); /* 5 -> 4, no fire */
    expect(state.actor.player.timed[TMD.POISONED] ?? 0).toBe(0);
  });

  it("fires the curse effect at zero, then re-rolls the timeout (do_curse_effect)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const poison = curseIndexByName("poison"); /* TIMED_INC:POISONED, time 1d500 */
    equipCursed(state, TV.AMULET, poison, 10, 1);

    processCurseTimeouts(state, {
      curses: reg.curses,
      effects: effectDeps(state),
    });

    const data = state.gear.store.get(state.actor.player.equipment[0]!)!.curses![
      poison
    ]!;
    /* The effect ran: the player is now poisoned. */
    expect(state.actor.player.timed[TMD.POISONED] ?? 0).toBeGreaterThan(0);
    /* The timeout was re-rolled from 1d500 (1..500), never left at 0. */
    expect(data.timeout).toBeGreaterThanOrEqual(1);
    expect(data.timeout).toBeLessThanOrEqual(500);
  });

  it("prints the curse's flavour message when it has one", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    /* The "paralysis" curse carries msg:\"Your equipment grabs you!\". */
    const paralysis = curseIndexByName("paralysis");
    equipCursed(state, TV.AMULET, paralysis, 10, 1);
    const msgs: string[] = [];
    state.msg = (t): void => {
      msgs.push(t);
    };

    processCurseTimeouts(state, {
      curses: reg.curses,
      effects: effectDeps(state),
    });

    expect(msgs).toContain("Your equipment grabs you!");
  });

  it("an unpowered curse slot is left completely alone", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const poison = curseIndexByName("poison");
    equipCursed(state, TV.AMULET, poison, 0, 3); /* power 0 */

    processCurseTimeouts(state, {
      curses: reg.curses,
      effects: effectDeps(state),
    });

    const data = state.gear.store.get(state.actor.player.equipment[0]!)!.curses![
      poison
    ]!;
    expect(data.timeout).toBe(3); /* untouched */
  });
});
