/**
 * Upstream unit tests from reference/src/tests/monster/monster.c
 *
 * Mapping:
 * - match_monster_bases -> a TEST-LOCAL helper comparing the registry's interned
 *   base object (the same pointer-identity test upstream's NULL-terminated
 *   varargs walk at mon-util.c:166 performs). Deliberately not production code:
 *   the C function is dead upstream, see the verdict note on the case below.
 * - choose_nearby_injured_kin -> chooseNearbyInjuredKin (game/mon-ranged.ts)
 * - t_build_arena / t_add_monster -> openArena / place (test-utils.c has no
 *   port counterpart; the arena is built directly)
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { loc } from "../loc";
import { Rng } from "../rng";
import { bindMonsters } from "../mon/bind";
import type { MonsterPackRecords } from "../mon/bind";
import { blankMonster } from "../mon/monster";
import type { Monster } from "../mon/monster";
import type { MonsterBase, MonsterRace } from "../mon/types";
import { Chunk } from "../world/chunk";
import { FeatureRegistry } from "../world/feature";
import type { TerrainRecordJson } from "../world/feature";
import {
  DEFAULT_GAME_CONSTANTS,
  addMonster,
  placePlayer,
} from "./context";
import type { GameState } from "./context";
import { chooseNearbyInjuredKin } from "./mon-ranged";
import { blankPlayer } from "../player/player";
import { bindPlayer } from "../player/bind";
import type { PlayerPackRecords } from "../player/bind";
import { newGear } from "./gear";
import { newKnownMap } from "./known";
import { newTargetState } from "./target";
import { IgnoreSettings } from "../obj/ignore";
import { makeRuneEnv } from "../obj/knowledge";

function packJson<T>(name: string): T[] {
  return (
    JSON.parse(
      readFileSync(
        new URL(`../../../content/pack/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as { records: T[] }
  ).records;
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

const terrain = JSON.parse(
  readFileSync(
    new URL("../../../content/pack/terrain.json", import.meta.url),
    "utf8",
  ),
) as { records: TerrainRecordJson[] };
const featureReg = new FeatureRegistry(terrain.records);
const FLOOR = featureReg.byCodeName("FLOOR").fidx;
const PERM = featureReg.byCodeName("PERM").fidx;

function matchMonsterBases(
  base: MonsterBase | null | undefined,
  ...names: string[]
): boolean {
  if (!base) return false;
  return names.some((n) => monReg.bases.get(n) === base);
}

function openArena(w: number, h: number): Chunk {
  const c = new Chunk(featureReg, h, w);
  c.fill(FLOOR);
  for (let x = 0; x < w; x++) {
    c.setFeat(loc(x, 0), PERM);
    c.setFeat(loc(x, h - 1), PERM);
  }
  for (let y = 0; y < h; y++) {
    c.setFeat(loc(0, y), PERM);
    c.setFeat(loc(w - 1, y), PERM);
  }
  return c;
}

function makeState(c: Chunk): GameState {
  const player = blankPlayer(
    plReg.races[0] as (typeof plReg.races)[number],
    plReg.classes[0] as (typeof plReg.classes)[number],
    plReg.bodies[0] as (typeof plReg.bodies)[number],
  );
  const state = {
    chunk: c,
    rng: new Rng(1),
    z: DEFAULT_GAME_CONSTANTS,
    actor: {
      player,
      grid: loc(10, 10),
      combat: {
        skills: new Array(12).fill(0),
        toH: 0,
        toD: 0,
        ac: 0,
        toA: 0,
        numBlows: 100,
        ammoMult: 1,
        numShots: 10,
        ammoTval: 0,
        blessWield: false,
      },
      defense: { ac: 0, toA: 0 },
    },
    monsters: [null] as (Monster | null)[],
    floor: new Map(),
    gear: newGear(),
    known: newKnownMap(c.height, c.width),
    target: newTargetState(),
    ignore: new IgnoreSettings(),
    runeEnv: makeRuneEnv(() => null, () => false),
    options: new Map(),
    turn: 0,
    arenaLevel: false,
    decoy: null,
    isDead: false,
  } as unknown as GameState;
  placePlayer(state, loc(10, 10));
  return state;
}

describe("monster/monster (reference/src/tests/monster/monster.c)", () => {
  /*
   * C: test_match_monster_bases -- upstream's regression test for #1409.
   *
   * VERDICT: N/A as a function. match_monster_bases is DEAD UPSTREAM. Its own
   * header at mon-util.c:166 says "This function is currently unused, except in
   * a test... -NRM-", and the only references anywhere in reference/src are that
   * definition, the prototype at mon-util.h:29, and tests/monster/monster.c. No
   * production caller exists in 4.2.6, so the port having no production
   * counterpart cannot change anything a player can reach, and porting a varargs
   * base-name matcher would be adding dead code. (Cross-confirmed: a W1-side
   * lane reached the same verdict on this symbol independently.)
   *
   * The assertions are KEPT ANYWAY, because what is left once the dead function
   * is discounted is a DATA check that costs nothing and is worth pinning: that
   * the shipped monster_base assignments still put the scruffy little dog on
   * "canine" and Morgoth on "Morgoth" and not on canine/lich/vampire/wraith. The
   * local matchMonsterBases below is a test helper for that purpose, not a port.
   *
   * The C reaches the dog as &r_info[3], i.e. positionally, and Morgoth through
   * lookup_monster by exact name. Both are reproduced literally: races[3] must
   * BE the scruffy little dog (it is the fourth record in monster.txt, after
   * <player>, filthy street urchin and scrawny cat), and the name lookups have
   * no fallbacks -- if the gamedata order or a name drifts, this must fail
   * rather than quietly test a different monster.
   */
  it("test_match_monster_bases", () => {
    const scruffy = monReg.races[3];
    expect(scruffy?.name).toBe("scruffy little dog");
    const base = scruffy!.base;
    expect(matchMonsterBases(base, "canine")).toBe(true);
    expect(matchMonsterBases(base, "zephyr hound", "canine")).toBe(true);
    expect(matchMonsterBases(base, "ainu")).toBe(false);
    expect(matchMonsterBases(base, "lich", "vampire", "wraith")).toBe(false);

    const morgoth = monReg.races.find(
      (r) => r.name === "Morgoth, Lord of Darkness",
    );
    expect(morgoth).toBeTruthy();
    const mbase = morgoth!.base;
    expect(matchMonsterBases(mbase, "canine")).toBe(false);
    expect(matchMonsterBases(mbase, "lich", "vampire", "wraith")).toBe(false);
    expect(matchMonsterBases(mbase, "person", "Morgoth")).toBe(true);
    expect(matchMonsterBases(mbase, "Morgoth")).toBe(true);
  });

  /*
   * C: test_nearby_kin. PORTED against real production code, unlike its
   * neighbour above: choose_nearby_injured_kin (mon-util.c:907) has live callers
   * at effect-handler-attack.c:324 (the MON_HEAL_KIN effect) and, via
   * find_any_nearby_injured_kin (mon-util.c:885), at mon-attack.c:169 where it
   * gates whether a monster will even consider casting RSF_HEAL_KIN. The port's
   * counterparts are chooseNearbyInjuredKin / findAnyNearbyInjuredKin in
   * game/mon-ranged.ts.
   *
   * Upstream names the three races outright via
   * t_add_monster(c, grid, "wolf" / "warg" / "wild cat"), so this does too --
   * the previous fuzzy regex-plus-base fallbacks could have silently swapped in
   * some other canine and still passed.
   */
  it("test_nearby_kin", () => {
    const wolfRace = monReg.races.find((r) => r.name === "wolf");
    const wargRace = monReg.races.find((r) => r.name === "warg");
    const catRace = monReg.races.find((r) => r.name === "wild cat");

    expect(wolfRace).toBeTruthy();
    expect(wargRace).toBeTruthy();
    expect(catRace).toBeTruthy();
    // Same base for wolf and warg is required for the kin tests.
    expect(wolfRace!.base).toBe(wargRace!.base);

    const c2 = openArena(20, 20);
    const st = makeState(c2);
    const place = (race: MonsterRace, g: { x: number; y: number }) => {
      const mon = blankMonster(race);
      mon.hp = mon.maxhp;
      mon.grid = g;
      addMonster(st, mon);
      return mon;
    };
    const w0 = place(wolfRace!, loc(5, 5));
    const w1 = place(wolfRace!, loc(4, 5));
    const a0 = place(wargRace!, loc(6, 5));
    const cat0 = place(catRace!, loc(5, 6));
    const w2 = place(wolfRace!, loc(9, 5));
    const a1 = place(wargRace!, loc(2, 2));
    const w3 = place(wolfRace!, loc(15, 5));

    expect(chooseNearbyInjuredKin(st, w0)).toBeNull();

    w1.hp -= 1;
    expect(chooseNearbyInjuredKin(st, w0)).toBe(w1);
    w1.hp += 1;

    a0.hp -= 1;
    expect(chooseNearbyInjuredKin(st, w0)).toBe(a0);
    a0.hp += 1;

    cat0.hp -= 1;
    expect(chooseNearbyInjuredKin(st, w0)).toBeNull();
    cat0.hp += 1;

    w3.hp -= 1;
    expect(chooseNearbyInjuredKin(st, w0)).toBeNull();
    w3.hp += 1;

    w2.hp -= 1;
    expect(chooseNearbyInjuredKin(st, w0)).toBe(w2);
    c2.setFeat(loc(8, 5), PERM);
    expect(chooseNearbyInjuredKin(st, w2)).toBeNull();
    c2.setFeat(loc(8, 5), FLOOR);
    w2.hp += 1;

    w1.hp -= 1;
    w2.hp -= 1;
    a0.hp -= 1;
    a1.hp -= 1;
    let seenW1 = 0;
    let seenW2 = 0;
    let seenA0 = 0;
    let seenA1 = 0;
    for (let i = 0; i < 1000; i++) {
      st.rng = new Rng(i + 1);
      const m = chooseNearbyInjuredKin(st, w0);
      if (m === w1) seenW1++;
      else if (m === w2) seenW2++;
      else if (m === a0) seenA0++;
      else if (m === a1) seenA1++;
    }
    expect(seenW1).toBeGreaterThan(0);
    expect(seenW2).toBeGreaterThan(0);
    expect(seenA0).toBeGreaterThan(0);
    expect(seenA1).toBeGreaterThan(0);
  });
});
