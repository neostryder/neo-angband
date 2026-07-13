import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Rng } from "../rng";
import { bindPlayer } from "./bind";
import { blankPlayer } from "./player";
import type { Player } from "./player";
import { PY_MAX_LEVEL } from "./types";
import {
  adjustLevel,
  PLAYER_EXP,
  playerExpGain,
  playerExpLose,
  playerKillExp,
  playerStatDec,
  playerStatInc,
  rollHp,
} from "./exp";

function loadRecords<T>(name: string): T[] {
  return (
    JSON.parse(
      readFileSync(
        new URL(`../../../content/pack/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as { records: T[] }
  ).records;
}

const players = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
});

function human(): Player {
  const race = players.raceByName("Human")!;
  const cls = players.classByName("Warrior")!;
  const p = blankPlayer(race, cls, players.bodies[race.body]!);
  p.expFactor = 100;
  p.hitdie = 10;
  p.lev = 1;
  p.maxLev = 1;
  for (let i = 0; i < 5; i++) {
    p.statCur[i] = 12;
    p.statMax[i] = 12;
  }
  rollHp(p, new Rng(9));
  return p;
}

const deps = (msgs: string[] = []) => ({
  rng: new Rng(5),
  msg: (t: string) => msgs.push(t),
});

describe("player_exp_gain / adjust_level (player.c)", () => {
  it("crossing a threshold gains a level with the welcome message", () => {
    const p = human();
    const msgs: string[] = [];
    playerExpGain(p, PLAYER_EXP[0]!, deps(msgs));
    expect(p.lev).toBe(2);
    expect(p.maxLev).toBe(2);
    expect(msgs).toContain("Welcome to level 2.");
  });

  it("expFactor scales the thresholds", () => {
    const p = human();
    p.expFactor = 200; /* needs double exp */
    playerExpGain(p, PLAYER_EXP[0]!, deps());
    expect(p.lev).toBe(1);
    playerExpGain(p, PLAYER_EXP[0]!, deps());
    expect(p.lev).toBe(2);
  });

  it("a big gain jumps several levels and restores drained stats", () => {
    const p = human();
    p.statCur[0] = 10; /* drained below max 12 */
    playerExpGain(p, 500, deps());
    /* 500 exp passes the thresholds 10..500, i.e. reaches level 11. */
    expect(p.lev).toBe(11);
    expect(p.statCur[0]).toBe(12);
  });

  it("losing experience drops the level; maxLev stays", () => {
    const p = human();
    playerExpGain(p, 100, deps()); /* thresholds 10..100 -> level 6 */
    expect(p.lev).toBe(6);
    playerExpLose(p, 95, false, deps());
    expect(p.lev).toBe(1);
    expect(p.maxLev).toBe(6);
    expect(p.exp).toBe(5);
  });

  it("gaining below maxExp restores a tenth toward it", () => {
    const p = human();
    playerExpGain(p, 100, deps());
    playerExpLose(p, 50, false, deps());
    const maxBefore = p.maxExp;
    playerExpGain(p, 20, deps());
    expect(p.maxExp).toBe(maxBefore + 2);
  });

  it("experience never goes negative and caps at PY_MAX_EXP", () => {
    const p = human();
    playerExpLose(p, 100, false, deps());
    expect(p.exp).toBe(0);
    p.exp = 99999999 + 5000;
    adjustLevel(p, deps());
    expect(p.exp).toBe(99999999);
    expect(p.lev).toBe(PY_MAX_LEVEL);
  });

  it("onGainLevel fires once per level gained, before the welcome message", () => {
    const p = human();
    const events: string[] = [];
    const gained: number[] = [];
    const withHooks = {
      rng: new Rng(5),
      msg: (t: string) => events.push(`msg:${t}`),
      onGainLevel: (_p: Player, lev: number) => {
        gained.push(lev);
        events.push(`gain:${lev}`);
      },
    };
    playerExpGain(p, 500, withHooks); /* reaches level 11 (thresholds 10..500) */
    expect(gained).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    /* history_add (onGainLevel) precedes msgt for each level, per player.c
     * L246-249. */
    expect(events.slice(0, 2)).toEqual(["gain:2", "msg:Welcome to level 2."]);
  });

  it("onGainLevel does NOT fire when verbose is false (a load-path replay)", () => {
    const p = human();
    const gained: number[] = [];
    p.exp = 500;
    p.maxExp = 500;
    adjustLevel(
      p,
      { rng: new Rng(5), onGainLevel: (_p, lev) => gained.push(lev) },
      false,
    );
    expect(p.lev).toBe(11);
    expect(gained).toEqual([]);
  });
});

describe("playerKillExp (mon-util.c player_kill_monster)", () => {
  it("grants mexp * rlev / plev with the fractional carry", () => {
    const p = human();
    p.lev = 3;
    p.exp = 30; /* stable at level 3 (>= 25, < 45) */
    p.maxExp = 30;
    /* mexp 5, level 2 -> 10/3 = 3 exp + 1/3 carried (21845/65536). */
    playerKillExp(p, { mexp: 5, level: 2 }, deps());
    expect(p.exp).toBe(33);
    expect(p.expFrac).toBe(21845);
    playerKillExp(p, { mexp: 5, level: 2 }, deps());
    playerKillExp(p, { mexp: 5, level: 2 }, deps());
    expect(p.exp).toBe(39);
    expect(p.expFrac).toBe(65535);
    /* The fourth kill overflows the carry into a whole point. */
    playerKillExp(p, { mexp: 5, level: 2 }, deps());
    expect(p.exp).toBe(43);
    expect(p.expFrac).toBe(21844);
    expect(p.lev).toBe(3);
  });
});

describe("roll_hp (player-birth.c)", () => {
  it("rolls monotonically increasing hitdice within the band", () => {
    const p = human();
    const min = Math.trunc((PY_MAX_LEVEL * (p.hitdie - 1) * 3) / 8) + PY_MAX_LEVEL;
    const max = Math.trunc((PY_MAX_LEVEL * (p.hitdie - 1) * 5) / 8) + PY_MAX_LEVEL;
    expect(p.playerHp[0]).toBe(p.hitdie);
    for (let i = 1; i < PY_MAX_LEVEL; i++) {
      expect(p.playerHp[i]!).toBeGreaterThan(p.playerHp[i - 1]!);
      expect(p.playerHp[i]! - p.playerHp[i - 1]!).toBeLessThanOrEqual(p.hitdie);
    }
    const total = p.playerHp[PY_MAX_LEVEL - 1]!;
    expect(total).toBeGreaterThanOrEqual(min);
    expect(total).toBeLessThanOrEqual(max);
  });
});

describe("player_stat_inc / player_stat_dec (player.c)", () => {
  it("dec drains a point in the teens, a tenth over 18/10", () => {
    const p = human();
    p.statCur[0] = 12;
    expect(playerStatDec(p, 0, false)).toBe(true);
    expect(p.statCur[0]).toBe(11);
    expect(p.statMax[0]).toBe(12); /* temporary drain */

    p.statCur[1] = 18 + 50;
    playerStatDec(p, 1, false);
    expect(p.statCur[1]).toBe(18 + 40);

    p.statCur[2] = 3;
    expect(playerStatDec(p, 2, false)).toBe(false);
  });

  it("permanent drains lower the maximum too", () => {
    const p = human();
    p.statCur[0] = 12;
    p.statMax[0] = 12;
    playerStatDec(p, 0, true);
    expect(p.statMax[0]).toBe(11);
  });

  it("inc raises a point below 18 and caps at 18/100", () => {
    const p = human();
    const rng = new Rng(2);
    p.statCur[0] = 12;
    expect(playerStatInc(p, rng, 0)).toBe(true);
    expect(p.statCur[0]).toBe(13);
    expect(p.statMax[0]).toBe(13);

    p.statCur[1] = 18 + 100;
    expect(playerStatInc(p, rng, 1)).toBe(false);
  });
});
