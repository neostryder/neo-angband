/**
 * Tests for the knowledge sub-browsers' pure list/grouping builders
 * (ui-knowledge.c do_cmd_knowledge_*). These lock in the faithful grouping,
 * sort order and membership gating against the C oracle cited per function.
 */
import { describe, it, expect } from "vitest";
import { TV, TF, TRF } from "@neo-angband/core";
import type { Feature, FeatureRegistry, TrapKind, ObjectBase } from "@neo-angband/core";
import {
  buildObjGroupOrder,
  objGroupName,
  featOrder,
  trapOrder,
  groupsToMenu,
  featureKnowledgeGroups,
  trapKnowledgeGroups,
  type KnowledgeGroup,
} from "./knowledge";

/** A bases array (indexed by tval) where only the listed tvals have svals. */
function basesWith(tvals: number[]): (ObjectBase | undefined)[] {
  const maxTval = Math.max(...tvals, TV["GOLD"]);
  const bases: (ObjectBase | undefined)[] = new Array(maxTval + 1);
  for (const t of tvals) bases[t] = { numSvals: 1 } as ObjectBase;
  return bases;
}

describe("buildObjGroupOrder (obj_group_order, ui-knowledge.c L3720-3734)", () => {
  it("maps a tval to its own named group index", () => {
    const order = buildObjGroupOrder(basesWith([TV["RING"]]));
    expect(objGroupName(order[TV["RING"]]!)).toBe("Ring");
  });

  it("folds BOLT and SHOT into the ARROW 'Ammunition' group (null-name entries)", () => {
    const order = buildObjGroupOrder(basesWith([TV["ARROW"], TV["BOLT"], TV["SHOT"]]));
    expect(order[TV["BOLT"]]).toBe(order[TV["ARROW"]]);
    expect(order[TV["SHOT"]]).toBe(order[TV["ARROW"]]);
    expect(objGroupName(order[TV["ARROW"]]!)).toBe("Ammunition");
  });

  it("gives -1 to a tval whose base has no svals (num_svals == 0)", () => {
    const order = buildObjGroupOrder(basesWith([TV["RING"]])); // AMULET absent -> no svals
    expect(order[TV["AMULET"]]).toBe(-1);
  });
});

/** A FeatureRegistry stub whose featHas reads a per-fidx flag set. */
function featRegStub(flagsByFidx: Record<number, Set<number>>): FeatureRegistry {
  return {
    featHas: (fidx: number, tf: number) => flagsByFidx[fidx]?.has(tf) ?? false,
  } as unknown as FeatureRegistry;
}

describe("featOrder (feat_order, ui-knowledge.c L178-192)", () => {
  it("classifies a shop before its WALL flag (shops carry WALL too)", () => {
    const reg = featRegStub({ 5: new Set([TF["SHOP"], TF["WALL"]]) });
    expect(featOrder(reg, { fidx: 5 } as Feature)).toBe(6); // "Stores"
  });

  it("classifies a plain wall as Walls, a floor as Floors", () => {
    const reg = featRegStub({ 1: new Set([TF["WALL"]]), 2: new Set([TF["PASSABLE"]]) });
    expect(featOrder(reg, { fidx: 1 } as Feature)).toBe(3);
    expect(featOrder(reg, { fidx: 2 } as Feature)).toBe(0);
    expect(featOrder(reg, { fidx: 3 } as Feature)).toBe(7); // no flags -> Other
  });
});

describe("featureKnowledgeGroups (do_cmd_knowledge_features, ui-knowledge.c L2460)", () => {
  it("skips nameless and mimic features, groups + sorts by name", () => {
    const feats: Feature[] = [
      { fidx: 1, name: "granite wall", mimic: 0, desc: "", dAttr: "w" } as unknown as Feature,
      { fidx: 2, name: "open floor", mimic: 0, desc: "", dAttr: "w" } as unknown as Feature,
      { fidx: 3, name: "arena floor", mimic: 0, desc: "", dAttr: "w" } as unknown as Feature,
      { fidx: 4, name: "", mimic: 0, desc: "", dAttr: "w" } as unknown as Feature, // nameless
      { fidx: 5, name: "a mimic", mimic: 7, desc: "", dAttr: "w" } as unknown as Feature, // mimic
    ];
    const reg = {
      allFeatures: () => feats,
      featHas: (fidx: number, tf: number) =>
        (fidx === 2 || fidx === 3) && tf === TF["PASSABLE"], // 2,3 are floors
    } as unknown as FeatureRegistry;
    const groups = featureKnowledgeGroups(reg);
    const floors = groups.find((g) => g.name === "Floors")!;
    expect(floors.rows.map((r) => r.member.name)).toEqual(["arena floor", "open floor"]);
    // nameless + mimic excluded from every group
    const all = groups.flatMap((g) => g.rows.map((r) => r.member.name));
    expect(all).not.toContain("");
    expect(all).not.toContain("a mimic");
  });
});

/** Build a minimal TrapKind with a flag set exposing has(). */
function trapKind(desc: string, flags: number[]): TrapKind {
  const set = new Set(flags);
  return { name: desc, desc, color: "w", flags: { has: (f: number) => set.has(f) } } as unknown as TrapKind;
}

describe("trapOrder + trapKnowledgeGroups (do_cmd_knowledge_traps, ui-knowledge.c L2530,2641)", () => {
  it("orders GLYPH->Runes, LOCK->Locks, TRAP->Traps, else Other", () => {
    expect(trapOrder(trapKind("glyph", [TRF["GLYPH"]]))).toBe(0);
    expect(trapOrder(trapKind("lock", [TRF["LOCK"]]))).toBe(1);
    expect(trapOrder(trapKind("pit", [TRF["TRAP"]]))).toBe(2);
    expect(trapOrder(trapKind("misc", []))).toBe(3);
  });

  it("skips nameless slots and sorts within a group by desc", () => {
    const nameless = { name: "", desc: "x", color: "w", flags: { has: () => false } } as unknown as TrapKind;
    const groups = trapKnowledgeGroups([
      trapKind("spiked pit", [TRF["TRAP"]]),
      trapKind("dart trap", [TRF["TRAP"]]),
      nameless,
    ]);
    const traps = groups.find((g) => g.name === "Traps")!;
    expect(traps.rows.map((r) => r.member.desc)).toEqual(["dart trap", "spiked pit"]);
    const all = groups.flatMap((g) => g.rows.map((r) => r.member.desc));
    expect(all).not.toContain("x");
  });
});

describe("groupsToMenu", () => {
  it("emits a disabled header per non-empty group then its members", () => {
    const groups: KnowledgeGroup<string>[] = [
      { name: "Combat", rows: [{ label: "armour", color: "w", member: "a" }] },
      { name: "Empty", rows: [] },
      { name: "Slays", rows: [{ label: "slay evil", color: "w", member: "b" }] },
    ];
    const { items, members } = groupsToMenu(groups);
    expect(items.map((i) => i.label)).toEqual(["Combat", "  armour", "Slays", "  slay evil"]);
    expect(items[0]!.disabled).toBe(true);
    expect(items[2]!.disabled).toBe(true);
    expect(members).toEqual([null, "a", null, "b"]);
  });
});
