/**
 * object_to_hit / object_to_dam include the ACTIVE CURSES' template bonuses
 * (reference/src/obj-util.c:296-326).
 *
 * The port returned obj.toH / obj.toD alone until 2026-08-04, and the comment
 * excusing it said "no object carries curses through combat yet" - which had
 * stopped being true: GameObject.curses is real and applyCurse fills it during
 * generation. Three SHIPPED curses carry a combat penalty (enveloping -5/-5,
 * irritation -15/-15, air swing -20/0), so this was a live to-hit and damage
 * error on a cursed weapon, not a latent one.
 *
 * GROUND TRUTH COMES FROM THE PACK, not from a hand-written curse: the test
 * finds a curse whose template really does carry to_h or to_d and asserts the
 * value the bound registry holds. A fixture curse of my own would only have
 * proved the arithmetic I had just written.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson, Curse, ObjectKind } from "../obj/types.js";
import { objectNew } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import { objectToDam, objectToHit } from "./brand-slay.js";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  );
}

const objReg = new ObjRegistry({
  objectBase: load("object_base"),
  object: load("object"),
  egoItem: load("ego_item"),
  artifact: load("artifact"),
  curse: load("curse"),
  brand: load("brand"),
  slay: load("slay"),
  activation: load("activation"),
  objectProperty: load("object_property"),
  flavor: load("flavor"),
} as ObjPackJson);

const curses = objReg.curses;
const kind = objReg.kinds.find((k): k is ObjectKind => !!k) as ObjectKind;

/*
 * ONE INDEX PER TERM. A single "first curse with any combat term" index picks
 * `air swing` (to_h -20, to_d 0), which made the to-dam assertion below read
 * `expect(4).toBe(4 + 0)` - true, and unable to disagree with anything. Found
 * on 2026-08-07 by a surviving mutant while wiring the same fix into the ranged
 * path; the melee assertion had been decorative since this file was written.
 */
const hitCurseIdx = curses.findIndex((c, i) => i > 0 && c !== null && c.obj.toH !== 0);
const damCurseIdx = curses.findIndex((c, i) => i > 0 && c !== null && c.obj.toD !== 0);
const hitCurse = curses[hitCurseIdx] as Curse;
const damCurse = curses[damCurseIdx] as Curse;

function cursedWeapon(idx: number, power = 10): GameObject {
  const o = objectNew(kind);
  o.toH = 3;
  o.toD = 4;
  o.curses = [];
  for (let i = 0; i < curses.length; i++) o.curses[i] = { power: 0, timeout: 0 };
  o.curses[idx] = { power, timeout: 0 };
  return o;
}

describe("object_to_hit / object_to_dam curse terms", () => {
  it("the shipped data has a curse for EACH term asserted below", () => {
    /* If this ever fails the pack changed, and the tests below would be vacuous
     * rather than wrong - which is the failure mode worth catching loudly. */
    expect(hitCurseIdx).toBeGreaterThan(0);
    expect(hitCurse.obj.toH).not.toBe(0);
    expect(damCurseIdx).toBeGreaterThan(0);
    expect(damCurse.obj.toD).not.toBe(0);
  });

  it("adds the curse template to_h when the curse is active", () => {
    const o = cursedWeapon(hitCurseIdx);
    expect(objectToHit(o, curses)).toBe(3 + hitCurse.obj.toH);
  });

  it("adds the curse template to_d when the curse is active", () => {
    const o = cursedWeapon(damCurseIdx);
    expect(objectToDam(o, curses)).toBe(4 + damCurse.obj.toD);
  });

  it("ignores a curse with zero power (obj->curses[i].power gate)", () => {
    const o = cursedWeapon(damCurseIdx, 0);
    expect(objectToHit(o, curses)).toBe(3);
    expect(objectToDam(o, curses)).toBe(4);
  });

  it("returns the object's own bonus when no curse table is supplied", () => {
    const o = cursedWeapon(damCurseIdx);
    expect(objectToHit(o)).toBe(3);
    expect(objectToDam(o)).toBe(4);
  });

  it("skips index 0, which upstream leaves null", () => {
    const o = cursedWeapon(hitCurseIdx);
    (o.curses as NonNullable<typeof o.curses>)[0] = { power: 99, timeout: 0 };
    expect(objectToHit(o, curses)).toBe(3 + hitCurse.obj.toH);
  });

  it("sums every active curse, not just the first", () => {
    const others = curses
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => i > 0 && c !== null && (c.obj.toH !== 0 || c.obj.toD !== 0));
    if (others.length < 2) return;
    const [a, b] = others as [{ c: Curse | null; i: number }, { c: Curse | null; i: number }];
    const o = cursedWeapon(a.i);
    (o.curses as NonNullable<typeof o.curses>)[b.i] = { power: 10, timeout: 0 };
    expect(objectToHit(o, curses)).toBe(
      3 + (a.c as Curse).obj.toH + (b.c as Curse).obj.toH,
    );
  });
});

describe("the live melee path threads the curse table", () => {
  /* Structural, and deliberately so: the seam is optional, and an optional seam
   * nobody passes is a no-op that every unit test still passes. These two call
   * sites are the whole live player-melee surface. */
  const src = (rel: string): string =>
    readFileSync(new URL(rel, import.meta.url), "utf8");

  it("game/effect-melee.ts passes state.curses to pyAttackReal", () => {
    expect(src("../game/effect-melee.ts")).toMatch(/curses: state\.curses,/u);
  });

  it("game/player-turn.ts passes state.curses to pyAttack", () => {
    expect(src("../game/player-turn.ts")).toMatch(/curses: state\.curses,/u);
  });

  it("the session fills GameState.curses from the bound registry", () => {
    expect(src("../session/game.ts")).toMatch(/curses: reg\.objects\.curses,/u);
  });

  /*
   * The RANGED path was left out when melee was fixed on 2026-08-04, and the
   * seam being an optional trailing argument is exactly why nothing noticed:
   * every unit test passed while a cursed bow's penalty never reached a shot.
   * combat/ranged.test.ts asserts the behaviour; this asserts the call site,
   * because that is the half that was missing.
   */
  it("game/ranged-cmd.ts passes state.curses to makeRangedShot / Throw", () => {
    const body = src("../game/ranged-cmd.ts");
    expect(body).toMatch(/makeRangedThrow\(/u);
    expect(body).toMatch(/makeRangedShot\(/u);
    /* One per call, and no more call sites than supplied arguments. */
    const calls = (body.match(/makeRanged(Shot|Throw)\(/gu) ?? []).length;
    const supplied = (body.match(/^\s*state\.curses,$/gmu) ?? []).length;
    expect(supplied).toBe(calls);
  });
});
