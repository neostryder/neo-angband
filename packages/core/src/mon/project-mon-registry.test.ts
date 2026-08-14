/**
 * Gap row 7: MONSTER_HANDLERS, the FOURTH projection side.
 *
 * project_f, project_o and project_p became code-keyed registries in August
 * 2026 and got a producer with them. project_m did not, so a mod adding
 * PROJ.SOULFIRE could burn terrain, burn floor items and hurt the player, and
 * did literally nothing to a monster: the table was a frozen 56-slot ARRAY
 * indexed by PROJ value, and a mod's projection is appended at index 56.
 *
 * This file proves the rekey is faithful - the same 56 handlers, the same
 * function objects, agreeing in BOTH directions with the array they came from.
 * That the registry actually reaches a live projection is a separate claim with
 * a separate file (session/projection-registry-wiring.test.ts), because
 * "converted" and "reachable" are the two halves this gap has been burned by.
 */

import { describe, expect, it } from "vitest";
import { PROJ } from "../generated/index.js";
import { CORE_PROJECTION_COUNT } from "../world/projection.js";
import {
  MONSTER_HANDLERS,
  MONSTER_HANDLERS_BY_CODE,
  newMonProjectContext,
  runMonsterHandler,
} from "./project-mon.js";
import type { MonHandler, MonProjectContext } from "./project-mon.js";
import { Rng } from "../rng.js";
import type { Monster } from "./monster.js";

function fakeMonster(): Monster {
  /* Only the fields the dispatch path touches; no handler runs in the tests
   * that use this, they only observe WHICH handler was selected. */
  return { hp: 100 } as unknown as Monster;
}

function ctxFor(typ: number): MonProjectContext {
  return newMonProjectContext(new Rng(1), fakeMonster(), typ, 10, {
    originIsMonster: false,
    r: 0,
    grid: { y: 1, x: 1 },
    charm: false,
    healthTracked: false,
    seen: true,
    obvious: false,
    hooks: {},
  });
}

describe("MONSTER_HANDLERS_BY_CODE is the same table, rekeyed", () => {
  it("has one entry per compiled PROJ slot, and all 56 are non-null", () => {
    expect({
      slots: MONSTER_HANDLERS.length,
      byCode: MONSTER_HANDLERS_BY_CODE.size,
      coreCount: CORE_PROJECTION_COUNT,
      nulls: MONSTER_HANDLERS.filter((h) => h === null).length,
    }).toEqual({ slots: 56, byCode: 56, coreCount: 56, nulls: 0 });
  });

  it("code -> handler agrees with index -> handler, by IDENTITY, both ways", () => {
    /* Both directions, because a map that merely has 56 entries could still be
     * off by a slot: the enum's numeric order and the array's assignment order
     * are two different things, and it is exactly that mismatch a rekey gets
     * wrong. Identity, not equality, so a wrapper cannot pass. */
    const wrong: string[] = [];
    for (const [code, index] of Object.entries(PROJ)) {
      if (MONSTER_HANDLERS_BY_CODE.get(code) !== MONSTER_HANDLERS[index]) {
        wrong.push(`${code}@${String(index)}`);
      }
    }
    expect(wrong).toEqual([]);

    const orphans: number[] = [];
    for (let i = 0; i < MONSTER_HANDLERS.length; i++) {
      const handler = MONSTER_HANDLERS[i];
      if (![...MONSTER_HANDLERS_BY_CODE.values()].includes(handler!)) orphans.push(i);
    }
    expect(orphans).toEqual([]);
  });

  it("shares handlers exactly where the array does (METEOR/MISSILE/MANA/ARROW)", () => {
    /* Four slots point at the same hNoop in the array. The rekeyed map must
     * point at the same one object too, or a mod wrapping ARROW would silently
     * wrap MISSILE as well - or fail to. */
    const noop = MONSTER_HANDLERS[PROJ.METEOR];
    for (const code of ["METEOR", "MISSILE", "MANA", "ARROW"]) {
      expect({ code, same: MONSTER_HANDLERS_BY_CODE.get(code) === noop }).toEqual({
        code,
        same: true,
      });
    }
  });
});

describe("runMonsterHandler dispatch", () => {
  it("CONTROL: with no env it is the indexed dispatch, unchanged", () => {
    const ctx = ctxFor(PROJ.MON_CRUSH);
    ctx.dam = 10;
    ctx.mon.hp = 100; // hp >= dam -> hMonCrush marks it skipped
    runMonsterHandler(ctx);
    expect({ skipped: ctx.skipped, dam: ctx.dam }).toEqual({ skipped: true, dam: 0 });
  });

  it("dispatches by CODE when the live table is supplied", () => {
    const ran: string[] = [];
    const table = new Map<string, MonHandler>([
      ["FIRE", (c): void => void ran.push(`FIRE:${String(c.dam)}`)],
    ]);
    const ctx = ctxFor(PROJ.FIRE);
    runMonsterHandler(ctx, { code: "FIRE", monHandlers: table });
    expect(ran).toEqual(["FIRE:10"]);
  });

  it("a code with no handler is a no-op, as upstream's NULL guard is", () => {
    const ctx = ctxFor(56);
    const before = { ...ctx };
    runMonsterHandler(ctx, { code: "SOULFIRE", monHandlers: new Map() });
    expect(ctx.dam).toBe(before.dam);
    expect(ctx.skipped).toBe(before.skipped);
  });

  it("an unresolvable code runs nothing, rather than falling back to the index", () => {
    /* The fallback would be the subtle bug: a mod's PROJ value indexes past
     * the 56-slot array today (undefined, harmless), but a code that fails to
     * resolve while a table IS wired must not quietly run some other slot. */
    const ctx = ctxFor(PROJ.MON_CRUSH);
    ctx.dam = 10;
    ctx.mon.hp = 100;
    runMonsterHandler(ctx, {
      code: undefined,
      monHandlers: MONSTER_HANDLERS_BY_CODE,
    });
    expect({ skipped: ctx.skipped, dam: ctx.dam }).toEqual({ skipped: false, dam: 10 });
  });
});
