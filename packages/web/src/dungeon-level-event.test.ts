/**
 * The `dungeonlevel` event as a mod receives it through `ctx.events`, on a real
 * game, and the shell's wiring for the session's first level.
 *
 * The first level's announcement has to wait for the folder plugins' register()
 * loop, or a mod that subscribes there misses the level it starts on. The gate
 * that waits is driven here against a live game; main.ts, which nothing imports,
 * is pinned by source for where it signals the gate.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  GameEvents,
  startGame,
  type DungeonLevelEventData,
  type GamePack,
  type StartedGame,
} from "@rpgm-tools/neo-angband-core";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { firstLevelGate, reportEventFault, type FirstLevelGate } from "./first-level";
import { log } from "./logging";
import { modPluginContext } from "./mod-context";

function loadJson<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8")) as T;
}
function records<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: records("terrain"),
  roomTemplates: records("room_template"),
  vaults: records("vault"),
  dungeonProfiles: records("dungeon_profile"),
  obj: {
    objectBase: loadJson("object_base"), object: loadJson("object"),
    egoItem: loadJson("ego_item"), artifact: loadJson("artifact"),
    curse: loadJson("curse"), brand: loadJson("brand"),
    slay: loadJson("slay"), activation: loadJson("activation"),
    objectProperty: loadJson("object_property"), flavor: loadJson("flavor"),
  } as GamePack["obj"],
  mon: {
    pain: records("pain"), blowMethods: records("blow_methods"),
    blowEffects: records("blow_effects"), monsterSpells: records("monster_spell"),
    monsterBases: records("monster_base"), monsters: records("monster"),
    summons: records("summon"), pits: records("pit"),
  },
  player: {
    races: records("p_race"), classes: records("class"),
    properties: records("player_property"), timed: records("player_timed"),
    shapes: records("shape"), bodies: records("body"),
    history: records("history"), realms: records("realm"),
  },
};

function capabilities(id: string, granted: string[]): CapabilitySet {
  return CapabilitySet.fromManifest({
    id, name: id, version: "1.0.0", shape: "plugin", facets: ["plugin"], modApi: 1, capabilities: granted,
  });
}

function takeStairs(game: StartedGame, code: "descend" | "ascend"): void {
  game.registry.get(code)!(game.state, { code });
  expect(game.state.generateLevel).toBe(true);
  game.changeLevel(game.state.targetDepth!);
  game.state.generateLevel = false;
}

describe("a mod's dungeonlevel subscription", () => {
  it("hears one event per arrival with the depth, and a mod without the grant hears none", () => {
    const game = startGame(pack, { seed: 3, depth: 0 });
    game.state.events = new GameEvents();

    const tracker = modPluginContext("tracker", {}, game.state, {}, {
      capabilities: capabilities("tracker", ["event:dungeonlevel"]),
    });
    const depths: DungeonLevelEventData[] = [];
    tracker.events!.on("dungeonlevel", (_type, data) => depths.push(data));

    const plain = modPluginContext("plain", {}, game.state, {}, { capabilities: capabilities("plain", []) });
    expect(plain.events).toBeUndefined();

    const chatty = modPluginContext("chatty", {}, game.state, {}, {
      capabilities: capabilities("chatty", ["event:message"]),
    });
    const chattyHeard: string[] = [];
    expect(() => chatty.events!.on("dungeonlevel", () => chattyHeard.push("level"))).toThrow();

    game.announceArrival();
    takeStairs(game, "descend");
    takeStairs(game, "ascend");

    expect(depths.map(({ depth, cause }) => `${cause} ${depth}`)).toEqual(["new-game 0", "change 1", "change 0"]);
    expect(chattyHeard).toEqual([]);
  });
});

describe("a mod's dungeonlevel listener that throws", () => {
  it("is logged on the mods channel, and the arrival carries on", () => {
    const game = startGame(pack, { seed: 3, depth: 0 });
    game.state.events = new GameEvents();
    game.state.onEventFault = reportEventFault;
    const error = vi.spyOn(log, "error").mockImplementation(() => {});

    const broken = modPluginContext("broken", {}, game.state, {}, {
      capabilities: capabilities("broken", ["event:dungeonlevel"]),
    });
    broken.events!.on("dungeonlevel", () => {
      throw new Error("broken mod");
    });
    const messages: string[] = [];
    game.state.msg = (text: string): void => {
      messages.push(text);
    };

    try {
      takeStairs(game, "descend");
      expect(game.state.chunk.depth).toBe(1);
      expect(game.state.chunk.onlyPartial).toBe(false);
      /* The stair message, then the level feeling after the failed event. */
      expect(messages).toHaveLength(2);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]![0]).toBe("mods");
      expect(error.mock.calls[0]![1]).toBe("a dungeonlevel listener failed:");
      expect((error.mock.calls[0]![2] as Error).message).toBe("broken mod");
    } finally {
      error.mockRestore();
    }
  });
});

describe("the shell's first-level announcement", () => {
  function trackedGame(): { game: StartedGame; heard: DungeonLevelEventData[]; gate: FirstLevelGate } {
    const game = startGame(pack, { seed: 3, depth: 0 });
    game.state.events = new GameEvents();
    const heard: DungeonLevelEventData[] = [];
    const gate = firstLevelGate(() => game.announceArrival());
    return { game, heard, gate };
  }
  function subscribe(game: StartedGame, heard: DungeonLevelEventData[]): void {
    const tracker = modPluginContext("tracker", {}, game.state, {}, {
      capabilities: capabilities("tracker", ["event:dungeonlevel"]),
    });
    tracker.events!.on("dungeonlevel", (_type, data) => heard.push(data));
  }

  it("reaches a mod that subscribed in register() after the screen went live", async () => {
    const { game, heard, gate } = trackedGame();
    gate.screenLive();
    await Promise.resolve();
    expect(heard).toEqual([]);

    /* The folder plugins' register() loop runs, then signals. */
    subscribe(game, heard);
    gate.modsRegistered();
    expect(heard, "never inside the signalling call").toEqual([]);
    await Promise.resolve();

    expect(heard).toEqual([{ depth: 0, levelId: 0, cause: "new-game", arena: false }]);
  });

  it("waits for the screen when the mods registered first, and sends only once", async () => {
    const { game, heard, gate } = trackedGame();
    subscribe(game, heard);
    gate.modsRegistered();
    await Promise.resolve();
    expect(heard).toEqual([]);

    gate.screenLive();
    gate.screenLive();
    await Promise.resolve();
    await Promise.resolve();

    expect(heard.map((e) => e.cause)).toEqual(["new-game"]);
  });

  const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

  it("is wired in main.ts to the game screen and to the end of the register() loop", () => {
    const gate = MAIN.indexOf("const firstLevel = firstLevelGate(() => game.announceArrival());");
    const chain = MAIN.indexOf("void applyModResources()");
    const live = MAIN.indexOf("gameScreenLive = true;", chain);
    const announce = MAIN.indexOf("firstLevel.screenLive();", live);
    const registration = MAIN.indexOf("for (const loaded of activeModCode().plugins) {", MAIN.indexOf("/* The FOLDER plugins' register() half."));
    const marked = MAIN.indexOf("firstLevel.modsRegistered();", registration);

    expect(gate).toBeGreaterThan(-1);
    /* Declared before the boot chain whose callback reads it. */
    expect(chain).toBeGreaterThan(gate);
    expect(announce).toBeGreaterThan(live);
    expect(registration).toBeGreaterThan(chain);
    expect(marked).toBeGreaterThan(registration);
    expect(MAIN.match(/game\.announceArrival\(\)/g)).toHaveLength(1);
    expect(MAIN).toContain("state.onEventFault = reportEventFault;");
  });
});
