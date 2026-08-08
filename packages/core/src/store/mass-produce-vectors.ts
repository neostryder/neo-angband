/**
 * Golden vectors for `mass_produce` (store.c L696).
 *
 * WHY. Turning the 27-case tval switch in `massProduce` into a keyed registry
 * changes how store stock is sized, and store stock is generated from the game's
 * own RNG stream - a change in the number of draws moves every later roll in
 * town. `massProduce` had NO test of any kind before this, so "the tests still
 * pass" would have meant nothing at all.
 *
 * The grid is every object KIND in the shipped pack rather than a hand-picked
 * few, because the branches are chosen by tval AND by cost band, and the pack is
 * the only honest source of which costs actually occur. Each kind is sized under
 * three seeds, and the RNG is probed afterwards so a handler that drew a
 * different NUMBER of values is caught even when the size came out the same.
 *
 * Fixtures are injected, so this module reads no disk and imports no pack.
 *
 * Regenerate with `node packages/core/scripts/gen-mass-produce-vectors.mjs` -
 * which OVERWRITES the evidence.
 */

import { Rng } from "../rng.js";
import type { GameObject } from "../obj/object.js";
import type { ObjRegistry } from "../obj/bind.js";
import { massProduce } from "./store.js";

/** How a vector's object is built, supplied by the caller (test or script). */
export interface MassProduceFixtures {
  reg: ObjRegistry;
  /** Every object kind name in the pack, in pack order. */
  kindNames(): readonly string[];
  /** A fresh, unmodified object of that kind (number 1, no ego). */
  make(kindName: string): GameObject | null;
}

/** One sized object: what it is, what stack it got, where the RNG ended up. */
export interface MassProduceVector {
  kind: string;
  tval: number;
  seed: number;
  number: number;
  rngProbe: number;
}

const SEEDS = [11, 2027, 918273] as const;

export function computeMassProduceVectors(
  f: MassProduceFixtures,
): MassProduceVector[] {
  const out: MassProduceVector[] = [];
  for (const kind of f.kindNames()) {
    for (const seed of SEEDS) {
      const obj = f.make(kind);
      if (obj === null) continue;
      const rng = new Rng(seed);
      massProduce(f.reg, rng, obj);
      out.push({
        kind,
        tval: obj.tval,
        seed,
        number: obj.number,
        rngProbe: rng.randint0(100_000_000),
      });
    }
  }
  return out;
}
