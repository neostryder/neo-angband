import { describe, expect, it } from "vitest";
import { FlavorKnowledge } from "./knowledge";
import type { ObjectKind } from "./types";

/** A minimal kind carrying just the index FlavorKnowledge keys on. */
const kindOf = (kidx: number): ObjectKind => ({ kidx }) as ObjectKind;

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
