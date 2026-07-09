import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, MON_TMD, RF } from "../generated";
import { Rng } from "../rng";
import { bindMonsters } from "./bind";
import type { MonsterPackRecords } from "./bind";
import { blankMonster } from "./monster";
import {
  MON_TMD_FLG_NOFAIL,
  monClearTimed,
  monDecTimed,
  monIncTimed,
  monsterEffectLevel,
  monTimedNameToIdx,
} from "./timed";
import type { MonsterRace } from "./types";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: T[] };
  return parsed.records;
}

const reg = bindMonsters({
  pain: packJson("pain"),
  blowMethods: packJson("blow_methods"),
  blowEffects: packJson("blow_effects"),
  monsterSpells: packJson("monster_spell"),
  monsterBases: packJson("monster_base"),
  monsters: packJson("monster"),
  summons: packJson("summon"),
  pits: packJson("pit"),
} as MonsterPackRecords);

function raceWhere(pred: (r: MonsterRace) => boolean): MonsterRace {
  const r = reg.races.find((rr) => rr.rarity > 0 && pred(rr));
  if (!r) throw new Error("no race matched predicate");
  return r;
}

/** A vanilla, stun-and-sleep-vulnerable race for the non-resist paths. */
function plainMonster() {
  return blankMonster(
    raceWhere(
      (r) =>
        !r.flags.has(RF.NO_STUN) &&
        !r.flags.has(RF.NO_SLEEP) &&
        !r.flags.has(RF.UNIQUE),
    ),
  );
}

const rng = () => new Rng(99);

describe("mon_inc/dec/clear_timed (mon-timed.c)", () => {
  it("sets a non-resisted effect and clamps at its max timer", () => {
    const mon = plainMonster();
    // STUN: save=false, resist RF_NO_STUN (absent here) -> always applies.
    expect(monIncTimed(rng(), mon, MON_TMD.STUN, 10)).toBe(true);
    expect(mon.mTimed[MON_TMD.STUN]).toBe(10);
    // Clamp to max_timer (50 for STUN).
    monIncTimed(rng(), mon, MON_TMD.STUN, 1000);
    expect(mon.mTimed[MON_TMD.STUN]).toBe(50);
  });

  it("a flag-immune monster resists (timer stays 0)", () => {
    const mon = blankMonster(raceWhere((r) => r.flags.has(RF.NO_STUN)));
    expect(monIncTimed(rng(), mon, MON_TMD.STUN, 10)).toBe(false);
    expect(mon.mTimed[MON_TMD.STUN]).toBe(0);
  });

  it("MON_TMD_FLG_NOFAIL forces the effect even on an immune monster", () => {
    const mon = blankMonster(raceWhere((r) => r.flags.has(RF.NO_SLEEP)));
    expect(
      monIncTimed(rng(), mon, MON_TMD.SLEEP, 20, MON_TMD_FLG_NOFAIL),
    ).toBe(true);
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(20);
  });

  it("gives a new effect at least MON_INC_MIN_TURNS (2)", () => {
    const mon = plainMonster();
    monIncTimed(rng(), mon, MON_TMD.STUN, 1);
    expect(mon.mTimed[MON_TMD.STUN]).toBe(2);
  });

  it("stacks per the effect rule: FEAR adds, STUN maxes, SLEEP holds", () => {
    // FEAR: INCR
    const f = plainMonster();
    monIncTimed(rng(), f, MON_TMD.FEAR, 5);
    monIncTimed(rng(), f, MON_TMD.FEAR, 5, MON_TMD_FLG_NOFAIL);
    expect(f.mTimed[MON_TMD.FEAR]).toBe(10);
    // STUN: MAX
    const s = plainMonster();
    monIncTimed(rng(), s, MON_TMD.STUN, 8);
    monIncTimed(rng(), s, MON_TMD.STUN, 3);
    expect(s.mTimed[MON_TMD.STUN]).toBe(8);
    // SLEEP: NO (a second increase does not add while active)
    const z = plainMonster();
    monIncTimed(rng(), z, MON_TMD.SLEEP, 30, MON_TMD_FLG_NOFAIL);
    monIncTimed(rng(), z, MON_TMD.SLEEP, 30, MON_TMD_FLG_NOFAIL);
    expect(z.mTimed[MON_TMD.SLEEP]).toBe(30);
  });

  it("decreases floor at 0 and clear reports whether it changed", () => {
    const mon = plainMonster();
    monIncTimed(rng(), mon, MON_TMD.STUN, 10);
    expect(monDecTimed(rng(), mon, MON_TMD.STUN, 4)).toBe(true);
    expect(mon.mTimed[MON_TMD.STUN]).toBe(6);
    monDecTimed(rng(), mon, MON_TMD.STUN, 100);
    expect(mon.mTimed[MON_TMD.STUN]).toBe(0);
    expect(monClearTimed(rng(), mon, MON_TMD.STUN)).toBe(false); // already 0
  });

  it("fires the message sink when a seen monster gains an effect", () => {
    const mon = plainMonster();
    mon.mflag.on(MFLAG.VISIBLE);
    const notes: string[] = [];
    monIncTimed(rng(), mon, MON_TMD.STUN, 10, 0, (_m, note) => notes.push(note));
    expect(notes).toEqual(["MON_MSG_DAZED"]);
  });

  it("clearing COMMAND drops the monster's stale target", () => {
    const mon = plainMonster();
    monIncTimed(rng(), mon, MON_TMD.COMMAND, 10, MON_TMD_FLG_NOFAIL);
    mon.target.midx = 42;
    monClearTimed(rng(), mon, MON_TMD.COMMAND);
    expect(mon.target.midx).toBe(0);
  });

  it("monster_effect_level bands the timer 0..5 and name lookup works", () => {
    const mon = plainMonster();
    expect(monsterEffectLevel(mon, MON_TMD.STUN)).toBe(0);
    monIncTimed(rng(), mon, MON_TMD.STUN, 50); // max
    expect(monsterEffectLevel(mon, MON_TMD.STUN)).toBe(5);
    expect(monTimedNameToIdx("CONF")).toBe(MON_TMD.CONF);
    expect(monTimedNameToIdx("NOPE")).toBe(-1);
  });
});
