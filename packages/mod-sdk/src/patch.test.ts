import { describe, expect, it } from "vitest";
import type { JsonRecord } from "./compose.js";
import {
  applyFieldPatch,
  composeFieldPatches,
  PatchError,
  touchedFields,
} from "./patch.js";
import type { FieldOp, FieldPatch } from "./patch.js";

const kobold = (): JsonRecord => ({
  name: "kobold",
  speed: 110,
  hp: 8,
  flags: ["EVIL", "GROUP_AI"],
  attack: { damage: 4, kind: "bite" },
});

/** A store record, for the list ops - a stock table is the reason they exist. */
const store = (): JsonRecord => ({
  store: "General Store",
  normal: [{ tval: "soft armor", sval: "Leather Gloves" }],
});

describe("applyFieldPatch op semantics", () => {
  it("set replaces a scalar and a nested field", () => {
    const out = applyFieldPatch(kobold(), [
      { op: "set", path: "speed", value: 120 },
      { op: "set", path: "attack.kind", value: "claw" },
    ]);
    expect(out["speed"]).toBe(120);
    expect((out["attack"] as JsonRecord)["kind"]).toBe("claw");
  });

  it("add and mul apply to numeric fields (missing = 0)", () => {
    const out = applyFieldPatch(kobold(), [
      { op: "add", path: "hp", value: 2 },
      { op: "mul", path: "speed", value: 2 },
      { op: "add", path: "brandNew", value: 5 },
    ]);
    expect(out["hp"]).toBe(10);
    expect(out["speed"]).toBe(220);
    expect(out["brandNew"]).toBe(5);
  });

  it("addFlag is a set-union and removeFlag drops a flag", () => {
    const out = applyFieldPatch(kobold(), [
      { op: "addFlag", path: "flags", flag: "STUPID" },
      { op: "addFlag", path: "flags", flag: "EVIL" }, // already present: no dup
      { op: "removeFlag", path: "flags", flag: "GROUP_AI" },
    ]);
    expect(out["flags"]).toEqual(["EVIL", "STUPID"]);
  });

  it("merge deep-merges an object value", () => {
    const out = applyFieldPatch(kobold(), [
      { op: "merge", path: "attack", value: { damage: 6, verb: "gnaw" } },
    ]);
    expect(out["attack"]).toEqual({ damage: 6, kind: "bite", verb: "gnaw" });
  });

  it("is pure: the base record is not mutated", () => {
    const base = kobold();
    applyFieldPatch(base, [{ op: "set", path: "speed", value: 999 }]);
    expect(base["speed"]).toBe(110);
  });

  it("rejects a flag op on a non-array field", () => {
    expect(() =>
      applyFieldPatch(kobold(), [{ op: "addFlag", path: "speed", flag: "X" }]),
    ).toThrow(PatchError);
  });

  it("append adds entries to a list without restating it", () => {
    const out = applyFieldPatch(store(), [
      { op: "append", path: "normal", values: [{ tval: "soft armor", sval: "Padded Jerkin" }] },
    ]);
    expect(out["normal"]).toEqual([
      { tval: "soft armor", sval: "Leather Gloves" },
      { tval: "soft armor", sval: "Padded Jerkin" },
    ]);
  });

  it("append keeps duplicates, because a stock table weights by repetition", () => {
    const out = applyFieldPatch(store(), [
      { op: "append", path: "normal", values: [{ tval: "soft armor", sval: "Leather Gloves" }] },
    ]);
    expect((out["normal"] as unknown[]).length).toBe(2);
  });

  it("append creates the list when the field is absent", () => {
    const out = applyFieldPatch(store(), [
      { op: "append", path: "always", values: ["a"] },
    ]);
    expect(out["always"]).toEqual(["a"]);
  });

  it("removeValue drops deep-equal entries and leaves the rest", () => {
    const out = applyFieldPatch(store(), [
      { op: "append", path: "normal", values: [{ tval: "light", sval: "Wooden Torch" }] },
      { op: "removeValue", path: "normal", value: { tval: "soft armor", sval: "Leather Gloves" } },
    ]);
    expect(out["normal"]).toEqual([{ tval: "light", sval: "Wooden Torch" }]);
  });

  it("append does not mutate the base record's list", () => {
    const base = store();
    applyFieldPatch(base, [{ op: "append", path: "normal", values: ["x"] }]);
    expect((base["normal"] as unknown[]).length).toBe(1);
  });

  it("rejects append and removeValue against a field that is not a list", () => {
    expect(() =>
      applyFieldPatch(kobold(), [{ op: "append", path: "speed", values: [1] }]),
    ).toThrow(PatchError);
    expect(() =>
      applyFieldPatch(kobold(), [{ op: "removeValue", path: "attack", value: 1 }]),
    ).toThrow(PatchError);
  });

  it("rejects an append op that has 'value' instead of 'values', with a named cause", () => {
    /* The typo the mod-resilience audit found: `set`/`add`/`mul` all take a
     * singular `value`, and `append` is the one op that does not - so an
     * author copying a nearby op keeps the field name and gets a bare
     * TypeError (spreading `undefined`) instead of a message naming the op. */
    const bad = { op: "append", path: "normal", value: ["x"] } as unknown as FieldOp;
    expect(() => applyFieldPatch(store(), [bad])).toThrow(PatchError);
    expect(() => applyFieldPatch(store(), [bad])).toThrow(
      /"append" at normal needs a "values" array \(this op has "value" instead\)/,
    );
  });

  /*
   * The three quiet-destruction cases. Each of these used to succeed and throw
   * data away: an arithmetic op coerced a present non-number to 0 and wrote a
   * number over whatever was there, and a merge treated a list as an unusable
   * intermediate and replaced it with an object. A published documentation
   * example did the first of these to a store's stock list while the composer
   * reported no problems at all.
   */
  it("refuses arithmetic against a list instead of replacing it with a number", () => {
    expect(() =>
      applyFieldPatch(store(), [{ op: "add", path: "normal", value: 1 }]),
    ).toThrow(/not a number/);
  });

  it("refuses arithmetic against a string instead of zeroing it", () => {
    expect(() =>
      applyFieldPatch(kobold(), [{ op: "mul", path: "name", value: 2 }]),
    ).toThrow(/not a number/);
  });

  it("refuses an op name it does not know, rather than doing nothing", () => {
    /* The op arrives as JSON and nothing checks the name on the way in, so a
     * misspelling used to be a patch that silently did not happen. */
    expect(() =>
      applyFieldPatch(store(), [
        { op: "apend", path: "normal", values: ["x"] } as unknown as FieldOp,
      ]),
    ).toThrow(/unknown op "apend"/);
  });

  it("refuses to merge into a list instead of replacing it with an object", () => {
    expect(() =>
      applyFieldPatch(store(), [{ op: "merge", path: "normal", value: { a: 1 } }]),
    ).toThrow(/is a list/);
  });
});

describe("composeFieldPatches conflict detection", () => {
  it("different-field patches from two packs compose with zero conflict", () => {
    const { value, conflicts } = composeFieldPatches(kobold(), [
      { owner: "frost", ops: [{ op: "set", path: "speed", value: 120 }] },
      { owner: "runes", ops: [{ op: "add", path: "hp", value: 3 }] },
    ]);
    expect(conflicts).toEqual([]);
    expect(value["speed"]).toBe(120);
    expect(value["hp"]).toBe(11);
  });

  it("same-field order-dependent ops from two packs conflict, last wins", () => {
    const { value, conflicts } = composeFieldPatches(kobold(), [
      { owner: "frost", ops: [{ op: "set", path: "speed", value: 120 }] },
      { owner: "runes", ops: [{ op: "set", path: "speed", value: 130 }] },
    ]);
    expect(value["speed"]).toBe(130); // load order decides
    expect(conflicts).toEqual([{ path: "speed", owners: ["frost", "runes"] }]);
  });

  it("same field, one pack only: not a conflict", () => {
    const { conflicts } = composeFieldPatches(kobold(), [
      {
        owner: "frost",
        ops: [
          { op: "set", path: "speed", value: 120 },
          { op: "add", path: "speed", value: 5 },
        ],
      },
    ]);
    expect(conflicts).toEqual([]);
  });

  it("two packs adding different flags to one list do NOT conflict", () => {
    const { value, conflicts } = composeFieldPatches(kobold(), [
      { owner: "frost", ops: [{ op: "addFlag", path: "flags", flag: "COLD" }] },
      { owner: "runes", ops: [{ op: "addFlag", path: "flags", flag: "MAGIC" }] },
    ]);
    expect(conflicts).toEqual([]);
    expect(value["flags"]).toEqual(["EVIL", "GROUP_AI", "COLD", "MAGIC"]);
  });

  /*
   * The stackability rule, stated as tests: two mods stack unless they write
   * the same exact resource, and then the last to load wins and the collision
   * is reported. A shared LIST is not a shared resource when both packs only
   * add to it - that is the case a store's stock table lives in, and the case
   * that decides whether two item mods can be installed together.
   */
  it("two packs appending to one list both keep their entries", () => {
    const { value, conflicts } = composeFieldPatches(store(), [
      { owner: "spears", ops: [{ op: "append", path: "normal", values: ["spear"] }] },
      { owner: "jerkins", ops: [{ op: "append", path: "normal", values: ["jerkin"] }] },
    ]);
    expect(conflicts).toEqual([]);
    expect(value["normal"]).toEqual([
      { tval: "soft armor", sval: "Leather Gloves" },
      "spear",
      "jerkin",
    ]);
  });

  it("a pack that REPLACES a list another pack appended to is a reported conflict", () => {
    const { value, conflicts } = composeFieldPatches(store(), [
      { owner: "jerkins", ops: [{ op: "append", path: "normal", values: ["jerkin"] }] },
      { owner: "rework", ops: [{ op: "set", path: "normal", value: ["only-this"] }] },
    ]);
    expect(value["normal"]).toEqual(["only-this"]); // last to load wins
    expect(conflicts).toEqual([{ path: "normal", owners: ["jerkins", "rework"] }]);
  });

  it("a removeValue against an appended entry is order-dependent and reported", () => {
    const { value, conflicts } = composeFieldPatches(store(), [
      { owner: "jerkins", ops: [{ op: "append", path: "normal", values: ["jerkin"] }] },
      { owner: "purist", ops: [{ op: "removeValue", path: "normal", value: "jerkin" }] },
    ]);
    expect(value["normal"]).toEqual([{ tval: "soft armor", sval: "Leather Gloves" }]);
    expect(conflicts).toEqual([{ path: "normal", owners: ["jerkins", "purist"] }]);
  });

  it("append order follows load order, and nothing is dropped either way", () => {
    const forward = composeFieldPatches(store(), [
      { owner: "a", ops: [{ op: "append", path: "normal", values: ["x"] }] },
      { owner: "b", ops: [{ op: "append", path: "normal", values: ["y"] }] },
    ]);
    const reverse = composeFieldPatches(store(), [
      { owner: "b", ops: [{ op: "append", path: "normal", values: ["y"] }] },
      { owner: "a", ops: [{ op: "append", path: "normal", values: ["x"] }] },
    ]);
    expect(forward.value["normal"]).toEqual([
      { tval: "soft armor", sval: "Leather Gloves" },
      "x",
      "y",
    ]);
    /* Order differs, membership does not - so neither mod loses its entry. */
    expect(new Set(reverse.value["normal"] as unknown[]).size).toBe(3);
    expect(reverse.conflicts).toEqual([]);
  });

  it("is deterministic and independent of base mutation", () => {
    const base = kobold();
    const a = composeFieldPatches(base, [
      { owner: "frost", ops: [{ op: "mul", path: "speed", value: 2 }] },
    ]);
    const b = composeFieldPatches(base, [
      { owner: "frost", ops: [{ op: "mul", path: "speed", value: 2 }] },
    ]);
    expect(a).toEqual(b);
    expect(base["speed"]).toBe(110);
  });
});

describe("touchedFields", () => {
  it("reports the dot-paths a patch writes", () => {
    const ops: FieldPatch = [
      { op: "set", path: "speed", value: 1 },
      { op: "add", path: "hp", value: 1 },
      { op: "set", path: "speed", value: 2 },
    ];
    expect(touchedFields(ops)).toEqual(new Set(["speed", "hp"]));
  });
});

/**
 * Array indices in dot-paths. Upstream gamedata is full of label/value LISTS
 * (every section of constants.json, a store's owner list, a body's slot list),
 * so a fieldPatch that cannot address a list element cannot address those files
 * at all - and the first version did worse than fail: it replaced the array with
 * a fresh object, destroying the whole list without a word.
 */
describe("applyFieldPatch through array indices", () => {
  const constants = (): JsonRecord => ({
    "level-max": [
      { label: "monsters", value: 1024 },
      { label: "objects", value: 256 },
    ],
  });

  it("sets one element's field and leaves the array an array", () => {
    const out = applyFieldPatch(constants(), [
      { op: "set", path: "level-max.0.value", value: 2048 },
    ]);
    expect(out).toEqual({
      "level-max": [
        { label: "monsters", value: 2048 },
        { label: "objects", value: 256 },
      ],
    });
    expect(Array.isArray(out["level-max"])).toBe(true);
  });

  it("reads through an index for add and mul", () => {
    const out = applyFieldPatch(constants(), [
      { op: "add", path: "level-max.1.value", value: 4 },
      { op: "mul", path: "level-max.0.value", value: 2 },
    ]);
    expect(out["level-max"]).toEqual([
      { label: "monsters", value: 2048 },
      { label: "objects", value: 260 },
    ]);
  });

  it("replaces a whole element and merges into one", () => {
    const set = applyFieldPatch(constants(), [
      { op: "set", path: "level-max.1", value: { label: "objects", value: 9 } },
    ]);
    expect(set["level-max"]).toEqual([
      { label: "monsters", value: 1024 },
      { label: "objects", value: 9 },
    ]);
    const merged = applyFieldPatch(constants(), [
      { op: "merge", path: "level-max.1", value: { value: 9 } },
    ]);
    expect(merged["level-max"]).toEqual([
      { label: "monsters", value: 1024 },
      { label: "objects", value: 9 },
    ]);
  });

  it("addFlag / removeFlag reach a nested flag list", () => {
    const base: JsonRecord = { slot: [{ name: "weapon", flags: ["A"] }] };
    const added = applyFieldPatch(base, [
      { op: "addFlag", path: "slot.0.flags", flag: "B" },
    ]);
    expect(added["slot"]).toEqual([{ name: "weapon", flags: ["A", "B"] }]);
    const removed = applyFieldPatch(added, [
      { op: "removeFlag", path: "slot.0.flags", flag: "A" },
    ]);
    expect(removed["slot"]).toEqual([{ name: "weapon", flags: ["B"] }]);
  });

  it("builds an array when an intermediate is missing and the next part is an index", () => {
    const out = applyFieldPatch({}, [
      { op: "set", path: "owner.0.purse", value: 5000 },
    ]);
    expect(out).toEqual({ owner: [{ purse: 5000 }] });
    expect(Array.isArray(out["owner"])).toBe(true);
  });

  it("still treats a numeric segment as an object KEY when the container is an object", () => {
    const out = applyFieldPatch({ tally: { "0": 1 } }, [
      { op: "set", path: "tally.0", value: 2 },
    ]);
    expect(out).toEqual({ tally: { "0": 2 } });
    expect(Array.isArray(out["tally"])).toBe(false);
  });

  it("throws rather than guessing when a non-index segment addresses an array", () => {
    expect(() =>
      applyFieldPatch(constants(), [
        { op: "set", path: "level-max.first", value: 1 },
      ]),
    ).toThrow(PatchError);
  });
});

/**
 * NA-CORE-002: a dot-path segment of "__proto__", "prototype", or
 * "constructor" resolves through the prototype chain instead of an own
 * property. An unguarded `set` reaching the far end of one of these pollutes
 * the shared Object.prototype for every ordinary object in the realm, not
 * just the record being patched.
 */
describe("applyFieldPatch cannot reach the prototype chain", () => {
  for (const segment of ["__proto__", "prototype", "constructor"]) {
    it(`refuses a "set" op whose path is "${segment}.polluted"`, () => {
      expect(() =>
        applyFieldPatch(kobold(), [{ op: "set", path: `${segment}.polluted`, value: 1 }]),
      ).toThrow(PatchError);
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    });

    it(`refuses a "set" op whose path ends in ".${segment}"`, () => {
      expect(() =>
        applyFieldPatch(kobold(), [{ op: "set", path: `attack.${segment}`, value: 1 }]),
      ).toThrow(PatchError);
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    });

    it(`refuses a "merge" op that reads through "${segment}"`, () => {
      expect(() =>
        applyFieldPatch(kobold(), [{ op: "merge", path: segment, value: { polluted: 1 } }]),
      ).toThrow(PatchError);
      expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    });
  }

  it("does not resolve an inherited property that was never set as an own key", () => {
    // toString is inherited from Object.prototype; reading through it must
    // behave as absent, not as the inherited function.
    const out = applyFieldPatch({}, [{ op: "add", path: "toString", value: 1 }]);
    expect(out["toString"]).toBe(1);
  });
});
