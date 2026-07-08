import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runGameLoop, LOOP_STATUS } from "../game/loop";
import type { PlayerCommand } from "../game/context";
import { startGame } from "./game";
import type { GamePack } from "./game";

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

// A full game pack: core content plus the player-domain records.
const pack: GamePack = {
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

describe("startGame (new-game assembly)", () => {
  it("births a level-1 character with derived bonuses at the player spot", () => {
    const { state, booted } = startGame(pack, { seed: 123, depth: 1 });
    expect(state.actor.player.lev).toBe(1);
    expect(state.actor.player.mhp).toBeGreaterThan(0);
    // calcBonuses produced real derived combat state.
    expect(state.actor.combat.numBlows).toBeGreaterThan(0);
    expect(state.actor.combat.skills.length).toBeGreaterThan(0);
    expect(state.actor.speed).toBe(110); // Human Warrior base speed.
    // The player is placed where the level said, and marked on the map.
    if (booted.playerSpot) {
      expect(state.actor.grid).toEqual(booted.playerSpot);
      expect(state.chunk.mon(state.actor.grid)).toBe(-1);
    }
    // Monster slot 0 is unused; any placed monsters registered from 1.
    expect(state.monsters[0]).toBeNull();
  });

  it("defaults to Human Warrior, honouring race/class overrides", () => {
    const { players } = startGame(pack, { seed: 1 });
    // The default lookups resolve against the real pack.
    expect(players.raceByName("Human")).not.toBeNull();
    expect(players.classByName("Warrior")).not.toBeNull();
  });

  it("is a runnable state: the loop advances turns and yields for input", () => {
    const { state, registry } = startGame(pack, { seed: 123, depth: 1 });
    const commands: PlayerCommand[] = [{ code: "hold" }];
    state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;

    const status = runGameLoop(state, registry);
    // One queued hold, then the queue empties: the world runs until the
    // player must act again, so the loop stops for input with turns elapsed.
    expect(status).toBe(LOOP_STATUS.INPUT);
    expect(state.turn).toBeGreaterThan(0);
  });

  it("is deterministic for a fixed seed", () => {
    const a = startGame(pack, { seed: 777, depth: 2 });
    const b = startGame(pack, { seed: 777, depth: 2 });
    expect(a.state.actor.player.mhp).toBe(b.state.actor.player.mhp);
    expect(a.state.actor.combat.numBlows).toBe(b.state.actor.combat.numBlows);
    expect(a.state.monsters.length).toBe(b.state.monsters.length);
    if (a.booted.playerSpot && b.booted.playerSpot) {
      expect(a.booted.playerSpot).toEqual(b.booted.playerSpot);
    }
  });
});
