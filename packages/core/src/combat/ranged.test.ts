import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OF, RF } from "../generated";
import { FlagSet } from "../bitflag";
import { Rng } from "../rng";
import { bindMonsters } from "../mon/bind";
import type { MonsterPackRecords } from "../mon/bind";
import { blankMonster } from "../mon/monster";
import type { Monster } from "../mon/monster";
import { RF_SIZE } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import { ObjRegistry } from "../obj/bind";
import type { Artifact, ObjPackJson, ObjectKind, Slay } from "../obj/types";
import { objectNew, tvalIsMeleeWeapon } from "../obj/object";
import type { GameObject } from "../obj/object";
import { bindPlayer } from "../player/bind";
import type { PlayerPackRecords } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { SKILL_MAX } from "../player/types";
import type { PlayerCombatState } from "./melee";
import { breakageChance, makeRangedShot, rangedDamage } from "./ranged";

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

function player(): Player {
  const p = blankPlayer(
    plReg.races[0] as (typeof plReg.races)[number],
    plReg.classes[0] as (typeof plReg.classes)[number],
    plReg.bodies[0] as (typeof plReg.bodies)[number],
  );
  p.lev = 1;
  return p;
}

const anyKind = objReg.kinds.find((k): k is ObjectKind => !!k) as ObjectKind;
const weaponKind = objReg.kinds.find(
  (k): k is ObjectKind => !!k && tvalIsMeleeWeapon(k.tval),
) as ObjectKind;
const realRace = monReg.races.find((r) => r.base) as MonsterRace;
const undeadSlay = objReg.slays.findIndex(
  (s) => s !== null && s.raceFlag === RF.UNDEAD,
);
const undeadMult = (objReg.slays[undeadSlay] as Slay).multiplier;

function state(overrides: Partial<PlayerCombatState> = {}): PlayerCombatState {
  return {
    toH: 0,
    toD: 0,
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

function undeadMon(): Monster {
  const flags = new FlagSet(RF_SIZE);
  flags.on(RF.UNDEAD);
  const race: MonsterRace = { ...realRace, ac: 10, level: 5, flags };
  const mon = blankMonster(race);
  mon.hp = 1000;
  mon.maxhp = 1000;
  return mon;
}

describe("ranged_damage", () => {
  it("applies the launcher (ammo) multiplier", () => {
    const rng = new Rng(1);
    rng.randFix(100); // damroll(1,4) -> 4
    const dmg = rangedDamage(
      rng,
      state(),
      undeadMon(),
      ammo(),
      launcher(),
      0,
      0,
      objReg.brands,
      objReg.slays,
    );
    /* (4 + 0 + 0) * ammoMult(3) = 12 */
    expect(dmg).toBe(12);
  });

  it("adds a slay multiplier on top of the launcher multiplier", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const dmg = rangedDamage(
      rng,
      state(),
      undeadMon(),
      ammo(),
      launcher(),
      0,
      undeadSlay,
      objReg.brands,
      objReg.slays,
    );
    /* 4 * (ammoMult 3 + slayMult) */
    expect(dmg).toBe(4 * (3 + undeadMult));
  });
});

describe("make_ranged_shot", () => {
  it("hits and deals launcher-multiplied damage (rand_fix)", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const res = makeRangedShot(
      rng,
      player(),
      state(),
      ammo(),
      launcher(),
      undeadMon(),
      objReg.brands,
      objReg.slays,
      1,
    );
    expect(res.success).toBe(true);
    expect(res.damage).toBe(12);
  });

  it("misses in the bottom to-hit band", () => {
    const rng = new Rng(1);
    rng.randFix(0);
    const res = makeRangedShot(
      rng,
      player(),
      state(),
      ammo(),
      launcher(),
      undeadMon(),
      objReg.brands,
      objReg.slays,
      1,
    );
    expect(res.success).toBe(false);
    expect(res.damage).toBe(0);
  });
});

describe("breakage_chance", () => {
  it("never breaks artifacts", () => {
    const o = objectNew(weaponKind);
    o.artifact = objReg.artifacts[1] as Artifact;
    expect(breakageChance(o, true)).toBe(0);
  });

  it("gives throwing weapons a 1% break on hit and squares it on a miss", () => {
    const o = objectNew(weaponKind);
    o.flags.on(OF.THROWING);
    expect(breakageChance(o, true)).toBe(1);
    expect(breakageChance(o, false)).toBe(0);
  });
});
