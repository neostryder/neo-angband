/**
 * The player's object-knowledge (the "rune" learning system), ported from
 * reference/src/obj-knowledge.c (Angband 4.2.6).
 *
 * Only the slice that changes REAL play is ported so far: the modifier runes
 * a worn item teaches the instant it is wielded. Everything else obj-knowledge.c
 * tracks (flag/element/combat/brand/slay/curse runes) feeds only the DISPLAYED
 * known_state, which this port has not built yet, so it is deliberately deferred
 * and ledgered in parity/ledger/obj-knowledge.yaml.
 *
 * Why modifiers are special: calc_bonuses (player-calcs.c L1942-1981) multiplies
 * every equipped item's modifier by p->obj_k->modifiers, so an unlearned
 * modifier is INERT even in real play. Flags, resists (el_info), and the
 * to_a/to_h/to_d combat bonuses are NOT gated that way - for the real state
 * (known_only == false) they always apply (L1985, L1997-2006), and are learned
 * only to fill in the character-sheet's known_state. So learning modifiers on
 * wield is exactly what makes a freshly worn +3 STR ring raise STR by 3 at once,
 * matching the original; the rest can wait for the display/known-object system.
 */

import type { GameObject } from "./object";
import type { ObjectKind } from "./types";
import { OBJ_MOD_MAX } from "./types";
import type { Player } from "../player/player";

/**
 * object_learn_on_wield (obj-knowledge.c L1820): learn the properties that
 * become obvious the moment an item is worn or wielded.
 *
 * PORTED: the "Learn all modifiers" loop (L1863-1871). Every modifier the item
 * carries (any nonzero value, positive or negative) has its rune learned at
 * once, i.e. player.objKnown.modifiers[i] becomes 1. player_learn_rune's
 * RUNE_VAR_MOD case (L1291-1296) does exactly this set-to-1. This is the whole
 * of the function that touches real bonuses (see the module note above).
 *
 * DEFERRED, because each touches only the not-yet-built display/known_state
 * (ledgered in parity/ledger/obj-knowledge.yaml):
 * - the OBJ_NOTICE_WORN guard and object_flavor_tried (no obj->known twin yet),
 * - obvious-flag learning via create_obj_flag_mask(OFID_WIELD) plus the sustain
 *   promotion for stat items (needs obj_k->flags),
 * - every object_curses_find_* call (curse knowledge not modelled),
 * - the "You feel..." rune/flag messages (needs the play-time message log).
 */
export function objectLearnOnWield(player: Player, obj: GameObject): void {
  const known = player.objKnown.modifiers;
  for (let i = 0; i < OBJ_MOD_MAX; i++) {
    if ((obj.modifiers[i] ?? 0) !== 0 && (known[i] ?? 0) === 0) {
      known[i] = 1;
    }
  }
}

/**
 * Flavor awareness, ported from the kind->aware / kind->tried bits of
 * reference/src/object.h and the accessors/setters in obj-knowledge.c
 * (object_flavor_is_aware L2243, object_flavor_was_tried L2254,
 * object_flavor_aware L2266, object_flavor_tried L2320).
 *
 * Upstream these two bits live on the shared object_kind template and are
 * global to the running game. This port keeps them out of the immutable bound
 * registry and in a per-game FlavorKnowledge, keyed by kind index (kidx), so a
 * bound ObjRegistry stays reusable across games.
 *
 * "aware" means the player knows what a flavored kind does (has quaffed the
 * potion, etc.); "tried" means a kind of that flavor has been used without the
 * effect being learned. object_value and object_value_base read is_aware to
 * decide between the real cost and a flat per-tval guess.
 */
export class FlavorKnowledge {
  private readonly awareKidx = new Set<number>();
  private readonly triedKidx = new Set<number>();

  /**
   * @param ordinaryKindCount z_info->ordinary_kind_max: kinds at or above this
   * index are INSTA_ART dummies and are never marked tried.
   */
  constructor(private readonly ordinaryKindCount: number) {}

  /** object_flavor_is_aware(obj): is the player aware of this kind's flavor? */
  isAware(kind: ObjectKind): boolean {
    return this.awareKidx.has(kind.kidx);
  }

  /** object_flavor_was_tried(obj): has a kind of this flavor been tried? */
  wasTried(kind: ObjectKind): boolean {
    return this.triedKidx.has(kind.kidx);
  }

  /**
   * object_flavor_aware core (L2266): mark a kind's flavor known; returns true
   * when this made a change. The upstream side effects - revealing
   * obj->known->effect, ignore/autoinscribe fixes, propagating
   * object_set_base_known over gear and every store's stock, and refreshing
   * floor tiles that change glyph on awareness - need the player, stores and
   * cave and are DEFERRED (ledgered in obj-knowledge.yaml); they belong with
   * the known-object and UI wiring.
   */
  setAware(kind: ObjectKind): boolean {
    if (this.awareKidx.has(kind.kidx)) return false;
    this.awareKidx.add(kind.kidx);
    return true;
  }

  /** object_flavor_tried (L2320): mark a kind tried; artifacts are skipped. */
  setTried(kind: ObjectKind): void {
    if (kind.kidx >= this.ordinaryKindCount) return;
    this.triedKidx.add(kind.kidx);
  }

  /** A JSON-safe snapshot of the aware/tried kidx sets, for savefiles. */
  snapshot(): { aware: number[]; tried: number[] } {
    return {
      aware: Array.from(this.awareKidx),
      tried: Array.from(this.triedKidx),
    };
  }

  /** Restore a snapshot() payload (replacing the current knowledge). */
  restore(data: { aware: number[]; tried: number[] }): void {
    this.awareKidx.clear();
    this.triedKidx.clear();
    for (const k of data.aware) this.awareKidx.add(k);
    for (const k of data.tried) this.triedKidx.add(k);
  }
}
