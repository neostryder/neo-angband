/**
 * The reference graph, measured against core's own 3,279 records.
 *
 * THE POINT OF THIS FILE. A declared edge that is WRONG invents errors in data
 * that works, which is the fastest way to get a checker switched off. So every
 * edge is run over the shipped pack and its unresolved count is pinned. An edge
 * that starts resolving less than it did is either a change in the data or a
 * mistake in the table, and both want looking at.
 *
 * THE PINNED NUMBERS ARE UPSTREAM'S OWN WARTS, and writing them down here is
 * the second reason this file exists. `artifact.txt` says
 * `base-object:soft armour:...` where `object_base.txt` and `list-tvals.h` both
 * spell it `soft armor`; fourteen artifact base objects (Phial, Arkenstone,
 * several rings) name svals `object.txt` never defines. Those are Angband
 * 4.2.6's, reproduced exactly under the parity mandate, and they are why an
 * unresolved reference is a warning rather than a refusal.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { JsonRecord } from "./compose.js";
import {
  danglingReferences,
  normalizeRef,
  REFERENCE_EDGES,
  valuesAtPath,
} from "./references.js";

const packDir = new URL("../../content/pack/", import.meta.url);

function packRecords(stem: string): JsonRecord[] {
  const raw: unknown = JSON.parse(readFileSync(new URL(`${stem}.json`, packDir), "utf8"));
  const records = Array.isArray(raw) ? raw : (raw as { records?: unknown[] }).records;
  if (!Array.isArray(records)) return [];
  return records.filter(
    (r): r is JsonRecord => r !== null && typeof r === "object" && !Array.isArray(r),
  );
}

const core: Record<string, JsonRecord[]> = {};
for (const edge of REFERENCE_EDGES) {
  core[edge.file] ??= packRecords(edge.file);
  core[edge.target] ??= packRecords(edge.target);
}

/**
 * Every reference in core's data that does not resolve, by edge.
 *
 * The count, not the list, so the assertion reads as a baseline. The values
 * themselves are in the message when one changes.
 */
const CORE_UNRESOLVED: Readonly<Record<string, number>> = {
  /* One object per special: <pile>, <unknown item>, <unknown treasure>,
   * <curse object> all carry `type: "none"`, which object_base has no record
   * for. They are core's internal placeholders, not items. */
  "object.type": 4,
  /* Upstream's armour/armor split: artifact.txt and store.txt say "soft
   * armour" / "hard armour" / "dragon armour", object_base.txt and
   * list-tvals.h say "soft armor". Counted in REFERENCES, not distinct
   * spellings: 13 artifacts and 7 store entries. */
  "artifact.base-object.tval": 13,
  "store.normal.tval": 7,
  /* 14 artifact base objects naming svals object.txt never defines - Phial,
   * Star, Arkenstone and eleven rings. */
  "artifact.base-object.sval": 14,
  /* Two `friends` entries naming "spider", which is a monster BASE and not a
   * monster. */
  "monster.friends.name": 2,
};

describe("every declared edge resolves in core's own data", () => {
  const found = new Map<string, number>();
  for (const d of danglingReferences(core)) {
    const key = `${d.file}.${d.path}`;
    found.set(key, (found.get(key) ?? 0) + 1);
  }

  it("leaves exactly the unresolved references upstream itself ships", () => {
    expect(Object.fromEntries([...found.entries()].sort())).toEqual(
      Object.fromEntries(Object.entries(CORE_UNRESOLVED).sort()),
    );
  });

  it("exercises every edge, so none of them is an untested claim", () => {
    /* An edge core never uses cannot be measured, and an unmeasured edge is
     * indistinguishable from a wrong one. */
    for (const edge of REFERENCE_EDGES) {
      const refs = (core[edge.file] ?? []).flatMap((r) => valuesAtPath(r, edge.path));
      expect(refs.length, `${edge.file}.${edge.path} is never used by core`).toBeGreaterThan(0);
    }
  });

  it("names a target file for every edge, and core ships all of them", () => {
    for (const edge of REFERENCE_EDGES) {
      expect((core[edge.target] ?? []).length, edge.target).toBeGreaterThan(0);
    }
  });
});

describe("a mod's dangling reference", () => {
  const base = {
    monster_base: [{ name: "ooze" }],
    monster: [{ name: "grey ooze", base: "ooze" }],
    blow_methods: [{ name: "HIT" }],
    blow_effects: [{ name: "HURT" }],
  };

  it("is found, and the message names the record, the field and the file", () => {
    const all = {
      ...base,
      monster: [...base.monster, { name: "sludge fiend", base: "oooze" }],
    };
    const out = danglingReferences(all);
    expect(out).toHaveLength(1);
    expect(out[0]?.message).toContain('monster "sludge fiend"');
    expect(out[0]?.message).toContain('"oooze"');
    expect(out[0]?.message).toContain("monster_base");
  });

  it("resolves against the mod's OWN new records, not just core's", () => {
    /* The check that makes the checker usable: a mod adding a monster base and
     * a monster that uses it must not be told its own base is missing. */
    const all = {
      ...base,
      monster_base: [...base.monster_base, { name: "sludge" }],
      monster: [...base.monster, { name: "sludge fiend", base: "sludge" }],
    };
    expect(danglingReferences(all)).toEqual([]);
  });

  it("reports only the subject's records when one is given", () => {
    const all = {
      ...base,
      monster: [
        { name: "broken core monster", base: "nonexistent" },
        { name: "sludge fiend", base: "alsomissing" },
      ],
    };
    const out = danglingReferences(all, { monster: [all.monster[1] as JsonRecord] });
    expect(out.map((d) => d.from)).toEqual(["sludge fiend"]);
  });

  it("does not fire on a keyword that is not a name", () => {
    /* monster.txt writes `friends:...:Same` to mean "more of me". */
    const all = {
      ...base,
      monster: [{ name: "grey ooze", base: "ooze", friends: [{ name: "Same" }] }],
    };
    expect(danglingReferences(all)).toEqual([]);
  });

  it("splits a pipe-joined list into its separate references", () => {
    const all = {
      ...base,
      monster_spell: [{ name: "BLINK" }],
      monster: [{ name: "grey ooze", base: "ooze", spells: ["BLINK | HEAL"] }],
    };
    expect(danglingReferences(all).map((d) => d.value)).toEqual(["HEAL"]);
  });
});

describe("normalizeRef", () => {
  it("strips the article and plural marks Angband writes object names with", () => {
    expect(normalizeRef("& Wooden Torch~", "object-name")).toBe("wooden torch");
    expect(normalizeRef("Wooden Torch", "object-name")).toBe("wooden torch");
  });

  it("leaves a code exactly as it is", () => {
    expect(normalizeRef("ACID_3", "exact")).toBe("ACID_3");
  });
});

describe("valuesAtPath", () => {
  it("maps across an array rather than stopping at it", () => {
    const r: JsonRecord = { blow: [{ method: "HIT" }, { method: "BITE" }] };
    expect(valuesAtPath(r, "blow.method")).toEqual(["HIT", "BITE"]);
  });

  it("yields nothing for a path the record does not have", () => {
    expect(valuesAtPath({ name: "x" }, "blow.method")).toEqual([]);
  });
});
