import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, FEAT, HIST, RF, TV } from "../generated/index.js";
import { invenCarry } from "../game/gear.js";
import { updatePlayerObjectKnowledge } from "../game/known.js";
import { GLYPH_DECOY } from "../effects/effect.js";
import { sourcePlayer } from "../effects/interpreter.js";
import { attachGameEnv } from "../game/effect-game-env.js";
import { caveFindDecoy } from "../game/effect-mon-origin.js";
import { basicPlayerActor } from "../game/project-cast.js";
import { getLore } from "../mon/lore.js";
import { runGameLoop, LOOP_STATUS } from "../game/loop.js";
import { monsterGroupsVerify } from "../game/mon-group.js";
import type { PlayerCommand } from "../game/context.js";
import { objectNew } from "../obj/object.js";
import { loc } from "../loc.js";
import { buildObjectEffectChain } from "../game/obj-cmd.js";
import type { EffectRecordJson } from "../obj/types.js";
import { EverseenKnowledge } from "../obj/knowledge.js";
import { ContentIdResolver } from "../mod/ids.js";
import { historyAdd } from "../player/history.js";
import { serializeGame, serializeMessages, deserializeMessages } from "./save.js";
import { MessageLog } from "../msg.js";
import type { ObjectKind } from "../obj/types.js";
import { describeObject } from "../game/describe.js";
import { NOSCORE } from "../game/wizard.js";
import { loadGame, saveGame, startGame } from "./game.js";
import type { GamePack, StartedGame } from "./game.js";
import {
  decodeSavedGame,
  deserializeEverseen,
  encodeSavedGame,
  SAVE_VERSION,
} from "./save.js";
import type { SavedGame } from "./save.js";
import type { SaveCodec } from "../save/compress.js";

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
  it("restores a deployed decoy for the live cave_find_decoy path", () => {
    const game = startGame(pack, { seed: 909, depth: 3 });
    const state = game.state;
    const trapDeps = game.wizardBundles.trapDeps;
    expect(trapDeps).toBeDefined();
    const effectEnv = attachGameEnv(
      { rng: state.rng },
      {
        state,
        cast: {
          projections: [],
          maxRange: 20,
          playerActor: basicPlayerActor(state),
        },
        general: { trapDeps: trapDeps! },
      },
    );

    expect(game.effects).toBeDefined();
    expect(
      game.effects!.effectSimple(EF.GLYPH, effectEnv, {
        origin: sourcePlayer(),
        subtype: GLYPH_DECOY,
      }),
    ).toBe(true);
    expect(state.decoy).toBeTruthy();
    expect(caveFindDecoy(state)).toEqual(state.decoy);

    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    const restored = loadGame(pack, saved).state;

    expect(restored.decoy).toEqual(state.decoy);
    expect(caveFindDecoy(restored)).toEqual(state.decoy);
  });

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

  it("rebuilds upkeep->inven and the quiver on load (rd_gear tail, load.c:1187)", () => {
    const game = startGame(pack, { seed: 555, depth: 5, className: "Ranger" });
    const state = game.state;
    /* A Ranger births with a bow and arrows, so both views are non-trivial. */
    const invenBefore = state.gear.inven ?? [];
    const quiverBefore = (state.gear.quiver ?? []).filter((h) => h !== 0);
    expect(invenBefore.length).toBeGreaterThan(0);
    expect(quiverBefore.length).toBeGreaterThan(0);

    const restored = loadGame(pack, JSON.parse(JSON.stringify(saveGame(game))));
    const rs = restored.state;

    /* Neither view is persisted (they are derived), so load has to recompute
     * them or the resumed character shows an empty inventory and empty quiver. */
    expect(rs.gear.pack.length).toBe(state.gear.pack.length);
    expect((rs.gear.inven ?? []).length).toBe(invenBefore.length);
    expect((rs.gear.quiver ?? []).filter((h) => h !== 0).length).toBe(
      quiverBefore.length,
    );
    /* Same objects in the same order, by name. */
    const names = (g: typeof state.gear, list: number[]): string[] =>
      list.map((h) => g.store.get(h)?.kind.name ?? "?");
    expect(names(rs.gear, rs.gear.inven ?? [])).toEqual(
      names(state.gear, invenBefore),
    );
  });

  it("keeps a killed unique dead across a reload (SV-01, load.c:532-535)", () => {
    const game = startGame(pack, { seed: 606, depth: 4, className: "Warrior" });
    const state = game.state;
    const races = game.booted.registries.monsters.races;

    /* Pick two distinct uniques: one gets "killed", one is left alone. */
    const uniques = races.filter((r) => r && r.flags.has(RF.UNIQUE));
    const killed = uniques[0]!;
    const spared = uniques[1]!;
    expect(killed.name).not.toBe(spared.name);

    /* Simulate having killed `killed`: record a player-kill in its lore and
     * make sure no live copy remains on the level (so it is truly gone). */
    getLore(state.lore, killed).pkills = 1;
    for (let i = 1; i < state.monsters.length; i++) {
      const mon = state.monsters[i];
      if (mon && mon.race.ridx === killed.ridx) state.monsters[i] = null;
    }

    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    const restored = loadGame(pack, saved);
    const rRaces = restored.booted.registries.monsters.races;
    const rKilled = rRaces.find((r) => r && r.ridx === killed.ridx)!;
    const rSpared = rRaces.find((r) => r && r.ridx === spared.ridx)!;

    /* The killed unique may never respawn; the untouched one is still alive. */
    expect(rKilled.maxNum).toBe(0);
    expect(rSpared.maxNum).toBe(1);
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
    /* SAVE_VERSION 3: keyed by namespaced id, not raw kidx/eidx. */
    expect(saved.everseen!.kinds).toContain(ids.kindId(kind.kidx));
    expect(saved.everseen!.egos).toContain(ids.egoId(ego.eidx));

    /* Restore into a fresh store and confirm both survive the id round-trip. */
    const restored = new EverseenKnowledge();
    restored.restore(deserializeEverseen(saved.everseen!, ids));
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
    /* SAVE_VERSION 3: keyed by namespaced kind id, not raw kidx. */
    const gameIds = new ContentIdResolver(reg);
    expect(saved.everseen!.kinds).toContain(gameIds.kindId(kind.kidx));
    expect(saved.everseen!.kinds).toContain(gameIds.kindId(startObj.kind.kidx));
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

  it("an old save without a `quests` field loads with the standard quest table", () => {
    /* rd_quests (load.c:636) calls player_quests_reset FIRST and only then
     * overlays the saved level/cur_num, so a save that carries no quest block
     * at all still lands on the game's own quest table. This test used to
     * assert `[]` - a character who could never win - and that was the port's
     * behaviour, not upstream's. */
    const game = startGame(pack, { seed: 321, depth: 3 });
    const fresh = game.state.actor.player.quests.map((q) => ({ ...q }));
    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    delete saved.player.quests;
    delete saved.player.totalWinner;
    const rs = loadGame(pack, saved).state;
    expect(rs.actor.player.quests).toEqual(fresh);
    expect(rs.actor.player.quests.length).toBeGreaterThan(0);
    expect(rs.actor.player.totalWinner).toBe(false);
  });

  it("round-trips the character history log (player.hist), incl. a LOST and raw-note entry", () => {
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
    /* A mod may retain raw user input and ask its display hook to expand it.
     * This is persisted character state, not a display-only transient: losing
     * the marker would make the next load show the raw command text. */
    historyAdd(p, "/say A raw note", HIST.USER_INPUT, 1, 1, 2, true);
    expect(p.hist.length).toBeGreaterThanOrEqual(4);

    const saved = JSON.parse(JSON.stringify(saveGame(game)));
    expect(saved.player.hist.at(-1)).toMatchObject({
      event: "/say A raw note",
      expandUserInput: true,
    });
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

  it("the saveNoiseScent seam decides whether the heatmaps ride the save", () => {
    /*
     * Core's side of the seam only. Persisting noise/scent is the bug-fixes mod's
     * patch (#4605, "bugfix.noiseScentSave"), its code is in the
     * neo-angband-mod-bug-fixes repo and the flag->hook mapping is proven
     * there; core keeps upstream's behaviour, which is to omit them.
     *
     * FAITHFUL (no mod loaded): the heatmaps are transient and a reload starts
     * them empty, so a live scent trail is lost across save/reload. */
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

    /* A MOD ASKS FOR THEM: the heatmaps ride the save and restore exactly. The
     * hook is written inline as the CONTRACT core offers - a hook that returns
     * true is the whole of what a mod has to do here. */
    const fixed = startGame(pack, { seed: 808, depth: 3 });
    fixed.state.modHooks = { saveNoiseScent: () => true };
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

  it("rejects a parsed document without the save header before loading it", () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ version: SAVE_VERSION }));
    const out = decodeSavedGame(bytes);
    expect(out.save).toBeNull();
    expect(out.malformed).toBe(true);
  });

  /* Compression (decision 9's third word). The codec is injected, so these use a
   * reversible stand-in rather than a real compressor: what has to hold is the
   * ENVELOPE contract - a compressed save round trips, an uncompressed one still
   * loads, and a save naming a codec this build lacks is reported as such rather
   * than as damage. */
  describe("compressed saves", () => {
    const flip: SaveCodec = {
      id: "flip",
      compress: (b) => b.map((v) => v ^ 0xff),
      decompress: (b) => b.map((v) => v ^ 0xff),
    };

    it("round trips a real game through a codec", () => {
      const game = startGame(pack, { seed: 31, depth: 2 });
      playTurns(game, 3);
      const bytes = encodeSavedGame(saveGame(game), undefined, flip);

      const out = decodeSavedGame(bytes, undefined, [flip]);
      expect(out.verified).toBe(true);
      expect(out.codecId).toBe("flip");
      expect(out.save?.version).toBe(SAVE_VERSION);
      expect(out.save?.turn).toBe(game.state.turn);
      /* And it really loads: a save that decodes but will not start is no save. */
      expect(loadGame(pack, out.save!).state.turn).toBe(game.state.turn);
    });

    it("reads an uncompressed save written before compression existed", () => {
      /* The version-3 saves already in players' browsers. No codec supplied on
       * either side, which is exactly the old call. */
      const game = startGame(pack, { seed: 32, depth: 1 });
      const out = decodeSavedGame(encodeSavedGame(saveGame(game)));
      expect(out.codecId).toBeNull();
      expect(out.save?.version).toBe(SAVE_VERSION);
    });

    it("reads an uncompressed save even when it HAS a codec", () => {
      /* The upgrade case: a new build must keep loading old saves, not only
       * saves it wrote itself. */
      const game = startGame(pack, { seed: 33, depth: 1 });
      const out = decodeSavedGame(encodeSavedGame(saveGame(game)), undefined, [
        flip,
      ]);
      expect(out.codecId).toBeNull();
      expect(out.save).toBeTruthy();
    });

    it("reports a codec it does not have instead of calling the save corrupt", () => {
      /* The downgrade case: a save from a newer build. Nothing is wrong with the
       * file, and a player told it is damaged might delete a live character. */
      const game = startGame(pack, { seed: 34, depth: 1 });
      const bytes = encodeSavedGame(saveGame(game), undefined, {
        ...flip,
        id: "from-the-future",
      });
      const out = decodeSavedGame(bytes, undefined, [flip]);
      expect(out.save).toBeNull();
      expect(out.unknownCodec).toBe("from-the-future");
      /* Still stamped and still intact - the bytes are fine. */
      expect(out.verified).toBe(true);
    });

    it("still detects tampering inside a compressed save", () => {
      /* The digest is taken AFTER compression, so it covers what is stored. */
      const game = startGame(pack, { seed: 35, depth: 1 });
      const bytes = encodeSavedGame(saveGame(game), undefined, flip);
      const tampered = Uint8Array.from(bytes);
      tampered[200] = (tampered[200]! + 1) & 0xff;
      expect(decodeSavedGame(tampered, undefined, [flip]).verified).toBe(false);
    });

    it("reports a codec that cannot read the bytes as a failed load", () => {
      const game = startGame(pack, { seed: 36, depth: 1 });
      const bytes = encodeSavedGame(saveGame(game), undefined, flip);
      const throwing: SaveCodec = {
        id: "flip",
        compress: flip.compress,
        decompress: () => {
          throw new Error("not my bytes");
        },
      };
      const out = decodeSavedGame(bytes, undefined, [throwing]);
      expect(out.save).toBeNull();
      expect(out.unknownCodec).toBeUndefined();
    });
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

  it("persists the terrain-only Town chunk after leaving town (wr_chunks)", () => {
    /* Non-persist: leave depth 0 stores townChunk; dungeon save must carry it. */
    const game = startGame(pack, { seed: 5150, depth: 0 });
    expect(game.state.chunk.depth).toBe(0);
    expect(game.state.options?.get("birth_levels_persist") ?? false).toBe(false);
    game.changeLevel(1);
    expect(game.state.chunk.depth).toBe(1);
    expect(game.state.townChunk).toBeTruthy();
    const townFeats = Array.from(game.state.townChunk!.snapshotSquares().feats);

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    expect(saved.townChunk).toBeDefined();
    expect(saved.townChunk!.feats).toEqual(townFeats);

    const rs = loadGame(pack, saved).state;
    expect(rs.townChunk).toBeTruthy();
    expect(Array.from(rs.townChunk!.snapshotSquares().feats)).toEqual(townFeats);
    expect(rs.townChunk!.name).toBe("Town");
  });
});

describe("player full_name / died_from / noscore (gaps 12.4/12.5/15.3)", () => {
  it("round-trips full_name, died_from and the noscore mask", () => {
    const game = startGame(pack, { seed: 606, depth: 2 });
    const p = game.state.actor.player;
    p.fullName = "Aranweth";
    /* load.c:791-793 preserves died_from only for a dead (negative-HP) save. */
    p.chp = -1;
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
    /* load.c:791-793 repairs an alive save's cause to this exact string. */
    expect(rp.diedFrom).toBe("(alive and well)");
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

  it("a random artifact stays known as created, seen and everseen after a reload", () => {
    const game = startGame(pack, {
      seed: 88,
      depth: 2,
      optionOverrides: { birth_randarts: true },
    });
    expect(game.randartSeed).not.toBe(0);

    const aidx = 3;
    const art = game.booted.registries.objects.artifacts[aidx]!;
    game.state.artifacts!.markCreated(aidx, true);
    game.state.artifacts!.markSeen(aidx, true);
    game.state.artifacts!.markEverseen(aidx, true);

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const restored = loadGame(pack, saved);

    /* The rebuilt set is the same set, so the flags describe the same artifact. */
    expect(restored.booted.registries.objects.artifacts[aidx]?.name).toBe(art.name);
    expect(restored.state.artifacts!.isCreated(aidx)).toBe(true);
    expect(restored.state.artifacts!.isSeen(aidx)).toBe(true);
    expect(restored.state.artifacts!.isEverseen(aidx)).toBe(true);
  });

  it("keeps those same flags with the standard artifact set (randarts off)", () => {
    const game = startGame(pack, { seed: 88, depth: 2 });
    expect(game.randartSeed).toBe(0);

    const aidx = 3;
    game.state.artifacts!.markCreated(aidx, true);
    game.state.artifacts!.markSeen(aidx, true);
    game.state.artifacts!.markEverseen(aidx, true);

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const restored = loadGame(pack, saved);
    expect(restored.state.artifacts!.isCreated(aidx)).toBe(true);
    expect(restored.state.artifacts!.isSeen(aidx)).toBe(true);
    expect(restored.state.artifacts!.isEverseen(aidx)).toBe(true);
  });

  it("a carried random artifact is still that artifact after a reload", () => {
    const game = startGame(pack, {
      seed: 91,
      depth: 2,
      optionOverrides: { birth_randarts: true },
    });
    const reg = game.booted.registries;
    const art = reg.objects.artifacts[3]!;
    const kind = reg.objects.kinds.find(
      (k) => k && k.tval === art.tval && k.sval === art.sval,
    )!;
    const obj = objectNew(kind);
    obj.tval = kind.tval;
    obj.sval = kind.sval;
    obj.number = 1;
    obj.artifact = art;
    const handle = invenCarry(game.state.gear, game.state.actor.player, obj, {
      quiverSlotSize: reg.constants.quiverSlotSize,
      thrownQuiverMult: reg.constants.thrownQuiverMult,
    });

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const restored = loadGame(pack, saved);
    expect(restored.state.gear.store.get(handle)?.artifact?.name).toBe(art.name);
  });
});

describe("minor persisted player fields (gap 12.6, wr_player)", () => {
  it("round-trips resting_turn / skip_cmd_coercion / unignoring / name_suffix through serializeGame", () => {
    const game = startGame(pack, { seed: 12, depth: 2 });
    game.state.restingTurn = 37;
    game.state.skipCmdCoercion = 2;
    game.state.unignoring = 1;
    game.state.nameSuffix = 3;

    const ids = new ContentIdResolver(game.booted.registries);
    const saved = JSON.parse(
      JSON.stringify(
        serializeGame(game.state, game.flavor, game.seedFlavor, ids, 0, game.everseen),
      ),
    ) as SavedGame;

    expect(saved.restingTurn).toBe(37);
    expect(saved.skipCmdCoercion).toBe(2);
    expect(saved.unignoring).toBe(1);
    expect(saved.nameSuffix).toBe(3);
  });

  it("omits the minor player fields when at their defaults (a clean save stays clean)", () => {
    const game = startGame(pack, { seed: 13, depth: 2 });
    const ids = new ContentIdResolver(game.booted.registries);
    const saved = serializeGame(
      game.state,
      game.flavor,
      game.seedFlavor,
      ids,
      0,
      game.everseen,
    );
    expect(saved.restingTurn).toBeUndefined();
    expect(saved.skipCmdCoercion).toBeUndefined();
    expect(saved.unignoring).toBeUndefined();
    expect(saved.nameSuffix).toBeUndefined();
  });
});

describe("running message-log persistence (gap 12.8, wr_messages/rd_messages)", () => {
  it("round-trips the log oldest-first, newest preserved (save.c:349 order)", () => {
    const log = new MessageLog();
    log.add("a", 0);
    log.add("b", 1);
    log.add("c", 0);

    const data = serializeMessages(log);
    /* Serialized oldest-first, exactly as wr_messages writes them. */
    expect(data).toEqual([
      { str: "a", type: 0 },
      { str: "b", type: 1 },
      { str: "c", type: 0 },
    ]);

    const restored = deserializeMessages(data);
    expect(restored.num()).toBe(3);
    /* Newest is age 0 after the reload (message_add prepends). */
    expect(restored.str(0)).toBe("c");
    expect(restored.type(1)).toBe(1);
    expect(restored.str(2)).toBe("a");
  });

  it("an empty or absent log serializes to nothing and restores empty", () => {
    expect(serializeMessages(new MessageLog())).toBeUndefined();
    expect(serializeMessages(undefined)).toBeUndefined();
    expect(deserializeMessages(undefined).num()).toBe(0);
  });

  it("caps the dump at the 80 newest messages (save.c:345)", () => {
    const log = new MessageLog();
    for (let i = 0; i < 100; i++) log.add(`m${i}`, 0);

    const data = serializeMessages(log)!;
    expect(data.length).toBe(80);
    /* The 80 newest (m20..m99), oldest-of-the-kept first. */
    expect(data[0]).toEqual({ str: "m20", type: 0 });
    expect(data[79]).toEqual({ str: "m99", type: 0 });

    const restored = deserializeMessages(data);
    expect(restored.num()).toBe(80);
    expect(restored.str(0)).toBe("m99");
    expect(restored.str(79)).toBe("m20");
  });

  it("does not persist repeat counts (upstream quirk: reload resets counts to 1)", () => {
    const log = new MessageLog();
    log.add("boom", 0);
    log.add("boom", 0);
    log.add("boom", 0);
    /* Live: one collapsed entry with count 3. */
    expect(log.num()).toBe(1);
    expect(log.count(0)).toBe(3);

    /* wr_messages writes only str+type, so the count is lost across a reload. */
    const restored = deserializeMessages(serializeMessages(log));
    expect(restored.num()).toBe(1);
    expect(restored.count(0)).toBe(1);
  });

  it("serializeGame carries the message block from GameState.messages", () => {
    const game = startGame(pack, { seed: 99, depth: 2 });
    const log = new MessageLog();
    log.add("You hit the kobold.", 0);
    game.state.messages = log;

    const ids = new ContentIdResolver(game.booted.registries);
    const saved = JSON.parse(
      JSON.stringify(
        serializeGame(game.state, game.flavor, game.seedFlavor, ids, 0, game.everseen),
      ),
    ) as SavedGame;

    expect(saved.messages).toEqual([{ str: "You hit the kobold.", type: 0 }]);
    const restored = deserializeMessages(saved.messages);
    expect(restored.str(0)).toBe("You hit the kobold.");
  });

  it("omits the message block entirely when the log is empty", () => {
    const game = startGame(pack, { seed: 100, depth: 2 });
    game.state.messages = new MessageLog();
    const ids = new ContentIdResolver(game.booted.registries);
    const saved = serializeGame(
      game.state,
      game.flavor,
      game.seedFlavor,
      ids,
      0,
      game.everseen,
    );
    expect(saved.messages).toBeUndefined();
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

describe("rune auto-inscriptions (wr_ignore save.c:586-605 / rd_ignore load.c:937-945)", () => {
  it("round-trips every rune note through save/load", () => {
    const game = startGame(pack, { seed: 4242, depth: 2 });
    expect(game.state.runeNotes).toBeTruthy();
    /* rune_set_note(i, inscription) (obj-knowledge.c:414). Upstream writes every
     * rune whose note is set, with no player_knows_rune gate. */
    game.state.runeNotes!.set(0, "{ac}");
    game.state.runeNotes!.set(4, "{str}");

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    expect(saved.runeNotes).toBeDefined();
    /* Keyed by runeKey, not the raw wr_s16b index. */
    expect(saved.runeNotes!.map(([k]) => k)).toEqual(["combat:enchantment to armor", "mod:intelligence"]);

    const rs = loadGame(pack, saved);
    expect(rs.state.runeNotes!.get(0)).toBe("{ac}");
    expect(rs.state.runeNotes!.get(4)).toBe("{str}");
    /* rune_set_note(i, NULL) is the only thing that clears a slot; an untouched
     * rune stays noteless. */
    expect(rs.state.runeNotes!.get(1)).toBeUndefined();
  });

  it("omits the block entirely when no rune carries a note", () => {
    const game = startGame(pack, { seed: 4243, depth: 2 });
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    expect(saved.runeNotes).toBeUndefined();
    /* A save without the block loads with no rune notes (back-compat). */
    const rs = loadGame(pack, saved);
    expect(rs.state.runeNotes!.entries()).toEqual([]);
  });

  it("survives a MUTATED reload: the reader does not ignore the field", () => {
    const game = startGame(pack, { seed: 4244, depth: 2 });
    game.state.runeNotes!.set(0, "{ac}");
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    saved.runeNotes![0]![1] = "{mutated}";
    const rs = loadGame(pack, saved);
    expect(rs.state.runeNotes!.get(0)).toBe("{mutated}");
    const resaved = JSON.parse(JSON.stringify(saveGame(rs))) as SavedGame;
    expect(resaved.runeNotes).toEqual([["combat:enchantment to armor", "{mutated}"]]);
  });

  it("runes_autoinscribe stamps the note on a carried object (obj-ignore.c:217-225)", () => {
    const game = startGame(pack, { seed: 4245, depth: 2, className: "Warrior" });
    const state = game.state;
    /* Learn every rune so player_knows_rune is satisfied, then give the +AC
     * rune a note and let apply_autoinscription run over the pack. */
    const armour = [...state.gear.store.values()].find((o) => o.toA !== 0);
    const target = armour ?? [...state.gear.store.values()][0]!;
    target.toA = 2;
    target.note = null;
    state.actor.player.objKnown.toA = 1;
    state.runeNotes!.set(0, "{ac}");
    state.autoinscribeAll?.();
    expect(target.note).toBe("{ac}");
    /* rune_add_autoinscription is idempotent: strstr(obj->note, note) hits
     * (obj-ignore.c:176), so a second pass does not append it twice. */
    state.autoinscribeAll?.();
    expect(target.note).toBe("{ac}");
  });
});

describe("apply_autoinscription's other call sites (store.c:1977 / obj-knowledge.c:1246)", () => {
  it("selling part of a stack autoinscribes the remainder, and stashing does not", () => {
    const game = startGame(pack, { seed: 6100, depth: 0 });
    const state = game.state;
    const reg = game.booted.registries;
    const stores = state.stores ?? [];
    expect(stores.length).toBeGreaterThan(0);

    /* A non-Home store that will buy a stack of flasks of oil. */
    const flask = reg.objects.kinds.find((k) => k && k.name === "& Flask~ of oil")!;
    state.autoinscribe!.set(flask.kidx, "@v1", true);

    const shop = stores.find((st) => st.feat !== FEAT.HOME)!;
    const home = stores.find((st) => st.feat === FEAT.HOME)!;

    const mk = (): number => {
      const obj = objectNew(flask);
      obj.tval = flask.tval;
      obj.sval = flask.sval;
      obj.number = 3;
      obj.note = null;
      return invenCarry(state.gear, state.actor.player, obj, {
        quiverSlotSize: reg.constants.quiverSlotSize,
        thrownQuiverMult: reg.constants.thrownQuiverMult,
      });
    };

    /* do_cmd_stash (store.c:2009) has NO apply_autoinscription call. */
    const stashed = mk();
    const stashRes = game.sell(home, stashed, 1);
    expect(stashRes.ok).toBe(true);
    expect(state.gear.store.get(stashed)?.note ?? null).toBeNull();

    /* do_cmd_sell (store.c:1976-1977) does, on the remaining stack. */
    const forSale = mk();
    const sellRes = game.sell(shop, forSale, 1);
    if (sellRes.ok && sellRes.noneLeft === false) {
      expect(state.gear.store.get(forSale)?.note).toBe("@v1");
    } else {
      /* The chosen shop refused the item: the assertion above would be vacuous,
       * so fail loudly rather than pass silently. */
      throw new Error(`the fixture shop refused the sale: ${JSON.stringify(sellRes)}`);
    }
  });

  it("update_player_object_knowledge tail-calls autoinscribe_ground + _pack (:1245-1247)", () => {
    const game = startGame(pack, { seed: 6101, depth: 2, className: "Warrior" });
    const state = game.state;
    const target = [...state.gear.store.values()][0]!;
    target.toA = 2;
    target.note = null;
    state.actor.player.objKnown.toA = 1;
    state.runeNotes!.set(0, "{ac}");
    /* Nothing has stamped it yet... */
    expect(target.note).toBeNull();
    /* ...and learning object knowledge does, through the C tail call. */
    updatePlayerObjectKnowledge(state);
    expect(target.note).toBe("{ac}");
  });
});

describe("ignore / aware state is keyed by content id, not raw index", () => {
  /** A pack whose object records are reversed, shifting every kidx. */
  function reversedKindPack(): GamePack {
    return {
      ...pack,
      obj: {
        ...pack.obj,
        object: {
          ...pack.obj.object,
          records: [...pack.obj.object.records].reverse(),
        },
      },
    };
  }

  it("writes ids for flavor.aware/tried, everseen and the ignore choices", () => {
    const game = startGame(pack, { seed: 5150, depth: 2 });
    const reg = game.booted.registries;
    const kind = reg.objects.kinds.find((k) => k && k.tval === TV.SWORD)!;
    const ego = reg.objects.egos.find((e) => e && e.name)!;
    game.state.ignore.kindIgnoreWhenAware(kind.kidx);
    game.state.ignore.kindIgnoreWhenUnaware(kind.kidx);
    game.state.ignore.egoToggle(ego.eidx, 1);

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const ids = new ContentIdResolver(reg);
    const kindId = ids.kindId(kind.kidx);
    expect(saved.ignore!.kindAware).toContain(kindId);
    expect(saved.ignore!.kindUnaware).toContain(kindId);
    expect(saved.ignore!.ego).toContainEqual([ids.egoId(ego.eidx), 1]);
    /* Nothing numeric is left in the aware/everseen blocks either. */
    for (const v of [...saved.flavor.aware, ...saved.flavor.tried]) {
      expect(typeof v).toBe("string");
    }
  });

  it("reloads against a reordered kind registry onto the SAME items", () => {
    const game = startGame(pack, { seed: 5151, depth: 2 });
    const reg = game.booted.registries;
    const kind = reg.objects.kinds.find((k) => k && k.tval === TV.SWORD)!;
    const kindName = kind.name;
    game.state.ignore.kindIgnoreWhenAware(kind.kidx);
    const awareBefore = [...reg.objects.kinds]
      .filter((k) => k && game.state.flavorKnown!.isAware(k))
      .map((k) => k!.name)
      .sort();

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const reordered = reversedKindPack();
    const rs = loadGame(reordered, saved);
    const rreg = rs.booted.registries;
    const movedKind = rreg.objects.kinds.find((k) => k && k.name === kindName)!;
    /* The reordering really moved the index, else the test is vacuous. */
    expect(movedKind.kidx).not.toBe(kind.kidx);
    /* The player's ignore choice followed the ITEM, not the index. */
    expect(rs.state.ignore.kindIsIgnoredAware(movedKind.kidx)).toBe(true);
    expect(rs.state.ignore.kindIsIgnoredAware(kind.kidx)).toBe(false);
    /* ...and so did every aware flavour. */
    const awareAfter = [...rreg.objects.kinds]
      .filter((k) => k && rs.state.flavorKnown!.isAware(k))
      .map((k) => k!.name)
      .sort();
    expect(awareAfter).toEqual(awareBefore);
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
      modNoscore: false,
    };
    saved.floor = [
      ...saved.floor!,
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

  /**
   * load.c:1419 restores a floor pile with pile_insert_end, appending each read
   * object - so a saved pile comes back in EXACTLY its saved order. The port
   * stores a pile as an array and deserializeFloor maps it 1:1, and its comment
   * says "pile order preserved", but nothing asserted it. PORT_TODO 2.7's fourth
   * pile_insert_end site.
   */
  it("a floor pile comes back in its saved order (load.c:1419)", () => {
    const game = startGame(pack, { seed: 909, depth: 2 });
    playTurns(game, 2);
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;

    /* Derive the fixture from the save itself: find a real pile with more than
     * one object, so the order assertion has something to be wrong about. A
     * single-object pile would pass whatever the code did. */
    const multi = (saved.floor ?? []).find((e) => (e.objs?.length ?? 0) > 1);
    if (!multi) {
      /* Rather than a silent skip: build one, from kinds already in the save. */
      const donor = (saved.floor ?? []).filter((e) => (e.objs?.length ?? 0) === 1);
      expect(donor.length, "fixture: at least two single-object piles").toBeGreaterThan(1);
      const first = donor[0]!;
      first.objs = [first.objs[0]!, donor[1]!.objs[0]!];
      donor[1]!.objs = [];
    }
    const target = (saved.floor ?? []).find((e) => (e.objs?.length ?? 0) > 1)!;
    const expected = target.objs.map((o) => (o as { kindId?: string }).kindId);
    expect(expected.length, "fixture: a pile deeper than one").toBeGreaterThan(1);

    const restored = loadGame(pack, saved);
    const w = restored.state.chunk.width;
    const pile = restored.state.floor.get(target.y * w + target.x);
    expect(pile, "the pile survived the round trip").toBeDefined();

    /* Re-save and read the SAME projection back, so the comparison is against
     * the saved order rather than against the restored pile itself. (The first
     * draft of this asserted `pile.map(...)` toEqual `pile.map(...)` - a
     * tautology that cannot fail whatever the loader does.) A reversed restore -
     * a prepend-per-read loop, the natural way to get load.c:1419 wrong - fails
     * here. */
    const resaved = JSON.parse(JSON.stringify(saveGame(restored))) as SavedGame;
    const back = (resaved.floor ?? []).find(
      (e) => e.x === target.x && e.y === target.y,
    );
    expect(back, "the pile is still at its grid after a re-save").toBeDefined();
    expect(back!.objs.map((o) => (o as { kindId?: string }).kindId)).toEqual(
      expected,
    );
    expect(pile!.length).toBe(expected.length);
  });
});

describe("the remembered floor pile (game/known.ts KnownObject)", () => {
  /**
   * Put a potion on the floor and remember it, the way square_know_pile does:
   * a remembered object IS the live object, so the save has to carry identity
   * and not a copy of its kind.
   */
  function rememberPotion(game: StartedGame): { idx: number; kind: ObjectKind } {
    const kind = game.booted.registries.objects.kinds.find(
      (k) => k.tval === TV.POTION,
    ) as ObjectKind;
    const idx = 5 * game.state.chunk.width + 7;
    const obj = objectNew(kind);
    obj.tval = kind.tval;
    obj.sval = kind.sval;
    obj.number = 1;
    obj.grid = loc(7, 5);
    game.state.floor.set(idx, [obj]);
    game.state.known.objects.set(idx, [{ obj, sensed: false }]);
    return { idx, kind };
  }

  it("a restored memory IS the restored floor object, not a copy of it", () => {
    /* The whole reason the saved form is a locator. forget_remembered_objects
     * compares the memory against the grid's pile BY IDENTITY, so a memory
     * restored as a lookalike would be excised the first time the player
     * looked at the grid - the pile would forget itself on sight. */
    const game = startGame(pack, { seed: 909, depth: 2 });
    const { idx, kind } = rememberPotion(game);

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const restored = loadGame(pack, saved);

    const pile = restored.state.known.objects.get(idx)!;
    expect(pile).toHaveLength(1);
    expect(pile[0]!.sensed).toBe(false);
    expect(pile[0]!.obj.kind.kidx).toBe(kind.kidx);
    /* The identity claim, which a kind comparison cannot make. */
    expect(pile[0]!.obj).toBe(restored.state.floor.get(idx)![0]);
  });

  it("stores a locator into the saved floor, not the kind", () => {
    const game = startGame(pack, { seed: 910, depth: 2 });
    const { idx } = rememberPotion(game);

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const entry = saved.known!.objects.find(([i]) => i === idx)!;

    expect(entry[1]).toHaveLength(1);
    expect(entry[1][0]!.at).toEqual([idx, 0]);
    expect(entry[1][0]!.kindId).toBeUndefined();
  });

  it("a whole pile round-trips, in order, with its sensed flags", () => {
    const game = startGame(pack, { seed: 911, depth: 2 });
    const reg = game.booted.registries.objects;
    const potion = reg.kinds.find((k) => k.tval === TV.POTION) as ObjectKind;
    const scroll = reg.kinds.find((k) => k.tval === TV.SCROLL) as ObjectKind;
    const idx = 4 * game.state.chunk.width + 9;
    const objs = [potion, scroll].map((kind) => {
      const o = objectNew(kind);
      o.tval = kind.tval;
      o.sval = kind.sval;
      o.number = 1;
      o.grid = loc(9, 4);
      return o;
    });
    game.state.floor.set(idx, objs);
    game.state.known.objects.set(idx, [
      { obj: objs[0]!, sensed: false },
      { obj: objs[1]!, sensed: true },
    ]);

    const restored = loadGame(pack, JSON.parse(JSON.stringify(saveGame(game))));

    const pile = restored.state.known.objects.get(idx)!;
    expect(pile.map((e) => e.sensed)).toEqual([false, true]);
    expect(pile.map((e) => e.obj.kind.kidx)).toEqual([potion.kidx, scroll.kidx]);
    expect(pile.map((e) => e.obj)).toEqual(restored.state.floor.get(idx));
  });

  it("a memory whose object has left the floor survives as a detached one", () => {
    /* Upstream keeps such a shadow until the grid is re-seen (the original is
     * gone but the memory is not), so the locator is dropped and the kind is
     * written instead. */
    const game = startGame(pack, { seed: 912, depth: 2 });
    const { idx, kind } = rememberPotion(game);
    /* Somebody picked it up, out of the player's view. */
    game.state.floor.delete(idx);

    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    expect(saved.known!.objects.find(([i]) => i === idx)![1][0]!.at).toBeUndefined();

    const restored = loadGame(pack, saved);
    const pile = restored.state.known.objects.get(idx)!;
    expect(pile).toHaveLength(1);
    expect(pile[0]!.obj.kind.kidx).toBe(kind.kidx);
    expect(restored.state.floor.get(idx)).toBeUndefined();
  });

  it("a kind the pack no longer binds is forgotten rather than drawn as nothing", () => {
    const game = startGame(pack, { seed: 913, depth: 2 });
    const { idx } = rememberPotion(game);
    game.state.floor.delete(idx); // force the kind fallback
    const saved = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    saved.known!.objects.find(([i]) => i === idx)![1][0]!.kindId = "mod:gone/potion";

    const restored = loadGame(pack, saved);

    expect(restored.state.known.objects.get(idx)).toBeUndefined();
  });
});

describe("effect subtypes a caller forgot to inject (GameState.effectInject)", () => {
  /**
   * Reading an unidentified Scroll of Summon Monster threw
   * `invalid subtype "ANY" for effect "SUMMON" (PARSE_ERROR_INVALID_VALUE)`
   * mid-turn, on 0.18.1-edge.12.
   *
   * The subtype resolvers live outside the effect module (summon names come from
   * the monster registry), so EffectBuilder takes them as injections. An object's
   * chain is rebuilt from raw records on every use AND every inspect, across a
   * dozen call sites - and the ones that called the two-argument
   * buildObjectEffectChain had no resolvers at all. `SUMMON:ANY` is the first
   * entry in summon.txt and it is on a level-1 scroll, so this was reachable in
   * the first five minutes of any game.
   */
  it("resolves SUMMON:ANY with no inject argument at all", () => {
    const game = startGame(pack, { seed: 4242, depth: 1 });
    const kind = game.booted.registries.objects.kinds.find(
      (k) => k.name === "Summon Monster",
    ) as ObjectKind;
    expect(kind).toBeDefined();
    const records = kind.effect as EffectRecordJson[] | undefined;
    expect(records?.[0]?.type).toBe("ANY");

    /* The two-argument form: exactly what the read and inspect paths used. */
    const chain = buildObjectEffectChain(records!, game.state);

    expect(chain).not.toBeNull();
    /* ANY is summon.txt's first entry, so its index is 0 - and 0 is precisely
     * the value a `< 0` check accepts, which is why asserting "did not throw"
     * alone would be a weaker test than asserting the resolved subtype. */
    expect(chain?.subtype).toBe(0);
  });

  it("an explicitly passed resolver still wins over the wired one", () => {
    const game = startGame(pack, { seed: 4243, depth: 1 });
    const kind = game.booted.registries.objects.kinds.find(
      (k) => k.name === "Summon Undead",
    ) as ObjectKind;
    const records = kind.effect as EffectRecordJson[];

    const chain = buildObjectEffectChain(records, game.state, {
      summonNameToIdx: () => 7,
    });

    expect(chain?.subtype).toBe(7);
  });
});
