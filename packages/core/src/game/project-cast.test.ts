import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJ, RF, TMD } from "../generated";
import { DIR_TARGET } from "../effects/interpreter";
import { loc } from "../loc";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { GRANITE, addMon, makeState, monReg } from "./harness";
import type { GameState } from "./context";
import {
  basicPlayerActor,
  castAlter,
  castArc,
  castBall,
  castBeam,
  castBolt,
  castLine,
  castProjectLos,
  castSpot,
  castStar,
  castStrike,
  castSwarm,
  monsterCastSource,
  playerCastSource,
  resolveAimedTarget,
} from "./project-cast";
import type { CastContext, CastHooks } from "./project-cast";

const projections = bindProjections(
  JSON.parse(
    readFileSync(
      new URL("../../../content/pack/projection.json", import.meta.url),
      "utf8",
    ),
  ).records as ProjectionRecordJson[],
);

/** A non-unique race with no fire immunity / vulnerability, for clean damage. */
const plainRace = monReg.races.find(
  (r) =>
    r.rarity > 0 &&
    !r.flags.has(RF.UNIQUE) &&
    !r.flags.has(RF.IM_FIRE) &&
    !r.flags.has(RF.HURT_FIRE),
)!;

function cctx(state: GameState, hooks: CastHooks = {}): CastContext {
  return {
    projections,
    maxRange: 20,
    playerActor: basicPlayerActor(state),
    hooks,
  };
}

describe("basicPlayerActor", () => {
  it("writes take_hit mutations back to the live player and state", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 40;
    const actor = basicPlayerActor(state);
    actor.chp -= 15;
    actor.isDead = true;
    expect(state.actor.player.chp).toBe(25);
    expect(state.isDead).toBe(true);
    /* the timed array is shared, not copied */
    expect(actor.timed).toBe(state.actor.player.timed);
  });
});

describe("resolveAimedTarget", () => {
  it("aims a player projection at the adjacent grid in a direction", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const src = playerCastSource(state);
    /* keypad 8 is north (y - 1) */
    expect(resolveAimedTarget(state, src, 8)).toEqual({ grid: loc(5, 4), play: false });
  });

  it("aims a player projection at an acquired target under DIR_TARGET", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const src = playerCastSource(state);
    const aimed = loc(9, 9);
    expect(resolveAimedTarget(state, src, DIR_TARGET, aimed)).toEqual({
      grid: aimed,
      play: false,
    });
  });

  it("aims a monster projection at the player and enables PROJECT_PLAY", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const src = monsterCastSource(state, mon.midx);
    expect(resolveAimedTarget(state, src, 0)).toEqual({ grid: loc(5, 5), play: true });
  });
});

describe("castBolt", () => {
  it("a player bolt damages the monster it stops at", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const src = playerCastSource(state);
    castBolt(state, cctx(state), src, mon.grid, 20, PROJ.FIRE);
    expect(mon.hp).toBe(30);
  });

  it("tracks the single monster a player bolt hits", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const tracked: ReturnType<typeof loc>[] = [];
    const src = playerCastSource(state);
    castBolt(state, cctx(state, { onTrackMonster: (g) => tracked.push(g) }), src, mon.grid, 20, PROJ.FIRE);
    expect(tracked).toEqual([loc(5, 8)]);
  });

  it("a monster bolt damages the player through the live actor", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const src = monsterCastSource(state, mon.midx, { killer: "an orc" });
    castBolt(state, cctx(state), src, state.actor.grid, 30, PROJ.FIRE);
    expect(state.actor.player.chp).toBe(70);
  });

  it("a fatal monster bolt kills the player and flags death", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 10;
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    let died = 0;
    const src = monsterCastSource(state, mon.midx, { killer: "an orc" });
    castBolt(
      state,
      cctx(state, { player: { takeHit: { onDeath: () => died++ } } }),
      src,
      state.actor.grid,
      40,
      PROJ.FIRE,
    );
    expect(state.isDead).toBe(true);
    expect(died).toBe(1);
  });

  it("suppresses bolt visuals when the player is blind", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.timed[TMD.BLIND] = 10;
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    let bolts = 0;
    const src = playerCastSource(state);
    castBolt(state, cctx(state, { onBolt: () => bolts++ }), src, mon.grid, 20, PROJ.FIRE);
    expect(bolts).toBe(0);
  });

  it("shows bolt visuals when the player can see", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    let bolts = 0;
    const src = playerCastSource(state);
    castBolt(state, cctx(state, { onBolt: () => bolts++ }), src, mon.grid, 20, PROJ.FIRE);
    expect(bolts).toBeGreaterThan(0);
  });
});

describe("castBeam", () => {
  it("a player beam passes through and damages every monster in line", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const near = addMon(state, plainRace, loc(5, 7), { hp: 50 });
    const far = addMon(state, plainRace, loc(5, 9), { hp: 50 });
    const src = playerCastSource(state);
    castBeam(state, cctx(state), src, loc(5, 9), 20, PROJ.FIRE);
    expect(near.hp).toBe(30);
    expect(far.hp).toBe(30);
  });
});

describe("castBall", () => {
  it("a player ball explodes on its target and damages the monster", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 10), { hp: 50 });
    const src = playerCastSource(state);
    castBall(state, cctx(state), src, mon.grid, 20, PROJ.FIRE, 2, { aimedAtTarget: true });
    expect(mon.hp).toBe(30);
  });

  it("a monster ball detonates on the player", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const src = monsterCastSource(state, mon.midx, { killer: "an orc" });
    castBall(state, cctx(state), src, state.actor.grid, 30, PROJ.FIRE, 2);
    expect(state.actor.player.chp).toBe(70);
  });
});

describe("castLine / castAlter", () => {
  it("a line beam damages a monster in its path", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    castLine(state, cctx(state), playerCastSource(state), loc(5, 8), 20, PROJ.FIRE);
    expect(mon.hp).toBe(30);
  });

  it("an alter projection leaves monsters unharmed (no PROJECT_KILL)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    castAlter(state, cctx(state), playerCastSource(state), loc(5, 8), PROJ.FIRE);
    expect(mon.hp).toBe(50);
  });
});

describe("castArc", () => {
  it("a cone damages a monster on its centreline", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(8, 5), { hp: 50 });
    castArc(state, cctx(state), playerCastSource(state), loc(10, 5), 20, PROJ.FIRE, 5, 60);
    expect(mon.hp).toBe(30);
  });
});

describe("castSpot", () => {
  it("explodes on the player, hurting a neighbour and the caster (SELF)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const mon = addMon(state, plainRace, loc(5, 6), { hp: 50 });
    castSpot(state, cctx(state), playerCastSource(state), 20, PROJ.FIRE, 2);
    expect(mon.hp).toBe(30);
    /* self damage is scaled down by ten (20 -> 2). */
    expect(state.actor.player.chp).toBe(98);
  });
});

describe("castStar", () => {
  it("shoots a beam in each direction, hitting a monster in line", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 3), { hp: 50 });
    castStar(state, cctx(state), playerCastSource(state), 20, PROJ.FIRE);
    expect(mon.hp).toBe(30);
  });
});

describe("castStrike", () => {
  it("drops a ball on a target with no travel path (JUMP)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(10, 10), { hp: 50 });
    castStrike(state, cctx(state), playerCastSource(state), loc(10, 10), 20, PROJ.FIRE, 0);
    expect(mon.hp).toBe(30);
  });
});

describe("castSwarm", () => {
  it("fires the given number of balls at the target", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    castSwarm(state, cctx(state), playerCastSource(state), loc(5, 8), 10, PROJ.FIRE, 0, 3);
    expect(mon.hp).toBe(20); /* 3 x 10 */
  });
});

describe("castProjectLos", () => {
  it("hits every monster in line of sight", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const a = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const b = addMon(state, plainRace, loc(8, 5), { hp: 50 });
    castProjectLos(state, cctx(state), playerCastSource(state), 15, PROJ.FIRE);
    expect(a.hp).toBe(35);
    expect(b.hp).toBe(35);
  });

  it("skips the excluded (currently-acting) monster", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const a = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const b = addMon(state, plainRace, loc(8, 5), { hp: 50 });
    castProjectLos(state, cctx(state), playerCastSource(state), 15, PROJ.FIRE, {
      excludeMonster: a.midx,
    });
    expect(a.hp).toBe(50);
    expect(b.hp).toBe(35);
  });

  it("does not reach a monster whose line of sight is blocked by a wall", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.chunk.setFeat(loc(5, 8), GRANITE);
    const mon = addMon(state, plainRace, loc(5, 11), { hp: 50 });
    castProjectLos(state, cctx(state), playerCastSource(state), 15, PROJ.FIRE);
    expect(mon.hp).toBe(50);
  });
});
