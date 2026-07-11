import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, TV } from "../generated";
import { runGameLoop, LOOP_STATUS } from "../game/loop";
import { monsterGroupsVerify } from "../game/mon-group";
import type { PlayerCommand } from "../game/context";
import { objectNew } from "../obj/object";
import type { ObjectKind } from "../obj/types";
import { describeObject } from "../game/describe";
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
  names: loadRecords("names"),
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

    /* Flavours survive the reload: the persisted seed_flavor re-derives the
     * same unaware potion name (a reload must not re-colour the dungeon). */
    expect(saved.seedFlavor).toBe(game.seedFlavor);
    const potionKind = game.booted.registries.objects.kinds.find(
      (k) => k.tval === TV.POTION,
    ) as ObjectKind;
    const makePotion = () => {
      const o = objectNew(potionKind);
      o.tval = potionKind.tval;
      o.sval = potionKind.sval;
      o.number = 1;
      return o;
    };
    const nameBefore = describeObject(state, makePotion());
    const nameAfter = describeObject(rs, makePotion());
    expect(nameAfter).toBe(nameBefore);
    /* Unaware: a flavoured word, not the real kind. */
    expect(nameBefore).not.toContain(`of ${potionKind.name}`);
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

describe("option store persistence (option.c)", () => {
  it("startGame seeds the option store from the table defaults", () => {
    const game = startGame(pack, { seed: 42, depth: 2 });
    expect(game.state.options).toBeDefined();
    /* Shipped defaults. */
    expect(game.state.options!.get("pickup_inven")).toBe(true);
    expect(game.state.options!.get("effective_speed")).toBe(false);
    expect(game.state.options!.hitpointWarn).toBe(3);
    expect(game.randartSeed).toBe(0);
  });

  it("round-trips option values, hitpoint_warn and the birth snapshot", () => {
    const game = startGame(pack, {
      seed: 7,
      depth: 2,
      hitpointWarn: 6,
      optionOverrides: {
        effective_speed: true,
        cheat_hear: true,
        birth_feelings: false,
      },
    });
    /* cheat_hear forced score_hear on (the coupling). */
    expect(game.state.options!.get("score_hear")).toBe(true);

    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    expect(saved.options).toBeDefined();
    const restored = loadGame(pack, saved);
    const ro = restored.state.options!;

    expect(ro.get("effective_speed")).toBe(true);
    expect(ro.get("cheat_hear")).toBe(true);
    expect(ro.get("score_hear")).toBe(true);
    expect(ro.get("birth_feelings")).toBe(false);
    expect(ro.hitpointWarn).toBe(6);
    /* The birth snapshot survives and stays locked. */
    expect(ro.birthValue("birth_feelings")).toBe(false);
    expect(ro.set("birth_feelings", true)).toBe(false);
  });

  it("older saves without an option store load with the table defaults", () => {
    const game = startGame(pack, { seed: 3, depth: 2 });
    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    /* Simulate a pre-option save: strip the field. */
    delete saved.options;
    const restored = loadGame(pack, saved);
    expect(restored.state.options!.get("pickup_inven")).toBe(true);
    expect(restored.state.options!.hitpointWarn).toBe(3);
  });
});

describe("birth_randarts (obj-randart.c do_randart)", () => {
  it("swaps the artifact set and persists the seed reproducibly", () => {
    const standard = startGame(pack, { seed: 88, depth: 2 });
    const randart = startGame(pack, {
      seed: 88,
      depth: 2,
      optionOverrides: { birth_randarts: true },
    });

    /* A randart seed was drawn and the set differs from the standard one. */
    expect(randart.randartSeed).not.toBe(0);
    const stdArts = standard.booted.registries.objects.artifacts;
    const rndArts = randart.booted.registries.objects.artifacts;
    expect(rndArts.length).toBe(stdArts.length);
    let differing = 0;
    for (let i = 1; i < stdArts.length; i++) {
      const a = stdArts[i];
      const b = rndArts[i];
      if (a && b && (a.toH !== b.toH || a.toD !== b.toD || a.toA !== b.toA)) {
        differing++;
      }
    }
    expect(differing).toBeGreaterThan(0);

    /* A reload rebuilds the identical randart set from the persisted seed. */
    const saved = JSON.parse(JSON.stringify(saveGame(randart)));
    expect(saved.randartSeed).toBe(randart.randartSeed);
    const restored = loadGame(pack, saved);
    expect(restored.randartSeed).toBe(randart.randartSeed);
    const reArts = restored.booted.registries.objects.artifacts;
    for (let i = 1; i < rndArts.length; i++) {
      expect(reArts[i]?.toH).toBe(rndArts[i]?.toH);
      expect(reArts[i]?.toD).toBe(rndArts[i]?.toD);
      expect(reArts[i]?.name).toBe(rndArts[i]?.name);
    }
  });
});
