/**
 * Upstream unit tests from reference/src/tests/player/util.c
 *
 * NOTE the filename: upstream has two `tests/.../util.c` files. This is the
 * PLAYER one; the object one is game/obj-util.upstream.test.ts.
 *
 * Mapping:
 *   player_adjust_hp_precise  -> playerAdjustHpPrecise  (game/loop.ts)
 *   player_adjust_mana_precise -> playerAdjustManaPrecise (game/loop.ts)
 *
 * Upstream also asserts PR_HP / PR_MANA redraw bits when the whole part of
 * chp/csp changes. The port has no redraw mask on Player; we assert the same
 * predicate (chp/csp whole-part changed) as the observable "signaled" flag.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindPlayer } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { playerAdjustHpPrecise, playerAdjustManaPrecise } from "./loop";

function packJson<T>(name: string): T[] {
  return (
    JSON.parse(
      readFileSync(
        new URL(`../../../content/pack/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as { records: T[] }
  ).records;
}

const reg = bindPlayer({
  races: packJson("p_race"),
  classes: packJson("class"),
  properties: packJson("player_property"),
  timed: packJson("player_timed"),
  shapes: packJson("shape"),
  bodies: packJson("body"),
  history: packJson("history"),
  realms: packJson("realm"),
});

function makeP(): Player {
  const race = reg.races[0]!;
  const cls = reg.classes[0]!;
  return blankPlayer(race, cls, reg.bodies[race.body]!);
}

const INT16_MAX = 32767;
const INT16_MIN = -32768;

describe("player/util (reference/src/tests/player/util.c)", () => {
  // upstream: test_adjust_hp_precise
  it("adjust_hp_precise", () => {
    type Case = {
      currIn: number;
      fracIn: number;
      maxIn: number;
      gainIn: number;
      currOut: number;
      fracOut: number;
      signaledOut: boolean;
    };
    const cases: Case[] = [
      /* Check adding zero. */
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 0, currOut: 0, fracOut: 0, signaledOut: false },
      { currIn: 0, fracIn: 891, maxIn: 50, gainIn: 0, currOut: 0, fracOut: 891, signaledOut: false },
      { currIn: 5, fracIn: 0, maxIn: 50, gainIn: 0, currOut: 5, fracOut: 0, signaledOut: false },
      { currIn: 15, fracIn: 750, maxIn: 50, gainIn: 0, currOut: 15, fracOut: 750, signaledOut: false },
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: 0, currOut: -10, fracOut: 0, signaledOut: false },
      { currIn: -12, fracIn: 131, maxIn: 50, gainIn: 0, currOut: -12, fracOut: 131, signaledOut: false },
      /* Check adding to zero hp. */
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 65536, currOut: 1, fracOut: 0, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 7561, currOut: 0, fracOut: 7561, signaledOut: false },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 262222, currOut: 4, fracOut: 78, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 3276800, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 3302230, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 3932160, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: -37, currOut: -1, fracOut: 65499, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: -131072, currOut: -2, fracOut: 0, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: -196533, currOut: -3, fracOut: 75, signaledOut: true },
      /* Check adding to a positive fraction but no whole part. */
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 196608, currOut: 3, fracOut: 1034, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 5345, currOut: 0, fracOut: 6379, signaledOut: false },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 64504, currOut: 1, fracOut: 2, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 64502, currOut: 1, fracOut: 0, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 262222, currOut: 4, fracOut: 1112, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 3275766, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 3276800, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 3302230, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 3604480, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: -997, currOut: 0, fracOut: 37, signaledOut: false },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: -2048, currOut: -1, fracOut: 64522, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: -262144, currOut: -4, fracOut: 1034, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: -324263, currOut: -5, fracOut: 4451, signaledOut: true },
      /* Check adding to a positive fraction and whole part. */
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 262144, currOut: 49, fracOut: 45637, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 75, currOut: 45, fracOut: 45712, signaledOut: false },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 19899, currOut: 46, fracOut: 0, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 21000, currOut: 46, fracOut: 1101, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 282040, currOut: 49, fracOut: 65533, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 282043, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 283000, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 458822, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -4512, currOut: 45, fracOut: 41125, signaledOut: false },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -45637, currOut: 45, fracOut: 0, signaledOut: false },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -59331, currOut: 44, fracOut: 51842, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -393216, currOut: 39, fracOut: 45637, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -462233, currOut: 38, fracOut: 42156, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -2994757, currOut: 0, fracOut: 0, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -2995000, currOut: -1, fracOut: 65293, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -3060293, currOut: -1, fracOut: 0, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -3932160, currOut: -15, fracOut: 45637, signaledOut: true },
      /* Check adding to a negative value with no fractional part. */
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: 567, currOut: -10, fracOut: 567, signaledOut: false },
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: 65536, currOut: -9, fracOut: 0, signaledOut: true },
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: 128701, currOut: -9, fracOut: 63165, signaledOut: true },
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: 655360, currOut: 0, fracOut: 0, signaledOut: true },
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: 658360, currOut: 0, fracOut: 3000, signaledOut: true },
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: 796888, currOut: 2, fracOut: 10456, signaledOut: true },
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: -1, currOut: -11, fracOut: 65535, signaledOut: true },
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: -65536, currOut: -11, fracOut: 0, signaledOut: true },
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: -172827, currOut: -13, fracOut: 23781, signaledOut: true },
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: 3932160, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: -10, fracIn: 0, maxIn: 50, gainIn: 3933160, currOut: 50, fracOut: 0, signaledOut: true },
      /* Check adding to a negative value with a fractional part. */
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: 3871, currOut: -8, fracOut: 57342, signaledOut: false },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: 12065, currOut: -7, fracOut: 0, signaledOut: true },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: 65536, currOut: -7, fracOut: 53471, signaledOut: true },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: 470817, currOut: 0, fracOut: 0, signaledOut: true },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: 473817, currOut: 0, fracOut: 3000, signaledOut: true },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: 655360, currOut: 2, fracOut: 53471, signaledOut: true },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: 3747617, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: 3751617, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: 3932160, currOut: 50, fracOut: 0, signaledOut: true },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: -198, currOut: -8, fracOut: 53273, signaledOut: false },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: -53471, currOut: -8, fracOut: 0, signaledOut: false },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: -60000, currOut: -9, fracOut: 59007, signaledOut: true },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: -131072, currOut: -10, fracOut: 53471, signaledOut: true },
      { currIn: -8, fracIn: 53471, maxIn: 50, gainIn: -201708, currOut: -11, fracOut: 48371, signaledOut: true },
      /* Check overflow handling. */
      {
        currIn: INT16_MAX,
        fracIn: 0,
        maxIn: INT16_MAX,
        gainIn: 100000,
        currOut: INT16_MAX,
        fracOut: 0,
        signaledOut: false,
      },
      {
        currIn: INT16_MAX,
        fracIn: 65535,
        maxIn: 50,
        gainIn: 10,
        currOut: 50,
        fracOut: 0,
        signaledOut: true,
      },
      {
        currIn: INT16_MIN,
        fracIn: 0,
        maxIn: 50,
        gainIn: -131072,
        currOut: INT16_MIN,
        fracOut: 0,
        signaledOut: false,
      },
    ];

    const p = makeP();
    for (const c of cases) {
      p.chp = c.currIn;
      p.chpFrac = c.fracIn;
      p.mhp = c.maxIn;
      const oldChp = p.chp;
      playerAdjustHpPrecise(p, c.gainIn);
      expect(p.chp).toBe(c.currOut);
      expect(p.chpFrac).toBe(c.fracOut);
      expect(p.mhp).toBe(c.maxIn);
      expect(p.chp !== oldChp).toBe(c.signaledOut);
    }
  });

  // upstream: test_adjust_sp_precise
  it("adjust_sp_precise", () => {
    type Case = {
      currIn: number;
      fracIn: number;
      maxIn: number;
      gainIn: number;
      currOut: number;
      fracOut: number;
      rtn: number;
      signaledOut: boolean;
    };
    const cases: Case[] = [
      /* Check adding zero. */
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 0, currOut: 0, fracOut: 0, rtn: 0, signaledOut: false },
      { currIn: 0, fracIn: 891, maxIn: 50, gainIn: 0, currOut: 0, fracOut: 891, rtn: 0, signaledOut: false },
      { currIn: 5, fracIn: 0, maxIn: 50, gainIn: 0, currOut: 5, fracOut: 0, rtn: 0, signaledOut: false },
      { currIn: 15, fracIn: 750, maxIn: 50, gainIn: 0, currOut: 15, fracOut: 750, rtn: 0, signaledOut: false },
      /* Check adding to zero spell points. */
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 65536, currOut: 1, fracOut: 0, rtn: 65536, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 7561, currOut: 0, fracOut: 7561, rtn: 7561, signaledOut: false },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 262222, currOut: 4, fracOut: 78, rtn: 262222, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 3276800, currOut: 50, fracOut: 0, rtn: 3276800, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 3302230, currOut: 50, fracOut: 0, rtn: 3276800, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: 3932160, currOut: 50, fracOut: 0, rtn: 3276800, signaledOut: true },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: -37, currOut: 0, fracOut: 0, rtn: 0, signaledOut: false },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: -131072, currOut: 0, fracOut: 0, rtn: 0, signaledOut: false },
      { currIn: 0, fracIn: 0, maxIn: 50, gainIn: -196533, currOut: 0, fracOut: 0, rtn: 0, signaledOut: false },
      /* Check adding to a positive fraction but no whole part. */
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 196608, currOut: 3, fracOut: 1034, rtn: 196608, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 5345, currOut: 0, fracOut: 6379, rtn: 5345, signaledOut: false },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 64504, currOut: 1, fracOut: 2, rtn: 64504, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 64502, currOut: 1, fracOut: 0, rtn: 64502, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 262222, currOut: 4, fracOut: 1112, rtn: 262222, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 3275766, currOut: 50, fracOut: 0, rtn: 3275766, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 3276800, currOut: 50, fracOut: 0, rtn: 3275766, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 3302230, currOut: 50, fracOut: 0, rtn: 3275766, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: 3604480, currOut: 50, fracOut: 0, rtn: 3275766, signaledOut: true },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: -997, currOut: 0, fracOut: 37, rtn: -997, signaledOut: false },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: -2048, currOut: 0, fracOut: 0, rtn: -1034, signaledOut: false },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: -262144, currOut: 0, fracOut: 0, rtn: -1034, signaledOut: false },
      { currIn: 0, fracIn: 1034, maxIn: 50, gainIn: -324263, currOut: 0, fracOut: 0, rtn: -1034, signaledOut: false },
      /* Check adding to a positive fraction and whole part. */
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 262144, currOut: 49, fracOut: 45637, rtn: 262144, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 75, currOut: 45, fracOut: 45712, rtn: 75, signaledOut: false },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 19899, currOut: 46, fracOut: 0, rtn: 19899, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 21000, currOut: 46, fracOut: 1101, rtn: 21000, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 282040, currOut: 49, fracOut: 65533, rtn: 282040, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 282043, currOut: 50, fracOut: 0, rtn: 282043, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 283000, currOut: 50, fracOut: 0, rtn: 282043, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: 458822, currOut: 50, fracOut: 0, rtn: 282043, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -4512, currOut: 45, fracOut: 41125, rtn: -4512, signaledOut: false },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -45637, currOut: 45, fracOut: 0, rtn: -45637, signaledOut: false },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -59331, currOut: 44, fracOut: 51842, rtn: -59331, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -393216, currOut: 39, fracOut: 45637, rtn: -393216, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -462233, currOut: 38, fracOut: 42156, rtn: -462233, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -2994757, currOut: 0, fracOut: 0, rtn: -2994757, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -2995000, currOut: 0, fracOut: 0, rtn: -2994757, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -3060293, currOut: 0, fracOut: 0, rtn: -2994757, signaledOut: true },
      { currIn: 45, fracIn: 45637, maxIn: 50, gainIn: -3932160, currOut: 0, fracOut: 0, rtn: -2994757, signaledOut: true },
      /* Check overflow handling. */
      {
        currIn: INT16_MAX,
        fracIn: 0,
        maxIn: INT16_MAX,
        gainIn: 196608,
        currOut: INT16_MAX,
        fracOut: 0,
        rtn: 0,
        signaledOut: false,
      },
      {
        currIn: INT16_MAX,
        fracIn: 65535,
        maxIn: 50,
        gainIn: 10,
        currOut: 50,
        fracOut: 0,
        rtn: (50 - INT16_MAX) * 65536 - 65535,
        signaledOut: true,
      },
    ];

    const p = makeP();
    for (const c of cases) {
      p.csp = c.currIn;
      p.cspFrac = c.fracIn;
      p.msp = c.maxIn;
      const oldCsp = p.csp;
      const result = playerAdjustManaPrecise(p, c.gainIn);
      expect(p.csp).toBe(c.currOut);
      expect(p.cspFrac).toBe(c.fracOut);
      expect(result).toBe(c.rtn);
      expect(p.msp).toBe(c.maxIn);
      expect(p.csp !== oldCsp).toBe(c.signaledOut);
    }
  });
});
