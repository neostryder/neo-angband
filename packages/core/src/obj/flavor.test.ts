import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TV } from "../generated";
import { ObjRegistry } from "./bind";
import type { ObjPackJson, ObjectKind } from "./types";
import { objectNew, tvalCanHaveFlavor } from "./object";
import { FlavorKnowledge } from "./knowledge";
import { flavorInit } from "./flavor";
import { buildProb, randnameMake } from "./randname";
import { Rng } from "../rng";
import { ODESC } from "./desc";
import { makeState } from "../game/harness";
import { describeObject } from "../game/describe";
import type { GameState } from "../game/context";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
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
} as unknown as ObjPackJson;

const namesJson = loadJson<{
  records: Array<{ section: number; word: string[] }>;
}>("names");
const nameSections = new Map<number, string[]>();
for (const rec of namesJson.records) nameSections.set(rec.section, rec.word);

function buildReg(): ObjRegistry {
  return new ObjRegistry(objPack);
}

function runInit(reg: ObjRegistry, seed: number) {
  const awareness = new FlavorKnowledge(reg.ordinaryKindCount);
  const assignment = flavorInit(seed, awareness, {
    kinds: reg.kinds,
    flavors: reg.flavors,
    ordinaryKindCount: reg.ordinaryKindCount,
    nameSections,
  });
  return { awareness, assignment };
}

describe("flavorInit (obj-util.c flavor_init)", () => {
  it("assigns a flavour to every flavoured ordinary kind", () => {
    const r = buildReg();
    const { assignment } = runInit(r, 12345);
    for (const kind of r.kinds) {
      if (kind.kidx >= r.ordinaryKindCount) continue;
      if (!kind.name) continue;
      if (tvalCanHaveFlavor(kind.tval)) {
        expect(assignment.hasFlavor(kind)).toBe(true);
        expect(assignment.text(kind).length).toBeGreaterThan(0);
      }
    }
  });

  it("marks non-flavoured ordinary kinds aware", () => {
    const r = buildReg();
    const { awareness, assignment } = runInit(r, 777);
    const torch = r.kinds.find((k) => k.name.includes("Torch"));
    expect(torch).toBeDefined();
    expect(tvalCanHaveFlavor(torch!.tval)).toBe(false);
    expect(assignment.hasFlavor(torch!)).toBe(false);
    expect(awareness.isAware(torch!)).toBe(true);

    /* A flavoured kind is NOT auto-aware (must be identified in play). */
    const potion = r.kinds.find((k) => k.tval === TV.POTION);
    expect(awareness.isAware(potion!)).toBe(false);
  });

  it("is deterministic in the seed", () => {
    const a = runInit(buildReg(), 42);
    const b = runInit(buildReg(), 42);
    const c = runInit(buildReg(), 43);
    expect(a.assignment.snapshot()).toEqual(b.assignment.snapshot());
    expect(a.assignment.snapshot()).not.toEqual(c.assignment.snapshot());
  });

  it("generates quoted scroll titles", () => {
    const r = buildReg();
    const { assignment } = runInit(r, 9);
    const scroll = r.kinds.find((k) => k.tval === TV.SCROLL);
    const title = assignment.text(scroll!);
    expect(title.startsWith('"')).toBe(true);
    expect(title.endsWith('"')).toBe(true);
    /* "word word" -> at least two chars of letters between the quotes. */
    expect(title.length).toBeGreaterThan(3);
  });
});

describe("randnameMake (randname.c)", () => {
  it("produces bounded, voweled words deterministically", () => {
    const words = nameSections.get(2) ?? [];
    const probs = buildProb(words);
    const rngA = new Rng(555, { quick: true });
    const rngB = new Rng(555, { quick: true });
    for (let i = 0; i < 50; i++) {
      const w = randnameMake(rngA, 2, 8, probs);
      expect(w.length).toBeGreaterThanOrEqual(2);
      expect(w.length).toBeLessThanOrEqual(8);
      expect(/[aeiou]/.test(w)).toBe(true);
      /* Same seed -> same stream. */
      expect(randnameMake(rngB, 2, 8, probs)).toBe(w);
    }
  });
});

describe("describeObject with flavours (obj_desc_get_basename show_flavor)", () => {
  function stateFor(
    assignment: ReturnType<typeof runInit>["assignment"],
    aware: boolean,
  ): GameState {
    const state = makeState();
    state.hasFlavor = (kind) => assignment.hasFlavor(kind);
    state.flavorText = (kind) => assignment.text(kind);
    state.isAware = () => aware;
    return state;
  }

  it("shows the flavour, never the real kind, while unaware", () => {
    const r = buildReg();
    const { assignment } = runInit(r, 2024);
    const potionKind = r.kinds.find(
      (k) => k.tval === TV.POTION,
    ) as ObjectKind;
    const flavour = assignment.text(potionKind).replace(/[~|&]/g, "");

    const state = stateFor(assignment, false);
    const obj = objectNew(potionKind);
    obj.tval = potionKind.tval;
    obj.sval = potionKind.sval;
    obj.number = 1;

    const name = describeObject(state, obj, ODESC.PREFIX | ODESC.FULL);
    expect(name).toContain(flavour);
    expect(name).toContain("Potion");
    expect(name).not.toContain(`of ${potionKind.name}`);
  });

  it("adds the real kind once aware", () => {
    const r = buildReg();
    const { assignment } = runInit(r, 2024);
    const potionKind = r.kinds.find(
      (k) => k.tval === TV.POTION,
    ) as ObjectKind;

    const state = stateFor(assignment, true);
    const obj = objectNew(potionKind);
    obj.tval = potionKind.tval;
    obj.sval = potionKind.sval;
    obj.number = 1;

    const name = describeObject(state, obj, ODESC.PREFIX | ODESC.FULL);
    expect(name).toContain(`of ${potionKind.name}`);
  });
});
