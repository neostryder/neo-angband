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
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import { bindPlayer } from "../player/bind";
import type { PlayerPackRecords } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { SKILL_MAX } from "../player/types";
import type { PlayerCombatState } from "./melee";
import { meleeDamage, pyAttack, pyAttackReal } from "./melee";

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

/* The "slay undead" slay index, and its standard multiplier, from real data. */
const undeadSlay = objReg.slays.findIndex(
  (s) => s !== null && s.raceFlag === RF.UNDEAD,
);
const undeadMult = (objReg.slays[undeadSlay] as Slay).multiplier;

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
    ammoMult: 1,
    numShots: 0,
    ammoTval: 0,
    blessWield: false,
    ...overrides,
  };
}

function undeadMonster(hp = 1000): Monster {
  const flags = new FlagSet(RF_SIZE);
  flags.on(RF.UNDEAD);
  const race: MonsterRace = { ...realRace, ac: 10, level: 5, flags };
  const mon = blankMonster(race);
  mon.hp = hp;
  mon.maxhp = hp;
  return mon;
}

/** A light weapon (2d6, +0 to-hit, +3 to-dam) with a slay-undead brand set. */
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

describe("melee_damage", () => {
  it("multiplies weapon dice by a matching slay and adds to-dam", () => {
    const rng = new Rng(1);
    rng.randFix(100); // damroll(2,6) -> 12
    const dmg = meleeDamage(
      rng,
      undeadMonster(),
      undeadSlayer(),
      0,
      undeadSlay,
      objReg.brands,
      objReg.slays,
    );
    expect(dmg).toBe(12 * undeadMult + 3);
  });
});

describe("py_attack_real", () => {
  it("computes slay damage + to-dam bonuses on a hit (no critical)", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const blow = pyAttackReal(
      rng,
      player(),
      state(),
      undeadSlayer(),
      undeadMonster(),
      objReg.brands,
      objReg.slays,
    );
    expect(blow.hit).toBe(true);
    expect(blow.slay).toBe(undeadSlay);
    /* dice 12 * slayMult + weapon to-dam 3 + state to-dam 5. */
    expect(blow.damage).toBe(12 * undeadMult + 3 + 5);
    expect(blow.monsterDied).toBe(false);
  });

  it("misses in the bottom to-hit band (rand_fix 0)", () => {
    const rng = new Rng(1);
    rng.randFix(0);
    const blow = pyAttackReal(
      rng,
      player(),
      state(),
      undeadSlayer(),
      undeadMonster(),
      objReg.brands,
      objReg.slays,
    );
    expect(blow.hit).toBe(false);
    expect(blow.damage).toBe(0);
  });

  it("cannot attack while afraid", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const blow = pyAttackReal(
      rng,
      player(),
      state(),
      undeadSlayer(),
      undeadMonster(),
      objReg.brands,
      objReg.slays,
      { afraid: true },
    );
    expect(blow.hit).toBe(false);
  });
});

describe("py_attack blow loop", () => {
  it("lands one blow at 100 num_blows", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const res = pyAttack(
      rng,
      player(),
      state({ numBlows: 100 }),
      undeadSlayer(),
      undeadMonster(),
      objReg.brands,
      objReg.slays,
    );
    expect(res.blows.length).toBe(1);
  });

  it("lands two blows at 250 num_blows within one turn of energy", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const res = pyAttack(
      rng,
      player(),
      state({ numBlows: 250 }),
      undeadSlayer(),
      undeadMonster(),
      objReg.brands,
      objReg.slays,
    );
    expect(res.blows.length).toBe(2);
    expect(res.monsterDied).toBe(false);
    expect(res.totalDamage).toBe(2 * (12 * undeadMult + 3 + 5));
  });

  it("stops the loop as soon as the monster dies", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const res = pyAttack(
      rng,
      player(),
      state({ numBlows: 300 }),
      undeadSlayer(),
      undeadMonster(5),
      objReg.brands,
      objReg.slays,
    );
    expect(res.monsterDied).toBe(true);
    expect(res.blows.length).toBe(1);
  });
});
