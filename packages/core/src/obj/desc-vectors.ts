/**
 * Golden vectors for OBJECT NAMING: MOD_REACH gap 15.
 *
 * WHY THIS EXISTS. `obj_desc_get_basename` (obj-desc.c L152) is a 34-case
 * switch on tval that decides the base name template for every item in the
 * game - `"& # Potion~"`, `"& Scroll~ titled #"`, `"& Book~ of Magic Spells #"`.
 * Its default arm returns the literal string **`"(nothing)"`**, so a mod-coined
 * item class is not merely unnamed: every message, menu row, shop line and
 * object-recall header that mentions it reads `"(nothing)"`. That is the most
 * visible silent failure of any gap on the list.
 *
 * SCOPED FROM THE CODE, NOT FROM THE CENSUS - the lesson gap 28 charged for.
 * Every OTHER tval-conditional site in `desc.ts` already goes through the
 * `tvalIs*` class predicates (`tvalIsChest`, `tvalIsLight`, `tvalCanHaveCharges`
 * ...), which became moddable when `registry:tval` landed, so they need nothing
 * further. Exactly one raw comparison bypassed them: `obj.tval === TV.SCROLL`
 * at `desc.ts:391`, deciding whether an item shows `of <kind name>` alongside
 * its flavour. `tvalIsScroll` already existed and was exported; that site simply
 * did not use it. So gap 15 is the switch plus one line, and the rest of the
 * file was carried by the previous conversion.
 *
 * WHAT THE GRID COVERS, and why each axis is here rather than for symmetry:
 *
 *   - **every ordinary kind in the shipped pack**, so all 34 arms are reached
 *     by real records rather than by a hand-picked representative;
 *   - **aware / unaware**, because the flavoured arms return a different
 *     template each way and the artifact early-out reads it too;
 *   - **terse / plain**, because the five book arms branch on nothing else;
 *   - **store / plain**, because `ODESC.STORE` forces `showFlavor` off, which is
 *     the only way to see a flavoured arm's unflavoured template while aware;
 *   - **prefix on**, so the article and count prefix is in the string - a
 *     basename that changed its `&`/`~`/`|` markup would otherwise be able to
 *     move without moving the output.
 *
 * There is NO RNG here and that is measured rather than assumed: `objectDesc`
 * reads a rune environment but draws nothing. So the 2026-08-09 relaxation to
 * gameplay parity buys this conversion nothing - what these vectors hold is the
 * exact text a player reads, which is as player-visible as the game gets.
 */

import type { Player } from "../player/player.js";
import { ODESC, objectDesc } from "./desc.js";
import type { RuneEnv } from "./knowledge.js";
import type { KnownDesc } from "./known-object.js";
import type { GameObject } from "./object.js";
import type { ObjectKind } from "./types.js";

/** The pieces a desc vector run needs, built from the real pack. */
export interface DescVectorFixtures {
  /** Every ordinary kind, in kidx order. */
  kinds(): readonly ObjectKind[];
  /** A live object of that kind, with the kind's own combat fields copied. */
  object(kind: ObjectKind): GameObject;
  /** The rune/curse environment the shadow synthesis reads. */
  env(): RuneEnv;
  /** A blank human warrior; naming is not class-sensitive, but the API is. */
  player(): Player;
}

/** One row: a kind under one combination of the four axes. */
export interface DescVector {
  /** The kind's own name, so a diff names the item. */
  readonly kind: string;
  /** Its `TV_*` code name. */
  readonly tval: string;
  /** Which arm of the grid: "aware,terse", "unaware,store", ... */
  readonly axes: string;
  /** What the player would read. */
  readonly desc: string;
}

/**
 * The four boolean axes, spelled out rather than generated, so the recorded
 * `axes` label stays stable when one is added.
 */
const AXES = [
  { label: "unaware", aware: false, terse: false, store: false },
  { label: "unaware,terse", aware: false, terse: true, store: false },
  { label: "unaware,store", aware: false, terse: false, store: true },
  { label: "aware", aware: true, terse: false, store: false },
  { label: "aware,terse", aware: true, terse: true, store: false },
  { label: "aware,store", aware: true, terse: false, store: true },
] as const;

/**
 * Flavour text keyed on the item class, so a basename arm that picked up
 * ANOTHER class's flavour would move a row. A single constant string would
 * reach the flavoured branch and prove nothing about which flavour arrived.
 */
function descDeps(aware: boolean): KnownDesc {
  return {
    isAware: () => aware,
    isTried: () => false,
    flavorText: (kind: ObjectKind) => `flavour-of-tval-${String(kind.tval)}`,
    showFlavors: () => true,
  };
}

/** Every ordinary kind through `objectDesc`, on every axis combination. */
export function computeDescVectors(
  fx: DescVectorFixtures,
  tvalName: (tval: number) => string,
): DescVector[] {
  const env = fx.env();
  const p = fx.player();
  const out: DescVector[] = [];
  for (const kind of fx.kinds()) {
    for (const axis of AXES) {
      const mode =
        ODESC.PREFIX |
        (axis.terse ? ODESC.TERSE : 0) |
        (axis.store ? ODESC.STORE : 0);
      out.push({
        kind: kind.name,
        tval: tvalName(kind.tval),
        axes: axis.label,
        desc: objectDesc(
          fx.object(kind),
          mode,
          p,
          env,
          descDeps(axis.aware),
        ),
      });
    }
  }
  return out;
}
