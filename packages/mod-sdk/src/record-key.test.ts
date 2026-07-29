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
  RECORD_KEY_SPECS,
  recordKey,
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

  it("reports the exact per-file ambiguity in core's own data", () => {
    /* Where core ships two records that claim one key, the ref is unaddressable
     * and the loader says so. Pinning the numbers keeps that honest: if a key
     * change reduced them to zero the table would be strictly better, and this
     * test tells us instead of the improvement passing unnoticed. */
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
      /* "Acquirement" / "*Acquirement*" and four more pairs: slugify drops "*". */
      object: 5,
      /* "Little eruption" / "Little eruption+": slugify drops "+". */
      vault: 1,
      /* Genuine: "of Acid" applies to two disjoint item-type sets, and those
       * sets are fields a mod would patch, so they cannot be its identity. */
      ego_item: 25,
    });
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
