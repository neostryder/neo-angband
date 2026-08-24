/**
 * Provenance: which pack a record came from, from the composer's stamp through
 * binding and out into the id a savefile stores.
 *
 * THE CONTROL IS THE POINT OF THIS FILE. Every assertion about a namespaced id
 * is paired with the SAME pack bound without the stamp, so a test that only
 * asserted the new id cannot pass against an engine that simply ignores
 * provenance.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindCore } from "../session/boot.js";
import type { CorePack } from "../session/boot.js";
import { attachExt, PROVENANCE_KEY, provenanceOf } from "./extension.js";
import type { ModExtensible } from "./extension.js";
import { ContentIdResolver } from "./ids.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

/** A record shape loose enough to copy and stamp without knowing the schema. */
type Rec = Record<string, unknown>;

/**
 * Core's monsters with one more on the end: a renamed copy of core's own
 * "kobold", optionally carrying a mod's stamp.
 *
 * A COPY OF A REAL RECORD rather than a hand-written one, because a monster
 * that does not bind proves nothing, and a fixture written to satisfy the
 * binder is an assertion about the binder that nobody checked. The name is
 * deliberately unique: binders now refuse duplicate names before the id layer
 * runs, which is the invariant the id layer needs to make names stable.
 */
function monstersWithModKobold(stamped: boolean): Rec[] {
  const records = loadRecords<Rec>("monster");
  const kobold = records.find((r) => r["name"] === "kobold");
  if (kobold === undefined) throw new Error("fixture: core ships no monster named kobold");
  const added: Rec = { ...kobold, name: "Frost Kobold" };
  if (stamped) added[PROVENANCE_KEY] = { owner: "frost" };
  return [...records, added];
}

function packWith(monsters: Rec[]): CorePack {
  return {
    constants: loadJson("constants"),
    terrain: loadRecords("terrain"),
    roomTemplates: loadRecords("room_template"),
    vaults: loadRecords("vault"),
    dungeonProfiles: loadRecords("dungeon_profile"),
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
    } as CorePack["obj"],
    mon: {
      pain: loadRecords("pain"),
      blowMethods: loadRecords("blow_methods"),
      blowEffects: loadRecords("blow_effects"),
      monsterSpells: loadRecords("monster_spell"),
      monsterBases: loadRecords("monster_base"),
      monsters,
      summons: loadRecords("summon"),
      pits: loadRecords("pit"),
    },
  } as unknown as CorePack;
}

const modded = bindCore(packWith(monstersWithModKobold(true)));
const unstamped = bindCore(packWith(monstersWithModKobold(false)));
const moddedIds = new ContentIdResolver(modded);
const unstampedIds = new ContentIdResolver(unstamped);

/** The appended Frost Kobold and core's own Kobold. */
function koboldIndices(reg: typeof modded): { core: number; added: number } {
  const at = reg.monsters.races
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.name === "kobold" || r.name === "Frost Kobold");
  const core = at.find(({ r }) => r.name === "kobold")?.i;
  const added = at.find(({ r }) => r.name === "Frost Kobold")?.i;
  if (core === undefined || added === undefined) {
    throw new Error(`fixture: expected Kobold and Frost Kobold, found ${at.length} records`);
  }
  return { core, added };
}

describe("provenance reaches the bound record", () => {
  it("a stamped record carries its owner", () => {
    const { added } = koboldIndices(modded);
    expect(modded.monsters.races[added]?.from).toEqual({ owner: "frost" });
  });

  it("core's own records carry nothing", () => {
    const { core } = koboldIndices(modded);
    expect(modded.monsters.races[core]?.from).toBeUndefined();
    /* The whole registry, not one record: `from` present anywhere in an
     * unmodded run would mean the absence has stopped meaning "core's". */
    expect(unstamped.monsters.races.filter((r) => r.from !== undefined)).toEqual([]);
  });

  it("carries modifiedBy when a mod changed a record it does not own", () => {
    const bound = attachExt<ModExtensible>(
      "monster",
      { [PROVENANCE_KEY]: { owner: "core", modifiedBy: ["qol"] } },
      {},
    );
    expect(bound.from).toEqual({ owner: "core", modifiedBy: ["qol"] });
  });
});

describe("the id a savefile stores", () => {
  it("namespaces a mod's record to the mod", () => {
    const { added } = koboldIndices(modded);
    expect(moddedIds.raceId(added)).toBe("frost:frost-kobold");
  });

  it("leaves core's record's id exactly as it was", () => {
    const { core } = koboldIndices(modded);
    expect(moddedIds.raceId(core)).toBe("core:kobold");
    /* Not just "core's id is right in the new world" - the SAME string the
     * engine minted before any of this existed. A save written yesterday still
     * finds core's kobold. */
    expect(moddedIds.raceId(core)).toBe(unstampedIds.raceId(koboldIndices(unstamped).core));
  });

  it("THE CONTROL: without the stamp the added record is in the core namespace", () => {
    const { added } = koboldIndices(unstamped);
    expect(unstampedIds.raceId(added)).toBe("core:frost-kobold");
  });

  it("still resolves the id an older engine wrote for it", () => {
    /* The compatibility half. Before namespacing, a character saved this mod's
     * monster under core:frost-kobold; that spelling must still find it. */
    const { added } = koboldIndices(modded);
    expect(moddedIds.raceIndex("core:frost-kobold")).toBe(added);
    expect(moddedIds.raceIndex("frost:frost-kobold")).toBe(added);
  });

  it("never lets a legacy id shadow a live one", () => {
    /* Exact-first. `core:kobold` is a live id AND the legacy id of core's own
     * kobold, so the two agree here - the assertion is that the live table is
     * consulted first, which is what makes a collision impossible in general. */
    const { core } = koboldIndices(modded);
    expect(moddedIds.raceIndex("core:kobold")).toBe(core);
  });

  it("returns undefined for an id no pack supplies", () => {
    expect(moddedIds.raceIndex("frost:frost-kobold-2")).toBeUndefined();
    expect(moddedIds.raceIndex("nobody:kobold")).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * Task #233: a patch cannot move a record's id.
 * ------------------------------------------------------------------ */

const GRIP = "Grip, Farmer Maggot's Dog";
const GRIP_ID = "core:grip-farmer-maggot-s-dog";

/**
 * Core's monsters with Grip renamed by a mod, stamped the way the composer
 * stamps a patched record.
 *
 * `keepDefiner` is the NEGATIVE CONTROL and it works by REMOVING the mechanism:
 * false gives the stamp exactly the shape it had before task #233, so the same
 * fixture, the same binder and the same resolver reproduce the defect. A control
 * that fed a different name in would only prove the assertion was sensitive to
 * its input.
 */
function monstersWithRenamedGrip(keepDefiner: boolean): Rec[] {
  const records = loadRecords<Rec>("monster");
  const at = records.findIndex((r) => r["name"] === GRIP);
  const grip = records[at];
  if (grip === undefined) throw new Error(`fixture: core ships no monster named ${GRIP}`);
  const out = [...records];
  out[at] = {
    ...grip,
    name: "Grip, the Cyber-Hound",
    [PROVENANCE_KEY]: keepDefiner
      ? { owner: "core", modifiedBy: ["cyber"], was: { name: GRIP } }
      : { owner: "core", modifiedBy: ["cyber"] },
  };
  return out;
}

/**
 * A monster the pack `frost` DEFINES, which the later pack `cyber` then renames.
 *
 * The mod-to-mod half of the same rule, and the reason it is a separate fixture:
 * a fix that only protected `core:` ids would pass every assertion above and
 * leave every mod-defined record exposed to the next mod that renames it. A copy
 * of a real record so it binds; a name core does not use so nothing collides.
 */
function monstersWithRenamedModWyrm(keepDefiner: boolean): Rec[] {
  const records = loadRecords<Rec>("monster");
  const kobold = records.find((r) => r["name"] === "kobold");
  if (kobold === undefined) throw new Error("fixture: core ships no monster named kobold");
  return [
    ...records,
    {
      ...kobold,
      name: "Cyber Wyrm",
      [PROVENANCE_KEY]: keepDefiner
        ? { owner: "frost", modifiedBy: ["cyber"], was: { name: "Frost Wyrm" } }
        : { owner: "frost", modifiedBy: ["cyber"] },
    },
  ];
}

/** The registry, resolver and the renamed race, for one fixture. */
function renamed(monsters: Rec[], liveName: string) {
  const reg = bindCore(packWith(monsters));
  const ids = new ContentIdResolver(reg);
  const race = reg.monsters.races.find((r) => r.name === liveName);
  if (race === undefined) throw new Error(`fixture: no bound race named ${liveName}`);
  return { reg, ids, race };
}

describe("a patch cannot move the id of a record it does not own", () => {
  it("THE SAVE STILL RESOLVES: the pre-patch id finds the same entity", () => {
    /* The failure this exists for is not a string that changed - it is a save
     * that will not load. A character who met Grip has GRIP_ID written into it,
     * so the assertion is that GRIP_ID still resolves, and resolves to the very
     * race object the renaming mod produced rather than merely to some index. */
    const { reg, ids, race } = renamed(monstersWithRenamedGrip(true), "Grip, the Cyber-Hound");
    const at = ids.raceIndex(GRIP_ID);
    expect(at).toBeDefined();
    expect(reg.monsters.races[at ?? -1]).toBe(race);
    expect(ids.raceId(race.ridx)).toBe(GRIP_ID);
  });

  it("THE CONTROL: the same fixture without the definer's spelling loses the save", () => {
    /* Delete `was` from the stamp - the only thing that changes - and the defect
     * is back, exactly as mod-provenance.node.test.ts pinned it. */
    const { ids, race } = renamed(monstersWithRenamedGrip(false), "Grip, the Cyber-Hound");
    expect(ids.raceIndex(GRIP_ID)).toBeUndefined();
    expect(ids.raceId(race.ridx)).toBe("core:grip-the-cyber-hound");
  });

  it("still resolves the moved id a 0.19.x save may already hold", () => {
    /* Someone who played 0.19.x with a renaming mod installed has the MOVED
     * spelling in their save. Fixing the defect must not strand them - that
     * would be the same defect pointed the other way - so the moved id stays a
     * fallback alias, never a live id. */
    const { ids, race } = renamed(monstersWithRenamedGrip(true), "Grip, the Cyber-Hound");
    expect(ids.raceIndex("core:grip-the-cyber-hound")).toBe(race.ridx);
    expect(ids.raceId(race.ridx)).toBe(GRIP_ID);
  });

  it("moves NO other id in the registry", () => {
    /* The parity half over the whole registry: a rename must cost exactly the
     * renamed record's id and nothing else, because every id here is a string in
     * somebody's save. */
    const plain = bindCore(packWith(loadRecords<Rec>("monster")));
    const plainIds = new ContentIdResolver(plain);
    const before = plain.monsters.races.map((r) => plainIds.raceId(r.ridx));

    const { reg, ids } = renamed(monstersWithRenamedGrip(true), "Grip, the Cyber-Hound");
    const after = reg.monsters.races.map((r) => ids.raceId(r.ridx));
    expect(after).toEqual(before);
  });

  it("the DEFINER wins for a mod's record too, not only core's", () => {
    const { reg, ids, race } = renamed(monstersWithRenamedModWyrm(true), "Cyber Wyrm");
    const at = ids.raceIndex("frost:frost-wyrm");
    expect(at).toBeDefined();
    expect(reg.monsters.races[at ?? -1]).toBe(race);
    expect(ids.raceId(race.ridx)).toBe("frost:frost-wyrm");
    /* The renamer's namespace never appears: `cyber` modified the record, it did
     * not define it, so it owns neither half of the id. */
    expect(ids.raceIndex("cyber:cyber-wyrm")).toBeUndefined();
  });

  it("THE CONTROL: a mod's record loses its id the same way without it", () => {
    const { ids, race } = renamed(monstersWithRenamedModWyrm(false), "Cyber Wyrm");
    expect(ids.raceIndex("frost:frost-wyrm")).toBeUndefined();
    expect(ids.raceId(race.ridx)).toBe("frost:cyber-wyrm");
  });

  it("an unmodded game reads no `was` at all", () => {
    /* The absence control. `asDefined` falls back to the live field, so if it
     * were ever reading something it should not, the base game's own ids are
     * where it would show - and they are the strings every existing save holds. */
    const reg = bindCore(packWith(loadRecords<Rec>("monster")));
    const ids = new ContentIdResolver(reg);
    expect(reg.monsters.races.filter((r) => r.from !== undefined)).toEqual([]);
    expect(ids.raceIndex(GRIP_ID)).toBeDefined();
  });
});

describe("provenanceOf refuses a stamp it cannot trust", () => {
  it("reads a well-formed stamp", () => {
    expect(provenanceOf({ [PROVENANCE_KEY]: { owner: "a", modifiedBy: ["b"] } })).toEqual({
      owner: "a",
      modifiedBy: ["b"],
    });
  });

  it("drops a non-string owner rather than minting a namespace from it", () => {
    /* A record can reach a binder from a hand-written JSON file that never went
     * through the composer. Trusting this would put "[object Object]:kobold" in
     * a savefile. */
    for (const bad of [7, null, {}, [], "", undefined]) {
      expect(provenanceOf({ [PROVENANCE_KEY]: { owner: bad } })).toBeUndefined();
    }
    expect(provenanceOf({ [PROVENANCE_KEY]: "frost" })).toBeUndefined();
    expect(provenanceOf({})).toBeUndefined();
  });

  it("keeps a well-formed `was` and drops one that is not an object", () => {
    expect(
      provenanceOf({ [PROVENANCE_KEY]: { owner: "a", was: { name: "Old" } } }),
    ).toEqual({ owner: "a", was: { name: "Old" } });
    for (const bad of [7, "Old", null, [], undefined]) {
      expect(provenanceOf({ [PROVENANCE_KEY]: { owner: "a", was: bad } })).toEqual({
        owner: "a",
      });
    }
  });

  it("keeps only the string modifiers", () => {
    expect(
      provenanceOf({ [PROVENANCE_KEY]: { owner: "a", modifiedBy: ["b", 3, null] } }),
    ).toEqual({ owner: "a", modifiedBy: ["b"] });
    expect(provenanceOf({ [PROVENANCE_KEY]: { owner: "a", modifiedBy: "b" } })).toEqual({
      owner: "a",
    });
  });
});
