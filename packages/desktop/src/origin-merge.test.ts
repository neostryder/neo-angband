/**
 * The merge rules that decide whether three stranded characters come back.
 *
 * Written against the shape actually measured in the install that reported the
 * bug: five origins, characters in two of them, the newest origin holding only a
 * stale active pointer.
 */

import { describe, expect, it } from "vitest";
import { ROSTER_KEY, planOriginMerge } from "./origin-merge";
import type { OriginSnapshot } from "./origin-merge";

function meta(id: string, name: string, updatedAt: number, alive = true) {
  return { id, name, race: "Human", cls: "Warrior", sex: "Female", level: 1, depth: 0, maxDepth: 0, turn: 1, alive, updatedAt };
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
    expect(planOriginMerge({}, [origin(54979, [])])).toEqual({ writes: {}, recovered: [] });
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
    expect(plan).toEqual({ writes: {}, recovered: [] });
  });

  it("does bring back a tombstone, which legitimately has no bytes", () => {
    const plan = planOriginMerge({}, [origin(61806, [meta("a", "Frodo", 300, false)])]);
    expect(plan.recovered).toEqual([
      { id: "a", name: "Frodo", fromPort: 61806, hasSave: false },
    ]);
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
});
