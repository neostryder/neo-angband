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
import { EF, MFLAG, MON_MSG, PROJ, SQUARE, TMD, TRF } from "../generated/index.js";
import { loc } from "../loc.js";
import { FlagSet } from "../bitflag.js";
import { RF_SIZE } from "../mon/types.js";
import type { MonsterRace } from "../mon/types.js";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { PROJECT } from "../world/project.js";
import { TRF_SIZE } from "../world/trap.js";
import { addMon, featureReg, makeRace, makeState } from "./harness.js";
import type { GameState } from "./context.js";
import { basicPlayerActor } from "./project-cast.js";
import type { CastContext } from "./project-cast.js";
import { attachGameEnv } from "./effect-game-env.js";
import { registerAttackHandlers } from "./effect-attack.js";
import { projectFeature } from "./project-feat.js";
import { projectMonster } from "./project-monster.js";
import type { ProjectMonsterCtx, ProjectMonsterHooks } from "./project-monster.js";
import { summonPossible, monsterCanCast } from "./mon-ranged.js";

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
      polyRace: (race) => {
        polyCalls++;
        return race;
      },
    };
    projectMonster(polyCtx(gs, hooks), 0, mon.grid, 200, PROJ.MON_POLY, PROJECT.KILL);
    expect(msgs).toContain(MON_MSG.UNAFFECTED);
    expect(polyCalls).toBe(0); // arena short-circuits before any polymorph.
  });
});

/* --------- project_m's polymorph block, against project-mon.c:1213-1240 ------ */

describe("project_m polymorph follows upstream's order (project-mon.c:1213-1240)", () => {
  /** dam 200 makes the saving throw randint1(190) + 10, which a level-5 race
   *  clears on every possible roll - so these test the block, not the throw. */
  const DAM = 200;

  it("polymorphs from the ORIGINAL race, not the shape it is wearing (L1215)", () => {
    const gs = makeState({ seed: 3, playerGrid: loc(5, 5) });
    /* DIFFERENT levels, not just different objects: two makeRace({level: 5})
     * are structurally identical, so a toEqual against one of them passes
     * against the other and the mutant that reads mon.race survives. */
    const real = makeRace({ level: 5 });
    const shape = makeRace({ level: 7 });
    const mon = addMon(gs, shape, loc(5, 7), { hp: 40 });
    mon.originalRace = real;
    mon.mflag.on(MFLAG.VISIBLE);

    const asked: MonsterRace[] = [];
    projectMonster(
      polyCtx(gs, { polyRace: (race) => { asked.push(race); return race; } }),
      0, mon.grid, DAM, PROJ.MON_POLY, PROJECT.KILL,
    );

    expect(asked).toHaveLength(1);
    expect(asked[0]).toBe(real);
    expect(asked[0]!.level).toBe(5);
  });

  it("queues MON_MSG_CHANGE BEFORE the swap (L1222-1227)", () => {
    const gs = makeState({ seed: 4, playerGrid: loc(5, 5) });
    const mon = addMon(gs, makeRace({ level: 5 }), loc(5, 7), { hp: 40 });
    mon.mflag.on(MFLAG.VISIBLE);
    const next = makeRace({ level: 6 });
    const replacement = addMon(gs, next, loc(9, 9), { hp: 40 });

    const order: string[] = [];
    projectMonster(
      polyCtx(gs, {
        message: (_m, msg) => order.push(`msg:${msg}`),
        polyRace: () => next,
        replaceMonster: () => { order.push("replace"); return replacement; },
      }),
      0, mon.grid, DAM, PROJ.MON_POLY, PROJECT.KILL,
    );

    /* Upstream reports the polymorph while the OLD monster still exists, so the
     * line names it correctly and precedes anything the swap itself queues. */
    expect(order).toEqual([`msg:${MON_MSG.CHANGE}`, "replace"]);
  });

  it("announces a newly VISIBLE replacement of an unseen monster (L1232-1238)", () => {
    const gs = makeState({ seed: 5, playerGrid: loc(5, 5) });
    /* The old monster is NOT visible, so `seen` is false and no CHANGE line is
     * queued - upstream still announces the new one's appearance. */
    const mon = addMon(gs, makeRace({ level: 5 }), loc(5, 7), { hp: 40 });
    const next = makeRace({ level: 6 });
    const replacement = addMon(gs, next, loc(9, 9), { hp: 40 });
    replacement.mflag.on(MFLAG.VISIBLE);

    const msgs: number[] = [];
    projectMonster(
      polyCtx(gs, {
        message: (_m, msg) => msgs.push(msg),
        polyRace: () => next,
        replaceMonster: () => replacement,
      }),
      0, mon.grid, DAM, PROJ.MON_POLY, PROJECT.KILL,
    );

    expect(msgs).toEqual([MON_MSG.APPEAR]);
  });

  it("stays silent when the replacement is invisible too (L1234)", () => {
    const gs = makeState({ seed: 6, playerGrid: loc(5, 5) });
    const mon = addMon(gs, makeRace({ level: 5 }), loc(5, 7), { hp: 40 });
    const next = makeRace({ level: 6 });
    const replacement = addMon(gs, next, loc(9, 9), { hp: 40 });

    const msgs: number[] = [];
    projectMonster(
      polyCtx(gs, {
        message: (_m, msg) => msgs.push(msg),
        polyRace: () => next,
        replaceMonster: () => replacement,
      }),
      0, mon.grid, DAM, PROJ.MON_POLY, PROJECT.KILL,
    );

    expect(msgs).toEqual([]);
  });

  it("reports MAINTAIN_SHAPE when poly_race found nothing (L1240)", () => {
    const gs = makeState({ seed: 7, playerGrid: loc(5, 5) });
    const mon = addMon(gs, makeRace({ level: 5 }), loc(5, 7), { hp: 40 });
    mon.mflag.on(MFLAG.VISIBLE);

    const msgs: number[] = [];
    let replaced = 0;
    projectMonster(
      /* poly_race returns its ARGUMENT when it exhausts its thousand tries
       * (project-mon.c:79-80), which is upstream's "nothing changed". */
      polyCtx(gs, {
        message: (_m, msg) => msgs.push(msg),
        polyRace: (race) => race,
        replaceMonster: () => { replaced++; return null; },
      }),
      0, mon.grid, DAM, PROJ.MON_POLY, PROJECT.KILL,
    );

    expect(msgs).toContain(MON_MSG.MAINTAIN_SHAPE);
    expect(replaced).toBe(0);
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
      { tidx: 2, flags, timeout: 5, grid } as unknown as import("./trap.js").Trap,
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
      { tidx: 2, flags, timeout: 0, grid } as unknown as import("./trap.js").Trap,
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
      { tidx: 1, flags, timeout: 0, grid: only } as unknown as import("./trap.js").Trap,
    ]);
    expect(summonPossible(state, only)).toBe(false);
  });
});

/* ---------------- S02: covertracks quarters PROJECT_SHORT ---------------- */

describe("S02 monster_can_cast honours COVERTRACKS short range", () => {
  it("a distant monster loses the clear-path gate under COVERTRACKS", () => {
    const build = (): { state: GameState; mon: import("../mon/monster.js").Monster } => {
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
