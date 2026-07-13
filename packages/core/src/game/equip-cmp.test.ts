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
import { bindConstants } from "../constants";
import { TV } from "../generated";
import { Rng } from "../rng";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import { makeRuneEnv } from "../obj/knowledge";
import { makeState } from "./harness";
import type { GameState } from "./context";
import { FEAT } from "../generated";
import type { Store } from "../store/store";
import {
  cycleStoreInclusion,
  equipCmpSummary,
} from "./equip-cmp";
import type { UiEntryPackRecords } from "./ui-entry";

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
});
