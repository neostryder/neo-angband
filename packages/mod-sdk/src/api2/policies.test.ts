/**
 * Policy tables: what checkApi2Policies refuses, and what api2PoliciesToHooks
 * makes of a valid table.
 */
import { describe, expect, it } from "vitest";
import { API2_HOOK_NAMES } from "./hooks.js";
import {
  API2_POLICY_KINDS,
  API2_POLICY_LIMITS,
  API2_POLICY_NAMES,
  api2PoliciesToHooks,
  api2PolicyEffects,
  checkApi2Policies,
  type Api2Policies,
  type Api2TileFill,
} from "./policies.js";

describe("checkApi2Policies", () => {
  it("accepts every table in its own grammar", () => {
    const policies: Api2Policies = {
      walkBlockedByDiggable: { kind: "walk-blocked-by-diggable", attempt: "tunnel", energy: "move", step: false },
      messageText: [{ find: "You feel", replace: "You sense", match: "prefix" }],
      screenText: [{ find: "a", replace: "b", where: { screen: "char", column: 2 } }],
      historyAdd: [{ find: "Found", drop: true, match: "prefix", where: { duplicate: true } }],
      objectListOrder: ["-dy", "dx"],
      saveNoiseScent: true,
      shapeLearnObviousFlagsDirectly: false,
    };
    expect(checkApi2Policies(policies)).toBeNull();
  });

  it("refuses unknown tables and fields, so a misspelling is reported", () => {
    expect(checkApi2Policies({ mesageText: [] })).toMatch(/no policy table "mesageText"/u);
    expect(checkApi2Policies({ messageText: [{ find: "a", replace: "b", regex: true }] })).toMatch(/unknown field "regex"/u);
    expect(checkApi2Policies({ messageText: [{ find: "a", replace: "b", where: { screen: "x" } }] })).toMatch(/no call site/u);
    expect(checkApi2Policies({ screenText: [{ find: "a", replace: "b", where: { tval: "x" } }] })).toMatch(/may name screen, part, column/u);
  });

  it("refuses what could stall or bloat a turn", () => {
    expect(checkApi2Policies({ messageText: [{ find: "", replace: "b" }] })).toMatch(/find is text of 1/u);
    expect(checkApi2Policies({ messageText: [{ find: "a", replace: "b", match: "regex" }] })).toMatch(/match is/u);
    const many = Array.from({ length: API2_POLICY_LIMITS.rules + 1 }, () => ({ find: "a", replace: "b" }));
    expect(checkApi2Policies({ messageText: many })).toMatch(/at most 256 rules/u);
    expect(checkApi2Policies({ objectListOrder: ["dy", "-dy"] })).toMatch(/names dy twice/u);
    expect(checkApi2Policies({ historyAdd: [{ find: "a", replace: "b", drop: true }] })).toMatch(/not both/u);
    expect(checkApi2Policies({ saveNoiseScent: "yes" })).toMatch(/true or false/u);
    expect(checkApi2Policies([])).toMatch(/object of tables/u);
  });

  it("refuses unknown walk kinds, fields and unsupported choices", () => {
    const walk = { kind: "walk-blocked-by-diggable", attempt: "tunnel", energy: "move", step: false };
    for (const [field, value] of [["kind", "dig"], ["attempt", "open"], ["energy", 0], ["step", true], ["step", undefined]]) {
      expect(checkApi2Policies({ walkBlockedByDiggable: { ...walk, [field as string]: value } })).toContain(`walkBlockedByDiggable.${String(field)}`);
    }
    expect(checkApi2Policies({ walkBlockedByDiggable: { ...walk, chance: 100 } })).toContain('unknown field "chance"');
    expect(checkApi2Policies({ walkBlockedByDiggable: null })).toContain("is an object");
  });

  it("copies a walk declaration and installs it only under its registry grant", () => {
    const policies: Api2Policies = { walkBlockedByDiggable: { kind: "walk-blocked-by-diggable", attempt: "tunnel", energy: "move", step: false } };
    expect(api2PolicyEffects(policies, () => false).registrations).toEqual({});
    const effects = api2PolicyEffects(policies, (capability) => capability === "registry:command");
    expect(effects.hooks).toEqual({});
    expect(effects.registrations.walkBlockedByDiggable).toEqual(policies.walkBlockedByDiggable);
    expect(effects.registrations.walkBlockedByDiggable).not.toBe(policies.walkBlockedByDiggable);
  });
});

describe("api2PoliciesToHooks", () => {
  it("abandons text and history tables when their cumulative work exceeds the turn bound", () => {
    const text = "a".repeat(4096);
    const rules = [{ find: "a", replace: "b", match: "substring" as const },
      ...Array.from({ length: 254 }, () => ({ find: "b", replace: "b", match: "substring" as const }))];
    const hooks = api2PoliciesToHooks({ messageText: rules, historyAdd: [...rules, { find: "b", drop: true, match: "substring" }] });
    expect(hooks.messageText?.(text)).toBe(text);
    expect(hooks.historyAdd?.({ what: text, type: 1, duplicate: false })).toEqual({ keep: true });
    const expanding = Array.from({ length: 256 }, () => ({ find: "x", replace: "xx", match: "substring" as const }));
    expect(api2PoliciesToHooks({ messageText: expanding }).messageText?.("x")).toBe("x");
  });

  it("abandons text and history rewrites before expansion exceeds the output bound", () => {
    const rules = Array.from({ length: 16 }, () => ({ find: "x", replace: "xx", match: "substring" as const }));
    const hooks = api2PoliciesToHooks({ messageText: rules, historyAdd: rules });
    expect(checkApi2Policies({ messageText: rules, historyAdd: rules })).toBeNull();
    expect(hooks.messageText?.("x")?.length).toBe(1);
    expect(hooks.historyAdd?.({ what: "x", type: 1, duplicate: false })).toEqual({ keep: true });
  });

  it("leaves oversized input and oversized substring replacements unchanged", () => {
    const hooks = api2PoliciesToHooks({ messageText: [{ find: "x", replace: "y".repeat(4096), match: "substring" }] });
    const rewritten = hooks.messageText?.("x".repeat(1024));
    expect(rewritten?.length).toBe(1024);
    expect(rewritten?.startsWith("x")).toBe(true);
    const prefix = api2PoliciesToHooks({ messageText: [{ find: "x", replace: "y", match: "prefix" }] });
    expect(prefix.messageText?.("x".repeat(32768))).toBe("x".repeat(32768));
  });

  it("gives a hook only for a table with something in it", () => {
    expect(Object.keys(api2PoliciesToHooks({ messageText: [], saveNoiseScent: false }))).toEqual([]);
    expect(Object.keys(api2PoliciesToHooks({ messageText: [{ find: "a", replace: "b" }], saveNoiseScent: true })).sort())
      .toEqual(["messageText", "saveNoiseScent"]);
  });

  it("applies text rules in order, each to the last one's output, matching literally", () => {
    const hooks = api2PoliciesToHooks({
      messageText: [
        { find: "You feel", replace: "You sense", match: "prefix" },
        { find: "e", replace: "E", match: "substring" },
        { find: "nothing", replace: "never" },
        { find: ".*", replace: "x", match: "substring" },
      ],
    });
    expect(hooks.messageText?.("You feel better.")).toBe("You sEnsE bEttEr.");
    expect(hooks.messageText?.("nothing")).toBe("never");
    expect(hooks.messageText?.("a.*b")).toBe("axb");
  });

  it("limits a rule to the call sites its where names", () => {
    const hooks = api2PoliciesToHooks({ screenText: [{ find: "Str", replace: "STR", where: { screen: "char" } }] });
    expect(hooks.screenText?.("Str", { screen: "char" } as never)).toBe("STR");
    expect(hooks.screenText?.("Str", { screen: "other" } as never)).toBe("Str");
  });

  it("drops or rewrites history entries", () => {
    const hooks = api2PoliciesToHooks({
      historyAdd: [
        { find: "Reached level", drop: true, match: "prefix" },
        { find: "Found", replace: "Discovered", match: "prefix", where: { duplicate: false } },
      ],
    });
    expect(hooks.historyAdd?.({ what: "Reached level 5", type: 1, duplicate: false })).toEqual({ keep: false });
    expect(hooks.historyAdd?.({ what: "Found a ring", type: 1, duplicate: false })).toEqual({ keep: true, what: "Discovered a ring" });
    expect(hooks.historyAdd?.({ what: "Found a ring", type: 1, duplicate: true })).toEqual({ keep: true });
  });

  it("orders floor-list ties by the first key that differs, a minus sign descending", () => {
    const hooks = api2PoliciesToHooks({ objectListOrder: ["-dy", "dx"] });
    expect(hooks.objectListTiebreak?.({ dy: 1, dx: 0 }, { dy: 2, dx: 0 })).toBeGreaterThan(0);
    expect(hooks.objectListTiebreak?.({ dy: 1, dx: 3 }, { dy: 1, dx: 1 })).toBeGreaterThan(0);
    expect(hooks.objectListTiebreak?.({ dy: 1, dx: 1 }, { dy: 1, dx: 1 })).toBe(0);
  });

  it("copies the tables, so a later change to the object passed in changes nothing", () => {
    const rules = [{ find: "a", replace: "b" }];
    const hooks = api2PoliciesToHooks({ messageText: rules });
    rules[0] = { find: "a", replace: "c" };
    expect(hooks.messageText?.("a")).toBe("b");
  });
});

describe("API2_POLICY_KINDS", () => {
  it("maps every table to its matching registry permission", () => {
    expect(Object.fromEntries(API2_POLICY_KINDS.map((kind) => [kind.name, kind.capability]))).toEqual({
      walkBlockedByDiggable: "registry:command",
      messageText: "registry:message", screenText: "registry:ui-entry", characterBackground: "registry:message",
      objectInfoText: "registry:effect-info", effectIntro: "registry:effect-info", historyAdd: "registry:message",
      historyDisplay: "registry:message", objectListOrder: "registry:tval", saveNoiseScent: "registry:monster",
      shapeLearnObviousFlagsDirectly: "registry:rune", storeDiscountRoll: "registry:store", tileMap: "registry:tiles",
    });
  });

  it("is the one list the names, the check and the interpreter walk", () => {
    expect(API2_POLICY_NAMES).toEqual(API2_POLICY_KINDS.map((kind) => kind.name));
    expect(new Set(API2_POLICY_NAMES).size).toBe(API2_POLICY_NAMES.length);
    for (const kind of API2_POLICY_KINDS) {
      expect(kind.summary.length).toBeGreaterThan(0);
      if ("hook" in kind.target) expect(API2_HOOK_NAMES).toContain(kind.target.hook);
      else expect(["discountRoll", "tileFiller", "walkBlockedByDiggable"]).toContain(kind.target.registration);
    }
  });

  it("names the kinds the first requests asked for: a message rewrite, a store discount roll and a tile mapping", () => {
    expect(API2_POLICY_NAMES).toEqual(expect.arrayContaining(["messageText", "storeDiscountRoll", "tileMap"]));
  });
});

describe("the store discount roll", () => {
  /* A roll that succeeds on the listed one-in-N values, recording every draw. */
  const roll = (cost: number, wins: readonly number[]) => {
    const drawn: number[] = [];
    return { drawn, roll: { cost, oneIn: (n: number) => (drawn.push(n), wins.includes(n)) } };
  };
  const classic: Api2Policies = {
    storeDiscountRoll: {
      minCost: 5,
      tiers: [{ oneIn: 25, percent: 25 }, { oneIn: 150, percent: 50 }, { oneIn: 300, percent: 75 }, { oneIn: 500, percent: 90 }],
    },
  };

  it("gives the first tier whose roll succeeds, drawing no further", () => {
    const discount = api2PolicyEffects(classic).registrations.discountRoll;
    const a = roll(100, [150, 500]);
    expect(discount?.(a.roll)).toBe(50);
    expect(a.drawn).toEqual([25, 150]);
    const b = roll(100, []);
    expect(discount?.(b.roll)).toBe(0);
    expect(b.drawn).toEqual([25, 150, 300, 500]);
  });

  it("draws nothing for an object worth less than minCost", () => {
    const cheap = roll(4, [25]);
    expect(api2PolicyEffects(classic).registrations.discountRoll?.(cheap.roll)).toBe(0);
    expect(cheap.drawn).toEqual([]);
  });

  it("installs no hook, only the registration", () => {
    const effects = api2PolicyEffects(classic);
    expect(Object.keys(effects.hooks)).toEqual([]);
    expect(Object.keys(effects.registrations)).toEqual(["discountRoll"]);
  });

  it("refuses a roll that could empty a stack or stall a turn", () => {
    expect(checkApi2Policies(classic)).toBeNull();
    expect(checkApi2Policies({ storeDiscountRoll: { tiers: [] } })).toMatch(/lists 1 to 16 tiers/u);
    expect(checkApi2Policies({ storeDiscountRoll: { tiers: [{ oneIn: 2, percent: 100 }] } })).toMatch(/percent is a whole number from 1 to 99/u);
    expect(checkApi2Policies({ storeDiscountRoll: { tiers: [{ oneIn: 0, percent: 10 }] } })).toMatch(/oneIn is a whole number/u);
    expect(checkApi2Policies({ storeDiscountRoll: { tiers: [{ oneIn: 2, percent: 10, odds: 3 }] } })).toMatch(/unknown field "odds"/u);
    expect(checkApi2Policies({ storeDiscountRoll: { minCost: -1, tiers: [{ oneIn: 2, percent: 10 }] } })).toMatch(/minCost/u);
  });
});

describe("the tile map", () => {
  /* A pack with tiles for monsters 1 and 2 and object 7; fill only writes where nothing is. */
  const pack = (id: string, recolours: boolean) => {
    const monsters = new Map<number, string>([[1, "orc"], [2, "kobold"]]);
    const objects = new Map<number, string>([[7, "ring"]]);
    const fill: Api2TileFill<string> = {
      pack: { engine: "linoleum", id, menuname: id },
      monsterTile: (i) => monsters.get(i) ?? null,
      objectTile: (i) => objects.get(i) ?? null,
      fillMonster: (i, tile) => (monsters.has(i) ? false : (monsters.set(i, tile), true)),
      fillObject: (i, tile) => (objects.has(i) ? false : (objects.set(i, tile), true)),
      derive: (donor, hue) => (recolours ? `${donor}@${String(hue)}` : null),
    };
    return { fill, monsters, objects };
  };

  it("fills a missing tile from its donor, plain or recoloured, and never repaints one a pack draws", () => {
    const filler = api2PolicyEffects({
      tileMap: [
        { monster: 9, like: 1 },
        { monster: 10, like: 2, hue: 120 },
        { object: 8, like: 7 },
        { monster: 2, like: 1 },
      ],
    }).registrations.tileFiller;
    const p = pack("gervais", true);
    filler?.(p.fill as Api2TileFill);
    expect(p.monsters.get(9)).toBe("orc");
    expect(p.monsters.get(10)).toBe("kobold@120");
    expect(p.objects.get(8)).toBe("ring");
    expect(p.monsters.get(2)).toBe("kobold");
  });

  it("skips a rule for another pack, a missing donor, or a recolour the pack cannot make", () => {
    const filler = api2PolicyEffects({
      tileMap: [
        { monster: 9, like: 1, packs: ["other"] },
        { monster: 10, like: 99 },
        { monster: 11, like: 1, hue: 90 },
      ],
    }).registrations.tileFiller;
    const p = pack("gervais", false);
    filler?.(p.fill as Api2TileFill);
    expect([...p.monsters.keys()].sort()).toEqual([1, 2]);
  });

  it("refuses a rule that names both sorts, neither, or a bad hue", () => {
    expect(checkApi2Policies({ tileMap: [{ monster: 1, object: 2, like: 3 }] })).toMatch(/exactly one of monster and object/u);
    expect(checkApi2Policies({ tileMap: [{ like: 3 }] })).toMatch(/exactly one of monster and object/u);
    expect(checkApi2Policies({ tileMap: [{ monster: 1, like: 3, hue: 360 }] })).toMatch(/hue/u);
    expect(checkApi2Policies({ tileMap: [{ monster: 1, like: -1 }] })).toMatch(/like is an index/u);
    expect(checkApi2Policies({ tileMap: [{ monster: 1, like: 2, packs: [] }] })).toMatch(/packs lists/u);
  });
});
