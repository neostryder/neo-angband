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

  it("DARK_WEAK briefly blinds, or messages when DARK is resisted (6.1)", () => {
    const state = makeState({ seed: 71 });
    sideFx(state)({ dam: 20, typ: PROJ.DARK_WEAK, power: 0 });
    expect(state.actor.player.timed[TMD.BLIND]!).toBeGreaterThan(0);

    const resisted = makeState({ seed: 71 });
    const msgs: string[] = [];
    sideFx(resisted, { resists: { [ELEM.DARK]: 1 }, msgs })({
      dam: 20,
      typ: PROJ.DARK_WEAK,
      power: 0,
    });
    expect(resisted.actor.player.timed[TMD.BLIND]!).toBe(0);
    expect(msgs).toContain("You resist the effect!");
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

  it("GRAVITY blinks a low-level player and slows them", () => {
    const state = makeState({ seed: 41 });
    const start = state.actor.grid;
    /* Level 1: randint1(127) > 1 makes the blink all but certain. */
    sideFx(state)({ dam: 20, typ: PROJ.GRAVITY, power: 0 });
    expect(
      state.actor.grid.x !== start.x || state.actor.grid.y !== start.y,
    ).toBe(true);
    expect(state.chunk.mon(state.actor.grid)).toBe(-1);
    expect(state.actor.player.timed[TMD.SLOW]!).toBeGreaterThan(0);
  });

  it("FORCE stuns and thrusts the player away from the origin", () => {
    const state = makeState({ seed: 42 });
    const start = state.actor.grid;
    const hook = makePlayerSideEffects(state, {
      timed: plReg.timed,
      actor: stubActor(),
      projections: [],
      expDeps: { rng: state.rng },
      lifeDrainPercent: 2,
    });
    hook({
      origin: {
        isPlayer: false,
        isMonster: true,
        killer: "a test",
        grid: loc(start.x, start.y - 3),
      },
      r: 0,
      grid: start,
      obvious: true,
      dam: 60,
      typ: PROJ.FORCE,
      power: 0,
    });
    expect(
      state.actor.grid.x !== start.x || state.actor.grid.y !== start.y,
    ).toBe(true);
    expect(state.chunk.mon(state.actor.grid)).toBe(-1);
    expect(state.actor.player.timed[TMD.STUN]!).toBeGreaterThan(0);
  });

  it("DISEN disenchants worn equipment unless resisted", () => {
    const state = makeState({ seed: 43 });
    /* A worn weapon with enchantment (slot 0 is WEAPON on the humanoid
     * body; the harness rune env reads the gear store). */
    const kind = {
      kidx: 78,
      tval: TV.SWORD,
      name: "Blade",
      toH: { base: 0, dice: 0, sides: 0, mBonus: 0 },
      base: { maxStack: 40 },
    } as unknown as ObjectKind;
    const sword: GameObject = objectNew(kind);
    sword.number = 1;
    sword.toH = 8;
    sword.toD = 8;
    state.gear.store.set(92, sword);
    state.actor.player.equipment[0] = 92;

    const fx = sideFx(state);
    for (let i = 0; i < 30; i++) fx({ dam: 20, typ: PROJ.DISEN, power: 0 });
    expect(sword.toH).toBeLessThan(8);

    /* Resistance blocks it entirely. */
    const safe = makeState({ seed: 43 });
    const blade: GameObject = objectNew(kind);
    blade.number = 1;
    blade.toH = 8;
    safe.gear.store.set(92, blade);
    safe.actor.player.equipment[0] = 92;
    const msgs: string[] = [];
    const rfx = sideFx(safe, { resists: { [ELEM.DISEN]: 1 }, msgs });
    for (let i = 0; i < 30; i++) rfx({ dam: 20, typ: PROJ.DISEN, power: 0 });
    expect(blade.toH).toBe(8);
    expect(msgs).toContain("You resist the effect!");
  });

  it("NEXUS scrambles and fires one of its three teleport branches", () => {
    /* Sweep seeds so each teleport branch is exercised at least once. */
    const outcomes = { to: 0, level: 0, far: 0 } as Record<string, number>;
    for (let seed = 1; seed <= 12; seed++) {
      /* A big enough field that a 200-grid teleport can score a landing
       * (the search cap is twice the largest map dimension). */
      const state = makeState({ seed, w: 120, h: 60 });
      const start = state.actor.grid;
      let levelChange = false;
      const dbg: string[] = [];
      const hook = makePlayerSideEffects(state, {
        timed: plReg.timed,
        actor: stubActor(),
        projections: [],
        expDeps: { rng: state.rng },
        lifeDrainPercent: 2,
        teleport: { changeLevel: () => (levelChange = true) },
        msg: (t) => dbg.push(t),
      });
      const casterGrid = loc(start.x + 4, start.y);
      hook({
        origin: {
          isPlayer: false,
          isMonster: true,
          killer: "a test",
          grid: casterGrid,
        },
        r: 0,
        grid: start,
        obvious: true,
        dam: 30,
        typ: PROJ.NEXUS,
        power: 0,
      });
      const moved =
        state.actor.grid.x !== start.x || state.actor.grid.y !== start.y;
      /* Every seed teleports somehow - or legitimately saves against the
       * teleport-level branch ("You avoid the effect!"). */
      const avoided = dbg.includes("You avoid the effect!");
      expect(moved || levelChange || avoided).toBe(true);
      if (levelChange) outcomes.level!++;
      else if (
        moved &&
        Math.abs(state.actor.grid.x - casterGrid.x) <= 2 &&
        Math.abs(state.actor.grid.y - casterGrid.y) <= 2
      )
        outcomes.to!++;
      else if (moved) outcomes.far!++;
    }
    expect(outcomes.to).toBeGreaterThan(0);
    expect(outcomes.far).toBeGreaterThan(0);
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

  it("EF_DRAIN_STAT (FIRE) uses the 'You feel very %s.' message (P3)", () => {
    const state = makeState({ seed: 4 });
    const p = state.actor.player;
    for (let i = 0; i < 5; i++) {
      p.statCur[i] = 15;
      p.statMax[i] = 15;
    }
    const msgs: string[] = [];
    /* Huge dam makes every randint0(dam) > 500 side-effect gate fire. */
    sideFx(state, { msgs })({ dam: 200000, typ: PROJ.FIRE, power: 90 });
    expect(msgs.some((m) => m === "You feel very weak.")).toBe(true);
    /* NOT the project_player_drain_stats phrasing. */
    expect(msgs.some((m) => m.startsWith("You're not as"))).toBe(false);
    expect(p.statCur[0]!).toBeLessThan(15);
  });

  it("EF_DRAIN_STAT respects a sustain with its own message (P3)", () => {
    const state = makeState({ seed: 4 });
    equipWithFlag(state, OF.SUST_STR);
    const p = state.actor.player;
    for (let i = 0; i < 5; i++) {
      p.statCur[i] = 15;
      p.statMax[i] = 15;
    }
    const msgs: string[] = [];
    sideFx(state, { msgs })({ dam: 200000, typ: PROJ.FIRE, power: 90 });
    expect(
      msgs.some((m) =>
        m === "You feel very weak for a moment, but the feeling passes.",
      ),
    ).toBe(true);
    expect(p.statCur[0]!).toBe(15); // STR sustained.
  });

  it("TIME's random stat drain uses 'You're not as %s...' with NO sustain (P3)", () => {
    /* Search for a seed whose TIME roll takes the project_player_drain_stats(2)
     * branch (one_in(2) false, one_in(5) false), then assert its parity. */
    const perStat = /^You're not as (strong|bright|wise|agile|hale) as you used to be\.\.\.$/;
    let hit = false;
    for (let seed = 1; seed <= 80 && !hit; seed++) {
      const state = makeState({ seed });
      equipWithFlag(state, OF.SUST_STR); // must NOT protect this path.
      const p = state.actor.player;
      p.exp = 0;
      p.maxExp = 0;
      for (let i = 0; i < 5; i++) {
        p.statCur[i] = 15;
        p.statMax[i] = 15;
      }
      const msgs: string[] = [];
      sideFx(state, { msgs })({ dam: 30, typ: PROJ.TIME, power: 0 });
      if (!msgs.some((m) => perStat.test(m))) continue;
      hit = true;
      /* The EF_DRAIN_STAT phrasing must NOT appear on this path. */
      expect(msgs.some((m) => m.startsWith("You feel very"))).toBe(false);
      /* Points drained even though STR is sustained (this path ignores sustain). */
      const total = p.statCur.reduce((a, v) => a + v, 0);
      expect(total).toBeLessThan(75);
    }
    expect(hit, "a seed should hit the TIME drain-2-stats branch").toBe(true);
  });

  it("COLD life-drain resisted by HOLD_LIFE is SILENT (P4)", () => {
    const state = makeState({ seed: 4 });
    equipWithFlag(state, OF.HOLD_LIFE);
    const p = state.actor.player;
    p.exp = 5000;
    p.maxExp = 5000;
    p.lev = 20;
    const msgs: string[] = [];
    sideFx(state, { msgs })({ dam: 200000, typ: PROJ.COLD, power: 90 });
    /* HOLD_LIFE branch prints NO "You resist the effect!" and drains no exp. */
    expect(msgs).not.toContain("You resist the effect!");
    expect(p.exp).toBe(5000);
    expect(p.objKnown.flags.has(OF.HOLD_LIFE)).toBe(true);
  });
});
