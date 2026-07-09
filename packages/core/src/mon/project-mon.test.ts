import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag";
import { MON_MSG, MON_TMD, PROJ, RF, RSF } from "../generated";
import { Rng } from "../rng";
import { bindMonsters } from "./bind";
import type { MonsterPackRecords } from "./bind";
import { blankMonster } from "./monster";
import type { Monster } from "./monster";
import type { MonsterRace } from "./types";
import { RF_SIZE, RSF_SIZE } from "./types";
import {
  MONSTER_HANDLERS,
  newMonProjectContext,
  runMonsterHandler,
} from "./project-mon";
import type { MonProjectHooks } from "./project-mon";

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

const baseRace = reg.races.find((r) => r.rarity > 0)!;

function rf(...names: number[]): FlagSet {
  const f = new FlagSet(RF_SIZE);
  for (const n of names) f.on(n);
  return f;
}

function rsf(...names: number[]): FlagSet {
  const f = new FlagSet(RSF_SIZE);
  for (const n of names) f.on(n);
  return f;
}

/** A monster whose race carries exactly the given race / spell flags. */
function mon(opts: {
  rf?: number[];
  rsf?: number[];
  hp?: number;
  maxhp?: number;
  level?: number;
}): Monster {
  const race: MonsterRace = {
    ...baseRace,
    flags: rf(...(opts.rf ?? [])),
    spellFlags: rsf(...(opts.rsf ?? [])),
    level: opts.level ?? baseRace.level,
  };
  const m = blankMonster(race);
  m.hp = opts.hp ?? 100;
  m.maxhp = opts.maxhp ?? 100;
  return m;
}

const rng = () => new Rng(1234);

/** Run one handler for `type` at `dam` against `m`, returning the context. */
function fire(
  m: Monster,
  type: number,
  dam: number,
  opts: { seen?: boolean; charm?: boolean; hooks?: MonProjectHooks } = {},
) {
  const ctx = newMonProjectContext(rng(), m, type, dam, {
    seen: opts.seen ?? true,
    charm: opts.charm ?? false,
    hooks: opts.hooks ?? {},
  });
  runMonsterHandler(ctx);
  return ctx;
}

describe("monster projection handler table", () => {
  it("has a handler for every one of the 56 PROJ types", () => {
    expect(MONSTER_HANDLERS).toHaveLength(56);
    for (let i = 0; i < 56; i++) {
      expect(typeof MONSTER_HANDLERS[i]).toBe("function");
    }
  });
});

describe("elemental resistances (project_monster_resist_element)", () => {
  it("ACID: an acid-immune monster divides damage by 9", () => {
    const ctx = fire(mon({ rf: [RF.IM_ACID] }), PROJ.ACID, 90);
    expect(ctx.dam).toBe(10);
    expect(ctx.hurtMsg).toBe(MON_MSG.RESIST_A_LOT);
  });

  it("ACID: a non-immune monster takes full damage", () => {
    const ctx = fire(mon({}), PROJ.ACID, 90);
    expect(ctx.dam).toBe(90);
    expect(ctx.hurtMsg).toBe(MON_MSG.NONE);
  });

  it("learns the resistance flag only when the effect is seen", () => {
    const seen: number[] = [];
    const hooks = { learnRaceFlag: (_m: Monster, f: number) => seen.push(f) };
    fire(mon({}), PROJ.ACID, 90, { seen: true, hooks });
    expect(seen).toContain(RF.IM_ACID);

    const unseen: number[] = [];
    fire(mon({}), PROJ.ACID, 90, {
      seen: false,
      hooks: { learnRaceFlag: (_m, f) => unseen.push(f) },
    });
    expect(unseen).toHaveLength(0);
  });
});

describe("hurt-or-immune (project_monster_hurt_immune)", () => {
  it("FIRE: an immune monster resists (dam/9)", () => {
    const ctx = fire(mon({ rf: [RF.IM_FIRE] }), PROJ.FIRE, 90);
    expect(ctx.dam).toBe(10);
    expect(ctx.hurtMsg).toBe(MON_MSG.RESIST_A_LOT);
  });

  it("FIRE: a vulnerable monster takes double and gets a death message", () => {
    const ctx = fire(mon({ rf: [RF.HURT_FIRE] }), PROJ.FIRE, 50);
    expect(ctx.dam).toBe(100);
    expect(ctx.hurtMsg).toBe(MON_MSG.CATCH_FIRE);
    expect(ctx.dieMsg).toBe(MON_MSG.DISINTEGRATES);
  });

  it("COLD: a plain monster is unaffected by the flag branches", () => {
    const ctx = fire(mon({}), PROJ.COLD, 50);
    expect(ctx.dam).toBe(50);
  });
});

describe("hurt-only (project_monster_hurt_only)", () => {
  it("LIGHT_WEAK: a light-vulnerable monster is hurt", () => {
    const ctx = fire(mon({ rf: [RF.HURT_LIGHT] }), PROJ.LIGHT_WEAK, 40);
    expect(ctx.dam).toBe(40);
    expect(ctx.hurtMsg).toBe(MON_MSG.CRINGE_LIGHT);
    expect(ctx.dieMsg).toBe(MON_MSG.SHRIVEL_LIGHT);
  });

  it("LIGHT_WEAK: a non-susceptible monster takes no damage", () => {
    const ctx = fire(mon({}), PROJ.LIGHT_WEAK, 40);
    expect(ctx.dam).toBe(0);
  });
});

describe("breath resistance (project_monster_breath)", () => {
  it("DARK: a dark-breather resists and the damage drops below base", () => {
    const learned: number[] = [];
    const ctx = fire(mon({ rsf: [RSF.BR_DARK] }), PROJ.DARK, 100, {
      hooks: { learnSpellFlag: (_m, f) => learned.push(f) },
    });
    expect(ctx.hurtMsg).toBe(MON_MSG.RESIST);
    expect(ctx.dam).toBeGreaterThan(0);
    expect(ctx.dam).toBeLessThan(100);
    expect(learned).toContain(RSF.BR_DARK);
  });

  it("DARK: a non-breather takes full damage", () => {
    const ctx = fire(mon({}), PROJ.DARK, 100);
    expect(ctx.dam).toBe(100);
    expect(ctx.hurtMsg).toBe(MON_MSG.NONE);
  });
});

describe("NETHER", () => {
  it("undead are immune", () => {
    const ctx = fire(mon({ rf: [RF.UNDEAD] }), PROJ.NETHER, 80);
    expect(ctx.dam).toBe(0);
    expect(ctx.hurtMsg).toBe(MON_MSG.IMMUNE);
  });

  it("evil monsters take half", () => {
    const ctx = fire(mon({ rf: [RF.EVIL] }), PROJ.NETHER, 80);
    expect(ctx.dam).toBe(40);
    expect(ctx.hurtMsg).toBe(MON_MSG.RESIST_SOMEWHAT);
  });

  it("a plain living monster takes full damage", () => {
    const ctx = fire(mon({}), PROJ.NETHER, 80);
    expect(ctx.dam).toBe(80);
  });
});

describe("WATER immunity (project_monster_resist_other, factor 0)", () => {
  it("a water-immune monster takes no damage", () => {
    const ctx = fire(mon({ rf: [RF.IM_WATER] }), PROJ.WATER, 60);
    expect(ctx.dam).toBe(0);
    expect(ctx.hurtMsg).toBe(MON_MSG.IMMUNE);
  });

  it("others take full water damage", () => {
    const ctx = fire(mon({}), PROJ.WATER, 60);
    expect(ctx.dam).toBe(60);
  });
});

describe("HOLY_ORB (resist_other, hurts evil)", () => {
  it("evil monsters take double damage", () => {
    const ctx = fire(mon({ rf: [RF.EVIL] }), PROJ.HOLY_ORB, 30);
    expect(ctx.dam).toBe(60);
    expect(ctx.hurtMsg).toBe(MON_MSG.HIT_HARD);
  });
});

describe("teleport-away (project_monster_teleport_away)", () => {
  it("AWAY_UNDEAD teleports an undead, wakes it, and deals no damage", () => {
    const m = mon({ rf: [RF.UNDEAD] });
    m.mTimed[MON_TMD.SLEEP] = 20;
    const ctx = fire(m, PROJ.AWAY_UNDEAD, 25);
    expect(ctx.teleportDistance).toBe(25);
    expect(ctx.dam).toBe(0);
    expect(ctx.hurtMsg).toBe(MON_MSG.DISAPPEAR);
    expect(ctx.obvious).toBe(true);
    expect(m.mTimed[MON_TMD.SLEEP]).toBe(0);
    expect(ctx.skipped).toBe(false);
  });

  it("AWAY_UNDEAD skips a non-undead monster", () => {
    const ctx = fire(mon({}), PROJ.AWAY_UNDEAD, 25);
    expect(ctx.skipped).toBe(true);
    expect(ctx.teleportDistance).toBe(0);
    expect(ctx.dam).toBe(0);
  });

  it("AWAY_ALL always teleports, using dam as the distance", () => {
    const ctx = fire(mon({}), PROJ.AWAY_ALL, 33);
    expect(ctx.teleportDistance).toBe(33);
    expect(ctx.dam).toBe(0);
    expect(ctx.hurtMsg).toBe(MON_MSG.DISAPPEAR);
  });
});

describe("scare (project_monster_scare)", () => {
  it("TURN_EVIL frightens an evil monster and wakes it", () => {
    const m = mon({ rf: [RF.EVIL] });
    m.mTimed[MON_TMD.SLEEP] = 20;
    const ctx = fire(m, PROJ.TURN_EVIL, 12);
    expect(ctx.monTimed[MON_TMD.FEAR]).toBe(12);
    expect(ctx.dam).toBe(0);
    expect(ctx.obvious).toBe(true);
    expect(m.mTimed[MON_TMD.SLEEP]).toBe(0);
  });

  it("TURN_EVIL skips a non-evil monster", () => {
    const ctx = fire(mon({}), PROJ.TURN_EVIL, 12);
    expect(ctx.skipped).toBe(true);
    expect(ctx.monTimed[MON_TMD.FEAR]).toBe(0);
  });

  it("TURN_LIVING frightens the living, skips the nonliving", () => {
    const living = fire(mon({}), PROJ.TURN_LIVING, 15);
    expect(living.monTimed[MON_TMD.FEAR]).toBe(15);
    expect(living.dam).toBe(0);

    const dead = fire(mon({ rf: [RF.NONLIVING] }), PROJ.TURN_LIVING, 15);
    expect(dead.skipped).toBe(true);
    expect(dead.monTimed[MON_TMD.FEAR]).toBe(0);
  });
});

describe("dispel (project_monster_dispel)", () => {
  it("DISP_EVIL hits an evil monster with dispel messaging", () => {
    const ctx = fire(mon({ rf: [RF.EVIL] }), PROJ.DISP_EVIL, 40);
    expect(ctx.dam).toBe(40);
    expect(ctx.hurtMsg).toBe(MON_MSG.SHUDDER);
    expect(ctx.dieMsg).toBe(MON_MSG.DISSOLVE);
    expect(ctx.skipped).toBe(false);
  });

  it("DISP_EVIL skips a non-evil monster and zeroes damage", () => {
    const ctx = fire(mon({}), PROJ.DISP_EVIL, 40);
    expect(ctx.skipped).toBe(true);
    expect(ctx.dam).toBe(0);
  });

  it("DISP_ALL always hits", () => {
    const ctx = fire(mon({}), PROJ.DISP_ALL, 40);
    expect(ctx.dam).toBe(40);
    expect(ctx.hurtMsg).toBe(MON_MSG.SHUDDER);
  });
});

describe("sleep (project_monster_sleep)", () => {
  it("SLEEP_ALL sets the sleep timer for any monster", () => {
    const ctx = fire(mon({}), PROJ.SLEEP_ALL, 18);
    expect(ctx.monTimed[MON_TMD.SLEEP]).toBe(18);
    expect(ctx.dam).toBe(0);
    expect(ctx.obvious).toBe(true);
  });

  it("SLEEP_UNDEAD skips a non-undead monster", () => {
    const ctx = fire(mon({}), PROJ.SLEEP_UNDEAD, 18);
    expect(ctx.skipped).toBe(true);
    expect(ctx.monTimed[MON_TMD.SLEEP]).toBe(0);
  });
});

describe("status projections (dam becomes power)", () => {
  it("MON_SLOW sets the slow timer and zeroes damage", () => {
    const ctx = fire(mon({}), PROJ.MON_SLOW, 20);
    expect(ctx.monTimed[MON_TMD.SLOW]).toBe(20);
    expect(ctx.dam).toBe(0);
  });

  it("MON_CONF / MON_HOLD / MON_STUN set their own timers", () => {
    expect(fire(mon({}), PROJ.MON_CONF, 7).monTimed[MON_TMD.CONF]).toBe(7);
    expect(fire(mon({}), PROJ.MON_HOLD, 8).monTimed[MON_TMD.HOLD]).toBe(8);
    expect(fire(mon({}), PROJ.MON_STUN, 9).monTimed[MON_TMD.STUN]).toBe(9);
  });

  it("MON_SPEED sets the haste timer", () => {
    const ctx = fire(mon({}), PROJ.MON_SPEED, 30);
    expect(ctx.monTimed[MON_TMD.FAST]).toBe(30);
  });

  it("a charming player boosts effects against animals by half", () => {
    const ctx = fire(mon({ rf: [RF.ANIMAL] }), PROJ.MON_SLOW, 20, {
      charm: true,
    });
    expect(ctx.monTimed[MON_TMD.SLOW]).toBe(30);
  });
});

describe("MON_POLY / MON_HEAL / MON_CLONE", () => {
  it("MON_POLY records the polymorph power and deals no damage", () => {
    const ctx = fire(mon({}), PROJ.MON_POLY, 22);
    expect(ctx.doPoly).toBe(22);
    expect(ctx.dam).toBe(0);
  });

  it("MON_HEAL restores hp up to the maximum", () => {
    const m = mon({ hp: 30, maxhp: 100 });
    const ctx = fire(m, PROJ.MON_HEAL, 1000);
    expect(m.hp).toBe(100);
    expect(ctx.hurtMsg).toBe(MON_MSG.HEALTHIER);
    expect(ctx.dam).toBe(0);
  });

  it("MON_CLONE heals fully, hastes, and clones via the hook", () => {
    const m = mon({ hp: 40, maxhp: 100 });
    let cloned: Monster | null = null;
    const ctx = fire(m, PROJ.MON_CLONE, 0, {
      hooks: {
        multiplyMonster: (mm) => {
          cloned = mm;
          return true;
        },
      },
    });
    expect(m.hp).toBe(100);
    expect(m.mTimed[MON_TMD.FAST]).toBeGreaterThan(0);
    expect(cloned).toBe(m);
    expect(ctx.hurtMsg).toBe(MON_MSG.SPAWN);
  });
});

describe("MON_DRAIN / MON_CRUSH", () => {
  it("MON_DRAIN affects the living but not the nonliving", () => {
    const living = fire(mon({}), PROJ.MON_DRAIN, 25);
    expect(living.dam).toBe(25);
    expect(living.obvious).toBe(true);

    const dead = fire(mon({ rf: [RF.NONLIVING] }), PROJ.MON_DRAIN, 25);
    expect(dead.dam).toBe(0);
    expect(dead.obvious).toBe(false);
    expect(dead.hurtMsg).toBe(MON_MSG.UNAFFECTED);
  });

  it("MON_CRUSH kills below the hp threshold, spares at/above it", () => {
    const weak = fire(mon({ hp: 10 }), PROJ.MON_CRUSH, 30);
    expect(weak.dam).toBe(30);
    expect(weak.skipped).toBe(false);

    const tough = fire(mon({ hp: 50 }), PROJ.MON_CRUSH, 30);
    expect(tough.skipped).toBe(true);
    expect(tough.dam).toBe(0);
    expect(tough.hurtMsg).toBe(MON_MSG.UNAFFECTED);
  });
});

describe("CHAOS / FORCE side-effect requests", () => {
  it("CHAOS confuses and flags polymorph, but not on chaos breathers", () => {
    const plain = fire(mon({}), PROJ.CHAOS, 60);
    expect(plain.doPoly).toBe(1);
    expect(plain.monTimed[MON_TMD.CONF]).toBeGreaterThan(0);
    expect(plain.hurtMsg).toBe(MON_MSG.NONE);

    const breather = fire(mon({ rsf: [RSF.BR_CHAO] }), PROJ.CHAOS, 60);
    expect(breather.doPoly).toBe(0);
  });

  it("FORCE requests a thrust for non-breathers only", () => {
    const plain = fire(mon({}), PROJ.FORCE, 100);
    expect(plain.thrustGridsAway).toBe(3 + Math.trunc(100 / 20));

    const breather = fire(mon({ rsf: [RSF.BR_WALL] }), PROJ.FORCE, 100);
    expect(breather.thrustGridsAway).toBe(0);
  });
});

describe("feature-only and no-op projections", () => {
  it("KILL_DOOR does nothing to a monster", () => {
    const ctx = fire(mon({}), PROJ.KILL_DOOR, 50);
    expect(ctx.skipped).toBe(true);
    expect(ctx.dam).toBe(0);
  });

  it("METEOR applies raw damage with no special handling", () => {
    const ctx = fire(mon({}), PROJ.METEOR, 77);
    expect(ctx.dam).toBe(77);
    expect(ctx.skipped).toBe(false);
    expect(ctx.hurtMsg).toBe(MON_MSG.NONE);
  });
});
