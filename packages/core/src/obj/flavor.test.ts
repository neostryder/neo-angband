import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KF, TV } from "../generated/index.js";
import { ObjRegistry } from "./bind.js";
import { SV_UNKNOWN } from "./types.js";
import type { FlavorRecordJson, ObjPackJson, ObjectKind } from "./types.js";
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

/**
 * THE ORDER OF THE FLAVOUR LIST, which is what decides who gets which gem.
 *
 * `flavor_assign_random` walks the list BACKWARDS to reproduce C's
 * prepend-into-a-linked-list, so a flavour's index in `reg.flavors` selects it -
 * and the list therefore has to be in flavor.txt's own line order. The binder
 * used to bind every `flavor:` line before every `fixed:` line, which is the
 * reverse of how the file writes a ring or amulet record.
 *
 * That was invisible in an ordinary game and only an ordinary game was ever
 * measured: a fixed flavour keeps its sval, `flavor_assign_random` skips it, and
 * the random ones kept their relative order. `birth_randarts` is the switch that
 * exposed it - `flavor_reset_fixed` scrubs all but the One Ring's fixed sval and
 * drops eight more entries into the random pool, at the wrong end of the list.
 * The draw COUNT is identical either way, so no RNG probe could have caught it;
 * only the assignment itself shows it, which is what these assert.
 */
describe("bindFlavors: flavor.txt line order", () => {
  const reg = buildReg();

  it("binds a record's fixed flavours before its random ones", () => {
    /* flavor.txt: ring `fixed:` at L18-30, then `flavor:` at L32-73. */
    const rings = reg.flavors.filter((f) => f.tval === TV.RING);
    const fixedAt = rings.flatMap((f, i) => (f.sval !== SV_UNKNOWN ? [i] : []));
    const randomAt = rings.flatMap((f, i) => (f.sval === SV_UNKNOWN ? [i] : []));
    expect(fixedAt.length).toBe(4);
    expect(randomAt.length).toBeGreaterThan(30);
    expect(Math.max(...fixedAt)).toBeLessThan(Math.min(...randomAt));

    /* The end of the list is the end of the file, and the end of the list is
     * where the reverse walk starts - so name it rather than trusting the
     * inequality above to have meant something. */
    expect(rings.at(-1)!.text).toContain("Adamantite");
    expect(rings[0]!.text).toContain("Plain Gold");
  });

  it("binds the amulet record the same way", () => {
    const amulets = reg.flavors.filter((f) => f.tval === TV.AMULET);
    const fixedAt = amulets.flatMap((f, i) => (f.sval !== SV_UNKNOWN ? [i] : []));
    const randomAt = amulets.flatMap((f, i) => (f.sval === SV_UNKNOWN ? [i] : []));
    expect(fixedAt.length).toBe(4);
    expect(Math.max(...fixedAt)).toBeLessThan(Math.min(...randomAt));
    expect(amulets[0]!.text).toContain("Bronze");
    expect(amulets.at(-1)!.text).toContain("Mother-of-Pearl");
  });

  it("hands out different gems under randarts if the list order changes", () => {
    /*
     * THE PROOF THAT THE ORDER IS OBSERVABLE, and the only one that does not
     * need a golden vector recorded from a build of the C game.
     *
     * `flavorInit` takes the flavour list as a dependency, so the binder does
     * not have to be broken again to measure what breaking it did: the list is
     * simply regrouped the way the old binder emitted it - every `flavor:`
     * entry of a record before every `fixed:` one - and both are run against
     * the same seed. Under `birth_randarts` the two assignments differ, which
     * is the defect; with randarts off they are identical, which is why it
     * survived every measurement that was ever taken of it.
     */
    const r = buildReg();

    /* The old binder's order. Each flavour record is one tval and its entries
     * are contiguous, so grouping the flat list by tval and putting the random
     * entries of each group first reproduces it exactly. */
    const oldOrder = [...new Set(r.flavors.map((f) => f.tval))].flatMap((tval) => {
      const group = r.flavors.filter((f) => f.tval === tval);
      return [
        ...group.filter((f) => f.sval === SV_UNKNOWN),
        ...group.filter((f) => f.sval !== SV_UNKNOWN),
      ];
    });
    expect(oldOrder.length).toBe(r.flavors.length);
    expect(oldOrder).not.toEqual(r.flavors);

    const ringsAndAmulets = r.kinds.filter(
      (k) => (k.tval === TV.RING || k.tval === TV.AMULET) && k.kidx < r.ordinaryKindCount && k.name,
    );
    expect(ringsAndAmulets.length).toBeGreaterThan(20);

    const gems = (flavors: typeof r.flavors, birthRandarts: boolean): string[] => {
      const assignment = flavorInit(20260820, new FlavorKnowledge(r.ordinaryKindCount), {
        kinds: r.kinds,
        flavors,
        ordinaryKindCount: r.ordinaryKindCount,
        nameSections,
        birthRandarts,
      });
      return ringsAndAmulets.map((k) => assignment.text(k));
    };

    /* Ordinary game: the fixed entries are skipped either way, so the order
     * they sit in cannot be seen. This is the half that kept it hidden. */
    expect(gems(oldOrder, false)).toEqual(gems(r.flavors, false));

    /* Randarts: seven of the eight fixed entries join the random pool, and now
     * where they sit decides who gets them. */
    expect(gems(oldOrder, true)).not.toEqual(gems(r.flavors, true));
  });

  it("keeps every randarts ring flavour real, unique, and seed-stable", () => {
    const r = buildReg();
    const draw = (): string[] => {
      const assignment = flavorInit(20260820, new FlavorKnowledge(r.ordinaryKindCount), {
        kinds: r.kinds,
        flavors: r.flavors,
        ordinaryKindCount: r.ordinaryKindCount,
        nameSections,
        birthRandarts: true,
      });
      return r.kinds
        .filter((k) => k.tval === TV.RING && k.kidx < r.ordinaryKindCount && k.name)
        .map((k) => assignment.text(k));
    };

    const texts = draw();
    expect(texts.length).toBeGreaterThan(20);
    for (const t of texts) expect(t.length).toBeGreaterThan(0);

    /* No two rings share a gem, and every gem is one flavor.txt declares. */
    expect(new Set(texts).size).toBe(texts.length);
    const known = new Set(r.flavors.filter((f) => f.tval === TV.RING).map((f) => f.text));
    for (const t of texts) expect(known.has(t)).toBe(true);

    /* "Plain Gold" is the One Ring's and `flavor_reset_fixed` spares it, so it
     * never reaches the random pool for an ordinary ring to be handed. */
    expect(texts).not.toContain("Plain Gold");

    /* And the same seed reproduces it, which is what seed_flavor is for. */
    expect(draw()).toEqual(texts);
  });

  /**
   * ISSUE #2: the compiled record used to split `fixed:` and `flavor:` into
   * two arrays, so a record that interleaves the two directives could not be
   * reproduced from that shape at all - the old binder always bound every
   * `fixed:` entry before every `flavor:` entry, regardless of the file's
   * real line order, because "regardless of the real order" was the only
   * thing the split-array shape could express. Nothing shipped interleaves
   * them (every test above exercises the shipped fixed-then-random layout,
   * which is why the bug stayed latent), so this constructs the interleaved
   * case directly rather than waiting for a mod to trip over it.
   */
  it("binds an interleaved fixed:/flavor: record in the file's own line order", () => {
    const interleaved: FlavorRecordJson = {
      kind: { tval: "ring", glyph: "=" },
      entries: [
        { kind: "flavor", index: 50, attr: "Red", desc: "Ruby-ish" },
        { kind: "fixed", index: 1, sval: "7", attr: "Yellow", desc: "Plain-Gold-ish" },
        { kind: "flavor", index: 51, attr: "Green", desc: "Emerald-ish" },
        { kind: "fixed", index: 2, sval: "9", attr: "Blue", desc: "Sapphire-ish" },
        { kind: "flavor", index: 52, attr: "White", desc: "Diamond-ish" },
      ],
    };
    const pack: ObjPackJson = { ...objPack, flavor: { records: [interleaved] } };
    const reg = new ObjRegistry(pack);

    /* The bound list is the entries array, unchanged in order - not fixed
     * entries first, which is what a binder still reading split `fixed`/
     * `flavor` arrays would have produced regardless of this input. */
    expect(reg.flavors.map((f) => f.text)).toEqual([
      "Ruby-ish",
      "Plain-Gold-ish",
      "Emerald-ish",
      "Sapphire-ish",
      "Diamond-ish",
    ]);
    /* Fixed entries keep the sval they named; flavor entries stay unknown -
     * confirming the interleaving didn't scramble which is which. */
    expect(reg.flavors.map((f) => f.sval)).toEqual([SV_UNKNOWN, 7, SV_UNKNOWN, 9, SV_UNKNOWN]);
    /* The entry's own `index` (flavor.txt's numbering) is deliberately NOT
     * ascending in file order here (50, 1, 51, 2, 52) - exactly the "the
     * entry index cannot stand in for it" case the issue describes - and the
     * bound order follows the entries array, not a re-sort by index. */
    expect(reg.flavors.map((f) => f.fidx)).toEqual([50, 1, 51, 2, 52]);
  });
});
