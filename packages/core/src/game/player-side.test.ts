import { describe, expect, it } from "vitest";
import { ELEM, OF, PROJ, TMD, TV } from "../generated";
import { loc } from "../loc";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import type { ObjectKind } from "../obj/types";
import { makeState, plReg } from "./harness";
import type { GameState } from "./context";
import type { PlayerProjActor, ProjectPlayerSideContext } from "./project-player";
import { makePlayerSideEffects } from "./player-side";
import type { PlayerSideDeps } from "./player-side";

/** A stub projection actor whose resists the test controls. */
function stubActor(resists: Partial<Record<number, number>> = {}): PlayerProjActor {
  return {
    resistLevel: (t: number) => resists[t] ?? 0,
  } as PlayerProjActor;
}

function sideFx(
  state: GameState,
  opts: { resists?: Partial<Record<number, number>>; msgs?: string[] } = {},
): (ctx: Omit<ProjectPlayerSideContext, "origin" | "r" | "grid" | "obvious">) => number {
  const deps: PlayerSideDeps = {
    timed: plReg.timed,
    actor: stubActor(opts.resists),
    projections: [],
    expDeps: { rng: state.rng },
    lifeDrainPercent: 2,
    ...(opts.msgs ? { msg: (t: string) => opts.msgs!.push(t) } : {}),
  };
  const hook = makePlayerSideEffects(state, deps);
  return (ctx) =>
    hook({
      origin: { isPlayer: false, isMonster: true, killer: "a test" },
      r: 0,
      grid: loc(1, 1),
      obvious: true,
      ...ctx,
    });
}

/** Equip a synthetic item carrying an OF flag. */
function equipWithFlag(state: GameState, flag: number): void {
  const kind = {
    kidx: 77,
    tval: TV.SOFT_ARMOR,
    name: "Vest",
    toH: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    base: { maxStack: 40 },
  } as unknown as ObjectKind;
  const obj: GameObject = objectNew(kind);
  obj.flags.on(flag);
  const handle = 91;
  state.gear.store.set(handle, obj);
  state.actor.player.equipment[0] = handle;
}

describe("project-player side effects (project-player.c handlers)", () => {
  it("WATER confuses and stuns unconditionally", () => {
    const state = makeState({ seed: 21 });
    sideFx(state)({ dam: 30, typ: PROJ.WATER, power: 0 });
    const p = state.actor.player;
    expect(p.timed[TMD.CONFUSED]!).toBeGreaterThan(0);
    expect(p.timed[TMD.STUN]!).toBeGreaterThan(0);
  });

  it("SHARD cuts unless resisted", () => {
    const state = makeState({ seed: 22 });
    sideFx(state)({ dam: 40, typ: PROJ.SHARD, power: 0 });
    expect(state.actor.player.timed[TMD.CUT]!).toBeGreaterThan(0);

    const resisted = makeState({ seed: 22 });
    const msgs: string[] = [];
    sideFx(resisted, { resists: { [ELEM.SHARD]: 1 }, msgs })({
      dam: 40,
      typ: PROJ.SHARD,
      power: 0,
    });
    expect(resisted.actor.player.timed[TMD.CUT]!).toBe(0);
    expect(msgs).toContain("You resist the effect!");
  });

  it("SOUND stuns, but protection prevents it and teaches the rune", () => {
    const state = makeState({ seed: 23 });
    sideFx(state)({ dam: 60, typ: PROJ.SOUND, power: 0 });
    expect(state.actor.player.timed[TMD.STUN]!).toBeGreaterThan(0);

    const prot = makeState({ seed: 23 });
    equipWithFlag(prot, OF.PROT_STUN);
    sideFx(prot)({ dam: 60, typ: PROJ.SOUND, power: 0 });
    expect(prot.actor.player.timed[TMD.STUN]!).toBe(0);
    expect(prot.actor.player.objKnown.flags.has(OF.PROT_STUN)).toBe(true);
  });

  it("NETHER drains experience unless HOLD_LIFE resists (and is learned)", () => {
    const state = makeState({ seed: 24 });
    const p = state.actor.player;
    p.exp = 1000;
    p.maxExp = 1000;
    p.lev = 11;
    sideFx(state)({ dam: 50, typ: PROJ.NETHER, power: 0 });
    expect(p.exp).toBeLessThan(1000);

    const held = makeState({ seed: 24 });
    const hp = held.actor.player;
    hp.exp = 1000;
    hp.maxExp = 1000;
    hp.lev = 11;
    equipWithFlag(held, OF.HOLD_LIFE);
    sideFx(held)({ dam: 50, typ: PROJ.NETHER, power: 0 });
    expect(hp.exp).toBe(1000);
    expect(hp.objKnown.flags.has(OF.HOLD_LIFE)).toBe(true);
  });

  it("INERTIA slows; CHAOS hallucinates and confuses", () => {
    const state = makeState({ seed: 25 });
    sideFx(state)({ dam: 20, typ: PROJ.INERTIA, power: 0 });
    expect(state.actor.player.timed[TMD.SLOW]!).toBeGreaterThan(0);

    const chaos = makeState({ seed: 26 });
    chaos.actor.player.exp = 0; /* nothing to drain */
    sideFx(chaos)({ dam: 20, typ: PROJ.CHAOS, power: 0 });
    expect(chaos.actor.player.timed[TMD.IMAGE]!).toBeGreaterThan(0);
    expect(chaos.actor.player.timed[TMD.CONFUSED]!).toBeGreaterThan(0);
  });

  it("TIME saps the character (exp or stats) under the seeded roll", () => {
    const state = makeState({ seed: 27 });
    const p = state.actor.player;
    p.exp = 500;
    p.maxExp = 500;
    p.lev = 11;
    for (let i = 0; i < 5; i++) {
      p.statCur[i] = 12;
      p.statMax[i] = 12;
    }
    const expBefore = p.exp;
    const statsBefore = [...p.statCur];
    sideFx(state)({ dam: 30, typ: PROJ.TIME, power: 0 });
    const drained =
      p.exp < expBefore || p.statCur.some((v, i) => v < (statsBefore[i] ?? 0));
    expect(drained).toBe(true);
  });
});
