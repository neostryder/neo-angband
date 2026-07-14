import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag";
import { OF, TV } from "../generated";
import { OF_SIZE } from "../obj/types";
import type { GameObject } from "../obj/object";
import { playerBestDiggerDigging } from "./best-digger";

/** A minimal melee-weapon-shaped object for the selection logic. */
function weapon(
  tval: number,
  weight: number,
  opts: { number?: number; sticky?: boolean } = {},
): GameObject {
  const flags = new FlagSet(OF_SIZE);
  if (opts.sticky) flags.on(OF.STICKY);
  return {
    tval,
    weight,
    number: opts.number ?? 1,
    flags,
  } as unknown as GameObject;
}

/** DIGGING proxy: heavier wielded weapon digs better (matches the weight term). */
const diggingByWeight = (equip: (GameObject | null)[]): number =>
  (equip[0]?.weight ?? 0);

describe("playerBestDiggerDigging (player_best_digger + swap)", () => {
  it("picks a heavier pack digger over the weak wielded weapon", () => {
    const weak = weapon(TV.SWORD, 30);
    const shovel = weapon(TV.DIGGING, 200);
    /* Slot 0 wields the weak weapon; the shovel sits in the pack. */
    const dig = playerBestDiggerDigging([weak], [weak, shovel], 0, diggingByWeight);
    expect(dig).toBe(200);
  });

  it("keeps the wielded weapon when it is already the best", () => {
    const pick = weapon(TV.DIGGING, 250);
    const club = weapon(TV.HAFTED, 100);
    const dig = playerBestDiggerDigging([pick], [pick, club], 0, diggingByWeight);
    expect(dig).toBe(250);
  });

  it("does not swap away from a sticky-cursed wielded weapon", () => {
    const stuck = weapon(TV.SWORD, 30, { sticky: true });
    const shovel = weapon(TV.DIGGING, 200);
    /* Best pack digger exists, but the current weapon cannot be taken off. */
    const dig = playerBestDiggerDigging([stuck], [stuck, shovel], 0, diggingByWeight);
    expect(dig).toBe(30);
  });

  it("ignores a sticky pack weapon as a candidate", () => {
    const weak = weapon(TV.SWORD, 30);
    const stuckShovel = weapon(TV.DIGGING, 200, { sticky: true });
    const dig = playerBestDiggerDigging(
      [weak],
      [weak, stuckShovel],
      0,
      diggingByWeight,
    );
    expect(dig).toBe(30);
  });

  it("falls back to unarmed digging when nothing melee is carried", () => {
    const dig = playerBestDiggerDigging([null], [], 0, diggingByWeight);
    expect(dig).toBe(0);
  });
});
