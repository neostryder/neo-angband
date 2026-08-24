/**
 * The import policy, which is the port's answer to "an export is a restore point".
 *
 * Every case here is a thing a player can do with two keypresses and a file
 * manager, so the assertions are about the DECISION rather than the wording: what
 * lands in the roster, what does not, and whose slot it lands in.
 */

import { describe, expect, it } from "vitest";
import { decideImport } from "./transfer-gate";
import type { CharMeta, DeathRecord } from "./roster";
import { encodeTransfer, decodeTransfer, type TransferMeta } from "./save-transfer";

const META: TransferMeta = {
  name: "Grond",
  race: "Half-Troll",
  cls: "Warrior",
  sex: "Male",
  level: 17,
  depth: 12,
  maxDepth: 14,
  turn: 41_233,
  alive: true,
};

/**
 * A file, built by the real encoder and read back by the real decoder.
 *
 * Not a hand-written object literal: the gate reads `lineage` and `meta.turn`, and
 * a fixture that set those directly would be asserting about a shape the exporter
 * might not actually write (that is what "a hand-written mirror is mostly right"
 * costs). This way the round trip is part of every case.
 */
function file(over: { turn?: number; lineage?: string; name?: string } = {}) {
  const text = encodeTransfer({
    meta: {
      ...META,
      ...(over.turn !== undefined ? { turn: over.turn } : {}),
      ...(over.name !== undefined ? { name: over.name } : {}),
    },
    save: "AAECAwQ=",
    engine: "0.17.0",
    exportedAt: "2026-08-03T12:00:00.000Z",
    lineage: over.lineage ?? "lin-grond",
  });
  const read = decodeTransfer(text);
  if (!read.ok) throw new Error(`fixture is not a valid transfer file: ${read.why}`);
  return read.file;
}

function slot(over: Partial<CharMeta> = {}): CharMeta {
  return {
    id: "slot-1",
    name: "Grond",
    race: "Half-Troll",
    cls: "Warrior",
    sex: "Male",
    level: 17,
    depth: 12,
    maxDepth: 14,
    turn: 41_233,
    alive: true,
    updatedAt: 1,
    ...over,
  };
}

function death(over: Partial<DeathRecord> = {}): DeathRecord {
  return { lineage: "lin-grond", name: "Grond", turn: 50_000, at: 2, ...over };
}

describe("a roster that has never met this character", () => {
  it("gives a stranger a slot of their own", () => {
    expect(decideImport(file(), [], [])).toEqual({ kind: "new" });
  });

  it("gives a DIFFERENT character a slot of their own even at the same name", () => {
    /* Two players can both be called Grond. Identity is the lineage, never the
     * name - a name match must not make one overwrite the other. */
    const other = slot({ id: "slot-9", lineage: "lin-somebody-else" });
    expect(decideImport(file(), [other], [])).toEqual({ kind: "new" });
  });

  it("imports a file from before lineages existed, rather than refusing it", () => {
    /* An old export has no lineage. It cannot be matched against anything, so the
     * only options are "as before" or "never importable again". */
    const old = decodeTransfer(
      JSON.stringify({
        magic: "neo-angband-character",
        version: 1,
        engine: "0.15.0",
        exportedAt: "",
        meta: META,
        save: "AAECAwQ=",
      }),
    );
    if (!old.ok) throw new Error(old.why);
    expect(old.file.lineage).toBeUndefined();
    expect(decideImport(old.file, [slot({ lineage: "lin-grond" })], [death()])).toEqual({
      kind: "new",
    });
  });
});

describe("the same character, from another surface", () => {
  it("takes their own slot back when the file is FURTHER on", () => {
    /* The legitimate move: played on the desktop build, brought back to the
     * browser. Not a second copy of themselves. */
    const here = slot({ id: "slot-1", lineage: "lin-grond", turn: 41_233 });
    expect(decideImport(file({ turn: 60_000 }), [here], [])).toEqual({
      kind: "replace",
      id: "slot-1",
    });
  });

  it("matches a character whose lineage is only their slot id", () => {
    /* Every character born before `lineage` existed: lineageOf falls back to the
     * slot id, and an export carries that id as the lineage. Without this the
     * whole gate would only apply to characters created after it shipped. */
    const here = slot({ id: "born-here", turn: 10 });
    expect(here.lineage).toBeUndefined();
    expect(decideImport(file({ turn: 20, lineage: "born-here" }), [here], [])).toEqual({
      kind: "replace",
      id: "born-here",
    });
  });

  it("refuses a file from the same point", () => {
    const here = slot({ lineage: "lin-grond", turn: 41_233 });
    const d = decideImport(file({ turn: 41_233 }), [here], []);
    expect(d.kind).toBe("refused");
  });

  it("refuses a file from EARLIER - the scum case, in one decision", () => {
    /* Export at turn 41,233, play on to 90,000, re-import the file: that is a
     * restore point, and it is the entire reason this module exists. */
    const here = slot({ lineage: "lin-grond", turn: 90_000 });
    const d = decideImport(file({ turn: 41_233 }), [here], []);
    expect(d.kind).toBe("refused");
    if (d.kind !== "refused") return;
    /* The refusal has to say both numbers, or the player cannot tell this from a
     * corrupt file. */
    expect(d.why.join(" ")).toContain("90,000");
    expect(d.why.join(" ")).toContain("41,233");
  });
});

describe("death is terminal, and outlives the memorial", () => {
  it("refuses a file for a character who died here", () => {
    const d = decideImport(file(), [], [death({ turn: 50_000 })]);
    expect(d.kind).toBe("refused");
    if (d.kind !== "refused") return;
    expect(d.why[0]).toContain("died in this game");
    expect(d.why[0]).toContain("50,000");
  });

  it("STILL refuses after the tombstone has been deleted from the picker", () => {
    /* The hole this ledger closes. Del on a tombstone is a legitimate thing to
     * do - it clears a memorial - and it used to also clear the only record that
     * the character was dead, making Del-then-import a resurrection. The roster
     * here is EMPTY: the tombstone is gone. */
    const d = decideImport(file(), [], [death()]);
    expect(d.kind).toBe("refused");
  });

  it("refuses on a tombstone alone, for a roster written before the ledger", () => {
    /* A character who died before this ledger existed has no death record, only
     * the tombstone. Refused by the other route. */
    const tomb = slot({ lineage: "lin-grond", alive: false, turn: 50_000 });
    const d = decideImport(file(), [tomb], []);
    expect(d.kind).toBe("refused");
    if (d.kind !== "refused") return;
    expect(d.why[0]).toContain("dead in this game");
  });

  it("does not let a newer file beat a death, the way it beats a living copy", () => {
    /* The one ordering that matters in the implementation: death is checked
     * BEFORE the turn comparison, so "further along" is not an escape hatch. A
     * player who died at 50,000 can still hold a file exported at 60,000 from
     * another surface. */
    const d = decideImport(file({ turn: 60_000 }), [], [death({ turn: 50_000 })]);
    expect(d.kind).toBe("refused");
  });
});
