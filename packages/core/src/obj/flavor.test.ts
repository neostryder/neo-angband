import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KF, TV } from "../generated/index.js";
import { ObjRegistry } from "./bind.js";
import type { ObjPackJson, ObjectKind } from "./types.js";
import { objectNew, tvalCanHaveFlavor } from "./object.js";
import { FlavorKnowledge } from "./knowledge.js";
import { flavorInit } from "./flavor.js";
import { registerBookKinds } from "../player/spell.js";
import { bindPlayer } from "../player/bind.js";
import type { PlayerPackRecords } from "../player/bind.js";
import { buildProb, randnameMake } from "./randname.js";
import { Rng } from "../rng.js";
import { ODESC } from "./desc.js";
import { makeState } from "../game/harness.js";
import { describeObject } from "../game/describe.js";
import type { GameState } from "../game/context.js";

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
/* Match bindCore: names.txt words are prepended in C; reverse per section. */
const nameSections = new Map<number, string[]>();
for (const rec of namesJson.records) nameSections.set(rec.section, [...rec.word].reverse());

/** The bound player domain, for the class-book kinds (registerBookKinds). */
function boundPlayers(): ReturnType<typeof bindPlayer> {
  return bindPlayer({
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  } as PlayerPackRecords);
}

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

describe("flavorInit: class spellbooks (init.c write_book_kind)", () => {
  /**
   * A spellbook is an ORDINARY object: upstream creates its kind while parsing
   * class.txt and bumps ordinary_kind_max with it (init.c:222-224), so
   * flavor_init marks it aware and a store never tags it. The port appends book
   * kinds AFTER the INSTA_ART dummies, so the awareness rule tests the
   * INSTA_ART flag rather than the index - with the index test every book stayed
   * unaware and every book in a store read "... {unseen}".
   */
  it("marks a book kind aware even though it sits above ordinaryKindCount", () => {
    const r = buildReg();
    registerBookKinds(r, boundPlayers().classes);
    const book = r.kinds.find((k) => k.name.includes("[First Spells]"));
    expect(book).toBeDefined();
    // The port's own layout: books really are past the cap.
    expect(book!.kidx).toBeGreaterThanOrEqual(r.ordinaryKindCount);
    expect(book!.kindFlags.has(KF.INSTA_ART)).toBe(false);
    const { awareness } = runInit(r, 4242);
    expect(awareness.isAware(book!)).toBe(true);
  });

  it("leaves the INSTA_ART special-artifact dummies unaware", () => {
    const r = buildReg();
    const { awareness } = runInit(r, 4242);
    const phial = r.kinds.find((k) => k.name.includes("Phial"));
    expect(phial).toBeDefined();
    expect(phial!.kindFlags.has(KF.INSTA_ART)).toBe(true);
    expect(awareness.isAware(phial!)).toBe(false);
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
