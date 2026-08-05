/**
 * mon_take_hit's state-derived hooks (mon-util.c:1264-1313).
 *
 * NOT take-hit-hooks.test.ts, which is about take_hit - the PLAYER being hurt.
 * This is the other direction: the player hurting a monster.
 *
 * Two of mon_take_hit's branches - the COVERTRACKS clear at L1285 and the group
 * fear save that monster_primary_group_size feeds (mon-predicate.c:296) - hung
 * off optional MonTakeHitHooks fields that NO production caller supplied. Both
 * were ported, both were covered by mon/take-hit.test.ts, and neither could run
 * in a real game.
 *
 * So these tests are about the WIRING, not the branch: the behavioural ones
 * drive a real player blow through attackMonster, and the census makes a new
 * mon_take_hit call site that forgets gameTakeHitHooks fail rather than quietly
 * rejoin the same class of defect.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MFLAG, TMD } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import { GROUP_TYPE } from "../mon/monster.js";
import type { Monster } from "../mon/monster.js";
import { MON_GROUP } from "../mon/types.js";
import { addMon, makeRace, makeState } from "./harness.js";
import type { GameState } from "./context.js";
import { gameTakeHitHooks } from "./context.js";
import { monsterAddToGroup, monsterGroupStart, monsterPrimaryGroupSize } from "./mon-group.js";
import { attackMonster } from "./player-turn.js";

/** Start a primary group led by `leader` and add `members` to it. */
function makeGroup(state: GameState, leader: Monster, members: Monster[]): void {
  monsterGroupStart(state, leader, GROUP_TYPE.PRIMARY);
  const gi = leader.groupInfo[GROUP_TYPE.PRIMARY]!.index;
  for (const m of members) {
    m.groupInfo[GROUP_TYPE.PRIMARY]!.index = gi;
    m.groupInfo[GROUP_TYPE.PRIMARY]!.role = MON_GROUP.MEMBER;
    monsterAddToGroup(state, m, state.groups[gi]!);
  }
}

describe("mon_take_hit clears COVERTRACKS (mon-util.c:1285)", () => {
  it("a player melee blow ends the Ranger's Cover Tracks", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 500 });
    mon.mflag.on(MFLAG.VISIBLE);
    state.actor.player.timed[TMD.COVERTRACKS] = 20;

    attackMonster(state, mon);

    /* The blow landed, so mon_take_hit got past its `dam == 0` early return... */
    expect(mon.hp).toBeLessThan(500);
    /* ...and upstream's raw `p->timed[TMD_COVERTRACKS] = 0` ran. */
    expect(state.actor.player.timed[TMD.COVERTRACKS]).toBe(0);
  });

  it("the helper is the only writer, and it writes a raw zero", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 500 });
    state.actor.player.timed[TMD.COVERTRACKS] = 20;

    gameTakeHitHooks(state, mon).coverTracksBroken?.();

    /* A raw zero, not player_clear_timed: upstream prints no end message and
     * schedules no recalc at this site, and core keeps the wart. */
    expect(state.actor.player.timed[TMD.COVERTRACKS]).toBe(0);
  });
});

/**
 * Counts the group fear save's draws and forces every one to fail, so
 * monster_can_be_scared's loop always runs to completion and the count is
 * exactly (group size - 1) rather than a race with the seed.
 */
class SaveCountingRng extends Rng {
  saves = 0;
  override oneIn(x: number): boolean {
    if (x === 20) {
      this.saves++;
      return false;
    }
    return super.oneIn(x);
  }
}

/** Attack a monster that is one of `groupSize` group members; count the saves. */
function attackInGroup(groupSize: number): number {
  const state = makeState({ playerGrid: loc(15, 10) });
  const rng = new SaveCountingRng(1234);
  state.rng = rng;
  const race = makeRace({ ac: 0, flags: [] });
  const target = addMon(state, race, loc(16, 10), { hp: 500 });
  target.mflag.on(MFLAG.VISIBLE);
  /* The same five extra monsters exist in BOTH arms, so the only difference
   * between the runs is group membership - not the contents of the cave. */
  const others = [1, 2, 3, 4, 5].map((i) => addMon(state, race, loc(5, 5 + i)));
  const packed = others.slice(0, groupSize - 1);
  makeGroup(state, target, packed);
  for (const o of others.slice(groupSize - 1)) makeGroup(state, o, []);
  expect(monsterPrimaryGroupSize(state, target)).toBe(groupSize);

  attackMonster(state, target);
  /* The target has to SURVIVE for the fear roll to happen at all. */
  expect(target.hp).toBeGreaterThan(0);
  return rng.saves;
}

describe("mon_take_hit's group fear save (mon-predicate.c:296)", () => {
  it("a grouped monster gets one one_in_(20) save per other member", () => {
    const lone = attackInGroup(1);
    const packed = attackInGroup(6);
    /* count = size - 1 (mon-predicate.c:296), so a group of six draws five
     * saves a solitary monster does not. While primaryGroupSize defaulted to 1
     * both arms drew the same, and this difference was zero. */
    expect(packed - lone).toBe(5);
  });

  it("the helper reads the live group, not a constant", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const race = makeRace({ flags: [] });
    const leader = addMon(state, race, loc(10, 10));
    const a = addMon(state, race, loc(10, 11));
    makeGroup(state, leader, [a]);
    expect(gameTakeHitHooks(state, leader).primaryGroupSize?.()).toBe(2);
  });
});

/**
 * The defect was not a wrong branch - it was four call sites that each had to
 * remember an optional field. A fifth is one edit away.
 */
describe("every game-layer mon_take_hit call site is wired", () => {
  const SRC = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");

  /** Every non-test .ts under packages/core/src. */
  function sources(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...sources(p));
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
    }
    return out;
  }

  it("spreads gameTakeHitHooks into every call outside the pure combat layer", () => {
    const count = (s: string, re: RegExp): number => s.match(re)?.length ?? 0;
    const callers = sources(SRC)
      .map((f) => ({
        rel: path.relative(SRC, f).replaceAll("\\", "/"),
        src: readFileSync(f, "utf8"),
      }))
      .filter((f) => /\bmonTakeHit\(/.test(f.src) && f.rel !== "mon/take-hit.ts");
    /* If this drops to zero the check has stopped measuring anything. */
    expect(callers.length).toBeGreaterThanOrEqual(4);

    /* Counted, not merely present: the first version of this check asked
     * whether the file CONTAINED "gameTakeHitHooks", and the import line alone
     * answered yes - so deleting the spread from all three game-layer call
     * sites left it green. */
    const short = callers
      .filter((f) => !f.rel.startsWith("combat/"))
      .map((f) => ({
        rel: f.rel,
        calls: count(f.src, /\bmonTakeHit\(/g),
        spreads: count(f.src, /\.\.\.gameTakeHitHooks\(/g),
      }))
      .filter((f) => f.spreads < f.calls);
    expect(short).toEqual([]);
  });

  it("buildMeleeHooks supplies them for the pure combat layer", () => {
    const src = readFileSync(path.join(SRC, "game", "player-turn.ts"), "utf8");
    /* combat/melee.ts's two monTakeHit calls both read MeleeEffectHooks.takeHit,
     * and buildMeleeHooks is its only production producer. */
    expect(src).toMatch(/takeHit:\s*\{\s*\.\.\.gameTakeHitHooks\(state, mon\)/);
  });
});
