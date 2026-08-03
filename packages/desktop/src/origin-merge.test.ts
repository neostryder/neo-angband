/**
 * The merge rules that decide whether three stranded characters come back.
 *
 * Written against the shape actually measured in the install that reported the
 * bug: five origins, characters in two of them, the newest origin holding only a
 * stale active pointer.
 */

import { describe, expect, it } from "vitest";
import { ROSTER_KEY, handledPorts, planOriginMerge } from "./origin-merge.js";
import type { OriginSnapshot } from "./origin-merge.js";

/** `turn` defaults to 1: a character that has been played at least a moment. */
function meta(id: string, name: string, updatedAt: number, alive = true, turn = 1) {
  return { id, name, race: "Human", cls: "Warrior", sex: "Female", level: 1, depth: 0, maxDepth: 0, turn, alive, updatedAt };
}

function origin(port: number, metas: ReturnType<typeof meta>[], saves: Record<string, string> = {}): OriginSnapshot {
  const entries: Record<string, string> = { [ROSTER_KEY]: JSON.stringify(metas) };
  for (const [id, bytes] of Object.entries(saves)) entries[`neo-angband-save:${id}`] = bytes;
  return { port, entries };
}

describe("stranded-origin merge", () => {
  it("recovers characters from every abandoned origin into an empty target", () => {
    const plan = planOriginMerge({}, [
      origin(54979, []),
      origin(61806, [meta("a", "Frodo", 300), meta("b", "Sam", 200)], { a: "AAA", b: "BBB" }),
      origin(61038, [meta("c", "Merry", 100)], { c: "CCC" }),
    ]);

    expect(plan.recovered.map((r) => r.name).sort()).toEqual(["Frodo", "Merry", "Sam"]);
    expect(plan.writes["neo-angband-save:a"]).toBe("AAA");
    expect(plan.writes["neo-angband-save:c"]).toBe("CCC");
    expect(JSON.parse(plan.writes[ROSTER_KEY]!)).toHaveLength(3);
  });

  it("does nothing when there is nothing to bring back", () => {
    expect(planOriginMerge({}, [origin(54979, [])])).toEqual({
      writes: {},
      removes: [],
      deaths: [],
      recovered: [],
      skippedUnplayed: [],
    });
  });

  it("never overwrites a character the target already has", () => {
    const target = {
      [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 900)]),
      "neo-angband-save:a": "NEW",
    };
    const plan = planOriginMerge(target, [origin(61806, [meta("a", "Frodo", 300)], { a: "OLD" })]);

    expect(plan.writes["neo-angband-save:a"]).toBeUndefined();
    expect(plan.recovered).toEqual([]);
  });

  it("takes the newer copy when one character exists in two origins", () => {
    const plan = planOriginMerge({}, [
      origin(61806, [meta("a", "Frodo", 500)], { a: "NEWER" }),
      origin(61038, [meta("a", "Frodo", 100)], { a: "OLDER" }),
    ]);
    expect(plan.writes["neo-angband-save:a"]).toBe("NEWER");
    expect(plan.recovered).toHaveLength(1);
  });

  it("refuses a living character whose save bytes are gone", () => {
    /* Metadata alone would put a row on the character-select screen that cannot
     * be resumed - worse than not offering it. */
    const plan = planOriginMerge({}, [origin(61806, [meta("a", "Frodo", 300)])]);
    expect(plan).toEqual({ writes: {}, removes: [], deaths: [], recovered: [], skippedUnplayed: [] });
  });

  it("does bring back a tombstone, which legitimately has no bytes", () => {
    const plan = planOriginMerge({}, [origin(61806, [meta("a", "Frodo", 300, false)])]);
    expect(plan.recovered).toEqual([
      { id: "a", name: "Frodo", fromPort: 61806, hasSave: false },
    ]);
    expect(plan.skippedUnplayed).toEqual([]);
    expect(JSON.parse(plan.writes[ROSTER_KEY]!)[0].alive).toBe(false);
  });

  it("fills in other owned settings only where the target has none", () => {
    const target = { "neo:enabledMods": "[]" };
    const src: OriginSnapshot = {
      port: 61806,
      entries: {
        [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 300)]),
        "neo-angband-save:a": "AAA",
        "neo:enabledMods": '["qol"]',
        "neo-angband-birth": '{"name":"Frodo"}',
        __agwt_rt: "not ours",
      },
    };
    const plan = planOriginMerge(target, [src]);

    expect(plan.writes["neo:enabledMods"]).toBeUndefined();
    expect(plan.writes["neo-angband-birth"]).toBe('{"name":"Frodo"}');
    expect(plan.writes).not.toHaveProperty("__agwt_rt");
  });

  it("drops an active pointer that names no character", () => {
    const src: OriginSnapshot = {
      port: 54979,
      entries: { "neo-angband-active": "4863bdc7-fe21-419e-bf36-2222472e9401" },
    };
    /* Exactly the newest origin in the real install: an active id and no roster. */
    const plan = planOriginMerge({}, [src, origin(61806, [meta("a", "Frodo", 1)], { a: "AAA" })]);
    expect(plan.writes["neo-angband-active"]).toBeUndefined();
    expect(plan.recovered).toHaveLength(1);
  });

  it("keeps an active pointer that does name one", () => {
    const src: OriginSnapshot = {
      port: 61806,
      entries: {
        "neo-angband-active": "a",
        [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 300)]),
        "neo-angband-save:a": "AAA",
      },
    };
    expect(planOriginMerge({}, [src]).writes["neo-angband-active"]).toBe("a");
  });

  it("survives unparseable rosters on either side", () => {
    const plan = planOriginMerge({ [ROSTER_KEY]: "{not json" }, [
      { port: 1, entries: { [ROSTER_KEY]: "also not json" } },
      origin(61806, [meta("a", "Frodo", 300)], { a: "AAA" }),
    ]);
    expect(plan.recovered).toHaveLength(1);
    expect(JSON.parse(plan.writes[ROSTER_KEY]!)).toHaveLength(1);
  });

  it("leaves a birth abandoned at turn 0 where it is, and says so", () => {
    /* neostryder's ruling, 2026-07-28: only characters with progress come back. The
     * two level-1 turn-0 births in the real install were rows he had pressed
     * Enter through, not characters he lost. Nothing is deleted - they stay in
     * the origin they were written to. */
    const plan = planOriginMerge({}, [
      origin(61806, [meta("a", "Litholor", 300, true, 0)], { a: "AAA" }),
      origin(61038, [meta("b", "Negor", 200, true, 4144)], { b: "BBB" }),
    ]);

    expect(plan.recovered.map((r) => r.name)).toEqual(["Negor"]);
    expect(plan.skippedUnplayed.map((r) => r.name)).toEqual(["Litholor"]);
    expect(plan.writes["neo-angband-save:a"]).toBeUndefined();
    expect(plan.writes["neo-angband-save:b"]).toBe("BBB");
    expect(JSON.parse(plan.writes[ROSTER_KEY]!)).toHaveLength(1);
  });

  it("treats a missing turn as unplayed rather than guessing", () => {
    const src: OriginSnapshot = {
      port: 61806,
      entries: {
        [ROSTER_KEY]: JSON.stringify([{ id: "a", name: "Frodo", updatedAt: 1, alive: true }]),
        "neo-angband-save:a": "AAA",
      },
    };
    const plan = planOriginMerge({}, [src]);
    expect(plan.recovered).toEqual([]);
    expect(plan.skippedUnplayed.map((r) => r.name)).toEqual(["Frodo"]);
  });
});

/**
 * THE SAVE-SCUM VECTOR THE PORT LADDER OPENED, AND ITS CLOSURE.
 *
 * The merge is a copy, so it leaves a pre-death snapshot in every origin it reads.
 * Before the port ladder that was harmless: the sources were dead ephemeral
 * origins nothing would ever bind again. Now a copy that steps to a free port
 * leaves a LIVING copy of every character behind on a port that is perfectly
 * bindable, and death on the new port does not touch it.
 *
 * So a tombstone anywhere buries that id everywhere, in both directions, whatever
 * the timestamps say. See buriedIds.
 */
describe("death is absorbing across origins (decision 16)", () => {
  it("does not import a living copy of a character the target has buried", () => {
    const target = {
      [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 900, false)]),
    };
    /* The source's copy is ALIVE, has bytes, and is not older - it is what the
     * player would resume. */
    const plan = planOriginMerge(target, [origin(45871, [meta("a", "Frodo", 950)], { a: "ALIVE" })]);

    expect(plan.writes["neo-angband-save:a"]).toBeUndefined();
    /* Nothing at all to do: the target's row is already the memorial and holds no
     * bytes, so the plan is empty rather than a rewrite of what is already right. */
    expect(plan.writes).toEqual({});
    expect(plan.removes).toEqual([]);
    expect(plan.recovered).toEqual([]);
  });

  it("buries the target's OWN living copy when a source holds the tombstone", () => {
    /* The other direction, and the one that needs a deletion: the player has gone
     * back to the origin the character was copied FROM, where it is still alive at
     * the turn it was copied at. */
    const target = {
      [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 100)]),
      "neo-angband-save:a": "THE-SNAPSHOT",
      "neo-angband-active": "a",
    };
    const plan = planOriginMerge(target, [origin(45872, [meta("a", "Frodo", 9000, false)])]);

    expect(plan.removes).toContain("neo-angband-save:a");
    /* And the pointer that would have resumed it, so the next boot does not try. */
    expect(plan.removes).toContain("neo-angband-active");
    expect(JSON.parse(plan.writes[ROSTER_KEY] ?? "[]")).toEqual([
      expect.objectContaining({ id: "a", alive: false }),
    ]);
  });

  it("keeps the memorial, and the name the player is looking for", () => {
    /* A tombstone is earned. Burying must not delete the roster row, or the
     * character silently vanishes from the memorial and the player is told
     * nothing at all. */
    const target = { [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 100)]) };
    const plan = planOriginMerge(target, [origin(45872, [meta("a", "Frodo", 9000, false)])]);
    const roster = JSON.parse(plan.writes[ROSTER_KEY] ?? "[]") as { name: string }[];
    expect(roster).toHaveLength(1);
    expect(roster[0]?.name).toBe("Frodo");
  });

  it("leaves a living character with no tombstone anywhere completely alone", () => {
    /* The guard on the three above: the rule must not be "delete on sight". */
    const target = {
      [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 100)]),
      "neo-angband-save:a": "STILL-MINE",
      "neo-angband-active": "a",
    };
    const plan = planOriginMerge(target, [origin(45872, [meta("b", "Sam", 200)], { b: "BBB" })]);

    expect(plan.removes).toEqual([]);
    expect(plan.writes["neo-angband-save:a"]).toBeUndefined(); // untouched, not rewritten
    expect(plan.recovered.map((r) => r.name)).toEqual(["Sam"]);
  });

  it("ignores timestamps, because a snapshot played after the death is newer", () => {
    /* The case a newest-wins rule gets wrong: the player resumed the snapshot and
     * played it, so its updatedAt is now the largest number in the profile. */
    const target = {
      [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 99999)]),
      "neo-angband-save:a": "PLAYED-ON-AFTER-DYING",
    };
    const plan = planOriginMerge(target, [origin(45872, [meta("a", "Frodo", 1, false)])]);
    expect(plan.removes).toContain("neo-angband-save:a");
  });

  it("treats only a real boolean false as death", () => {
    /* alive is written by the game as a boolean. A row where it is missing, or is
     * some other value entirely, is NOT a tombstone - guessing there would delete
     * a living character on the strength of a corrupted byte. */
    const alive = { id: "a", name: "Frodo", turn: 5, updatedAt: 100 };
    for (const odd of [undefined, "false", 0, null]) {
      const src = { ...alive, ...(odd === undefined ? {} : { alive: odd }) };
      const plan = planOriginMerge(
        { [ROSTER_KEY]: JSON.stringify([alive]), "neo-angband-save:a": "MINE" },
        [{ port: 45872, entries: { [ROSTER_KEY]: JSON.stringify([src]) } }],
      );
      expect(plan.removes, `alive: ${JSON.stringify(odd)}`).toEqual([]);
    }
  });
});

/**
 * THE LEDGER, and the hole it fills.
 *
 * An adversarial review of the burial rule found that it could not survive its own
 * bookkeeping: `origins-merged.txt` makes an origin unreadable forever, so the one
 * roster holding a character's tombstone can be sealed inside a handled origin while
 * a living copy of that character sits in another. The check that would notice has
 * been switched off, permanently, by design.
 *
 * The fix is a list of dead ids in the data folder, outside every origin. It is
 * passed in, so these rules stay pure and the file handling stays in main.ts.
 */
describe("the death ledger outlives the handled-origin marker", () => {
  it("buries a living target row from the ledger alone, with no sources at all", () => {
    const target = {
      [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 100)]),
      "neo-angband-save:a": "THE-SNAPSHOT",
    };
    const plan = planOriginMerge(target, [], ["a"]);
    expect(plan.removes).toContain("neo-angband-save:a");
    expect(JSON.parse(plan.writes[ROSTER_KEY] ?? "[]")).toEqual([
      expect.objectContaining({ id: "a", alive: false }),
    ]);
  });

  it("reports every dead id it saw, so the ledger can grow", () => {
    const plan = planOriginMerge({}, [origin(61806, [meta("a", "Frodo", 300, false)])], ["z"]);
    expect([...plan.deaths].sort()).toEqual(["a", "z"]);
  });

  it("reports the ids even when there is nothing else to do", () => {
    /* The empty-plan exit used to drop them, and dropping them is how the record
     * of a death gets lost the launch before the marker seals its origin. */
    const plan = planOriginMerge({}, [], ["a"]);
    expect(plan.deaths).toEqual(["a"]);
  });
});

/**
 * THE GUARD ON THE DELETION.
 *
 * parseRoster accepts any object with a string id, deliberately, so an id is not
 * proof of identity. The same review pointed out that burying on an id alone lets a
 * corrupted or hand-edited row - or a genuine id collision - delete a character the
 * player still has. Doubt goes to the player.
 */
describe("burying the wrong character", () => {
  it("refuses to bury when the two rows carry different names", () => {
    const target = {
      [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 100)]),
      "neo-angband-save:a": "STILL-MINE",
    };
    const plan = planOriginMerge(target, [origin(45872, [meta("a", "Boromir", 9000, false)])]);
    expect(plan.removes).toEqual([]);
    /* And the living row is left living. */
    const roster = JSON.parse(plan.writes[ROSTER_KEY] ?? "[]") as { alive?: boolean }[];
    if (roster.length > 0) expect(roster[0]?.alive).not.toBe(false);
  });

  it("still buries when the names agree apart from case", () => {
    const target = {
      [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 100)]),
      "neo-angband-save:a": "THE-SNAPSHOT",
    };
    const plan = planOriginMerge(target, [origin(45872, [meta("a", "FRODO", 9000, false)])]);
    expect(plan.removes).toContain("neo-angband-save:a");
  });

  it("buries on a bare ledger id, which carries no name to compare", () => {
    /* The ledger records ids only. There is nothing to disagree with, so the id
     * has to be enough - and it is written by this game about this install's own
     * deaths, which is a much stronger provenance than a parsed roster row. */
    const target = {
      [ROSTER_KEY]: JSON.stringify([meta("a", "Frodo", 100)]),
      "neo-angband-save:a": "THE-SNAPSHOT",
    };
    expect(planOriginMerge(target, [], ["a"]).removes).toContain("neo-angband-save:a");
  });
});

describe("handledPorts (the marker that is a permanent claim)", () => {
  const snap = (port: number): OriginSnapshot => ({ port, entries: {} });
  const clean = { failedKeys: [], missingKeys: [] };

  it("marks the origins that were read, on top of the ones already done", () => {
    expect([...(handledPorts([61038], [snap(61806), snap(54979)], clean) ?? [])].sort()).toEqual(
      [54979, 61038, 61806],
    );
  });

  it("does NOT mark a port that could not be read", () => {
    /* The defect this function exists to make impossible. main.ts marked every port
     * it MEANT to visit, so an origin that would not bind was recorded as empty and
     * never looked at again - and with the port ladder the reason a port will not
     * bind is usually that another copy of the game is on it, holding a roster.
     *
     * Expressed as "two ports were due, one was read, only that one is marked",
     * because the wrong version passes any test that only ever supplies readable
     * ports. */
    const due = [45871, 45872];
    const readOnly = [snap(45872)];
    const marked = handledPorts([], readOnly, clean) ?? [];
    expect(marked).toEqual([45872]);
    expect(marked).not.toContain(45871);
    expect(due.filter((p) => !marked.includes(p))).toEqual([45871]);
  });

  it("marks nothing at all when a write was refused", () => {
    /* The bytes are still only in the source origin, and they are a character. */
    expect(handledPorts([], [snap(61806)], { failedKeys: ["neo-angband-save:a"], missingKeys: [] })).toBeNull();
  });

  it("marks nothing at all when a write did not survive the read-back", () => {
    expect(handledPorts([], [snap(61806)], { failedKeys: [], missingKeys: [ROSTER_KEY] })).toBeNull();
  });

  it("keeps the already-done set even when nothing new was read", () => {
    /* An empty source list is the ordinary steady state, and it must not erase the
     * record of the work already finished. */
    expect([...(handledPorts([61038, 61806], [], clean) ?? [])].sort()).toEqual([61038, 61806]);
  });

  it("never repeats a port", () => {
    expect(handledPorts([61806], [snap(61806)], clean)).toEqual([61806]);
  });
});
