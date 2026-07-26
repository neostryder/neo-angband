import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MON_TMD, RF } from "../generated";
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

/** Same as `env`, with a message sink so visibility branches are observable. */
function msgEnv(state: GameState, msgs: string[]): EffectContext {
  return attachGameEnv(
    { rng: state.rng, messages: { msg: (t: string) => msgs.push(t) } },
    { state, cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) } },
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

describe("EF_MON_HEAL_HP / EF_MON_HEAL_KIN", () => {
  it("the casting monster heals itself, capped at max, and sheds fear", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(7, 7), { hp: 50 });
    mon.hp = 10;
    mon.mTimed[MON_TMD.FEAR] = 20;
    registry().effectSimple(EF.MON_HEAL_HP, env(state), {
      origin: sourceMonster(mon.midx),
      diceString: "100",
    });
    expect(mon.hp).toBe(50);
    expect(mon.mTimed[MON_TMD.FEAR]).toBe(0);
  });

  it("heals a nearby injured monster of the same base", () => {
    const state = makeState({ playerGrid: loc(20, 5) });
    const caster = addMon(state, plainRace, loc(7, 7), { hp: 50 });
    const kin = addMon(state, plainRace, loc(9, 7), { hp: 50 });
    kin.hp = 15;
    registry().effectSimple(EF.MON_HEAL_KIN, env(state), {
      origin: sourceMonster(caster.midx),
      diceString: "20",
    });
    expect(kin.hp).toBe(35);
    expect(caster.hp).toBe(50); /* the caster itself is never the target */
  });

  it("finds no kin when none is injured or of the same base", () => {
    const state = makeState({ playerGrid: loc(20, 5) });
    const caster = addMon(state, plainRace, loc(7, 7), { hp: 50 });
    const healthy = addMon(state, plainRace, loc(9, 7), { hp: 50 });
    const otherBase = monReg.races.find(
      (r) => r.rarity > 0 && r.base !== plainRace.base,
    )!;
    const stranger = addMon(state, otherBase, loc(7, 9), { hp: 50 });
    stranger.hp = 5;
    registry().effectSimple(EF.MON_HEAL_KIN, env(state), {
      origin: sourceMonster(caster.midx),
      diceString: "20",
    });
    expect(healthy.hp).toBe(50);
    expect(stranger.hp).toBe(5); /* different base: not kin */
  });

  /*
   * The two upstream handlers look near-identical and differ in exactly three
   * places, all of which the port lost by sharing one body between them. Found
   * 2026-07-26 by the W1 effect-handler deep diff and fixed with these guards.
   *
   *   MON_HEAL_HP (L254-305)              MON_HEAL_KIN (L311-360)
   *   amount BEFORE the !mon guard        !mon guard BEFORE amount
   *     (L261 then L265)                    (L317 then L319)
   *   -                                   amount BEFORE the kin search (L324)
   *   "sounds ..." when unseen            silent when unseen (both msgs in
   *     (L282-290)                          `if (seen)`, L338-344)
   */

  it("MON_HEAL_KIN rolls the value before searching for kin (L319 precedes L324)", () => {
    /* choose_nearby_injured_kin draws one randint0 per candidate (mon-util.c
     * L907), so rolling the value afterwards swaps two draw groups. The probe:
     * MON_HEAL_HP on a lone monster rolls the value as its FIRST RNG action, so
     * at the same seed and dice it must heal by exactly the same amount as
     * MON_HEAL_KIN -- which is only true if KIN also rolls first. */
    const dice = "10d10";

    const solo = makeState({ playerGrid: loc(20, 5), seed: 99 });
    const alone = addMon(solo, plainRace, loc(7, 7), { hp: 500 });
    alone.hp = 1;
    registry().effectSimple(EF.MON_HEAL_HP, env(solo), {
      origin: sourceMonster(alone.midx),
      diceString: dice,
    });
    const rolledFirst = alone.hp - 1;
    expect(rolledFirst, "10d10 must land in 10..100").toBeGreaterThanOrEqual(10);
    expect(rolledFirst).toBeLessThanOrEqual(100);

    /* Three injured kin, so the search makes three draws before healing. */
    const state = makeState({ playerGrid: loc(20, 5), seed: 99 });
    const caster = addMon(state, plainRace, loc(7, 7), { hp: 500 });
    const kin = [loc(8, 7), loc(6, 7), loc(7, 8)].map((g) => {
      const k = addMon(state, plainRace, g, { hp: 500 });
      k.hp = 1;
      return k;
    });
    registry().effectSimple(EF.MON_HEAL_KIN, env(state), {
      origin: sourceMonster(caster.midx),
      diceString: dice,
    });
    const healed = kin.filter((k) => k.hp > 1);
    expect(healed, "exactly one kin is healed").toHaveLength(1);
    expect(
      healed[0]!.hp - 1,
      "the value must be rolled before the kin search, so it matches the solo roll",
    ).toBe(rolledFirst);
  });

  it("MON_HEAL_KIN is silent for an unseen kin, MON_HEAL_HP is not (L338-344 vs L282-290)", () => {
    /* addMon leaves MFLAG_VISIBLE clear, so both targets are unseen. */
    const kinMsgs: string[] = [];
    const kinState = makeState({ playerGrid: loc(20, 5), seed: 4 });
    const caster = addMon(kinState, plainRace, loc(7, 7), { hp: 50 });
    const kin = addMon(kinState, plainRace, loc(9, 7), { hp: 50 });
    kin.hp = 15;
    registry().effectSimple(
      EF.MON_HEAL_KIN,
      msgEnv(kinState, kinMsgs),
      { origin: sourceMonster(caster.midx), diceString: "20" },
    );
    expect(kin.hp, "the heal itself still happens").toBe(35);
    expect(
      kinMsgs.filter((m) => /health/.test(m)),
      "an unseen kin produces no heal message at all",
    ).toEqual([]);

    const hpMsgs: string[] = [];
    const hpState = makeState({ playerGrid: loc(20, 5), seed: 4 });
    const selfHealer = addMon(hpState, plainRace, loc(7, 7), { hp: 50 });
    selfHealer.hp = 15;
    registry().effectSimple(
      EF.MON_HEAL_HP,
      msgEnv(hpState, hpMsgs),
      { origin: sourceMonster(selfHealer.midx), diceString: "20" },
    );
    expect(selfHealer.hp).toBe(35);
    expect(
      hpMsgs.some((m) => m.endsWith("sounds healthier.")),
      "MON_HEAL_HP DOES announce an unseen monster -- the asymmetry is upstream's",
    ).toBe(true);
  });

  it("MON_HEAL_HP rolls before its null guard, MON_HEAL_KIN after (L261/265 vs L317/319)", () => {
    /* A midx that resolves to no monster. In the C, MON_HEAL_HP has already
     * called effect_calculate_value by the time it checks, so the dice draws are
     * consumed; MON_HEAL_KIN checks first and consumes nothing. Keeping that
     * asymmetry is what decision 6.2 requires -- it is a wart, and core keeps
     * upstream's warts. */
    const hpState = makeState({ playerGrid: loc(20, 5), seed: 7 });
    const before = hpState.rng.getState();
    registry().effectSimple(EF.MON_HEAL_HP, env(hpState), {
      origin: sourceMonster(9999),
      diceString: "10d10",
    });

    const kinState = makeState({ playerGrid: loc(20, 5), seed: 7 });
    registry().effectSimple(EF.MON_HEAL_KIN, env(kinState), {
      origin: sourceMonster(9999),
      diceString: "10d10",
    });

    /* Both advance, because effect_do rolls the dice for EVERY effect before
     * dispatching (effects.c:403-404) and dice_roll CONSUMES a damroll it then
     * throws away, keeping only base/dice/sides (z-dice.c:591; the port
     * reproduces it at dice.ts:419). That throwaway draw is upstream's, so it is
     * not what this test is about. */
    expect(hpState.rng.getState()).not.toEqual(before);
    expect(kinState.rng.getState()).not.toEqual(before);

    /* The asymmetry: HP has ALSO taken effect_calculate_value's damroll(10, 10)
     * by the time it checks for the monster, and KIN has not. Same seed, same
     * dice, so the two post-states can only differ because of that. */
    expect(
      hpState.rng.getState(),
      "MON_HEAL_HP rolls its value before the null guard and MON_HEAL_KIN after, " +
        "so a missing monster must leave the two streams in different places",
    ).not.toEqual(kinState.rng.getState());
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
