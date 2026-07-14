import { describe, expect, it } from "vitest";
import type { JsonRecord } from "./compose.js";
import {
  applyFieldPatch,
  composeFieldPatches,
  PatchError,
  touchedFields,
} from "./patch.js";
import type { FieldPatch } from "./patch.js";

const kobold = (): JsonRecord => ({
  name: "kobold",
  speed: 110,
  hp: 8,
  flags: ["EVIL", "GROUP_AI"],
  attack: { damage: 4, kind: "bite" },
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
