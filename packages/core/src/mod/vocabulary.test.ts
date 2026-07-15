/**
 * Mod vocabulary extension (W2.3): a mod declares NEW terms (flags, stats, any
 * mod-coined kind), stores per-entity values, and the whole thing round-trips
 * through a plain-JSON snapshot for its save bag. Core never reads these terms;
 * these tests pin the declare/value/persist contract.
 */

import { describe, expect, it } from "vitest";
import { VocabularyRegistry } from "./vocabulary";

describe("VocabularyRegistry - declaring terms", () => {
  it("declares terms across kinds and lists them, filtered or not", () => {
    const v = new VocabularyRegistry();
    v.define({ kind: "stat", term: "demo:luck", label: "Luck" });
    v.define({ kind: "flag", term: "demo:cursed" });
    v.define({ kind: "stat", term: "demo:sanity" });

    expect(v.has("stat", "demo:luck")).toBe(true);
    expect(v.has("flag", "demo:cursed")).toBe(true);
    expect(v.has("stat", "demo:cursed")).toBe(false); // right term, wrong kind
    expect(v.get("stat", "demo:luck")?.label).toBe("Luck");

    expect(v.list().map((t) => t.term)).toEqual([
      "demo:luck",
      "demo:cursed",
      "demo:sanity",
    ]);
    expect(v.list("stat").map((t) => t.term)).toEqual([
      "demo:luck",
      "demo:sanity",
    ]);
  });

  it("rejects a duplicate declaration (same kind + term)", () => {
    const v = new VocabularyRegistry();
    v.define({ kind: "stat", term: "demo:luck" });
    expect(() => v.define({ kind: "stat", term: "demo:luck" })).toThrow(
      /already declared/,
    );
    // Same term name in a DIFFERENT kind is allowed (distinct vocabulary).
    expect(() => v.define({ kind: "flag", term: "demo:luck" })).not.toThrow();
  });
});

describe("VocabularyRegistry - per-entity values", () => {
  it("stores and reads values per entity for declared terms", () => {
    const v = new VocabularyRegistry();
    v.define({ kind: "stat", term: "demo:luck" });
    v.define({ kind: "flag", term: "demo:cursed" });

    v.setValue("player", "demo:luck", 12);
    v.setValue("mon:5", "demo:cursed", true);
    v.setValue("mon:5", "demo:luck", -3);

    expect(v.getValue("player", "demo:luck")).toBe(12);
    expect(v.getValue("mon:5", "demo:cursed")).toBe(true);
    expect(v.getValue("mon:5", "demo:luck")).toBe(-3);
    expect(v.getValue("player", "demo:cursed")).toBeUndefined();
    expect(v.valuesOf("mon:5")).toEqual({
      "demo:cursed": true,
      "demo:luck": -3,
    });
  });

  it("refuses to set a value for an undeclared term", () => {
    const v = new VocabularyRegistry();
    expect(() => v.setValue("player", "demo:ghost", 1)).toThrow(/undeclared/);
  });

  it("clears an entity's values (e.g. a monster that died)", () => {
    const v = new VocabularyRegistry();
    v.define({ kind: "flag", term: "demo:cursed" });
    v.setValue("mon:5", "demo:cursed", true);
    v.clearEntity("mon:5");
    expect(v.getValue("mon:5", "demo:cursed")).toBeUndefined();
    expect(v.valuesOf("mon:5")).toEqual({});
  });
});

describe("VocabularyRegistry - persistence round-trip", () => {
  it("serialises to JSON and rebuilds identically (a save-bag round-trip)", () => {
    const v = new VocabularyRegistry();
    v.define({ kind: "stat", term: "demo:luck", label: "Luck", meta: { max: 20 } });
    v.define({ kind: "flag", term: "demo:cursed" });
    v.setValue("player", "demo:luck", 9);
    v.setValue("mon:5", "demo:cursed", true);

    const snapshot = v.toJSON();
    // Snapshot is plain JSON (the bag contract): survives a stringify round-trip.
    const restored = VocabularyRegistry.fromJSON(
      JSON.parse(JSON.stringify(snapshot)),
    );

    expect(restored.get("stat", "demo:luck")?.meta).toEqual({ max: 20 });
    expect(restored.getValue("player", "demo:luck")).toBe(9);
    expect(restored.getValue("mon:5", "demo:cursed")).toBe(true);
    expect(restored.toJSON()).toEqual(snapshot);
  });
});
