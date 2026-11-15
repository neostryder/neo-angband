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
  it.each(["forcedDescentStairs", "missileCritFromState", "classicSearch"] as const)("checks %s and installs only the granted true switch", (name) => {
    expect(checkApi2Policies({ [name]: 1 })).toContain(`${name} is true or false`);
    expect(api2PolicyEffects({ [name]: true }).registrations).toEqual({ [name]: true });
    expect(api2PolicyEffects({ [name]: false }).registrations).toEqual({});
    expect(api2PolicyEffects({ [name]: true }, () => false).registrations).toEqual({});
  });

  it("bounds the birth confirmation note and leaves it absent without consent", () => {
    const p = { birthConfirmNote: "Review your birth choices." };
    expect(checkApi2Policies(p)).toBeNull();
    expect(api2PoliciesToHooks(p).birthConfirmNote?.({ name: "Fred", raceName: "Human", className: "Warrior", birthOptions: {} })).toBe(p.birthConfirmNote);
    expect(api2PolicyEffects(p, () => false).hooks).toEqual({});
    expect(api2PoliciesToHooks({}).birthConfirmNote).toBeUndefined();
    for (const value of ["", "x".repeat(161), "two\nlines", true]) expect(checkApi2Policies({ birthConfirmNote: value })).toContain("birthConfirmNote is plain text of 1 to 160");
  });

  it("selects a bounded end line deterministically from report facts", () => {
    const p = { runEndLine: ["A quiet end.", "A long road."] };
    expect(checkApi2Policies(p)).toBeNull();
    const facts = { outcome: "death", name: "Fred", turn: 21, seed: 4 } as const;
    const a = api2PoliciesToHooks(p).runEndLine!(facts);
    expect(p.runEndLine).toContain(a);
    expect(api2PoliciesToHooks(p).runEndLine!(facts)).toBe(a);
    expect(api2PolicyEffects(p, () => false).hooks).toEqual({});
    for (const value of [[], [""], ["x".repeat(73)], ["two\nlines"], Array(257).fill("x")]) expect(checkApi2Policies({ runEndLine: value })).toContain("runEndLine is a list of 1 to 256");
  });

  it("bounds pause prefixes and installs them only with message consent", () => {
    const p = { messagePauseAfter: ["You feel that"] };
    expect(checkApi2Policies(p)).toBeNull();
    expect(api2PolicyEffects(p, () => false).hooks).toEqual({});
    const h = api2PoliciesToHooks(p);
    expect(h.messagePauseAfter?.("You feel that this place is special.")).toBe(true);
    expect(h.messagePauseAfter?.("You feel better.")).toBe(false);
    expect(api2PoliciesToHooks({}).messagePauseAfter).toBeUndefined();
    for (const value of [[""], ["a".repeat(257)], Array(257).fill("a"), true]) {
      expect(checkApi2Policies({ messagePauseAfter: value })).toContain("messagePauseAfter is a list of 0 to 256");
    }
  });

  it("accepts every table in its own grammar", () => {
    const policies: Api2Policies = {
      prefErrors: { kind: "pref-errors", continueAfterError: true, reportLimit: 20 },
      startingOptions: { kind: "starting-options", values: { birth_no_selling: true, cheat_live: true }, hitpointWarn: 9, delayFactor: 10, lazymoveDelay: 255 },
      ignore: [{ tval: "light", kindNameContains: "Torch", ignore: true }],
      displayOptions: { kind: "display-options", storeItemNameEllipsis: true, storeSelectionDescription: true, monsterListColorKey: true },
      purgeInput: { kind: "purge-input", trigger: "F2", modifiers: [], freshOnly: true, escapeCount: 3 },
      walkBlockedByDiggable: { kind: "walk-blocked-by-diggable", attempt: "tunnel", energy: "move", step: false },
      valueFloor: { kind: "valueFloor", tvals: [10, 11], appliesTo: "egoOrPositiveToA", comparison: "cheapestPlainSameTvalWithStrictlyGreaterAc", price: "objectValueReal" },
      messageText: [{ find: "You feel", replace: "You sense", match: "prefix" }],
      messagePauseAfter: ["You feel that"],
      runEndLine: ["A quiet end."],
      birthConfirmNote: "Review your birth choices.",
      helpText: [{ find: "old prose", replace: "new prose", where: { kind: "paragraph" } }],
      screenText: [{ find: "a", replace: "b", where: { screen: "char", column: 2 } }],
      historyAdd: [{ find: "Found", drop: true, match: "prefix", where: { duplicate: true } }],
      objectListOrder: ["-dy", "dx"],
      saveNoiseScent: true,
      shapeLearnObviousFlagsDirectly: false,
      cursedLightRadius: true,
    };
    expect(checkApi2Policies(policies)).toBeNull();
  });

  it("checks and installs a bounded classic trap allocation table", () => {
    const trapAllocation = { kind: "trap-allocation" as const,
      count: { depthDivisor: 3, min: 2, max: 10, divisor: 1 }, placement: "both" as const };
    expect(checkApi2Policies({ trapAllocation })).toBeNull();
    for (const placement of ["rooms", "corridors", "both"]) {
      expect(checkApi2Policies({ trapAllocation: { ...trapAllocation, placement } })).toBeNull();
    }
    for (const [field, value] of [["depthDivisor", 0], ["min", 0], ["max", 257], ["divisor", 0], ["max", 1], ["min", 2.5]]) {
      expect(checkApi2Policies({ trapAllocation: { ...trapAllocation, count: { ...trapAllocation.count, [field as string]: value } } })).not.toBeNull();
    }
    for (const value of [null, {}, { ...trapAllocation, kind: "traps" }, { ...trapAllocation, placement: "anywhere" },
      { ...trapAllocation, count: [] }, { ...trapAllocation, count: { ...trapAllocation.count, dice: 1 } },
      { ...trapAllocation, hidden: true }]) expect(checkApi2Policies({ trapAllocation: value })).not.toBeNull();
    expect(api2PolicyEffects({ trapAllocation }, () => false).registrations).toEqual({});
    const result = api2PolicyEffects({ trapAllocation }, (cap) => cap === "registry:room").registrations.trapAllocation;
    expect(result).toEqual(trapAllocation);
    expect(result).not.toBe(trapAllocation);
    expect(result!.count).not.toBe(trapAllocation.count);
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
    expect(checkApi2Policies({ walkBlockedByDiggable: { ...walk, chance: 100 } })).toContain("unknown field \"chance\"");
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

  it("refuses malformed preference-error declarations", () => {
    const prefErrors = { kind: "pref-errors", continueAfterError: true, reportLimit: 20 };
    expect(checkApi2Policies({ prefErrors })).toBeNull();
    for (const [field, value] of [["kind", "preferences"], ["continueAfterError", "yes"], ["reportLimit", -1], ["reportLimit", 1.5], ["reportLimit", 1001]]) {
      expect(checkApi2Policies({ prefErrors: { ...prefErrors, [field as string]: value } })).toContain(`prefErrors.${String(field)}`);
    }
    expect(checkApi2Policies({ prefErrors: { ...prefErrors, reportAll: true } })).toContain("unknown field \"reportAll\"");
    expect(checkApi2Policies({ prefErrors: null })).toContain("is an object");
  });

  it("refuses malformed starting-option declarations", () => {
    const startingOptions = { kind: "starting-options", values: { birth_no_selling: true } };
    expect(checkApi2Policies({ startingOptions })).toBeNull();
    expect(checkApi2Policies({ startingOptions: { ...startingOptions, extra: true } })).toContain("unknown field");
    expect(checkApi2Policies({ startingOptions: { ...startingOptions, values: [] } })).toContain("values is an object");
    expect(checkApi2Policies({ startingOptions: { ...startingOptions, values: { x: "yes" } } })).toContain("is true or false");
    expect(checkApi2Policies({ startingOptions: { ...startingOptions, hitpointWarn: 10 } })).toContain("hitpointWarn");
    expect(checkApi2Policies({ startingOptions: { ...startingOptions, delayFactor: 256 } })).toContain("delayFactor");
  });

  it("refuses malformed ignore policy entries", () => {
    const ignore = [{ tval: "light", kindNameContains: "Torch", ignore: true }];
    expect(checkApi2Policies({ ignore })).toBeNull();
    expect(checkApi2Policies({ ignore: [{ ...ignore[0], tval: "LIGHT" }] })).toContain("tval");
    expect(checkApi2Policies({ ignore: [{ ...ignore[0], kindNameContains: "torch" }] })).toContain("kindNameContains");
    expect(checkApi2Policies({ ignore: [{ ...ignore[0], ignore: false }] })).toContain("ignore is true");
    expect(checkApi2Policies({ ignore: [{ ...ignore[0], extra: true }] })).toContain("unknown field");
  });

  it("refuses malformed display-option declarations", () => {
    const displayOptions = { kind: "display-options", storeItemNameEllipsis: true, storeSelectionDescription: true, monsterListColorKey: true };
    expect(checkApi2Policies({ displayOptions })).toBeNull();
    expect(checkApi2Policies({ displayOptions: { ...displayOptions, extra: true } })).toContain("unknown field");
    expect(checkApi2Policies({ displayOptions: { ...displayOptions, monsterListColorKey: "yes" } })).toContain("monsterListColorKey");
  });

  it("refuses malformed purge-input declarations", () => {
    const purgeInput = { kind: "purge-input", trigger: "F2", modifiers: [], freshOnly: true, escapeCount: 3 };
    expect(checkApi2Policies({ purgeInput })).toBeNull();
    expect(checkApi2Policies({ purgeInput: { ...purgeInput, trigger: "F3" } })).toContain("trigger");
    expect(checkApi2Policies({ purgeInput: { ...purgeInput, modifiers: ["shift"] } })).toContain("modifiers");
    expect(checkApi2Policies({ purgeInput: { ...purgeInput, escapeCount: 0 } })).toContain("escapeCount");
    expect(checkApi2Policies({ purgeInput: { ...purgeInput, unknown: true } })).toContain("unknown field");
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

describe("randart set size declarations", () => {
  it.each([null, [], {}, { multiplier: 0 }, { multiplier: -1 }, { multiplier: NaN }, { multiplier: Infinity }, { multiplier: "2" }, { multiplier: 2, extra: true }])("rejects an invalid declaration: %j", (randartSetSize) => {
    expect(checkApi2Policies({ randartSetSize })).not.toBeNull();
  });

  it.each([[0.1, 0.25], [1, 1], [2, 2], [100, 4]])("clamps %s to %s after consent", (multiplier, expected) => {
    const policy = { randartSetSize: { multiplier } };
    expect(checkApi2Policies(policy)).toBeNull();
    expect(api2PolicyEffects(policy, () => false).registrations).toEqual({});
    expect(api2PolicyEffects(policy, (capability) => capability === "registry:randart-size").registrations.randartSetSize).toEqual({ multiplier: expected });
  });
});

describe("API2_POLICY_KINDS", () => {
  it("maps every table to its matching registry permission", () => {
    expect(Object.fromEntries(API2_POLICY_KINDS.map((kind) => [kind.name, kind.capability]))).toEqual({
      classicSearch: "registry:command",
      missileCritFromState: "registry:effect-info",
      forcedDescentStairs: "registry:room",
      trapAllocation: "registry:room",
      randartSetSize: "registry:randart-size",
      prefErrors: "registry:ui-entry",
      startingOptions: "registry:ui-entry",
      ignore: "registry:ui-entry",
      displayOptions: "registry:ui-entry",
      purgeInput: "registry:command",
      walkBlockedByDiggable: "registry:command",
      messagePauseAfter: "registry:message",
      runEndLine: "registry:ui-entry",
      birthConfirmNote: "registry:ui-entry",
      helpText: "registry:ui-entry",
      messageText: "registry:message", screenText: "registry:ui-entry", characterBackground: "registry:message",
      objectInfoText: "registry:effect-info", effectIntro: "registry:effect-info", historyAdd: "registry:message",
      historyDisplay: "registry:message", objectListOrder: "registry:tval", saveNoiseScent: "registry:monster",
      shapeLearnObviousFlagsDirectly: "registry:rune", cursedLightRadius: "registry:ui-entry", completeRestEffects: "registry:command",
      storeDiscountRoll: "registry:store", valueFloor: "registry:tval", tileMap: "registry:tiles",
      projectionRadiusClamp: "registry:projection", levelRevisitTracking: "registry:monster", monsterArcheryFrequency: "registry:monster", forceFromBlastCenter: "registry:projection", forgetUnlitImpassableTerrain: "registry:projection", monsterLoreCompleteness: "registry:monster", monsterOwnDropThefts: "registry:monster",
    });
  });

  it("is the one list the names, the check and the interpreter walk", () => {
    expect(API2_POLICY_NAMES).toEqual(API2_POLICY_KINDS.map((kind) => kind.name));
    expect(new Set(API2_POLICY_NAMES).size).toBe(API2_POLICY_NAMES.length);
    for (const kind of API2_POLICY_KINDS) {
      expect(kind.summary.length).toBeGreaterThan(0);
      if ("hook" in kind.target) expect(API2_HOOK_NAMES).toContain(kind.target.hook);
      else expect(["classicSearch", "missileCritFromState", "forcedDescentStairs", "randartSetSize", "trapAllocation", "monsterOwnDropThefts", "monsterLoreCompleteness", "forgetUnlitImpassableTerrain", "forceFromBlastCenter", "monsterArcheryFrequency", "discountRoll", "tileFiller", "walkBlockedByDiggable", "prefErrors", "startingOptions", "ignore", "displayOptions", "purgeInput", "valueFloor", "projectionRadiusClamp", "levelRevisitTracking"]).toContain(kind.target.registration);
    }
  });

  it("names the kinds the first requests asked for: a message rewrite, a store discount roll and a tile mapping", () => {
    expect(API2_POLICY_NAMES).toEqual(expect.arrayContaining(["messageText", "storeDiscountRoll", "tileMap"]));
  });
});

describe("cursedLightRadius", () => {
  it("accepts true and false, and true installs the hook", () => {
    expect(checkApi2Policies({ cursedLightRadius: true })).toBeNull();
    expect(checkApi2Policies({ cursedLightRadius: false })).toBeNull();
    expect(api2PoliciesToHooks({ cursedLightRadius: true }).cursedLightRadius?.()).toBe(true);
    expect(api2PoliciesToHooks({ cursedLightRadius: false }).cursedLightRadius).toBeUndefined();
  });

  it("rejects a value that is not true or false", () => {
    expect(checkApi2Policies({ cursedLightRadius: "yes" })).toMatch(/true or false/u);
    expect(checkApi2Policies({ cursedLightRadius: 1 })).toMatch(/true or false/u);
  });
});

describe("completeRestEffects", () => {
  it("accepts effect names, including none, and installs that list", () => {
    expect(checkApi2Policies({ completeRestEffects: ["SLOW", "blind", "OPP_FIRE"] })).toBeNull();
    expect(checkApi2Policies({ completeRestEffects: [] })).toBeNull();
    const hooks = api2PoliciesToHooks({ completeRestEffects: ["AMNESIA", "SCRAMBLE"] });
    expect(hooks.completeRestEffects?.()).toEqual(["AMNESIA", "SCRAMBLE"]);
    expect(api2PoliciesToHooks({ completeRestEffects: [] }).completeRestEffects?.()).toEqual([]);
  });

  it("rejects a table that is not a list of timed-effect ids", () => {
    expect(checkApi2Policies({ completeRestEffects: "SLOW" })).toMatch(/is a list/u);
    expect(checkApi2Policies({ completeRestEffects: [1] })).toMatch(/timed-effect ids/u);
    expect(checkApi2Policies({ completeRestEffects: [""] })).toMatch(/timed-effect ids/u);
    expect(checkApi2Policies({ completeRestEffects: ["1SLOW"] })).toMatch(/timed-effect ids/u);
    expect(checkApi2Policies({ completeRestEffects: ["SLOW-CUT"] })).toMatch(/timed-effect ids/u);
    expect(checkApi2Policies({ completeRestEffects: ["SLOW", "slow"] })).toMatch(/twice/u);
    expect(checkApi2Policies({ completeRestEffects: Array.from({ length: 65 }, (_, i) => `E${String(i)}`) })).toMatch(/at most 64/u);
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
      tiers: [{ oneIn: 25, percent: 10 }, { oneIn: 50, percent: 25 }, { oneIn: 150, percent: 50 }, { oneIn: 300, percent: 75 }, { oneIn: 500, percent: 90 }],
    },
  };

  it("gives the first tier whose roll succeeds, drawing no further", () => {
    const discount = api2PolicyEffects(classic).registrations.discountRoll;
    const a = roll(100, [150, 500]);
    expect(discount?.(a.roll)).toBe(50);
    expect(a.drawn).toEqual([25, 50, 150]);
    const b = roll(100, []);
    expect(discount?.(b.roll)).toBe(0);
    expect(b.drawn).toEqual([25, 50, 150, 300, 500]);
  });

  it("draws nothing for an object worth less than minCost", () => {
    const cheap = roll(4, [25]);
    expect(api2PolicyEffects(classic).registrations.discountRoll?.(cheap.roll)).toBe(0);
    expect(cheap.drawn).toEqual([]);
  });

  it.each([[25, 10], [50, 25], [150, 50], [300, 75], [500, 90]])("matches the classic one-in-%i tier at %i percent", (oneIn, percent) => {
    const attempt = roll(5, [oneIn]);
    expect(api2PolicyEffects(classic).registrations.discountRoll?.(attempt.roll)).toBe(percent);
    expect(attempt.drawn).toEqual([25, 50, 150, 300, 500].slice(0, [25, 50, 150, 300, 500].indexOf(oneIn) + 1));
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

describe("the own-drop theft switch", () => {
  it("checks booleans and installs only the granted true policy", () => {
    expect(checkApi2Policies({ monsterOwnDropThefts: true })).toBeNull();
    expect(checkApi2Policies({ monsterOwnDropThefts: [] })).not.toBeNull();
    expect(api2PolicyEffects({ monsterOwnDropThefts: false }).registrations).toEqual({});
    expect(api2PolicyEffects({ monsterOwnDropThefts: true }, () => false).registrations).toEqual({});
    expect(api2PolicyEffects({ monsterOwnDropThefts: true }).registrations).toEqual({ monsterOwnDropThefts: true });
  });
});

describe("the lore completeness switch", () => {
  it("checks booleans and installs only the granted true policy", () => {
    expect(checkApi2Policies({ monsterLoreCompleteness: true })).toBeNull();
    expect(checkApi2Policies({ monsterLoreCompleteness: {} })).not.toBeNull();
    expect(api2PolicyEffects({ monsterLoreCompleteness: false }).registrations).toEqual({});
    expect(api2PolicyEffects({ monsterLoreCompleteness: true }, () => false).registrations).toEqual({});
    expect(api2PolicyEffects({ monsterLoreCompleteness: true }).registrations).toEqual({ monsterLoreCompleteness: true });
  });
});

describe("the unlit terrain switch", () => {
  it("checks booleans and installs only the granted true policy", () => {
    expect(checkApi2Policies({ forgetUnlitImpassableTerrain: true })).toBeNull();
    expect(checkApi2Policies({ forgetUnlitImpassableTerrain: "yes" })).not.toBeNull();
    expect(api2PolicyEffects({ forgetUnlitImpassableTerrain: false }).registrations).toEqual({});
    expect(api2PolicyEffects({ forgetUnlitImpassableTerrain: true }, () => false).registrations).toEqual({});
    expect(api2PolicyEffects({ forgetUnlitImpassableTerrain: true }).registrations).toEqual({ forgetUnlitImpassableTerrain: true });
  });
});

describe("the FORCE centre switch", () => {
  it("checks booleans, grants the projection capability, and leaves false absent", () => {
    expect(checkApi2Policies({ forceFromBlastCenter: true })).toBeNull();
    expect(checkApi2Policies({ forceFromBlastCenter: 1 })).not.toBeNull();
    expect(api2PolicyEffects({ forceFromBlastCenter: false }).registrations).toEqual({});
    expect(api2PolicyEffects({ forceFromBlastCenter: true }, () => false).registrations).toEqual({});
    expect(api2PolicyEffects({ forceFromBlastCenter: true }).registrations).toEqual({ forceFromBlastCenter: true });
  });
});

describe("the monster archery frequency", () => {
  it("accepts a bounded threshold and installs data only under the monster grant", () => {
    const policy = { monsterArcheryFrequency: { greaterThan: 25 } };
    expect(checkApi2Policies(policy)).toBeNull();
    expect(api2PolicyEffects(policy, () => false).registrations).toEqual({});
    expect(api2PolicyEffects(policy).registrations.monsterArcheryFrequency).toEqual({ greaterThan: 25 });
  });

  it.each([null, true, {}, { greaterThan: -1 }, { greaterThan: 101 }, { greaterThan: 1.5 }, { greaterThan: "25" }, { greaterThan: 25, extra: true }])("rejects malformed thresholds: %j", (value) => {
    expect(checkApi2Policies({ monsterArcheryFrequency: value })).not.toBeNull();
  });
});

describe("the value floor", () => {
  const declaration = {
    kind: "valueFloor", tvals: [10, 11, 12, 13, 14, 15, 16, 17, 18],
    appliesTo: "egoOrPositiveToA", comparison: "cheapestPlainSameTvalWithStrictlyGreaterAc", price: "objectValueReal",
  } as const;

  it("copies the data only when its item class grant is held", () => {
    expect(checkApi2Policies({ valueFloor: declaration })).toBeNull();
    expect(api2PolicyEffects({ valueFloor: declaration }, () => false).registrations).toEqual({});
    const effects = api2PolicyEffects({ valueFloor: declaration }, (capability) => capability === "registry:tval");
    expect(effects.hooks).toEqual({});
    expect(effects.registrations.valueFloor).toEqual(declaration);
    expect(effects.registrations.valueFloor?.tvals).not.toBe(declaration.tvals);
  });

  it("refuses unknown kinds, fields and comparison choices", () => {
    for (const field of ["kind", "appliesTo", "comparison", "price"]) {
      expect(checkApi2Policies({ valueFloor: { ...declaration, [field]: "unknown" } })).toContain(`valueFloor.${field}`);
    }
    expect(checkApi2Policies({ valueFloor: { ...declaration, floor: 100 } })).toContain("unknown field \"floor\"");
    expect(checkApi2Policies({ valueFloor: null })).toContain("is an object");
  });

  it.each([undefined, [], [10, 10], [-1], [1.5], [100001], ["armor"], Array.from({ length: 257 }, (_, i) => i)])("refuses malformed item class indices: %j", (tvals) => {
    expect(checkApi2Policies({ valueFloor: { ...declaration, tvals } })).toContain("valueFloor.tvals");
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

  it("draws a named sheet cell on a tile sheet, only where nothing is drawn, and skips a loose pack", () => {
    const rules = [{ monster: 40, cell: [0x14, 0x05], packs: ["gervais"] }, { object: 7, cell: [1, 2], packs: ["gervais"] }, { monster: 1, cell: [3, 4], packs: ["gervais"] }] as const;
    const filler = api2PolicyEffects({ tileMap: rules }).registrations.tileFiller;
    const monsters = new Map<number, unknown>([[1, "orc"]]);
    const objects = new Map<number, unknown>([[7, "ring"]]);
    const door = (engine: string): Api2TileFill => ({
      pack: { engine, id: "gervais", menuname: "gervais" },
      monsterTile: () => null,
      objectTile: () => null,
      fillMonster: (i, tile) => (monsters.has(i) ? false : (monsters.set(i, tile), true)),
      fillObject: (i, tile) => (objects.has(i) ? false : (objects.set(i, tile), true)),
      derive: () => null,
    });
    filler?.(door("linoleum"));
    expect(monsters.has(40)).toBe(false);
    filler?.(door("tilesheet"));
    expect(monsters.get(40)).toEqual({ attr: 0x85, char: 0x94 });
    expect(monsters.get(1)).toBe("orc");
    expect(objects.get(7)).toBe("ring");
  });

  it("refuses a cell rule that is malformed, turned by a hue, or not tied to its packs", () => {
    expect(checkApi2Policies({ tileMap: [{ monster: 1, cell: [0, 0], packs: ["a"] }] })).toBeNull();
    expect(checkApi2Policies({ tileMap: [{ monster: 1, like: 2, cell: [0, 0], packs: ["a"] }] })).toMatch(/exactly one of like and cell/u);
    expect(checkApi2Policies({ tileMap: [{ monster: 1, packs: ["a"] }] })).toMatch(/exactly one of like and cell/u);
    expect(checkApi2Policies({ tileMap: [{ monster: 1, cell: [0, 128], packs: ["a"] }] })).toMatch(/cell is \[column, row\]/u);
    expect(checkApi2Policies({ tileMap: [{ monster: 1, cell: [0], packs: ["a"] }] })).toMatch(/cell is \[column, row\]/u);
    expect(checkApi2Policies({ tileMap: [{ monster: 1, cell: [0, 0], hue: 90, packs: ["a"] }] })).toMatch(/hue/u);
    expect(checkApi2Policies({ tileMap: [{ monster: 1, cell: [0, 0] }] })).toMatch(/needs the packs/u);
  });

  it("refuses a rule that names both sorts, neither, or a bad hue", () => {
    expect(checkApi2Policies({ tileMap: [{ monster: 1, object: 2, like: 3 }] })).toMatch(/exactly one of monster and object/u);
    expect(checkApi2Policies({ tileMap: [{ like: 3 }] })).toMatch(/exactly one of monster and object/u);
    expect(checkApi2Policies({ tileMap: [{ monster: 1, like: 3, hue: 360 }] })).toMatch(/hue/u);
    expect(checkApi2Policies({ tileMap: [{ monster: 1, like: -1 }] })).toMatch(/like is an index/u);
    expect(checkApi2Policies({ tileMap: [{ monster: 1, like: 2, packs: [] }] })).toMatch(/packs lists/u);
  });
});
