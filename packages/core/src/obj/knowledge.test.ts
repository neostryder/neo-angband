import { describe, expect, it } from "vitest";
import {
  FlavorKnowledge,
  EverseenKnowledge,
  runeDesc,
  type FlavorAwareDeps,
} from "./knowledge";
import { Rng } from "../rng";
import type { ObjectKind } from "./types";

/** A minimal kind carrying just the index FlavorKnowledge keys on. */
const kindOf = (kidx: number): ObjectKind => ({ kidx }) as ObjectKind;

/**
 * A recording stand-in for the ignore/upkeep side effects object_flavor_aware
 * fires (obj-knowledge.c L2276-2279).
 */
function makeAwareDeps(ignoredUnaware: Set<number> = new Set()) {
  const awareIgnored: number[] = [];
  let noticeRequests = 0;
  const deps: FlavorAwareDeps = {
    isIgnoredUnaware: (kidx) => ignoredUnaware.has(kidx),
    ignoreWhenAware: (kidx) => awareIgnored.push(kidx),
    requestIgnoreNotice: () => {
      noticeRequests++;
    },
  };
  return {
    deps,
    awareIgnored,
    get noticeRequests() {
      return noticeRequests;
    },
  };
}

describe("FlavorKnowledge (obj-knowledge.c)", () => {
  it("tracks awareness per kind and is idempotent", () => {
    const fk = new FlavorKnowledge(100);
    const potion = kindOf(20);
    expect(fk.isAware(potion)).toBe(false);
    expect(fk.setAware(potion)).toBe(true);
    expect(fk.isAware(potion)).toBe(true);
    expect(fk.setAware(potion)).toBe(false);
    // A different kind is unaffected.
    expect(fk.isAware(kindOf(21))).toBe(false);
  });

  it("marks ordinary kinds tried but never artifacts", () => {
    const fk = new FlavorKnowledge(100);
    const ordinary = kindOf(20);
    fk.setTried(ordinary);
    expect(fk.wasTried(ordinary)).toBe(true);
    // kidx >= ordinaryKindCount is an INSTA_ART dummy; never marked.
    const artifact = kindOf(150);
    fk.setTried(artifact);
    expect(fk.wasTried(artifact)).toBe(false);
  });
});

describe("object_flavor_aware (obj-knowledge.c L2266)", () => {
  it("flips awareness so every like object's on-demand shadow reflects it", () => {
    const fk = new FlavorKnowledge(100);
    const potion = kindOf(20);
    const { deps } = makeAwareDeps();

    // Before: unaware. isAware is what objectSetBaseKnown / desc read per object,
    // so the shadow for ANY object of this kind resolves unaware here.
    expect(fk.isAware(potion)).toBe(false);

    expect(fk.objectFlavorAware(potion, deps)).toBe(true);

    // After: the shared aware bit is set once; there is no per-object twin to
    // sweep - the next shadow synthesis for gear/floor/store objects of this
    // kind reads the flipped bit. A second, distinct object of the same kind
    // therefore also reads aware, i.e. propagation is automatic.
    expect(fk.isAware(potion)).toBe(true);
    expect(fk.isAware(kindOf(20))).toBe(true);
  });

  it("is idempotent and only fires side effects on the first awareness", () => {
    const fk = new FlavorKnowledge(100);
    const potion = kindOf(20);
    const rec = makeAwareDeps();

    expect(fk.objectFlavorAware(potion, rec.deps)).toBe(true);
    expect(rec.noticeRequests).toBe(1);

    // Already aware: no change, no further ignore re-check requested.
    expect(fk.objectFlavorAware(potion, rec.deps)).toBe(false);
    expect(rec.noticeRequests).toBe(1);
  });

  it("carries the ignore bit over for a kind ignored while unaware", () => {
    const fk = new FlavorKnowledge(100);
    const ignoredWhileUnaware = kindOf(20);
    const plainKind = kindOf(21);

    const recIgnored = makeAwareDeps(new Set([20]));
    fk.objectFlavorAware(ignoredWhileUnaware, recIgnored.deps);
    expect(recIgnored.awareIgnored).toEqual([20]); // kind_ignore_when_aware
    expect(recIgnored.noticeRequests).toBe(1); // PN_IGNORE, unconditional

    // A kind that was NOT ignored while unaware keeps no ignore bit, but still
    // requests the re-check (PN_IGNORE is set outside the `if` upstream).
    const recPlain = makeAwareDeps(new Set());
    fk.objectFlavorAware(plainKind, recPlain.deps);
    expect(recPlain.awareIgnored).toEqual([]);
    expect(recPlain.noticeRequests).toBe(1);
  });

  it("is RNG-free: becoming aware does not touch the RNG stream", () => {
    const fk = new FlavorKnowledge(100);
    const rng = new Rng(12345);
    const before = rng.getState();

    fk.objectFlavorAware(kindOf(20), makeAwareDeps(new Set([20])).deps);
    fk.setAware(kindOf(21));

    expect(rng.getState()).toEqual(before);
  });
});

describe("EverseenKnowledge (object_kind/ego everseen, save.c L397/L533)", () => {
  const egoOf = (eidx: number) => ({ eidx }) as unknown as import("./types").EgoItem;

  it("tracks kind + ego everseen independently and is idempotent", () => {
    const ek = new EverseenKnowledge();
    const sword = kindOf(30);
    const ego = egoOf(7);
    expect(ek.kindSeen(sword)).toBe(false);
    expect(ek.egoSeen(ego)).toBe(false);
    ek.markKind(sword);
    ek.markEgo(ego);
    ek.markKind(sword); // idempotent
    expect(ek.kindSeen(sword)).toBe(true);
    expect(ek.egoSeen(ego)).toBe(true);
    // A kidx and an eidx of the same numeric value do not alias each other.
    expect(ek.kindSeen(kindOf(7))).toBe(false);
    expect(ek.egoSeen(egoOf(30))).toBe(false);
  });

  it("snapshot/restore round-trips the seen sets", () => {
    const ek = new EverseenKnowledge();
    ek.markKind(kindOf(1));
    ek.markKind(kindOf(2));
    ek.markEgo(egoOf(9));
    const snap = ek.snapshot();
    const restored = new EverseenKnowledge();
    restored.restore(snap);
    expect(restored.kindSeen(kindOf(1))).toBe(true);
    expect(restored.kindSeen(kindOf(2))).toBe(true);
    expect(restored.egoSeen(egoOf(9))).toBe(true);
    expect(restored.kindSeen(kindOf(3))).toBe(false);
  });

  it("is RNG-free: marking does not touch the RNG stream", () => {
    const ek = new EverseenKnowledge();
    const rng = new Rng(999);
    const before = rng.getState();
    ek.markKind(kindOf(5));
    ek.markEgo(egoOf(5));
    expect(rng.getState()).toEqual(before);
  });
});

describe("runeDesc (obj-knowledge.c L344-403)", () => {
  const env = {
    curses: [null, { desc: "makes you hungry" }],
  } as unknown as import("./knowledge").RuneEnv;

  it("renders the fixed combat strings by index", () => {
    expect(runeDesc(env, { variety: "combat", index: 0, name: "x" })).toBe(
      "Object magically increases the player's armor class",
    );
    expect(runeDesc(env, { variety: "combat", index: 1, name: "x" })).toBe(
      "Object magically increases the player's chance to hit",
    );
    expect(runeDesc(env, { variety: "combat", index: 2, name: "x" })).toBe(
      "Object magically increases the player's damage",
    );
  });

  it("substitutes the rune name into the per-variety templates", () => {
    expect(runeDesc(env, { variety: "mod", index: 0, name: "strength" })).toBe(
      "Object gives the player a magical bonus to strength.",
    );
    expect(runeDesc(env, { variety: "resist", index: 0, name: "fire" })).toBe(
      "Object affects the player's resistance to fire.",
    );
    expect(runeDesc(env, { variety: "brand", index: 1, name: "fire" })).toBe(
      "Object brands the player's attacks with fire.",
    );
    expect(runeDesc(env, { variety: "slay", index: 1, name: "orcs" })).toBe(
      "Object makes the player's attacks against orcs more powerful.",
    );
    expect(runeDesc(env, { variety: "flag", index: 1, name: "free action" })).toBe(
      "Object gives the player the property of free action.",
    );
  });

  it("reads the curse desc for a curse rune (Object %s.)", () => {
    expect(runeDesc(env, { variety: "curse", index: 1, name: "x" })).toBe(
      "Object makes you hungry.",
    );
  });
});
