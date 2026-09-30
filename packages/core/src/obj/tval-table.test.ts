/**
 * Item classes a pack declares in tval.json (obj/tval-table.ts).
 *
 * The case that needs it: Angband 3.x's junk (Empty Bottle, Broken Skull, the
 * skeletons) belonged to classes 4.2 no longer has, and a kind of an unknown
 * class stops the bind with `object: unknown tval`.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { bindCore } from "../session/boot.js";
import type { CorePack } from "../session/boot.js";
import { ContentIdResolver, kindLocalId } from "../mod/ids.js";
import { deserializeIgnore, deserializeObject, serializeIgnore, serializeObject } from "../session/save.js";
import type { SavedIgnoreSettings, SavedObject } from "../session/save.js";
import { tvalFindIdx, tvalFindName } from "./bind.js";
import { objectDesc, ODESC } from "./desc.js";
import { makeRuneEnv } from "./knowledge.js";
import { ObjAllocState } from "./make.js";
import { objectNew, tvalCanHaveFlavor, tvalIsWearable } from "./object.js";
import { declareModTvals, FIRST_MOD_TVAL, tvals } from "./tval-table.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const BOTTLE = {
  name: "& Empty Bottle~",
  type: "junk",
  graphics: { glyph: "!", color: "w" },
  level: 0,
  weight: 2,
  cost: 0,
  alloc: { common: 50, minmax: "0 to 40" },
  desc: ["An empty bottle."],
};

/** The shipped pack, with the junk base and one junk kind added to its object files unless `withJunk` is false. */
function junkPack(declared: readonly unknown[] | undefined, withJunk = true): CorePack {
  const objectBase = loadJson<{ records: unknown[] }>("object_base");
  const object = loadJson<{ records: unknown[] }>("object");
  const junkBase = withJunk ? [{ name: { tval: "junk", name: "Junk" }, graphics: "white" }] : [];
  const junkKinds = withJunk ? [BOTTLE] : [];
  return {
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
      objectBase: { ...objectBase, records: [...objectBase.records, ...junkBase] },
      object: { ...object, records: [...object.records, ...junkKinds] },
      egoItem: loadJson("ego_item"),
      artifact: loadJson("artifact"),
      curse: loadJson("curse"),
      brand: loadJson("brand"),
      slay: loadJson("slay"),
      activation: loadJson("activation"),
      objectProperty: loadJson("object_property"),
      flavor: loadJson("flavor"),
    },
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
    ...(declared ? { tvals: declared } : {}),
  } as unknown as CorePack;
}

afterEach(() => {
  tvals.clear();
});

describe("the declared-class table", () => {
  it("numbers declared classes after the compiled ones, and looks both up", () => {
    expect(tvals.add("junk").tval).toBe(FIRST_MOD_TVAL);
    expect(tvals.add("Skeleton").tval).toBe(FIRST_MOD_TVAL + 1);
    expect(tvals.lookup("skeleton")).toBe(FIRST_MOD_TVAL + 1);
    expect(tvals.nameAt(FIRST_MOD_TVAL)).toBe("junk");
    expect(tvals.lookup("food")).toBeGreaterThan(0);
    expect(tvals.max).toBe(FIRST_MOD_TVAL + 2);
    expect(tvalFindIdx("junk")).toBe(FIRST_MOD_TVAL);
    expect(tvalFindName(FIRST_MOD_TVAL + 1)).toBe("skeleton");
  });

  it("refuses a compiled name, a duplicate, a number and an empty name, without throwing", () => {
    tvals.add("junk");
    const result = declareModTvals([{ name: "food" }, { name: "junk" }, { name: "12" }, { name: "" }, { nom: "x" }, 7]);
    expect(result.declared).toEqual([]);
    expect(result.refused).toHaveLength(6);
    expect(tvals.max).toBe(FIRST_MOD_TVAL + 1);
  });

  it("forgets every declared class on clear", () => {
    tvals.add("junk");
    tvals.clear();
    expect(tvals.lookup("junk")).toBe(-1);
    expect(tvals.max).toBe(FIRST_MOD_TVAL);
  });
});

describe("a pack that declares junk", () => {
  it("binds a kind and a base of the declared class", () => {
    const reg = bindCore(junkPack([{ name: "junk" }]));
    const bottle = reg.objects.kinds.find((k) => k?.name === BOTTLE.name);
    expect(bottle?.tval).toBe(FIRST_MOD_TVAL);
    expect(reg.objects.bases[FIRST_MOD_TVAL]?.name).toBe("Junk");
    expect(kindLocalId(bottle!.tval, bottle!.name)).toBe("junk:empty-bottle");
  });

  it("gets a class that cannot be worn or flavoured until a mod says otherwise", () => {
    bindCore(junkPack([{ name: "junk" }]));
    expect(tvalIsWearable(FIRST_MOD_TVAL)).toBe(false);
    expect(tvalCanHaveFlavor(FIRST_MOD_TVAL)).toBe(false);
  });

  it("is named by its kind until a mod registers a template for the class", () => {
    const reg = bindCore(junkPack([{ name: "junk" }]));
    const kind = reg.objects.kinds.find((k) => k?.name === BOTTLE.name)!;
    const obj = Object.assign(objectNew(kind), { tval: kind.tval, sval: kind.sval, number: 2 });
    const rng = new Rng(1);
    const env = makeRuneEnv(() => null, (v) => rng.randcalcVaries(v), {
      brands: reg.objects.brands,
      slays: reg.objects.slays,
      curses: reg.objects.curses,
      properties: reg.objects.properties,
      elementNames: [],
      msg: () => {},
    });
    const name = objectDesc(obj, ODESC.PREFIX | ODESC.FULL, null, env, { isAware: () => true, isTried: () => false });
    expect(name).toBe("2 Empty Bottles");
  });

  it("allocates the kind by its own class without spilling into the next depth", () => {
    const reg = bindCore(junkPack([{ name: "junk" }]));
    const alloc = new ObjAllocState(reg.objects, reg.constants);
    const rng = new Rng(3);
    const constants = { ...reg.constants, greatObj: 1_000_000 };
    expect(alloc.getObjNum(rng, constants, 10, false, FIRST_MOD_TVAL)?.name).toBe(BOTTLE.name);
    expect(alloc.getObjNum(rng, constants, 60, false, FIRST_MOD_TVAL)).toBeNull();
  });

  it("stops the bind when the class is not declared", () => {
    expect(() => bindCore(junkPack(undefined))).toThrow(/unknown tval junk/u);
  });
});

describe("a saved object of a declared class", () => {
  it("reloads under the class's new number when another mod's class takes its old one", () => {
    const first = bindCore(junkPack([{ name: "junk" }]));
    const kind = first.objects.kinds.find((k) => k?.name === BOTTLE.name)!;
    const obj = Object.assign(objectNew(kind), { tval: kind.tval, sval: kind.sval, number: 1 });
    const saved = JSON.parse(
      JSON.stringify(serializeObject(obj, new ContentIdResolver(first))),
    ) as SavedObject;
    expect(saved.tval).toBe(FIRST_MOD_TVAL);

    const second = bindCore(junkPack([{ name: "skeleton" }, { name: "junk" }]));
    const back = deserializeObject(saved, second.objects, new ContentIdResolver(second));
    expect(back.kind.name).toBe(BOTTLE.name);
    expect(back.tval).toBe(FIRST_MOD_TVAL + 1);
    expect(back.tval).toBe(back.kind.tval);
  });
});

describe("a declared class in the ignore menus", () => {
  it("offers kind ignoring only for a class whose record names an ignoreMenu label, in declaration order", () => {
    const result = declareModTvals([
      { name: "junk", ignoreMenu: "Junk" },
      { name: "skeleton" },
      { name: "bottle", ignoreMenu: " Bottles " },
    ]);
    expect(result.refused).toEqual([]);
    expect(tvals.ignoreCategories()).toEqual([
      { tval: FIRST_MOD_TVAL, desc: "Junk" },
      { tval: FIRST_MOD_TVAL + 2, desc: "Bottles" },
    ]);
  });

  it("offers none when no class opts in", () => {
    declareModTvals([{ name: "junk" }]);
    expect(tvals.ignoreCategories()).toEqual([]);
  });

  it("refuses a malformed ignoreMenu and still declares the class", () => {
    const result = declareModTvals([{ name: "junk", ignoreMenu: "" }, { name: "skeleton", ignoreMenu: 3 }]);
    expect(result.declared).toEqual(["junk", "skeleton"]);
    expect(result.refused).toHaveLength(2);
    expect(tvals.ignoreCategories()).toEqual([]);
  });

  it("saves a kind ignore on an opted-in class by id, and reloads it under another mod set", () => {
    const first = bindCore(junkPack([{ name: "junk", ignoreMenu: "Junk" }]));
    const kidx = first.objects.kinds.find((k) => k?.name === BOTTLE.name)!.kidx;
    const saved = JSON.parse(
      JSON.stringify(
        serializeIgnore(
          { level: [], ego: [], kindAware: [kidx], kindUnaware: [kidx], unignoring: false },
          new ContentIdResolver(first),
        ),
      ),
    ) as SavedIgnoreSettings;
    const id = new ContentIdResolver(first).kindIdOrNull(kidx);
    expect(saved.kindAware).toEqual([id]);
    expect(saved.kindUnaware).toEqual([id]);

    const second = bindCore(junkPack([{ name: "skeleton" }, { name: "junk", ignoreMenu: "Junk" }]));
    const back = deserializeIgnore(saved, new ContentIdResolver(second));
    const kidx2 = second.objects.kinds.find((k) => k?.name === BOTTLE.name)!.kidx;
    expect(back.kindAware).toEqual([kidx2]);
    expect(back.kindUnaware).toEqual([kidx2]);
  });

  it("drops the kind ignore without error when the mod that declared the class is gone", () => {
    const first = bindCore(junkPack([{ name: "junk", ignoreMenu: "Junk" }]));
    const kidx = first.objects.kinds.find((k) => k?.name === BOTTLE.name)!.kidx;
    const saved = JSON.parse(
      JSON.stringify(
        serializeIgnore({ level: [], ego: [], kindAware: [kidx], kindUnaware: [], unignoring: false }, new ContentIdResolver(first)),
      ),
    ) as SavedIgnoreSettings;

    const plain = bindCore(junkPack(undefined, false));
    expect(tvals.ignoreCategories()).toEqual([]);
    const back = deserializeIgnore(saved, new ContentIdResolver(plain));
    expect(back.kindAware).toEqual([]);
  });
});
