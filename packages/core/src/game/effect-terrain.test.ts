import { describe, expect, it } from "vitest";
import { EF, ELEM, FEAT, MON_TMD, RF, SQUARE, TMD } from "../generated";
import { loc, locEq, locSum, DDGRID_DDD } from "../loc";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
  sourceTrap,
} from "../effects/interpreter";
import type { EffectContext, EffectPlayer } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { addMon, makeRace, makeState } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";
import { floorCarry } from "./floor";
import { objectNew } from "../obj/object";
import type { ObjectKind } from "../obj/types";
import {
  lightRoom,
  registerTerrainHandlers,
  wizLightLevel,
} from "./effect-terrain";

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerTerrainHandlers(r);
  return r;
}

/** A minimal player env backing the timed / damage sinks the handlers use. */
function playerEnv(state: GameState): EffectPlayer {
  const p = state.actor.player;
  return {
    timed: {
      timed: (i) => p.timed[i] ?? 0,
      setTimed: (i, v) => {
        p.timed[i] = v;
        return true;
      },
      incTimed: (i, v) => {
        p.timed[i] = (p.timed[i] ?? 0) + v;
        return true;
      },
      decTimed: (i, v) => {
        p.timed[i] = Math.max(0, (p.timed[i] ?? 0) - v);
        return true;
      },
      clearTimed: (i) => {
        p.timed[i] = 0;
        return true;
      },
    },
    applyDamageReduction: (dam) => dam,
    takeHit: (dam) => {
      p.chp -= dam;
    },
  };
}

function env(
  state: GameState,
  game: Partial<GameEffectEnv> = {},
  msgs?: string[],
): EffectContext {
  const base: EffectContext = {
    rng: state.rng,
    player: playerEnv(state),
    ...(msgs ? { messages: { msg: (t: string) => msgs.push(t) } } : {}),
  };
  return attachGameEnv(base, {
    state,
    cast: {
      projections: [],
      maxRange: 20,
      playerActor: basicPlayerActor(state),
    },
    ...game,
  });
}

/** Flag a rectangle as a room (like the generators do). */
function markRoom(state: GameState, x1: number, y1: number, x2: number, y2: number): void {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      state.chunk.sqinfoOn(loc(x, y), SQUARE.ROOM);
    }
  }
}

/** A synthetic floor object. */
let nextKidx = 900;
function makeObj(): ReturnType<typeof objectNew> {
  const kind = {
    kidx: nextKidx++,
    tval: 5,
    name: "Junk",
    base: { maxStack: 40 },
  } as unknown as ObjectKind;
  const obj = objectNew(kind);
  obj.number = 1;
  return obj;
}

describe("EF_RUBBLE (effect-handler-general.c L2939)", () => {
  it("drops rubble into the empty grids around the player", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    registry().effectSimple(EF.RUBBLE, env(state), { origin: sourcePlayer() });

    let rubble = 0;
    for (let d = 0; d < 8; d++) {
      const g = locSum(loc(10, 10), DDGRID_DDD[d]!);
      const feat = state.chunk.feat(g);
      if (feat === FEAT.RUBBLE || feat === FEAT.PASS_RUBBLE) rubble++;
    }
    expect(rubble).toBeGreaterThanOrEqual(1);
    expect(rubble).toBeLessThanOrEqual(3);
  });

  it("no-ops without a game env (worldless)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    registry().effectSimple(
      EF.RUBBLE,
      { rng: state.rng },
      { origin: sourcePlayer() },
    );
    for (let d = 0; d < 8; d++) {
      const g = locSum(loc(10, 10), DDGRID_DDD[d]!);
      expect(state.chunk.isFloor(g)).toBe(true);
    }
  });
});

describe("EF_GRANITE (effect-handler-general.c L2991)", () => {
  it("raises a granite wall on the originating trap's grid", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    registry().effectSimple(EF.GRANITE, env(state), {
      origin: sourceTrap({ grid: loc(5, 5) }),
    });
    expect(state.chunk.isGranite(loc(5, 5))).toBe(true);
  });

  it("does nothing for a non-trap origin", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    registry().effectSimple(EF.GRANITE, env(state), {
      origin: sourcePlayer(),
    });
    expect(state.chunk.isFloor(loc(5, 5))).toBe(true);
  });
});

describe("EF_CREATE_STAIRS (effect-handler-general.c L1975)", () => {
  it("creates down stairs in town (depth 0 forces down)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 0;
    const ran = registry().effectSimple(EF.CREATE_STAIRS, env(state), {
      origin: sourcePlayer(),
    });
    expect(ran).toBe(true);
    expect(state.chunk.isDownstairs(loc(10, 10))).toBe(true);
  });

  it("creates up stairs on the bottom level", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = state.z.maxDepth - 1;
    registry().effectSimple(EF.CREATE_STAIRS, env(state), {
      origin: sourcePlayer(),
    });
    expect(state.chunk.isUpstairs(loc(10, 10))).toBe(true);
  });

  it("refuses a non-floor grid with its message", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.setFeat(loc(10, 10), FEAT.RUBBLE);
    const msgs: string[] = [];
    const ran = registry().effectSimple(EF.CREATE_STAIRS, env(state, {}, msgs), {
      origin: sourcePlayer(),
    });
    expect(ran).toBe(false);
    expect(msgs).toContain("There is no empty floor here.");
  });

  it("pushes objects off the grid first", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 0;
    floorCarry(state, loc(10, 10), makeObj());
    registry().effectSimple(EF.CREATE_STAIRS, env(state), {
      origin: sourcePlayer(),
    });
    expect(state.chunk.isStairs(loc(10, 10))).toBe(true);
    expect(state.floor.get(10 * state.chunk.width + 10) ?? []).toHaveLength(0);
  });
});

describe("EF_LIGHT_AREA / EF_DARKEN_AREA (effect-handler-general.c L3026)", () => {
  it("lights the room around the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    markRoom(state, 8, 8, 14, 12);
    const msgs: string[] = [];
    registry().effectSimple(EF.LIGHT_AREA, env(state, {}, msgs), {
      origin: sourcePlayer(),
    });
    expect(msgs).toContain("You are surrounded by a white light.");
    expect(state.chunk.sqinfoHas(loc(8, 8), SQUARE.GLOW)).toBe(true);
    expect(state.chunk.sqinfoHas(loc(14, 12), SQUARE.GLOW)).toBe(true);
    /* Non-room grids stay dark. */
    expect(state.chunk.sqinfoHas(loc(20, 10), SQUARE.GLOW)).toBe(false);
  });

  it("lighting the room always wakes a sleeping smart monster", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    markRoom(state, 8, 8, 14, 12);
    const mon = addMon(state, makeRace({ flags: [RF.SMART] }), loc(12, 10));
    mon.mTimed[MON_TMD.SLEEP] = 100;
    lightRoom(state, loc(10, 10), true);
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0);
  });

  it("darkens the room and blinds an unresisting player caster", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    markRoom(state, 8, 8, 14, 12);
    lightRoom(state, loc(10, 10), true);
    const msgs: string[] = [];
    registry().effectSimple(EF.DARKEN_AREA, env(state, {}, msgs), {
      origin: sourcePlayer(),
    });
    expect(msgs).toContain("Darkness surrounds you.");
    expect(state.chunk.sqinfoHas(loc(8, 8), SQUARE.GLOW)).toBe(false);
    const blind = state.actor.player.timed[TMD.BLIND] ?? 0;
    expect(blind).toBeGreaterThanOrEqual(4);
    expect(blind).toBeLessThanOrEqual(8);
  });

  it("a monster-cast darkness does not blind the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    markRoom(state, 8, 8, 14, 12);
    const mon = addMon(state, makeRace(), loc(12, 10));
    registry().effectSimple(EF.DARKEN_AREA, env(state), {
      origin: sourceMonster(mon.midx),
    });
    expect(state.actor.player.timed[TMD.BLIND] ?? 0).toBe(0);
  });
});

describe("EF_LIGHT_LEVEL / EF_DARKEN_LEVEL (effect-handler-general.c L3003)", () => {
  it("lights the whole level, with the full-form message", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    registry().effectSimple(EF.LIGHT_LEVEL, env(state, {}, msgs), {
      origin: sourcePlayer(),
      diceString: "1",
    });
    expect(msgs).toContain(
      "An image of your surroundings forms in your mind...",
    );
    /* Every open grid (and its wall neighbours) glows. */
    expect(state.chunk.sqinfoHas(loc(3, 3), SQUARE.GLOW)).toBe(true);
    expect(state.chunk.sqinfoHas(loc(30, 20), SQUARE.GLOW)).toBe(true);
    expect(state.chunk.sqinfoHas(loc(1, 1), SQUARE.GLOW)).toBe(true);
  });

  it("darkens the whole level", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    wizLightLevel(state, true);
    const msgs: string[] = [];
    registry().effectSimple(EF.DARKEN_LEVEL, env(state, {}, msgs), {
      origin: sourcePlayer(),
      diceString: "1",
    });
    expect(msgs).toContain("A great blackness rolls through the dungeon...");
    expect(state.chunk.sqinfoHas(loc(3, 3), SQUARE.GLOW)).toBe(false);
    expect(state.chunk.sqinfoHas(loc(30, 20), SQUARE.GLOW)).toBe(false);
  });
});

describe("EF_DESTRUCTION (effect-handler-attack.c L1169)", () => {
  it("only shakes the ground in town", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 0;
    const mon = addMon(state, makeRace(), loc(12, 10));
    const msgs: string[] = [];
    registry().effectSimple(EF.DESTRUCTION, env(state, {}, msgs), {
      origin: sourcePlayer(),
      radius: 5,
    });
    expect(msgs).toContain("The ground shakes for a moment.");
    expect(state.monsters[mon.midx]).toBe(mon);
  });

  it("deletes monsters, destroys objects and rebuilds terrain in the circle", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    state.chunk.depth = 5;
    const near = addMon(state, makeRace(), loc(12, 10));
    const far = addMon(state, makeRace(), loc(25, 10));
    floorCarry(state, loc(9, 10), makeObj());
    state.chunk.setFeat(loc(11, 10), FEAT.LESS);

    registry().effectSimple(EF.DESTRUCTION, env(state), {
      origin: sourcePlayer(),
      radius: 5,
    });

    /* The nearby monster is deleted (not killed); the distant one lives. */
    expect(state.monsters[near.midx]).toBeNull();
    expect(state.monsters[far.midx]).toBe(far);
    /* Objects in the circle are destroyed. */
    expect(state.floor.get(10 * state.chunk.width + 9) ?? []).toHaveLength(0);
    /* Stairs survive; the terrain outside the circle is untouched. */
    expect(state.chunk.isStairs(loc(11, 10))).toBe(true);
    expect(state.chunk.isFloor(loc(25, 10))).toBe(true);
    /* The player's own grid is spared. */
    expect(state.chunk.isPassable(loc(10, 10))).toBe(true);
  });

  it("a light-subtype blast blinds an unresisting player", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    state.chunk.depth = 5;
    const msgs: string[] = [];
    registry().effectSimple(EF.DESTRUCTION, env(state, {}, msgs), {
      origin: sourcePlayer(),
      radius: 3,
      subtype: ELEM.LIGHT,
    });
    expect(msgs).toContain("There is a searing blast of light!");
    const blind = state.actor.player.timed[TMD.BLIND] ?? 0;
    expect(blind).toBeGreaterThanOrEqual(11);
    expect(blind).toBeLessThanOrEqual(20);
  });
});

describe("EF_EARTHQUAKE (effect-handler-attack.c L1290)", () => {
  it("only shakes the ground in town", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 0;
    const msgs: string[] = [];
    registry().effectSimple(EF.EARTHQUAKE, env(state, {}, msgs), {
      origin: sourcePlayer(),
      radius: 10,
    });
    expect(msgs).toContain("The ground shakes for a moment.");
    for (let x = 5; x <= 15; x++) {
      expect(state.chunk.isFloor(loc(x, 10))).toBe(true);
    }
  });

  it("shuffles terrain in the radius but never walls in the player", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 11, w: 60, h: 40 });
    state.chunk.depth = 5;
    const msgs: string[] = [];
    registry().effectSimple(EF.EARTHQUAKE, env(state, {}, msgs), {
      origin: sourcePlayer(),
      radius: 10,
    });
    expect(msgs).toContain("The ground shakes! The ceiling caves in!");
    /* Some grids inside the radius turned to wall. */
    let walls = 0;
    for (let y = 1; y <= 20; y++) {
      for (let x = 1; x <= 20; x++) {
        if (state.chunk.isMineralWall(loc(x, y))) walls++;
      }
    }
    expect(walls).toBeGreaterThan(0);
    /* The player's grid is never buried. */
    expect(state.chunk.isPassable(state.actor.grid)).toBe(true);
  });

  it("hurts or displaces a player caught in the quake (seed sweep)", () => {
    let affected = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const state = makeState({ playerGrid: loc(12, 10), seed, w: 60, h: 40 });
      state.chunk.depth = 5;
      /* A monster epicentre two grids away can mark the player's grid. */
      const mon = addMon(state, makeRace(), loc(10, 10));
      registry().effectSimple(EF.EARTHQUAKE, env(state), {
        origin: sourceMonster(mon.midx),
        radius: 8,
      });
      const p = state.actor.player;
      if (p.chp < p.mhp || !locEq(state.actor.grid, loc(12, 10))) affected++;
      expect(state.chunk.isPassable(state.actor.grid)).toBe(true);
    }
    expect(affected).toBeGreaterThan(0);
  });

  it("buries or damages monsters on quaked grids (seed sweep)", () => {
    let harmed = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const state = makeState({ playerGrid: loc(25, 10), seed, w: 60, h: 40 });
      state.chunk.depth = 5;
      const mon = addMon(state, makeRace(), loc(11, 10));
      registry().effectSimple(EF.EARTHQUAKE, env(state), {
        origin: sourcePlayer(),
        radius: 15,
        y: 0,
        x: 0,
      });
      const live = state.monsters[mon.midx];
      if (!live || live.hp < live.maxhp) harmed++;
    }
    expect(harmed).toBeGreaterThan(0);
  });

  it("a KILL_WALL monster shrugs the quake off", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const state = makeState({ playerGrid: loc(25, 10), seed, w: 60, h: 40 });
      state.chunk.depth = 5;
      const mon = addMon(state, makeRace({ flags: [RF.KILL_WALL] }), loc(11, 10));
      registry().effectSimple(EF.EARTHQUAKE, env(state), {
        origin: sourcePlayer(),
        radius: 15,
      });
      expect(state.monsters[mon.midx]).toBe(mon);
      expect(mon.hp).toBe(mon.maxhp);
    }
  });
});
