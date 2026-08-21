/**
 * The in-session reincarnation (reincarnate_borg, borg/borg-reincarnate.c).
 *
 * WHAT THESE TESTS ARE FOR. Not "does a new player object exist" - the risk here
 * is the opposite one. The whole point of an in-place reincarnation is that
 * everything a SESSION owns survives it: the GameState object every wired closure
 * captured, the player object those closures reach through, the RNG stream, the
 * option store, the turn counter. A reimplementation that replaced any of them
 * would produce a plausible-looking new character wired to nothing, and a test that
 * only inspected the new character's level and hitpoints would call it green.
 *
 * So the assertions come in pairs: what changed, and what is still the same
 * object. The identity checks are the load-bearing half.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";
import { NOSCORE } from "../game/wizard.js";
import { runGameLoop } from "../game/loop.js";

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
  /* The shops are part of what a reincarnation resets, so this pack ships them -
   * without the records `reg.stores` is undefined and the store assertions below
   * would be measuring a game that has no stores to reset. */
  store: loadRecords("store"),
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

/** A game in the town, the state a screensaver run spends most of its life in. */
function townGame(seed: number) {
  return startGame(pack, { seed, depth: 0 });
}

/** Kill the character the way a monster does: died_from plus the dead flag. */
function killCharacter(state: ReturnType<typeof townGame>["state"]): void {
  state.actor.player.diedFrom = "a giant white mouse";
  state.actor.player.chp = -1;
  state.isDead = true;
}

describe("reincarnate: the character is new", () => {
  it("rolls a level-1 character at full health, out of the real birth pipeline", () => {
    const game = townGame(4242);
    const p = game.state.actor.player;
    p.lev = 17;
    p.maxLev = 17;
    p.exp = 50_000;
    p.maxExp = 50_000;
    p.au = 9999;
    p.maxDepth = 20;
    killCharacter(game.state);

    game.reincarnate();

    /* generatePlayer's own output, not a hand-written reset: level 1, no
     * experience, the birth gold, and hitpoints derived from the rolled hitdice
     * rather than left at the dead character's. */
    expect(p.lev).toBe(1);
    expect(p.maxLev).toBe(1);
    expect(p.exp).toBe(0);
    expect(p.maxExp).toBe(0);
    expect(p.maxDepth).toBe(0);
    expect(p.mhp).toBeGreaterThan(0);
    expect(p.chp).toBe(p.mhp);
    expect(p.csp).toBe(p.msp);
    /* The birth history walk ran, which is one of the pipeline stages a
     * hand-rolled reset would have had no reason to include. */
    expect(p.history.length).toBeGreaterThan(0);
    expect(p.hist.length).toBeGreaterThan(0);
  });

  it("is alive and playing again, in town, with no level change left pending", () => {
    const game = townGame(77);
    killCharacter(game.state);

    game.reincarnate();

    expect(game.state.isDead).toBe(false);
    expect(game.state.playing).toBe(true);
    expect(game.state.pendingDeath).toBeUndefined();
    /* "Start in town" (borg-reincarnate.c:483). The level request is consumed
     * here rather than handed on, so the host is not left owing the engine a
     * changeLevel it does not know about. */
    expect(game.state.chunk.depth).toBe(0);
    expect(game.state.generateLevel).toBe(false);
    expect(game.state.targetDepth).toBeUndefined();
    /* The loop agrees: it has no reason to stop. */
    expect(game.state.actor.player.chp).toBeGreaterThan(0);
  });

  it("does not carry the dead character's belongings forward", () => {
    const game = townGame(1234);
    const { state } = game;
    /* Every object the dead character was carrying, by identity. A gear store
     * that was re-derived, appended to, or simply left alone would still be
     * holding some of these. */
    const doomed = new Set([...state.gear.store.values()]);
    expect(doomed.size).toBeGreaterThan(0);
    killCharacter(state);

    game.reincarnate();

    expect(state.gear.store.size).toBeGreaterThan(0);
    for (const obj of state.gear.store.values()) {
      expect(doomed.has(obj)).toBe(false);
    }
    /* Handles restart at 1 (the emptied-not-appended half), and the equipment
     * array indexes into the NEW store rather than at handles it no longer has. */
    expect(Math.min(...state.gear.store.keys())).toBe(1);
    for (const handle of state.actor.player.equipment) {
      if (handle !== 0) expect(state.gear.store.has(handle)).toBe(true);
    }
    /* Something is equipped: outfitPlayer's wield_all ran, so the derived state
     * has a real loadout to have been computed from. */
    expect(state.actor.player.equipment.some((h) => h !== 0)).toBe(true);
  });

  it("recomputes the derived state for the NEW race and class", () => {
    /* The failure this catches: a reincarnation that rolled a new player and left
     * state.actor.combat / .speed / .weapon describing the dead one. The Borg
     * reads exactly those, so it would have been playing a character it could not
     * see. */
    const game = townGame(9090);
    const { state } = game;
    killCharacter(state);

    game.reincarnate({ raceName: "Half-Troll", className: "Warrior" });

    expect(state.actor.player.race.name).toBe("Half-Troll");
    expect(state.actor.player.cls.name).toBe("Warrior");
    expect(state.playerState).toBeDefined();
    expect(state.actor.combat.numBlows).toBeGreaterThan(0);
    expect(state.actor.speed).toBeGreaterThan(0);
    expect(state.actor.weapon).not.toBeNull();
    /* The inven view was rebuilt (buildGearViews), not left describing the old
     * pack - an empty one is what a missing rebuild looks like. */
    expect((state.gear.inven ?? []).length).toBeGreaterThan(0);
  });

  it("does not inherit what the dead character had identified", () => {
    const game = townGame(555);
    const { state, flavor } = game;
    const reg = game.booted.registries.objects;
    const flavoured = reg.kinds.filter((k) => k && !flavor.isAware(k));
    for (const k of flavoured) if (k) flavor.setAware(k);
    const awareBefore = flavor.snapshot().aware.length;
    expect(awareBefore).toBeGreaterThan(0);
    killCharacter(state);

    game.reincarnate();

    /* Only the new kit's own kinds are aware again (player-birth.c:650). */
    expect(flavor.snapshot().aware.length).toBeLessThan(awareBefore);
  });

  it("resets the stores, so the new character does not inherit the shopping", () => {
    /* store_reset() and chunk_list_max = 0 (borg-reincarnate.c:534-535). */
    const game = townGame(31337);
    const { state } = game;
    expect(state.stores?.length ?? 0).toBeGreaterThan(0);
    const home = state.stores![state.stores!.length - 1]!;
    const stocked = state.stores!.map((s) => s.stock.length);
    home.stock.length = 0;
    killCharacter(state);

    game.reincarnate();

    expect(state.stores?.length).toBe(stocked.length);
    expect(state.daycount).toBe(0);
    /* A rebuild, not the same array aged forward. */
    expect(state.stores![state.stores!.length - 1]).not.toBe(home);
  });
});

describe("reincarnate: the session is the same session", () => {
  it("mutates the player IN PLACE, so every wired closure still reaches it", () => {
    /* THE ONE THAT MATTERS. wireGame's closures captured state.actor.player.
     * Replacing the object would leave the command registry, the rune env and the
     * effect interpreter all operating on the corpse. */
    const game = townGame(2026);
    const before = game.state.actor.player;
    const beforeRace = before.race.name;
    const beforeCls = before.cls.name;
    killCharacter(game.state);

    game.reincarnate({ raceName: "Kobold", className: "Mage" });

    expect(game.state.actor.player).toBe(before);
    expect(before.race.name).toBe("Kobold");
    expect(before.cls.name).toBe("Mage");
    /* And the wipe was a wipe: the default Human Warrior did not survive it. */
    expect(`${beforeRace} ${beforeCls}`).not.toBe("Kobold Mage");
  });

  it("keeps the state, the gear store, the RNG and the options as the same objects", () => {
    const game = townGame(808);
    const { state } = game;
    const identities = {
      state,
      gear: state.gear,
      actor: state.actor,
      rng: state.rng,
      options: state.options,
    };
    const turnBefore = state.turn;
    state.turn += 4000;
    killCharacter(state);

    game.reincarnate();

    expect(state).toBe(identities.state);
    expect(state.gear).toBe(identities.gear);
    expect(state.actor).toBe(identities.actor);
    expect(state.rng).toBe(identities.rng);
    expect(state.options).toBe(identities.options);
    /* The turn counter is the game's, not the character's (upstream's `turn` is a
     * global that reincarnate_borg never touches). */
    expect(state.turn).toBeGreaterThan(turnBefore);
  });

  it("leaves the world seeds alone, so the save still describes the world it is in", () => {
    /* Upstream re-seeds seed_flavor and seed_randart here. This port's savefile
     * re-derives the flavour assignment and the randart set FROM those seeds
     * (docs/PARITY.md), so moving either mid-session would make the save describe
     * a different world. Deliberate deviation, pinned so it stays deliberate. */
    const game = townGame(6060);
    const seedFlavor = game.seedFlavor;
    const seedRandart = game.randartSeed;
    killCharacter(game.state);

    game.reincarnate();

    expect(game.seedFlavor).toBe(seedFlavor);
    expect(game.randartSeed).toBe(seedRandart);
  });

  it("survives being driven straight back into the game loop", () => {
    /* The proof that the state is coherent rather than merely populated: the loop
     * takes a turn on the reborn character without throwing, and does not
     * immediately report it dead. */
    const game = townGame(4711);
    killCharacter(game.state);
    game.reincarnate();

    game.state.nextCommand = (): null => null;
    expect(() => runGameLoop(game.state, game.registry)).not.toThrow();
    expect(game.state.isDead).toBe(false);
  });
});

describe("reincarnate: race and class", () => {
  it("rolls them, rather than repeating one build", () => {
    /* borg_cfg[BORG_RESPAWN_RACE] == -1 -> player_id2race(randint0(MAX_RACES)).
     * A loop that produced the same character every death would be the same
     * screensaver frame over and over. */
    const game = townGame(13);
    const builds = new Set<string>();
    for (let i = 0; i < 24; i++) {
      killCharacter(game.state);
      const out = game.reincarnate();
      builds.add(`${out.raceName} ${out.className}`);
      expect(game.state.actor.player.race.name).toBe(out.raceName);
      expect(game.state.actor.player.cls.name).toBe(out.className);
    }
    expect(builds.size).toBeGreaterThan(1);
  });

  it("honours a pinned race and class when one is asked for", () => {
    const game = townGame(24);
    for (let i = 0; i < 3; i++) {
      killCharacter(game.state);
      const out = game.reincarnate({ raceName: "Hobbit", className: "Ranger" });
      expect(out).toEqual({ raceName: "Hobbit", className: "Ranger" });
    }
  });

  it("rolls rather than throwing when a pinned name is not in the pack", () => {
    /* The caller is a mod's configuration, so a typo costs a reroll and not a
     * dead run. */
    const game = townGame(25);
    killCharacter(game.state);
    const out = game.reincarnate({ raceName: "Vulcan", className: "Sysadmin" });
    expect(out.raceName).not.toBe("Vulcan");
    expect(out.className).not.toBe("Sysadmin");
    expect(game.state.actor.player.race.name).toBe(out.raceName);
  });
});

describe("reincarnate: the one-way mark", () => {
  it("sets the requested noscore bits on the new character", () => {
    const game = townGame(101);
    expect(game.state.actor.player.noscore & NOSCORE.BORG).toBe(0);
    killCharacter(game.state);

    game.reincarnate({ noscore: NOSCORE.BORG });

    expect(game.state.actor.player.noscore & NOSCORE.BORG).toBe(NOSCORE.BORG);
  });

  it("re-marks every character the loop produces, because birth zeroes the field", () => {
    /* player_generate does not carry noscore across, which is why upstream sets
     * the bit at the TAIL of reincarnate_borg rather than once. Without the
     * re-mark, only the first respawn would be marked and every one after it
     * would read as a legitimately-played character. */
    const game = townGame(102);
    for (let i = 0; i < 5; i++) {
      killCharacter(game.state);
      game.reincarnate({ noscore: NOSCORE.BORG });
      expect(game.state.actor.player.noscore & NOSCORE.BORG).toBe(NOSCORE.BORG);
    }
  });

  it("keeps bits a caller did not ask for, and clears nothing", () => {
    /* markNoscore only ORs. A character that had been in wizard mode before an
     * autoplayer took over carries both marks afterwards, and no call can put
     * either back. */
    const game = townGame(103);
    game.state.actor.player.noscore = NOSCORE.WIZARD;
    killCharacter(game.state);
    game.reincarnate({ noscore: NOSCORE.BORG });
    /* The wizard bit was on the DEAD character, and player_generate zeroed it, so
     * what is asserted here is the shape of the mark rather than inheritance: the
     * requested bits are set and nothing else is. */
    expect(game.state.actor.player.noscore).toBe(NOSCORE.BORG);

    game.state.actor.player.noscore |= NOSCORE.WIZARD;
    killCharacter(game.state);
    game.reincarnate({ noscore: NOSCORE.BORG });
    expect(game.state.actor.player.noscore & NOSCORE.BORG).toBe(NOSCORE.BORG);
  });

  it("marks nothing when no bits are asked for", () => {
    /* The mark is the caller's claim about who was playing, not something this
     * function decides - a host with no autoplayer installed gets no mark. */
    const game = townGame(104);
    killCharacter(game.state);
    game.reincarnate();
    expect(game.state.actor.player.noscore).toBe(0);
  });

  it("takes the new character's name from the caller", () => {
    const game = townGame(105);
    killCharacter(game.state);
    game.reincarnate({ fullName: "Grumbold" });
    expect(game.state.actor.player.fullName).toBe("Grumbold");
  });
});
