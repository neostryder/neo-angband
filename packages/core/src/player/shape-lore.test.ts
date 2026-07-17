import { describe, expect, it } from "vitest";
import { shapeLoreLines, type ShapeLoreEnv } from "./shape-lore";
import { OBJ_PROPERTY, OBJ_MOD_MAX, ELEM_MAX } from "../obj/types";
import type { ObjectProperty } from "../obj/types";
import type { Shape } from "./types";

/** A FlagSet stub whose membership is a fixed number Set. */
const flagsOf = (bits: Set<number> = new Set()) =>
  ({ has: (b: number) => bits.has(b) }) as unknown as Shape["flags"];

/** A minimal shape; skills/modifiers/elInfo default to zeroed arrays. */
function makeShape(over: Partial<Shape>): Shape {
  return {
    sidx: 1,
    name: "bat",
    toA: 0,
    toH: 0,
    toD: 0,
    skills: new Array<number>(10).fill(0),
    flags: flagsOf(),
    pflags: flagsOf(),
    modifiers: new Array<number>(OBJ_MOD_MAX).fill(0),
    elInfo: Array.from({ length: ELEM_MAX }, () => ({ resLevel: 0 })),
    effects: [],
    effectMsg: null,
    blows: [],
    ...over,
  } as Shape;
}

/** A property table with just a MOD entry for modifier index 0 ("speed"). */
const props: (ObjectProperty | null)[] = [
  null,
  { type: OBJ_PROPERTY.MOD, propIndex: 5, name: "speed" } as ObjectProperty,
];

const env: ShapeLoreEnv = {
  properties: props,
  elementNames: Array.from({ length: ELEM_MAX }, (_, i) => `elem${i}`),
  playerAbilities: [],
};

describe("shapeLoreLines (ui-knowledge.c shape_lore chain)", () => {
  it("always leads with the name and the fixed intro paragraph", () => {
    const lines = shapeLoreLines(makeShape({ name: "wolf" }), env);
    expect(lines[0]).toBe("wolf");
    expect(lines[1]).toContain("Like all shapes");
  });

  it("renders basic combat with the C list grammar (a, b and c)", () => {
    const lines = shapeLoreLines(makeShape({ toA: 2, toH: -1, toD: 3 }), env);
    expect(lines).toContain("Adds +2 to AC, -1 to hit and +3 to damage.");
  });

  it("renders skills with skill_index_to_name", () => {
    const skills = new Array<number>(10).fill(0);
    skills[9] = 5; // DIGGING
    skills[2] = 1; // DEVICE
    const lines = shapeLoreLines(makeShape({ skills }), env);
    // DEVICE (index 2) precedes DIGGING (index 9) in enum order.
    expect(lines).toContain("Adds +1 to magic devices and +5 to digging.");
  });

  it("renders a non-stat modifier via the property name", () => {
    const modifiers = new Array<number>(OBJ_MOD_MAX).fill(0);
    modifiers[5] = 10; // index 5 is a non-stat modifier here (STAT_MAX..)
    const lines = shapeLoreLines(makeShape({ modifiers }), env);
    expect(lines).toContain("Adds +10 to speed.");
  });

  it("splits resistances into vulnerable / resistant / immune lines", () => {
    const elInfo = Array.from({ length: ELEM_MAX }, () => ({ resLevel: 0 }));
    elInfo[0] = { resLevel: -1 }; // vulnerable
    elInfo[1] = { resLevel: 1 }; // resistant
    elInfo[2] = { resLevel: 3 }; // immune
    const lines = shapeLoreLines(makeShape({ elInfo }), env);
    expect(lines).toContain("Makes you vulnerable to elem0.");
    expect(lines).toContain("Makes you resistant to elem1.");
    expect(lines).toContain("Makes you immune to elem2.");
  });

  it("appends the change-effect and triggering-spell tails from the env", () => {
    const withTails: ShapeLoreEnv = {
      ...env,
      changeEffectText: "Changing into the shape heals you",
      triggeringSpells: ["The Mage spell, Bat Form, from Magic Book triggers the shapechange."],
    };
    const lines = shapeLoreLines(makeShape({}), withTails);
    expect(lines).toContain("Changing into the shape heals you.");
    expect(lines).toContain(
      "The Mage spell, Bat Form, from Magic Book triggers the shapechange.",
    );
  });
});
