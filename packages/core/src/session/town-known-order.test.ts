import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game";
import type { GamePack } from "./game";
import { squareIsKnown } from "../game/known";
import { loc } from "../loc";

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

/**
 * Guards the load-bearing caveKnown -> caveIlluminateKnown call order
 * (generate.c:1538-1552, ported at game/known.ts caveKnown/caveIlluminateKnown)
 * against the two session/game.ts wiring sites that call them, rather than the
 * functions directly (those are covered by game/known.test.ts's "upstream
 * order leaves a NIGHT/DAYTIME town..." pair).
 *
 * The order is only observable at NIGHT: both calls only ever MEMORIZE by
 * day, and memorize-only operations commute, so a daytime check cannot tell
 * the two call sites apart from a reversed one. Only cave_illuminate's night
 * square_forget (cave-map.c:586-587) makes the order matter - swap the two
 * lines and a night town stops forgetting its boring floors.
 *
 * Site coverage:
 *  - makeChangeLevel (session/game.ts, recall-to-town branch around line
 *    2162-2165): covered below by driving state.turn into the night half of
 *    the day cycle, then recalling to town (depth 0).
 *  - startGame (session/game.ts, birth branch around line 2582-2585): NOT
 *    coverable this way. `turn: 0` is hardcoded in the state object literal
 *    startGame builds (no StartGameOptions field overrides it), and turn 0 is
 *    always daytime (isDaytime, world.ts:105-107), for any positive
 *    dayLength. Reaching a night birth would need a production-side test-only
 *    turn/daytime override in StartGameOptions, which is out of scope for a
 *    test-only change (see the test file's session for the full writeup).
 */
describe("cave_known / cave_illuminate call-order wiring (generate.c:1538-1552)", () => {
  it("a NIGHT recall-to-town forgets boring floors (session/game.ts makeChangeLevel)", () => {
    const game = startGame(pack, { seed: 123, depth: 1 });
    const state = game.state;

    // is_daytime (game-world.c L125, ported world.ts:105-107):
    //   turn % (10 * dayLength) < (10 * dayLength) / 2
    // Push turn to exactly the half-cycle boundary so the value is false
    // (night) the instant changeLevel recomputes it for the recalled town.
    state.turn = (10 * state.z.dayLength) / 2;

    game.changeLevel(0);
    expect(state.chunk.depth).toBe(0);

    let floors = 0;
    let knownFloors = 0;
    for (let y = 0; y < state.chunk.height; y++) {
      for (let x = 0; x < state.chunk.width; x++) {
        const g = loc(x, y);
        if (!state.chunk.isFloor(g)) continue;
        floors++;
        if (squareIsKnown(state, g)) knownFloors++;
      }
    }
    expect(floors).toBeGreaterThan(100);

    // Correct order (caveKnown THEN caveIlluminateKnown) lets the night
    // illumination pass forget the boring floors caveKnown just memorized
    // (cave-map.c:586-587). Swapping the two lines at the changeLevel call
    // site instead leaves every floor known (caveKnown runs last and
    // re-memorizes everything) - that reversal is exactly what this assertion
    // must catch.
    expect(knownFloors).toBeLessThan(floors);
  });
});
