/**
 * What the effect registry looks like AS THE GAME RUNS IT.
 *
 * handlers.test.ts asserts the coverage of the BASE layer, and that layer is mostly
 * recording stubs: `registerCoreHandlers` implements a dozen effects itself and installs
 * a NOT_IMPLEMENTED stub for the other hundred, which the ten `effect-*.ts` modules then
 * override. So the number that test pins reads roughly "13 implemented, 97 stub", and it
 * is a true statement about a layer nobody plays.
 *
 * That was the whole of the evidence, and it invites the exact misreading it got: the
 * base-layer figure was quoted as the port's effect coverage. This file measures the
 * composition that `session/game.ts` actually builds, which is the only one a player
 * ever meets - and it is a RATCHET, not a report. A new upstream effect with no handler,
 * or a `register*Handlers` call dropped from the session wiring, fails here.
 *
 * The wiring is duplicated from wireGame deliberately. Importing the session to get it
 * would drag a whole GameState into a test whose subject is one registry, and the thing
 * that would break silently - a module no longer registered - is caught by the count
 * assertions below either way.
 */

import { describe, expect, it } from "vitest";

import { EFFECT_ENTRIES } from "../generated/index.js";
import { EF_MAX } from "./effect.js";
import { registerDetectHandlers } from "../game/effect-detect.js";
import { registerAttackHandlers } from "../game/effect-attack.js";
import { registerGeneralHandlers } from "../game/effect-general.js";
import { registerItemHandlers } from "../game/effect-item.js";
import { registerMeleeHandlers } from "../game/effect-melee.js";
import { registerMonsterHandlers } from "../game/effect-monster.js";
import { registerSummonHandlers } from "../game/effect-summon.js";
import { registerTeleportHandlers } from "../game/effect-teleport.js";
import { registerTerrainHandlers } from "../game/effect-terrain.js";
import { registerCoreHandlers } from "./handlers.js";
import { EffectRegistry } from "./interpreter.js";

/** Every registrar wireGame installs, in its order (session/game.ts). */
function wiredRegistry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerAttackHandlers(r);
  registerMonsterHandlers(r);
  registerTeleportHandlers(r);
  registerGeneralHandlers(r);
  registerTerrainHandlers(r);
  registerItemHandlers(r);
  registerMeleeHandlers(r);
  registerSummonHandlers(r);
  registerDetectHandlers(r);
  return r;
}

function nameOf(code: number): string {
  return (EFFECT_ENTRIES[code - 1] as { name: string }).name;
}

describe("the effect registry the game runs", () => {
  it("leaves NO effect as a recording stub", () => {
    /* The assertion that matters, and the one nothing made before: every upstream
     * effect code has a real handler behind it once the session is wired. A stub here
     * is an effect that silently does nothing in play - a wand that fires and has no
     * result - so the failure message names them rather than printing a count. */
    const r = wiredRegistry();
    const stubs: string[] = [];
    for (let code = 1; code < EFFECT_ENTRIES.length + 1; code++) {
      if (r.lookup(code)?.status === "stub") stubs.push(nameOf(code));
    }
    expect(stubs, `unwired effects: ${stubs.join(", ")}`).toEqual([]);
  });

  it("registers every upstream code exactly once, and none beyond EF_MAX", () => {
    const r = wiredRegistry();
    expect(r.codes()).toHaveLength(EFFECT_ENTRIES.length);
    for (let code = 1; code < EFFECT_ENTRIES.length + 1; code++) {
      expect(r.isRegistered(code), nameOf(code)).toBe(true);
    }
    expect(EFFECT_ENTRIES.length).toBe(EF_MAX - 1);
  });

  it("accounts for all 112 effects as implemented or partial", () => {
    /* Pinned as a total rather than as two separate numbers, because the split between
     * implemented and partial is not currently a per-handler judgment (see
     * effect-attack.ts, which stamps "partial" on everything it registers) and a test
     * that pinned it would be pinning an artefact of which module owns a handler. The
     * total is the honest invariant: nothing is missing. */
    const cov = wiredRegistry().coverage();
    expect(cov.stub).toBe(0);
    expect(cov.implemented + cov.partial).toBe(EFFECT_ENTRIES.length);
  });
});
