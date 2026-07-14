import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag";
import { KF, MON_TMD, RF } from "../generated";
import { Rng } from "../rng";
import { loc } from "../loc";
import { KF_SIZE } from "../obj/types";
import type { GameObject } from "../obj/object";
import { blankMonster } from "./monster";
import type { Monster } from "./monster";
import type { LoreStore } from "./lore";
import { getLore } from "./lore";
import { getRandomMonsterObject, stealMonsterItem } from "./steal";
import type { StealEnv } from "./steal";
import { makeRace } from "../game/harness";

/** A minimal held object carrying only the fields the steal core reads. */
function heldObject(
  opts: { artifact?: boolean; questArt?: boolean; number?: number; pval?: number } = {},
): GameObject {
  const kindFlags = new FlagSet(KF_SIZE);
  if (opts.questArt) kindFlags.on(KF.QUEST_ART);
  return {
    artifact: opts.artifact ? ({} as GameObject["artifact"]) : null,
    kind: { kindFlags },
    number: opts.number ?? 1,
    pval: opts.pval ?? 0,
    heldMIdx: 7,
  } as unknown as GameObject;
}

/** A monster whose guard math yields a fixed monster_reaction of 1. */
function makeThiefTarget(sleeping = false): Monster {
  /* guard = trunc(level*3/4) + mspeed - playerSpeed = 0 + 111 - 110 = 1. */
  const race = makeRace({ level: 0, speed: 111 });
  const mon = blankMonster(race);
  mon.mspeed = 111;
  mon.grid = loc(5, 5);
  mon.maxhp = 30;
  mon.hp = 30;
  if (sleeping) mon.mTimed[MON_TMD.SLEEP] = 500;
  return mon;
}

/** Record of the world-facing StealEnv calls a test made. */
interface EnvCalls {
  msgs: string[];
  gained: GameObject[];
  carried: GameObject[];
  dropped: GameObject[];
  wokeAll: number;
  hitRun: number;
}

/**
 * A StealEnv over the fixed guard=1 monster: playerSpeed 110, weight 0, so
 * monster_reaction is 1 and the branch is decided purely by stealSkill
 * (stealthSkill + dexToHit) and the isIgnored / canCarry flags.
 */
function mockEnv(
  opts: {
    stealthSkill?: number;
    dexToHit?: number;
    ignored?: boolean;
    canCarry?: boolean;
    money?: boolean;
    statusPenalty?: boolean;
    attRun?: boolean;
  } = {},
): { env: StealEnv; calls: EnvCalls } {
  const calls: EnvCalls = {
    msgs: [],
    gained: [],
    carried: [],
    dropped: [],
    wokeAll: 0,
    hitRun: 0,
  };
  const env: StealEnv = {
    msg: (t) => calls.msgs.push(t),
    monName: (mon) => mon.race.name,
    stealthSkill: opts.stealthSkill ?? 2,
    dexToHit: opts.dexToHit ?? 0,
    playerSpeed: 110,
    statusPenalty: opts.statusPenalty ?? false,
    attRun: opts.attRun ?? false,
    objectWeight: () => 0,
    isMoney: () => opts.money ?? false,
    objectName: () => "the item",
    isIgnored: () => opts.ignored ?? false,
    canCarry: () => opts.canCarry ?? true,
    gainGold: (obj) => calls.gained.push(obj),
    carry: (obj) => calls.carried.push(obj),
    dropStolen: (obj) => calls.dropped.push(obj),
    wakeAll: () => {
      calls.wokeAll++;
    },
    hitAndRun: () => {
      calls.hitRun++;
    },
  };
  return { env, calls };
}

describe("get_random_monster_object (mon-util.c L1405)", () => {
  it("returns the sole non-quest held object", () => {
    const rng = new Rng(1);
    const mon = makeThiefTarget();
    const obj = heldObject();
    mon.heldObj = [obj];
    expect(getRandomMonsterObject(rng, mon)).toBe(obj);
  });

  it("returns null when the pile is empty", () => {
    const mon = makeThiefTarget();
    expect(getRandomMonsterObject(new Rng(1), mon)).toBeNull();
  });

  it("skips quest artifacts and never picks them", () => {
    const mon = makeThiefTarget();
    const quest = heldObject({ artifact: true, questArt: true });
    const normal = heldObject();
    mon.heldObj = [quest, normal];
    /* Many seeds: the quest artifact must never be the pick. */
    for (let seed = 1; seed <= 50; seed++) {
      expect(getRandomMonsterObject(new Rng(seed), mon)).toBe(normal);
    }
  });

  it("returns null when every held object is a quest artifact", () => {
    const mon = makeThiefTarget();
    mon.heldObj = [heldObject({ artifact: true, questArt: true })];
    expect(getRandomMonsterObject(new Rng(1), mon)).toBeNull();
  });
});

describe("steal_monster_item (mon-util.c L1430) - player path", () => {
  it("no object: emits the nothing-to-steal message and does not increment thefts", () => {
    const rng = new Rng(1);
    const lore: LoreStore = new Map();
    const mon = makeThiefTarget();
    mon.heldObj = [];
    const { env, calls } = mockEnv();

    stealMonsterItem(rng, lore, mon, -1, env);

    expect(calls.msgs[0]).toContain("You can find nothing to steal");
    expect(getLore(lore, mon.race).thefts).toBe(0);
    expect(calls.carried).toHaveLength(0);
  });

  it("no object: the one_in_(3) branch can wake a sleeping monster", () => {
    const lore: LoreStore = new Map();
    /* Find a seed where one_in_(3) is true, then assert the monster woke. */
    let woke = false;
    for (let seed = 1; seed <= 30 && !woke; seed++) {
      const mon = makeThiefTarget(true);
      mon.heldObj = [];
      const { env } = mockEnv();
      stealMonsterItem(new Rng(seed), lore, mon, -1, env);
      if (mon.mTimed[MON_TMD.SLEEP] === 0) woke = true;
    }
    expect(woke).toBe(true);
  });

  it("successful steal (reaction < skill): carries the item into the pack", () => {
    const rng = new Rng(1);
    const lore: LoreStore = new Map();
    const mon = makeThiefTarget();
    const obj = heldObject();
    mon.heldObj = [obj];
    /* reaction = 1, stealSkill = 2 -> success. */
    const { env, calls } = mockEnv({ stealthSkill: 2 });

    stealMonsterItem(rng, lore, mon, -1, env);

    expect(calls.carried).toEqual([obj]);
    expect(calls.dropped).toHaveLength(0);
    expect(mon.heldObj).toHaveLength(0);
    expect(obj.heldMIdx).toBe(0);
    expect(getLore(lore, mon.race).thefts).toBe(1);
  });

  it("successful steal of gold: gains the gold, never carries", () => {
    const rng = new Rng(1);
    const lore: LoreStore = new Map();
    const mon = makeThiefTarget();
    const gold = heldObject({ pval: 42 });
    mon.heldObj = [gold];
    const { env, calls } = mockEnv({ stealthSkill: 2, money: true });

    stealMonsterItem(rng, lore, mon, -1, env);

    expect(calls.gained).toEqual([gold]);
    expect(calls.carried).toHaveLength(0);
    expect(mon.heldObj).toHaveLength(0);
    expect(calls.msgs[0]).toContain("42 gold pieces");
  });

  it("successful steal drops when the item is ignored", () => {
    const rng = new Rng(1);
    const lore: LoreStore = new Map();
    const mon = makeThiefTarget();
    const obj = heldObject();
    mon.heldObj = [obj];
    const { env, calls } = mockEnv({ stealthSkill: 2, ignored: true });

    stealMonsterItem(rng, lore, mon, -1, env);

    expect(calls.dropped).toEqual([obj]);
    expect(calls.carried).toHaveLength(0);
    expect(mon.heldObj).toHaveLength(0);
  });

  it("successful steal drops when the pack is full (inven_carry_okay false)", () => {
    const rng = new Rng(1);
    const lore: LoreStore = new Map();
    const mon = makeThiefTarget();
    const obj = heldObject();
    mon.heldObj = [obj];
    const { env, calls } = mockEnv({ stealthSkill: 2, canCarry: false });

    stealMonsterItem(rng, lore, mon, -1, env);

    expect(calls.dropped).toEqual([obj]);
    expect(calls.carried).toHaveLength(0);
  });

  it("decent failure (reaction >= skill, reaction/2 < skill): keeps the item", () => {
    const rng = new Rng(1);
    const lore: LoreStore = new Map();
    const mon = makeThiefTarget();
    const obj = heldObject();
    mon.heldObj = [obj];
    /* reaction = 1, stealSkill = 1 -> not < 1, but 0 < 1 -> decent fail. */
    const { env, calls } = mockEnv({ stealthSkill: 1 });

    stealMonsterItem(rng, lore, mon, -1, env);

    expect(calls.msgs.some((m) => m.includes("You fail to steal"))).toBe(true);
    expect(calls.wokeAll).toBe(0);
    expect(mon.heldObj).toEqual([obj]);
    expect(getLore(lore, mon.race).thefts).toBe(0);
  });

  it("bungle (reaction/2 >= skill): angers and wakes all, keeps the item", () => {
    const rng = new Rng(1);
    const lore: LoreStore = new Map();
    const mon = makeThiefTarget();
    const obj = heldObject();
    mon.heldObj = [obj];
    /* reaction = 1, stealSkill = 0 -> neither check passes -> bungle. */
    const { env, calls } = mockEnv({ stealthSkill: 0 });

    stealMonsterItem(rng, lore, mon, -1, env);

    expect(calls.msgs.some((m) => m.includes("cries out in anger"))).toBe(true);
    expect(calls.wokeAll).toBe(1);
    expect(mon.heldObj).toEqual([obj]);
  });

  it("hit-and-run fires after the attempt when TMD_ATT_RUN is active", () => {
    const rng = new Rng(1);
    const lore: LoreStore = new Map();
    const mon = makeThiefTarget();
    const obj = heldObject();
    mon.heldObj = [obj];
    const { env, calls } = mockEnv({ stealthSkill: 2, attRun: true });

    stealMonsterItem(rng, lore, mon, -1, env);

    expect(calls.hitRun).toBe(1);
  });

  it("a sleeping unique's guard is halved (monster_is_unique branch runs)", () => {
    const rng = new Rng(1);
    const lore: LoreStore = new Map();
    /* Unique + sleeping: still resolves without drawing the reaction roll,
     * because guard clamps to 1 (level 0). Just assert the path is stable. */
    const race = makeRace({ level: 0, speed: 111, flags: [RF.UNIQUE] });
    const mon = blankMonster(race);
    mon.mspeed = 111;
    mon.mTimed[MON_TMD.SLEEP] = 500;
    const obj = heldObject();
    mon.heldObj = [obj];
    const { env, calls } = mockEnv({ stealthSkill: 2 });

    stealMonsterItem(rng, lore, mon, -1, env);

    expect(calls.carried).toEqual([obj]);
  });
});

describe("steal_monster_item - monster thief path (midx >= 0)", () => {
  it("carries the stolen item to the thief when an object is present", () => {
    const rng = new Rng(1);
    const lore: LoreStore = new Map();
    const mon = makeThiefTarget();
    const obj = heldObject();
    mon.heldObj = [obj];
    let carriedTo: { midx: number; obj: GameObject } | null = null;
    const { env, calls } = mockEnv();
    const thiefEnv: StealEnv = {
      ...env,
      thiefName: () => "the thief",
      thiefCarry: (midx, o) => {
        carriedTo = { midx, obj: o };
      },
    };

    stealMonsterItem(rng, lore, mon, 3, thiefEnv);

    expect(carriedTo).toEqual({ midx: 3, obj });
    expect(mon.heldObj).toHaveLength(0);
    expect(calls.msgs.some((m) => m.includes("steals something from"))).toBe(true);
  });

  it("fails cleanly when the target has nothing to steal", () => {
    const rng = new Rng(1);
    const lore: LoreStore = new Map();
    const mon = makeThiefTarget();
    mon.heldObj = [];
    const { env, calls } = mockEnv();
    const thiefEnv: StealEnv = { ...env, thiefName: () => "the thief" };

    stealMonsterItem(rng, lore, mon, 3, thiefEnv);

    expect(calls.msgs.some((m) => m.includes("but fails"))).toBe(true);
  });
});
