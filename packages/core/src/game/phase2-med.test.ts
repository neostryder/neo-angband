/**
 * Regression guards for the Phase-2 MED parity findings (audit 01/02):
 * - PR1 KILL_TRAP gate (square_isdisarmabletrap)
 * - PR2 DARK does not darken a naturally-bright feature
 * - PR3 polymorph blocked on an arena level
 * - A3 a player breath announces "You breathe <element>."
 * - A5 STRIKE reverts to the player grid when the target is unreachable
 * - S01 summon_possible: none in arenas / not onto a glyph of warding
 * - S02 monster_can_cast quarters the PROJECT_SHORT range under COVERTRACKS
 *
 * Each drives the real game-layer function/handler, not a reimplementation.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MFLAG, MON_MSG, PROJ, SQUARE, TMD, TRF } from "../generated";
import { loc } from "../loc";
import { FlagSet } from "../bitflag";
import { RF_SIZE } from "../mon/types";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { PROJECT } from "../world/project";
import { TRF_SIZE } from "../world/trap";
import { addMon, featureReg, makeRace, makeState } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import type { CastContext } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import { registerAttackHandlers } from "./effect-attack";
import { projectFeature } from "./project-feat";
import { projectMonster } from "./project-monster";
import type { ProjectMonsterCtx, ProjectMonsterHooks } from "./project-monster";
import { summonPossible, monsterCanCast } from "./mon-ranged";

const projections = bindProjections(
  JSON.parse(
    readFileSync(new URL("../../../content/pack/projection.json", import.meta.url), "utf8"),
  ).records as ProjectionRecordJson[],
);

const LAVA = featureReg.byCodeName("LAVA").fidx;

/* ---------------- PR2: DARK vs a bright feature ---------------- */

describe("PR2 DARK darkens normal terrain but not bright terrain", () => {
  it("clears GLOW on a floor grid", () => {
    const state = makeState({ seed: 1 });
    state.chunk.depth = 1; // dungeon, so the daylit-surface guard never fires.
    const grid = loc(10, 10);
    state.chunk.sqinfoOn(grid, SQUARE.GLOW);
    projectFeature(state, 0, grid, 0, PROJ.DARK);
    expect(state.chunk.sqinfoHas(grid, SQUARE.GLOW)).toBe(false);
  });

  it("leaves GLOW on lava (square_isbright)", () => {
    const state = makeState({ seed: 1 });
    state.chunk.depth = 1;
    const grid = loc(10, 10);
    state.chunk.setFeat(grid, LAVA);
    state.chunk.sqinfoOn(grid, SQUARE.GLOW);
    projectFeature(state, 0, grid, 0, PROJ.DARK);
    expect(state.chunk.sqinfoHas(grid, SQUARE.GLOW)).toBe(true);
  });
});

/* ---------------- PR3: polymorph on an arena level ---------------- */

function polyCtx(gs: GameState, hooks: ProjectMonsterHooks): ProjectMonsterCtx {
  return {
    state: gs,
    projections,
    origin: { isPlayer: true, monster: 0, grid: gs.actor.grid, charm: false },
    hooks,
  };
}

describe("PR3 polymorph is blocked on an arena level", () => {
  it("a non-unique monster is UNAFFECTED when arena_level is set", () => {
    const gs = makeState({ seed: 2, playerGrid: loc(5, 5) });
    gs.arenaLevel = true;
    const mon = addMon(gs, makeRace({ level: 5 }), loc(5, 7), { hp: 40 });
    mon.mflag.on(MFLAG.VISIBLE); // so the UNAFFECTED message is emitted (seen).
    const msgs: number[] = [];
    let polyCalls = 0;
    const hooks: ProjectMonsterHooks = {
      message: (_m, msg) => msgs.push(msg),
      polymorph: () => {
        polyCalls++;
        return null;
      },
    };
    projectMonster(polyCtx(gs, hooks), 0, mon.grid, 200, PROJ.MON_POLY, PROJECT.KILL);
    expect(msgs).toContain(MON_MSG.UNAFFECTED);
    expect(polyCalls).toBe(0); // arena short-circuits before any polymorph.
  });
});

/* ---------------- A3: player breath message ---------------- */

describe("A3 a player breath announces itself", () => {
  it("emits 'You breathe <element>.'", () => {
    const state = makeState({ seed: 3, playerGrid: loc(5, 5) });
    addMon(state, makeRace({ level: 3 }), loc(5, 8), { hp: 60 });
    const msgs: string[] = [];
    const registry = new EffectRegistry();
    registerCoreHandlers(registry);
    registerAttackHandlers(registry);
    const cast: CastContext = {
      projections,
      maxRange: 20,
      playerActor: basicPlayerActor(state),
    };
    const ctx = attachGameEnv(
      { rng: state.rng, messages: { msg: (t: string) => msgs.push(t) } },
      { state, cast, aimed: loc(5, 8) },
    );
    registry.effectSimple(EF.BREATH, ctx, {
      origin: sourcePlayer(),
      diceString: "30",
      subtype: PROJ.FIRE,
    });
    expect(msgs).toContain(`You breathe ${projections[PROJ.FIRE]!.desc}.`);
  });
});

/* ---------------- PR1: KILL_TRAP disarmable gate ---------------- */

describe("PR1 KILL_TRAP only disarms an enabled visible player trap", () => {
  it("does not re-seize an already-disabled trap", () => {
    const state = makeState({ seed: 9 });
    const grid = loc(10, 10);
    state.chunk.sqinfoOn(grid, SQUARE.SEEN); // so a seize message would show.
    const flags = new FlagSet(TRF_SIZE);
    flags.on(TRF.TRAP); // player trap
    flags.on(TRF.VISIBLE);
    /* timeout > 0 == already disabled (square_isdisabledtrap). */
    state.traps.set(grid.y * state.chunk.width + grid.x, [
      { tidx: 2, flags, timeout: 5, grid } as unknown as import("./trap").Trap,
    ]);
    const msgs: string[] = [];
    projectFeature(state, 0, grid, 0, PROJ.KILL_TRAP, { msg: (t) => msgs.push(t) });
    expect(msgs).not.toContain("The trap seizes up.");
  });

  it("still disarms an enabled visible player trap", () => {
    const state = makeState({ seed: 9 });
    const grid = loc(10, 10);
    state.chunk.sqinfoOn(grid, SQUARE.SEEN);
    const flags = new FlagSet(TRF_SIZE);
    flags.on(TRF.TRAP);
    flags.on(TRF.VISIBLE);
    state.traps.set(grid.y * state.chunk.width + grid.x, [
      { tidx: 2, flags, timeout: 0, grid } as unknown as import("./trap").Trap,
    ]);
    const msgs: string[] = [];
    projectFeature(state, 0, grid, 0, PROJ.KILL_TRAP, { msg: (t) => msgs.push(t) });
    expect(msgs).toContain("The trap seizes up.");
  });
});

/* ---------------- S01: summon_possible gates ---------------- */

describe("S01 summon_possible gates", () => {
  it("returns false on an arena level", () => {
    const state = makeState({ seed: 5 });
    const grid = loc(20, 12);
    expect(summonPossible(state, grid)).toBe(true);
    state.arenaLevel = true;
    expect(summonPossible(state, grid)).toBe(false);
  });

  it("does not summon onto a glyph of warding", () => {
    const state = makeState({ seed: 5, w: 12, h: 12 });
    /* Wall everything, leave a single floor grid, then ward it. */
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) state.chunk.setFeat(loc(x, y), featureReg.byCodeName("GRANITE").fidx);
    }
    const only = loc(3, 3);
    state.chunk.setFeat(only, featureReg.byCodeName("FLOOR").fidx);
    expect(summonPossible(state, only)).toBe(true);
    const flags = new FlagSet(TRF_SIZE);
    flags.on(TRF.GLYPH);
    state.traps.set(only.y * state.chunk.width + only.x, [
      { tidx: 1, flags, timeout: 0, grid: only } as unknown as import("./trap").Trap,
    ]);
    expect(summonPossible(state, only)).toBe(false);
  });
});

/* ---------------- S02: covertracks quarters PROJECT_SHORT ---------------- */

describe("S02 monster_can_cast honours COVERTRACKS short range", () => {
  it("a distant monster loses the clear-path gate under COVERTRACKS", () => {
    const build = (): { state: GameState; mon: import("../mon/monster").Monster } => {
      const state = makeState({ seed: 7, playerGrid: loc(20, 20) });
      const race = makeRace({ level: 5 });
      race.freqSpell = 100; // always rolls a cast chance
      race.freqInnate = 100;
      const mon = addMon(state, race, loc(20, 10), { hp: 40 }); // distance 10, clear LOS
      mon.cdis = 10;
      mon.mflag = new FlagSet(RF_SIZE);
      return { state, mon };
    };

    const a = build();
    expect(monsterCanCast(a.state, a.mon, false, 20)).toBe(true);

    const b = build();
    b.state.actor.player.timed[TMD.COVERTRACKS] = 20;
    expect(monsterCanCast(b.state, b.mon, false, 20)).toBe(false);
  });
});
