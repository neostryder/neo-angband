/**
 * The shortcuts, exercised against core's real data.
 *
 * WHY THE REAL PACK AND NOT A FIXTURE. Every claim these functions make is a
 * claim ABOUT core's data - "the median cost of a level-20 sword", "core always
 * writes `graphics`". A fixture would let both the code and the test agree on a
 * world that does not exist, which is exactly the failure `draftRecord` exists
 * to prevent in mods. The one place a fixture IS used is for the negative cases,
 * where the point is a record core would never ship.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  checkRecords,
  COMPANION_RULES,
  describeFile,
  draftRecord,
  peersFor,
  suggestFields,
} from "./authoring.js";
import type { JsonRecord } from "./compose.js";

const packDir = new URL("../../content/pack/", import.meta.url);

function packRecords(stem: string): JsonRecord[] {
  const raw: unknown = JSON.parse(readFileSync(new URL(`${stem}.json`, packDir), "utf8"));
  const records = Array.isArray(raw) ? raw : (raw as { records?: unknown[] }).records;
  if (!Array.isArray(records)) return [];
  return records.filter(
    (r): r is JsonRecord => r !== null && typeof r === "object" && !Array.isArray(r),
  );
}

const CORE_FILES = [
  "object",
  "object_base",
  "monster",
  "monster_base",
  "blow_methods",
  "blow_effects",
  "monster_spell",
  "slay",
  "brand",
  "curse",
  "activation",
  "flavor",
  "pain",
  "ego_item",
  "artifact",
] as const;

const core: Record<string, JsonRecord[]> = {};
for (const f of CORE_FILES) core[f] = packRecords(f);

describe("drafting a new object", () => {
  const drafted = draftRecord(
    "object",
    { name: "& Sludge Dagger~", type: "sword", level: 20 },
    core,
  );

  it("is modelled on a real core record of the same kind", () => {
    const model = core["object"]?.find((r) => r["name"] === drafted.modelledOn);
    expect(model, "modelledOn names a record that exists").toBeDefined();
    expect(model?.["type"]).toBe("sword");
  });

  it("carries every field core's objects always carry", () => {
    for (const key of ["name", "type", "graphics"]) {
      expect(Object.keys(drafted.record), key).toContain(key);
    }
  });

  it("does not carry a field no sword has", () => {
    /* The bug this test exists for: the first version built the shape from
     * file-wide field frequency, and gave the sword an `armor` block because
     * 59% of core's OBJECTS have one - even though the statistic said nothing
     * about swords. Field frequency across a file is not a fact about any
     * record in it. */
    expect(drafted.record).not.toHaveProperty("charges");
    expect(drafted.record).not.toHaveProperty("pval");
  });

  it("does not inherit the model's powers, name or prose", () => {
    /* A template that quietly grants flags, slays or effects hands the author
     * an item that does things they never asked for. */
    for (const key of ["flags", "slay", "brand", "effect", "values", "desc", "msg"]) {
      expect(Object.keys(drafted.record), key).not.toContain(key);
    }
    expect(drafted.record["name"]).toBe("& Sludge Dagger~");
  });

  it("prices it from core's own comparable records, and says which", () => {
    const cost = drafted.suggestions.find((s) => s.field === "cost");
    expect(cost, "a cost was suggested").toBeDefined();
    expect(cost?.because).toContain("level 20");
    expect(cost?.because).toContain("sword");
    const swordCosts = (core["object"] ?? [])
      .filter((r) => r["type"] === "sword" && typeof r["cost"] === "number")
      .map((r) => r["cost"] as number);
    expect(cost?.value as number).toBeGreaterThanOrEqual(Math.min(...swordCosts));
    expect(cost?.value as number).toBeLessThanOrEqual(Math.max(...swordCosts));
  });

  it("never suggests over a value the author supplied", () => {
    const mine = draftRecord("object", { name: "x", type: "sword", level: 20, cost: 7 }, core);
    expect(mine.record["cost"]).toBe(7);
    expect(mine.suggestions.map((s) => s.field)).not.toContain("cost");
  });

  it("has nothing left to say about it beyond the description", () => {
    /* A drafted record that still trips the checker would mean the two halves
     * disagree about what a working record is. */
    expect(drafted.findings.map((f) => f.rule)).toEqual(["object/no-desc"]);
  });
});

describe("peers", () => {
  it("narrows to the same item type, then to the nearest level", () => {
    const { peers, because } = peersFor("object", { type: "sword", level: 20 }, core);
    expect(peers.every((p) => p["type"] === "sword")).toBe(true);
    expect(because).toContain("closest to level 20");
  });

  it("matches a list-valued peer field by overlap, not by equality", () => {
    /* Core's "of Slay Orc" is ["sword","polearm","hafted"]. An author writing
     * ["sword"] must not be told there is no comparable ego in the game. */
    const { peers } = peersFor("ego_item", { type: ["sword"] }, core);
    expect(peers.length).toBeGreaterThan(0);
    expect(
      peers.every((p) => (p["type"] as string[] | undefined)?.includes("sword") === true),
    ).toBe(true);
  });

  it("falls back to the whole file when nothing is comparable", () => {
    const { peers, because } = peersFor("object", { type: "sludge" }, core);
    expect(peers).toEqual([]);
    expect(because).toBe("no comparable record");
    const s = suggestFields("object", { type: "sludge" }, core);
    expect(s.find((x) => x.field === "cost")?.because).toContain("no comparable record");
  });
});

describe("checkRecords", () => {
  const object_base = core["object_base"] as JsonRecord[];

  function check(record: JsonRecord, file = "object"): ReturnType<typeof checkRecords> {
    const all = { ...core, [file]: [...(core[file] ?? []), record] };
    return checkRecords({ [file]: [record] }, all);
  }

  it("says nothing about core's own records that a mod would not also hear", () => {
    /* The control on the whole checker: run it over the base game and it must
     * produce no ERRORS. Upstream's own warts are warnings by design. */
    const findings = checkRecords(core, core).filter((f) => f.level === "error");
    expect(findings.map((f) => f.message)).toEqual([]);
  });

  it("names a required field the record does not have", () => {
    const f = check({ name: "& Sludge~", type: "sword" }).find((x) => x.rule === "field/required");
    expect(f?.level).toBe("error");
    expect(f?.field).toBe("graphics");
  });

  it("names a misspelled field and suggests the real one", () => {
    const f = check({
      name: "& Sludge~",
      type: "sword",
      graphics: { glyph: "|", color: "w" },
      atack: { hd: "1d5" },
    }).find((x) => x.rule === "field/unknown");
    expect(f?.message).toContain("did you mean `attack`");
  });

  it("says nothing about a namespaced field, which is the other rule's business", () => {
    const findings = check({
      name: "& Sludge~",
      type: "sword",
      graphics: { glyph: "|", color: "w" },
      "gore:bleed": { turns: 5 },
    });
    expect(findings.map((f) => f.field)).not.toContain("gore:bleed");
  });

  it("names a field written as the wrong shape", () => {
    const f = check({
      name: "& Sludge~",
      type: "sword",
      graphics: { glyph: "|", color: "w" },
      cost: "lots",
    }).find((x) => x.rule === "field/type");
    expect(f?.message).toContain("`cost` is string");
  });

  it("names the item type a mod invents without adding an object_base for it", () => {
    const f = check({
      name: "& Sludge~",
      type: "gloop",
      graphics: { glyph: "|", color: "w" },
    }).find((x) => x.rule === "reference/dangling");
    expect(f?.message).toContain('"gloop"');
    expect(f?.message).toContain("object_base");
  });

  it("stops naming it once the mod adds the object_base too", () => {
    const record: JsonRecord = {
      name: "& Sludge~",
      type: "gloop",
      graphics: { glyph: "|", color: "w" },
    };
    const all = {
      ...core,
      object: [...(core["object"] ?? []), record],
      object_base: [...object_base, { name: { tval: "gloop", name: "Gloop~" } }],
    };
    const findings = checkRecords({ object: [record] }, all);
    expect(findings.map((f) => f.rule)).not.toContain("reference/dangling");
  });

  it("names the companion step an author will not think of", () => {
    const rules = check({
      name: "& Sludge~",
      type: "sword",
      graphics: { glyph: "|", color: "w" },
    }).map((f) => f.rule);
    expect(rules).toContain("object/no-alloc");
    expect(rules).toContain("object/no-cost");
  });

  it("warns when a new object exhausts its type's flavours", () => {
    /* Angband hands each object of a flavoured type its own flavour; past that
     * point unidentified potions stop being distinguishable. Nothing in the
     * game says so, which is exactly why it is here. */
    const potions = (core["object"] ?? []).filter((r) => r["type"] === "potion");
    const supply =
      (core["flavor"] ?? [])
        .filter((r) => (r["kind"] as { tval?: string } | undefined)?.tval === "potion")
        .reduce((n, r) => n + (Array.isArray(r["flavor"]) ? r["flavor"].length : 0), 0);
    const extra = supply - potions.length + 1;
    const added: JsonRecord[] = Array.from({ length: extra }, (_, i) => ({
      name: `& Sludge Potion ${String(i)}~`,
      type: "potion",
      graphics: { glyph: "!", color: "w" },
    }));
    const all = { ...core, object: [...(core["object"] ?? []), ...added] };
    const f = checkRecords({ object: added }, all).find((x) => x.rule === "flavor/exhausted");
    expect(f?.message).toContain("potion flavours");
  });

  it("names a record file core does not ship at all", () => {
    const f = checkRecords({ sludge: [{ name: "x" }] }, {}).find((x) => x.rule === "file/unknown");
    expect(f?.message).toContain("nothing will read it");
  });

  it("filters to the level asked for", () => {
    const bare: JsonRecord = { name: "& Sludge~", type: "sword" };
    const all = { ...core, object: [...(core["object"] ?? []), bare] };
    const errors = checkRecords({ object: [bare] }, all, { minLevel: "error" });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((f) => f.level === "error")).toBe(true);
  });
});

describe("the companion rules", () => {
  it("every one of them names a file core ships", () => {
    for (const rule of COMPANION_RULES) {
      expect(core[rule.file] ?? packRecords(rule.file), rule.id).not.toHaveLength(0);
    }
  });

  it("has a unique id per rule, so a host can filter on one", () => {
    const ids = COMPANION_RULES.map((r) => r.id);
    expect([...new Set(ids)]).toHaveLength(ids.length);
  });
});

describe("describeFile", () => {
  it("separates what core always writes from what it usually writes", () => {
    const text = describeFile("object");
    expect(text).toContain("always present: graphics, name, type");
    expect(text).toContain("alloc");
  });
});
