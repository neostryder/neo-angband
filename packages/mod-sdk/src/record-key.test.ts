/**
 * The record-key declaration is a MEASUREMENT, so it is gated by measuring.
 *
 * Two ratchets:
 *  1. The declared file set, asserted as an exact set so it fails in BOTH
 *     directions - a file wrongly added and a file wrongly removed.
 *  2. Every declared key, re-derived over the REAL shipped core pack
 *     (packages/content/pack/*.json). A key that stops being unique, or starts
 *     resolving to nothing, fails here instead of quietly making a mod author's
 *     patch unaddressable.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KEYED_RECORD_FILES,
  keySpecFor,
  legacyRecordKey,
  RECORD_KEY_SPECS,
  recordKey,
  recordRefKeys,
} from "./record-key.js";

/**
 * The files whose identity is NOT a unique string `name`, measured over
 * packages/content/pack on 2026-07-29 (14 with no string `name`, 6 whose names
 * slug to the same ref). `history` is deliberately NOT here: it has no identity
 * to key on, so an op against it is reported instead of applied.
 */
const EXPECTED_KEYED_FILES = [
  "body",
  "brand",
  "chest_trap",
  "constants",
  "ego_item",
  "flavor",
  "hints",
  "names",
  "object",
  "object_base",
  "pain",
  "projection",
  "slay",
  "store",
  "trap",
  "ui_knowledge",
  "vault",
  "visuals",
  "world",
].sort();

/** The 20 upstream files that are whole-file passthrough (24 are composable). */
const PASSTHROUGH_FILES = [...EXPECTED_KEYED_FILES, "history"].sort();

function corePackFile(stem: string): unknown[] {
  const path = fileURLToPath(
    new URL(`../../content/pack/${stem}.json`, import.meta.url),
  );
  const raw = JSON.parse(readFileSync(path, "utf8")) as
    | unknown[]
    | { records: unknown[] };
  return Array.isArray(raw) ? raw : raw.records;
}

describe("RECORD_KEY_SPECS", () => {
  it("declares exactly the expected files (fails on an addition OR a removal)", () => {
    /* Set equality both ways. A sorted-array compare would already do it, but
     * spelling out the two directions makes the intent unmissable to the next
     * person who adds a spec and "fixes" the test by appending to one list. */
    expect([...KEYED_RECORD_FILES].sort()).toEqual(EXPECTED_KEYED_FILES);
    expect(
      EXPECTED_KEYED_FILES.filter((f) => !KEYED_RECORD_FILES.includes(f)),
    ).toEqual([]);
    expect(
      KEYED_RECORD_FILES.filter((f) => !EXPECTED_KEYED_FILES.includes(f)),
    ).toEqual([]);
  });

  it("does not claim history, which has no per-record identity", () => {
    expect(RECORD_KEY_SPECS["history"]).toBeUndefined();
    expect(PASSTHROUGH_FILES).toContain("history");
  });

  it("keys every record of every declared file in the shipped core pack", () => {
    const unkeyed: string[] = [];
    for (const stem of EXPECTED_KEYED_FILES) {
      const records = corePackFile(stem);
      expect(records.length, `${stem} has records`).toBeGreaterThan(0);
      for (const r of records) {
        if (recordKey(stem, r, keySpecFor(stem)) === null) unkeyed.push(stem);
      }
    }
    expect(unkeyed).toEqual([]);
  });

  it("reports the exact per-file BASE-key ambiguity in core's own data", () => {
    /* Where core ships two records that claim one BASE key, that ref alone
     * cannot address either of them - the loader refuses it and names the
     * discriminated alternatives. Pinning the numbers keeps the shape of the
     * problem visible; the test that matters is the next one, which asserts
     * every record is reachable by SOME ref.
     *
     * These counts moved on 2026-08-08 when keySlug stopped dropping "*" and
     * "+": object 5 -> 0 and vault 1 -> 0 were pure slug loss, and ego_item
     * 25 -> 23 lost the two "*Slay X*" pairs the same way. */
    const ambiguous: Record<string, number> = {};
    for (const stem of EXPECTED_KEYED_FILES) {
      const seen = new Set<string>();
      const dup = new Set<string>();
      for (const r of corePackFile(stem)) {
        const key = recordKey(stem, r, keySpecFor(stem)) as string;
        if (seen.has(key)) dup.add(key);
        seen.add(key);
      }
      if (dup.size > 0) ambiguous[stem] = dup.size;
    }
    expect(ambiguous).toEqual({
      /* Genuine repeats: "of Acid" applies to two disjoint item-type sets. Each
       * is addressable through its discriminator - see the next test. */
      ego_item: 23,
    });
  });

  it("leaves NO record of the shipped pack unaddressable", () => {
    /* THE ONE THAT MATTERS. A key declared per FILE is not the same as every
     * RECORD being reachable, and the difference used to be 73 records - 61 of
     * ego_item's 107 among them, so "of Acid" could not be patched at all.
     *
     * Reachable means: some ref resolves to this record ALONE. That is exactly
     * what the loader requires, so this measures the property a mod author
     * experiences rather than a property of the key table. */
    const unreachable: Record<string, string[]> = {};
    for (const stem of EXPECTED_KEYED_FILES) {
      const records = corePackFile(stem);
      const claims = new Map<string, number[]>();
      const claim = (key: string, i: number): void => {
        const at = claims.get(key);
        if (at) at.push(i);
        else claims.set(key, [i]);
      };
      const primary = new Set(
        records.flatMap((r) => [...recordRefKeys(stem, r)]),
      );
      records.forEach((r, i) => {
        for (const key of recordRefKeys(stem, r)) claim(key, i);
        const legacy = legacyRecordKey(stem, r);
        if (legacy !== null && !primary.has(legacy)) claim(legacy, i);
      });
      const reachable = new Set<number>();
      for (const [, at] of claims) if (at.length === 1) reachable.add(at[0] as number);
      const missing = records
        .map((r, i) => [r, i] as const)
        .filter(([, i]) => !reachable.has(i))
        .map(([r]) => String((r as { name?: unknown }).name ?? "?"));
      if (missing.length > 0) unreachable[stem] = missing;
    }
    expect(unreachable).toEqual({});
  });

  it("spells out the marks slugify drops, so *Healing* is not Healing", () => {
    /* The five object pairs and the vault pair were never ambiguous DATA - the
     * key was lossy. "*" and "+" are Angband's mark for the greater form. */
    const key = (name: string): string | null =>
      recordKey("object", { type: "potion", name });
    expect(key("*Healing*")).toBe("potion--star-healing-star");
    expect(key("Healing")).toBe("potion--healing");
    expect(key("*Healing*")).not.toBe(key("Healing"));
    expect(recordKey("vault", { type: "interesting room", name: "Little eruption+" })).toBe(
      "interesting-room--little-eruption-plus",
    );
  });

  it("keeps the pre-mark ref as an alias, so an older mod's patch still resolves", () => {
    /* Widening what resolves must not move what already did. The legacy key is
     * offered for exactly the records whose slug changed, and for nobody else. */
    expect(legacyRecordKey("object", { type: "potion", name: "*Healing*" })).toBe(
      "potion--healing",
    );
    expect(legacyRecordKey("object", { type: "potion", name: "Healing" })).toBeNull();
    expect(legacyRecordKey("monster", { name: "Grip, Farmer Maggot's dog" })).toBeNull();
  });

  it("discriminates same-named egos by the item types they apply to", () => {
    /* Upstream's own identity for an ego is lookup_ego_item(name, tval, sval).
     * `type` names tvals directly and `item` pins (tval, sval) pairs; a record
     * uses one or the other, so both are read. */
    const acid = (corePackFile("ego_item") as Array<{ name: string }>).filter(
      (r) => r.name === "of Acid",
    );
    expect(acid.length).toBeGreaterThan(1);
    const refs = acid.map((r) => [...recordRefKeys("ego_item", r)]);
    for (const r of refs) expect(r[0]).toBe("of-acid");
    const discriminated = refs.map((r) => r[1]);
    expect(new Set(discriminated).size).toBe(acid.length);
    expect(discriminated).toContain("of-acid#sword-polearm-hafted");
  });

  it("offers only the base ref when a file declares no discriminator", () => {
    /* A discriminator is per-file and opt-in: declaring one for ego_item must
     * not start appending "#" to every other file's refs. */
    expect([...recordRefKeys("brand", { code: "ACID_3", name: "acid" })]).toEqual([
      "acid-3",
    ]);
    expect([...recordRefKeys("monster", { name: "Fang" })]).toEqual(["fang"]);
  });

  it("keys a config singleton by its file, so a fieldPatch can reach it", () => {
    const [constants] = corePackFile("constants") as [Record<string, unknown>];
    expect(recordKey("constants", constants)).toBe("constants");
    expect(corePackFile("constants")).toHaveLength(1);
  });

  it("returns null rather than a guess when a key field is missing or non-scalar", () => {
    expect(recordKey("brand", { name: "acid" })).toBeNull(); // no `code`
    expect(recordKey("brand", { code: { a: 1 } })).toBeNull(); // not a scalar
    expect(recordKey("brand", { code: "" })).toBeNull(); // empty slug
    expect(recordKey("brand", "not-an-object")).toBeNull();
    expect(recordKey("object", { name: "Torch" })).toBeNull(); // needs type + name
  });

  it("joins a composite key in declared order", () => {
    expect(recordKey("object", { type: "scroll", name: "Word of Recall" })).toBe(
      "scroll--word-of-recall",
    );
    expect(
      recordKey("trap", { name: { name: "pit", desc: "spiked pit" } }),
    ).toBe("pit--spiked-pit");
  });

  it("keys by a numeric field (pain sets and name sections are index-keyed)", () => {
    expect(recordKey("pain", { type: 7, message: [] })).toBe("7");
    expect(recordKey("names", { section: 2, word: [] })).toBe("2");
  });

  it("falls back to `name` for any file it does not declare", () => {
    expect(keySpecFor("monster")).toEqual({ kind: "fields", paths: ["name"] });
    expect(recordKey("monster", { name: "Grip, Farmer Maggot's Dog" })).toBe(
      "grip-farmer-maggot-s-dog",
    );
  });
});
