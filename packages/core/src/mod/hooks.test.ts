/**
 * composeModHooks: the fold that turns several mods' contributions into the one
 * ModHooks object core holds.
 *
 * The fold rule DIFFERS PER HOOK (veto hooks are conjunctive, transforms chain,
 * handler hooks stop at the first taker), and getting one of them wrong is the
 * kind of defect that only shows up when a second mod is enabled - which is to
 * say, not in any of the shipped configurations, and then immediately for the
 * first player who installs two mods. So each rule is pinned here rather than
 * left to the comment that describes it.
 */

import { describe, expect, it, vi } from "vitest";
import { composeModHooks, guardModHooks, type ModHookFault, type ModHooks } from "./hooks.js";
import type { GameState } from "../game/context.js";

const STATE = {} as GameState;
const GRID = { y: 1, x: 1 };
/** The live CaveCmdDeps core passes through; opaque to the fold. */
const DEPS = {};

describe("composeModHooks: nothing in, nothing out", () => {
  it("returns undefined for no contributions", () => {
    expect(composeModHooks([])).toBeUndefined();
  });

  it("returns undefined when every contribution is empty", () => {
    /* "A disabled mod's patches DO NOT EXIST": a mod that touches no behaviour
     * must leave core's field ABSENT, not holding an empty object. Otherwise
     * core can tell a mod is loaded, which is the whole thing this seam avoids. */
    expect(composeModHooks([{}, {}])).toBeUndefined();
  });

  it("leaves untouched hooks absent, not stubbed", () => {
    const composed = composeModHooks([{ messageText: (s) => s }]);
    expect(composed?.messageText).toBeTypeOf("function");
    expect(composed?.levelGenerated).toBeUndefined();
    expect(composed?.artifactCommit).toBeUndefined();
    expect(composed?.historyAdd).toBeUndefined();
    expect(composed?.saveNoiseScent).toBeUndefined();
    expect(composed?.walkBlockedByDiggable).toBeUndefined();
    expect(composed?.objectListTiebreak).toBeUndefined();
  });
});

describe("veto hooks are conjunctive", () => {
  it("levelGenerated: one refusal rejects the level", () => {
    const composed = composeModHooks([
      { levelGenerated: () => true },
      { levelGenerated: () => false },
    ]);
    expect(composed?.levelGenerated?.({}, false)).toBe(false);
  });

  it("levelGenerated: every contributor runs when all accept", () => {
    /* A second mod's invariant is NOT satisfied by the first mod's repair, so
     * both must be given the level. */
    const ran: string[] = [];
    const composed = composeModHooks([
      { levelGenerated: () => (ran.push("a"), true) },
      { levelGenerated: () => (ran.push("b"), true) },
    ]);
    expect(composed?.levelGenerated?.({}, false)).toBe(true);
    expect(ran).toEqual(["a", "b"]);
  });

  it("levelGenerated: a refusal short-circuits the rest", () => {
    /* The level is being thrown away, so running later repairs on it is wasted
     * work at best and a mutation of a discarded object at worst. */
    const ran: string[] = [];
    const composed = composeModHooks([
      { levelGenerated: () => (ran.push("a"), false) },
      { levelGenerated: () => (ran.push("b"), true) },
    ]);
    expect(composed?.levelGenerated?.({}, false)).toBe(false);
    expect(ran).toEqual(["a"]);
  });

  it("artifactCommit: one refusal refuses the commit", () => {
    const composed = composeModHooks([
      { artifactCommit: () => true },
      { artifactCommit: () => false },
    ]);
    expect(composed?.artifactCommit?.(7, true)).toBe(false);
  });

  it("artifactCommit: passes both arguments through unchanged", () => {
    let seen: [number, boolean] | null = null;
    const composed = composeModHooks([
      { artifactCommit: (aidx, made) => ((seen = [aidx, made]), true) },
    ]);
    composed?.artifactCommit?.(42, true);
    expect(seen).toEqual([42, true]);
  });

  it("historyAdd: one refusal suppresses the entry", () => {
    const composed = composeModHooks([
      { historyAdd: () => true },
      { historyAdd: () => false },
    ]);
    expect(composed?.historyAdd?.({ what: "Killed Grip", type: 1, duplicate: true })).toBe(false);
  });

  it("historyAdd: all accepting writes the entry", () => {
    const composed = composeModHooks([
      { historyAdd: () => true },
      { historyAdd: () => true },
    ]);
    expect(composed?.historyAdd?.({ what: "Killed Grip", type: 1, duplicate: false })).toBe(true);
  });
});

describe("transform hooks chain in load order", () => {
  it("messageText: each sees the previous one's output", () => {
    const composed = composeModHooks([
      { messageText: (s) => `${s}-a` },
      { messageText: (s) => `${s}-b` },
    ]);
    expect(composed?.messageText?.("x")).toBe("x-a-b");
  });

  it("messageText: order matters, so the fold is not commutative", () => {
    const first = composeModHooks([
      { messageText: (s) => s.replace("  ", " ") },
      { messageText: (s) => s.toUpperCase() },
    ]);
    const second = composeModHooks([
      { messageText: (s) => s.toUpperCase() },
      { messageText: (s) => s.replace("  ", " ") },
    ]);
    expect(first?.messageText?.("a  b")).toBe("A B");
    expect(second?.messageText?.("a  b")).toBe("A B");
    /* Same answer here by luck; prove non-commutativity with a pair where it
     * shows, so a future "just reduce in any order" simplification fails. */
    const f = composeModHooks([
      { messageText: (s) => `${s}!` },
      { messageText: (s) => s.replace("!", "?") },
    ]);
    const g = composeModHooks([
      { messageText: (s) => s.replace("!", "?") },
      { messageText: (s) => `${s}!` },
    ]);
    expect(f?.messageText?.("hi")).toBe("hi?");
    expect(g?.messageText?.("hi")).toBe("hi!");
  });
});

describe("first-handler hooks stop at the first taker", () => {
  it("walkBlockedByDiggable: the first non-null answer wins", () => {
    const composed = composeModHooks([
      { walkBlockedByDiggable: () => 100 },
      { walkBlockedByDiggable: () => 200 },
    ]);
    expect(composed?.walkBlockedByDiggable?.(STATE, GRID, DEPS)).toBe(100);
  });

  it("walkBlockedByDiggable: a later mod cannot double-spend the energy", () => {
    const ran: string[] = [];
    const composed = composeModHooks([
      { walkBlockedByDiggable: () => (ran.push("a"), 100) },
      { walkBlockedByDiggable: () => (ran.push("b"), 200) },
    ]);
    composed?.walkBlockedByDiggable?.(STATE, GRID, DEPS);
    expect(ran).toEqual(["a"]);
  });

  it("walkBlockedByDiggable: declining falls through to the next", () => {
    const composed = composeModHooks([
      { walkBlockedByDiggable: () => null },
      { walkBlockedByDiggable: () => 50 },
    ]);
    expect(composed?.walkBlockedByDiggable?.(STATE, GRID, DEPS)).toBe(50);
  });

  it("walkBlockedByDiggable: everyone declining declines, so core bumps the wall", () => {
    const composed = composeModHooks([
      { walkBlockedByDiggable: () => null },
      { walkBlockedByDiggable: () => null },
    ]);
    expect(composed?.walkBlockedByDiggable?.(STATE, GRID, DEPS)).toBeNull();
  });

  it("walkBlockedByDiggable: zero energy is a HANDLED answer, not a decline", () => {
    /* The decline sentinel is null precisely so that a mod can handle the walk
     * and legitimately charge nothing. Using 0 as the sentinel would make a
     * free action fall through to the next mod and then to core's bump. */
    const composed = composeModHooks([
      { walkBlockedByDiggable: () => 0 },
      { walkBlockedByDiggable: () => 999 },
    ]);
    expect(composed?.walkBlockedByDiggable?.(STATE, GRID, DEPS)).toBe(0);
  });
});

describe("any-hooks are disjunctive", () => {
  it("saveNoiseScent: one mod asking is enough", () => {
    const composed = composeModHooks([
      { saveNoiseScent: () => false },
      { saveNoiseScent: () => true },
    ]);
    expect(composed?.saveNoiseScent?.()).toBe(true);
  });

  it("saveNoiseScent: nobody asking means the faithful omission", () => {
    const composed = composeModHooks([
      { saveNoiseScent: () => false },
      { saveNoiseScent: () => false },
    ]);
    expect(composed?.saveNoiseScent?.()).toBe(false);
  });
});

describe("ordering hooks chain like a lexicographic comparator", () => {
  it("objectListTiebreak: the first non-zero answer wins", () => {
    const composed = composeModHooks([
      { objectListTiebreak: () => 0 },
      { objectListTiebreak: () => -1 },
    ]);
    expect(composed?.objectListTiebreak?.({ dy: 0, dx: 0 }, { dy: 0, dx: 0 })).toBe(-1);
  });

  it("objectListTiebreak: all-equal stays equal, so a stable sort keeps collect order", () => {
    const composed = composeModHooks([
      { objectListTiebreak: () => 0 },
      { objectListTiebreak: () => 0 },
    ]);
    expect(composed?.objectListTiebreak?.({ dy: 1, dx: 2 }, { dy: 1, dx: 2 })).toBe(0);
  });

  it("objectListTiebreak: receives both entries' geometry", () => {
    let seen: unknown[] = [];
    const composed = composeModHooks([
      { objectListTiebreak: (a, b) => ((seen = [a, b]), 0) },
    ]);
    composed?.objectListTiebreak?.({ dy: 1, dx: 2 }, { dy: 3, dx: 4 });
    expect(seen).toEqual([{ dy: 1, dx: 2 }, { dy: 3, dx: 4 }]);
  });
});

describe("the fold ignores empty contributors without dropping real ones", () => {
  it("an empty mod between two real ones does not break the chain", () => {
    const mods: ModHooks[] = [
      { messageText: (s) => `${s}-a` },
      {},
      { messageText: (s) => `${s}-b` },
    ];
    expect(composeModHooks(mods)?.messageText?.("x")).toBe("x-a-b");
  });

  it("a single contributor is passed through, not wrapped away", () => {
    const composed = composeModHooks([{ saveNoiseScent: () => true }]);
    expect(composed?.saveNoiseScent?.()).toBe(true);
  });
});

/* --- guardModHooks -----------------------------------------------------------
 *
 * The neutral answer per hook is the whole content of this function, and each one
 * is a different value chosen for a different reason. A generic "return
 * undefined" would be a silent refusal for the vetoes, a crash for the
 * comparator and an erased message for the transform - so every one is pinned
 * here separately rather than left to the fold's own tests, which never see a
 * throw.
 */

const THROWS = (): never => {
  throw new Error("boom");
};

/** A guarded contribution plus the faults it reported, for the tests below. */
function guarded(hooks: ModHooks): { hooks: ModHooks; faults: ModHookFault[] } {
  const faults: ModHookFault[] = [];
  return { hooks: guardModHooks(hooks, (f) => faults.push(f)), faults };
}

describe("guardModHooks: a throwing hook answers with nothing, per hook's meaning", () => {
  it("walkBlockedByDiggable declines, so core bumps the wall", () => {
    const { hooks } = guarded({ walkBlockedByDiggable: THROWS });
    expect(hooks.walkBlockedByDiggable?.(STATE, GRID, DEPS)).toBeNull();
  });

  it("objectListTiebreak stays equal, so the stable sort keeps collect order", () => {
    const { hooks } = guarded({ objectListTiebreak: THROWS });
    expect(hooks.objectListTiebreak?.({ dy: 0, dx: 0 }, { dy: 1, dx: 1 })).toBe(0);
  });

  it("levelGenerated ACCEPTS, so one broken hook cannot make levels unreachable", () => {
    /* Rejecting on a throw would re-roll, throw again, re-roll again - and
     * cave_generate gives up after its limit. The player would be unable to
     * descend at all, which is a far worse failure than the mod not applying. */
    const { hooks } = guarded({ levelGenerated: THROWS });
    expect(hooks.levelGenerated?.({}, false)).toBe(true);
  });

  it("artifactCommit commits, which is what core does with no hook", () => {
    const { hooks } = guarded({ artifactCommit: THROWS });
    expect(hooks.artifactCommit?.(7, true)).toBe(true);
  });

  it("historyAdd writes the entry rather than eating the player's history", () => {
    const { hooks } = guarded({ historyAdd: THROWS });
    expect(hooks.historyAdd?.({ what: "Killed Grip", type: 1, duplicate: false })).toBe(true);
  });

  it("saveNoiseScent omits them, the upstream behaviour", () => {
    const { hooks } = guarded({ saveNoiseScent: THROWS });
    expect(hooks.saveNoiseScent?.()).toBe(false);
  });

  it("messageText returns the RAW message, never an empty one", () => {
    /* The neutral value for a transform is its input. Falling back to "" would
     * delete a line the player needed to read, and nothing downstream could tell
     * that a message had gone missing. */
    const { hooks } = guarded({ messageText: THROWS });
    expect(hooks.messageText?.("You feel a sudden chill.")).toBe("You feel a sudden chill.");
  });
});

describe("guardModHooks: what it reports, and to whom", () => {
  it("names the hook and hands back the error untouched", () => {
    const err = new Error("cannot read properties of undefined");
    const { hooks, faults } = guarded({
      historyAdd: () => {
        throw err;
      },
    });
    hooks.historyAdd?.({ what: "x", type: 0, duplicate: false });
    expect(faults).toEqual([{ hook: "historyAdd", error: err }]);
  });

  it("passes a non-Error throw through as it was thrown", () => {
    const { hooks, faults } = guarded({
       
      messageText: () => {
        throw "a string";
      },
    });
    hooks.messageText?.("hi");
    expect(faults[0]?.error).toBe("a string");
  });

  it("carries no mod id, because core is not told one", () => {
    /* The host wraps ONE mod at a time and holds the id in the closure it passes
     * in. If a fault ever grew an `id`, core would be carrying mod identity -
     * the exact thing composeModHooks' comment promises it does not do. */
    const { hooks, faults } = guarded({ saveNoiseScent: THROWS });
    hooks.saveNoiseScent?.();
    expect(Object.keys(faults[0] ?? {}).sort()).toEqual(["error", "hook"]);
  });
});

describe("guardModHooks: a hook that threw is not called again", () => {
  it("stops calling the thrower and reports it once", () => {
    const fn = vi.fn(THROWS);
    const { hooks, faults } = guarded({ saveNoiseScent: fn });
    expect(hooks.saveNoiseScent?.()).toBe(false);
    expect(hooks.saveNoiseScent?.()).toBe(false);
    expect(hooks.saveNoiseScent?.()).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(faults).toHaveLength(1);
  });

  it("latches per HOOK, so the mod's other hooks keep working", () => {
    const { hooks, faults } = guarded({
      historyAdd: THROWS,
      messageText: (s) => s.toUpperCase(),
    });
    hooks.historyAdd?.({ what: "x", type: 0, duplicate: false });
    expect(hooks.messageText?.("still here")).toBe("STILL HERE");
    expect(faults.map((f) => f.hook)).toEqual(["historyAdd"]);
  });
});

describe("guardModHooks: it wraps, and does not invent", () => {
  it("leaves an absent hook absent", () => {
    /* If the guard stubbed every member, "a disabled mod's patches do not exist"
     * would stop being true the moment any mod was enabled: composeModHooks would
     * see seven functions from a mod that contributed one. */
    const { hooks } = guarded({ messageText: (s) => s });
    expect(hooks.messageText).toBeTypeOf("function");
    expect(hooks.historyAdd).toBeUndefined();
    expect(hooks.levelGenerated).toBeUndefined();
    expect(hooks.artifactCommit).toBeUndefined();
    expect(hooks.saveNoiseScent).toBeUndefined();
    expect(hooks.walkBlockedByDiggable).toBeUndefined();
    expect(hooks.objectListTiebreak).toBeUndefined();
  });

  it("an empty contribution stays empty, so the fold still returns undefined", () => {
    expect(Object.keys(guardModHooks({}, () => {}))).toEqual([]);
    expect(composeModHooks([guardModHooks({}, () => {})])).toBeUndefined();
  });

  it("passes every argument through untouched", () => {
    let seen: unknown[] = [];
    const { hooks } = guarded({
      walkBlockedByDiggable: (s, g, d) => ((seen = [s, g, d]), 25),
    });
    expect(hooks.walkBlockedByDiggable?.(STATE, GRID, DEPS)).toBe(25);
    expect(seen).toEqual([STATE, GRID, DEPS]);
  });

  it("does not report anything while nothing throws", () => {
    const { hooks, faults } = guarded({ messageText: (s) => `${s}!` });
    expect(hooks.messageText?.("hi")).toBe("hi!");
    expect(faults).toEqual([]);
  });
});

describe("guarded contributions fold like any other", () => {
  it("a thrower reads to the fold as a mod with no opinion, not as a veto", () => {
    /* This is the reason to guard BEFORE folding rather than after. A broken
     * historyAdd must not suppress the entry, and must not stop the other mod's
     * historyAdd from being asked. */
    const composed = composeModHooks([
      guardModHooks({ historyAdd: THROWS }, () => {}),
      { historyAdd: () => true },
    ]);
    expect(composed?.historyAdd?.({ what: "x", type: 0, duplicate: false })).toBe(true);
  });

  it("a thrower in a transform chain drops out and the rest still apply", () => {
    const composed = composeModHooks([
      { messageText: (s) => `${s}-a` },
      guardModHooks({ messageText: THROWS }, () => {}),
      { messageText: (s) => `${s}-c` },
    ]);
    expect(composed?.messageText?.("x")).toBe("x-a-c");
  });

  it("a thrower declining lets a later mod handle the walk", () => {
    const composed = composeModHooks([
      guardModHooks({ walkBlockedByDiggable: THROWS }, () => {}),
      { walkBlockedByDiggable: () => 100 },
    ]);
    expect(composed?.walkBlockedByDiggable?.(STATE, GRID, DEPS)).toBe(100);
  });
});
