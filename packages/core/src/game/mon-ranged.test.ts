import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELEM, MFLAG, MON_TMD, RF, RSF } from "../generated";
import { FlagSet } from "../bitflag";
import { Rng } from "../rng";
import { EffectRegistry } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { loc, locEq } from "../loc";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { RSF_SIZE } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import { GRANITE, addMon, makeState, makeRace, monReg, plReg } from "./harness";
import { updateMonsterDistances } from "./context";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import type { CastContext } from "./project-cast";
import { registerAttackHandlers } from "./effect-attack";
import { registerMonsterHandlers } from "./effect-monster";
import { registerTeleportHandlers } from "./effect-teleport";
import { monsterTurn } from "./monster-turn";
import type { DoMonSpellDeps } from "./mon-cast";
import {
  chooseAttackSpell,
  chooseNearbyInjuredKin,
  findAnyNearbyInjuredKin,
  installMonsterCasting,
  makeRangedAttack,
  monsterCanCast,
  monsterSpellFailrate,
  removeBadSpells,
  summonPossible,
} from "./mon-ranged";

const projections = bindProjections(
  JSON.parse(
    readFileSync(
      new URL("../../../content/pack/projection.json", import.meta.url),
      "utf8",
    ),
  ).records as ProjectionRecordJson[],
);

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerAttackHandlers(r);
  registerMonsterHandlers(r);
  registerTeleportHandlers(r);
  return r;
}

function castContext(state: GameState): CastContext {
  return { projections, maxRange: 20, playerActor: basicPlayerActor(state) };
}

function deps(state: GameState): DoMonSpellDeps {
  return {
    registry: registry(),
    cast: castContext(state),
    spells: monReg.spells,
    envDeps: { timedTable: plReg.timed },
    saveSkill: 0,
  };
}

/** A caster race with the given spell flags and frequencies. */
function casterRace(
  spellNames: number[],
  freq: { spell?: number; innate?: number } = {},
): MonsterRace {
  const race = makeRace({ flags: [] });
  race.freqSpell = freq.spell ?? 0;
  race.freqInnate = freq.innate ?? 0;
  race.spellPower = 0;
  const flags = new FlagSet(RSF_SIZE);
  for (const s of spellNames) flags.on(s);
  race.spellFlags = flags;
  return race;
}

describe("monsterCanCast", () => {
  it("passes the frequency gate at 100% and fails at 0%", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const raceYes = casterRace([RSF.BA_FIRE], { spell: 100 });
    const mon = addMon(state, raceYes, loc(5, 7));
    updateMonsterDistances(state);
    expect(monsterCanCast(state, mon, false, 20)).toBe(true);

    mon.race = casterRace([RSF.BA_FIRE], { spell: 0 });
    expect(monsterCanCast(state, mon, false, 20)).toBe(false);
  });

  it("a nice monster never casts", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, casterRace([RSF.BA_FIRE], { spell: 100 }), loc(5, 7));
    updateMonsterDistances(state);
    mon.mflag.on(MFLAG.NICE);
    expect(monsterCanCast(state, mon, false, 20)).toBe(false);
  });
});

describe("makeRangedAttack", () => {
  it("casts an innate breath at the player, dealing damage", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 200;
    const mon = addMon(state, casterRace([RSF.BR_FIRE], { innate: 100 }), loc(5, 6), {
      hp: 300,
    });
    updateMonsterDistances(state);
    const ran = makeRangedAttack(state, mon.midx, deps(state));
    expect(ran).toBe(true);
    expect(state.actor.player.chp).toBeLessThan(200);
  });

  it("returns false when the monster cannot cast", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, casterRace([RSF.BR_FIRE], { spell: 0, innate: 0 }), loc(5, 6));
    updateMonsterDistances(state);
    expect(makeRangedAttack(state, mon.midx, deps(state))).toBe(false);
  });
});

describe("installMonsterCasting (live monster turn)", () => {
  it("makes a monster cast on its turn instead of moving", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 200;
    const mon = addMon(state, casterRace([RSF.BR_FIRE], { innate: 100 }), loc(5, 8), {
      hp: 300,
    });
    updateMonsterDistances(state);
    installMonsterCasting(state, deps(state));
    monsterTurn(mon, state);
    expect(state.actor.player.chp).toBeLessThan(200);
    expect(locEq(mon.grid, loc(5, 8))).toBe(true); // cast, did not move
  });

  it("without casting installed, the monster deals no ranged damage", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 200;
    const mon = addMon(state, casterRace([RSF.BR_FIRE], { innate: 100 }), loc(5, 8), {
      hp: 300,
    });
    updateMonsterDistances(state);
    monsterTurn(mon, state);
    expect(state.actor.player.chp).toBe(200);
  });
});

describe("makeRangedAttack - become_aware (mimic reveal)", () => {
  it("calls config.becomeAware with the caster's midx when a camouflaged caster casts", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, casterRace([RSF.BR_FIRE], { innate: 100 }), loc(5, 6), {
      hp: 300,
    });
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    updateMonsterDistances(state);
    let revealedMidx = -1;
    const ran = makeRangedAttack(state, mon.midx, deps(state), {
      becomeAware: (midx) => {
        revealedMidx = midx;
      },
    });
    expect(ran).toBe(true);
    expect(revealedMidx).toBe(mon.midx);
  });

  it("installMonsterCasting threads becomeAware through a live monster turn", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 200;
    const mon = addMon(state, casterRace([RSF.BR_FIRE], { innate: 100 }), loc(5, 8), {
      hp: 300,
    });
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    updateMonsterDistances(state);
    let revealed: number | null = null;
    installMonsterCasting(state, deps(state), {
      becomeAware: (midx) => {
        revealed = midx;
      },
    });
    monsterTurn(mon, state);
    expect(revealed).toBe(mon.midx);
  });
});

describe("removeBadSpells", () => {
  it("strips wasted spells by health, status and range", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(
      state,
      casterRace([RSF.HEAL, RSF.HASTE, RSF.WHIP, RSF.BA_FIRE]),
      loc(5, 10),
    );
    updateMonsterDistances(state); // cdis > 2
    mon.hp = mon.maxhp; // full: drop HEAL
    mon.mTimed[MON_TMD.FAST] = 20; // hasted: drop HASTE
    const f = mon.race.spellFlags.clone();
    removeBadSpells(state, mon, f, {});
    expect(f.has(RSF.HEAL)).toBe(false);
    expect(f.has(RSF.HASTE)).toBe(false);
    expect(f.has(RSF.WHIP)).toBe(false); // player too far
    expect(f.has(RSF.BA_FIRE)).toBe(true); // kept
  });
});

describe("chooseAttackSpell", () => {
  it("filters by innate / non-innate", () => {
    const state = makeState();
    const f = new FlagSet(RSF_SIZE);
    f.on(RSF.BR_FIRE); // innate
    f.on(RSF.BA_FIRE); // non-innate
    expect(chooseAttackSpell(state, f, true, false)).toBe(RSF.BR_FIRE);
    expect(chooseAttackSpell(state, f, false, true)).toBe(RSF.BA_FIRE);
    expect(chooseAttackSpell(state, new FlagSet(RSF_SIZE), true, true)).toBe(RSF.NONE);
  });
});

describe("summonPossible", () => {
  it("is true on open floor and false when boxed in", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    expect(summonPossible(state, loc(10, 10))).toBe(true);

    /* Wall off every grid within 2 of the target. */
    for (let y = 8; y <= 12; y++) {
      for (let x = 8; x <= 12; x++) state.chunk.setFeat(loc(x, y), GRANITE);
    }
    expect(summonPossible(state, loc(10, 10))).toBe(false);
  });
});

describe("monsterSpellFailrate", () => {
  it("is zero for stupid monsters and rises with bad status", () => {
    const state = makeState();
    const stupid = addMon(state, makeRace({ flags: [RF.STUPID] }), loc(5, 7));
    expect(monsterSpellFailrate(stupid)).toBe(0);

    const clever = addMon(state, makeRace({ flags: [] }), loc(6, 7));
    const base = monsterSpellFailrate(clever);
    expect(base).toBeGreaterThan(0);
    clever.mTimed[MON_TMD.FEAR] = 5;
    expect(monsterSpellFailrate(clever)).toBe(base + 20);
    clever.mTimed[MON_TMD.CONF] = 5;
    expect(monsterSpellFailrate(clever)).toBe(base + 20 + 50);
  });
});

describe("decoy targeting (monster_get_target_dist_grid, mon-attack.c L65)", () => {
  it("a decoyed monster measures range and path to the decoy", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    /* Player far out of the 20-grid cast range; decoy adjacent. */
    const mon = addMon(state, casterRace([RSF.BA_FIRE], { spell: 100 }), loc(35, 20));
    state.decoy = loc(34, 20);
    updateMonsterDistances(state); /* cdis to the player is huge */
    expect(mon.cdis).toBeGreaterThan(20);
    /* With the decoy in LOS the effective target distance is 1: castable. */
    expect(monsterCanCast(state, mon, false, 20)).toBe(true);

    /* Without the decoy the player is out of range: not castable. */
    state.decoy = null;
    expect(monsterCanCast(state, mon, false, 20)).toBe(false);
  });

  it("removeBadSpells prunes TELE_TO by decoy distance, not player distance", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, casterRace([RSF.TELE_TO]), loc(20, 10));
    state.decoy = loc(21, 10); /* adjacent decoy */
    updateMonsterDistances(state); /* player is far (tdist would be > 1) */
    const f = mon.race.spellFlags.clone();
    removeBadSpells(state, mon, f, {});
    /* tdist == 1 via the decoy: TELE_TO is stripped. */
    expect(f.has(RSF.TELE_TO)).toBe(false);
  });
});

describe("RSF_HEAL_KIN injured-kin scan (mon-util.c L885)", () => {
  it("keeps HEAL_KIN only when an injured same-base monster is in LOS nearby", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const healer = addMon(state, casterRace([RSF.HEAL_KIN]), loc(20, 10));
    updateMonsterDistances(state);

    /* No kin at all: pruned. */
    let f = healer.race.spellFlags.clone();
    removeBadSpells(state, healer, f, {});
    expect(f.has(RSF.HEAL_KIN)).toBe(false);

    /* A healthy kin nearby: still pruned (no injury). */
    const kin = addMon(state, makeRace({ level: 5 }), loc(22, 10), { hp: 30 });
    kin.race.base = healer.race.base;
    updateMonsterDistances(state);
    f = healer.race.spellFlags.clone();
    removeBadSpells(state, healer, f, {});
    expect(f.has(RSF.HEAL_KIN)).toBe(false);

    /* The kin is injured: kept. */
    kin.hp = Math.trunc(kin.maxhp / 2);
    f = healer.race.spellFlags.clone();
    removeBadSpells(state, healer, f, {});
    expect(f.has(RSF.HEAL_KIN)).toBe(true);
  });

  it("chooseNearbyInjuredKin picks the injured kin", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const healer = addMon(state, casterRace([RSF.HEAL_KIN]), loc(20, 10));
    const kin = addMon(state, makeRace({ level: 5 }), loc(22, 10), { hp: 30 });
    kin.race.base = healer.race.base;
    kin.hp = 3;
    updateMonsterDistances(state);
    expect(chooseNearbyInjuredKin(state, healer)).toBe(kin);
    expect(findAnyNearbyInjuredKin(state, healer)).toBe(true);
  });
});

describe("spell failure message + disturb (mon-attack.c L460, L465)", () => {
  it("prints 'tries to cast a spell, but fails.' with the monster_desc name", () => {
    /* A frightened caster has failrate 25 - 1 + 20 = 44; scan seeds for one
     * that fails the cast, then assert the default message. */
    for (let seed = 1; seed < 60; seed++) {
      const state = makeState({ playerGrid: loc(5, 5), seed });
      const messages: string[] = [];
      state.msg = (t): void => {
        messages.push(t);
      };
      const mon = addMon(state, casterRace([RSF.BA_FIRE], { spell: 100 }), loc(5, 7), {
        hp: 300,
      });
      mon.mflag.on(MFLAG.VISIBLE);
      mon.mTimed[MON_TMD.FEAR] = 10;
      updateMonsterDistances(state);
      const ran = makeRangedAttack(state, mon.midx, deps(state));
      expect(ran).toBe(true);
      const fail = messages.find((m) => m.endsWith("tries to cast a spell, but fails."));
      if (fail) {
        /* MDESC_STANDARD: capitalised definite name. */
        expect(fail.startsWith("The ")).toBe(true);
        return;
      }
    }
    throw new Error("no seed produced a spell failure");
  });

  it("a successful cast disturbs the player's run (disturb before do_mon_spell)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, casterRace([RSF.BR_FIRE], { innate: 100 }), loc(5, 7), {
      hp: 300,
    });
    updateMonsterDistances(state);
    state.run = {
      curDir: 6,
      oldDir: 6,
      openArea: true,
      breakRight: false,
      breakLeft: false,
      running: 5,
      firstStep: false,
      stepCount: 0,
    };
    const ran = makeRangedAttack(state, mon.midx, deps(state));
    expect(ran).toBe(true);
    expect(state.run.running).toBe(0);
  });
});

describe("birth_ai_learn unset_spells filter (mon-attack.c L192, mon-spell.c L470)", () => {
  it("a smart monster that knows the player is fire-immune drops its fire ball", () => {
    /* Pick a seed whose first draw does NOT trigger the one_in_(20)
     * knowledge-forget, so the memory survives to the filter. */
    let seed = 1;
    while (new Rng(seed).oneIn(20)) seed++;
    const state = makeState({ playerGrid: loc(5, 5), seed });
    state.options = {
      get: (name: string) => name === "birth_ai_learn",
    } as never;
    const race = casterRace([RSF.BA_FIRE, RSF.BA_COLD]);
    race.flags.on(RF.SMART);
    const mon = addMon(state, race, loc(5, 10));
    /* The monster has learned total fire immunity (res_level 3). */
    mon.knownPstate.elInfo[ELEM.FIRE] = 3;
    updateMonsterDistances(state);

    /* smart: learn_chance = 3 * 50 = 150 > any randint0(100): always dropped. */
    const f = mon.race.spellFlags.clone();
    removeBadSpells(state, mon, f, {}, deps(state));
    expect(f.has(RSF.BA_FIRE)).toBe(false);
    /* Cold is unknown (res 0): learn chance 0, kept. */
    expect(f.has(RSF.BA_COLD)).toBe(true);
  });

  it("without the option (or with nothing known) the spells are untouched", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = casterRace([RSF.BA_FIRE]);
    race.flags.on(RF.SMART);
    const mon = addMon(state, race, loc(5, 10));
    mon.knownPstate.elInfo[ELEM.FIRE] = 3;
    updateMonsterDistances(state);
    /* Option off: no filtering even though the memory is set. */
    const f = mon.race.spellFlags.clone();
    removeBadSpells(state, mon, f, {}, deps(state));
    expect(f.has(RSF.BA_FIRE)).toBe(true);
  });
});
