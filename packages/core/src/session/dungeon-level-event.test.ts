/**
 * The `dungeonlevel` event: one per arrival on a level (on_new_level's
 * EVENT_NEW_LEVEL_DISPLAY, game-world.c:1031), never one per redraw.
 *
 * Every arrival path in the level changer is driven through the real session:
 * stairs both ways, teleport level and deep descent through the live effect
 * bundle, Word of Recall through processWorld in both directions, a trap door, a
 * debug jump, a persistent-level revisit and the single-combat arena. The session's first level is announced by the host
 * through announceArrival, for a new game and for a load alike, as start_game
 * runs on_new_level for both (ui-game.c:743).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { subscribeEvents } from "../agent/events.js";
import { captureKnownLevel } from "../agent/known-level.js";
import { AgentCapabilityError } from "../agent/types.js";
import type { AgentCapabilities } from "../agent/types.js";
import { sourcePlayer } from "../effects/interpreter.js";
import type { EffectContext } from "../effects/interpreter.js";
import { buildEffectContext } from "../game/effect-env.js";
import { attachGameEnv } from "../game/effect-game-env.js";
import { processWorld } from "../game/loop.js";
import { hitTrap, placeTrap } from "../game/trap.js";
import { wizJumpLevel } from "../game/wizard.js";
import { EF } from "../generated/index.js";
import { GameEvents } from "../events.js";
import type { DungeonLevelEventData } from "../events.js";
import { lookupTrap } from "../world/trap.js";
import { loadGame, saveGame, startGame } from "./game.js";
import type { GamePack, StartedGame } from "./game.js";

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

/** A capability set granting exactly the listed names, as a manifest would. */
function caps(...granted: string[]): AgentCapabilities {
  const set = new Set(granted);
  return { has: (cap) => set.has(cap) };
}

interface Listening {
  heard: DungeonLevelEventData[];
  /** Arrival events and messages in the order they reached the listener. */
  order: string[];
}

/** Attach a bus the way a host does and subscribe one mod holding event:dungeonlevel. */
function listen(game: StartedGame): Listening {
  const bus = new GameEvents();
  game.state.events = bus;
  const heard: DungeonLevelEventData[] = [];
  const order: string[] = [];
  subscribeEvents(bus, caps("event:dungeonlevel")).on("dungeonlevel", (_type, data) => {
    heard.push(data);
    order.push(`level ${data.depth}`);
  });
  game.state.msg = (text: string): void => {
    order.push(`msg ${text}`);
  };
  return { heard, order };
}

/** The host's LEVEL_CHANGE step (packages/web main.ts): change, then clear the request. */
function takeLevelChange(game: StartedGame): void {
  expect(game.state.generateLevel, "a level change must have been requested").toBe(true);
  game.changeLevel(game.state.targetDepth!);
  game.state.generateLevel = false;
}

function command(game: StartedGame, code: string): void {
  const action = game.registry.get(code);
  expect(action, `the session must register ${code}`).toBeTruthy();
  action!(game.state, { code });
}

/** An effect context over the live bundle, the same one a scroll or spell uses. */
function liveCtx(game: StartedGame): EffectContext {
  const eff = game.wizardBundles.effect!;
  return attachGameEnv(buildEffectContext(game.state, eff.envDeps!), {
    state: game.state,
    cast: eff.cast!,
    teleport: eff.teleport!,
    ...(eff.general ? { general: eff.general } : {}),
  });
}

describe("the session's first level", () => {
  it("is announced once, by the host, as a new game", () => {
    const game = startGame(pack, { seed: 3, depth: 0 });
    const { heard } = listen(game);
    expect(heard, "startGame itself runs before any listener exists").toEqual([]);

    game.announceArrival();
    game.announceArrival();

    expect(heard).toEqual([{ depth: 0, levelId: 0, cause: "new-game", arena: false }]);
  });

  it("counts a loaded save as an arrival, as start_game does", () => {
    const saved = startGame(pack, { seed: 3, depth: 0 });
    command(saved, "descend");
    takeLevelChange(saved);
    const game = loadGame(pack, saveGame(saved));
    const { heard } = listen(game);

    game.announceArrival();
    command(game, "ascend");
    takeLevelChange(game);

    expect(heard).toEqual([
      { depth: 1, levelId: 0, cause: "load", arena: false },
      { depth: 0, levelId: 1, cause: "change", arena: false },
    ]);
  });

  it("is not announced over a level the player has already left", () => {
    const game = startGame(pack, { seed: 3, depth: 0 });
    const { heard } = listen(game);
    command(game, "descend");
    takeLevelChange(game);
    game.announceArrival();

    expect(heard.map((e) => e.cause)).toEqual(["change"]);
  });
});

describe("every level change sends exactly one event", () => {
  it("covers stairs down and up, recall to town and back down, and teleport level", () => {
    const game = startGame(pack, { seed: 3, depth: 0, className: "Warrior" });
    const { heard, order } = listen(game);
    game.announceArrival();

    const beforeDescent = order.length;
    command(game, "descend");
    takeLevelChange(game);
    expect(heard.at(-1)).toMatchObject({ depth: 1, cause: "change" });
    /* on_new_level's order: the stair message is flushed first, then the arrival
     * is signalled, then the level feeling is announced (game-world.c:1027-1049). */
    const descent = order.slice(beforeDescent);
    expect(descent).toHaveLength(3);
    expect(descent[0]).toBe("msg You enter a maze of down staircases.");
    expect(descent[1]).toBe("level 1");
    expect(descent[2]).toMatch(/^msg /);

    command(game, "ascend");
    takeLevelChange(game);
    expect(heard.at(-1)).toMatchObject({ depth: 0, cause: "change" });

    command(game, "descend");
    takeLevelChange(game);
    expect(game.state.chunk.depth).toBe(1);

    /* Word of Recall going off in the dungeon returns the player to town. */
    game.state.actor.player.wordRecall = 1;
    processWorld(game.state);
    expect(game.state.targetDepth).toBe(0);
    takeLevelChange(game);
    expect(heard.at(-1)).toMatchObject({ depth: 0, cause: "change" });

    /* And from town it drops the player to the recall depth. */
    const recallDepth = game.state.actor.player.recallDepth;
    expect(recallDepth).toBe(1);
    game.state.actor.player.wordRecall = 1;
    processWorld(game.state);
    takeLevelChange(game);
    expect(heard.at(-1)).toMatchObject({ depth: recallDepth, cause: "change" });

    /* EF_TELEPORT_LEVEL picks up or down at random; either way it is one arrival. */
    game.effects!.effectSimple(EF.TELEPORT_LEVEL, liveCtx(game), { origin: sourcePlayer() });
    const teleportedTo = game.state.targetDepth!;
    expect([0, 2]).toContain(teleportedTo);
    takeLevelChange(game);
    expect(heard.at(-1)).toMatchObject({ depth: teleportedTo, cause: "change" });

    expect(heard.map((e) => e.depth)).toEqual([0, 1, 0, 1, 0, 1, teleportedTo]);
    /* One serial per arrival, matching the known-level read's levelId. */
    expect(heard.map((e) => e.levelId)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(heard.every((e) => !e.arena)).toBe(true);
    const known = captureKnownLevel(game.state);
    expect(heard.at(-1)).toMatchObject({ levelId: known.levelId, depth: known.depth });
  });

  it("covers a trap door, deep descent and a debug jump", () => {
    const game = startGame(pack, { seed: 3, depth: 1, className: "Warrior" });
    const { heard } = listen(game);
    const state = game.state;

    /* A trap door under the player drops them one level (trap.c hit_trap). */
    const trapDeps = game.wizardBundles.trapDeps!;
    const trapdoor = lookupTrap(trapDeps.kinds, "trap door")!;
    placeTrap(state, state.actor.grid, trapdoor.tidx, state.chunk.depth, trapDeps);
    hitTrap(state, state.actor.grid, -1, trapDeps);
    takeLevelChange(game);
    expect(heard.at(-1)).toMatchObject({ depth: 2, cause: "change" });

    /* Deep descent arms a countdown that processWorld runs out (game-world.c:815). */
    game.effects!.effectSimple(EF.DEEP_DESCENT, liveCtx(game), { origin: sourcePlayer() });
    expect(state.actor.player.deepDescent).toBeGreaterThan(0);
    for (let tick = 0; tick < 10 && !state.generateLevel; tick++) processWorld(state);
    const descentDepth = state.targetDepth!;
    expect(descentDepth).toBeGreaterThan(2);
    takeLevelChange(game);
    expect(heard.at(-1)).toMatchObject({ depth: descentDepth, cause: "change" });

    /* The debug menu's jump to a chosen level (cmd-wizard.c do_cmd_wiz_jump_level). */
    expect(wizJumpLevel(state, { level: 3 }, { debug: true, wizard: false })).toBe(true);
    takeLevelChange(game);
    expect(heard.at(-1)).toMatchObject({ depth: 3, cause: "change" });

    expect(heard.map((e) => e.depth)).toEqual([2, descentDepth, 3]);
  });

  it("covers a persistent level restored on revisit", () => {
    const game = startGame(pack, {
      seed: 4242,
      depth: 1,
      optionOverrides: { birth_levels_persist: true },
    });
    const { heard } = listen(game);
    game.changeLevel(2);
    game.changeLevel(1);
    game.changeLevel(2);

    expect(heard.map((e) => e.depth)).toEqual([2, 1, 2]);
    expect(game.state.levelCache?.size, "the revisits came from the cache").toBeGreaterThan(0);
  });

  it("covers entering and leaving the single-combat arena, flagged", () => {
    const game = startGame(pack, { seed: 777, depth: 2 });
    const { heard } = listen(game);
    const state = game.state;
    state.healthWho = state.monsters.find((m) => m !== null)!;
    state.arenaLevel = true;
    state.oldGrid = state.actor.grid;
    game.changeLevel(state.chunk.depth);
    expect(heard).toEqual([{ depth: 2, levelId: 1, cause: "change", arena: true }]);

    state.arenaLevel = false;
    game.changeLevel(state.chunk.depth);
    expect(heard.at(-1)).toEqual({ depth: 2, levelId: 2, cause: "change", arena: false });
    expect(heard).toHaveLength(2);
  });
});

describe("staying on a level sends nothing", () => {
  it("does not fire for a step, a world tick or a redrawn view", () => {
    const game = startGame(pack, { seed: 3, depth: 1 });
    const { heard } = listen(game);
    game.announceArrival();

    const walk = game.registry.get("walk")!;
    for (const dir of [6, 4, 2, 8]) walk(game.state, { code: "walk", dir });
    processWorld(game.state);
    game.state.updateFov?.(game.state);

    expect(heard).toHaveLength(1);
  });
});

describe("the capability gate", () => {
  it("refuses a subscription without event:dungeonlevel and delivers nothing to it", () => {
    const game = startGame(pack, { seed: 3, depth: 0 });
    const bus = new GameEvents();
    game.state.events = bus;
    const without = subscribeEvents(bus, caps("event:message"));
    const got: unknown[] = [];

    expect(() => without.on("dungeonlevel", (_t, data) => got.push(data))).toThrow(AgentCapabilityError);
    command(game, "descend");
    takeLevelChange(game);

    expect(got).toEqual([]);
  });
});

describe("a listener that throws", () => {
  it("is reported, and the arrival carries on", () => {
    const game = startGame(pack, { seed: 3, depth: 0 });
    const { order } = listen(game);
    const faults: Array<{ type: string; error: unknown }> = [];
    game.state.onEventFault = (type, error): void => {
      faults.push({ type, error });
    };
    game.state.events!.on("dungeonlevel", () => {
      throw new Error("mod fault");
    });
    command(game, "descend");

    expect(() => takeLevelChange(game)).not.toThrow();
    expect(game.state.chunk.depth).toBe(1);
    expect(game.state.chunk.onlyPartial).toBe(false);
    /* The feeling still follows the event. */
    const arrival = order.indexOf("level 1");
    expect(order.slice(arrival + 1).some((line) => line.startsWith("msg "))).toBe(true);
    expect(faults).toHaveLength(1);
    expect(faults[0]!.type).toBe("dungeonlevel");
    expect((faults[0]!.error as Error).message).toBe("mod fault");

    /* The first-level announcement goes through the same guard. */
    const fresh = startGame(pack, { seed: 3, depth: 0 });
    fresh.state.events = new GameEvents();
    fresh.state.events.on("dungeonlevel", () => {
      throw new Error("mod fault");
    });
    expect(() => fresh.announceArrival()).not.toThrow();
  });

  it("does not stop a Borg reincarnation that changes level", () => {
    const game = startGame(pack, { seed: 3, depth: 0 });
    game.state.events = new GameEvents();
    let faults = 0;
    game.state.onEventFault = (): void => {
      faults++;
    };
    game.state.events.on("dungeonlevel", () => {
      throw new Error("mod fault");
    });
    command(game, "descend");
    takeLevelChange(game);

    expect(() => game.reincarnate()).not.toThrow();
    expect(game.state.chunk.depth).toBe(0);
    expect(faults).toBe(2);
  });
});
