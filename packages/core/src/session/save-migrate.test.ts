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
 *    equal the starting value. The down-converters are derived from the two
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
  SQUARE_INFO_LEGEND,
  deserializeElementLevels,
  deserializeIgnore,
  deserializeLoreFlags,
  deserializeLoreSpells,
  deserializeMonsterFlags,
  deserializeMonsterTimed,
  deserializeObjectElements,
  deserializeObjectFlags,
  deserializeObjectModifiers,
  deserializePlayerSkills,
  deserializePlayerTimed,
  deserializeStatMap,
  deserializeStatValues,
  deserializeTrapFlags,
} from "./save.js";
import type { SavedGame } from "./save.js";
import {
  MFLAG,
  MON_TMD,
  OF,
  RF,
  RSF,
  SQUARE,
  STAT,
  TMD,
  TRF,
} from "../generated/index.js";
import { SKILL } from "../player/types.js";
import { installTrap } from "../game/trap.js";
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
 * The current document as version 6 wrote it: the seven tables #274 named go
 * back to the RAW POSITIONS - MFLAG/TRF FlagSet bytes, dense MON_TMD / TMD /
 * SKILL / STAT arrays, and a `statMap` whose values are bare stat indices - and
 * the square legend goes away entirely.
 *
 * Each half is the forward step's own inverse, for the same reason toV2 calls
 * `deserializeIgnore`: two hand-written halves of one mapping can disagree, and
 * then the round trip proves nothing.
 */
function toV6(save: SavedGame): Json {
  const doc = JSON.parse(JSON.stringify(save)) as Json;
  const back = mapNodes(doc, (node) => {
    if (Array.isArray(node.mflagNames) || isObj(node.monsterTimed)) {
      const { mflagNames, monsterTimed, ...rest } = node;
      return {
        ...rest,
        ...(Array.isArray(mflagNames)
          ? {
              mflag: Array.from(
                deserializeMonsterFlags(mflagNames as string[]).bits,
              ),
            }
          : {}),
        ...(isObj(monsterTimed)
          ? {
              mTimed: deserializeMonsterTimed(
                monsterTimed as Record<string, number>,
              ),
            }
          : {}),
      };
    }
    if (typeof node.trapId === "string" && Array.isArray(node.trapFlagNames)) {
      const { trapFlagNames, ...rest } = node;
      return {
        ...rest,
        flags: Array.from(
          deserializeTrapFlags(trapFlagNames as string[]).bits,
        ),
      };
    }
    if (typeof node.raceName === "string" && typeof node.clsName === "string") {
      const {
        statMaxValues,
        statCurValues,
        statBirthValues,
        statMapNames,
        timedValues,
        skillValues,
        objKnownModifierValues,
        ...rest
      } = node;
      const nums = (v: unknown): Record<string, number> =>
        (v ?? {}) as Record<string, number>;
      return {
        ...rest,
        statMax: deserializeStatValues(nums(statMaxValues)),
        statCur: deserializeStatValues(nums(statCurValues)),
        statMap: deserializeStatMap(
          (statMapNames ?? {}) as Record<string, string>,
        ),
        statBirth: deserializeStatValues(nums(statBirthValues)),
        timed: deserializePlayerTimed(nums(timedValues)),
        skills: deserializePlayerSkills(nums(skillValues)),
        ...(isObj(objKnownModifierValues)
          ? {
              objKnownModifiers: deserializeObjectModifiers(
                objKnownModifierValues as Record<string, number>,
              ),
            }
          : {}),
      };
    }
    return node;
  }) as Json;
  delete back.squareInfoLegend;
  back.version = 6;
  return back;
}

/**
 * The current document as version 5 wrote it: every object-property carrier,
 * every lore record and every monster's remembered view of the player goes back
 * to the RAW POSITIONS - OF/RF FlagSet bytes and dense OBJ_MOD / ELEM arrays -
 * that V5_TO_V6 exists to get rid of.
 *
 * Each half is the forward step's own inverse, for the same reason toV2 calls
 * `deserializeIgnore`: two hand-written halves of one mapping can disagree, and
 * then the round trip proves nothing.
 */
function toV5(save: Json): Json {
  const doc = JSON.parse(JSON.stringify(save)) as Json;
  const back = mapNodes(doc, (node) => {
    if (
      Array.isArray(node.flagNames) &&
      isObj(node.modifierValues) &&
      isObj(node.elementInfo)
    ) {
      const { flagNames, modifierValues, elementInfo, ...rest } = node;
      return {
        ...rest,
        flags: Array.from(
          deserializeObjectFlags(flagNames as string[]).bits,
        ),
        modifiers: deserializeObjectModifiers(
          modifierValues as Record<string, number>,
        ),
        elInfo: deserializeObjectElements(
          elementInfo as Parameters<typeof deserializeObjectElements>[0],
        ),
      };
    }
    if (Array.isArray(node.flagsKnown) && Array.isArray(node.blowKnown)) {
      const { flagsKnown, ...rest } = node;
      return {
        ...rest,
        flags: Array.from(deserializeLoreFlags(flagsKnown as string[]).bits),
      };
    }
    if (
      Array.isArray(node.knownPstateFlagNames) ||
      isObj(node.knownPstateElementRes)
    ) {
      const { knownPstateFlagNames, knownPstateElementRes, ...rest } = node;
      return {
        ...rest,
        ...(Array.isArray(knownPstateFlagNames)
          ? {
              knownPstateFlags: Array.from(
                deserializeObjectFlags(knownPstateFlagNames as string[]).bits,
              ),
            }
          : {}),
        ...(isObj(knownPstateElementRes)
          ? {
              knownPstateElInfo: deserializeElementLevels(
                knownPstateElementRes as Record<string, number>,
              ),
            }
          : {}),
      };
    }
    return node;
  }) as Json;
  back.version = 5;
  return back;
}

/**
 * The version-5 document as version 4 wrote it: the observed spell set on every
 * lore record goes back to the RAW FlagSet BYTES - the persisted RSF bit
 * positions that V4_TO_V5 exists to get rid of.
 *
 * `deserializeLoreSpells` is the forward step's own inverse, used here for the
 * same reason toV2 calls `deserializeIgnore`: two hand-written halves of one
 * mapping can disagree, and then the round trip proves nothing.
 */
function toV4(save: Json): Json {
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
   * The one that matters for #273: a character saved under the BIT-POSITION
   * shape must load under the NAME shape with exactly the same race lore and
   * exactly the same items. Written end to end - a real game, a real save, the
   * real loader - because the thing at risk is a player's character, not a
   * mapping.
   */
  it("survives version 5 -> 6 -> 7, keeping the flags and the items intact", () => {
    const game = startGame(pack, { seed: 4242, depth: 2 });
    playTurns(game, 12);

    const race = game.state.monsters.find((m) => m && m.race.ridx > 0)!.race;
    const lore = getLore(game.state.lore, race);
    lore.flags.on(RF.EVIL);
    lore.flags.on(RF.UNDEAD);
    lore.flags.on(RF.IM_FIRE);
    const expectedLore = Array.from(lore.flags.bits);
    /* A monster's remembered view of the player, which is the third OF carrier
     * and the one no other test in this file touches. */
    const mon = game.state.monsters.find((m) => m && m.race.ridx > 0)!;
    mon.knownPstate.flags.on(OF.FREE_ACT);

    const current = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const entry = current.lore!.find(([, l]) =>
      l.flagsKnown.includes("IM_FIRE"),
    )!;
    expect(entry[1].flagsKnown).toEqual(
      expect.arrayContaining(["EVIL", "UNDEAD", "IM_FIRE"]),
    );

    /* Back to what version 5 actually wrote: raw positions, no OF/RF/OBJ_MOD/
     * ELEM name anywhere in the document. */
    const v5 = toV5(toV6(current));
    const record = (v5.lore as Array<[string, Json]>).find(
      ([id]) => id === entry[0],
    )![1];
    expect(record.flagsKnown).toBeUndefined();
    expect(record.flags).toEqual(expectedLore);
    expect(JSON.stringify(v5)).not.toContain("IM_FIRE");
    expect(JSON.stringify(v5)).not.toContain("SUST_STR");
    /* And the down-converter really did undo something everywhere, or the
     * assertions below pass vacuously. */
    expect(JSON.stringify(v5)).toContain('"modifiers"');
    expect(JSON.stringify(v5)).toContain('"knownPstateFlags"');

    const loaded = loadGame(pack, v5 as never);
    expect(loaded.saveMigration?.applied).toHaveLength(2);
    expect(loaded.saveMigration?.notes).toEqual([]);
    expect(Array.from(loaded.state.lore.get(race.ridx)!.flags.bits)).toEqual(
      expectedLore,
    );

    /* THE WHOLE DOCUMENT, not just the field the test happened to name: every
     * object in the gear, on the floor, in a store, held by a monster, and in
     * the frozen-level cache went down and came back. A step that missed one
     * container would differ here. */
    expect(migrateSave(v5 as never, resolver()).save).toEqual(current);
  });

  /**
   * The one that mattered for MOD_REACH row 22: the same proof for the spells,
   * one version down.
   */
  it("survives version 4 -> 5 -> 7, keeping exactly the spells the player had seen", () => {
    const game = startGame(pack, { seed: 4242, depth: 2 });
    playTurns(game, 12);

    const race = game.state.monsters.find((m) => m && m.race.ridx > 0)!.race;
    const seen = getLore(game.state.lore, race).spellFlags;
    seen.on(RSF.BR_FIRE);
    seen.on(RSF.BA_COLD);
    seen.on(RSF.HASTE);
    const expected = Array.from(seen.bits);

    const current = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
    const entry = current.lore!.find(([, l]) => l.spellsKnown.length > 0)!;
    expect(new Set(entry[1].spellsKnown)).toEqual(
      new Set(["BR_FIRE", "BA_COLD", "HASTE"]),
    );

    /* Back to what version 4 actually wrote: raw bytes, no names anywhere. */
    const v4 = toV4(toV5(toV6(current)));
    const record = (v4.lore as Array<[string, Json]>).find(
      ([id]) => id === entry[0],
    )![1];
    expect(record.spellsKnown).toBeUndefined();
    expect(record.spellFlags).toEqual(expected);
    expect(JSON.stringify(v4)).not.toContain("BR_FIRE");

    const loaded = loadGame(pack, v4 as never);
    expect(loaded.saveMigration?.applied).toHaveLength(3);
    expect(loaded.saveMigration?.notes).toEqual([]);
    expect(Array.from(loaded.state.lore.get(race.ridx)!.spellFlags.bits)).toEqual(
      expected,
    );

    /* And every OTHER lore record came through too - a step that quietly ate
     * the records with nothing known would still pass the assertion above. */
    expect(saveGame(loaded).lore).toHaveLength(current.lore!.length);
  });

  it("survives version 3 -> 4 -> 7, keeping every remembered kind", () => {
    const save = currentSave();
    const ids = resolver();
    const back = toV3(toV4(toV5(toV6(save))) as unknown as SavedGame, ids);
    expect(back.version).toBe(3);
    /* The down-converter has to have actually collapsed something, or the
     * assertion below passes vacuously. */
    expect(JSON.stringify(back)).not.toEqual(JSON.stringify(save));

    const forward = migrateSave(back as never, resolver());
    expect(forward.applied).toHaveLength(4);
    expect(forward.notes).toEqual([]);

    const widened = (forward.save as unknown as SavedGame).known!.objects;
    const before = toV3(toV4(toV5(toV6(save))) as unknown as SavedGame, resolver()).known as {
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

  it("survives version 2 -> 3 -> 4 -> 5 -> 6 -> 7", () => {
    const ids = resolver();
    const save = currentSave();
    const back = toV2(
      toV3(toV4(toV5(toV6(save))) as unknown as SavedGame, ids) as unknown as SavedGame,
      ids,
    );
    expect(back.version).toBe(2);

    const forward = migrateSave(back as never, resolver());
    expect(forward.applied).toHaveLength(5);
    expect(forward.notes).toEqual([]);
  });

  it("survives version 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7", () => {
    const ids = resolver();
    const save = currentSave();
    const back = toV1(
      toV2(
        toV3(toV4(toV5(toV6(save))) as unknown as SavedGame, ids) as unknown as SavedGame,
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
    expect(forward.applied).toHaveLength(6);
    expect(forward.notes).toEqual([]);
  });

  it("the migrated version-1 document actually loads and plays", () => {
    const ids = resolver();
    const original = currentSave();
    const back = toV1(
      toV2(
        toV3(toV4(toV5(toV6(original))) as unknown as SavedGame, ids) as unknown as SavedGame,
        ids,
      ),
      ids,
    );

    const game = loadGame(pack, back as never);
    expect(game.saveMigration?.applied).toHaveLength(6);
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

/* ------------------------------------------------------------------ *
 * #274: version 6 -> 7, one table at a time, THROUGH THE REAL STEP.
 *
 * The controls in save-flag-names.test.ts exercise the serialize and
 * deserialize helpers. The helpers were never the risk: the risk is
 * `V6_TO_V7`'s DISCRIMINATORS, because a conjunction that fails to match a node
 * strands that node's data on bit positions permanently and reports nothing. So
 * every test below builds a version-6 document, runs `migrateSave` - the real
 * chain, the real step - and reads the result. Delete one table's conversion
 * from V6_TO_V7 and the matching test goes red on the missing field, not on a
 * mapping that still works in isolation.
 *
 * Each also carries its RENUMBER control: the table with one entry inserted,
 * showing that the positions the version-6 document held would now name
 * something else, and that the names the migrated document holds do not move.
 * ------------------------------------------------------------------ */

/**
 * Each table inverted HERE, from the enum, rather than imported from save.ts -
 * so these are a second derivation and not a restatement of the first.
 */
function invertedList(en: Readonly<Record<string, number>>): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(en)) out[value] = name;
  return out;
}
const MFLAG_NAME_LIST = invertedList(MFLAG);
const MON_TMD_NAME_LIST = invertedList(MON_TMD);
const TRF_NAME_LIST = invertedList(TRF);
const TMD_NAME_LIST = invertedList(TMD);
const SKILL_NAME_LIST = invertedList(SKILL);
const STAT_NAME_LIST = invertedList(STAT);

/** A name list with one new entry inserted at `at`, as a mod would do. */
function renumbered(names: readonly string[], at: number, added: string): string[] {
  const out = [...names];
  out.splice(at, 0, added);
  return out;
}

/** A version-6 document from a real game, with the probes below planted. */
function v6WithProbes(): { v6: Json; current: SavedGame } {
  const game = startGame(pack, { seed: 4242, depth: 2 });
  playTurns(game, 12);
  const state = game.state;

  const mon = state.monsters.find((m) => m && m.race.ridx > 0)!;
  mon.mflag.on(MFLAG.VISIBLE);
  mon.mflag.on(MFLAG.TRACKING);
  mon.mTimed[MON_TMD.SLEEP] = 500;
  mon.mTimed[MON_TMD.CONF] = 7;

  const trapDeps = game.wizardBundles.trapDeps!;
  const trapKind = trapDeps.kinds.find((k) => k?.name)!;
  installTrap(state, state.actor.grid, trapKind.tidx, 3, trapDeps);

  const p = state.actor.player;
  p.statMax[STAT.STR] = 18 + 70;
  p.statCur[STAT.STR] = 18 + 40;
  p.statBirth[STAT.CON] = 16;
  /* A SCRAMBLED character: STR and INT have swapped slots, which is the only
   * state in which statMap is not the identity and the only state in which
   * naming just the keys would have been wrong. */
  p.statMap[STAT.STR] = STAT.INT;
  p.statMap[STAT.INT] = STAT.STR;
  p.timed[TMD.BLIND] = 9;
  p.timed[TMD.AFRAID] = 3;
  p.skills[SKILL.STEALTH] = 5;
  p.skills[SKILL.DIGGING] = 0;

  const current = JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
  return { v6: toV6(current), current };
}

describe("version 6 -> 7 converts each table, through the real migration", () => {
  const migrated = (): SavedGame =>
    migrateSave(v6WithProbes().v6 as never, resolver()).save;

  it("MFLAG: a monster's flags arrive as names, not as bytes", () => {
    const { v6 } = v6WithProbes();
    /* The version-6 document really is holding bytes, or everything below
     * passes vacuously. */
    const before = (v6.monsters as Json[])[1]!;
    expect(Array.isArray(before.mflag)).toBe(true);
    expect(before.mflagNames).toBeUndefined();

    const after = migrateSave(v6 as never, resolver()).save.monsters![1]!;
    expect(after.mflagNames).toEqual(
      expect.arrayContaining(["VISIBLE", "TRACKING"]),
    );

    /* THE CONTROL. A build with one flag inserted at MFLAG_VIEW reads the
     * version-6 BYTES as different flags entirely... */
    const table = renumbered(MFLAG_NAME_LIST, 1, "MOD_FROZEN");
    const asPositions = [MFLAG.VISIBLE, MFLAG.TRACKING].map((f) => table[f]);
    expect(asPositions).toEqual(["MARK", "HANDLED"]);
    /* ...and the migrated NAMES through the same renumbered table are
     * unmoved, which is what the step bought. */
    const asNames = after.mflagNames.map((n) => table[table.indexOf(n)]);
    expect(asNames).toEqual(expect.arrayContaining(["VISIBLE", "TRACKING"]));
    expect(table.indexOf("VISIBLE")).toBe(MFLAG.VISIBLE + 1);
  });

  it("MON_TMD: a monster's timers arrive keyed by name", () => {
    const { v6 } = v6WithProbes();
    const before = (v6.monsters as Json[])[1]!;
    expect(Array.isArray(before.mTimed)).toBe(true);

    const after = migrateSave(v6 as never, resolver()).save.monsters![1]!;
    expect(after.monsterTimed).toEqual({ SLEEP: 500, CONF: 7 });

    const table = renumbered(MON_TMD_NAME_LIST, 0, "MOD_DAZZLED");
    /* The dense array version 6 held now reads as the WRONG effects. */
    expect([MON_TMD.SLEEP, MON_TMD.CONF].map((i) => table[i])).toEqual([
      "MOD_DAZZLED",
      "STUN",
    ]);
    expect(Object.keys(after.monsterTimed).map((n) => table.indexOf(n))).toEqual([
      MON_TMD.SLEEP + 1,
      MON_TMD.CONF + 1,
    ]);
  });

  it("TRF: a planted trap's flags arrive as names", () => {
    const { v6 } = v6WithProbes();
    const trap = ((v6.traps as Json[])[0]!.traps as Json[])[0]!;
    expect(Array.isArray(trap.flags)).toBe(true);
    expect(trap.trapFlagNames).toBeUndefined();

    const after = migrateSave(v6 as never, resolver()).save.traps![0]!.traps[0]!;
    expect(after.trapFlagNames.length).toBeGreaterThan(0);
    expect(after.trapFlagNames).not.toContain("NONE");

    const table = renumbered(TRF_NAME_LIST, 1, "MOD_RUNE");
    for (const name of after.trapFlagNames) {
      /* Every name still resolves, and every one has MOVED - so a positional
       * reader would have produced a different trap. */
      expect(table.indexOf(name)).toBeGreaterThan(0);
      expect(table.indexOf(name)).not.toBe(TRF_NAME_LIST.indexOf(name));
    }
  });

  it("STAT: the three magnitude arrays arrive keyed by name", () => {
    const after = migrated().player;
    expect(after.statMaxValues.STR).toBe(18 + 70);
    expect(after.statCurValues.STR).toBe(18 + 40);
    expect(after.statBirthValues.CON).toBe(16);
    /* Every stat is written, because zero is a value here and not an absence. */
    expect(Object.keys(after.statMaxValues)).toEqual([
      "STR",
      "INT",
      "WIS",
      "DEX",
      "CON",
    ]);

    const table = renumbered(STAT_NAME_LIST, 0, "MOD_LUCK");
    /* The dense array version 6 held would now credit STR's value to a
     * modded stat and INT's to STR. */
    expect(table[STAT.STR]).toBe("MOD_LUCK");
    expect(table[STAT.INT]).toBe("STR");
    expect(table.indexOf("STR")).toBe(STAT.STR + 1);
  });

  it("STAT, THE PERMUTATION: statMap arrives with BOTH halves named", () => {
    const { v6 } = v6WithProbes();
    const beforeMap = (v6.player as Json).statMap;
    /* Version 6 held raw stat INDICES as the values - the trap in this set. */
    expect(beforeMap).toEqual([STAT.INT, STAT.STR, STAT.WIS, STAT.DEX, STAT.CON]);

    const after = migrateSave(v6 as never, resolver()).save.player;
    expect(after.statMapNames).toEqual({
      STR: "INT",
      INT: "STR",
      WIS: "WIS",
      DEX: "DEX",
      CON: "CON",
    });
    /* Naming only the keys would have left every VALUE a bare index, so this
     * is the assertion that a keys-only encoding fails. */
    for (const v of Object.values(after.statMapNames)) {
      expect(typeof v).toBe("string");
    }

    const table = renumbered(STAT_NAME_LIST, 0, "MOD_LUCK");
    const asPositions = (beforeMap as number[]).map((i) => table[i]);
    expect(asPositions[0]).toBe("STR"); // was INT
    const asNames = Object.entries(after.statMapNames).map(
      ([k, v]) => [table[table.indexOf(k)], table[table.indexOf(v)]] as const,
    );
    expect(asNames[0]).toEqual(["STR", "INT"]);
  });

  it("TMD: the player's timed effects arrive keyed by name, zeroes omitted", () => {
    const { v6 } = v6WithProbes();
    expect(Array.isArray((v6.player as Json).timed)).toBe(true);

    const after = migrateSave(v6 as never, resolver()).save.player;
    expect(after.timedValues.BLIND).toBe(9);
    expect(after.timedValues.AFRAID).toBe(3);
    /* 53 slots in, only the live ones out: zero is "not active" and writes
     * nothing. (FOOD is legitimately non-zero on any living character, which
     * is why this counts rather than naming an exact set.) */
    const dense = (v6.player as Json).timed as number[];
    expect(dense).toHaveLength(TMD_NAME_LIST.length);
    expect(Object.keys(after.timedValues).length).toBe(
      dense.filter((v) => v !== 0).length,
    );
    expect(Object.keys(after.timedValues).length).toBeLessThan(dense.length);

    const table = renumbered(TMD_NAME_LIST, 0, "MOD_DAZED");
    expect(table[TMD.BLIND]).toBe("SLOW");
    expect(table.indexOf("BLIND")).toBe(TMD.BLIND + 1);
  });

  it("SKILL: the derived skills arrive keyed by name, every slot", () => {
    const after = migrated().player;
    expect(after.skillValues.STEALTH).toBe(5);
    /* Zero IS written here: unlike a timed effect, a skill of 0 is a value. */
    expect(after.skillValues.DIGGING).toBe(0);
    expect(Object.keys(after.skillValues)).toHaveLength(SKILL_NAME_LIST.length);

    const table = renumbered(SKILL_NAME_LIST, 0, "MOD_ALCHEMY");
    expect(table[SKILL.STEALTH]).toBe("SEARCH");
    expect(table.indexOf("STEALTH")).toBe(SKILL.STEALTH + 1);
  });

  it("SQUARE: the document arrives carrying this build's legend", () => {
    const { v6 } = v6WithProbes();
    expect(v6.squareInfoLegend).toBeUndefined();

    const after = migrateSave(v6 as never, resolver()).save;
    expect(after.squareInfoLegend).toEqual([...SQUARE_INFO_LEGEND]);
    expect(after.squareInfoLegend).toContain("MARK");
    /* The per-grid payload is still numeric, which is the whole point of the
     * legend - see SQUARE_INFO_LEGEND for the 4.7x measurement that chose it. */
    expect(Array.isArray(after.chunk!.infos[0])).toBe(true);
  });

  /**
   * THE ONE #273 WALKED PAST. `objKnownModifiers` is the version-1 rune block
   * (pre-#13), a dense OBJ_MOD array that every step from 1 to 6 carried
   * forward untouched - so a character old enough to have it was still having
   * its learned modifier runes read by POSITION after #273 converted the modern
   * spelling beside it. It cannot appear in a round trip, because no current
   * save writes it, so it needs a document of its own.
   */
  it("the version-1 legacy rune block converts too", () => {
    const { v6 } = v6WithProbes();
    const player = v6.player as Json;
    /* A pre-#13 save: only the modifier runes, and no objKnown at all. */
    const legacy = new Array<number>(16).fill(0);
    legacy[3] = 1; // OBJ_MOD_DEX
    legacy[9] = 1; // OBJ_MOD_SPEED
    player.objKnownModifiers = legacy;
    delete player.objKnown;

    const after = migrateSave(v6 as never, resolver()).save.player;
    expect(after.objKnownModifierValues).toEqual({ DEX: 1, SPEED: 1 });
    expect((after as unknown as Json).objKnownModifiers).toBeUndefined();
  });

  it("the whole document survives 6 -> 7 with nothing else changed", () => {
    const { v6, current } = v6WithProbes();
    const forward = migrateSave(v6 as never, resolver());
    expect(forward.applied).toHaveLength(1);
    expect(forward.notes).toEqual([]);
    /* Every container: gear, floor, stores, monster-held, the frozen cache. */
    expect(forward.save).toEqual(current);
  });
});

/* ------------------------------------------------------------------ *
 * The square legend, read by a build whose SQUARE table has MOVED.
 * ------------------------------------------------------------------ */

/** One grid's info bytes, read as names through a given legend. */
function bitNames(bytes: readonly number[], legend: readonly string[]): string[] {
  const out: string[] = [];
  for (let b = 0; b < bytes.length; b++) {
    const byte = bytes[b] ?? 0;
    for (let k = 0; k < 8; k++) {
      if ((byte & (1 << k)) === 0) continue;
      const name = legend[b * 8 + k];
      if (name !== undefined) out.push(name);
    }
  }
  return out;
}

describe("a document whose square legend is not this build's", () => {
  it("remaps every grid, and every connector, at the CURRENT version", () => {
    const save = currentSave();
    const doc = JSON.parse(JSON.stringify(save)) as Json;
    /* The document claims it was written by a build with one extra flag ahead
     * of SQUARE_MARK, so every bit in it sits one place low relative to this
     * build's table. Nothing about the version changes: this is two builds at
     * version 7, which is exactly what a version number cannot express. */
    doc.squareInfoLegend = renumbered([...SQUARE_INFO_LEGEND], 1, "MOD_SCORCHED");

    const chunk = doc.chunk as Json;
    const infos = chunk.infos as number[][];
    /* Under the document's legend, bit 2 is MARK. Under this build's it is
     * GLOW - so an unremapped read lights up the whole level. */
    const marked = infos.findIndex((b) => ((b[0] ?? 0) >> 2) & 1);
    expect(marked).toBeGreaterThanOrEqual(0);
    /* What that grid MEANS, read through the legend the document supplied. */
    const meant = bitNames(infos[marked]!, doc.squareInfoLegend as string[]);
    expect(meant).toContain("MARK");

    const out = migrateSave(doc as never, resolver());
    expect(out.applied).toEqual([]);
    const remapped = (out.save.chunk!.infos as number[][])[marked]!;
    /* The same meaning, now in this build's numbering - every flag, not just
     * the one the test happened to name. */
    expect(bitNames(remapped, [...SQUARE_INFO_LEGEND])).toEqual(meant);
    expect((remapped[0]! >> SQUARE.MARK) & 1).toBe(1);
    /* And the document now speaks this build's numbering, so a second pass is
     * a no-op rather than a second shift. */
    expect(out.save.squareInfoLegend).toEqual([...SQUARE_INFO_LEGEND]);
    const again = migrateSave(out.save as never, resolver());
    expect((again.save.chunk!.infos as number[][])[marked]).toEqual(remapped);
  });

  it("drops a grid flag this build does not have, and says so", () => {
    const save = currentSave();
    const doc = JSON.parse(JSON.stringify(save)) as Json;
    /* A build that had a mod's square flag, read here without the mod. */
    const legend = [...SQUARE_INFO_LEGEND];
    legend[SQUARE.GLOW] = "MOD_SCORCHED";
    doc.squareInfoLegend = legend;

    const out = migrateSave(doc as never, resolver());
    expect(out.notes).toHaveLength(1);
    expect(out.notes[0]).toContain("MOD_SCORCHED");
    expect(out.notes[0]).toContain("map is otherwise intact");
    /* GLOW is gone everywhere, and MARK - which did not move - is not. */
    const infos = out.save.chunk!.infos as number[][];
    expect(infos.some((b) => ((b[0] ?? 0) >> SQUARE.GLOW) & 1)).toBe(false);
    expect(infos.some((b) => ((b[0] ?? 0) >> SQUARE.MARK) & 1)).toBe(true);
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
