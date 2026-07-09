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
