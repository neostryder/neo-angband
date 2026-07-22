/**
 * Regression guard for audit 01 T1 (player_inc_check over-exertion gate) and T2
 * (on_begin_effect / on_end_effect chains), both HIGH. These were faithful
 * primitives left UNWIRED on the live paths:
 *
 * - T1 (player-timed.c:1056): the world-clock over-exertion increases call
 *   playerIncTimed with check=true but the live timedHooks lacked incCheck, so
 *   timed.ts defaulted to ALLOW and PROT_CONF / RES_CHAOS / RES_NEXUS were
 *   ignored (SCRAMBLE from over-exertion landed on a NEXUS-resistant player).
 * - T2 (player-timed.c:873-891): the bound TimedEffect never carried the
 *   on-begin/on-end effect chains and the live timedHooks never supplied
 *   onTransition, so SCRAMBLE's SCRAMBLE_STATS / UNSCRAMBLE_STATS and SPRINT's
 *   ending TIMED_INC_NO_RES:SLOW never fired.
 *
 * These drive the REAL wired game (startGame) through state.world.timedHooks -
 * the exact hook object the game-turn over-exertion path uses.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "../session/game";
import type { GamePack } from "../session/game";
import { ELEM, TMD } from "../generated";
import { STAT_MAX } from "../player/types";
import { Rng } from "../rng";
import { playerClearTimed, playerIncTimed } from "../player/timed";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  quest: loadRecords("quest"),
  store: loadRecords("store"),
  obj: {
    objectBase: loadJson("object_base"),
    object: loadJson("object"),
    egoItem: loadJson("ego_item"),
    artifact: loadJson("artifact"),
    curse: loadJson("curse"),
    brand: loadJson("brand"),
    slay: loadJson("slay"),
    activation: loadJson("activation"),
    objectProperty: loadJson("object_property"),
    flavor: loadJson("flavor"),
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
};

function start(seed: number) {
  return startGame(pack, { seed, depth: 1, className: "Warrior" });
}

describe("over-exertion inc_check gate on the world path (audit 01 T1)", () => {
  it("a NEXUS-resistant player resists a checked SCRAMBLE increase", () => {
    const game = start(101);
    const p = game.state.actor.player;
    const scramble = game.state.world!.timedTable![TMD.SCRAMBLE]!;
    const hooks = game.state.world!.timedHooks!;

    /* Grant RES_NEXUS on the live derived state (SCRAMBLE's fail is RESIST
     * NEXUS, player_timed.txt). */
    const elInfo = game.state.playerState!.elInfo[ELEM.NEXUS]!;
    elInfo.resLevel = 1;

    const applied = playerIncTimed(p, scramble, 10, true, true, true, hooks);
    expect(applied).toBe(false);
    expect(p.timed[TMD.SCRAMBLE]).toBe(0);
  });

  it("without the resist, the same checked increase lands", () => {
    const game = start(101);
    const p = game.state.actor.player;
    const scramble = game.state.world!.timedTable![TMD.SCRAMBLE]!;
    const hooks = game.state.world!.timedHooks!;
    game.state.playerState!.elInfo[ELEM.NEXUS]!.resLevel = 0;

    const applied = playerIncTimed(p, scramble, 10, true, true, true, hooks);
    expect(applied).toBe(true);
    expect(p.timed[TMD.SCRAMBLE]).toBeGreaterThan(0);
  });
});

describe("on-begin/on-end effect chains fire in live play (audit 01 T2)", () => {
  it("SCRAMBLE scrambles stats on begin and restores them on end", () => {
    const game = start(202);
    const p = game.state.actor.player;
    const scramble = game.state.world!.timedTable![TMD.SCRAMBLE]!;
    const hooks = game.state.world!.timedHooks!;

    /* Distinct stat values so a permutation is observable; identity map. */
    for (let i = 0; i < STAT_MAX; i++) {
      p.statCur[i] = 10 + i;
      p.statMax[i] = 10 + i;
      p.statMap[i] = i;
    }
    const cur = (): number[] => Array.from(p.statCur).slice(0, STAT_MAX);
    const map = (): number[] => Array.from(p.statMap).slice(0, STAT_MAX);
    const origCur = cur();
    const identity = Array.from({ length: STAT_MAX }, (_v, i) => i);

    /* Reseed so SCRAMBLE_STATS's Fisher-Yates is a known non-identity
     * permutation (seed 5 -> [4,0,1,2,3]), making the begin dispatch provable. */
    game.state.rng = new Rng(5);

    /* Begin: SCRAMBLE_STATS runs, permuting the stats (statMap leaves identity). */
    playerIncTimed(p, scramble, 10, true, true, false, hooks);
    expect(map()).not.toEqual(identity);
    expect(cur()).not.toEqual(origCur);
    /* The multiset of stat values is preserved by the permutation. */
    expect([...cur()].sort()).toEqual([...origCur].sort());

    /* End: UNSCRAMBLE_STATS runs, restoring the original stats and identity. */
    playerClearTimed(p, scramble, true, true, hooks);
    expect(map()).toEqual(identity);
    expect(cur()).toEqual(origCur);
  });

  it("SPRINT applies SLOW via its on-end chain when it lapses", () => {
    const game = start(202);
    const p = game.state.actor.player;
    const sprint = game.state.world!.timedTable![TMD.SPRINT]!;
    const hooks = game.state.world!.timedHooks!;
    expect(p.timed[TMD.SLOW]).toBe(0);

    playerIncTimed(p, sprint, 20, true, true, false, hooks);
    expect(p.timed[TMD.SPRINT]).toBeGreaterThan(0);

    /* End: TIMED_INC_NO_RES:SLOW (effect-dice 100) fires. */
    playerClearTimed(p, sprint, true, true, hooks);
    expect(p.timed[TMD.SLOW]).toBeGreaterThan(0);
  });
});
