/**
 * The bulk known-level read: player memory stays apart from the live level.
 *
 * PURITY IS MEASURED, NOT ASSUMED. Each read test serializes the whole game with
 * saveGame, and records the RNG state, the turn and the command queue, before
 * and after reading repeatedly; any difference is a read that wrote.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PlayerCommand } from "../game/context.js";
import { runGameLoop } from "../game/loop.js";
import { saveGame, startGame } from "../session/game.js";
import type { GamePack, StartedGame } from "../session/game.js";
import { TMD, FEAT, TRF, SQUARE } from "../generated/index.js";
import { squareKnowPile, squareMemorize } from "../game/known.js";
import { gearGet } from "../game/gear.js";
import type { Trap } from "../game/trap.js";
import { AgentCapabilityError } from "./types.js";
import { createAgentView } from "./perceive.js";

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
  store: loadRecords("store"),
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
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

function newGame(): StartedGame {
  return startGame(pack, { seed: 4242, depth: 1 });
}

/** Feed `queue` to the loop one command at a time, then report no input. */
function feed(game: StartedGame, queue: PlayerCommand[]): void {
  game.state.nextCommand = () => queue.shift() ?? null;
}

/** Everything a read must not change, as one comparable value. */
function fingerprint(game: StartedGame): string {
  return JSON.stringify({
    save: saveGame(game),
    rng: game.state.rng.getState(),
    turn: game.state.turn,
    cmdQueue: game.state.cmdQueue ?? [],
  });
}

function gridAwayFromPlayer(game: StartedGame): { x: number; y: number } {
  const { chunk, actor } = game.state;
  for (let y = 2; y < chunk.height - 2; y++) {
    for (let x = 2; x < chunk.width - 2; x++) {
      if (Math.abs(x - actor.grid.x) + Math.abs(y - actor.grid.y) > 15) {
        return { x, y };
      }
    }
  }
  throw new Error("no distant grid");
}

function floorObject(game: StartedGame) {
  const handle = game.state.gear.pack[0] ?? game.state.actor.player.equipment.find(Boolean);
  const obj = handle ? gearGet(game.state.gear, handle) : undefined;
  if (!obj) throw new Error("seeded game has no object");
  return obj;
}

function caps(...granted: string[]) {
  return { has: (cap: string) => granted.includes(cap) };
}

describe("known level", () => {
  it("reads five times without moving the save, RNG, turn or command queue, even while hallucinating", () => {
    const game = newGame();
    game.state.actor.player.timed[TMD.IMAGE] = 10;
    const before = fingerprint(game);
    const view = createAgentView(game.state);
    const first = view.knownLevel!()!;
    for (let i = 0; i < 5; i++) expect(view.knownLevel!()!).toEqual(first);
    expect(fingerprint(game)).toBe(before);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.cells)).toBe(true);
    expect(Object.isFrozen(first.cells[0]?.remembered)).toBe(true);
  });

  it("separates unknown changes in real terrain, traps and objects", () => {
    const game = newGame();
    const grid = gridAwayFromPlayer(game);
    const { state } = game;
    squareMemorize(state, grid);
    const rememberedFeat = state.chunk.feat(grid);
    state.chunk.setFeat(grid, rememberedFeat === FEAT.FLOOR ? FEAT.GRANITE : FEAT.FLOOR);
    const index = grid.y * state.chunk.width + grid.x;
    state.floor.set(index, [floorObject(game)]);
    state.traps.set(index, [{
      tidx: 3, kind: { tidx: 3, name: "test trap" }, grid,
      power: 0, timeout: 0, flags: new Set([TRF.TRAP]),
    } as unknown as Trap]);
    const limited = createAgentView(state, undefined, {}, caps("state:map.read")).knownLevel!()!;
    const cell = limited.cells.find((c) => c.x === grid.x && c.y === grid.y)!;
    expect(cell.remembered).toMatchObject({ feat: rememberedFeat, traps: [], objects: [] });
    expect(cell).not.toHaveProperty("actual");
    const privileged = createAgentView(state, undefined, {}, caps("state:map.read", "state:map-actual.read")).knownLevel!()!;
    expect(privileged.cells.find((c) => c.x === grid.x && c.y === grid.y)?.actual).toMatchObject({
      feat: state.chunk.feat(grid), traps: [{ index: 3 }], objects: [{ handle: 0 }],
    });
    const visibleTrap = state.traps.get(index)![0]!;
    (visibleTrap.flags as unknown as Set<number>).add(TRF.VISIBLE);
    const rememberedTrap = createAgentView(state, undefined, {}, caps("state:map.read"))
      .knownLevel!()!.cells.find((c) => c.x === grid.x && c.y === grid.y);
    expect(rememberedTrap?.remembered.traps).toEqual([{ index: 3, name: "test trap" }]);
  });

  it("keeps a seen pile after it leaves view and the real floor changes", () => {
    const game = newGame();
    const grid = gridAwayFromPlayer(game);
    const { state } = game;
    const index = grid.y * state.chunk.width + grid.x;
    state.floor.set(index, [floorObject(game)]);
    squareMemorize(state, grid);
    squareKnowPile(state, grid);
    state.chunk.sqinfoOn(grid, SQUARE.VIEW);
    const view = createAgentView(state, undefined, {}, caps("state:map.read", "state:map-actual.read"));
    expect(view.knownLevel!()!.cells.find((c) => c.x === grid.x && c.y === grid.y)?.visible).toBe(true);
    state.chunk.sqinfoOff(grid, SQUARE.VIEW);
    state.floor.delete(index);
    const cell = view.knownLevel!()!.cells.find((c) => c.x === grid.x && c.y === grid.y)!;
    expect(cell.visible).toBe(false);
    expect(cell.remembered.objects).toHaveLength(1);
    expect(cell.actual?.objects).toEqual([]);
  });

  it("changes level id only with a level change", () => {
    const game = newGame();
    const view = createAgentView(game.state);
    const id = view.knownLevel!()!.levelId;
    expect(view.knownLevel!()!.levelId).toBe(id);
    feed(game, [{ code: "hold" }]);
    runGameLoop(game.state, game.registry);
    expect(view.knownLevel!()!.levelId).toBe(id);
    game.changeLevel(2);
    expect(view.knownLevel!()!.levelId).toBe(id + 1);
  });

  it("throws the usual capability error without map access", () => {
    const game = newGame();
    const view = createAgentView(game.state, undefined, {}, caps("state:player.read"));
    expect(() => view.knownLevel!()!).toThrow(AgentCapabilityError);
  });
});
