/**
 * Provenance: which pack a record came from, from the composer's stamp through
 * binding and out into the id a savefile stores.
 *
 * THE CONTROL IS THE POINT OF THIS FILE. Every assertion about a namespaced id
 * is paired with the SAME pack bound without the stamp, because the id scheme
 * has always been able to produce a unique string for a mod's record - it just
 * produced the wrong one (`core:kobold-2`, a number decided by load order). A
 * test that only asserted the new id would pass against an engine that had
 * simply renamed something, and would say nothing about whether provenance was
 * what did the work.
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
 * Core's monsters with one more on the end: a copy of core's own "kobold",
 * optionally carrying a mod's stamp.
 *
 * A COPY OF A REAL RECORD rather than a hand-written one, because a monster
 * that does not bind proves nothing, and a fixture written to satisfy the
 * binder is an assertion about the binder that nobody checked. The NAME is
 * deliberately one core already uses: the collision is the interesting case,
 * and it is the case the old scheme resolved with an order-dependent suffix.
 */
function monstersWithModKobold(stamped: boolean): Rec[] {
  const records = loadRecords<Rec>("monster");
  const kobold = records.find((r) => r["name"] === "kobold");
  if (kobold === undefined) throw new Error("fixture: core ships no monster named kobold");
  const added: Rec = { ...kobold };
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

/** The LAST race named Kobold - the appended one - and core's own first. */
function koboldIndices(reg: typeof modded): { core: number; added: number } {
  const at = reg.monsters.races
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.name === "kobold")
    .map(({ i }) => i);
  const core = at[0];
  const added = at[at.length - 1];
  if (core === undefined || added === undefined || core === added) {
    throw new Error(`fixture: expected two races named kobold, found ${at.length}`);
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
    expect(moddedIds.raceId(added)).toBe("frost:kobold");
  });

  it("leaves core's record's id exactly as it was", () => {
    const { core } = koboldIndices(modded);
    expect(moddedIds.raceId(core)).toBe("core:kobold");
    /* Not just "core's id is right in the new world" - the SAME string the
     * engine minted before any of this existed. A save written yesterday still
     * finds core's kobold. */
    expect(moddedIds.raceId(core)).toBe(unstampedIds.raceId(koboldIndices(unstamped).core));
  });

  it("THE CONTROL: without the stamp the same pack still collides", () => {
    /* This is what shipped. The mod's monster took a suffix off core's name,
     * and which suffix depended on how many other mods had got there first. */
    const { added } = koboldIndices(unstamped);
    expect(unstampedIds.raceId(added)).toBe("core:kobold-2");
  });

  it("still resolves the id an older engine wrote for it", () => {
    /* The compatibility half. A character saved before 0.19.0 has
     * `core:kobold-2` written into it; that string must still find the mod's
     * monster, or the save loses content because the engine improved. */
    const { added } = koboldIndices(modded);
    expect(moddedIds.raceIndex("core:kobold-2")).toBe(added);
    expect(moddedIds.raceIndex("frost:kobold")).toBe(added);
  });

  it("never lets a legacy id shadow a live one", () => {
    /* Exact-first. `core:kobold` is a live id AND the legacy id of core's own
     * kobold, so the two agree here - the assertion is that the live table is
     * consulted first, which is what makes a collision impossible in general. */
    const { core } = koboldIndices(modded);
    expect(moddedIds.raceIndex("core:kobold")).toBe(core);
  });

  it("returns undefined for an id no pack supplies", () => {
    expect(moddedIds.raceIndex("frost:kobold-2")).toBeUndefined();
    expect(moddedIds.raceIndex("nobody:kobold")).toBeUndefined();
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

  it("keeps only the string modifiers", () => {
    expect(
      provenanceOf({ [PROVENANCE_KEY]: { owner: "a", modifiedBy: ["b", 3, null] } }),
    ).toEqual({ owner: "a", modifiedBy: ["b"] });
    expect(provenanceOf({ [PROVENANCE_KEY]: { owner: "a", modifiedBy: "b" } })).toEqual({
      owner: "a",
    });
  });
});
