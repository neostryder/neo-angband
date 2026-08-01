/**
 * A mod's own saved data, brought forward when the mod's schema has moved.
 *
 * WHAT THIS PATH WAS. Core shipped `migrateModBag` with tests and no production
 * caller; `saveSchema` was validated in the SDK, parsed by pack.ts and carried
 * into the pack record, and read by nothing; and the plugin ABI had no member a
 * mod could put its migrator in. Three pieces of a seam, none of them connected,
 * which from a mod author's side is the same as a seam that was never designed -
 * bump your schema and the game hands you the old data at the new number.
 *
 * The interesting cases are all the ones where NOTHING should be rewritten, so
 * they are the ones tested hardest: no migrator, a throwing migrator, a migrator
 * that returns nothing, and a bag from a NEWER version of the mod than the one
 * installed. In every one of those the old bytes have to survive untouched,
 * because they are the only copy and the mod may still be able to make sense of
 * them.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ModBag } from "@rpgm-tools/neo-angband-core";
import { migrateModBags, type BagOwner } from "./mod-bags";
import { validateModPlugin } from "./mod-plugin";
import { problemsFor } from "./mod-problems";

const bag = (schema: number, data: unknown): ModBag =>
  ({ schema, data }) as ModBag;

function owner(over: Partial<BagOwner> = {}): BagOwner {
  return { id: "m", saveSchema: 2, migrate: undefined, ...over };
}

describe("a bag behind its mod's schema", () => {
  it("is rewritten by the mod's own migrator and stamped forward", () => {
    const r = migrateModBags(
      { m: bag(1, { kills: 3 }) },
      [owner({ migrate: (data, from) => ({ from, kills: (data as { kills: number }).kills }) })],
    );
    expect(r.bags["m"]).toEqual({ schema: 2, data: { from: 1, kills: 3 } });
    expect(r.migrated).toEqual(["m"]);
    expect(r.problems).toEqual([]);
  });

  it("tells the migrator which schema it is coming FROM", () => {
    /* A mod that has bumped twice needs to know whether it is looking at v1 or v2
     * data; without it the migrator can only guess from the shape. */
    const seen: number[] = [];
    migrateModBags({ m: bag(1, {}) }, [
      owner({ saveSchema: 3, migrate: (_d, from) => (seen.push(from), {}) }),
    ]);
    expect(seen).toEqual([1]);
  });

  it("is left EXACTLY as it was when the mod ships no migrator, and says so", () => {
    const before = bag(1, { kills: 3 });
    const r = migrateModBags({ m: before }, [owner()]);
    expect(r.bags["m"]).toBe(before);
    expect(r.migrated).toEqual([]);
    const why = problemsFor(r.problems, "m").join(" ");
    expect(why).toContain("schema 1");
    expect(why).toContain("2");
    expect(why).toContain("migrateBag");
  });

  it("does not stamp the schema forward over unmigrated data", () => {
    /* The tempting shortcut, and the one that turns a missing migrator into a
     * silent lie: the mod would then read old-shaped data believing it is new,
     * with no way left to tell. */
    const r = migrateModBags({ m: bag(1, { old: true }) }, [owner()]);
    expect(r.bags["m"]?.schema).toBe(1);
  });
});

describe("a migrator that goes wrong", () => {
  it("keeps the old bag when it throws, and reports the reason", () => {
    const before = bag(1, { kills: 3 });
    const r = migrateModBags({ m: before }, [
      owner({
        migrate: () => {
          throw new Error("cannot read properties of undefined");
        },
      }),
    ]);
    /* A half-applied migration written back over the only copy is the one outcome
     * worse than not migrating. */
    expect(r.bags["m"]).toBe(before);
    expect(r.migrated).toEqual([]);
    expect(problemsFor(r.problems, "m").join(" ")).toContain(
      "cannot read properties of undefined",
    );
  });

  it("keeps the old bag when it returns nothing", () => {
    const before = bag(1, { kills: 3 });
    const r = migrateModBags({ m: before }, [
      owner({ migrate: () => undefined as unknown as Record<string, never> }),
    ]);
    expect(r.bags["m"]).toBe(before);
    expect(problemsFor(r.problems, "m").join(" ")).toContain("returned nothing");
  });

  it("costs that mod and not the ones beside it", () => {
    const r = migrateModBags(
      { bad: bag(1, {}), good: bag(1, { n: 1 }) },
      [
        {
          id: "bad",
          saveSchema: 2,
          migrate: () => {
            throw new Error("boom");
          },
        },
        { id: "good", saveSchema: 2, migrate: () => ({ n: 2 }) },
      ],
    );
    expect(r.bags["good"]).toEqual({ schema: 2, data: { n: 2 } });
    expect(r.migrated).toEqual(["good"]);
    expect(problemsFor(r.problems, "good")).toEqual([]);
  });
});

describe("a bag that is not behind", () => {
  it("is untouched when it is already at the mod's schema", () => {
    const before = bag(2, { n: 1 });
    const migrate = vi.fn(() => ({ n: 99 }));
    const r = migrateModBags({ m: before }, [owner({ migrate })]);
    expect(migrate).not.toHaveBeenCalled();
    expect(r.bags["m"]).toBe(before);
    expect(r.problems).toEqual([]);
  });

  it("is kept, and REPORTED, when it came from a newer version of the mod", () => {
    /* A downgrade: the player rolled the mod back, or restored a save written
     * with a later version. The mod is about to read data in a shape it predates,
     * and only its author could write a migration backwards - so nothing is
     * changed and the player is told. */
    const before = bag(5, { n: 1 });
    const migrate = vi.fn(() => ({ n: 0 }));
    const r = migrateModBags({ m: before }, [owner({ saveSchema: 2, migrate })]);
    expect(migrate).not.toHaveBeenCalled();
    expect(r.bags["m"]).toBe(before);
    const why = problemsFor(r.problems, "m").join(" ");
    expect(why).toContain("newer version");
    expect(why).toContain("5");
  });

  it("is untouched when the mod declares no schema at all", () => {
    /* Nothing to be behind. Most mods never declare one, and a mod without a
     * schema must not be nagged about data it is perfectly happy with. */
    const before = bag(0, { n: 1 });
    const r = migrateModBags({ m: before }, [owner({ saveSchema: undefined })]);
    expect(r.bags["m"]).toBe(before);
    expect(r.problems).toEqual([]);
  });
});

describe("mods with no bag at all", () => {
  it("are skipped, not given an empty one", () => {
    /* A mod that has never saved anything has no data to migrate, and inventing
     * a bag for it would put an entry in every save for every installed mod. */
    const r = migrateModBags({}, [owner({ migrate: () => ({}) })]);
    expect(r.bags).toEqual({});
    expect(r.problems).toEqual([]);
  });

  it("leaves a bag whose mod is not loaded exactly where it is", () => {
    /* A disabled or uninstalled mod's bag is round-tripped verbatim so that
     * re-enabling it gets its data back. Nothing here may touch it. */
    const before = bag(1, { n: 1 });
    const r = migrateModBags({ absent: before }, [owner()]);
    expect(r.bags["absent"]).toBe(before);
    expect(r.problems).toEqual([]);
  });

  it("returns the SAME object when nothing was migrated", () => {
    const bags = { m: bag(2, {}) };
    expect(migrateModBags(bags, [owner()])).toHaveProperty("bags", bags);
  });
});

describe("the ABI accepts the migrator", () => {
  it("takes a plugin that declares migrateBag beside its hooks", () => {
    expect(
      validateModPlugin({ api: 1, hooks: () => undefined, migrateBag: () => ({}) }),
    ).toBeNull();
  });

  it("refuses a migrateBag that is not a function", () => {
    expect(
      validateModPlugin({ api: 1, hooks: () => undefined, migrateBag: 3 }),
    ).toContain("migrateBag");
  });

  it("still refuses a plugin whose ONLY member is migrateBag", () => {
    /* A plugin that changes no behaviour and registers nothing does nothing on a
     * fresh save, whatever it can do to an old one. Widening the "would do
     * nothing" check to count migrateBag would be the same mistake wearing a
     * newer field name. */
    expect(validateModPlugin({ api: 1, migrateBag: () => ({}) })).toContain(
      "no hooks, register or controller",
    );
  });
});

/* --- the wiring, which is the whole point ----------------------------------
 *
 * migrateModBag had tests and no caller for as long as it existed, so a test of
 * this module alone would reproduce exactly that: a correct function nothing
 * runs. main.ts boots a game on import and cannot be imported here, so the call
 * is asserted on its source with comments stripped - a citation must not be able
 * to satisfy a claim about code.
 */

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const NO_COMMENTS = MAIN.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");

describe("the boot path actually runs the migration", () => {
  it("calls migrateModBags", () => {
    expect(NO_COMMENTS).toMatch(/migrateModBags\(/u);
  });

  it("writes the result back onto game.mods, which is what saveGame reads", () => {
    /* GameState does not carry the bags at all - they live on the StartedGame -
     * so migrating a copy and assigning it to `state` would be a no-op that looks
     * exactly like this one working. */
    expect(NO_COMMENTS).toMatch(/game\.mods\s*=/u);
  });

  it("runs BEFORE any plugin's register()", () => {
    /* Order is the claim: register() is the first place a mod's own code can read
     * its bag, so a migration after it would hand the mod data it has already
     * acted on. */
    const migrate = NO_COMMENTS.indexOf("migrateModBags(");
    const register = NO_COMMENTS.search(/register\.call\(/u);
    expect(migrate).toBeGreaterThan(-1);
    expect(register).toBeGreaterThan(migrate);
  });

  it("puts each problem on that mod's row rather than only in the console", () => {
    const at = NO_COMMENTS.indexOf("migrateModBags(");
    expect(NO_COMMENTS.slice(at, at + 400)).toMatch(/reportModFault\(/u);
  });
});
