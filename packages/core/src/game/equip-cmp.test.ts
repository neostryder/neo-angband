/**
 * Tests for the equip-cmp screen's model (ui-equip-cmp.c initialize_summary /
 * filter_items / sort_items / compute_player_and_equipment_values), ported in
 * game/equip-cmp.ts. Builds a real UiEntryConfig from the shipped pack data
 * (same fixture pattern as ui-entry.test.ts) and real objects (effect-item.
 * test.ts's makeObj pattern) so the property columns and quality/slot/source
 * logic are exercised against genuine game data, not synthetic stand-ins.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { TV } from "../generated/index.js";
import { Rng } from "../rng.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import { makeRuneEnv } from "../obj/knowledge.js";
import { makeState } from "./harness.js";
import type { GameState } from "./context.js";
import { FEAT } from "../generated/index.js";
import type { Store } from "../store/store.js";
import {
  cycleStoreInclusion,
  equipCmpFilterKeeps,
  equipCmpSummary,
  matchEquipCmpFilter,
} from "./equip-cmp.js";
import type { UiEntryPackRecords } from "./ui-entry.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}

const objPack: ObjPackJson = {
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
} as ObjPackJson;

const objReg = new ObjRegistry(objPack);
const constants = bindConstants(loadJson("constants"));

function packRecords(name: string): unknown[] {
  return (loadJson<{ records: unknown[] }>(name)).records;
}

const uiPacks: UiEntryPackRecords = {
  uiEntry: packRecords("ui_entry") as never,
  uiEntryBase: packRecords("ui_entry_base") as never,
  uiEntryRenderer: packRecords("ui_entry_renderer") as never,
  objectProperty: packRecords("object_property") as never,
  playerProperty: packRecords("player_property") as never,
};

function makeObj(tval: number, nth = 0): GameObject {
  const kinds = objReg.kinds.filter((k) => k.tval === tval && k.kidx < objReg.ordinaryKindCount);
  const kind = kinds[nth];
  if (!kind) throw new Error(`no ordinary kind #${nth} for tval ${tval}`);
  return objectPrep(new Rng(9), objReg, constants, kind, 0, "average");
}

/** Back the state's rune env (needed by describeObject / shortName). */
function equipArray(state: GameState): (GameObject | null)[] {
  const eq: (GameObject | null)[] = new Array(state.actor.player.body.count).fill(null);
  state.runeEnv = makeRuneEnv(
    (slot) => eq[slot] ?? null,
    (v) => state.rng.randcalcVaries(v),
  );
  return eq;
}

function slotOf(state: GameState, type: string): number {
  const at = state.actor.player.body.slots.findIndex((s) => s.type === type);
  expect(at).toBeGreaterThanOrEqual(0);
  return at;
}

/** Wear an object in its natural slot type, keeping the runeEnv mirror in sync. */
function wear(state: GameState, eq: (GameObject | null)[], obj: GameObject, type: string): number {
  const slot = slotOf(state, type);
  const handle = state.gear.next++;
  state.gear.store.set(handle, obj);
  state.actor.player.equipment[slot] = handle;
  eq[slot] = obj;
  return handle;
}

function carryInPack(state: GameState, obj: GameObject): number {
  const handle = state.gear.next++;
  state.gear.store.set(handle, obj);
  state.gear.pack.push(handle);
  return handle;
}

describe("cycleStoreInclusion (ui-equip-cmp.c ACT_CTX_EQUIPCMP_CYCLE_SOURCES)", () => {
  it("cycles no-store -> only-store -> yes-store -> only-carried -> no-store", () => {
    expect(cycleStoreInclusion("no-store")).toBe("only-store");
    expect(cycleStoreInclusion("only-store")).toBe("yes-store");
    expect(cycleStoreInclusion("yes-store")).toBe("only-carried");
    expect(cycleStoreInclusion("only-carried")).toBe("no-store");
  });
});

describe("equipCmpSummary (ui-equip-cmp.c initialize_summary)", () => {
  it("has columns for every EQUIPCMP_SCREEN property and a same-length combined row, even with nothing worn", () => {
    const state = makeState();
    equipArray(state);
    const model = equipCmpSummary(state, uiPacks);
    expect(model.columns.length).toBeGreaterThan(0);
    expect(model.combinedCells).toHaveLength(model.columns.length);
    expect(model.items).toHaveLength(0);
  });

  it("gathers worn, pack, and floor wearables with the right source tag", () => {
    const state = makeState();
    const eq = equipArray(state);
    const sword = makeObj(TV.SWORD);
    wear(state, eq, sword, "WEAPON");
    const cloak = makeObj(TV.CLOAK);
    carryInPack(state, cloak);

    const model = equipCmpSummary(state, uiPacks);
    const bySrc = (src: string) => model.items.filter((i) => i.src === src);
    expect(bySrc("worn")).toHaveLength(1);
    expect(bySrc("pack")).toHaveLength(1);
    expect(bySrc("worn")[0]!.obj).toBe(sword);
    expect(bySrc("pack")[0]!.obj).toBe(cloak);
  });

  it("excludes store goods by default (easy_filt NO_STORE)", () => {
    const state = makeState();
    equipArray(state);
    const storeItem = makeObj(TV.CLOAK, 1);
    const store: Store = { feat: FEAT.STORE_GENERAL, stock: [storeItem] } as unknown as Store;
    state.stores = [store];

    const model = equipCmpSummary(state, uiPacks);
    expect(model.items.some((i) => i.src === "store")).toBe(false);
  });

  it("only-store shows just the store goods; yes-store shows everything; only-carried drops floor/home/store", () => {
    const state = makeState();
    const eq = equipArray(state);
    const sword = makeObj(TV.SWORD);
    wear(state, eq, sword, "WEAPON");
    const storeItem = makeObj(TV.CLOAK, 1);
    const store: Store = { feat: FEAT.STORE_GENERAL, stock: [storeItem] } as unknown as Store;
    state.stores = [store];

    const onlyStore = equipCmpSummary(state, uiPacks, { source: "only-store" });
    expect(onlyStore.items).toHaveLength(1);
    expect(onlyStore.items[0]!.src).toBe("store");

    const yesStore = equipCmpSummary(state, uiPacks, { source: "yes-store" });
    expect(yesStore.items.map((i) => i.src).sort()).toEqual(["store", "worn"]);

    const onlyCarried = equipCmpSummary(state, uiPacks, { source: "only-carried" });
    expect(onlyCarried.items.every((i) => i.src === "worn" || i.src === "pack")).toBe(true);
  });

  it("identifies the HOME store (FEAT.HOME) separately from ordinary stores", () => {
    const state = makeState();
    equipArray(state);
    const homeItem = makeObj(TV.CLOAK, 1);
    const home: Store = { feat: FEAT.HOME, stock: [homeItem] } as unknown as Store;
    state.stores = [home];

    const model = equipCmpSummary(state, uiPacks, { source: "yes-store" });
    expect(model.items).toHaveLength(1);
    expect(model.items[0]!.src).toBe("home");
  });

  it("sorts by slot, then source, then quality, then short name (default_sort)", () => {
    const state = makeState();
    const eq = equipArray(state);
    const wornSword = makeObj(TV.SWORD);
    wear(state, eq, wornSword, "WEAPON");
    const packSword = makeObj(TV.SWORD, 1);
    carryInPack(state, packSword);
    const cloak = makeObj(TV.CLOAK);
    carryInPack(state, cloak);

    const model = equipCmpSummary(state, uiPacks, { source: "yes-store" });
    // Slot ascending first: whichever slot type sorts lower comes first, and
    // within the same slot, worn (src rank 0) precedes pack (src rank 1).
    const swordSlotIdx = model.items.findIndex((i) => i.obj === wornSword);
    const packSwordIdx = model.items.findIndex((i) => i.obj === packSword);
    expect(swordSlotIdx).toBeLessThan(packSwordIdx);
    // Monotonic non-decreasing slot across the whole sorted list.
    for (let i = 1; i < model.items.length; i++) {
      expect(model.items[i]!.slot).toBeGreaterThanOrEqual(model.items[i - 1]!.slot);
    }
  });

  it("reverse flips the sorted order", () => {
    const state = makeState();
    const eq = equipArray(state);
    wear(state, eq, makeObj(TV.SWORD), "WEAPON");
    carryInPack(state, makeObj(TV.CLOAK));

    const forward = equipCmpSummary(state, uiPacks);
    const reversed = equipCmpSummary(state, uiPacks, { reverse: true });
    expect(reversed.items.map((i) => i.obj)).toEqual(forward.items.map((i) => i.obj).slice().reverse());
  });

  it("gives each item one cell per column, and the combined row folds in the equipped item", () => {
    const state = makeState();
    const eq = equipArray(state);
    const sword = makeObj(TV.SWORD);
    wear(state, eq, sword, "WEAPON");

    const model = equipCmpSummary(state, uiPacks);
    const item = model.items.find((i) => i.obj === sword)!;
    expect(item.cells).toHaveLength(model.columns.length);
    expect(item.equippyCh).toBe(sword.kind.dChar);
  });

  it("truncates the short name to 20 characters", () => {
    const state = makeState();
    equipArray(state);
    const cloak = makeObj(TV.CLOAK);
    carryInPack(state, cloak);
    const model = equipCmpSummary(state, uiPacks);
    const item = model.items.find((i) => i.obj === cloak)!;
    expect(item.shortName.length).toBeLessThanOrEqual(20);
  });

  it("draws no RNG (a pure display model over already-computed object/player state)", () => {
    const state = makeState();
    const eq = equipArray(state);
    wear(state, eq, makeObj(TV.SWORD), "WEAPON");
    carryInPack(state, makeObj(TV.CLOAK));

    let calls = 0;
    const real = state.rng;
    state.rng = new Proxy(real, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver) as unknown;
        if (typeof v === "function") {
          return (...args: unknown[]) => {
            calls++;
            return (v as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return v;
      },
    }) as typeof real;

    equipCmpSummary(state, uiPacks);
    expect(calls).toBe(0);
  });

  it("shows mundane gear as known, not as '?' down every column", () => {
    /* object_flag_is_known / object_element_is_known take object_fully_known as
     * their first route out (obj-knowledge.c:777, 799). A plain cloak carries no
     * runes, so it IS fully known and every cell must be a real value rather
     * than the unknown marker. Reading p->obj_k alone printed '?' for all of it -
     * the character sheet's resist grid had this and was fixed; this screen was
     * still doing it (seen live: a Dagger, two torches and soft leather armour
     * all '?' across the grid). */
    const state = makeState();
    equipArray(state);
    /* A plain cloak has no runes, no pval, no to_h/to_d - nothing left to learn,
     * so object_fully_known is true and every column reads as a real value. (An
     * unidentified weapon is a different case: its combat runes genuinely are
     * unknown and '?' is right for it, which is why this is scoped to gear with
     * nothing to learn.) */
    const cloak = makeObj(TV.CLOAK);
    carryInPack(state, cloak);

    const model = equipCmpSummary(state, uiPacks);
    const item = model.items.find((i) => i.obj === cloak);
    expect(item).toBeDefined();
    expect(item!.cells.some((c) => c.symbol === "?")).toBe(false);
  });
});

/**
 * prompt_for_easy_filter (ui-equip-cmp.c:1229) and the six selector functions
 * (L1643-1682) behind the 'q' / '!' quick filter, which was skipped as a "UI
 * convenience" and is in fact a default part of the screen.
 */
describe("the equip-cmp quick filter", () => {
  /** A model with real columns to match codes against. */
  function model() {
    const state = makeState();
    const eq = equipArray(state);
    wear(state, eq, makeObj(TV.SWORD), "WEAPON");
    carryInPack(state, makeObj(TV.CLOAK));
    return equipCmpSummary(state, uiPacks);
  }

  it("matches a two-character column code, in any of upstream's capitalisations", () => {
    const m = model();
    const acid = m.columns.findIndex((c) => c.label === "Ac");
    expect(acid).toBeGreaterThanOrEqual(0);
    for (const code of ["Ac", "AC", "ac", "aC"]) {
      expect(matchEquipCmpFilter(m.columns, code, false), code).toEqual({
        column: acid,
        not: false,
      });
    }
  });

  it("matches a three-character stat code against the 3-char label", () => {
    const m = model();
    const stat = m.columns.find((c) => c.category === "stat_modifiers");
    expect(stat).toBeDefined();
    const code = stat!.label3.trim();
    expect(code.length).toBe(3);
    const hit = matchEquipCmpFilter(m.columns, code, false);
    expect(hit).not.toBeNull();
    expect(m.columns[hit!.column]!.label3).toBe(stat!.label3);
  });

  it("returns null for a code that names nothing (filter unchanged)", () => {
    const m = model();
    expect(matchEquipCmpFilter(m.columns, "zz", false)).toBeNull();
    /* A single character cannot match: the C compares wc[0] AND wc[1], and every
     * column label is two characters wide. */
    expect(matchEquipCmpFilter(m.columns, "A", false)).toBeNull();
  });

  it("carries the ! sense through", () => {
    const m = model();
    expect(matchEquipCmpFilter(m.columns, "Ac", true)?.not).toBe(true);
  });

  it("applies the right selector for each property category", () => {
    const m = model();
    const pick = (cat: string): number => {
      const i = m.columns.findIndex((c) => c.category === cat);
      expect(i, cat).toBeGreaterThanOrEqual(0);
      return i;
    };
    const vals = (i: number, v: number): number[] => {
      const out = new Array<number>(m.columns.length).fill(0);
      out[i] = v;
      return out;
    };
    const keeps = (i: number, v: number, not = false): boolean =>
      equipCmpFilterKeeps(m.columns, { column: i, not }, vals(i, v));

    /* Resistance: sel_at_least_resists is val >= 1, so a vulnerability (-1) and
     * plain absence (0) both fail. */
    const res = pick("resistances");
    expect(keeps(res, 1)).toBe(true);
    expect(keeps(res, 3)).toBe(true);
    expect(keeps(res, 0)).toBe(false);
    expect(keeps(res, -1)).toBe(false);

    /* An ability is a flag where ON is wanted: sel_has_flag, val != 0. */
    const abil = pick("abilities");
    expect(keeps(abil, 1)).toBe(true);
    expect(keeps(abil, 0)).toBe(false);

    /* A hindrance is the INVERTED one: the desirable state is off, so plain 'q'
     * keeps the items that do NOT have it (sel_does_not_have_flag). */
    const hind = pick("hindrances");
    expect(keeps(hind, 0)).toBe(true);
    expect(keeps(hind, 1)).toBe(false);
    expect(keeps(hind, 1, true)).toBe(true);

    /* Modifiers: sel_has_pos_mod is strictly positive. */
    for (const cat of ["modifiers", "stat_modifiers"]) {
      const mod = pick(cat);
      expect(keeps(mod, 2), cat).toBe(true);
      expect(keeps(mod, 0), cat).toBe(false);
      expect(keeps(mod, -2), cat).toBe(false);
      expect(keeps(mod, -2, true), cat).toBe(true);
    }
  });

  it("narrows the model when passed as an option, and ! is its complement", () => {
    const state = makeState();
    const eq = equipArray(state);
    /* The dagger's combat runes are unlearned, so its acid cell is
     * UI_ENTRY_UNKNOWN_VALUE; the cloak has nothing to learn and reads 0. */
    const dagger = makeObj(TV.SWORD);
    wear(state, eq, dagger, "WEAPON");
    const cloak = makeObj(TV.CLOAK);
    carryInPack(state, cloak);

    const all = equipCmpSummary(state, uiPacks);
    const acid = all.columns.findIndex((c) => c.label === "Ac");
    const only = equipCmpSummary(state, uiPacks, { filter: { column: acid, not: false } });
    const not = equipCmpSummary(state, uiPacks, { filter: { column: acid, not: true } });

    /* An UNKNOWN value is a huge positive int, so it satisfies
     * sel_at_least_resists (val >= 1) - upstream tests the same raw vals[] array
     * and behaves the same way, keeping unidentified gear in a "resists X"
     * filter. The known-zero cloak is dropped. */
    expect(only.items.map((i) => i.obj)).toEqual([dagger]);
    expect(not.items.map((i) => i.obj)).toEqual([cloak]);
    /* The two halves always partition the unfiltered set. */
    expect(only.items.length + not.items.length).toBe(all.items.length);
  });
});
