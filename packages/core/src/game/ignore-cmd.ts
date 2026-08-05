/**
 * ignore_drop (obj-ignore.c L651): "drop all {ignore}able gear" - fired by
 * notice_stuff's PN_IGNORE handling whenever a menu edit or the 'K'
 * unignoring toggle flags the notice (player-calcs.c L2542).
 *
 * TWO ENTRY POINTS, ONE POLICY.
 *
 * `ignoreDropTargets` is the SCAN: which gear objects are eligible and whether
 * each is worn. A pure read, so it belongs beside the other game/ state readers
 * rather than in obj/ignore.ts (which stays free of GameState/Gear so it has no
 * upward dependency on the game layer).
 *
 * `ignoreDrop` is the PASS - upstream's function, minus the one thing core
 * cannot do. It is what notice_stuff's PN_IGNORE branch calls, and it is also
 * what the shell's applyIgnoreDrop calls, so the queue-a-drop rule and the
 * "!d"/shop guards exist once. Before this existed the shell held the only
 * copy, which is why becoming aware of a kind mid-game dropped nothing: nothing
 * consumed PN_IGNORE (PORT_TODO 2.5).
 *
 * THE ONE THING CORE CANNOT DO is upstream's inline verify_object on an
 * EQUIPPED target (obj-ignore.c L666): every confirmation in this port is the
 * shell's and asynchronous, and notice_stuff is called from inside the
 * synchronous turn loop. So `ignoreDrop` returns those targets instead of
 * deciding them, and the notice pass leaves them alone. That is complete rather
 * than a gap: an untouched target is still ignore-eligible, so the shell's own
 * confirm-capable pass ('=' or 'K', which is where an equipped item realistically
 * becomes ignorable) offers it on the next press. What core must NOT do is
 * inscribe "!d" on the player's behalf - upstream only writes that after the
 * player has actually declined.
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

import { PN } from "../player/types.js";
import type { GameState } from "./context.js";
import { checkForInscrip } from "./pickup.js";

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

/** What one ignore_drop pass did, and what it could not decide. */
export interface IgnoreDropResult {
  /**
   * The EQUIPPED targets, which upstream confirms inline and this port cannot
   * (see the module header). A caller that can ask (the shell) confirms each and
   * calls ignoreDropQueue for the accepted ones; a caller that cannot
   * (noticeStuff) leaves them, and they stay eligible for the next '=' / 'K'.
   */
  needConfirm: IgnoreDropTarget[];
  /** How many drops this pass queued, so a shell knows whether to run a turn. */
  queued: number;
}

/**
 * cmdq_push(CMD_DROP) for one ignore_drop target (obj-ignore.c L685-702). The
 * only place the auto-drop command is built, so its background flag cannot go
 * missing on one of the two paths.
 */
export function ignoreDropQueue(
  state: GameState,
  target: IgnoreDropTarget,
): void {
  /* p->upkeep->dropping = true (obj-ignore.c:687), read once by
   * process_player_cleanup to skip that command's monster housekeeping
   * (game-world.c:867) so an auto-drop does not consume the player's one turn of
   * detection, and cleared there. */
  state.actor.player.upkeep.dropping = true;

  if (!state.cmdQueue) state.cmdQueue = [];
  state.cmdQueue.push({
    code: "drop",
    args: { handle: target.handle, quantity: target.number },
    /* drop_cmd->background_command = 2 (L695-702): this drop is a side effect,
     * so it is not the CMD_REPEAT target and it does not draw the bloodlust
     * coercion roll. Without the flag the roll WOULD be drawn here
     * (game/player-turn.ts), moving every later draw in the turn. */
    background: 2,
  });
}

/**
 * ignore_drop (obj-ignore.c L651): queue a drop for every ignorable gear object
 * that needs no confirmation, then ask for a combine pass.
 */
export function ignoreDrop(state: GameState): IgnoreDropResult {
  const needConfirm: IgnoreDropTarget[] = [];
  /* square_isshop(cave, p->grid) (L683): standing in a store, the drop is
   * skipped but the item stays eligible - upstream tests this per target, so
   * the read is hoisted rather than the semantics changed. */
  const inShop = state.chunk.isShop(state.actor.grid);
  let queued = 0;

  for (const target of ignoreDropTargets(state)) {
    if (target.equipped) {
      needConfirm.push(target);
      continue;
    }
    if (inShop) continue;
    ignoreDropQueue(state, target);
    queued++;
  }

  /* L707-711: PU_INVEN (a ratified divergence - the front end recomputes) and
   * PN_COMBINE, both unconditional, even when nothing was queued. noticeStuff
   * runs its combine branch AFTER this one, so the bit raised here is honoured
   * in the same pass. */
  state.actor.player.upkeep.notice |= PN.COMBINE;

  return { needConfirm, queued };
}
