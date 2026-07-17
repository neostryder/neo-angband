import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MON_TMD } from "../generated";
import { loadGame, saveGame, startGame } from "./game";
import type { GamePack, StartedGame } from "./game";
import type { Monster } from "../mon/monster";
import type { GameState } from "../game/context";

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

/** The frozen field-set as plain comparables: terrain grid + monster set. */
function levelFingerprint(state: GameState): {
  feats: number[];
  mons: Array<{ ridx: number; x: number; y: number; hp: number }>;
} {
  const feats = Array.from(state.chunk.snapshotSquares().feats);
  const mons: Array<{ ridx: number; x: number; y: number; hp: number }> = [];
  for (let i = 1; i < state.monsters.length; i++) {
    const m = state.monsters[i];
    if (!m) continue;
    mons.push({ ridx: m.race.ridx, x: m.grid.x, y: m.grid.y, hp: m.hp });
  }
  mons.sort((a, b) => a.y - b.y || a.x - b.x || a.ridx - b.ridx);
  return { feats, mons };
}

function firstMonster(state: GameState): Monster {
  for (let i = 1; i < state.monsters.length; i++) {
    const m = state.monsters[i];
    if (m) return m;
  }
  throw new Error("test setup: generated level has no monsters");
}

describe("birth_levels_persist (A1 persistent levels)", () => {
  it("restores an identical frozen level on re-entry (option ON)", () => {
    const game = startGame(pack, {
      seed: 4242,
      depth: 3,
      optionOverrides: { birth_levels_persist: true },
    });
    const state = game.state;
    expect(state.options?.get("birth_levels_persist")).toBe(true);

    const before = levelFingerprint(state);
    expect(before.mons.length).toBeGreaterThan(0);

    /* Descend, then climb back to depth 3. */
    game.changeLevel(4);
    expect(state.chunk.depth).toBe(4);
    /* Leaving 3 froze it into the cache; entering 4 leaves only 4 uncached. */
    expect(state.levelCache?.has(3)).toBe(true);

    game.changeLevel(3);
    expect(state.chunk.depth).toBe(3);

    const after = levelFingerprint(state);
    /* Identical terrain and monster set: the cached level was restored, not
     * regenerated. */
    expect(after.feats).toEqual(before.feats);
    expect(after.mons).toEqual(before.mons);
    /* chunk_list_remove: the restored level is no longer cached (4 is now). */
    expect(state.levelCache?.has(3)).toBe(false);
    expect(state.levelCache?.has(4)).toBe(true);
  });

  it("regenerates a fresh level on re-entry when the option is OFF", () => {
    const game = startGame(pack, { seed: 4242, depth: 3 });
    const state = game.state;
    expect(state.options?.get("birth_levels_persist")).toBe(false);

    const before = levelFingerprint(state);

    game.changeLevel(4);
    /* No caching happens with the option off. */
    expect(state.levelCache?.size ?? 0).toBe(0);

    game.changeLevel(3);
    const after = levelFingerprint(state);

    /* A new level of the same depth was generated (RNG has advanced), so the
     * layout is not the frozen one, and nothing was cached. */
    expect(after.feats).not.toEqual(before.feats);
    expect(state.levelCache?.size ?? 0).toBe(0);
  });

  it("lets frozen monsters recover over elapsed turns (restore_monsters)", () => {
    const game = startGame(pack, {
      seed: 909,
      depth: 3,
      optionOverrides: { birth_levels_persist: true },
    });
    const state = game.state;

    /* Wound a monster and put it to sleep on the level we are about to leave. */
    const mon = firstMonster(state);
    mon.maxhp = 100;
    mon.hp = 1;
    mon.mTimed[MON_TMD.SLEEP] = 500;

    /* Descend (freezes depth 3 at the current turn), let a lot of game time
     * pass, then return. */
    game.changeLevel(4);
    state.turn += 100000;
    game.changeLevel(3);

    /* Same monster object (the cache held the reference): it regenerated HP
     * and its sleep timer was reduced toward zero. */
    expect(mon.hp).toBeGreaterThan(1);
    expect(mon.mTimed[MON_TMD.SLEEP]!).toBeLessThan(500);
  });

  it("survives a save round-trip with a non-empty level cache", () => {
    const game = startGame(pack, {
      seed: 1234,
      depth: 3,
      optionOverrides: { birth_levels_persist: true },
    });
    const state = game.state;

    /* Freeze depth 3 by descending to 4. */
    game.changeLevel(4);
    expect(state.levelCache?.has(3)).toBe(true);
    const frozen = state.levelCache!.get(3)!;
    const frozenFeats = Array.from(frozen.chunk.snapshotSquares().feats);
    const frozenMons = frozen.monsters.filter((m) => m).length;
    const frozenTurn = frozen.turn;

    /* Serialize through real JSON to prove the cache is JSON-safe. */
    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    expect(Array.isArray(saved.levelCache)).toBe(true);
    const restored = loadGame(pack, saved);
    const rs = restored.state;

    const cached = rs.levelCache?.get(3);
    expect(cached).toBeDefined();
    expect(cached!.turn).toBe(frozenTurn);
    expect(Array.from(cached!.chunk.snapshotSquares().feats)).toEqual(
      frozenFeats,
    );
    expect(cached!.monsters.filter((m) => m).length).toBe(frozenMons);
  });

  it("round-trips a level's stair connectors (chunk->join) through save/load", () => {
    const game = startGame(pack, {
      seed: 77,
      depth: 3,
      optionOverrides: { birth_levels_persist: true },
    });
    const state = game.state;

    /* Take the fresh-generation path (bootLevel does not set currentJoins), so
     * a dungeon level with real stairs populates state.currentJoins. */
    game.changeLevel(5);
    expect(state.currentJoins).toBeDefined();
    expect(state.currentJoins!.length).toBeGreaterThan(0);
    const joins = state.currentJoins!.map((j) => ({
      x: j.grid.x,
      y: j.grid.y,
      feat: j.feat,
    }));

    /* Descend again: depth 5 is frozen with its join list. */
    game.changeLevel(6);
    const frozen5 = state.levelCache!.get(5)!;
    expect(
      frozen5.join.map((j) => ({ x: j.grid.x, y: j.grid.y, feat: j.feat })),
    ).toEqual(joins);

    /* Save + load through real JSON; the frozen join survives. */
    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    const restored = loadGame(pack, saved);
    const cached5 = restored.state.levelCache!.get(5)!;
    expect(
      cached5.join.map((j) => ({ x: j.grid.x, y: j.grid.y, feat: j.feat })),
    ).toEqual(joins);
    /* The in-play level (depth 6) round-trips its currentJoins too. */
    expect(restored.state.currentJoins).toBeDefined();
    expect(
      restored.state.currentJoins!.map((j) => ({
        x: j.grid.x,
        y: j.grid.y,
        feat: j.feat,
      })),
    ).toEqual(
      state.currentJoins!.map((j) => ({
        x: j.grid.x,
        y: j.grid.y,
        feat: j.feat,
      })),
    );
  });

  it("does not touch join state or the savefile when the option is OFF", () => {
    const game = startGame(pack, { seed: 77, depth: 3 });
    const state = game.state;
    expect(state.options?.get("birth_levels_persist")).toBe(false);

    /* A fresh dungeon level with the option off must not capture currentJoins,
     * so the savefile stays byte-identical to today (no join keys). */
    game.changeLevel(5);
    expect(state.currentJoins).toBeUndefined();

    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    expect(saved.currentJoins).toBeUndefined();
    expect(saved.levelCache).toBeUndefined();

    /* A clean load leaves currentJoins unset. */
    const restored = loadGame(pack, saved);
    expect(restored.state.currentJoins).toBeUndefined();
  });
});
