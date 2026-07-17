import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, MON_TMD, RF } from "../generated";
import { Rng } from "../rng";
import { bindMonsters } from "./bind";
import type { MonsterPackRecords } from "./bind";
import { blankMonster } from "./monster";
import type { Monster } from "./monster";
import type { MonsterRace } from "./types";
import { monTakeHit, monsterScaredByDamage, monsterWake } from "./take-hit";

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

/** A scare-able (not NO_FEAR, non-unique) monster with the given hp. */
function scareable(hp: number): Monster {
  const mon = blankMonster(
    raceWhere((r) => !r.flags.has(RF.NO_FEAR) && !r.flags.has(RF.UNIQUE)),
  );
  mon.hp = hp;
  mon.maxhp = hp;
  return mon;
}

/** A fearless (NO_FEAR) monster with the given hp. */
function fearless(hp: number): Monster {
  const mon = blankMonster(raceWhere((r) => r.flags.has(RF.NO_FEAR)));
  mon.hp = hp;
  mon.maxhp = hp;
  return mon;
}

const rng = () => new Rng(1234);

describe("monsterWake (mon-util.c)", () => {
  it("clears sleep and makes the monster aware", () => {
    const mon = scareable(50);
    mon.mTimed[MON_TMD.SLEEP] = 20;
    monsterWake(rng(), mon, false, 100); // 100% aware chance
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0);
    expect(mon.mflag.has(MFLAG.AWARE)).toBe(true);
  });
});

describe("monTakeHit (mon-util.c)", () => {
  it("wakes and clears Hold on a non-fatal blow, and reduces hp", () => {
    const mon = scareable(50);
    mon.mTimed[MON_TMD.SLEEP] = 20;
    mon.mTimed[MON_TMD.HOLD] = 10;
    const res = monTakeHit(rng(), mon, 15, null);
    expect(res.died).toBe(false);
    expect(mon.hp).toBe(35);
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0);
    expect(mon.mTimed[MON_TMD.HOLD]).toBe(0);
    expect(mon.mflag.has(MFLAG.AWARE)).toBe(true);
  });

  it("kills the monster and runs onKill when hp drops below zero", () => {
    const mon = scareable(10);
    let killed: string | null | undefined;
    const res = monTakeHit(rng(), mon, 25, "dies", {
      onKill: (_m, note) => {
        killed = note;
      },
    });
    expect(res.died).toBe(true);
    expect(killed).toBe("dies");
  });

  it("leaves a monster alive at exactly zero hp (dam == hp)", () => {
    const mon = scareable(10);
    const res = monTakeHit(rng(), mon, 10, null);
    expect(res.died).toBe(false);
    expect(mon.hp).toBe(0);
  });

  it("breaks cover tracks only when damage is dealt", () => {
    let broken = 0;
    monTakeHit(rng(), scareable(50), 0, null, {
      coverTracksBroken: () => broken++,
    });
    expect(broken).toBe(0); // zero damage: no break
    monTakeHit(rng(), scareable(50), 5, null, {
      coverTracksBroken: () => broken++,
    });
    expect(broken).toBe(1);
  });

  it("reveals a camouflaged mimic via becomeAware", () => {
    const mon = scareable(50);
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    let revealed = false;
    monTakeHit(rng(), mon, 5, null, {
      becomeAware: () => {
        revealed = true;
      },
    });
    expect(revealed).toBe(true);
  });

  it("never frightens a NO_FEAR monster", () => {
    const mon = fearless(4); // low hp, big hit -> would scare a normal monster
    const res = monTakeHit(rng(), mon, 3, null);
    expect(res.fear).toBe(false);
    expect(mon.mTimed[MON_TMD.FEAR]).toBe(0);
  });
});

describe("monsterScaredByDamage (mon-util.c)", () => {
  it("cures existing fear when the pain roll meets it", () => {
    const mon = scareable(50);
    mon.mTimed[MON_TMD.FEAR] = 1; // randint1(dam) >= 1 always -> cured
    const scared = monsterScaredByDamage(rng(), mon, 5);
    expect(scared).toBe(false);
    expect(mon.mTimed[MON_TMD.FEAR]).toBe(0);
  });

  it("reduces but does not cure larger existing fear on light pain", () => {
    const mon = scareable(50);
    mon.mTimed[MON_TMD.FEAR] = 10; // randint1(1) == 1 < 10 -> reduce by 1
    const scared = monsterScaredByDamage(rng(), mon, 1);
    expect(scared).toBe(false);
    expect(mon.mTimed[MON_TMD.FEAR]).toBe(9);
  });
});

describe("group fear-save (mon-predicate.c L296 via monster_scared_by_damage)", () => {
  it("a big enough primary group always saves at least once across seeds", () => {
    /* count = groupSize - 1 one-in-20 saves; with 200 members the chance of
     * never saving is (19/20)^199, so any seed realistically saves. */
    const mon = scareable(100);
    mon.hp = 2; /* 2% health: low_hp check passes for most rolls */
    let anySaved = false;
    for (let seed = 1; seed <= 20; seed++) {
      const scared = monsterScaredByDamage(new Rng(seed), mon, 1, 200);
      if (!scared) anySaved = true;
      mon.mTimed[MON_TMD.FEAR] = 0; /* reset for the next roll */
    }
    expect(anySaved).toBe(true);
  });

  it("monTakeHit threads hooks.primaryGroupSize into the fear roll", () => {
    /* With an enormous group, the per-member one-in-20 save practically
     * guarantees no fear; a lone monster with the same stream does panic. */
    const seed = 7;
    const lone = scareable(100);
    lone.hp = 100;
    const resLone = monTakeHit(new Rng(seed), lone, 99, null, {});

    const grouped = scareable(100);
    grouped.hp = 100;
    const resGroup = monTakeHit(new Rng(seed), grouped, 99, null, {
      primaryGroupSize: () => 10000,
    });

    /* Same damage, same seed: the lone one may or may not panic, but the
     * grouped one must not (a 1-in-20 save fires within 10000 draws). */
    expect(resGroup.fear).toBe(false);
    expect(typeof resLone.fear).toBe("boolean");
  });
});
