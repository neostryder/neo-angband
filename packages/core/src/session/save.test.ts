import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT } from "../generated";
import { runGameLoop, LOOP_STATUS } from "../game/loop";
import { monsterGroupsVerify } from "../game/mon-group";
import type { PlayerCommand } from "../game/context";
import { loadGame, saveGame, startGame } from "./game";
import type { GamePack, StartedGame } from "./game";
import { decodeSavedGame, encodeSavedGame } from "./save";

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

/** Play a few real turns so the save captures a mid-game state. */
function playTurns(game: StartedGame, count: number): void {
  const dirs = [6, 2, 4, 8, 6, 6, 2, 4];
  const commands: PlayerCommand[] = [];
  for (let i = 0; i < count; i++) {
    /* Alternate steps and holds; a hold always spends the turn even when
     * every walk direction is walled off. */
    commands.push({ code: "walk", dir: dirs[i % dirs.length]! });
    commands.push({ code: "hold" });
  }
  game.state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;
  runGameLoop(game.state, game.registry);
}

describe("saveGame / loadGame round trip (decision 9)", () => {
  it("restores the player, world and entities exactly", () => {
    const game = startGame(pack, { seed: 555, depth: 5, className: "Mage" });
    playTurns(game, 6);
    const state = game.state;

    /* Serialize through real JSON to prove the format is JSON-safe. */
    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    const restored = loadGame(pack, saved);
    const rs = restored.state;

    /* Player. */
    expect(rs.actor.player.cls.name).toBe("Mage");
    expect(rs.actor.player.chp).toBe(state.actor.player.chp);
    expect(rs.actor.player.msp).toBe(state.actor.player.msp);
    expect(rs.actor.player.au).toBe(state.actor.player.au);
    expect(rs.actor.player.spellFlags).toEqual(state.actor.player.spellFlags);
    expect(rs.actor.player.equipment).toEqual(state.actor.player.equipment);
    expect(rs.actor.grid).toEqual(state.actor.grid);
    expect(rs.actor.player.upkeep.newSpells).toBe(
      state.actor.player.upkeep.newSpells,
    );

    /* Derived combat state recomputed from the restored gear. */
    expect(rs.actor.combat.ac).toBe(state.actor.combat.ac);
    expect(rs.actor.weapon?.kind.name).toBe(state.actor.weapon?.kind.name);

    /* The world: every square identical, same depth and turn. */
    expect(rs.chunk.snapshotSquares()).toEqual(state.chunk.snapshotSquares());
    expect(rs.turn).toBe(state.turn);

    /* Entities. */
    expect(rs.monsters.length).toBe(state.monsters.length);
    for (let i = 1; i < state.monsters.length; i++) {
      const a = state.monsters[i];
      const b = rs.monsters[i];
      expect(b === null).toBe(a === null);
      if (a && b) {
        expect(b.race.ridx).toBe(a.race.ridx);
        expect(b.hp).toBe(a.hp);
        expect(b.grid).toEqual(a.grid);
        expect(Array.from(b.mTimed)).toEqual(Array.from(a.mTimed));
        expect(b.groupInfo).toEqual(a.groupInfo);
      }
    }
    monsterGroupsVerify(rs);
    expect(rs.groups.filter(Boolean).length).toBe(
      state.groups.filter(Boolean).length,
    );

    /* Floor piles and traps. */
    expect(rs.floor.size).toBe(state.floor.size);
    let stateTraps = 0;
    let restoredTraps = 0;
    for (const l of state.traps.values()) stateTraps += l.length;
    for (const l of rs.traps.values()) restoredTraps += l.length;
    expect(restoredTraps).toBe(stateTraps);

    /* Gear. */
    expect(rs.gear.pack).toEqual(state.gear.pack);
    expect(rs.gear.next).toBe(state.gear.next);
  });

  it("resumes the exact RNG stream (the anti-save-scum posture)", () => {
    const game = startGame(pack, { seed: 42, depth: 3 });
    playTurns(game, 4);
    const saved = JSON.parse(JSON.stringify(saveGame(game)));

    /* The original stream after the save point... */
    const expected = Array.from({ length: 20 }, () =>
      game.state.rng.randint0(1_000_000),
    );

    /* ...is exactly what a load resumes... */
    const restoredA = loadGame(pack, saved);
    const gotA = Array.from({ length: 20 }, () =>
      restoredA.state.rng.randint0(1_000_000),
    );
    expect(gotA).toEqual(expected);

    /* ...every time (reload-and-reroll yields nothing new). */
    const restoredB = loadGame(pack, saved);
    const gotB = Array.from({ length: 20 }, () =>
      restoredB.state.rng.randint0(1_000_000),
    );
    expect(gotB).toEqual(expected);
  });

  it("a restored game keeps playing through the loop", () => {
    const game = startGame(pack, { seed: 314, depth: 2 });
    playTurns(game, 3);
    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    const restored = loadGame(pack, saved);

    const before = restored.state.turn;
    playTurns(restored, 3);
    expect(restored.state.turn).toBeGreaterThan(before);
  });

  it("stamped bytes verify and detect tampering", () => {
    const game = startGame(pack, { seed: 7, depth: 1 });
    const bytes = encodeSavedGame(saveGame(game));

    const ok = decodeSavedGame(bytes);
    expect(ok.verified).toBe(true);
    expect(ok.save?.version).toBe(1);
    expect(ok.save?.player.clsName).toBe("Warrior");

    /* Flip one payload byte: the digest no longer matches. */
    const tampered = Uint8Array.from(bytes);
    tampered[100] = (tampered[100]! + 1) & 0xff;
    const bad = decodeSavedGame(tampered);
    expect(bad.verified).toBe(false);
  });
});

describe("changeLevel (dungeon_change_level)", () => {
  it("descending stairs regenerates a deeper level in place", () => {
    const game = startGame(pack, { seed: 999, depth: 1 });
    const { state, registry } = game;
    const oldChunk = state.chunk;

    /* Stand on a down staircase and take it. */
    state.chunk.setFeat(state.actor.grid, FEAT.MORE);
    const commands: PlayerCommand[] = [{ code: "descend" }];
    state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;
    const status = runGameLoop(state, registry);
    expect(status).toBe(LOOP_STATUS.LEVEL_CHANGE);
    expect(state.targetDepth).toBe(2);

    /* The session regenerates; the state object is reused. */
    game.changeLevel(state.targetDepth!);
    state.generateLevel = false;
    expect(state.chunk).not.toBe(oldChunk);
    expect(state.chunk.depth).toBe(2);
    expect(state.targetDepth).toBeUndefined();
    /* The player stands on the new level, marked on the map. */
    expect(state.chunk.mon(state.actor.grid)).toBe(-1);
    /* The level is populated and consistent. */
    expect(state.monsters.length).toBeGreaterThan(1);
    monsterGroupsVerify(state);

    /* And the game keeps running on the new level. */
    playTurns(game, 3);
    expect(state.isDead).toBe(false);
  });

  it("a save on a deeper level round-trips with the right depth", () => {
    const game = startGame(pack, { seed: 999, depth: 1 });
    game.changeLevel(4);
    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    const restored = loadGame(pack, saved);
    expect(restored.state.chunk.depth).toBe(4);
    expect(restored.booted.depth).toBe(4);
  });
});
