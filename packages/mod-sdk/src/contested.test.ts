import { describe, expect, it } from "vitest";
import type { Claim, ContestedSlot, Fold } from "./contested.js";
import {
  contestedSlots,
  describeContested,
  describeDeclaredConflict,
  foldDiscards,
} from "./contested.js";

const claim = (packId: string, extra: Partial<Claim> = {}): Claim => ({ packId, ...extra });

/** Claims on one key, in load order. */
function on(key: string, what: string, ...packs: (string | Claim)[]) {
  return packs.map((p) => ({
    key,
    what,
    claim: typeof p === "string" ? claim(p) : p,
  }));
}

describe("contestedSlots", () => {
  it("reports nothing when one pack claims a key", () => {
    expect(contestedSlots("record", "last-wins", on("k", "kobold's speed", "frost"))).toEqual([]);
  });

  it("reports nothing when a pack claims a key twice by itself", () => {
    /* A pack whose base contributions and one of its own sections touch a field
     * has made one decision in two places; its own order settles it. */
    const claims = on("k", "kobold's speed", claim("frost"), claim("frost", { sectionId: "s" }));
    expect(contestedSlots("record", "last-wins", claims)).toEqual([]);
  });

  it("reports a key two packs claim, keeping load order", () => {
    const [slot] = contestedSlots("record", "last-wins", on("k", "kobold's speed", "frost", "runes"));
    expect(slot?.claims.map((c) => c.packId)).toEqual(["frost", "runes"]);
    expect(slot?.what).toBe("kobold's speed");
    expect(slot?.layer).toBe("record");
  });

  it("gives a last-wins slot to the last claimant", () => {
    const [slot] = contestedSlots("record", "last-wins", on("k", "x", "frost", "runes"));
    expect(slot?.winner).toBe("runes");
  });

  it("gives a single-slot to the last claimant, matching installController", () => {
    const [slot] = contestedSlots("controller", "single-slot", on("c", "an autoplayer", "borg", "other"));
    expect(slot?.winner).toBe("other");
  });

  /* THE CONSISTENCY CLAIM, in one assertion: every fold that picks a winner
   * picks the same claim as last-wins does. A behaviour hook that resolved to
   * "frost" here while the record layer resolved to "runes" is the state this
   * model was in until 2026-08-02, and it is what made the manager's one lever
   * mean two opposite things depending on which layer a mod happened to use. */
  it("gives a last-answer slot to the last claimant, same as every other winner", () => {
    const claimants = on("h", "x", "frost", "runes");
    const [behaviour] = contestedSlots("behaviour", "last-answer", claimants);
    const [record] = contestedSlots("record", "last-wins", claimants);
    expect(behaviour?.winner).toBe("runes");
    expect(behaviour?.winner).toBe(record?.winner);
  });

  it("names no winner for a fold that combines", () => {
    for (const fold of ["all-must-agree", "chained", "any-yes"] as const) {
      const [slot] = contestedSlots("behaviour", fold, on("h", "x", "frost", "runes"));
      expect(slot?.winner).toBeUndefined();
    }
  });

  it("keeps separate keys apart", () => {
    const slots = contestedSlots("record", "last-wins", [
      ...on("a", "speed", "frost", "runes"),
      ...on("b", "colour", "frost"),
    ]);
    expect(slots.map((s) => s.key)).toEqual(["a"]);
  });
});

describe("foldDiscards", () => {
  /* The three that discard are the ones worth a player's attention; the rest
   * combine and are reported only so the picture is complete. */
  it("is true exactly for the folds that drop somebody's contribution", () => {
    const discarding: Fold[] = ["last-wins", "last-answer", "single-slot"];
    const combining: Fold[] = ["all-must-agree", "chained", "any-yes"];
    for (const f of discarding) expect(foldDiscards(f)).toBe(true);
    for (const f of combining) expect(foldDiscards(f)).toBe(false);
  });
});

describe("describeContested", () => {
  const slot = (fold: Fold, extra: Partial<ContestedSlot> = {}): ContestedSlot => ({
    layer: "record",
    key: "core:kobold.speed",
    what: "kobold's speed",
    fold,
    claims: [claim("frost"), claim("runes")],
    ...(foldDiscards(fold) ? { winner: "runes" } : {}),
    ...extra,
  });

  it("names the winner and the reason for last-wins", () => {
    const line = describeContested(slot("last-wins"));
    expect(line).toContain("frost and runes");
    expect(line).toContain("runes wins");
    expect(line).toContain("loads last");
  });

  /* The player needs to know the loser's rule NEVER RUNS here, which is a
   * different and worse outcome than being overwritten. */
  it("says the losers never run for last-answer, and still names load order", () => {
    const line = describeContested(slot("last-answer"));
    expect(line).toContain("never get asked");
    /* The loser needs the same lever named as on every other layer: the reason
     * runes won is that it loads last, and the fix is to move it. */
    expect(line).toContain("loads last");
  });

  it("says the others do nothing for a single slot", () => {
    expect(describeContested(slot("single-slot"))).toContain("do nothing");
  });

  it("says combining folds do not conflict rather than naming a winner", () => {
    expect(describeContested(slot("any-yes"))).toContain("do not conflict");
    expect(describeContested(slot("chained"))).toContain("each one seeing the last one's result");
    expect(describeContested(slot("all-must-agree"))).toContain("has to agree");
  });

  it("uses display names when given them", () => {
    const line = describeContested(slot("last-wins"), (id) =>
      id === "frost" ? "Frost Realms" : "Rune Magic",
    );
    expect(line).toContain("Frost Realms and Rune Magic");
    expect(line).not.toContain("runes wins");
  });

  it("names a section a claim came from", () => {
    const line = describeContested(
      slot("last-wins", { claims: [claim("frost"), claim("runes", { sectionId: "speeds" })] }),
    );
    expect(line).toContain("runes (speeds)");
  });

  /* A band is the one thing the load-order list cannot show: the mod sits where
   * the player put it and its part composes somewhere else. */
  it("explains a win that came from a band, not from the load order", () => {
    const line = describeContested(
      slot("last-wins", {
        claims: [claim("frost"), claim("runes", { sectionId: "speeds", band: "last" })],
      }),
    );
    expect(line).toContain('its "speeds" part is set to load last');
  });

  it("says nothing about a band when the winner sits at normal", () => {
    const line = describeContested(
      slot("last-wins", { claims: [claim("frost"), claim("runes", { band: "normal" })] }),
    );
    expect(line).not.toContain("set to load");
  });

  it("lists three claimants readably", () => {
    const line = describeContested(
      slot("last-wins", { claims: [claim("a"), claim("b"), claim("c")], winner: "c" }),
    );
    expect(line).toContain("a, b and c");
  });
});

describe("describeDeclaredConflict", () => {
  /* A declaration, not an observation - nobody measured a collision, an author
   * stated one - so the author's own words carry the line. */
  it("carries the author's reason", () => {
    const line = describeDeclaredConflict({
      packId: "frost",
      with: "runes",
      because: "Both rewrite the kobold's speed and ours assumes 4.2.6.",
    });
    expect(line).toContain("frost says it conflicts with runes");
    expect(line).toContain("Both rewrite the kobold's speed");
  });

  it("names the scope when the claim has one", () => {
    const line = describeDeclaredConflict({
      packId: "frost",
      with: "runes",
      scope: ["kobolds", "orcs"],
      because: "speed.",
    });
    expect(line).toContain("over kobolds, orcs");
  });

  it("uses display names", () => {
    const line = describeDeclaredConflict(
      { packId: "frost", with: "runes", because: "x" },
      (id) => (id === "frost" ? "Frost Realms" : "Rune Magic"),
    );
    expect(line).toContain("Frost Realms says it conflicts with Rune Magic");
  });
});
