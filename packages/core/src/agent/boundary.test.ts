/**
 * The input boundary (boundary.ts): a token per input wait and a read-pure
 * capture of the game at that wait.
 *
 * PURITY IS MEASURED, NOT ASSUMED. Each read test serializes the whole game with
 * saveGame, and records the RNG state, the turn and the command queue, before
 * and after reading repeatedly; any difference is a read that wrote.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PlayerCommand } from "../game/context.js";
import { LOOP_STATUS, runGameLoop } from "../game/loop.js";
import { targetSetLocation } from "../game/target.js";
import { loc } from "../loc.js";
import { GameEvents } from "../events.js";
import { teleportPlayer } from "../game/effect-teleport.js";
import { saveGame, startGame } from "../session/game.js";
import type { GamePack, StartedGame } from "../session/game.js";
import { inputToken, tokenIsCurrent } from "./boundary.js";
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
  /* store.json is here because one arm of LoadoutItemRef addresses a SHOP's
     stock, and a pack with no shops cannot exercise it. */
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

describe("capture is read-pure", () => {
  it("leaves the save, the RNG, the turn and the command queue unchanged", () => {
    const game = newGame();
    feed(game, [{ code: "hold" }, { code: "hold" }]);
    runGameLoop(game.state, game.registry);
    runGameLoop(game.state, game.registry);
    const view = createAgentView(game.state);
    const before = fingerprint(game);
    const first = view.capture!();
    for (let i = 0; i < 5; i++) {
      expect(view.capture!()).toEqual(first);
      view.inputToken!();
    }
    expect(fingerprint(game)).toBe(before);
  });

  it("is deep-frozen and shares nothing with the live game", () => {
    const game = newGame();
    const view = createAgentView(game.state);
    const snap = view.capture!();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.player)).toBe(true);
    expect(Object.isFrozen(snap.inventory)).toBe(true);
    expect(snap.player).not.toBe(view.player());
    expect(snap.turn).toBe(game.state.turn);
    expect(snap.equipmentSlots).toEqual(game.state.actor.player.body.slots);
    expect(Object.isFrozen(snap.equipmentSlots)).toBe(true);
    expect(snap.quiver).toEqual([]);
    expect(Object.isFrozen(snap.floorHere)).toBe(true);
    expect(snap.player?.learnableSpells).toBe(game.state.actor.player.upkeep.newSpells);
    for (const item of snap.inventory ?? []) {
      expect(item.kindKey).toBe(`kind:${game.state.gear.store.get(item.handle)!.kind.kidx}`);
      expect(item.itemKey).toBe(`gear:${item.handle}`);
      expect(typeof item.nameColor).toBe("string");
    }
  });

  it("returns null for a part the caller cannot read, and never throws for it", () => {
    const game = newGame();
    const caps = { has: (c: string) => c === "state:player.read" };
    const snap = createAgentView(game.state, undefined, {}, caps).capture!();
    expect(snap.player).not.toBeNull();
    expect(snap.inventory).toBeNull();
    expect(snap.equipmentSlots).toBeNull();
    expect(snap.quiver).toBeNull();
    expect(snap.floorHere).toBeNull();
    expect(snap.monsters).toBeNull();
    expect(snap.targetReadable).toBe(false);
  });
});

describe("resolved event subscribers", () => {
  it("leave a seeded game's save, RNG, and messages byte-identical", () => {
    const play = (subscribe: boolean): { save: string; rng: string; messages: string } => {
      const game = newGame();
      const bus = new GameEvents();
      game.state.events = bus;
      const messages: Array<[string, string | number | undefined]> = [];
      const original = game.state.msg;
      let motions = 0;
      game.state.msg = (message, type) => {
        messages.push([message, type]);
        original?.(message, type);
      };
      if (subscribe) {
        bus.on("combat-outcome", () => {});
        bus.on("heal", () => {});
        bus.on("motion", () => { motions++; });
      }
      teleportPlayer(game.state, 10);
      if (subscribe) expect(motions).toBe(1);
      feed(game, [{ code: "hold" }, { code: "hold" }]);
      runGameLoop(game.state, game.registry);
      runGameLoop(game.state, game.registry);
      return {
        save: JSON.stringify(saveGame(game)),
        rng: JSON.stringify(game.state.rng.getState()),
        messages: JSON.stringify(messages),
      };
    };
    expect(play(true)).toEqual(play(false));
  });
});

describe("the token moves only at a real boundary", () => {
  it("stays fixed while the host re-enters the loop with nothing to take", () => {
    const game = newGame();
    feed(game, []);
    const token = inputToken(game.state);
    for (let i = 0; i < 3; i++) {
      expect(runGameLoop(game.state, game.registry)).toBe(LOOP_STATUS.INPUT);
    }
    expect(tokenIsCurrent(game.state, token)).toBe(true);
  });

  it("changes when the loop takes a command", () => {
    const game = newGame();
    const token = inputToken(game.state);
    feed(game, [{ code: "hold" }]);
    runGameLoop(game.state, game.registry);
    expect(tokenIsCurrent(game.state, token)).toBe(false);
  });

  it("changes when the target is set without a turn", () => {
    const game = newGame();
    const token = inputToken(game.state);
    const p = game.state.actor.grid;
    targetSetLocation(game.state, loc(p.x, p.y));
    expect(tokenIsCurrent(game.state, token)).toBe(false);
  });

  it("changes when the level changes", () => {
    const game = newGame();
    const token = inputToken(game.state);
    game.changeLevel(2);
    expect(tokenIsCurrent(game.state, token)).toBe(false);
  });

  it("never matches a token from another game, even at the same revision", () => {
    const a = newGame();
    const b = newGame();
    const ta = inputToken(a.state);
    expect(ta.revision).toBe(inputToken(b.state).revision);
    expect(tokenIsCurrent(b.state, ta)).toBe(false);
    expect(tokenIsCurrent(a.state, ta)).toBe(true);
  });

  it("rejects anything that is not a token", () => {
    const game = newGame();
    expect(tokenIsCurrent(game.state, null)).toBe(false);
    expect(tokenIsCurrent(game.state, undefined)).toBe(false);
  });
});
