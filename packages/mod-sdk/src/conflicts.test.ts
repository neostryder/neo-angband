import { describe, expect, it } from "vitest";
import type { PackContent } from "./compose.js";
import { computeConflictReport } from "./conflicts.js";
import type { PackManifest } from "./manifest.js";

function manifest(id: string): PackManifest {
  return { id, name: id, version: "1.0.0", shape: "content" };
}

describe("computeConflictReport", () => {
  it("additive changes on distinct records produce an empty report", () => {
    const frost: PackContent = {
      manifest: manifest("frost"),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 120 }] },
        },
      },
    };
    const runes: PackContent = {
      manifest: manifest("runes"),
      files: {
        monster: {
          fieldPatches: { "core:orc": [{ op: "set", path: "speed", value: 115 }] },
        },
      },
    };
    expect(computeConflictReport([frost, runes]).records).toEqual([]);
  });

  it("a single pack touching a record produces no entry", () => {
    const frost: PackContent = {
      manifest: manifest("frost"),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 120 }] },
        },
      },
    };
    expect(computeConflictReport([frost]).records).toEqual([]);
  });

  it("two packs setting the same field: a collision, last in order wins", () => {
    const frost: PackContent = {
      manifest: manifest("frost"),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 120 }] },
        },
      },
    };
    const runes: PackContent = {
      manifest: manifest("runes"),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 130 }] },
        },
      },
    };
    const report = computeConflictReport([frost, runes]);
    expect(report.records).toHaveLength(1);
    const rec = report.records[0]!;
    expect(rec.ref).toBe("core:kobold");
    expect(rec.file).toBe("monster");
    expect(rec.contributingPacks).toEqual(["frost", "runes"]);
    expect(rec.collisions).toEqual([{ path: "speed", owners: ["frost", "runes"] }]);
    const speedField = rec.fields.find((f) => f.path === "speed");
    expect(speedField?.owners).toEqual(["frost", "runes"]);
    expect(speedField?.winner).toBe("runes");
    expect(rec.override).toBeUndefined();
    expect(rec.humanLines).toHaveLength(1);
    expect(rec.humanLines[0]).toContain("frost and runes");
    expect(rec.humanLines[0]).toContain("kobold.speed");
    expect(rec.humanLines[0]).toContain("runes wins");
  });

  it("two packs touching different fields of one record: listed, no collision", () => {
    const frost: PackContent = {
      manifest: manifest("frost"),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 120 }] },
        },
      },
    };
    const runes: PackContent = {
      manifest: manifest("runes"),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "add", path: "hp", value: 3 }] },
        },
      },
    };
    const report = computeConflictReport([frost, runes]);
    expect(report.records).toHaveLength(1);
    const rec = report.records[0]!;
    expect(rec.contributingPacks).toEqual(["frost", "runes"]);
    expect(rec.collisions).toEqual([]);
    expect(rec.fields.map((f) => f.path).sort()).toEqual(["hp", "speed"]);
    expect(rec.humanLines).toEqual([]);
  });

  it("a coarse patch and a field patch on the same field also collide", () => {
    const frost: PackContent = {
      manifest: manifest("frost"),
      files: {
        monster: { patches: { "core:kobold": { speed: 120 } } },
      },
    };
    const runes: PackContent = {
      manifest: manifest("runes"),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 130 }] },
        },
      },
    };
    const report = computeConflictReport([frost, runes]);
    expect(report.records).toHaveLength(1);
    expect(report.records[0]!.collisions).toEqual([
      { path: "speed", owners: ["frost", "runes"] },
    ]);
  });

  it("a later pack replacing a record is a whole-record override", () => {
    const total: PackContent = {
      manifest: manifest("total"),
      files: {
        monster: { replaces: { "core:kobold": { name: "Kobold", hp: 999 } } },
      },
    };
    const report = computeConflictReport([total]);
    expect(report.records).toHaveLength(1);
    const rec = report.records[0]!;
    expect(rec.ref).toBe("core:kobold");
    expect(rec.override).toEqual({ pack: "total", kind: "replace" });
    expect(rec.fields).toEqual([]);
    expect(rec.humanLines).toHaveLength(1);
    expect(rec.humanLines[0]).toContain("total replaces kobold");
    expect(rec.humanLines[0]).toContain("core's original");
  });

  it("a later pack removing a record is a whole-record override", () => {
    const total: PackContent = {
      manifest: manifest("total"),
      files: { monster: { removes: ["core:grip-farmer-maggot-s-dog"] } },
    };
    const report = computeConflictReport([total]);
    expect(report.records).toHaveLength(1);
    expect(report.records[0]!.override).toEqual({ pack: "total", kind: "remove" });
    expect(report.records[0]!.humanLines[0]).toContain("total removes");
  });

  it("a replace after an earlier patch reports both the field and the override", () => {
    const frost: PackContent = {
      manifest: manifest("frost"),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 120 }] },
        },
      },
    };
    const total: PackContent = {
      manifest: manifest("total"),
      files: {
        monster: { replaces: { "core:kobold": { name: "Kobold", hp: 999 } } },
      },
    };
    const report = computeConflictReport([frost, total]);
    expect(report.records).toHaveLength(1);
    const rec = report.records[0]!;
    expect(rec.contributingPacks).toEqual(["frost", "total"]);
    expect(rec.override).toEqual({ pack: "total", kind: "replace" });
    expect(rec.fields.map((f) => f.path)).toEqual(["speed"]);
    expect(rec.collisions).toEqual([]);
    expect(rec.humanLines).toHaveLength(1); // only the override line - no same-field collision
  });

  it("is deterministic given the same input", () => {
    const frost: PackContent = {
      manifest: manifest("frost"),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 120 }] },
        },
      },
    };
    const runes: PackContent = {
      manifest: manifest("runes"),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 130 }] },
        },
      },
    };
    const a = computeConflictReport([frost, runes]);
    const b = computeConflictReport([frost, runes]);
    expect(a).toEqual(b);
  });
});
