/**
 * Paired worlds: two games built from the same seed, then made to differ only
 * in something the player cannot know. Each pair must build the same
 * KnownWorld. Each case also has a control that makes the difference knowable
 * and checks that the worlds then differ, so a case cannot pass by comparing
 * nothing.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, OF, RF, RSF, SQUARE, TV } from "../generated/index.js";
import { OBJ_MOD } from "../generated/object-modifiers.js";
import type { GameState } from "../game/context.js";
import { monsterSwap } from "../game/context.js";
import { floorCarry, floorExcise } from "../game/floor.js";
import { invenCarry } from "../game/gear.js";
import { squareKnowPile, squareMemorize } from "../game/known.js";
import { squareIsEmptyLive } from "../game/mon-place.js";
import { loc } from "../loc.js";
import { getLore } from "../mon/lore.js";
import type { Monster } from "../mon/monster.js";
import { monsterIsObvious } from "../mon/predicate.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import type { ObjectKind } from "../obj/types.js";
import { Rng } from "../rng.js";
import { startGame } from "../session/game.js";
import type { GamePack, StartedGame } from "../session/game.js";
import { buildKnownWorld, knownMonsters } from "./known-world.js";
import type { KnownWorld } from "./known-world.js";
import { createAgentView } from "./perceive.js";

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

const SEED = 4242;
const DEPTH = 10;

/** Two games that start out identical. */
function pair(): [StartedGame, StartedGame] {
  return [startGame(pack, { seed: SEED, depth: DEPTH }), startGame(pack, { seed: SEED, depth: DEPTH })];
}

/**
 * A world as text, without the tokens: each GameState has its own token epoch,
 * which names the game rather than describing it.
 */
function observed(state: GameState): string {
  const world: KnownWorld = buildKnownWorld(state);
  const { token: _token, level, ...rest } = world;
  const { token: _levelToken, ...levelRest } = level ?? { token: null };
  return JSON.stringify({ ...rest, level: levelRest });
}

function liveMonsters(state: GameState): Monster[] {
  return state.monsters.filter((m): m is Monster => m !== null && m !== undefined);
}

/** The same monster in the other game: the two started from one seed. */
function twin(state: GameState, mon: Monster): Monster {
  const other = state.monsters[mon.midx];
  if (!other || other.race.ridx !== mon.race.ridx) throw new Error("the paired games diverged");
  return other;
}

/** A floor grid that is empty, out of view, unremembered and not the player's. */
function hiddenEmptyGrid(state: GameState, not: { x: number; y: number }) {
  const { chunk } = state;
  for (let y = 1; y < chunk.height - 1; y++) {
    for (let x = 1; x < chunk.width - 1; x++) {
      const grid = loc(x, y);
      if (x === not.x && y === not.y) continue;
      if (x === state.actor.grid.x && y === state.actor.grid.y) continue;
      if (!squareIsEmptyLive(state, grid)) continue;
      if (chunk.sqinfoHas(grid, SQUARE.VIEW) || chunk.sqinfoHas(grid, SQUARE.SEEN)) continue;
      if ((state.floor.get(y * chunk.width + x) ?? []).length > 0) continue;
      return grid;
    }
  }
  throw new Error("no hidden empty grid");
}

function carry(game: StartedGame, kind: ObjectKind): GameObject {
  const reg = game.booted.registries;
  const obj = objectPrep(new Rng(1), reg.objects, reg.constants, kind, 1, "minimise");
  obj.notice |= OBJ_NOTICE.ASSESSED;
  obj.number = 1;
  invenCarry(game.state.gear, game.state.actor.player, obj, {
    quiverSlotSize: reg.constants.quiverSlotSize,
    thrownQuiverMult: reg.constants.thrownQuiverMult,
  });
  return obj;
}

function kindNamed(game: StartedGame, tval: number, name: string): ObjectKind {
  /* Kind names carry the article and plural marks: "& Dagger~". */
  const plain = (n: string) => n.replace(/^& /, "").replace(/~/g, "");
  const kind = game.booted.registries.objects.kinds.find((k) => k.tval === tval && plain(k.name) === name);
  if (!kind) throw new Error(`no kind ${name}`);
  return kind;
}

describe("KnownWorld paired worlds", () => {
  it("two games from one seed observe the same world", () => {
    const [a, b] = pair();
    expect(observed(b.state)).toBe(observed(a.state));
  });

  it("an unseen monster that moves, heals and speeds up changes nothing", () => {
    const [a, b] = pair();
    const hiddenA = liveMonsters(a.state).find((m) => !monsterIsObvious(m));
    if (!hiddenA) throw new Error("no unseen monster at this seed");
    const hiddenB = twin(b.state, hiddenA);
    const to = hiddenEmptyGrid(b.state, hiddenB.grid);
    monsterSwap(b.state, hiddenB.grid, to);
    hiddenB.hp = Math.max(1, hiddenB.hp - 1);
    hiddenB.mspeed += 10;
    expect(monsterIsObvious(hiddenB)).toBe(false);
    expect(observed(b.state)).toBe(observed(a.state));

    /* Control: once the player perceives it, the worlds differ. */
    hiddenB.mflag.on(MFLAG.VISIBLE);
    hiddenB.mflag.off(MFLAG.CAMOUFLAGE);
    expect(observed(b.state)).not.toBe(observed(a.state));
  });

  it("a seen monster's exact health, speed and unlearned abilities change nothing", () => {
    const [a, b] = pair();
    const seenA = liveMonsters(a.state).find((m) => m.maxhp >= 20 && !m.race.flags.has(RF.UNIQUE));
    if (!seenA) throw new Error("no suitable monster at this seed");
    const seenB = twin(b.state, seenA);
    for (const mon of [seenA, seenB]) {
      mon.mflag.on(MFLAG.VISIBLE);
      mon.mflag.off(MFLAG.CAMOUFLAGE);
    }
    /* Both "somewhat wounded": 70% against 90% of the same maximum. */
    seenA.hp = Math.trunc(seenA.maxhp * 0.7);
    seenB.hp = Math.trunc(seenB.maxhp * 0.9);
    seenB.mspeed += 10;
    /* B's race gains a resistance and a spell the player has never seen. */
    seenB.race.flags.on(RF.IM_FIRE);
    seenB.race.spellFlags.on(RSF.BLINK);
    expect(observed(b.state)).toBe(observed(a.state));

    const view = knownMonsters(b.state).find((m) => m.id === seenB.midx);
    expect(view).toMatchObject({ health: "somewhat", raceSpeed: seenB.race.speed });
    expect(view).not.toHaveProperty("hp");
    expect(view).not.toHaveProperty("speed");

    /* Control: once lore records the spell, it shows. */
    getLore(b.state.lore, seenB.race).spellFlags.on(RSF.BLINK);
    expect(observed(b.state)).not.toBe(observed(a.state));
    expect(knownMonsters(b.state).find((m) => m.id === seenB.midx)?.knownSpells).toContain("BLINK");
  });

  it("which unlearned rune, modifier value and curse a carried item has changes nothing", () => {
    const [a, b] = pair();
    const dagger = (g: StartedGame) => carry(g, kindNamed(g, TV.SWORD, "Dagger"));
    const objA = dagger(a);
    const objB = dagger(b);
    /* Both daggers carry unlearned runes, so both read as "{??}"; only which
     * runes, how strong and which curse differ, and the player knows none of it. */
    const curses = (g: StartedGame, idx: number, power: number) => {
      const list = g.state.runeEnv.curses.map(() => ({ power: 0, timeout: 0 }));
      list[idx] = { power, timeout: 0 };
      return list;
    };
    objA.flags.on(OF.FREE_ACT);
    objA.modifiers[OBJ_MOD.STEALTH] = 1;
    objA.curses = curses(a, 1, 20);
    objB.flags.on(OF.SEE_INVIS);
    objB.modifiers[OBJ_MOD.STEALTH] = 2;
    objB.curses = curses(b, 2, 40);
    expect(observed(b.state)).toBe(observed(a.state));

    /* Control: a property the player sees on sight. */
    objB.number = objA.number + 1;
    expect(observed(b.state)).not.toBe(observed(a.state));
  });

  it("an unaware potion reads only as its flavour, whichever kind it is", () => {
    const [a, b] = pair();
    const x = kindNamed(a, TV.POTION, "Speed");
    const y = kindNamed(b, TV.POTION, "Resist Poison");
    const xInB = kindNamed(b, TV.POTION, "Speed");
    expect(a.flavor.isAware(x)).toBe(false);
    expect(b.flavor.isAware(y)).toBe(false);
    /* In B the flavour that A gave Speed belongs to Resist Poison instead. */
    const swap = <T>(read: ((k: ObjectKind) => T) | undefined) =>
      (k: ObjectKind): T => read!(k === y ? xInB : k === xInB ? y : k);
    b.state.flavorGlyph = swap(b.state.flavorGlyph);
    b.state.flavorText = swap(b.state.flavorText);
    b.state.hasFlavor = swap(b.state.hasFlavor);
    carry(a, x);
    carry(b, y);
    expect(observed(b.state)).toBe(observed(a.state));

    /* Control: learning the kind names it. */
    b.flavor.setAware(y);
    expect(observed(b.state)).not.toBe(observed(a.state));
  });

  it("floor memory that has gone stale is reported as remembered", () => {
    const [a, b] = pair();
    const grid = hiddenEmptyGrid(a.state, { x: -1, y: -1 });
    const drop = (g: StartedGame): GameObject => {
      const reg = g.booted.registries;
      const obj = objectPrep(new Rng(1), reg.objects, reg.constants, kindNamed(g, TV.FLASK, "Flask of oil"), 1, "minimise");
      floorCarry(g.state, grid, obj);
      squareMemorize(g.state, grid);
      squareKnowPile(g.state, grid);
      return obj;
    };
    drop(a);
    const objB = drop(b);
    const cell = buildKnownWorld(a.state).level?.cells.find((c) => c.x === grid.x && c.y === grid.y);
    expect(cell?.remembered.objects).toHaveLength(1);
    /* Something the player did not see took the flask from B. */
    floorExcise(b.state, grid, objB);
    expect(observed(b.state)).toBe(observed(a.state));

    /* Control: once the player looks again, the memory updates. */
    squareKnowPile(b.state, grid);
    expect(observed(b.state)).not.toBe(observed(a.state));
  });
});

describe("KnownWorld", () => {
  it("never carries the real map, even for a view granted it", () => {
    const [a] = pair();
    const world = buildKnownWorld(a.state, {}, { has: () => true });
    expect(JSON.stringify(world.level)).not.toContain('"actual"');
    expect(createAgentView(a.state).knownLevel!()?.cells.some((c) => "actual" in c)).toBe(true);
  });

  it("is null for each part the caller cannot read", () => {
    const [a] = pair();
    const world = buildKnownWorld(a.state, {}, { has: (c) => c === "state:player.read" });
    expect(world.player).not.toBeNull();
    expect(world.monsters).toBeNull();
    expect(world.inventory).toBeNull();
    expect(world.level).toBeNull();
  });

  it("is deep-frozen and shares nothing with the game", () => {
    const [a] = pair();
    const world = buildKnownWorld(a.state);
    expect(Object.isFrozen(world)).toBe(true);
    expect(Object.isFrozen(world.player)).toBe(true);
    expect(world.monsters?.every((m) => Object.isFrozen(m))).toBe(true);
  });

  it("is what an AgentView's knownWorld() returns", () => {
    const [a] = pair();
    const fromView = createAgentView(a.state).knownWorld!();
    expect(JSON.stringify({ ...fromView, token: null })).toBe(JSON.stringify({ ...buildKnownWorld(a.state), token: null }));
  });
});
