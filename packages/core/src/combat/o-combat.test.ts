/**
 * O-combat (birth_percent_damage) melee/ranged damage tests: prove the O
 * formula (crit adds DICE, deadliness/multiplier add SIDES) draws RNG in the
 * documented order, and prove the option gate is inert on the default path.
 *
 * Ported behaviour verified against reference/src/player-attack.c
 * o_melee_damage (L501) / o_ranged_damage (L590) / o_critical_melee (L439) /
 * o_critical_shot (L351), cross-checked against the display estimate in
 * obj/object-info.ts (oObjKnownDamage / oCalcCrits / applyDeadliness).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RF } from "../generated";
import { FlagSet } from "../bitflag";
import { Rng } from "../rng";
import { bindMonsters } from "../mon/bind";
import type { MonsterPackRecords } from "../mon/bind";
import { blankMonster } from "../mon/monster";
import type { Monster } from "../mon/monster";
import { RF_SIZE } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson, ObjectKind, Slay } from "../obj/types";
import { objectNew, tvalIsMeleeWeapon } from "../obj/object";
import type { GameObject } from "../obj/object";
import { bindPlayer } from "../player/bind";
import type { PlayerPackRecords } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { SKILL, SKILL_MAX } from "../player/types";
import type { PlayerCombatState } from "./melee";
import { oMeleeDamage, pyAttackReal } from "./melee";
import { oRangedDamage, makeRangedShot } from "./ranged";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}
function packJson<T>(name: string): T[] {
  return (load(name) as { records: T[] }).records;
}

const monReg = bindMonsters({
  pain: packJson("pain"),
  blowMethods: packJson("blow_methods"),
  blowEffects: packJson("blow_effects"),
  monsterSpells: packJson("monster_spell"),
  monsterBases: packJson("monster_base"),
  monsters: packJson("monster"),
  summons: packJson("summon"),
  pits: packJson("pit"),
} as MonsterPackRecords);

const objReg = new ObjRegistry({
  objectBase: load("object_base"),
  object: load("object"),
  egoItem: load("ego_item"),
  artifact: load("artifact"),
  curse: load("curse"),
  brand: load("brand"),
  slay: load("slay"),
  activation: load("activation"),
  objectProperty: load("object_property"),
  flavor: load("flavor"),
} as ObjPackJson);

const plReg = bindPlayer({
  races: packJson("p_race"),
  classes: packJson("class"),
  properties: packJson("player_property"),
  timed: packJson("player_timed"),
  shapes: packJson("shape"),
  bodies: packJson("body"),
  history: packJson("history"),
  realms: packJson("realm"),
} as PlayerPackRecords);

const anyKind = objReg.kinds.find((k): k is ObjectKind => !!k) as ObjectKind;
const weaponKind = objReg.kinds.find(
  (k): k is ObjectKind => !!k && tvalIsMeleeWeapon(k.tval),
) as ObjectKind;
const realRace = monReg.races.find((r) => r.base) as MonsterRace;

const undeadSlay = objReg.slays.findIndex(
  (s) => s !== null && s.raceFlag === RF.UNDEAD,
);
const undeadOMult = (objReg.slays[undeadSlay] as Slay).oMultiplier;

/** deadliness_conversion index used for a deadliness of 8. */
const DL8 = 33;

function player(): Player {
  const p = blankPlayer(
    plReg.races[0] as (typeof plReg.races)[number],
    plReg.classes[0] as (typeof plReg.classes)[number],
    plReg.bodies[0] as (typeof plReg.bodies)[number],
  );
  p.lev = 1;
  return p;
}

function state(overrides: Partial<PlayerCombatState> = {}): PlayerCombatState {
  return {
    toH: 0,
    toD: 5,
    ac: 0,
    toA: 0,
    skills: new Array<number>(SKILL_MAX).fill(0),
    numBlows: 100,
    ammoMult: 3,
    numShots: 10,
    ammoTval: 0,
    blessWield: false,
    ...overrides,
  };
}

function undeadMon(): Monster {
  const flags = new FlagSet(RF_SIZE);
  flags.on(RF.UNDEAD);
  const race: MonsterRace = { ...realRace, ac: 10, level: 5, flags };
  const mon = blankMonster(race);
  mon.hp = 100000;
  mon.maxhp = 100000;
  return mon;
}

/** A 2d6 (+0 to-hit, +3 to-dam) weapon carrying a slay-undead rune. */
function undeadSlayer(): GameObject {
  const o = objectNew(weaponKind);
  o.dd = 2;
  o.ds = 6;
  o.toH = 0;
  o.toD = 3;
  o.weight = 40;
  o.slays = new Array<boolean>(objReg.slays.length).fill(false);
  o.slays[undeadSlay] = true;
  return o;
}

function ammo(): GameObject {
  const o = objectNew(anyKind);
  o.dd = 1;
  o.ds = 4;
  o.weight = 2;
  return o;
}
function launcher(): GameObject {
  const o = objectNew(anyKind);
  o.weight = 30;
  return o;
}

/**
 * Log the atomic RNG draws (randint0 / randint1) a call makes, in order.
 * one_in_ and damroll are built on these two primitives, so their internal
 * draws surface here too - which is exactly the draw order under test.
 */
function recordDraws(rng: Rng): string[] {
  const log: string[] = [];
  const r0 = rng.randint0.bind(rng);
  const r1 = rng.randint1.bind(rng);
  (rng as unknown as { randint0: (m: number) => number }).randint0 = (m) => {
    log.push(`randint0(${m})`);
    return r0(m);
  };
  (rng as unknown as { randint1: (m: number) => number }).randint1 = (m) => {
    log.push(`randint1(${m})`);
    return r1(m);
  };
  return log;
}

describe("oMeleeDamage (o_melee_damage / o_critical_melee)", () => {
  it("draws in order: frac-sides randint0, crit-test randint1, level walk, damroll", () => {
    const rng = new Rng(1);
    rng.randFix(0); // randint0(m)=0, randint1(m)=1, one_in_ always true
    const log = recordDraws(rng);

    /* melee to-hit skill 60 -> crit power = trunc(60/3) = 20 > 0, so with
     * randint1(chance_den)=1 <= 20 a critical always fires here. */
    const s = state({ skills: withSkill(SKILL.TO_HIT_MELEE, 60), toD: 5 });
    const res = oMeleeDamage(
      rng,
      s,
      undeadMon(),
      undeadSlayer(),
      0,
      undeadSlay,
      objReg.brands,
      objReg.slays,
    );

    /* sides: dieAverage = (10*(6+1))/2 = 35; *oMult; deadliness = to_d(5) +
     * weapon to-dam(3) = 8 -> *(100+33); sides = 2*that - 10000, +1 frac. */
    const dieAverage = 35 * undeadOMult * (100 + DL8);
    const raw = 2 * dieAverage - 10000;
    const sides = Math.trunc(raw / 10000) + (raw % 10000 > 0 ? 1 : 0);

    /* Head o-melee-critical-level adds 5 dice (HIT_HI_SUPERB). */
    const dice = 2 + 5;

    /* chance_den = trunc(60/3)*1 + 240 = 260. Level walk: one_in_(40). */
    expect(log.slice(0, 3)).toEqual([
      "randint0(10000)",
      "randint1(260)",
      "randint0(40)",
    ]);
    expect(log.slice(3)).toEqual(
      new Array<string>(dice).fill(`randint1(${sides})`),
    );
    expect(log.length).toBe(3 + dice);

    /* Deadliness/mult inflated the sides well beyond the weapon's base 6. */
    expect(sides).toBeGreaterThan(6);
    /* With fixed rolls of 1, damroll(dice, sides) = dice; add = oMult - 10. */
    expect(res.damage).toBe(dice + (undeadOMult - 10));
    expect(res.msg).toBe("HIT_HI_SUPERB");
  });

  it("is deterministic for a given seed", () => {
    const mk = (): ReturnType<typeof oMeleeDamage> =>
      oMeleeDamage(
        new Rng(12345),
        state({ skills: withSkill(SKILL.TO_HIT_MELEE, 40) }),
        undeadMon(),
        undeadSlayer(),
        0,
        undeadSlay,
        objReg.brands,
        objReg.slays,
      );
    expect(mk()).toEqual(mk());
  });
});

describe("oRangedDamage (o_ranged_damage / o_critical_shot)", () => {
  it("launcher shot draws frac-sides, crit test, level walk, then damroll", () => {
    const rng = new Rng(1);
    rng.randFix(0);
    const log = recordDraws(rng);

    const s = state({ skills: withSkill(SKILL.TO_HIT_BOW, 60), toD: 0 });
    const res = oRangedDamage(
      rng,
      s,
      undeadMon(),
      ammo(),
      launcher(),
      0,
      0,
      objReg.brands,
      objReg.slays,
    );

    /* dieAverage = (10*(4+1))/2 = 25; *ammoMult(3); no slay -> *10; deadliness
     * = 0 -> *(100). sides = 2*(25*3*10*100) - 10000 = 140000; /10000 = 14. */
    const sides = 14;
    const dice = 1 + 3; // head o-ranged-critical-level adds 3 (HIT_SUPERB)

    /* chance_den = power(60)*1 + 360 = 420. Level walk: one_in_(50). */
    expect(log.slice(0, 3)).toEqual([
      "randint0(10000)",
      "randint1(420)",
      "randint0(50)",
    ]);
    expect(log.slice(3)).toEqual(
      new Array<string>(dice).fill(`randint1(${sides})`),
    );
    /* Launcher multiplier inflated sides from the ammo's base 4 to 14. */
    expect(sides).toBeGreaterThan(4);
    expect(res.damage).toBe(dice); // add = 0, each rolled die = 1
    expect(res.msg).toBe("HIT_SUPERB");
  });
});

describe("birth_percent_damage gate", () => {
  it("melee: OFF path is byte-identical whether the flag is false or omitted", () => {
    const run = (opts: Record<string, unknown>): { blow: unknown; s: unknown } => {
      const rng = new Rng(777);
      const blow = pyAttackReal(
        rng,
        player(),
        state({ skills: withSkill(SKILL.TO_HIT_MELEE, 40) }),
        undeadSlayer(),
        undeadMon(),
        objReg.brands,
        objReg.slays,
        { monVisible: true, ...opts },
      );
      return { blow, s: rng.getState() };
    };
    const omitted = run({});
    const explicitFalse = run({ percentDamage: false });
    /* Same result AND same RNG end-state: the gate adds/reorders no draws. */
    expect(explicitFalse.blow).toEqual(omitted.blow);
    expect(explicitFalse.s).toEqual(omitted.s);
  });

  it("melee: ON diverges from OFF (different formula, different RNG usage)", () => {
    const attack = (percentDamage: boolean): { blow: unknown; s: unknown } => {
      const rng = new Rng(2024);
      const blow = pyAttackReal(
        rng,
        player(),
        state({ skills: withSkill(SKILL.TO_HIT_MELEE, 40), toD: 8 }),
        undeadSlayer(),
        undeadMon(),
        objReg.brands,
        objReg.slays,
        { monVisible: true, percentDamage },
      );
      return { blow, s: rng.getState() };
    };
    const off = attack(false);
    const on = attack(true);
    expect(on.s).not.toEqual(off.s); // the O path draws differently
    expect(on.blow).not.toEqual(off.blow);
  });

  it("melee ON is deterministic for a given seed", () => {
    const attack = (): unknown => {
      const rng = new Rng(2024);
      return pyAttackReal(
        rng,
        player(),
        state({ skills: withSkill(SKILL.TO_HIT_MELEE, 40), toD: 8 }),
        undeadSlayer(),
        undeadMon(),
        objReg.brands,
        objReg.slays,
        { monVisible: true, percentDamage: true },
      );
    };
    expect(attack()).toEqual(attack());
  });

  it("ranged: ON diverges from OFF and OFF matches the default", () => {
    const shoot = (percentDamage: boolean): { res: unknown; s: unknown } => {
      const rng = new Rng(55);
      const res = makeRangedShot(
        rng,
        player(),
        state({ skills: withSkill(SKILL.TO_HIT_BOW, 40) }),
        ammo(),
        launcher(),
        undeadMon(),
        objReg.brands,
        objReg.slays,
        1,
        true,
        percentDamage,
      );
      return { res, s: rng.getState() };
    };
    /* Default (no flag) equals explicit OFF. */
    const rngD = new Rng(55);
    const dflt = makeRangedShot(
      rngD,
      player(),
      state({ skills: withSkill(SKILL.TO_HIT_BOW, 40) }),
      ammo(),
      launcher(),
      undeadMon(),
      objReg.brands,
      objReg.slays,
      1,
      true,
    );
    const off = shoot(false);
    const on = shoot(true);
    expect(off.res).toEqual(dflt);
    expect(on.s).not.toEqual(off.s);
  });
});

/** Build a skills array with one skill index set. */
function withSkill(idx: number, value: number): number[] {
  const skills = new Array<number>(SKILL_MAX).fill(0);
  skills[idx] = value;
  return skills;
}
