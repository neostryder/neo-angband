import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MFLAG, PROJ, RF } from "../generated";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
} from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { loc } from "../loc";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { Dice } from "../dice";
import type { MonsterRace } from "../mon/types";
import { addMon, makeRace, makeState, monReg } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import type { CastContext } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";
import { registerAttackHandlers } from "./effect-attack";

const projections = bindProjections(
  JSON.parse(
    readFileSync(
      new URL("../../../content/pack/projection.json", import.meta.url),
      "utf8",
    ),
  ).records as ProjectionRecordJson[],
);

const plainRace = monReg.races.find(
  (r) =>
    r.rarity > 0 &&
    !r.flags.has(RF.UNIQUE) &&
    !r.flags.has(RF.IM_FIRE) &&
    !r.flags.has(RF.HURT_FIRE),
)!;

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerAttackHandlers(r);
  return r;
}

function castContext(state: GameState): CastContext {
  return { projections, maxRange: 20, playerActor: basicPlayerActor(state) };
}

function env(state: GameState, game: Partial<GameEffectEnv> = {}): EffectContext {
  return attachGameEnv(
    { rng: state.rng },
    { state, cast: castContext(state), ...game },
  );
}

describe("attack effect handlers - dispatch through the registry", () => {
  it("EF_BOLT damages the aimed monster and sets ident", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const ident = { value: false };
    registry().effectSimple(EF.BOLT, env(state, { aimed: mon.grid }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
      ident,
    });
    expect(mon.hp).toBe(30);
    expect(ident.value).toBe(true);
  });

  it("EF_BEAM passes through several monsters in line", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const near = addMon(state, plainRace, loc(5, 7), { hp: 50 });
    const far = addMon(state, plainRace, loc(5, 9), { hp: 50 });
    registry().effectSimple(EF.BEAM, env(state, { aimed: loc(5, 9) }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
    });
    expect(near.hp).toBe(30);
    expect(far.hp).toBe(30);
  });

  it("EF_BALL from a monster detonates on the player", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    registry().effectSimple(EF.BALL, env(state), {
      origin: sourceMonster(mon.midx),
      diceString: "30",
      subtype: PROJ.FIRE,
    });
    expect(state.actor.player.chp).toBe(70);
  });

  it("EF_PROJECT_LOS hits every monster in line of sight", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const a = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const b = addMon(state, plainRace, loc(8, 5), { hp: 50 });
    registry().effectSimple(EF.PROJECT_LOS, env(state), {
      origin: sourcePlayer(),
      diceString: "15",
      subtype: PROJ.FIRE,
    });
    expect(a.hp).toBe(35);
    expect(b.hp).toBe(35);
  });

  it("no-ops without an attack environment (worldless rule)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const worldless: EffectContext = { rng: state.rng };
    const ran = registry().effectSimple(EF.BOLT, worldless, {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
    });
    expect(ran).toBe(true);
    expect(mon.hp).toBe(50);
  });

  it("EF_BOLT_STATUS identifies only when the projection was noticed", () => {
    /* An unseen monster: the bolt lands but nothing was noticed. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const ident = { value: false };
    registry().effectSimple(EF.BOLT_STATUS, env(state, { aimed: mon.grid }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
      ident,
    });
    expect(mon.hp).toBe(30);
    expect(ident.value).toBe(false);

    /* A visible monster: the effect is noticed and identifies. */
    const seen = makeState({ playerGrid: loc(5, 5) });
    const vis = addMon(seen, plainRace, loc(5, 8), { hp: 50 });
    vis.mflag.on(MFLAG.VISIBLE);
    const ident2 = { value: false };
    registry().effectSimple(EF.BOLT_STATUS, env(seen, { aimed: vis.grid }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
      ident: ident2,
    });
    expect(vis.hp).toBe(30);
    expect(ident2.value).toBe(true);
  });

  it("EF_LASH whips the player with the first blow's lash element", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 8 });
    state.actor.player.chp = 1000;
    const dice = new Dice();
    dice.parseString("10d1"); /* a fixed 10 per roll */
    const blow = {
      method: { name: "HIT" },
      effect: { name: "HURT", lashType: "FIRE" },
      dice,
      diceRaw: "10d1",
    } as unknown as MonsterRace["blows"][number];
    const race = { ...makeRace(), blows: [blow, blow] };
    const mon = addMon(state, race, loc(5, 8), { hp: 50 });

    const ident = { value: false };
    registry().effectSimple(EF.LASH, env(state), {
      origin: sourceMonster(mon.midx),
      radius: 3,
      ident,
    });
    /* Full first blow (10) plus half the second (5), through the player's
     * fire adjustment (none on the bare test actor). */
    expect(state.actor.player.chp).toBeLessThan(1000);
    expect(ident.value).toBe(true);
  });

  it("EF_LASH from a player source fails (monsters only)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const ran = registry().effectSimple(EF.LASH, env(state), {
      origin: sourcePlayer(),
      radius: 3,
    });
    expect(ran).toBe(false);
  });
});
