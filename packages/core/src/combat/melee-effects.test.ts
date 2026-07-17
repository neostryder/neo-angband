/**
 * Locks the py_attack side-effect suite (gaps 2.4 / 2.5), ported from
 * reference/src/player-attack.c (Angband 4.2.6):
 * - monster fear generation via mon_take_hit (player-attack.c:868,
 *   mon-util.c:1137 monster_scared_by_damage) and the delayed
 *   "flees in terror" condition (player-attack.c:1023).
 * - the pre-blow monster wake (player-attack.c:759).
 * - blow_side_effects TMD_ATT_CONF (player-attack.c:669-678).
 * - the TMD_ATT_VAMP drain (player-attack.c:877-881).
 * - bloodlust over-exertion (player-attack.c:770-774, 871-874).
 * - OF_IMPACT earthquakes (player-attack.c:814-819, 883-889).
 * - shapechange blow substitution (player-attack.c:831-838).
 * - attempt_shield_bash (player-attack.c:897-978).
 * - the PF_COMBAT_REGEN pre-attack reward hook (player-attack.c:1002-1005).
 * - py_attack energy accounting (player-attack.c:991,1017-1019).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MON_TMD } from "../generated";
import { FlagSet } from "../bitflag";
import { Rng } from "../rng";
import { bindMonsters } from "../mon/bind";
import type { MonsterPackRecords } from "../mon/bind";
import { blankMonster } from "../mon/monster";
import type { Monster } from "../mon/monster";
import { RF_SIZE } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson, ObjectKind } from "../obj/types";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import { bindPlayer } from "../player/bind";
import type { PlayerPackRecords } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { SKILL, SKILL_MAX } from "../player/types";
import type { MeleeEffectHooks, PlayerCombatState } from "./melee";
import { pyAttack, pyAttackReal } from "./melee";

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

const weaponKind = objReg.kinds.find((k): k is ObjectKind => !!k) as ObjectKind;
const realRace = monReg.races.find((r) => r.base) as MonsterRace;

function player(lev = 1): Player {
  const p = blankPlayer(
    plReg.races[0] as (typeof plReg.races)[number],
    plReg.classes[0] as (typeof plReg.classes)[number],
    plReg.bodies[0] as (typeof plReg.bodies)[number],
  );
  p.lev = lev;
  return p;
}

function state(overrides: Partial<PlayerCombatState> = {}): PlayerCombatState {
  const skills = new Array<number>(SKILL_MAX).fill(0);
  skills[SKILL.TO_HIT_MELEE] = 40;
  return {
    toH: 0,
    toD: 5,
    ac: 0,
    toA: 0,
    skills,
    numBlows: 100,
    ammoMult: 1,
    numShots: 0,
    ammoTval: 0,
    blessWield: false,
    ...overrides,
  };
}

/** A plain monster (no flags), ac 10, given current/max hp. */
function monster(hp: number, maxhp = hp): Monster {
  const flags = new FlagSet(RF_SIZE);
  const race: MonsterRace = { ...realRace, ac: 10, level: 5, flags };
  const mon = blankMonster(race);
  mon.hp = hp;
  mon.maxhp = maxhp;
  return mon;
}

/** A 2d6 (+0,+3) weapon with no brands or slays. */
function weapon(): GameObject {
  const o = objectNew(weaponKind);
  o.dd = 2;
  o.ds = 6;
  o.toH = 0;
  o.toD = 3;
  o.weight = 40;
  return o;
}

describe("pre-blow monster wake (player-attack.c:759)", () => {
  it("wakes a sleeping monster even when the blow misses", () => {
    const rng = new Rng(1);
    rng.randFix(0); /* bottom band: miss */
    const mon = monster(1000);
    mon.mTimed[MON_TMD.SLEEP] = 50;
    const blow = pyAttackReal(
      rng, player(), state(), weapon(), mon, objReg.brands, objReg.slays,
    );
    expect(blow.hit).toBe(false);
    /* monster_wake(mon, false, 100) ran before test_hit. */
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0);
  });
});

describe("fear generation (mon_take_hit, mon-util.c:1137-1190)", () => {
  it("a surviving low-hp monster is frightened; py_attack reports the delayed flee (player-attack.c:1023)", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    /* 100/1000 hp: dmg 20 leaves 80 (8%), the lowHp roll (randint1(10) = 10
     * at rand_fix 100) fires. */
    const mon = monster(100, 1000);
    const res = pyAttack(
      rng, player(), state(), weapon(), mon, objReg.brands, objReg.slays,
    );
    expect(res.monsterDied).toBe(false);
    expect(mon.mTimed[MON_TMD.FEAR]).toBeGreaterThan(0);
    expect(res.monsterFled).toBe(true);
    expect(res.blows[0]!.fear).toBe(true);
  });

  it("a healthy monster is not frightened and monsterFled stays false", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const mon = monster(1000, 1000);
    const res = pyAttack(
      rng, player(), state(), weapon(), mon, objReg.brands, objReg.slays,
    );
    expect(mon.mTimed[MON_TMD.FEAR]).toBe(0);
    expect(res.monsterFled).toBe(false);
  });

  it("a kill clears the fear flag (py_attack_real: if (stop) *fear = false)", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const mon = monster(5, 1000);
    const res = pyAttack(
      rng, player(), state({ numBlows: 300 }), weapon(), mon,
      objReg.brands, objReg.slays,
    );
    expect(res.monsterDied).toBe(true);
    expect(res.monsterFled).toBe(false);
  });
});

describe("blow_side_effects TMD_ATT_CONF (player-attack.c:669-678)", () => {
  it("clears the brand and confuses for 10 + randint0(lev) / 10 turns", () => {
    const rng = new Rng(1);
    rng.randFix(50);
    let cleared = 0;
    let confDur = -1;
    const hooks: MeleeEffectHooks = {
      attConf: true,
      clearAttConf: () => cleared++,
      confuseMonster: (_m, dur) => {
        confDur = dur;
      },
    };
    const mon = monster(1000);
    const blow = pyAttackReal(
      rng, player(30), state(), weapon(), mon, objReg.brands, objReg.slays,
      { hooks },
    );
    expect(blow.hit).toBe(true);
    expect(cleared).toBe(1);
    /* randint0(30) at rand_fix 50 = 14 -> 10 + 14 / 10 = 11. */
    expect(confDur).toBe(11);
  });

  it("does nothing without the timed flag", () => {
    const rng = new Rng(1);
    rng.randFix(50);
    let cleared = 0;
    const hooks: MeleeEffectHooks = {
      attConf: false,
      clearAttConf: () => cleared++,
    };
    pyAttackReal(
      rng, player(30), state(), weapon(), monster(1000),
      objReg.brands, objReg.slays, { hooks },
    );
    expect(cleared).toBe(0);
  });
});

describe("TMD_ATT_VAMP drain (player-attack.c:877-881)", () => {
  it("heals min(mon->hp, dmg) when the monster survives", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    let healed = -1;
    const hooks: MeleeEffectHooks = {
      attVamp: true,
      healPlayer: (amount) => {
        healed = amount;
      },
    };
    /* dmg = 2d6 max (12) + 3 + 5 = 20 against 100 hp: drain = 20. */
    pyAttackReal(
      rng, player(), state(), weapon(), monster(100, 1000),
      objReg.brands, objReg.slays, { hooks },
    );
    expect(healed).toBe(20);
  });

  it("does not drain on a kill (upstream: if (!stop))", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    let healed = 0;
    const hooks: MeleeEffectHooks = {
      attVamp: true,
      healPlayer: () => healed++,
    };
    pyAttackReal(
      rng, player(), state(), weapon(), monster(10, 1000),
      objReg.brands, objReg.slays, { hooks },
    );
    expect(healed).toBe(0);
  });
});

describe("bloodlust over-exertion (player-attack.c:770-774, 871-874)", () => {
  it("a missed blow can scramble (one_in_(50) at rand_fix 0)", () => {
    const rng = new Rng(1);
    rng.randFix(0); /* miss AND randint0(50) = 0 */
    let scramble = 0;
    let con = 0;
    const hooks: MeleeEffectHooks = {
      bloodlust: true,
      overExertScramble: () => scramble++,
      overExertCon: () => con++,
    };
    const blow = pyAttackReal(
      rng, player(), state(), weapon(), monster(1000),
      objReg.brands, objReg.slays, { hooks },
    );
    expect(blow.hit).toBe(false);
    expect(scramble).toBe(1);
    expect(con).toBe(0);
  });

  it("a landed blow can trigger the CON exertion (seed sweep); never without bloodlust", () => {
    const run = (bloodlust: boolean): number => {
      let con = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const rng = new Rng(seed);
        const hooks: MeleeEffectHooks = {
          bloodlust,
          overExertCon: () => con++,
        };
        pyAttackReal(
          rng, player(), state(), weapon(), monster(100000),
          objReg.brands, objReg.slays, { hooks },
        );
      }
      return con;
    };
    expect(run(true)).toBeGreaterThan(0);
    expect(run(false)).toBe(0);
  });
});

describe("OF_IMPACT earthquakes (player-attack.c:814-819, 883-889)", () => {
  it("dmg > 50 with OF_IMPACT learns the flag, quakes, and stops when the monster is gone", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    let learned = 0;
    let quaked = 0;
    const hooks: MeleeEffectHooks = {
      impact: true,
      learnImpact: () => learned++,
      earthquake: () => quaked++,
      monsterGone: () => true,
    };
    /* dmg = 12 + 3 + 60 = 75 > 50. */
    const blow = pyAttackReal(
      rng, player(), state({ toD: 60 }), weapon(), monster(1000),
      objReg.brands, objReg.slays, { hooks },
    );
    expect(learned).toBe(1);
    expect(quaked).toBe(1);
    expect(blow.monsterDied).toBe(false);
    expect(blow.stopAttack).toBe(true);
  });

  it("no quake at dmg <= 50", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    let quaked = 0;
    const hooks: MeleeEffectHooks = {
      impact: true,
      earthquake: () => quaked++,
      monsterGone: () => true,
    };
    /* dmg = 12 + 3 + 5 = 20. */
    const blow = pyAttackReal(
      rng, player(), state(), weapon(), monster(1000),
      objReg.brands, objReg.slays, { hooks },
    );
    expect(quaked).toBe(0);
    expect(blow.stopAttack).toBe(false);
  });
});

describe("shapechange blow substitution (player-attack.c:831-838)", () => {
  it("replaces the verb with a random shape blow", () => {
    const rng = new Rng(1);
    rng.randFix(100); /* randint0(2) = 1 -> "claw" */
    const hooks: MeleeEffectHooks = { shapeBlows: ["bite", "claw"] };
    const blow = pyAttackReal(
      rng, player(), state(), weapon(), monster(1000),
      objReg.brands, objReg.slays, { hooks },
    );
    expect(blow.hit).toBe(true);
    expect(blow.verb).toBe("claw");
  });
});

describe("attempt_shield_bash (player-attack.c:897-978)", () => {
  const bashHooks = (
    shield: GameObject | null,
    log: { msgs: string[]; stun: number[]; conf: number[] },
  ): MeleeEffectHooks => ({
    shieldBash: {
      shield,
      dexInd: 0 /* adj_dex_th[0] = -3 */,
      strInd: 30 /* adj_str_td[30] = 11 */,
      playerWt: 100,
      totalWeight: 400,
      msg: (t) => log.msgs.push(t),
      stunMonster: (_m, dur) => log.stun.push(dur),
      confuseMonster: (_m, dur) => log.conf.push(dur),
    },
  });

  function shield(): GameObject {
    const o = objectNew(weaponKind);
    o.dd = 2;
    o.ds = 3;
    o.weight = 60;
    return o;
  }

  it("bashes, stuns and confuses (deterministic at rand_fix 0)", () => {
    const rng = new Rng(1);
    rng.randFix(0);
    const log = { msgs: [] as string[], stun: [] as number[], conf: [] as number[] };
    const mon = monster(1000);
    /* Unarmed bash: chance (5 - 1) * 4 = 16 > randint0(205) = 0. Quality =
     * 10 + 12 + 5 + 30 = 57; dam = damroll(2,3)=2 * (57/40 + 10/14 = 1) +
     * adj_str_td[30]=11 -> 13. Stun/conf: 57+10 > randint1(...)=1; durations
     * randint0(10/5)+4 = 4. */
    const res = pyAttack(
      rng, player(10), state(), null, mon, objReg.brands, objReg.slays,
      { hooks: bashHooks(shield(), log) },
    );
    expect(log.msgs).toContain("You get in a shield bash!");
    expect(log.stun).toEqual([4]);
    expect(log.conf).toEqual([4]);
    expect(res.monsterDied).toBe(false);
    /* Bash damage landed before the (missed, rand_fix 0) blows. */
    expect(mon.hp).toBe(1000 - 13);
  });

  it("a lethal bash ends py_attack with no blows (player-attack.c:1011)", () => {
    const rng = new Rng(1);
    rng.randFix(0);
    const log = { msgs: [] as string[], stun: [] as number[], conf: [] as number[] };
    const mon = monster(5, 1000);
    const res = pyAttack(
      rng, player(10), state(), null, mon, objReg.brands, objReg.slays,
      { hooks: bashHooks(shield(), log) },
    );
    expect(res.monsterDied).toBe(true);
    expect(res.blows.length).toBe(0);
  });

  it("no shield, no bash (and no RNG drawn for it)", () => {
    const rng = new Rng(1);
    rng.randFix(0);
    const log = { msgs: [] as string[], stun: [] as number[], conf: [] as number[] };
    pyAttack(
      rng, player(10), state(), null, monster(1000),
      objReg.brands, objReg.slays, { hooks: bashHooks(null, log) },
    );
    expect(log.msgs.length).toBe(0);
    expect(log.stun.length).toBe(0);
  });

  it("skips a monster below half the player's level (player-attack.c:912)", () => {
    const rng = new Rng(1);
    rng.randFix(0);
    const log = { msgs: [] as string[], stun: [] as number[], conf: [] as number[] };
    /* race level 5 < 12 / 2. */
    pyAttack(
      rng, player(12), state(), null, monster(1000),
      objReg.brands, objReg.slays, { hooks: bashHooks(shield(), log) },
    );
    expect(log.msgs.length).toBe(0);
  });
});

describe("PF_COMBAT_REGEN reward hook (player-attack.c:1002-1005)", () => {
  it("runs once per py_attack, even when every blow misses", () => {
    const rng = new Rng(1);
    rng.randFix(0);
    let rewards = 0;
    pyAttack(
      rng, player(), state({ numBlows: 250 }), weapon(), monster(1000),
      objReg.brands, objReg.slays, { hooks: { combatRegen: () => rewards++ } },
    );
    expect(rewards).toBe(1);
  });
});

describe("py_attack energy accounting (player-attack.c:991,1017-1019)", () => {
  it("two blows at 250 num_blows use 80 energy, not a flat turn", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const res = pyAttack(
      rng, player(), state({ numBlows: 250 }), weapon(), monster(100000),
      objReg.brands, objReg.slays,
    );
    expect(res.blows.length).toBe(2);
    expect(res.energyUsed).toBe(80);
  });
});
