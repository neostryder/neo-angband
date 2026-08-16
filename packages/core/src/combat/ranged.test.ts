import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OF, RF } from "../generated/index.js";
import { FlagSet } from "../bitflag.js";
import { Rng } from "../rng.js";
import { bindMonsters } from "../mon/bind.js";
import type { MonsterPackRecords } from "../mon/bind.js";
import { blankMonster } from "../mon/monster.js";
import type { Monster } from "../mon/monster.js";
import { RF_SIZE } from "../mon/types.js";
import type { MonsterRace } from "../mon/types.js";
import { ObjRegistry } from "../obj/bind.js";
import type { Artifact, Curse, ObjPackJson, ObjectKind, Slay } from "../obj/types.js";
import { objectNew, tvalIsMeleeWeapon } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import { bindPlayer } from "../player/bind.js";
import type { PlayerPackRecords } from "../player/bind.js";
import { blankPlayer } from "../player/player.js";
import type { Player } from "../player/player.js";
import { SKILL_MAX } from "../player/types.js";
import { BTH_PLUS_ADJ } from "./hit.js";
import type { PlayerCombatState } from "./melee.js";
import {
  breakageChance,
  chanceOfMissileHitBase,
  makeRangedShot,
  rangedDamage,
} from "./ranged.js";

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

/*
 * object_to_hit / object_to_dam / object_weight_one read the ACTIVE CURSES'
 * template bonuses (obj-util.c:296-330). That was fixed for MELEE on
 * 2026-08-04 (combat/object-bonus-curses.test.ts) and the ranged path was left
 * out - the seam is an OPTIONAL trailing argument, so every unit test still
 * passed while a cursed bow's penalty silently never reached a shot.
 *
 * Ground truth comes from the pack, not from a curse of my own: the test finds
 * a shipped curse whose template really carries a to-dam or to-hit term.
 */
const curseIdxWith = (pick: (c: Curse) => number): number =>
  objReg.curses.findIndex((c, i) => i > 0 && c !== null && pick(c) !== 0);
/* SEPARATE fixtures per term, and this is not fussiness: the first curse
 * carrying ANY combat term is "air swing" (to_h -20, to_d 0), so a single
 * shared index made the to-dam assertion `expect(0).toBe(0)` - a fixture value
 * that could not disagree. A surviving mutant is what surfaced it. */
const damCurseIdx = curseIdxWith((c) => c.obj.toD);
const hitCurseIdx = curseIdxWith((c) => c.obj.toH);
const damCurse = objReg.curses[damCurseIdx] as Curse;
const hitCurse = objReg.curses[hitCurseIdx] as Curse;

/** `o` with curse `idx` active, and the empty-but-present array C needs. */
function cursed(o: GameObject, idx: number): GameObject {
  o.curses = [];
  for (let i = 0; i < objReg.curses.length; i++) o.curses[i] = { power: 0, timeout: 0 };
  o.curses[idx] = { power: 10, timeout: 0 };
  return o;
}

describe("curse terms reach the ranged path (obj-util.c:296-330)", () => {
  it("the shipped data has a curse for EACH term the tests below assert", () => {
    /* Without this the assertions would be vacuous rather than wrong, which is
     * the failure mode worth catching loudly - and is what happened. */
    expect(damCurseIdx).toBeGreaterThan(0);
    expect(damCurse.obj.toD).not.toBe(0);
    expect(hitCurseIdx).toBeGreaterThan(0);
    expect(hitCurse.obj.toH).not.toBe(0);
  });

  it("a cursed missile's to-dam term changes ranged_damage", () => {
    const shoot = (curses?: readonly (Curse | null)[]): number => {
      const rng = new Rng(1);
      rng.randFix(100); // damroll(1,4) -> 4
      return rangedDamage(
        rng, state(), undeadMon(), cursed(ammo(), damCurseIdx), launcher(),
        0, 0, objReg.brands, objReg.slays, curses,
      );
    };
    /* The whole to-dam sum is multiplied by ammoMult (3), so the delta is
     * the curse's to_d times the multiplier. */
    expect(shoot(objReg.curses) - shoot()).toBe(damCurse.obj.toD * 3);
  });

  it("a cursed launcher's to-hit term changes the missile hit chance", () => {
    const chance = (curses?: readonly (Curse | null)[]): number =>
      chanceOfMissileHitBase(state(), ammo(), cursed(launcher(), hitCurseIdx), curses);
    /* chance = skill + bonus * BTH_PLUS_ADJ, and the curse's to_h lands in
     * `bonus`, so the whole delta is exactly one scaled curse term. */
    expect(chance(objReg.curses) - chance()).toBe(hitCurse.obj.toH * BTH_PLUS_ADJ);
  });

  /*
   * NOT TESTED, and deliberately so rather than faked: object_weight_one's
   * curse term on the thrown-weapon weight scaling. No shipped curse carries a
   * `weight` field at all (checked against content/pack/curse.json), so with
   * the game's own data that call cannot produce a different answer - a mutant
   * removing it survives, and would survive any honest test. The threading is
   * still correct (it is what obj-util.c:328 does, and a mod may add one).
   */
  it("omitting the curse table still yields the object's own bonus", () => {
    const o = cursed(ammo(), damCurseIdx);
    o.toD = 7;
    const rng = new Rng(1);
    rng.randFix(100);
    const plain = rangedDamage(
      rng, state(), undeadMon(), o, launcher(),
      0, 0, objReg.brands, objReg.slays,
    );
    expect(plain).toBe((4 + 7) * 3);
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
