import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MFLAG } from "../generated";
import { loc, locEq } from "../loc";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { addMon, makeRace, makeState } from "./harness";
import type { GameState } from "./context";
import { arenaInterceptDeath } from "./context";
import { basicPlayerActor } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import { registerMeleeHandlers } from "./effect-melee";
import { targetSetMonster } from "./target";
import { startGame } from "../session/game";
import type { GamePack } from "../session/game";

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
});
