import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { FlagSet } from "../bitflag";
import { PF, TV } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { SKILL, PF_SIZE } from "../player/types";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import type { PlayerState } from "../player/calcs";
import { monsterCarry } from "../mon/make";
import { createDefaultRegistry } from "./player-turn";
import { installSteal } from "./steal";
import { addMon, makeRace, makeState } from "./harness";
import type { GameState } from "./context";

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

const objReg = new ObjRegistry(objPack);
const constants = bindConstants(loadJson("constants"));

/** A plain object of the first ordinary kind of a tval. */
function makeObj(tval: number): GameObject {
  const kind = objReg.kinds.find(
    (k) => k.tval === tval && k.kidx < objReg.ordinaryKindCount,
  );
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  return objectPrep(new Rng(9), objReg, constants, kind, 0, "average");
}

/** Give the player PF_STEAL via a minimal derived state. */
function grantSteal(state: GameState): void {
  const pflags = new FlagSet(PF_SIZE);
  pflags.on(PF.STEAL);
  state.playerState = { pflags } as unknown as PlayerState;
}

/** Run the registered "steal" action, returning energy and captured msgs. */
function runSteal(
  state: GameState,
  dir: number,
): { energy: number; msgs: string[] } {
  const msgs: string[] = [];
  const registry = createDefaultRegistry();
  installSteal(registry, { constants, msg: (t) => msgs.push(t) });
  const action = registry.get("steal");
  if (!action) throw new Error("steal action not registered");
  const energy = action(state, { code: "steal", dir });
  return { energy, msgs };
}

describe("do_cmd_steal (cmd-cave.c L1016)", () => {
  it("a PF_STEAL player lifts a held item into the pack, spending a turn", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    grantSteal(state);
    const mon = addMon(state, makeRace({ level: 5 }), loc(11, 10));
    const obj = makeObj(TV.POTION);
    monsterCarry(mon.heldObj, obj, mon.midx);

    const { energy } = runSteal(state, 6);

    expect(energy).toBe(state.z.moveEnergy);
    expect(mon.heldObj).toHaveLength(0);
    /* The stolen object now lives in the pack (default combat skills succeed). */
    expect(state.gear.pack).toHaveLength(1);
    const carried = state.gear.store.get(state.gear.pack[0]!);
    expect(carried?.kind).toBe(obj.kind);
    expect(obj.heldMIdx).toBe(0);
  });

  it("gold is added to the purse rather than the pack", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    grantSteal(state);
    const startAu = state.actor.player.au;
    const mon = addMon(state, makeRace({ level: 5 }), loc(11, 10));
    const gold = makeObj(TV.GOLD);
    gold.pval = 100;
    monsterCarry(mon.heldObj, gold, mon.midx);

    const { msgs } = runSteal(state, 6);

    expect(state.actor.player.au).toBe(startAu + 100);
    expect(state.gear.pack).toHaveLength(0);
    expect(msgs.some((m) => m.includes("gold pieces"))).toBe(true);
  });

  it("drops the stolen item near the player when it is ignored", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    grantSteal(state);
    state.isIgnored = () => true;
    const mon = addMon(state, makeRace({ level: 5 }), loc(11, 10));
    const obj = makeObj(TV.POTION);
    monsterCarry(mon.heldObj, obj, mon.midx);

    const { msgs } = runSteal(state, 6);

    /* Off the monster, not in the pack: it landed on the floor. */
    expect(mon.heldObj).toHaveLength(0);
    expect(state.gear.pack).toHaveLength(0);
    expect(msgs.some((m) => m.includes("You drop"))).toBe(true);
  });

  it("a non-PF_STEAL player just spins around (no theft)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    /* No grantSteal: playerState absent -> player_has(PF_STEAL) is false. */
    const mon = addMon(state, makeRace({ level: 5 }), loc(11, 10));
    const obj = makeObj(TV.POTION);
    monsterCarry(mon.heldObj, obj, mon.midx);

    const { energy, msgs } = runSteal(state, 6);

    expect(energy).toBe(state.z.moveEnergy);
    expect(mon.heldObj).toHaveLength(1);
    expect(msgs).toContain("You spin around.");
  });

  it("stealing at an empty grid spins around", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    grantSteal(state);

    const { energy, msgs } = runSteal(state, 6);

    expect(energy).toBe(state.z.moveEnergy);
    expect(msgs).toContain("You spin around.");
  });

  it("a missing / self direction consumes no turn", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    grantSteal(state);
    expect(runSteal(state, 5).energy).toBe(0);
  });
});
