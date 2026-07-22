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

  it("EF_LASH targets another monster when the caster is aiming at it (5.3)", () => {
    const state = makeState({ playerGrid: loc(15, 15), seed: 8 });
    state.actor.player.chp = 1000;
    const dice = new Dice();
    dice.parseString("10d1");
    const blow = {
      method: { name: "HIT" },
      effect: { name: "HURT", lashType: "FIRE" },
      dice,
      diceRaw: "10d1",
    } as unknown as MonsterRace["blows"][number];
    const race = { ...makeRace(), blows: [blow, blow] };
    const caster = addMon(state, race, loc(5, 8), { hp: 50 });
    const victim = addMon(state, plainRace, loc(5, 7), { hp: 50 });
    caster.target.midx = victim.midx;

    registry().effectSimple(EF.LASH, env(state), {
      origin: sourceMonster(caster.midx),
      radius: 3,
    });
    /* The lash strikes the targeted monster, sparing the distant player. */
    expect(victim.hp).toBeLessThan(50);
    expect(state.actor.player.chp).toBe(1000);
  });

  it("EF_LASH from a player source fails (monsters only)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const ran = registry().effectSimple(EF.LASH, env(state), {
      origin: sourcePlayer(),
      radius: 3,
    });
    expect(ran).toBe(false);
  });

  /**
   * A1/A2 (effect-handler-attack.c:811-814, 868-870): a monster-sourced ARC and
   * SHORT_BEAM target the player's grid DIRECTLY with no random draw - unlike
   * BALL/BREATH they have no confused-dir / target-monster branch. The old port
   * routed them through monsterGetTarget, which draws randint1(100) (and, when
   * confused, randint1(9)), desyncing the RNG and possibly mis-aiming. These
   * assert the player is hit AND the RNG state is untouched by targeting.
   */
  /**
   * The target-resolution draw removed by A1/A2 is monsterGetTarget's
   * `randint1(100)` accuracy roll (effect-mon-origin.ts). The fire projection
   * against a bare actor never rolls randint1(100) itself, so recording every
   * randint1 argument and asserting 100 never appears is a precise guard: it
   * fails the moment the monster path is re-routed through monsterGetTarget.
   */
  function spyRandint1(state: GameState): number[] {
    const args: number[] = [];
    const real = state.rng.randint1.bind(state.rng);
    state.rng.randint1 = (n: number): number => {
      args.push(n);
      return real(n);
    };
    return args;
  }

  it("EF_ARC from a monster hits the player with no spurious targeting draw (A1)", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    state.actor.player.chp = 100;
    const mon = addMon(state, plainRace, loc(10, 13), { hp: 50 });
    const r1Args = spyRandint1(state);
    registry().effectSimple(EF.ARC, env(state), {
      origin: sourceMonster(mon.midx),
      diceString: "30",
      subtype: PROJ.FIRE,
      radius: 6,
      other: 60,
    });
    expect(state.actor.player.chp).toBeLessThan(100);
    expect(r1Args).not.toContain(100); /* no monsterGetTarget accuracy roll */
  });

  it("EF_SHORT_BEAM from a monster hits the player with no spurious targeting draw (A2)", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    state.actor.player.chp = 100;
    const mon = addMon(state, plainRace, loc(10, 13), { hp: 50 });
    const r1Args = spyRandint1(state);
    registry().effectSimple(EF.SHORT_BEAM, env(state), {
      origin: sourceMonster(mon.midx),
      diceString: "30",
      subtype: PROJ.FIRE,
      radius: 6,
    });
    expect(state.actor.player.chp).toBeLessThan(100);
    expect(r1Args).not.toContain(100);
  });

  it("EF_STRIKE reverts to the player grid when the target is unreachable (A5)", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    /* A monster adjacent to the player, and an aim at a granite border grid
     * that is not projectable from the player. With the fallback the strike
     * centres on the player and catches the neighbour; without it, the blast
     * lands on the wall and the neighbour is untouched. */
    const mon = addMon(state, plainRace, loc(11, 10), { hp: 50 });
    /* effect_simple defaults dir to DIR_TARGET, so the aimed grid is consulted. */
    registry().effectSimple(EF.STRIKE, env(state, { aimed: loc(0, 0) }), {
      origin: sourcePlayer(),
      diceString: "40",
      subtype: PROJ.FIRE,
      radius: 1,
    });
    expect(mon.hp).toBeLessThan(50);
  });

});
