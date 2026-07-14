import { describe, expect, it } from "vitest";
import { FlavorKnowledge, type FlavorAwareDeps } from "./knowledge";
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
