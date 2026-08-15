/**
 * Monster-lore spell knowledge is persisted BY NAME (MOD_REACH row 22).
 *
 * Until SAVE_VERSION 5 the savefile stored the raw bytes of the lore FlagSet,
 * so what a character remembered was a set of RSF BIT POSITIONS. That made
 * `MON_SPELL_ENTRIES` the one generated table that could not be opened by
 * appending: `PROJ` and `MSG` are resolved to a number at use time, so nothing
 * a save holds is renumbered when they grow, but an RSF slot IS a stored index.
 *
 * The control below is the point of this file. It does not assert that names
 * round-trip - that is nearly tautological - it RENUMBERS the table and shows
 * the two schemes part company: the byte-keyed read silently names different
 * spells, and the name-keyed read is unmoved. A test that only exercised the
 * happy path would pass just as well against the shape this ticket removed.
 */

import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag.js";
import { RSF } from "../generated/index.js";
import { RSF_FLAG_NAMES } from "../mon/lore-file.js";
import { RSF_SIZE } from "../mon/types.js";
import { deserializeLoreSpells, serializeLoreSpells } from "./save.js";

function observed(...flags: number[]): FlagSet {
  const set = new FlagSet(RSF_SIZE);
  for (const f of flags) set.on(f);
  return set;
}

describe("serializeLoreSpells / deserializeLoreSpells", () => {
  it("writes RSF names, ascending by flag number", () => {
    const names = serializeLoreSpells(observed(RSF.HASTE, RSF.BR_FIRE, RSF.BA_COLD));
    expect(names).toEqual(["BR_FIRE", "BA_COLD", "HASTE"]);
    /* Ascending: the save is byte-stable for an unchanged record. */
    const numbers = names.map((n) => RSF_FLAG_NAMES.indexOf(n));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  });

  it("round-trips an arbitrary observed set exactly", () => {
    const before = observed(RSF.SHRIEK, RSF.ARROW, RSF.BR_NETH, RSF.TELE_TO, RSF.BLIND);
    const after = deserializeLoreSpells(serializeLoreSpells(before));
    expect(Array.from(after.bits)).toEqual(Array.from(before.bits));
  });

  it("knows nothing from an empty set, and nothing from a missing field", () => {
    expect(serializeLoreSpells(new FlagSet(RSF_SIZE))).toEqual([]);
    expect(deserializeLoreSpells([]).isEmpty()).toBe(true);
    expect(deserializeLoreSpells(undefined).isEmpty()).toBe(true);
  });

  it("skips the padding bits above RSF.MAX, sentinel included", () => {
    /* RSF_SIZE rounds 91 spells up to 12 bytes, so a set has 96 addressable
     * bits. Index 92 is the enum's own MAX sentinel and 93-96 name nothing;
     * neither may reach the save. */
    const all = new FlagSet(RSF_SIZE);
    all.setall();
    const names = serializeLoreSpells(all);
    expect(names).toHaveLength(RSF.MAX - 1);
    expect(names).not.toContain("MAX");
    expect(names.every((n) => typeof n === "string")).toBe(true);
    /* And the sentinel does not come back in through the reader either. */
    expect(deserializeLoreSpells(["MAX"]).isEmpty()).toBe(true);
  });

  it("drops a name this build does not have instead of guessing a bit", () => {
    /* A spell contributed by a mod that is no longer installed. The old shape
     * had no way to express this: an index simply landed on whatever now
     * occupies it. */
    const set = deserializeLoreSpells(["BR_FIRE", "SOME_MOD_SPELL", "HASTE"]);
    expect(serializeLoreSpells(set)).toEqual(["BR_FIRE", "HASTE"]);
  });

  /**
   * THE CONTROL. Model the thing row 22 was blocking - one new RSF entry
   * inserted, so every flag above it moves up by one - and read a save written
   * before it under both schemes.
   */
  describe("a renumbered RSF table", () => {
    /** RSF_FLAG_NAMES as it would read with one entry appended at position 1. */
    const renumbered: readonly (string | undefined)[] = [
      RSF_FLAG_NAMES[0],
      "MOD_WITHER",
      ...RSF_FLAG_NAMES.slice(1),
    ];

    it("re-points the BIT POSITIONS a version-4 save stored", () => {
      const stored = observed(RSF.BR_FIRE, RSF.HASTE);
      /* Version 4's reader was "these bit numbers, through the current table". */
      const nowMeans = Array.from(stored).map((f) => renumbered[f]);
      expect(nowMeans).toEqual(["BR_ELEC", "HOLD"]);
      /* Which is the bug, stated as an assertion: the same bytes, different
       * spells. Nothing about the save changed. */
      expect(nowMeans).not.toEqual(["BR_FIRE", "HASTE"]);
    });

    it("cannot re-point the NAMES a version-5 save stores", () => {
      const stored = observed(RSF.BR_FIRE, RSF.HASTE);
      const written = serializeLoreSpells(stored);
      expect(written).toEqual(["BR_FIRE", "HASTE"]);

      /* The version-5 reader, against the renumbered table. */
      const read = written.map((n) => renumbered.indexOf(n));
      expect(read.map((f) => renumbered[f])).toEqual(["BR_FIRE", "HASTE"]);
      /* The flag NUMBERS moved, which is exactly what appending does - and the
       * knowledge did not, which is what this ticket bought. */
      expect(read).toEqual([RSF.BR_FIRE + 1, RSF.HASTE + 1]);
    });
  });
});
