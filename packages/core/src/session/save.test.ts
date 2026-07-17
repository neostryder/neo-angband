import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, TV } from "../generated";
import { runGameLoop, LOOP_STATUS } from "../game/loop";
import { monsterGroupsVerify } from "../game/mon-group";
import type { PlayerCommand } from "../game/context";
import { objectNew } from "../obj/object";
import { EverseenKnowledge } from "../obj/knowledge";
import { ContentIdResolver } from "../mod/ids";
import { serializeGame } from "./save";
import type { ObjectKind } from "../obj/types";
import { describeObject } from "../game/describe";
import { NOSCORE } from "../game/wizard";
import { loadGame, saveGame, startGame } from "./game";
import type { GamePack, StartedGame } from "./game";
import { decodeSavedGame, encodeSavedGame, SAVE_VERSION } from "./save";
import type { SavedGame } from "./save";

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

  it("round-trips the per-game everseen sets (kind + ego, save.c L397/L533)", () => {
    const game = startGame(pack, { seed: 777, depth: 4 });
    const reg = game.booted.registries;
    const kind = reg.objects.kinds.find((k) => k && k.tval === TV.SWORD)!;
    const ego = reg.objects.egos.find((e) => e && e.name)!;

    /* Mark a kind and an ego as everseen. */
    const everseen = new EverseenKnowledge();
    everseen.markKind(kind);
    everseen.markEgo(ego);

    /* Serialize through serializeGame (the everseen param) + real JSON. */
    const ids = new ContentIdResolver(reg);
    const saved = JSON.parse(
      JSON.stringify(serializeGame(game.state, game.flavor, game.seedFlavor, ids, 0, everseen)),
    ) as SavedGame;
    expect(saved.everseen).toBeDefined();
    expect(saved.everseen!.kinds).toContain(kind.kidx);
    expect(saved.everseen!.egos).toContain(ego.eidx);

    /* Restore into a fresh store and confirm both survive by index. */
    const restored = new EverseenKnowledge();
    restored.restore(saved.everseen!);
    expect(restored.kindSeen(kind)).toBe(true);
    expect(restored.egoSeen(ego)).toBe(true);
    /* An unmarked kind stays unseen. */
    const otherKind = reg.objects.kinds.find((k) => k && k.kidx !== kind.kidx)!;
    expect(restored.kindSeen(otherKind)).toBe(false);
  });

  it("marks everseen in live play (describe) and round-trips it through save/load", () => {
    const game = startGame(pack, { seed: 888, depth: 3, className: "Warrior" });
    const reg = game.booted.registries;

    // Start-item kinds are everseen from birth (player-birth.c L658).
    const startObj = [...game.state.gear.store.values()][0]!;
    expect(game.everseen.kindSeen(startObj.kind)).toBe(true);

    // An aware, non-flavoured kind that is not in the kit is not yet everseen.
    const kind = reg.objects.kinds.find(
      (k) =>
        k.kidx < reg.objects.ordinaryKindCount &&
        game.flavor.isAware(k) &&
        !game.everseen.kindSeen(k) &&
        !(game.state.hasFlavor?.(k) ?? false),
    )!;
    expect(kind).toBeDefined();
    expect(game.everseen.kindSeen(kind)).toBe(false);

    // Describing it in live play marks it everseen (obj-desc.c L637 via
    // knownDescOf's markKindSeen hook).
    const obj = objectNew(kind);
    obj.tval = kind.tval;
    obj.sval = kind.sval;
    obj.number = 1;
    describeObject(game.state, obj);
    expect(game.everseen.kindSeen(kind)).toBe(true);

    // Round-trips through the game-level saveGame/loadGame path.
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    expect(saved.everseen).toBeDefined();
    expect(saved.everseen!.kinds).toContain(kind.kidx);
    expect(saved.everseen!.kinds).toContain(startObj.kind.kidx);
    const rs = loadGame(pack, saved);
    expect(rs.everseen.kindSeen(kind)).toBe(true);
    expect(rs.everseen.kindSeen(startObj.kind)).toBe(true);
  });

  it("round-trips the quest history and the total_winner flag", () => {
    const game = startGame(pack, { seed: 321, depth: 3 });
    const p = game.state.actor.player;
    /* The birth reset seeded the Sauron/Morgoth quests. */
    expect(p.quests).toHaveLength(2);
    /* Simulate a completed first quest and a won game. */
    p.quests[0]!.curNum = 1;
    p.quests[0]!.level = 0;
    p.totalWinner = true;

    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    const rs = loadGame(pack, saved).state;

    expect(rs.actor.player.quests).toEqual(p.quests);
    expect(rs.actor.player.totalWinner).toBe(true);
  });

  it("an old save without a `quests` field loads with no quests", () => {
    const game = startGame(pack, { seed: 321, depth: 3 });
    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    delete saved.player.quests;
    delete saved.player.totalWinner;
    const rs = loadGame(pack, saved).state;
    expect(rs.actor.player.quests).toEqual([]);
    expect(rs.actor.player.totalWinner).toBe(false);
  });

  it("round-trips the character history log (player.hist), incl. a LOST entry", () => {
    const game = startGame(pack, { seed: 555, depth: 5 });
    const p = game.state.actor.player;
    /* Birth already logged HIST_PLAYER_BIRTH; add a level-up, an artifact
     * find and a lost-artifact entry so every shape round-trips. */
    const art = game.booted.registries.objects.artifacts.find(
      (a) => a?.name === "of Galadriel",
    )!;
    const otherArt = game.booted.registries.objects.artifacts.find(
      (a) => a && a.name !== "of Galadriel",
    )!;
    game.state.onArtifactFound?.(art);
    game.state.onArtifactFound?.(otherArt);
    // Manually lose the second artifact (no live trigger site is wired for
    // this in the port yet - see parity/ledger/player-history.yaml) so the
    // LOST rendering/round-trip path is exercised directly.
    p.hist.push({
      type: 0,
      dlev: 1,
      clev: 1,
      aIdx: otherArt.aidx,
      turn: 1,
      event: "Missed something",
    });
    expect(p.hist.length).toBeGreaterThanOrEqual(3);

    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    const restored = loadGame(pack, saved);
    expect(restored.state.actor.player.hist).toEqual(p.hist);
  });

  it("an old save without a `hist` field loads as an empty log", () => {
    const game = startGame(pack, { seed: 555, depth: 5 });
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as {
      player: Record<string, unknown>;
    };
    expect(Array.isArray(saved.player.hist)).toBe(true);
    delete saved.player.hist; // simulate a pre-#56 savefile
    const restored = loadGame(pack, saved as unknown as ReturnType<typeof saveGame>);
    expect(restored.state.actor.player.hist).toEqual([]);
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

  it("bug-fixes #4605: noise/scent persist only with bugfix.noiseScentSave on", () => {
    /* FAITHFUL (flag OFF): the heatmaps are transient and a reload starts them
     * empty, so a live scent trail is lost across save/reload. */
    const faithful = startGame(pack, { seed: 808, depth: 3 });
    playTurns(faithful, 4);
    faithful.state.chunk.scent[
      faithful.state.actor.grid.y * faithful.state.chunk.width +
        faithful.state.actor.grid.x
    ] = 42;
    const savedOff = JSON.parse(JSON.stringify(saveGame(faithful)));
    expect(savedOff.chunk.scent).toBeUndefined();
    expect(savedOff.chunk.noise).toBeUndefined();
    const reOff = loadGame(pack, savedOff).state;
    expect(Array.from(reOff.chunk.scent).every((v) => v === 0)).toBe(true);

    /* CORRECTED (flag ON): the heatmaps ride the save and restore exactly. */
    const fixed = startGame(pack, { seed: 808, depth: 3 });
    fixed.state.modRules = { "bugfix.noiseScentSave": true };
    playTurns(fixed, 4);
    const savedOn = JSON.parse(JSON.stringify(saveGame(fixed)));
    expect(savedOn.chunk.scent).toBeDefined();
    expect(savedOn.chunk.noise).toBeDefined();
    const reOn = loadGame(pack, savedOn).state;
    expect(Array.from(reOn.chunk.scent)).toEqual(Array.from(fixed.state.chunk.scent));
    expect(Array.from(reOn.chunk.noise)).toEqual(Array.from(fixed.state.chunk.noise));
  });

  it("stamped bytes verify and detect tampering", () => {
    const game = startGame(pack, { seed: 7, depth: 1 });
    const bytes = encodeSavedGame(saveGame(game));

    const ok = decodeSavedGame(bytes);
    expect(ok.verified).toBe(true);
    expect(ok.save?.version).toBe(SAVE_VERSION);
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

  it("1.12: a normal birth clears cheat options (options_init_cheat) yet an explicit override survives", () => {
    /* No cheat override: options_init_cheat leaves the score table clean. */
    const clean = startGame(pack, { seed: 91, depth: 2 });
    expect(clean.state.options!.get("cheat_hear")).toBe(false);
    expect(clean.state.options!.anyScoreSet()).toBe(false);

    /* An explicit birth-time cheat override is re-applied AFTER the clear, so it
     * still wins (the port-only seam the maintainer decision preserves). */
    const cheated = startGame(pack, {
      seed: 91,
      depth: 2,
      optionOverrides: { cheat_hear: true },
    });
    expect(cheated.state.options!.get("cheat_hear")).toBe(true);
    expect(cheated.state.options!.get("score_hear")).toBe(true);
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

describe("store + home persistence (store.c wr_stores/rd_stores, gap 12.1/12.2)", () => {
  const dagger = (game: StartedGame): ObjectKind =>
    game.booted.registries.objects.kinds.find(
      (k) => k.name === "& Dagger~" && k.tval === TV.SWORD,
    ) as ObjectKind;

  it("persists the home stash, shop stock and the current owner across save/load", () => {
    const game = startGame(pack, { seed: 4242, depth: 0 });
    const stores = game.state.stores!;
    expect(stores.length).toBeGreaterThan(0);

    /* Stash a dagger in the home (FEAT_HOME) - the gap-12.1 data-loss case. */
    const home = stores.find((s) => s.feat === FEAT.HOME)!;
    const kind = dagger(game);
    const stashed = objectNew(kind);
    stashed.tval = kind.tval;
    stashed.sval = kind.sval;
    stashed.number = 1;
    home.stock.push(stashed);

    /* A stocked non-home shop with a chosen proprietor. */
    const shop = stores.find(
      (s) => s.feat !== FEAT.HOME && s.stock.length > 0,
    )!;
    const shopFeat = shop.feat;
    const ownerIndex = shop.owner.index;
    const shopCount = shop.stock.length;

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    expect(saved.stores).toBeDefined();

    const rs = loadGame(pack, saved).state;
    const rHome = rs.stores!.find((s) => s.feat === FEAT.HOME)!;
    expect(rHome.stock).toHaveLength(1);
    expect(rHome.stock[0]!.kind.name).toBe(kind.name);

    const rShop = rs.stores!.find((s) => s.feat === shopFeat)!;
    expect(rShop.stock).toHaveLength(shopCount);
    expect(rShop.owner.index).toBe(ownerIndex);
  });

  it("round-trips the accrued daycount (store_update, gap 12.3)", () => {
    /* A dungeon save: refreshTownStores leaves daycount untouched (town entry
     * consumes it), so the raw value round-trips. */
    const game = startGame(pack, { seed: 4243, depth: 2 });
    game.state.daycount = 5;
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    expect(saved.daycount).toBe(5);
    const rs = loadGame(pack, saved).state;
    expect(rs.daycount).toBe(5);
  });

  it("an old save without a `stores` field re-stocks fresh on load (back-compat)", () => {
    const game = startGame(pack, { seed: 4244, depth: 0 });
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    delete saved.stores;
    delete saved.daycount;
    const rs = loadGame(pack, saved).state;
    /* In town, refreshTownStores lazily rebuilds the shops. */
    expect(rs.stores).toBeDefined();
    expect(rs.stores!.length).toBeGreaterThan(0);
  });
});

describe("player full_name / died_from / noscore (gaps 12.4/12.5/15.3)", () => {
  it("round-trips full_name, died_from and the noscore mask", () => {
    const game = startGame(pack, { seed: 606, depth: 2 });
    const p = game.state.actor.player;
    p.fullName = "Aranweth";
    p.diedFrom = "a fruit bat";
    p.noscore = NOSCORE.WIZARD | NOSCORE.DEBUG;

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const rp = loadGame(pack, saved).state.actor.player;
    expect(rp.fullName).toBe("Aranweth");
    expect(rp.diedFrom).toBe("a fruit bat");
    expect(rp.noscore).toBe(NOSCORE.WIZARD | NOSCORE.DEBUG);
  });

  it("an old save without the fields loads with clean defaults", () => {
    const game = startGame(pack, { seed: 607, depth: 2 });
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const sp = saved.player as unknown as Record<string, unknown>;
    delete sp.fullName;
    delete sp.diedFrom;
    delete sp.noscore;
    const rp = loadGame(pack, saved).state.actor.player;
    expect(rp.fullName).toBe("");
    expect(rp.diedFrom).toBe("");
    expect(rp.noscore).toBe(0);
  });

  it("wizard-mode load of a dead character resurrects and marks NOSCORE_WIZARD (savefile.c:647-651)", () => {
    const game = startGame(pack, { seed: 608, depth: 2 });
    const p = game.state.actor.player;
    p.chp = 0;
    game.state.isDead = true;
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;

    /* A normal load leaves the dead character dead and unflagged. */
    const normal = loadGame(pack, saved).state;
    expect(normal.isDead).toBe(true);
    expect(normal.actor.player.noscore & NOSCORE.WIZARD).toBe(0);

    /* A wizard-mode load resurrects it (HP refilled) and flags it a cheater. */
    const wiz = loadGame(pack, saved, undefined, { wizard: true }).state;
    expect(wiz.isDead).toBe(false);
    expect(wiz.actor.player.chp).toBe(wiz.actor.player.mhp);
    expect(wiz.actor.player.noscore & NOSCORE.WIZARD).toBe(NOSCORE.WIZARD);
  });
});

describe("autoinscription registry persistence (obj-ignore.c note_aware/note_unaware)", () => {
  const dagger = (game: StartedGame): ObjectKind =>
    game.booted.registries.objects.kinds.find(
      (k) => k.name === "& Dagger~" && k.tval === TV.SWORD,
    ) as ObjectKind;

  it("round-trips per-kind autoinscriptions through save/load", () => {
    const game = startGame(pack, { seed: 777, depth: 2 });
    const kind = dagger(game);
    game.state.autoinscribe!.set(kind.kidx, "@w1", true);
    game.state.autoinscribe!.set(kind.kidx, "@x9", false);

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    expect(saved.autoinscriptions).toBeDefined();
    const restored = loadGame(pack, saved);
    const rk = dagger(restored);
    expect(restored.state.autoinscribe!.get(rk.kidx, true)).toBe("@w1");
    expect(restored.state.autoinscribe!.get(rk.kidx, false)).toBe("@x9");
  });

  it("omits the block entirely when nothing is registered", () => {
    const game = startGame(pack, { seed: 778, depth: 1 });
    expect(saveGame(game).autoinscriptions).toBeUndefined();
  });

  it("a save without the block loads with an empty registry (back-compat)", () => {
    const game = startGame(pack, { seed: 779, depth: 1 });
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    delete saved.autoinscriptions;
    const restored = loadGame(pack, saved);
    expect(restored.state.autoinscribe!.get(dagger(restored).kidx, true)).toBeUndefined();
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

describe("string-id serialization (P7.1) decouples saves from registry order", () => {
  /** A pack whose monster records are reversed, shifting every ridx. */
  function reversedMonsterPack(): GamePack {
    return {
      ...pack,
      mon: { ...pack.mon, monsters: [...pack.mon.monsters].reverse() },
    };
  }

  it("reloads a save against a reordered monster registry to the same races", () => {
    const game = startGame(pack, { seed: 7, depth: 2 });
    playTurns(game, 6);
    const before = game.state.monsters
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) => m.race.name);
    expect(before.length).toBeGreaterThan(0);

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;

    // Loading against the reversed pack: every ridx has shifted, so a numeric
    // r_idx save would resolve to the wrong monsters. String ids must not.
    const reorderedPack = reversedMonsterPack();
    const restored = loadGame(reorderedPack, saved);
    const after = restored.state.monsters
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) => m.race.name);
    expect(after).toEqual(before);

    // Prove the reordering actually moved indices (else the test is vacuous):
    // the same race resolves to a different ridx in the two packs.
    const name = before[0]!;
    const origRidx = game.booted.registries.monsters.races.find(
      (r) => r.name === name,
    )?.ridx;
    const newRidx = restored.booted.registries.monsters.races.find(
      (r) => r.name === name,
    )?.ridx;
    expect(origRidx).toBeDefined();
    expect(newRidx).toBeDefined();
    expect(newRidx).not.toBe(origRidx);
  });

  it("preserves the RNG stream across a reordered-registry reload", () => {
    const game = startGame(pack, { seed: 7, depth: 2 });
    playTurns(game, 6);
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const rngBefore = game.state.rng.getState();

    const restored = loadGame(reversedMonsterPack(), saved);
    // The persisted seeded stream (decision 22) resumes exactly - the
    // anti-save-scum guarantee is independent of content ordering.
    expect(restored.state.rng.getState()).toEqual(rngBefore);
    expect(restored.state.turn).toBe(game.state.turn);
  });
});

describe("mod-lifecycle save blocks (P7.2)", () => {
  it("a core-only game writes a core-only manifest and no orphans/mods", () => {
    const game = startGame(pack, { seed: 111, depth: 2 });
    playTurns(game, 4);
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;

    expect(saved.manifest?.loadOrder).toEqual(["core"]);
    expect(saved.manifest?.determinism).toBe("deterministic");
    /* Clean saves carry no bag / orphan blocks. */
    expect(saved.mods).toBeUndefined();
    expect(saved.orphans).toBeUndefined();

    const restored = loadGame(pack, saved);
    expect(restored.manifest.loadOrder).toEqual(["core"]);
    expect(restored.orphansAcknowledged).toBe(false);
  });

  it("round-trips a per-mod bag verbatim through save and load", () => {
    const game = startGame(pack, { seed: 222, depth: 1 });
    /* A plugin persisted some private state; the engine must not touch it. */
    game.mods = { frost: { schema: 3, data: { seenWyrms: 2, note: "cold" } } };
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;

    expect(saved.mods).toEqual({
      frost: { schema: 3, data: { seenWyrms: 2, note: "cold" } },
    });
    const restored = loadGame(pack, saved);
    expect(restored.mods).toEqual({
      frost: { schema: 3, data: { seenWyrms: 2, note: "cold" } },
    });
  });

  it("quarantines mod-owned content whose pack is absent on load", () => {
    const game = startGame(pack, { seed: 333, depth: 2 });
    playTurns(game, 4);
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;

    /* Forge a save that came from a run with a "frost" pack: a frost object on
     * the floor and the manifest that names the pack. */
    saved.manifest = {
      packs: [
        { id: "core", version: "0.1.0" },
        { id: "frost", version: "1.0.0" },
      ],
      loadOrder: ["core", "frost"],
      determinism: "deterministic",
    };
    saved.floor = [
      ...saved.floor,
      { x: 3, y: 3, objs: [{ kindId: "frost:ice-shard" } as never] },
    ];

    /* Loading against a pack that lacks frost (default present = core only)
     * quarantines the frost object instead of throwing on its unknown kind. */
    const restored = loadGame(pack, saved);
    expect(restored.orphans["frost@1.0.0"]?.[0]?.ref).toBe("frost:ice-shard");
    /* The frost pile is gone from the live floor. */
    const w = restored.state.chunk.width;
    expect(restored.state.floor.has(3 * w + 3)).toBe(false);
  });
});
