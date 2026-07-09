import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MON_TMD, RF } from "../generated";
import {
  EffectRegistry,
  sourcePlayer,
} from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { loc } from "../loc";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { addMon, makeState, makeRace, monReg } from "./harness";
import { updateMonsterDistances } from "./context";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";
import { registerMonsterHandlers } from "./effect-monster";

const projections = bindProjections(
  JSON.parse(
    readFileSync(
      new URL("../../../content/pack/projection.json", import.meta.url),
      "utf8",
    ),
  ).records as ProjectionRecordJson[],
);

const plainRace = monReg.races.find(
  (r) => r.rarity > 0 && !r.flags.has(RF.UNIQUE),
)!;

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerMonsterHandlers(r);
  return r;
}

function env(state: GameState, game: Partial<GameEffectEnv> = {}): EffectContext {
  return attachGameEnv(
    { rng: state.rng },
    { state, cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) }, ...game },
  );
}

describe("EF_WAKE", () => {
  it("wakes a sleeping monster within range", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(7, 7), { hp: 50 });
    mon.mTimed[MON_TMD.SLEEP] = 50;
    registry().effectSimple(EF.WAKE, env(state), { origin: sourcePlayer() });
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0);
  });
});

describe("EF_BANISH", () => {
  it("removes matching non-unique monsters and hurts the caster", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const orc = makeRace({ flags: [] });
    orc.dChar = "o";
    const kobold = makeRace({ flags: [] });
    kobold.dChar = "k";
    const a = addMon(state, orc, loc(6, 6), { hp: 30 });
    const b = addMon(state, orc, loc(7, 7), { hp: 30 });
    const c = addMon(state, kobold, loc(8, 8), { hp: 30 });
    registry().effectSimple(EF.BANISH, env(state, { banishSymbol: () => "o" }), {
      origin: sourcePlayer(),
    });
    expect(state.monsters[a.midx]).toBeNull();
    expect(state.monsters[b.midx]).toBeNull();
    expect(state.monsters[c.midx]).not.toBeNull();
    expect(state.actor.player.chp).toBeLessThan(100);
  });

  it("aborts (no damage) when no symbol is chosen", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const mon = addMon(state, plainRace, loc(6, 6), { hp: 30 });
    const ran = registry().effectSimple(EF.BANISH, env(state, { banishSymbol: () => null }), {
      origin: sourcePlayer(),
    });
    expect(ran).toBe(false);
    expect(state.monsters[mon.midx]).not.toBeNull();
    expect(state.actor.player.chp).toBe(100);
  });

  it("never banishes unique monsters", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const unique = makeRace({ flags: [RF.UNIQUE] });
    unique.dChar = "U";
    const mon = addMon(state, unique, loc(6, 6), { hp: 30 });
    registry().effectSimple(EF.BANISH, env(state, { banishSymbol: () => "U" }), {
      origin: sourcePlayer(),
    });
    expect(state.monsters[mon.midx]).not.toBeNull();
  });
});

describe("EF_MASS_BANISH", () => {
  it("removes nearby non-unique monsters and spares distant ones", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const near = addMon(state, plainRace, loc(6, 6), { hp: 30 });
    const far = addMon(state, plainRace, loc(30, 20), { hp: 30 });
    updateMonsterDistances(state);
    registry().effectSimple(EF.MASS_BANISH, env(state), {
      origin: sourcePlayer(),
      radius: 3,
    });
    expect(state.monsters[near.midx]).toBeNull();
    expect(state.monsters[far.midx]).not.toBeNull();
    expect(state.actor.player.chp).toBeLessThan(100);
  });
});

describe("monster handlers - worldless", () => {
  it("no-op without a game env", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(6, 6), { hp: 30 });
    const worldless: EffectContext = { rng: state.rng };
    registry().effectSimple(EF.MASS_BANISH, worldless, {
      origin: sourcePlayer(),
      radius: 3,
    });
    expect(state.monsters[mon.midx]).not.toBeNull();
  });
});
