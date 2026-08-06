/**
 * PORT_TODO 4.2: the quest system's SESSION wiring.
 *
 * quest.ts itself was ported and unit-tested long ago; what this file covers is
 * the set of places the rest of the game has to reach it from, each of which was
 * found by censusing every is_quest / quest / recall_depth site in 4.2.6 rather
 * than by reading the port:
 *
 *   - TrapEnv.isQuest, which nothing supplied, so trap.c's "no trap doors on
 *     quest levels" rule never fired on the runtime trap-creation path;
 *   - on_new_level's `max_depth = recall_depth = depth`, of which the port set
 *     only the first half;
 *   - rd_quests, which upstream rebuilds from the CURRENT quest table rather
 *     than restoring names and races out of the savefile.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadGame, saveGame, startGame } from "./game.js";
import type { GamePack } from "./game.js";
import type { SavedGame } from "./save.js";
import { pickTrap } from "../game/trap.js";
import { TRF } from "../generated/index.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
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

describe("trap.c L308-320: no trap doors on quest levels (runtime path)", () => {
  /**
   * pick_trap's rejections are not cosmetic: dropping a kind also drops its
   * slice out of the cumulative rarity total, so the randint0(prob_max) draw
   * itself changes. Rather than assert on one draw, run the picker many times
   * and classify every kind it can return.
   */
  function trapdoorRate(depth: number, draws: number): number {
    const game = startGame(pack, { seed: 5150, depth });
    const state = game.state;
    const deps = game.wizardBundles.trapDeps;
    expect(deps).toBeDefined();
    /* The guardian must actually be outstanding for is_quest to be true. */
    expect(state.actor.player.quests.length).toBeGreaterThan(0);

    let downs = 0;
    for (let i = 0; i < draws; i++) {
      const tidx = pickTrap(state, state.chunk.feat(state.actor.grid), depth, deps!);
      if (tidx < 0) continue;
      const kind = deps!.kinds[tidx];
      if (kind?.flags.has(TRF.DOWN)) downs++;
    }
    return downs;
  }

  it("never picks a trapdoor on Sauron's level, and does on the level above", () => {
    /* Depth 98 is the control: same picker, same seed family, no quest. The
     * trapdoor has to be REACHABLE there or the depth-99 zero proves nothing. */
    expect(trapdoorRate(98, 400)).toBeGreaterThan(0);
    expect(trapdoorRate(99, 400)).toBe(0);
  });

  it("never picks a trapdoor on Morgoth's level either", () => {
    expect(trapdoorRate(100, 400)).toBe(0);
  });
});

describe("on_new_level (game-world.c:1023-1024): max_depth AND recall_depth", () => {
  it("a new deepest level moves the Word of Recall anchor with it", () => {
    const game = startGame(pack, { seed: 7171, depth: 1 });
    const p = game.state.actor.player;
    expect(p.maxDepth).toBe(1);
    expect(p.recallDepth).toBe(1);

    game.changeLevel(4);
    expect(p.maxDepth).toBe(4);
    expect(p.recallDepth).toBe(4);

    /* Climbing back up moves neither: max_depth is a high-water mark and
     * recall_depth rides with it. */
    game.changeLevel(2);
    expect(p.maxDepth).toBe(4);
    expect(p.recallDepth).toBe(4);
  });
});

describe("rd_quests (load.c:623-645)", () => {
  function savedGame(): SavedGame {
    const game = startGame(pack, { seed: 3131, depth: 2 });
    /* Sauron's quest half-done is not reachable at max_num 1, so use the
     * completion state instead: level cleared to 0, one kill recorded. */
    const q = game.state.actor.player.quests[0]!;
    q.level = 0;
    q.curNum = 1;
    return JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
  }

  it("takes level and cur_num from the save, and everything else from the table", () => {
    const saved = savedGame();
    /* A savefile whose immutable fields disagree with the game's own data -
     * exactly what a shifted monster table produces. Upstream never reads
     * these, so they must not survive the load. */
    const stored = saved.player.quests!;
    stored[0]!.name = "Not Sauron";
    stored[0]!.race = 1;
    stored[0]!.maxNum = 99;

    const restored = loadGame(pack, saved).state.actor.player.quests;
    const table = startGame(pack, { seed: 1, depth: 1 }).state.actor.player
      .quests;

    /* Immutable halves: from the quest table, derived here rather than
     * written down, so a content change moves both sides together. */
    expect(restored[0]!.name).toBe(table[0]!.name);
    expect(restored[0]!.race).toBe(table[0]!.race);
    expect(restored[0]!.maxNum).toBe(table[0]!.maxNum);
    /* Mutable halves: from the save. */
    expect(restored[0]!.level).toBe(0);
    expect(restored[0]!.curNum).toBe(1);
    /* The untouched second quest still reads straight through. */
    expect(restored[1]!.level).toBe(table[1]!.level);
    expect(restored[1]!.curNum).toBe(0);
  });

  it("a save written before the quest system reloads with a win condition", () => {
    const saved = savedGame();
    delete saved.player.quests;

    const restored = loadGame(pack, saved).state.actor.player.quests;
    const table = startGame(pack, { seed: 1, depth: 1 }).state.actor.player
      .quests;
    expect(restored).toEqual(table);
    expect(restored.length).toBeGreaterThan(0);
  });

  it("refuses a save claiming more quests than the game defines", () => {
    const saved = savedGame();
    const stored = saved.player.quests!;
    saved.player.quests = [...stored, ...stored, ...stored];
    expect(() => loadGame(pack, saved)).toThrow(/too many .* quests/);
  });
});
