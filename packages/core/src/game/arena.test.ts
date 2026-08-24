import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MFLAG, SQUARE, TF } from "../generated/index.js";
import { loc, locEq } from "../loc.js";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter.js";
import type { EffectContext } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { addMon, makeRace, makeState } from "./harness.js";
import type { GameState } from "./context.js";
import { arenaInterceptDeath } from "./context.js";
import { basicPlayerActor } from "./project-cast.js";
import { attachGameEnv } from "./effect-game-env.js";
import { registerMeleeHandlers } from "./effect-melee.js";
import { targetSetMonster } from "./target.js";
import { loadGame, saveGame, startGame } from "../session/game.js";
import type { GamePack } from "../session/game.js";

const projections = bindProjections(
  (
    JSON.parse(
      readFileSync(
        new URL("../../../content/pack/projection.json", import.meta.url),
        "utf8",
      ),
    ) as { records: ProjectionRecordJson[] }
  ).records,
);

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerMeleeHandlers(r);
  return r;
}

function env(state: GameState, msgs?: string[]): EffectContext {
  return attachGameEnv(
    {
      rng: state.rng,
      ...(msgs ? { messages: { msg: (t: string) => msgs.push(t) } } : {}),
    },
    {
      state,
      cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) },
    },
  );
}

describe("EF_SINGLE_COMBAT (effect-handler-attack.c L1856)", () => {
  it("drags the targeted monster toward an arena", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.actor.player.lev = 50;
    const race = makeRace({ level: 1 });
    race.spellPower = 0; /* cannot resist */
    const mon = addMon(state, race, loc(14, 10), { hp: 60 });
    mon.mflag.on(MFLAG.VISIBLE);
    targetSetMonster(state, mon);

    const used = registry().effectSimple(EF.SINGLE_COMBAT, env(state), {
      origin: sourcePlayer(),
    });
    expect(used).toBe(true);
    expect(state.arenaLevel).toBe(true);
    expect(state.healthWho).toBe(mon);
    expect(state.generateLevel).toBe(true);
    expect(locEq(state.oldGrid!, loc(10, 10))).toBe(true);
  });

  it("refuses without a target and when already in single combat", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    expect(
      registry().effectSimple(EF.SINGLE_COMBAT, env(state, msgs), {
        origin: sourcePlayer(),
      }),
    ).toBe(false);
    expect(msgs).toContain("No monster selected!");

    state.arenaLevel = true;
    registry().effectSimple(EF.SINGLE_COMBAT, env(state, msgs), {
      origin: sourcePlayer(),
    });
    expect(msgs).toContain("You are already in single combat!");
  });
});

describe("the arena kill gate (mon-util.c L1290)", () => {
  it("a lethal blow in the arena signals the exit instead of killing", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(14, 10), { hp: 50 });
    state.arenaLevel = true;
    expect(arenaInterceptDeath(state, mon)).toBe(true);
    expect(state.generateLevel).toBe(true);
    expect(state.healthWho).toBe(mon);
    /* Outside an arena the gate passes the kill through. */
    const other = makeState({ playerGrid: loc(5, 5) });
    const m2 = addMon(other, makeRace(), loc(6, 5), { hp: 10 });
    expect(arenaInterceptDeath(other, m2)).toBe(false);
  });
});

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
} as GamePack;

describe("the arena round trip (generate.c / game-world.c)", () => {
  it("enters a 6x6 arena with the opponent and returns victorious", () => {
    const game = startGame(pack, { seed: 777, depth: 2 });
    const state = game.state;
    const homeChunk = state.chunk;
    const homeGrid = state.actor.grid;

    /* Pick any live monster as the opponent (as EF_SINGLE_COMBAT would). */
    const mon = state.monsters.find((m) => m !== null)!;
    const midx = mon.midx;
    const raceName = mon.race.name;
    state.healthWho = mon;
    state.arenaLevel = true;
    state.oldGrid = homeGrid;
    state.generateLevel = true;

    /* Enter the arena. */
    game.changeLevel(state.chunk.depth);
    state.generateLevel = false;
    expect(state.chunk).not.toBe(homeChunk);
    expect(state.chunk.width).toBe(6);
    expect(state.chunk.height).toBe(6);
    expect(locEq(state.actor.grid, loc(1, 4))).toBe(true);
    const copy = state.monsters[1]!;
    expect(copy.race.name).toBe(raceName);
    expect(locEq(copy.grid, loc(4, 1))).toBe(true);
    expect(state.monsters.filter(Boolean).length).toBe(1);

    /*
     * cave_generate's arena branch runs wiz_light(chunk, p, false)
     * unconditionally (generate.c:1109) - every arena level is perma-lit. It
     * runs while `chunk` is not yet `cave`, so square_memorize / square_know_pile
     * short-circuit on `c != cave` and the pass sets SQUARE_GLOW only: nothing
     * about the arena is remembered.
     */
    for (let y = 1; y < state.chunk.height - 1; y++) {
      for (let x = 1; x < state.chunk.width - 1; x++) {
        if (state.chunk.feature(loc(x, y)).flags.has(TF.ROCK)) continue;
        expect(state.chunk.sqinfoHas(loc(x, y), SQUARE.GLOW)).toBe(true);
        expect(state.chunk.sqinfoHas(loc(x, y), SQUARE.MARK)).toBe(false);
      }
    }
    /*
     * ...but the level-entry FOV that follows DOES remember it, and this line used
     * to assert `every(f => f === -1)` - nothing remembered at all. That was true of
     * the code and wrong about the game: core had no default updateFov, so the
     * refresh at the end of changeLevel's arena branch was a no-op and the arena
     * stayed unknown. Upstream sets PU_UPDATE_VIEW in wiz_light and services it
     * once `cave` IS the arena, so a player who walks into an arena sees the room
     * and the opponent. What the wiz_light pass must not do is memorize; what the
     * entry FOV must do is.
     */
    expect(state.known.feat.some((f) => f !== -1)).toBe(true);
    const at = state.actor.grid.y * state.chunk.width + state.actor.grid.x;
    expect(state.known.feat[at]).not.toBe(-1);

    /* Strike the killing blow: the gate signals the exit. */
    expect(arenaInterceptDeath(state, copy)).toBe(true);
    expect(state.generateLevel).toBe(true);

    /* Exit: the old level is restored, the original opponent dead. */
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    game.changeLevel(state.chunk.depth);
    expect(state.arenaLevel).toBe(false);
    expect(state.chunk).toBe(homeChunk);
    expect(locEq(state.actor.grid, homeGrid)).toBe(true);
    expect(state.monsters[midx]).toBeNull(); /* defeated and removed */
    expect(msgs.some((m) => m.endsWith("is defeated!"))).toBe(true);
  });
  it("notifies the level-revisit seam when single combat restores its stashed level", () => {
    const game = startGame(pack, { seed: 119, depth: 2 });
    const state = game.state;
    const flowIndex = 2 * state.chunk.width + 2;
    state.chunk.noise[flowIndex] = 37;
    state.chunk.scent[flowIndex] = 9;
    state.turn = 19;
    const observed: Array<{ chunk: unknown; frozenAt: number; now: number }> = [];
    state.modHooks = {
      levelRevisited: (chunk, frozenAt, now) => {
        observed.push({ chunk, frozenAt, now });
        const i = 2 * chunk.width + 2;
        chunk.noise[i] = 0;
        chunk.scent[i] = 13;
      },
    };

    const home = state.chunk;
    const mon = state.monsters.find((m) => m !== null)!;
    state.healthWho = mon;
    state.arenaLevel = true;
    state.oldGrid = state.actor.grid;
    game.changeLevel(state.chunk.depth);
    state.turn = 50;

    const copy = state.monsters.find((m) => m !== null)!;
    expect(arenaInterceptDeath(state, copy)).toBe(true);
    game.changeLevel(state.chunk.depth);

    expect(observed).toEqual([{ chunk: home, frozenAt: 19, now: 50 }]);
    expect(state.chunk.noise[flowIndex]).toBe(0);
    expect(state.chunk.scent[flowIndex]).toBe(13);
  });
  it("survives a save taken mid-fight, and exits onto the SAME level", () => {
    /* Upstream stores the pre-arena level in the chunk_list and the savefile
     * carries it (generate.c:1349 takes the persistent path for an arena too),
     * so a reload resumes the fight and still knows where to put the player
     * back. The port kept that level in a closure variable, so a save taken
     * mid-fight lost it and winning dumped the player on a FRESH level of the
     * same depth. */
    const game = startGame(pack, { seed: 4711, depth: 2 });
    const state = game.state;
    const homeFeats = Array.from(state.chunk.snapshotSquares().feats);
    const homeGrid = state.actor.grid;

    const mon = state.monsters.find((m) => m !== null)!;
    const midx = mon.midx;
    state.healthWho = mon;
    state.arenaLevel = true;
    state.oldGrid = homeGrid;
    state.generateLevel = true;
    game.changeLevel(state.chunk.depth);
    state.generateLevel = false;
    expect(state.chunk.width).toBe(6);
    expect(state.arenaStash).toBeDefined();

    /* Save and reload from inside the arena, through real JSON. */
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as ReturnType<
      typeof saveGame
    >;
    expect(saved.arena?.stash).toBeDefined();
    const reloaded = loadGame(pack, saved);
    const rs = reloaded.state;
    expect(rs.arenaLevel).toBe(true);
    expect(rs.chunk.width).toBe(6);
    expect(rs.arenaStash).toBeDefined();

    /* Win, and land back on the level the fight started from - the terrain is
     * the same grid, not a regenerated one of the same depth. */
    const copy = rs.monsters.find((m) => m !== null)!;
    expect(arenaInterceptDeath(rs, copy)).toBe(true);
    reloaded.changeLevel(rs.chunk.depth);

    expect(rs.arenaLevel).toBe(false);
    expect(Array.from(rs.chunk.snapshotSquares().feats)).toEqual(homeFeats);
    expect(locEq(rs.actor.grid, homeGrid)).toBe(true);
    /* kill_arena_monster still finishes the original on the restored level. */
    expect(rs.monsters[midx]).toBeNull();
  });
});
