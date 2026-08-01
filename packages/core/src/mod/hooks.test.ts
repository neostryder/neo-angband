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
import {
  composeModHooks,
  guardModHooks,
  MOD_HOOK_FOLDS,
  type ModHookFault,
  type ModHooks,
} from "./hooks.js";
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

describe("last-handler hooks stop at the LAST taker", () => {
  it("walkBlockedByDiggable: the last non-null answer wins", () => {
    const composed = composeModHooks([
      { walkBlockedByDiggable: () => 100 },
      { walkBlockedByDiggable: () => 200 },
    ]);
    expect(composed?.walkBlockedByDiggable?.(STATE, GRID, DEPS)).toBe(200);
  });

  it("walkBlockedByDiggable: an earlier mod cannot double-spend the energy", () => {
    /* Reversed on 2026-08-02. It used to be the LATER mod that was not asked,
     * which meant moving a mod down the list - the manager's own advice for
     * winning a conflict - took its auto-dig rule out of play. */
    const ran: string[] = [];
    const composed = composeModHooks([
      { walkBlockedByDiggable: () => (ran.push("a"), 100) },
      { walkBlockedByDiggable: () => (ran.push("b"), 200) },
    ]);
    composed?.walkBlockedByDiggable?.(STATE, GRID, DEPS);
    expect(ran).toEqual(["b"]);
  });

  it("walkBlockedByDiggable: declining falls back to the one before it", () => {
    const composed = composeModHooks([
      { walkBlockedByDiggable: () => 50 },
      { walkBlockedByDiggable: () => null },
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
     * free action fall through to the mod before it and then to core's bump. */
    const composed = composeModHooks([
      { walkBlockedByDiggable: () => 999 },
      { walkBlockedByDiggable: () => 0 },
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

/**
 * MOD_HOOK_FOLDS is read by the host to tell a player whether two mods touching
 * one hook COMBINE or whether one of them is being silently ignored. A table
 * that merely looks right is the hand-written-mirror failure: mostly correct is
 * what lets it survive, and the one wrong row is a conflict the report describes
 * backwards.
 *
 * So the fold is OBSERVED here rather than restated. Each hook is composed twice
 * with two contributors, in both orders, and the fold is derived from what the
 * composition actually did:
 *
 *  - the answer CHANGES with the order, one contributor ran, and it was the LAST
 *    one in load order                                                       -> last-answer
 *  - the same, but the contributor that ran was the FIRST one                -> first-answer
 *  - the answer changes with the order, and both ran                          -> chained
 *  - the answer is order-independent, and one refusal makes it negative       -> all-must-agree
 *  - the answer is order-independent, and one acceptance makes it positive    -> any-yes
 *
 * `first-answer` is not a value MOD_HOOK_FOLDS may hold any more - every layer
 * resolves last-wins as of 2026-08-02 - but `observe` still names it, because a
 * fold that regressed to asking the earlier mod should fail this test saying
 * exactly that rather than saying "not last-answer".
 *
 * TypeScript already forces a row per `keyof ModHooks`; this forces the row to
 * be true.
 */
describe("MOD_HOOK_FOLDS describes what composeModHooks actually does", () => {
  /** Two contributors for one hook, plus how to call the composed result. */
  interface Probe {
    /** A contributor that answers positively, tagged so calls can be traced. */
    yes: (log: string[], tag: string, nth: number) => ModHooks;
    /** A contributor with no opinion / a refusal. */
    no: (log: string[], tag: string) => ModHooks;
    /** Invoke the composed hook and return its answer. */
    run: (h: ModHooks) => unknown;
  }

  const PROBES: Record<keyof ModHooks, Probe> = {
    walkBlockedByDiggable: {
      /* Distinct answers, so an order-dependent fold is visible in the value. */
      yes: (log, tag, nth) => ({
        walkBlockedByDiggable: () => {
          log.push(tag);
          return 100 * nth;
        },
      }),
      no: (log, tag) => ({
        walkBlockedByDiggable: () => {
          log.push(tag);
          return null;
        },
      }),
      run: (h) => h.walkBlockedByDiggable?.(STATE, GRID, DEPS),
    },
    objectListTiebreak: {
      yes: (log, tag, nth) => ({
        objectListTiebreak: () => {
          log.push(tag);
          return nth;
        },
      }),
      no: (log, tag) => ({
        objectListTiebreak: () => {
          log.push(tag);
          return 0;
        },
      }),
      run: (h) => h.objectListTiebreak?.({ dy: 0, dx: 0 }, { dy: 0, dx: 0 }),
    },
    levelGenerated: {
      yes: (log, tag) => ({
        levelGenerated: () => {
          log.push(tag);
          return true;
        },
      }),
      no: (log, tag) => ({
        levelGenerated: () => {
          log.push(tag);
          return false;
        },
      }),
      run: (h) => h.levelGenerated?.({}, false),
    },
    artifactCommit: {
      yes: (log, tag) => ({
        artifactCommit: () => {
          log.push(tag);
          return true;
        },
      }),
      no: (log, tag) => ({
        artifactCommit: () => {
          log.push(tag);
          return false;
        },
      }),
      run: (h) => h.artifactCommit?.(1, false),
    },
    historyAdd: {
      yes: (log, tag) => ({
        historyAdd: () => {
          log.push(tag);
          return true;
        },
      }),
      no: (log, tag) => ({
        historyAdd: () => {
          log.push(tag);
          return false;
        },
      }),
      run: (h) => h.historyAdd?.({ what: "x", type: 0, duplicate: false }),
    },
    saveNoiseScent: {
      yes: (log, tag) => ({
        saveNoiseScent: () => {
          log.push(tag);
          return true;
        },
      }),
      no: (log, tag) => ({
        saveNoiseScent: () => {
          log.push(tag);
          return false;
        },
      }),
      run: (h) => h.saveNoiseScent?.(),
    },
    messageText: {
      yes: (log, tag) => ({
        messageText: (raw) => {
          log.push(tag);
          return raw + tag;
        },
      }),
      no: (log, tag) => ({
        messageText: (raw) => {
          log.push(tag);
          return raw;
        },
      }),
      run: (h) => h.messageText?.("x"),
    },
  };

  /** The fold `probe` exhibits, read off composeModHooks' actual behaviour. */
  function observe(probe: Probe): string {
    const forward: string[] = [];
    const ab = probe.run(
      composeModHooks([probe.yes(forward, "a", 1), probe.yes(forward, "b", 2)]) as ModHooks,
    );
    const backward: string[] = [];
    const ba = probe.run(
      composeModHooks([probe.yes(backward, "b", 2), probe.yes(backward, "a", 1)]) as ModHooks,
    );

    if (!Object.is(ab, ba)) {
      if (forward.length !== 1) return "chained";
      /* One contributor ran and the other was never asked. WHICH one ran is the
       * entire difference between the two order-dependent folds, and it is the
       * half a table can get wrong while still looking right: "a" was passed to
       * composeModHooks first, so seeing "b" here means the fold asked in
       * reverse load order and the later mod decided. */
      return forward[0] === "b" ? "last-answer" : "first-answer";
    }

    const log: string[] = [];
    const mixed = probe.run(
      composeModHooks([probe.yes(log, "a", 1), probe.no(log, "b")]) as ModHooks,
    );
    return mixed === false ? "all-must-agree" : "any-yes";
  }

  for (const hook of Object.keys(PROBES) as (keyof ModHooks)[]) {
    it(`${hook} folds as ${MOD_HOOK_FOLDS[hook]}`, () => {
      expect(observe(PROBES[hook])).toBe(MOD_HOOK_FOLDS[hook]);
    });
  }

  it("covers every hook, so a new one cannot be added without a fold", () => {
    /* The compiler enforces this for MOD_HOOK_FOLDS; this enforces it for the
     * probe table, which is the half TypeScript cannot see is incomplete. */
    expect(Object.keys(PROBES).sort()).toEqual(Object.keys(MOD_HOOK_FOLDS).sort());
  });
});

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
