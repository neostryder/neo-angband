import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJ, RF, TMD } from "../generated";
import { DIR_TARGET } from "../effects/interpreter";
import { loc } from "../loc";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { addMon, makeState, monReg } from "./harness";
import type { GameState } from "./context";
import {
  basicPlayerActor,
  castBall,
  castBeam,
  castBolt,
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
