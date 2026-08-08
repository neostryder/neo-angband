/**
 * The known-key table is a MEASUREMENT of core's own data, so it is gated by
 * re-measuring.
 *
 * If the table drifts from the pack in EITHER direction the seam goes wrong in
 * a way nobody would notice by playing: a key that leaves the table starts
 * showing up in every mod's `ext` as if a mod had added it, and a key that
 * appears in the table without being in the pack quietly swallows a real
 * extension. Both are silent, so both are asserted.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CORE_RECORD_KEYS, extensionData } from "./record-keys.js";

const packDir = fileURLToPath(new URL("../../../content/pack", import.meta.url));

/** file stem -> every top-level key its records use, re-derived from the pack. */
function keysFromPack(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const file of readdirSync(packDir).filter((f) => f.endsWith(".json")).sort()) {
    const stem = file.replace(/\.json$/, "");
    const raw = JSON.parse(readFileSync(`${packDir}/${file}`, "utf8")) as
      | unknown[]
      | { records: unknown[] };
    const records = Array.isArray(raw) ? raw : raw.records;
    if (!Array.isArray(records)) continue;
    const keys = new Set<string>();
    for (const r of records) {
      if (r !== null && typeof r === "object" && !Array.isArray(r)) {
        for (const k of Object.keys(r)) keys.add(k);
      }
    }
    out[stem] = [...keys].sort();
  }
  return out;
}

describe("CORE_RECORD_KEYS", () => {
  it("matches the shipped pack exactly, in both directions", () => {
    /* Not "contains" - EQUALS. A superset silently swallows a mod's extension;
     * a subset hands every mod an `ext` full of core's own fields. */
    expect(CORE_RECORD_KEYS).toEqual(keysFromPack());
  });

  it("covers every record file the pack ships", () => {
    expect(Object.keys(CORE_RECORD_KEYS)).toHaveLength(44);
    for (const stem of ["object", "monster", "ego_item", "vault", "terrain"]) {
      expect(CORE_RECORD_KEYS[stem], stem).toBeDefined();
    }
  });
});

describe("extensionData", () => {
  it("returns undefined for a record made only of core's own keys", () => {
    /* The overwhelmingly common case. Undefined rather than {} so `ext` being
     * present on a bound record MEANS a mod added something. */
    expect(extensionData("object", { name: "Dagger", type: "sword" })).toBeUndefined();
  });

  it("returns only the keys core does not know, not the whole record", () => {
    const ext = extensionData("object", {
      name: "Dagger",
      type: "sword",
      attack: { hd: "1d5" },
      bleed: { dice: "1d3", turns: 5 },
    });
    expect(ext).toEqual({ bleed: { dice: "1d3", turns: 5 } });
    /* Core's own fields must NOT be duplicated in here: a mod reading
     * ext.attack would be reading the pre-bind value and could disagree with
     * the bound one forever without either being wrong. */
    expect(ext?.["attack"]).toBeUndefined();
    expect(ext?.["name"]).toBeUndefined();
  });

  it("freezes what it returns, so one mod cannot rewrite what another reads", () => {
    const ext = extensionData("object", { name: "x", type: "sword", bleed: 1 }) as Record<
      string,
      unknown
    >;
    expect(Object.isFrozen(ext)).toBe(true);
  });

  it("refuses to guess about a file core ships no data for", () => {
    /* Treating an unknown file as "every key is an extension" would hand a mod
     * an ext full of fields core actually binds - confidently wrong, which is
     * worse than declining. */
    expect(extensionData("not_a_real_file", { anything: 1 })).toBeUndefined();
  });
});
