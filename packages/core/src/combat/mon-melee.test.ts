import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RF } from "../generated";
import { FlagSet } from "../bitflag";
import { Dice } from "../dice";
import type { RandomValue } from "../rng";
import { Rng } from "../rng";
import { bindMonsters } from "../mon/bind";
import type { MonsterPackRecords } from "../mon/bind";
import { blankMonster } from "../mon/monster";
import type { Monster } from "../mon/monster";
import { RF_SIZE } from "../mon/types";
import type { MonsterBlow, MonsterRace } from "../mon/types";
import { bindPlayer } from "../player/bind";
import type { PlayerPackRecords } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import type { DefenderState } from "./mon-melee";
import { monMeleeAttack, monsterCritical, RESOLVED_BLOW_EFFECTS } from "./mon-melee";

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

const realRace = monReg.races.find((r) => r.base) as MonsterRace;

function makeMon(
  effectName: string,
  methodName: string,
  diceStr: string,
  level: number,
  ...flags: number[]
): Monster {
  const method = monReg.blowMethods.get(methodName);
  const effect = monReg.blowEffects.get(effectName);
  if (!method || !effect) throw new Error(`missing blow ${methodName}/${effectName}`);
  const d = new Dice();
  d.parseString(diceStr);
  const blow: MonsterBlow = { method, effect, dice: d, diceRaw: diceStr };
  const flagsSet = new FlagSet(RF_SIZE);
  for (const f of flags) flagsSet.on(f);
  const race: MonsterRace = { ...realRace, level, flags: flagsSet, blows: [blow] };
  const mon = blankMonster(race);
  mon.hp = 100;
  mon.maxhp = 100;
  return mon;
}

function defender(): Player {
  const p = blankPlayer(
    plReg.races[0] as (typeof plReg.races)[number],
    plReg.classes[0] as (typeof plReg.classes)[number],
    plReg.bodies[0] as (typeof plReg.bodies)[number],
  );
  p.lev = 1;
  p.chp = 100;
  p.mhp = 100;
  return p;
}

const def: DefenderState = { ac: 0, toA: 0 };

describe("monster_critical", () => {
  const oneD4: RandomValue = { base: 0, dice: 1, sides: 4, mBonus: 0 };

  it("returns a tier for a maxed weak blow", () => {
    const rng = new Rng(1);
    rng.randFix(0); // randint0(100) -> 0, below dam so no early-out
    /* dam==total(4), tier for dam<=11 is 1, +1 for perfect damage = 2. */
    expect(monsterCritical(rng, oneD4, 5, 4)).toBe(2);
  });

  it("weak blows usually fail the critical roll", () => {
    const rng = new Rng(1);
    rng.randFix(50); // randint0(100) -> 49 >= dam(4)
    expect(monsterCritical(rng, oneD4, 5, 4)).toBe(0);
  });
});

describe("make_attack_normal", () => {
  it("does not attack with RF_NEVER_BLOW", () => {
    const rng = new Rng(1);
    const res = monMeleeAttack(rng, makeMon("HURT", "HIT", "1d4", 5, RF.NEVER_BLOW), defender(), def);
    expect(res.attacked).toBe(false);
    expect(res.blows.length).toBe(0);
  });

  it("misses in the bottom to-hit band and hits above it (rand_fix)", () => {
    const missRng = new Rng(1);
    missRng.randFix(0);
    const p1 = defender();
    const miss = monMeleeAttack(missRng, makeMon("HURT", "HIT", "1d4", 5), p1, def);
    expect(miss.blows[0]?.hit).toBe(false);
    expect(p1.chp).toBe(100);

    const hitRng = new Rng(1);
    hitRng.randFix(100);
    const p2 = defender();
    const hit = monMeleeAttack(hitRng, makeMon("HURT", "HIT", "1d4", 5), p2, def);
    expect(hit.blows[0]?.hit).toBe(true);
    /* HURT: adjust_dam_armor(1d4 max = 4, ac 0) = 4. */
    expect(hit.totalDamage).toBe(4);
    expect(p2.chp).toBe(96);
  });

  it("records a status ailment in the side-effect log (POISON)", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const res = monMeleeAttack(rng, makeMon("POISON", "HIT", "1d4", 5), defender(), def);
    expect(res.sideEffects.some((s) => s.kind === "timed" && s.effect === "POISONED")).toBe(true);
    expect(res.sideEffects.some((s) => s.kind === "elemental" && s.element === "POIS")).toBe(true);
  });

  it("records a stat drain in the side-effect log (LOSE_STR)", () => {
    const rng = new Rng(1);
    rng.randFix(100);
    const p = defender();
    const res = monMeleeAttack(rng, makeMon("LOSE_STR", "HIT", "1d4", 5), p, def);
    expect(res.sideEffects.some((s) => s.kind === "drainStat" && s.stat === "STR")).toBe(true);
    /* LOSE_STR deals the base damage directly. */
    expect(res.totalDamage).toBe(4);
    expect(p.chp).toBe(96);
  });

  it("resolves every RBE_ blow effect present in the pack", () => {
    const packEffects = new Set(monReg.blowEffects.keys());
    const resolved = new Set(RESOLVED_BLOW_EFFECTS);
    for (const name of packEffects) {
      expect(resolved.has(name)).toBe(true);
    }
  });
});
