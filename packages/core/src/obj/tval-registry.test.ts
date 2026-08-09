/**
 * The tval registry's own checks: that core seeded it, that a mod can wrap it,
 * and that it cannot silently fall behind `object.ts`.
 *
 * Behaviour parity is `tval-vectors.test.ts`'s job - 1,224 predicate answers
 * and 389 real object kinds, recorded before this registry existed. What is
 * here is the seam itself.
 */

import { afterEach, describe, expect, it } from "vitest";

import { KF } from "../generated/index.js";
import { TV } from "../generated/tvals.js";
import { kindIsGood } from "./make.js";
import { tvalIsBook, tvalIsWeapon } from "./object.js";
import { tvalVectorRegistry } from "./tval-vectors.fixtures.js";
import { tvalPredicateNames } from "./tval-vectors.js";
import { resetTvalRegistry, tvalInClass, tvalRegistry } from "./tval-registry.js";
import { objectValueBase } from "./value.js";
import type { GameObject } from "./object.js";
import type { ObjectKind } from "./types.js";

/** A tval beyond everything core defines - a mod's own. */
const MOD_TVAL = 200;

describe("the tval registry", () => {
  /* Module-level tables: restore core's arms so one test cannot leak into the
   * next. */
  afterEach(() => {
    resetTvalRegistry();
  });

  it("has an arm for every predicate object.ts exports", () => {
    /* THE CHECK THIS FILE EXISTS FOR. The table is keyed on the predicate's own
     * exported name, so this can be derived rather than listed - and a
     * predicate added to `object.ts` and forgotten here would otherwise answer
     * `false` for every tval in the game, forever, silently. That is exactly
     * the failure the registry was built to remove, so it must not be
     * reintroducible by adding a function. */
    const missing = tvalPredicateNames().filter(
      (name) => !tvalRegistry().classes.has(name),
    );
    expect(missing).toEqual([]);

    /* And nothing extra: a stale arm under a name nothing calls is dead code
     * wearing a seam's clothes. */
    expect([...tvalRegistry().classes.keys()].sort()).toEqual([
      ...tvalPredicateNames(),
    ]);
  });

  it("a mod widens a class by WRAPPING, and core's answers survive", () => {
    expect(tvalIsWeapon(MOD_TVAL)).toBe(false);
    expect(tvalIsWeapon(TV.SWORD)).toBe(true);

    const inner = tvalRegistry().classes.handlerFor("tvalIsWeapon")!;
    tvalRegistry().classes.set(
      "tvalIsWeapon",
      (tval) => tval === MOD_TVAL || inner(tval),
    );

    expect(tvalIsWeapon(MOD_TVAL)).toBe(true);
    /* Composed, not shadowed - a mod that reimplemented the arm from scratch
     * and forgot a tval would fail here. */
    expect(tvalIsWeapon(TV.SWORD)).toBe(true);
    expect(tvalIsBook(MOD_TVAL)).toBe(false);
  });

  it("an unregistered class name answers no rather than throwing", () => {
    /* A mod may ask about a class core has never heard of. Answering `false` is
     * the honest result; throwing would make a mod's own vocabulary a crash. */
    expect(tvalInClass("modIsCursedRelic", TV.SWORD)).toBe(false);
  });

  it("a mod's item class can be good and can be worth something", () => {
    const reg = tvalVectorRegistry();
    const kind = { ...reg.kinds.find((k) => k.tval === TV.POTION)! };
    kind.tval = MOD_TVAL;

    /* BEFORE, and this is the silent failure the seam removes: `kindIsGood`
     * falls through to the KF_GOOD flag alone, so the class can never be good
     * on the strength of its own plusses, and an unaware item of an unknown
     * class is priced at ZERO - a shop shows it as litter. The chosen base
     * kind carries no KF_GOOD, asserted rather than assumed. */
    expect(kind.kindFlags.has(KF.GOOD)).toBe(false);
    expect({
      good: kindIsGood(kind as ObjectKind),
      value: objectValueBase(
        { tval: MOD_TVAL, kind } as unknown as GameObject,
        false,
      ),
    }).toEqual({ good: false, value: 0 });

    tvalRegistry().good.set(MOD_TVAL, () => true);
    tvalRegistry().valueBase.set(MOD_TVAL, () => 33);

    expect({
      good: kindIsGood(kind as ObjectKind),
      value: objectValueBase(
        { tval: MOD_TVAL, kind } as unknown as GameObject,
        false,
      ),
    }).toEqual({ good: true, value: 33 });
  });

  it("reset drops a mod's registrations and restores core's", () => {
    tvalRegistry().classes.set("tvalIsWeapon", () => true);
    expect(tvalIsWeapon(MOD_TVAL)).toBe(true);
    resetTvalRegistry();
    expect(tvalIsWeapon(MOD_TVAL)).toBe(false);
    expect(tvalIsWeapon(TV.SWORD)).toBe(true);
  });
});
