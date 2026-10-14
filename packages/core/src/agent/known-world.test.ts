/**
 * Paired worlds: two games built from the same seed, then made to differ only
 * in something the player cannot know. Each pair must build the same
 * KnownWorld. Each case also has a control that makes the difference knowable
 * and checks that the worlds then differ, so a case cannot pass by comparing
 * nothing.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, MFLAG, OF, RF, RSF, SQUARE, TMD, TRF, TV } from "../generated/index.js";
import { OBJ_MOD } from "../generated/object-modifiers.js";
import { FlagSet } from "../bitflag.js";
import { GameEvents } from "../events.js";
import { NOSCORE } from "../game/wizard.js";
import type { CombatOutcomeEventData } from "../events.js";
import type { GameState } from "../game/context.js";
import { deleteMonster, monsterSwap } from "../game/context.js";
import { describeObject } from "../game/describe.js";
import { floorCarry, floorExcise } from "../game/floor.js";
import { invenCarry } from "../game/gear.js";
import { becomeAware, squareKnowPile, squareMemorize, updateMon, updateMonsters } from "../game/known.js";
import { squareIsEmptyLive } from "../game/mon-place.js";
import { emitCombatOutcome, emitHeal, emitMotion } from "../game/resolved-events.js";
import { restoreMonsters } from "../game/scheduler.js";
import { installTrap, squareMemorizeTraps, squareRemoveAllTraps } from "../game/trap.js";
import { monsterIndexMove } from "../game/world.js";
import { distance, loc } from "../loc.js";
import { getLore } from "../mon/lore.js";
import { TRF_SIZE } from "../world/trap.js";
import type { TrapKind } from "../world/trap.js";
import type { Monster } from "../mon/monster.js";
import { monsterIsObvious } from "../mon/predicate.js";
import { ContentIdResolver } from "../mod/ids.js";
import { ODESC } from "../obj/desc.js";
import { OBJ_NOTICE, playerLearnFlagRune } from "../obj/knowledge.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import type { ObjectKind } from "../obj/types.js";
import { Rng } from "../rng.js";
import { startGame } from "../session/game.js";
import type { GamePack, StartedGame } from "../session/game.js";
import { GlyphTable } from "../visuals/glyph-table.js";
import { buildKnownWorld, knownMonsterMidx, knownMonsters, observeKnownStore } from "./known-world.js";
import type { KnownMonster, KnownWorld } from "./known-world.js";
import { createAgentView } from "./perceive.js";
import type { AgentViewDeps } from "./types.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  store: loadRecords("store"),
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

/**
 * The deps the web client builds every KnownWorld with (main.ts
 * modSnapshotSource.viewDeps): content ids, item values and prices, glyphs,
 * and the names the inventory and the shop screen print. Without them a leak
 * through one of those fields would go unseen here.
 */
function clientDeps(game: StartedGame): AgentViewDeps {
  const reg = game.booted.registries;
  const { state } = game;
  return {
    resolver: new ContentIdResolver({
      objects: reg.objects,
      playerRaces: game.players.races,
      playerClasses: game.players.classes,
    }),
    reg: reg.objects,
    glyphs: new GlyphTable({
      features: reg.features.allFeatures(),
      kinds: reg.objects.kinds,
      races: reg.monsters.races,
      traps: reg.traps,
      flavors: reg.objects.flavors,
    }).agentGlyphs(),
    describe: (obj) => describeObject(state, obj, ODESC.PREFIX | ODESC.FULL),
    describeStore: (obj) => describeObject(state, obj, ODESC.PREFIX | ODESC.FULL | ODESC.STORE),
    ignored: (obj) => state.isIgnored?.(obj) ?? false,
  };
}

/** Two games that start out identical, each with the client's deps installed. */
function pair(): [StartedGame, StartedGame] {
  const games: [StartedGame, StartedGame] = [
    startGame(pack, { seed: SEED, depth: DEPTH }),
    startGame(pack, { seed: SEED, depth: DEPTH }),
  ];
  for (const game of games) game.state.knownWorldDeps = clientDeps(game);
  return games;
}

/**
 * A world as text, without the tokens: each GameState has its own token epoch,
 * which names the game rather than describing it.
 */
function observed(state: GameState): string {
  const world: KnownWorld = buildKnownWorld(state, state.knownWorldDeps);
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
  it("reports only the fuel printed in a light's name", () => {
    const [a, b] = pair();
    const torchA = carry(a, kindNamed(a, TV.LIGHT, "Wooden Torch"));
    const torchB = carry(b, kindNamed(b, TV.LIGHT, "Wooden Torch"));
    torchA.flags.on(OF.NO_FUEL);
    torchB.flags.on(OF.NO_FUEL);
    torchA.timeout = 25;
    torchB.timeout = 2500;
    expect(observed(b.state)).toBe(observed(a.state));
    const item = () => buildKnownWorld(b.state, b.state.knownWorldDeps).inventory!.find((entry) => entry.label.includes("Wooden Torch"))!;
    expect(item()).not.toHaveProperty("fuel");
    torchB.flags.off(OF.NO_FUEL);
    expect(item().name).toContain("(2500 turns)");
    expect(item().fuel).toBe(2500);
    torchB.timeout = 0;
    expect(item().fuel).toBe(0);
  });

  it("withholds unlearned blows, average health and spell frequency", () => {
    const [a, b] = pair();
    const monA = liveMonsters(a.state).find((mon) => mon.race.blows.length > 0)!;
    const monB = twin(b.state, monA);
    for (const mon of [monA, monB]) {
      mon.mflag.on(MFLAG.VISIBLE);
      mon.mflag.off(MFLAG.CAMOUFLAGE);
    }
    for (const game of [a, b]) game.state.lore.delete(monA.race.ridx);
    monB.race = { ...monB.race, avgHp: monB.race.avgHp + 40, freqSpell: 55, blows: [] };
    expect(observed(b.state)).toBe(observed(a.state));
    const lore = getLore(a.state.lore, monA.race);
    lore.blowKnown[0] = true;
    lore.armourKnown = true;
    lore.spellFreqKnown = true;
    const monster = knownMonsters(a.state).find((mon) => knownMonsterMidx(a.state, mon.id) === monA.midx)!;
    expect(monster.blows).toHaveLength(1);
    expect(monster.averageHp).toBe(monA.race.avgHp);
    expect(monster.spellFrequency).toEqual({ percent: monA.race.freqSpell, exact: true });
  });

  it("reports the autoplayer mark independently of the other score marks", () => {
    const [a, b] = pair();
    b.state.actor.player.noscore = NOSCORE.DEBUG;
    expect(observed(b.state)).toBe(observed(a.state));
    b.state.actor.player.noscore |= NOSCORE.BORG;
    expect(buildKnownWorld(b.state).player!.autoplayed).toBe(true);
    expect(buildKnownWorld(a.state).player!.autoplayed).toBe(false);
  });

  it("reads extra moves from known equipment and reports the full name", () => {
    const [a, b] = pair();
    b.state.playerState!.numMoves += 5;
    expect(observed(b.state)).toBe(observed(a.state));
    b.state.actor.player.fullName = "Cedar";
    b.state.knownPlayerState!.numMoves = 2;
    expect(buildKnownWorld(b.state).player).toMatchObject({ fullName: "Cedar", extraMoves: 2 });
  });

  it("names an artifact id only after the character knows it is an artifact", () => {
    const [a, b] = pair();
    const objects = [a, b].map((game) => carry(game, kindNamed(game, TV.SWORD, "Dagger")));
    objects.forEach((obj, index) => {
      obj.artifact = [a, b][index]!.booted.registries.objects.artifacts.find((artifact) => artifact && artifact.aidx > index)!;
      obj.notice &= ~OBJ_NOTICE.ASSESSED;
    });
    expect(observed(b.state)).toBe(observed(a.state));
    const item = () => buildKnownWorld(b.state, b.state.knownWorldDeps).inventory!.find((entry) => entry.label.includes("Dagger"))!;
    expect(item()).not.toHaveProperty("artifactId");
    objects[1]!.notice |= OBJ_NOTICE.ASSESSED;
    expect(item().artifactId).toBe(objects[1]!.artifact!.aidx);
  });

  it("reports every timed code without revealing durations", () => {
    const [a, b] = pair();
    a.state.actor.player.timed[TMD.SLOW] = 10;
    b.state.actor.player.timed[TMD.SLOW] = 20;
    expect(observed(b.state)).toBe(observed(a.state));
    const timed = buildKnownWorld(a.state).player!.status.timed;
    expect(Object.keys(timed)).toHaveLength(Object.keys(TMD).length);
    expect(timed["SLOW"]).toEqual(expect.any(String));
    b.state.actor.player.timed[TMD.SLOW] = 0;
    expect(observed(b.state)).not.toBe(observed(a.state));
  });

  it("uninspected store stock produces identical observations", () => {
    const [a, b] = pair();
    for (const game of [a, b]) game.changeLevel(0);
    const stockA = a.state.stores![0]!;
    const stockB = b.state.stores![0]!;
    expect(stockA.stock.length).toBeGreaterThan(0);
    stockB.stock = [];
    expect(observed(b.state)).toBe(observed(a.state));
    expect(buildKnownWorld(a.state).stores![0]!.stock).toEqual([]);
    for (const game of [a, b]) game.state.chunk.setFeat(game.state.actor.grid, stockA.feat);
    expect(observed(b.state)).not.toBe(observed(a.state));
  });

  it("store maintenance outside the inspected store leaves remembered stock unchanged", () => {
    const [a, b] = pair();
    for (const game of [a, b]) game.changeLevel(0);
    for (const game of [a, b]) {
      game.state.chunk.setFeat(game.state.actor.grid, game.state.stores![0]!.feat);
      buildKnownWorld(game.state, game.state.knownWorldDeps);
      game.state.chunk.setFeat(game.state.actor.grid, FEAT.FLOOR);
    }
    b.state.stores![0]!.stock = [];
    expect(observed(b.state)).toBe(observed(a.state));
    b.state.chunk.setFeat(b.state.actor.grid, b.state.stores![0]!.feat);
    expect(observed(b.state)).not.toBe(observed(a.state));
  });

  it("remote store inspections refresh only inspected stock (paired worlds)", () => {
    const [a, b] = pair();
    for (const game of [a, b]) {
      game.changeLevel(0);
      observeKnownStore(game.state, game.state.stores![0]!);
    }
    expect(buildKnownWorld(a.state).stores![0]!.stock.length).toBeGreaterThan(0);
    b.state.stores![0]!.stock = [];
    b.state.stores![1]!.stock = [];
    expect(observed(b.state)).toBe(observed(a.state));
    observeKnownStore(b.state, b.state.stores![0]!);
    expect(observed(b.state)).not.toBe(observed(a.state));
    expect(buildKnownWorld(a.state).stores![1]!.stock).toEqual([]);
  });

  it.each(["rune", "curse"])("hidden floor %s mutations leave remembered auras unchanged", (mutation) => {
    const [a, b] = pair();
    const grid = hiddenEmptyGrid(a.state, { x: -1, y: -1 });
    let objB: GameObject | undefined;
    for (const game of [a, b]) {
      game.state.actor.player.objKnown.curses[1] = 1;
      const reg = game.booted.registries;
      const obj = objectPrep(new Rng(1), reg.objects, reg.constants, kindNamed(game, TV.SWORD, "Dagger"), 1, "minimise");
      obj.notice |= OBJ_NOTICE.ASSESSED;
      floorCarry(game.state, grid, obj);
      squareMemorize(game.state, grid);
      squareKnowPile(game.state, grid);
      if (game === b) objB = obj;
    }
    if (mutation === "rune") objB!.flags.on(OF.SEE_INVIS);
    else {
      objB!.curses = b.state.runeEnv.curses.map(() => ({ power: 0, timeout: 0 }));
      objB!.curses[1]!.power = 20;
    }
    expect(observed(b.state)).toBe(observed(a.state));
    squareKnowPile(b.state, grid);
    expect(observed(b.state)).not.toBe(observed(a.state));
  });

  it("invisible sibling traps produce identical observations", () => {
    const [a, b] = pair();
    const grid = hiddenEmptyGrid(a.state, { x: -1, y: -1 });
    for (const game of [a, b]) {
      const flags = new FlagSet(TRF_SIZE);
      flags.on(TRF.TRAP);
      const kind = { tidx: 0, name: "seen trap", flags } as unknown as TrapKind;
      installTrap(game.state, grid, 0, 0, { kinds: [kind] } as unknown as Parameters<typeof installTrap>[4]);
      game.state.traps.get(grid.y * game.state.chunk.width + grid.x)![0]!.flags.on(TRF.VISIBLE);
      squareMemorize(game.state, grid);
    }
    const key = grid.y * b.state.chunk.width + grid.x;
    const visible = b.state.traps.get(key)![0]!;
    const hidden = { ...visible, tidx: 1, kind: { ...visible.kind, tidx: 1, name: "hidden trap" }, flags: new FlagSet(TRF_SIZE), power: 99 };
    b.state.traps.get(key)!.push(hidden);
    for (const game of [a, b]) squareMemorizeTraps(game.state, grid);
    expect(observed(b.state)).toBe(observed(a.state));
    hidden.flags.on(TRF.VISIBLE);
    squareMemorizeTraps(b.state, grid);
    expect(observed(b.state)).not.toBe(observed(a.state));
  });

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
    const lore = b.state.lore.get(seenB.race.ridx);
    const unseen = (["IM_COLD", "IM_ACID", "IM_ELEC", "IM_POIS", "IM_FIRE"] as const).find(
      (code) => !seenB.race.flags.has(RF[code]) && !(lore?.flags.has(RF[code]) ?? false),
    );
    if (!unseen) throw new Error("no unlearned immunity for this race");
    seenB.race.flags.on(RF[unseen]);
    seenB.race.spellFlags.on(RSF.BLINK);
    expect(observed(b.state)).toBe(observed(a.state));

    const at = (state: GameState) => knownMonsters(state).find((m) => m.grid.x === seenB.grid.x && m.grid.y === seenB.grid.y);
    const view = at(b.state);
    expect(view).toMatchObject({ health: "somewhat", raceSpeed: seenB.race.speed });
    expect(view).not.toHaveProperty("hp");
    expect(view).not.toHaveProperty("speed");
    expect(view?.knownFlags).not.toContain(unseen);

    /* Control: once lore records the spell, it shows. */
    getLore(b.state.lore, seenB.race).spellFlags.on(RSF.BLINK);
    expect(observed(b.state)).not.toBe(observed(a.state));
    expect(at(b.state)?.knownSpells).toContain("BLINK");

    /* Control: a flag lore has learned shows too. */
    getLore(b.state.lore, seenB.race).flags.on(RF[unseen]);
    expect(at(b.state)?.knownFlags).toContain(unseen);
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
    const daggerIn = (state: GameState) => buildKnownWorld(state, state.knownWorldDeps).inventory?.find((i) => i.label.includes("Dagger"));
    expect(daggerIn(b.state)?.unknownRunes).toBe(true);

    /* Control: learning the rune B's dagger carries names it. */
    playerLearnFlagRune(b.state.actor.player, b.state.runeEnv, OF.SEE_INVIS, false);
    expect(observed(b.state)).not.toBe(observed(a.state));
    expect(daggerIn(b.state)?.flags).toContain("SEE_INVIS");
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

/** Make a monster one the player perceives, as a detection would. */
function perceive(mon: Monster): void {
  mon.mflag.on(MFLAG.VISIBLE);
  mon.mflag.off(MFLAG.CAMOUFLAGE);
}

/** Monsters the player does not perceive, nearest the player first. */
function hiddenMonsters(state: GameState): Monster[] {
  return liveMonsters(state)
    .filter((m) => !monsterIsObvious(m))
    .sort((x, y) => distance(state.actor.grid, x.grid) - distance(state.actor.grid, y.grid));
}

describe("KnownWorld paired worlds: what the review found", () => {
  it("a mimic the player takes for an object is not a monster the player knows", () => {
    const [a, b] = pair();
    const mimicB = twin(b.state, hiddenMonsters(a.state)[0]!);
    /* B's monster is in sight but camouflaged: the player sees an object. */
    mimicB.mflag.on(MFLAG.VISIBLE);
    mimicB.mflag.on(MFLAG.CAMOUFLAGE);
    expect(observed(b.state)).toBe(observed(a.state));

    /* Control: unmasked, it is a monster. */
    mimicB.mflag.off(MFLAG.CAMOUFLAGE);
    expect(observed(b.state)).not.toBe(observed(a.state));
  });

  it("while the player hallucinates, which monsters are in sight changes nothing", () => {
    const [a, b] = pair();
    for (const g of [a, b]) g.state.actor.player.timed[TMD.IMAGE] = 20;
    const seenB = twin(b.state, hiddenMonsters(a.state)[0]!);
    perceive(seenB);
    b.state.target.set = true;
    b.state.target.midx = seenB.midx;
    b.state.target.grid = seenB.grid;
    expect(observed(b.state)).toBe(observed(a.state));
    const world = buildKnownWorld(b.state, b.state.knownWorldDeps);
    expect(world.monstersHidden).toBe("hallucinating");
    expect(world.monsters).toEqual([]);
    expect(world.target).toBeNull();

    /* Control: once the hallucination ends, the monster is there. */
    for (const g of [a, b]) g.state.actor.player.timed[TMD.IMAGE] = 0;
    expect(observed(b.state)).not.toBe(observed(a.state));
    expect(buildKnownWorld(b.state).monstersHidden).toBeNull();
  });

  it("the order monsters were created in changes nothing", () => {
    const [a, b] = pair();
    const [firstA, secondA] = hiddenMonsters(a.state);
    if (!firstA || !secondA) throw new Error("too few monsters at this seed");
    const firstB = twin(b.state, firstA);
    const secondB = twin(b.state, secondA);
    for (const mon of [firstA, secondA, firstB, secondB]) perceive(mon);
    /* In B the monster with the lower index moves to the end of the list, as if
     * it had been created after the other, with unseen monsters in between. */
    const lower = firstB.midx < secondB.midx ? firstB : secondB;
    const slot = b.state.monsters.length + 3;
    monsterIndexMove(b.state, lower.midx, slot);
    expect(lower.midx).toBe(slot);
    expect(observed(b.state)).toBe(observed(a.state));
    const ids = buildKnownWorld(b.state).monsters?.map((m) => m.id);
    expect(ids).toEqual([1, 2]);

    /* Control: a third monster in sight shows. */
    perceive(twin(b.state, hiddenMonsters(a.state)[0]!));
    expect(observed(b.state)).not.toBe(observed(a.state));
  });

  it("a target on a monster the player cannot see is no target", () => {
    const [a, b] = pair();
    const hiddenB = twin(b.state, hiddenMonsters(a.state)[0]!);
    b.state.target.set = true;
    b.state.target.midx = hiddenB.midx;
    b.state.target.grid = hiddenB.grid;
    expect(observed(b.state)).toBe(observed(a.state));

    /* Control: a target on a location is one. */
    b.state.target.midx = 0;
    b.state.target.grid = loc(b.state.actor.grid.x + 1, b.state.actor.grid.y);
    expect(observed(b.state)).not.toBe(observed(a.state));
    expect(buildKnownWorld(b.state).target).toEqual({ monster: null, grid: b.state.target.grid });
  });

  it("how long a timed effect, a recall or a recharge has left changes nothing", () => {
    const [a, b] = pair();
    const rod = (g: StartedGame) => carry(g, kindNamed(g, TV.ROD, "Treasure Location"));
    const rodA = rod(a);
    const rodB = rod(b);
    const set = (g: StartedGame, fast: number, cut: number, food: number, recall: number, descent: number) => {
      const p = g.state.actor.player;
      p.timed[TMD.FAST] = fast;
      p.timed[TMD.CUT] = cut;
      p.timed[TMD.FOOD] = food;
      p.wordRecall = recall;
      p.deepDescent = descent;
    };
    /* Same grades, same food percentage, different counters. */
    set(a, 10, 12, 5000, 15, 3);
    set(b, 20, 20, 5050, 30, 5);
    rodA.timeout = 5;
    rodB.timeout = 40;
    expect(observed(b.state)).toBe(observed(a.state));
    const world = buildKnownWorld(b.state, b.state.knownWorldDeps);
    expect(world.player?.status).toMatchObject({ fast: "Haste", cut: "Light Cut", food: 50 });
    expect(world.player).toMatchObject({ recall: true, descent: true });
    expect(world.inventory?.find((i) => i.tval === TV.ROD)).toMatchObject({ charging: 1 });
    expect(world.inventory?.[0]).not.toHaveProperty("timeout");

    /* Controls: a new grade, a recall that has fired, a rod that has recharged. */
    b.state.actor.player.timed[TMD.CUT] = 30;
    expect(observed(b.state)).not.toBe(observed(a.state));
    b.state.actor.player.timed[TMD.CUT] = 20;
    b.state.actor.player.wordRecall = 0;
    expect(observed(b.state)).not.toBe(observed(a.state));
    b.state.actor.player.wordRecall = 30;
    rodB.timeout = 0;
    expect(observed(b.state)).not.toBe(observed(a.state));
  });

  it("a remembered trap removed out of view is still remembered", () => {
    const [a, b] = pair();
    const grid = hiddenEmptyGrid(a.state, { x: -1, y: -1 });
    /* The test pack has no trap records, so this is a stand-in kind. */
    const kind = (): TrapKind => {
      const flags = new FlagSet(TRF_SIZE);
      flags.on(TRF.TRAP);
      return { tidx: 0, name: "test trap", flags } as unknown as TrapKind;
    };
    for (const g of [a, b]) {
      installTrap(g.state, grid, 0, 0, { kinds: [kind()] } as unknown as Parameters<typeof installTrap>[4]);
      g.state.traps.get(grid.y * g.state.chunk.width + grid.x)![0]!.flags.on(TRF.VISIBLE);
      squareMemorize(g.state, grid);
      squareMemorizeTraps(g.state, grid);
    }
    const cell = (state: GameState) => buildKnownWorld(state).level?.cells.find((c) => c.x === grid.x && c.y === grid.y);
    expect(cell(a.state)?.remembered.traps).toHaveLength(1);
    /* Something the player did not see disarmed B's trap. */
    squareRemoveAllTraps(b.state, grid);
    expect(observed(b.state)).toBe(observed(a.state));

    /* Control: once the player sees the grid again, the memory is cleared. */
    squareMemorizeTraps(b.state, grid);
    expect(observed(b.state)).not.toBe(observed(a.state));
    expect(cell(b.state)?.remembered.traps).toEqual([]);
  });

  it("recall's race words show before any kill: every adjective and the first noun", () => {
    const [a] = pair();
    const mon = hiddenMonsters(a.state)[0]!;
    perceive(mon);
    mon.race.flags.on(RF.EVIL);
    mon.race.flags.on(RF.ANIMAL);
    mon.race.flags.on(RF.DRAGON);
    mon.race.flags.on(RF.DEMON);
    expect(a.state.lore.get(mon.race.ridx)?.allKnown ?? false).toBe(false);
    const flags = knownMonsters(a.state).find((m) => m.grid.x === mon.grid.x && m.grid.y === mon.grid.y)?.knownFlags;
    expect(flags).toEqual(expect.arrayContaining(["EVIL", "ANIMAL"]));
    /* lore_append_movement prints only the first noun (mon-lore.c:982-987). */
    const [first, second] = RF.DRAGON < RF.DEMON ? ["DRAGON", "DEMON"] : ["DEMON", "DRAGON"];
    expect(flags).toContain(first);
    expect(flags).not.toContain(second);
  });

  it("a blind telepath sees identical worlds despite hidden invisibility", () => {
    const [a, b] = pair();
    const mon = hiddenMonsters(a.state)[0]!;
    for (const game of [a, b]) {
      const monster = twin(game.state, mon);
      game.state.playerState!.flags.on(OF.TELEPATHY);
      monster.race.flags.off(RF.EMPTY_MIND);
      monster.race.flags.off(RF.WEIRD_MIND);
      monster.race.flags.off(RF.INVISIBLE);
      game.state.chunk.sqinfoOn(monster.grid, SQUARE.VIEW);
      game.state.chunk.sqinfoOn(monster.grid, SQUARE.SEEN);
      game.state.actor.player.timed[TMD.BLIND] = 10;
    }
    twin(b.state, mon).race.flags.on(RF.INVISIBLE);
    for (const game of [a, b]) updateMon(game.state, twin(game.state, mon), true);
    const at = () => knownMonsters(a.state).find((m) => m.grid.x === mon.grid.x && m.grid.y === mon.grid.y);
    expect(at()).toBeDefined();
    expect(at()?.visible).toBe(false);
    expect(observed(b.state)).toBe(observed(a.state));
    for (const game of [a, b]) {
      game.state.actor.player.timed[TMD.BLIND] = 0;
      updateMon(game.state, twin(game.state, mon), true);
    }
    expect(at()?.visible).toBe(true);
    expect(observed(b.state)).not.toBe(observed(a.state));
  });
});

describe("KnownMonster ids", () => {
  it("restoration healing with retained visibility produces no observations (paired worlds)", () => {
    const [a, b] = pair();
    const mon = hiddenMonsters(a.state)[0]!;
    for (const game of [a, b]) {
      const monster = twin(game.state, mon);
      perceive(monster);
      game.state.chunk.sqinfoOn(monster.grid, SQUARE.VIEW);
      monster.hp = monster.maxhp - 1;
      game.state.events = new GameEvents();
    }
    const heard: unknown[] = [];
    b.state.events!.on("heal", (_type, event) => heard.push(event.perceivedWho));
    restoreMonsters(b.state, 100);
    expect(heard).toEqual([]);
    twin(a.state, mon).hp = twin(b.state, mon).hp;
    expect(observed(b.state)).toBe(observed(a.state));
  });

  it("suppressed healing events cannot change ids (paired worlds)", () => {
    const [a, b] = pair();
    const [near, far] = hiddenMonsters(a.state);
    for (const game of [a, b]) {
      perceive(twin(game.state, near!));
      perceive(twin(game.state, far!));
    }
    b.state.events = new GameEvents();
    const healed = twin(b.state, far!);
    expect(b.state.chunk.sqinfoHas(healed.grid, SQUARE.VIEW)).toBe(false);
    emitHeal(b.state, healed, 1, healed.grid);
    expect(observed(b.state)).toBe(observed(a.state));
  });

  it("stay with a monster and lead back to it only while the player perceives it", () => {
    const [a] = pair();
    const mon = hiddenMonsters(a.state)[0]!;
    perceive(mon);
    const id = knownMonsters(a.state)[0]!.id;
    expect(knownMonsterMidx(a.state, id)).toBe(mon.midx);
    expect(knownMonsterMidx(a.state, id + 1)).toBeNull();
    mon.mflag.off(MFLAG.VISIBLE);
    expect(knownMonsterMidx(a.state, id)).toBeNull();
    perceive(mon);
    expect(knownMonsters(a.state)[0]!.id).toBe(id);
    /* A new level starts the count again. */
    a.state.levelSerial = (a.state.levelSerial ?? 0) + 1;
    expect(knownMonsterMidx(a.state, id)).toBeNull();
  });
});

describe("monsterBecameVisible", () => {
  function listen(state: GameState): KnownMonster[] {
    const heard: KnownMonster[] = [];
    state.modHooks = { monsterBecameVisible: (m) => heard.push(m) };
    return heard;
  }

  it("does not fire for a mimic until it is unmasked", () => {
    const [a] = pair();
    const heard = listen(a.state);
    const mimic = hiddenMonsters(a.state)[0]!;
    const reg = a.booted.registries;
    const obj = objectPrep(new Rng(1), reg.objects, reg.constants, kindNamed(a, TV.FLASK, "Flask of oil"), 1, "minimise");
    obj.mimickingMIdx = mimic.midx;
    mimic.mimickedObj = 1;
    floorCarry(a.state, mimic.grid, obj);
    mimic.mflag.on(MFLAG.CAMOUFLAGE);
    mimic.mflag.on(MFLAG.MARK);
    updateMon(a.state, mimic, true);
    expect(mimic.mflag.has(MFLAG.VISIBLE)).toBe(true);
    expect(heard).toEqual([]);

    becomeAware(a.state, mimic);
    expect(heard).toHaveLength(1);
    updateMon(a.state, mimic, true);
    expect(heard).toHaveLength(1);
  });

  it("does not fire while the player hallucinates", () => {
    const [a] = pair();
    const heard = listen(a.state);
    a.state.actor.player.timed[TMD.IMAGE] = 20;
    const mon = hiddenMonsters(a.state)[0]!;
    mon.mflag.on(MFLAG.MARK);
    updateMon(a.state, mon, true);
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(true);
    expect(heard).toEqual([]);

    /* Control: the same sighting fires once the hallucination is over. */
    a.state.actor.player.timed[TMD.IMAGE] = 0;
    updateMon(a.state, mon, true);
    expect(heard).toHaveLength(1);
    updateMon(a.state, mon, true);
    expect(heard).toHaveLength(1);
  });

  it("hands a frozen payload built with the client's deps", () => {
    const [a] = pair();
    const heard = listen(a.state);
    const mon = hiddenMonsters(a.state)[0]!;
    mon.mflag.on(MFLAG.MARK);
    updateMon(a.state, mon, true);
    expect(heard).toHaveLength(1);
    expect(Object.isFrozen(heard[0])).toBe(true);
    expect(Object.isFrozen(heard[0]!.knownFlags)).toBe(true);
    /* The glyph comes only from the deps. */
    expect(heard[0]!.glyph).toBeDefined();
    expect(heard[0]).toEqual(knownMonsters(a.state, a.state.knownWorldDeps).find((m) => m.id === heard[0]!.id));
  });

  it("survives a fault building the payload, and reports it", () => {
    const [a] = pair();
    const heard = listen(a.state);
    const faults: string[] = [];
    a.state.onEventFault = (type) => faults.push(type);
    a.state.knownWorldDeps = {
      glyphs: {
        monsterChar: () => {
          throw new Error("broken glyphs");
        },
      } as unknown as NonNullable<AgentViewDeps["glyphs"]>,
    };
    const mon = hiddenMonsters(a.state)[0]!;
    mon.mflag.on(MFLAG.MARK);
    expect(() => updateMon(a.state, mon, true)).not.toThrow();
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(true);
    expect(heard).toEqual([]);
    expect(faults).toEqual(["monsterBecameVisible"]);
  });

  it("hears a pass's sightings nearest first, whatever order the monsters were made in", () => {
    const [a] = pair();
    const heard = listen(a.state);
    const [near, far] = hiddenMonsters(a.state);
    if (!near || !far || distance(a.state.actor.grid, near.grid) === distance(a.state.actor.grid, far.grid)) {
      throw new Error("no two monsters at different distances at this seed");
    }
    /* Make the nearer one the newer one. */
    if (near.midx < far.midx) monsterIndexMove(a.state, near.midx, a.state.monsters.length + 1);
    expect(near.midx).toBeGreaterThan(far.midx);
    near.mflag.on(MFLAG.MARK);
    far.mflag.on(MFLAG.MARK);
    updateMonsters(a.state, true);
    expect(heard.map((m) => m.grid)).toEqual([near.grid, far.grid].map((g) => ({ x: g.x, y: g.y })));
    expect(heard.map((m) => m.id)).toEqual([1, 2]);
  });
});

describe("combat, movement and healing events", () => {
  it("motion captures origin perception before the swap", () => {
    const [a] = pair();
    const mon = hiddenMonsters(a.state)[0]!;
    const from = mon.grid;
    const to = hiddenEmptyGrid(a.state, from);
    a.state.events = new GameEvents();
    const heard: Array<{ fromSeen?: boolean }> = [];
    a.state.events.on("motion", (_type, event) => heard.push(event));
    a.state.chunk.sqinfoOn(to, SQUARE.VIEW);
    a.state.chunk.sqinfoOn(to, SQUARE.SEEN);
    mon.race.flags.off(RF.INVISIBLE);
    monsterSwap(a.state, from, to);
    emitMotion(a.state, mon, from, to, "teleport");
    expect(heard[0]?.fromSeen).toBe(false);
    monsterSwap(a.state, to, from);
    emitMotion(a.state, mon, to, from, "teleport");
    expect(heard[1]?.fromSeen).toBe(true);
  });

  it("name a monster the event killed as the player saw it", () => {
    const [a] = pair();
    const heard: CombatOutcomeEventData[] = [];
    a.state.events = new GameEvents();
    a.state.events.on("combat-outcome", (_type, data) => heard.push(data));
    const [seen, hidden] = hiddenMonsters(a.state);
    perceive(seen!);
    const id = knownMonsters(a.state)[0]!.id;
    deleteMonster(a.state, seen!.midx);
    deleteMonster(a.state, hidden!.midx);
    emitCombatOutcome(a.state, "player", seen!, "melee", true, 5, true, seen!.grid);
    emitCombatOutcome(a.state, "player", hidden!, "melee", true, 5, true, hidden!.grid);
    expect(heard.map((e) => e.perceivedTarget)).toEqual([{ monster: id }, "unseen"]);
    expect(heard.map((e) => e.perceivedAttacker)).toEqual(["player", "player"]);

    /* While hallucinating, no monster is named. */
    const other = hiddenMonsters(a.state)[0]!;
    perceive(other);
    a.state.actor.player.timed[TMD.IMAGE] = 20;
    emitCombatOutcome(a.state, other, "player", "melee", true, 1, false, a.state.actor.grid);
    expect(heard[2]?.perceivedAttacker).toBe("unseen");
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
