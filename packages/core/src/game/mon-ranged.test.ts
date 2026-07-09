import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, MON_TMD, RF, RSF } from "../generated";
import { FlagSet } from "../bitflag";
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
