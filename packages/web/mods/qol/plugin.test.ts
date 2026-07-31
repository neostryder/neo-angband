/**
 * The `qol` mod's own tests, next to the mod's own code.
 *
 * They exercise the mod exactly as the game does: import its default entry
 * point, hand it resolved flags, install the result as GameState.modHooks, and
 * play a real turn through a real startGame. Nothing here reaches into core's
 * internals - it imports @rpgm-tools/neo-angband-core's published API, like any third-party
 * mod's tests would.
 *
 * The complementary half is in core: packages/core/src/game/auto-dig.test.ts
 * pins what the walkBlockedByDiggable SEAM promises (an absent hook bumps and
 * draws nothing; the returned energy is spent; null falls back). This file pins
 * what the MOD does with that promise.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DDGRID,
  FEAT,
  loc,
  squareMemorize,
  squareMonster,
  startGame,
  walkAction,
} from "@rpgm-tools/neo-angband-core";
import type { GamePack, GameState, Loc } from "@rpgm-tools/neo-angband-core";
import * as neoCore from "@rpgm-tools/neo-angband-core";
import plugin from "./plugin";

/**
 * The mod's behaviour, driven the way the HOST drives it.
 *
 * The entry point is a ModPlugin whose `hooks` takes a context and reads the engine
 * off `ctx.core` (mods/qol/plugin.ts). The host reduces that to a function of flags
 * (src/mod-hooks.ts pluginAdapter); this is the same reduction, with the REAL core
 * namespace passed in - so these tests exercise the shipped path rather than a
 * signature only they use.
 */
const qolHooks = (flags: Readonly<Record<string, boolean>>): ModHooks =>
  plugin.hooks({ flags, core: neoCore });

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
} as unknown as GamePack;

const ALL_ON = { "qol.autoDig": true };

/**
 * A real game with a diggable wall next to the player and a digger strong enough
 * that the roll always succeeds. Returns the direction to walk and the grid.
 *
 * The direction is SEARCHED rather than assumed: a real generated level can put a
 * monster next to the player, and walking into a monster is an attack, not a
 * blocked walk. Picking the first monster-free orthogonal neighbour keeps this
 * test about digging even if the generation stream shifts.
 */
function dugGame(feat: number = FEAT.RUBBLE, digging = 200): {
  state: GameState;
  dir: number;
  grid: Loc;
} {
  const { state } = startGame(pack, { seed: 20260729, depth: 2 });
  let chosen: { dir: number; grid: Loc } | null = null;
  for (const dir of [6, 4, 2, 8]) {
    const d = DDGRID[dir] as Loc;
    const grid = loc(state.actor.grid.x + d.x, state.actor.grid.y + d.y);
    if (!state.chunk.inBoundsFully(grid)) continue;
    if (squareMonster(state, grid)) continue;
    chosen = { dir, grid };
    break;
  }
  if (!chosen) throw new Error("no monster-free neighbour to dig into");
  state.chunk.setFeat(chosen.grid, feat);
  squareMemorize(state, chosen.grid); // square_isknown gate
  /* The DIGGING skill the roll actually uses. In a live session it comes from
   * player_best_digger (player-util.c L744) through this seam, which temporarily
   * wields the pack's best digger - so setting combat.skills directly would be
   * ignored, exactly as it is in the real game. */
  state.bestDiggerDigging = (): number => digging;
  return { state, dir: chosen.dir, grid: chosen.grid };
}

describe("the qol mod's entry point", () => {
  it("contributes nothing when the mod is enabled but every patch is off", () => {
    /* The host still calls an enabled mod, so "{}" is the honest answer, and
     * composeModHooks turns a set of empty contributions back into `undefined` -
     * leaving GameState.modHooks absent. */
    expect(qolHooks({})).toEqual({});
    expect(qolHooks({ "qol.autoDig": false })).toEqual({});
  });

  it("installs walkBlockedByDiggable, and ONLY that, for qol.autoDig", () => {
    const hooks = qolHooks(ALL_ON);
    expect(Object.keys(hooks)).toEqual(["walkBlockedByDiggable"]);
  });

  it("ignores flags that are not its own", () => {
    /* The host slices the flag map per mod, but a mod must not act on a foreign
     * flag even if one arrives. */
    expect(qolHooks({ "bugfix.stairsReachable": true })).toEqual({});
  });
});

describe("qol.autoDig: walking into diggable terrain", () => {
  it("digs once, spends a move, and does not step onto the grid", () => {
    const { state, dir, grid } = dugGame();
    state.modHooks = qolHooks(ALL_ON);
    const before = loc(state.actor.grid.x, state.actor.grid.y);

    const spent = walkAction(state, { code: "walk", dir });

    expect(spent).toBe(state.z.moveEnergy);
    expect(state.actor.grid).toEqual(before); // source fork: dig, don't step
    expect(state.chunk.isRubble(grid)).toBe(false); // dug out (skill 200)
  });

  it("declines an unknown grid, drawing no RNG - the faithful bump", () => {
    const { state, grid } = dugGame();
    state.known.feat[grid.y * state.chunk.width + grid.x] = -1; // un-memorize it (-1 = unknown)
    const hook = qolHooks(ALL_ON).walkBlockedByDiggable!;
    const rngBefore = JSON.stringify(state.rng.getState());

    expect(hook(state, grid, { env: {} })).toBeNull();

    /* Declining has to be free of observable effect: faithful core bumps the wall
     * without drawing, so a decline that rolled first would desynchronise the
     * stream and a seed would stop meaning the same game. */
    expect(JSON.stringify(state.rng.getState())).toBe(rngBefore);
    expect(state.chunk.isRubble(grid)).toBe(true);
  });

  it("declines permanent rock, drawing no RNG", () => {
    const { state, grid } = dugGame(FEAT.PERM);
    const hook = qolHooks(ALL_ON).walkBlockedByDiggable!;
    const rngBefore = JSON.stringify(state.rng.getState());
    expect(hook(state, grid, { env: {} })).toBeNull();
    expect(JSON.stringify(state.rng.getState())).toBe(rngBefore);
  });

  it("declines terrain no digger could get through at this skill", () => {
    const { state, grid } = dugGame(FEAT.GRANITE, 20); // granite chance = (20-40) -> 0
    const hook = qolHooks(ALL_ON).walkBlockedByDiggable!;
    expect(hook(state, grid, { env: {} })).toBeNull();
  });

  it("spends the move even when the attempt FAILS (one attempt per walk)", () => {
    /* A weak digger with a positive chance: movementTunnelTest passes, so the mod
     * commits to the walk, tunnelAux rolls and (at this skill, on granite)
     * essentially always fails. The turn is still spent - that is the source
     * fork's behaviour, and it is what makes repeated walks dig through a vein. */
    const { state, dir, grid } = dugGame(FEAT.GRANITE, 45); // chance = (45-40) > 0
    state.modHooks = qolHooks(ALL_ON);
    const spent = walkAction(state, { code: "walk", dir });
    expect(spent).toBe(state.z.moveEnergy);
    expect(state.chunk.feat(grid)).toBe(FEAT.GRANITE); // still there
  });
});
