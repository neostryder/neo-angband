/**
 * ignore_drop (obj-ignore.c L651): "drop all {ignore}able gear" - fired by
 * notice_stuff's PN_IGNORE handling whenever a menu edit or the 'K'
 * unignoring toggle flags the notice (player-calcs.c L2542).
 *
 * This module holds only the SCAN half (which gear objects are eligible and
 * whether each is currently worn): a pure read with no game mutation, so it
 * belongs beside the other game/ state readers rather than in obj/ignore.ts
 * (which stays free of GameState/Gear so it has no upward dependency on the
 * game layer). The shell (web/main.ts's applyIgnoreDrop) does the actual
 * work upstream interleaves here: confirming + inscribing "!d" on a declined
 * equipped item, and queuing the real CMD_DROP-equivalent "drop" command for
 * the rest.
 *
 * GEAR ORDER: upstream walks p->gear (one combined linked list of pack AND
 * equipped objects in insertion order) backwards via gear_last_item/obj->prev.
 * This port's Gear (game/gear.ts) deliberately has no such combined
 * insertion-order list - equipment lives in fixed player.equipment[] slots
 * and the pack is its own ordered array (see game/gear.ts's module doc). The
 * faithful-enough substitute here is: equipment slots in slot order, then the
 * pack in its own order, the whole thing reversed - so every ignorable item
 * is still visited exactly once and pack items (usually the freshest
 * ignores) are offered first, without claiming to reproduce upstream's exact
 * add-order sequence.
 */

import type { GameState } from "./context";
import { checkForInscrip } from "./pickup";

/** One gear object ignore_drop is willing to drop. */
export interface IgnoreDropTarget {
  /** The gear handle (state.gear.store key). */
  handle: number;
  /** Whether the object is currently worn (object_is_equipped). */
  equipped: boolean;
  /** The full stack count to drop (obj->number). */
  number: number;
}

/**
 * The scan half of ignore_drop: every gear object that is currently eligible
 * for ignoring (state.isIgnored, i.e. ignore_item_ok) and not inscribed
 * "!d"/"!*", in the backwards gear order described above.
 */
export function ignoreDropTargets(state: GameState): IgnoreDropTarget[] {
  const player = state.actor.player;
  const equipped = new Set<number>();
  const handles: number[] = [];
  for (let i = 0; i < player.body.count; i++) {
    const handle = player.equipment[i] ?? 0;
    if (handle !== 0) {
      handles.push(handle);
      equipped.add(handle);
    }
  }
  for (const handle of state.gear.pack) handles.push(handle);
  handles.reverse();

  const out: IgnoreDropTarget[] = [];
  for (const handle of handles) {
    const obj = state.gear.store.get(handle);
    if (!obj) continue;
    if (!(state.isIgnored?.(obj) ?? false)) continue;
    if (checkForInscrip(obj, "!d") || checkForInscrip(obj, "!*")) continue;
    out.push({ handle, equipped: equipped.has(handle), number: obj.number });
  }
  return out;
}
