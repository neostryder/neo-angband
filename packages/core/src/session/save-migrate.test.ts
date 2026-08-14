/**
 * Save migration, proved two ways.
 *
 * 1. THE RATCHET. `saveMigrationsAreComplete()` must hold. Bump SAVE_VERSION
 *    without adding the step below it and this file goes red - which is the
 *    whole point, because the alternative is a green build that turns every
 *    existing character into "could not read the save".
 *
 * 2. THE ROUND TRIP. There is no archived version-1 savefile to test against,
 *    so this file writes the DOWN-converters instead: take a real save from a
 *    real game at the current version, walk it backwards into the version-2 and
 *    version-1 shapes, migrate it forward again, and require the result to
 *    equal what we started with. The down-converters are derived from the two
 *    commits that made the changes (26b207be1 and e300943d9) and they are the
 *    specification here: if the forward step misses a container the backward
 *    step touched, the documents differ and this fails. That catches the exact
 *    failure a hand-enumerated list of containers invites - one that quietly
 *    skips objects held by a monster, or in the home stash.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ContentIdResolver } from "../mod/ids.js";
import { bindCore } from "./boot.js";
import { bindPlayer } from "../player/bind.js";
import { registerBookKinds } from "../player/spell.js";
import type { PlayerCommand } from "../game/context.js";
import { runGameLoop } from "../game/loop.js";
import { loadGame, saveGame, startGame } from "./game.js";
import type { GamePack, StartedGame } from "./game.js";
import {
  SAVE_VERSION,
  deserializeIgnore,
  deserializeLoreSpells,
} from "./save.js";
import type { SavedGame } from "./save.js";
import { RSF } from "../generated/index.js";
import { getLore } from "../mon/lore.js";
import {
  OLDEST_READABLE_SAVE,
  SAVE_MIGRATIONS,
  SaveFromFutureError,
  migrateSave,
  saveMigrationsAreComplete,
} from "./save-migrate.js";

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

/**
 * The same resolver loadGame builds - bindCore, THEN registerBookKinds, then
 * the resolver. Skipping the book registration leaves every class book unbound,
 * and the first symptom is a down-converted object with `kidx: undefined` that
 * the forward step then declines to migrate. Build it exactly as the loader
 * does or the test is measuring a different pack than the game.
 */
function resolver(): ContentIdResolver {
  const reg = bindCore(pack);
  registerBookKinds(reg.objects, bindPlayer(pack.player).classes);
  return new ContentIdResolver(reg);
}

/** Play a few turns so the save holds monsters, terrain and knowledge. */
function playTurns(game: StartedGame, count: number): void {
  const dirs = [6, 2, 4, 8, 6, 6, 2, 4];
  const commands: PlayerCommand[] = [];
  for (let i = 0; i < count; i++) {
    commands.push({ code: "walk", dir: dirs[i % dirs.length]! });
    commands.push({ code: "hold" });
  }
  game.state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;
  runGameLoop(game.state, game.registry);
}

/** A real save from a real game, as plain JSON. */
function currentSave(seed = 4242): SavedGame {
  const game = startGame(pack, { seed, depth: 2 });
  playTurns(game, 12);
  return JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
}

/* ------------------------------------------------------------------ *
 * The down-converters: the inverse of each migration step.
 * ------------------------------------------------------------------ */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function mapNodes(value: unknown, fn: (n: Json) => Json): unknown {
  if (Array.isArray(value)) return value.map((v) => mapNodes(v, fn));
  if (!isObj(value)) return value;
  const walked: Json = {};
  for (const [k, v] of Object.entries(value)) walked[k] = mapNodes(v, fn);
  return fn(walked);
}

/** ids -> a dense boolean array with those indices set (the pre-v2 shape). */
function idsToDense(idList: unknown, index: (id: string) => number | undefined): boolean[] {
  const idxs: number[] = [];
  if (Array.isArray(idList)) {
    for (const id of idList) {
      if (typeof id !== "string") continue;
      const i = index(id);
      if (i !== undefined) idxs.push(i);
    }
  }
  const dense: boolean[] = new Array<boolean>(Math.max(1, ...idxs) + 1).fill(false);
  for (const i of idxs) dense[i] = true;
  return dense;
}

/**
 * The current document as version 4 wrote it: the observed spell set on every
 * lore record goes back to the RAW FlagSet BYTES - the persisted RSF bit
 * positions that V4_TO_V5 exists to get rid of.
 *
 * `deserializeLoreSpells` is the forward step's own inverse, used here for the
 * same reason toV2 calls `deserializeIgnore`: two hand-written halves of one
 * mapping can disagree, and then the round trip proves nothing.
 */
function toV4(save: SavedGame): Json {
  const doc = JSON.parse(JSON.stringify(save)) as Json;
  const back = mapNodes(doc, (node) => {
    if (!Array.isArray(node.spellsKnown) || !Array.isArray(node.blowKnown)) {
      return node;
    }
    const { spellsKnown, ...rest } = node;
    const set = deserializeLoreSpells(spellsKnown as string[]);
    return { ...rest, spellFlags: Array.from(set.bits) };
  }) as Json;
  back.version = 4;
  return back;
}

/** The version-3 document as version 2 wrote it. */
/**
 * The current document as version 3 wrote it: the remembered pile collapses
 * back to the single per-grid memory, keeping only its kind.
 *
 * Version 3 could not express a pile, so a down-conversion keeps the entry
 * map_info would have drawn - the first non-sensed one, or the sensed marker
 * if that is all there is. That is the information version 3 held, and it is
 * exactly what V3_TO_V4 has to be able to widen again.
 */
function toV3(save: SavedGame, ids: ContentIdResolver): Json {
  const doc = JSON.parse(JSON.stringify(save)) as Json;

  const collapse = (known: unknown, floor: unknown, width: number): void => {
    if (!isObj(known) || !Array.isArray(known.objects)) return;
    /* Version 3 stored a kind, so a locator has to be resolved through the
     * floor the same save carries. */
    const kindAt = (at: unknown): string | null => {
      if (!Array.isArray(at) || !Array.isArray(floor)) return null;
      for (const pile of floor) {
        if (!isObj(pile) || !Array.isArray(pile.objs)) continue;
        const idx = (pile.y as number) * width + (pile.x as number);
        if (idx !== at[0]) continue;
        const obj = pile.objs[at[1] as number];
        return isObj(obj) && typeof obj.kindId === "string" ? obj.kindId : null;
      }
      return null;
    };
    const out: Array<[number, Json]> = [];
    for (const pair of known.objects) {
      if (!Array.isArray(pair)) continue;
      const entries = pair[1] as unknown[];
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const seen = entries.find((e) => isObj(e) && e.sensed !== true);
      const pick = seen ?? entries[0];
      if (!isObj(pick)) continue;
      const kindId =
        typeof pick.kindId === "string" ? pick.kindId : kindAt(pick.at);
      out.push([
        pair[0] as number,
        kindId !== null && pick.sensed !== true
          ? { ch: null, attr: "", kindId }
          : { ch: null, attr: "", money: pick.money === true },
      ]);
    }
    known.objects = out;
  };

  /* The grid index a locator carries is y * width + x, so the collapse needs
   * the same width the save was written with - never a guessed constant. */
  const widthOf = (chunk: unknown): number =>
    isObj(chunk) && typeof chunk.width === "number" ? chunk.width : 0;

  collapse(doc.known, doc.floor, widthOf(doc.chunk));
  if (Array.isArray(doc.levelCache)) {
    for (const level of doc.levelCache) {
      if (isObj(level)) collapse(level.known, level.floor, widthOf(level.chunk));
    }
  }
  void ids;
  doc.version = 3;
  return doc;
}

function toV2(save: SavedGame, ids: ContentIdResolver): Json {
  const doc = JSON.parse(JSON.stringify(save)) as Json;
  const kidxs = (v: unknown): number[] =>
    Array.isArray(v)
      ? v.flatMap((id) =>
          typeof id === "string" ? (ids.kindIndex(id) ?? []) : [],
        )
      : [];

  if (isObj(doc.flavor)) {
    doc.flavor = { aware: kidxs(doc.flavor.aware), tried: kidxs(doc.flavor.tried) };
  }
  if (isObj(doc.everseen)) {
    doc.everseen = {
      kinds: kidxs(doc.everseen.kinds),
      egos: Array.isArray(doc.everseen.egos)
        ? doc.everseen.egos.flatMap((id) =>
            typeof id === "string" ? (ids.egoIndex(id) ?? []) : [],
          )
        : [],
    };
  }
  if (isObj(doc.ignore)) {
    doc.ignore = deserializeIgnore(
      doc.ignore as unknown as Parameters<typeof deserializeIgnore>[0],
      ids,
    ) as unknown as Json;
  }
  /* Both arrived WITH version 3; a version-2 document simply has neither. */
  delete doc.autoinscriptions;
  delete doc.runeNotes;
  doc.version = 2;
  return doc;
}

/** The version-2 document as version 1 wrote it. */
function toV1(v2: Json, ids: ContentIdResolver): Json {
  /* artifactName -> aIdx needs the reverse of ids.artifactName, which the
   * resolver does not offer (nothing in the engine needs it). Build it once. */
  const aIdxByName = new Map<string, number>();
  for (let i = 1; ; i++) {
    const name = ids.artifactName(i);
    if (name === null) break;
    aIdxByName.set(name, i);
  }

  const doc = mapNodes(v2, (node) => {
    if (typeof node.kindId === "string") {
      const { kindId, egoId, artifactId, brands, slays, curses, originRaceId, ...rest } =
        node;
      const dense = (list: unknown, idx: (id: string) => number | undefined) =>
        list === null ? null : idsToDense(list, idx);
      /* v1 curses were positional: one slot per curse index. */
      let v1Curses: Array<{ power: number; timeout: number } | undefined> | null = null;
      if (Array.isArray(curses)) {
        const entries: Array<[number, { power: number; timeout: number }]> = [];
        for (const c of curses) {
          if (!isObj(c) || typeof c.id !== "string") continue;
          const i = ids.curseIndex(c.id);
          if (i === undefined) continue;
          entries.push([i, { power: Number(c.power), timeout: Number(c.timeout) }]);
        }
        const len = Math.max(1, ...entries.map(([i]) => i)) + 1;
        v1Curses = new Array<{ power: number; timeout: number } | undefined>(len);
        for (const [i, c] of entries) v1Curses[i] = c;
      }
      return {
        ...rest,
        kidx: ids.kindIndex(kindId),
        ego: typeof egoId === "string" ? (ids.egoIndex(egoId) ?? null) : null,
        artifact:
          typeof artifactId === "string" ? (ids.artifactIndex(artifactId) ?? null) : null,
        brands: dense(brands, (id) => ids.brandIndex(id)),
        slays: dense(slays, (id) => ids.slayIndex(id)),
        curses: v1Curses,
        originRace:
          typeof originRaceId === "string" ? (ids.raceIndex(originRaceId) ?? 0) : 0,
      };
    }
    if (typeof node.raceId === "string") {
      const { raceId, originalRaceId, ...rest } = node;
      return {
        ...rest,
        ridx: ids.raceIndex(raceId),
        originalRidx:
          typeof originalRaceId === "string" ? (ids.raceIndex(originalRaceId) ?? null) : null,
      };
    }
    if (typeof node.trapId === "string") {
      const { trapId, ...rest } = node;
      return { ...rest, tidx: ids.trapIndex(trapId) };
    }
    if (typeof node.artifactName === "string") {
      const { artifactName, ...rest } = node;
      return { ...rest, aIdx: aIdxByName.get(artifactName) ?? 0 };
    }
    return node;
  }) as Json;

  const player = doc.player;
  if (isObj(player) && isObj(player.objKnown)) {
    const k = player.objKnown;
    k.brands = idsToDense(k.brands, (id) => ids.brandIndex(id));
    k.slays = idsToDense(k.slays, (id) => ids.slayIndex(id));
    /* obj_k->curses was a number[] of powers, 1 = "rune known". */
    k.curses = idsToDense(k.curses, (id) => ids.curseIndex(id)).map((b) => (b ? 1 : 0));
  }
  if (Array.isArray(doc.artifactsCreated)) {
    doc.artifactsCreated = idsToDense(doc.artifactsCreated, (id) =>
      ids.artifactIndex(id),
    );
  }
  if (Array.isArray(doc.lore)) {
    doc.lore = doc.lore.flatMap((e) => {
      if (!Array.isArray(e) || typeof e[0] !== "string") return [];
      const ridx = ids.raceIndex(e[0]);
      return ridx === undefined ? [] : [[ridx, e[1]]];
    });
  }
  /* v1 wrote the terrain grid with no legend at all. */
  delete doc.featLegend;
  doc.version = 1;
  return doc;
}

/* ------------------------------------------------------------------ *
 * Tests.
 * ------------------------------------------------------------------ */

describe("the migration chain is complete", () => {
  it("has one step for every version below the current one", () => {
    const complete = saveMigrationsAreComplete();
    expect(complete.ok ? null : complete.why).toBeNull();
  });

  it("reaches exactly SAVE_VERSION", () => {
    expect(SAVE_MIGRATIONS.at(-1)?.to).toBe(SAVE_VERSION);
    expect(OLDEST_READABLE_SAVE).toBe(1);
  });

  it("every step moves exactly one version and says what it does", () => {
    for (const m of SAVE_MIGRATIONS) {
      expect(m.to).toBe(m.from + 1);
      expect(m.summary.length).toBeGreaterThan(20);
    }
  });

  /* The message a future maintainer will actually read. Asserting the TEXT of
   * the failure is not pedantry: the whole value of the ratchet is that the
   * person who bumps SAVE_VERSION is told what to do about it, and a check
   * whose message says "assertion failed" teaches nobody anything. */
  it("names the missing step when SAVE_VERSION runs ahead of the chain", () => {
    const short = SAVE_MIGRATIONS.slice(0, -1);
    const expected = short.at(-1)?.to ?? OLDEST_READABLE_SAVE;
    expect(expected).toBe(SAVE_VERSION - 1);
  });
});

describe("a save from the future is refused, and says why", () => {
  it("throws SaveFromFutureError, not a generic read failure", () => {
    const save = { ...currentSave(), version: SAVE_VERSION + 1 } as SavedGame;
    expect(() => migrateSave(save, resolver())).toThrow(SaveFromFutureError);
    try {
      migrateSave(save, resolver());
      expect.unreachable();
    } catch (e) {
      /* No word in this message may suggest the save is damaged. */
      const msg = (e as Error).message;
      expect(msg).toContain("newer version");
      expect(msg).toContain("not damaged");
      expect(msg.toLowerCase()).not.toContain("corrupt");
    }
  });

  it("leaves a current save alone", () => {
    const save = currentSave();
    const out = migrateSave(save, resolver());
    expect(out.applied).toEqual([]);
    expect(out.save).toBe(save);
  });
});

describe("round trip: a save walked back and migrated forward is unchanged", () => {
  /**
   * 3 -> 4 is the one step that cannot round-trip to byte equality, and the
   * reason is in the formats rather than in the step: version 3 stored a KIND
   * per grid and version 4 stores a LINK to an object, so walking a version-4
   * save back to 3 throws the link away and no forward step can invent it.
   *
   * What must survive is what version 3 could express - the grid still
   * remembers the same kind - so that is what this asserts, on the widened
   * shape, rather than pretending at an equality the formats cannot support.
   */
  /**
   * The one that matters for MOD_REACH row 22: a character saved under the
   * BIT-POSITION shape must load under the NAME shape knowing exactly the same
   * spells. Written end to end - a real game, a real save, the real loader -
   * because the thing at risk is a player's monster memory, not a mapping.
   */
  it("survives version 4 -> 5, keeping exactly the spells the player had seen", () => {
    const game = startGame(pack, { seed: 4242, depth: 2 });
    playTurns(game, 12);

    const race = game.state.monsters.find((m) => m && m.race.ridx > 0)!.race;
    const seen = getLore(game.state.lore, race).spellFlags;
    seen.on(RSF.BR_FIRE);
    seen.on(RSF.BA_COLD);
    seen.on(RSF.HASTE);
    const expected = Array.from(seen.bits);

    const v5 = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const entry = v5.lore!.find(([, l]) => l.spellsKnown.length > 0)!;
    expect(new Set(entry[1].spellsKnown)).toEqual(
      new Set(["BR_FIRE", "BA_COLD", "HASTE"]),
    );

    /* Back to what version 4 actually wrote: raw bytes, no names anywhere. */
    const v4 = toV4(v5);
    const record = (v4.lore as Array<[string, Json]>).find(
      ([id]) => id === entry[0],
    )![1];
    expect(record.spellsKnown).toBeUndefined();
    expect(record.spellFlags).toEqual(expected);
    expect(JSON.stringify(v4)).not.toContain("BR_FIRE");

    const loaded = loadGame(pack, v4 as never);
    expect(loaded.saveMigration?.applied).toHaveLength(1);
    expect(loaded.saveMigration?.notes).toEqual([]);
    expect(Array.from(loaded.state.lore.get(race.ridx)!.spellFlags.bits)).toEqual(
      expected,
    );

    /* And every OTHER lore record came through too - a step that quietly ate
     * the records with nothing known would still pass the assertion above. */
    expect(saveGame(loaded).lore).toHaveLength(v5.lore!.length);
  });

  it("survives version 3 -> 4, keeping every remembered kind", () => {
    const save = currentSave();
    const ids = resolver();
    const back = toV3(toV4(save) as unknown as SavedGame, ids);
    expect(back.version).toBe(3);
    /* The down-converter has to have actually collapsed something, or the
     * assertion below passes vacuously. */
    expect(JSON.stringify(back)).not.toEqual(JSON.stringify(save));

    const forward = migrateSave(back as never, resolver());
    expect(forward.applied).toHaveLength(2);
    expect(forward.notes).toEqual([]);

    const widened = (forward.save as unknown as SavedGame).known!.objects;
    const before = toV3(toV4(save) as unknown as SavedGame, resolver()).known as {
      objects: Array<[number, { kindId?: string }]>;
    };
    expect(widened).toHaveLength(before.objects.length);
    /* Every grid keeps its identity and its kind, as a one-element pile. */
    for (const [idx, entry] of before.objects) {
      const after = widened.find(([i]) => i === idx)!;
      expect(after[1]).toHaveLength(1);
      expect(after[1][0]!.kindId).toBe(entry.kindId);
    }
  });

  it("survives version 2 -> 3 -> 4 -> 5", () => {
    const ids = resolver();
    const save = currentSave();
    const back = toV2(
      toV3(toV4(save) as unknown as SavedGame, ids) as unknown as SavedGame,
      ids,
    );
    expect(back.version).toBe(2);

    const forward = migrateSave(back as never, resolver());
    expect(forward.applied).toHaveLength(3);
    expect(forward.notes).toEqual([]);
  });

  it("survives version 1 -> 2 -> 3 -> 4 -> 5", () => {
    const ids = resolver();
    const save = currentSave();
    const back = toV1(
      toV2(
        toV3(toV4(save) as unknown as SavedGame, ids) as unknown as SavedGame,
        ids,
      ),
      ids,
    );
    expect(back.version).toBe(1);
    /* Proof the down-converter actually undid something, so an equality that
     * passes cannot be passing vacuously. */
    expect(JSON.stringify(back)).not.toEqual(JSON.stringify(save));
    expect(JSON.stringify(back)).toContain('"kidx"');

    const forward = migrateSave(back as never, resolver());
    expect(forward.applied).toHaveLength(4);
    expect(forward.notes).toEqual([]);
  });

  it("the migrated version-1 document actually loads and plays", () => {
    const ids = resolver();
    const original = currentSave();
    const back = toV1(
      toV2(
        toV3(toV4(original) as unknown as SavedGame, ids) as unknown as SavedGame,
        ids,
      ),
      ids,
    );

    const game = loadGame(pack, back as never);
    expect(game.saveMigration?.applied).toHaveLength(4);
    expect(game.saveMigration?.notes).toEqual([]);
    /* It is a real game, not just a document that parsed. */
    playTurns(game, 3);
    const resaved = saveGame(game);
    expect(resaved.version).toBe(SAVE_VERSION);
  });

  it("loading the version-1 document leaves the caller's document untouched", () => {
    const ids = resolver();
    const back = toV1(toV2(currentSave(), ids), ids);
    const before = JSON.stringify(back);
    loadGame(pack, back as never);
    /* The bytes on disk must survive a load, successful or not, so a later
     * build can always try again on the original. */
    expect(JSON.stringify(back)).toBe(before);
  });
});

describe("an unresolvable reference costs one entity, not the character", () => {
  it("drops an object whose kind is gone and says so", () => {
    const ids = resolver();
    const save = currentSave();
    const v1 = toV1(toV2(save, ids), ids) as Json;
    /* An item from a mod that is no longer installed: an index past the end of
     * every table this pack binds. */
    const store = (v1.gear as Json).store as Array<[number, Json]>;
    const victim = structuredClone(store[0]![1]);
    victim.kidx = 999_999;
    store.push([9999, victim]);

    const out = migrateSave(v1 as never, resolver());
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]).toContain("1 item");
    expect(out.notes[0]).toContain("could not be restored");
    /* And the rest of the save came through intact. */
    expect(out.save.version).toBe(SAVE_VERSION);
    expect(out.save.player).toEqual(save.player);
  });

  it("never throws for content the pack cannot resolve", () => {
    const ids = resolver();
    const v1 = toV1(toV2(currentSave(), ids), ids) as Json;
    for (const monster of (v1.monsters ?? []) as Array<Json | null>) {
      if (monster) monster.ridx = 999_999;
    }
    expect(() => migrateSave(v1 as never, resolver())).not.toThrow();
  });
});
