/**
 * notice_stuff (player-calcs.c L2536), the "Generic deal-with functions"
 * section's first entry: drain player->upkeep->notice.
 *
 * WHY THIS IS NOT IN player/calcs.ts, where its C neighbours are: both of the
 * passes it dispatches to are game-layer (combine_pack is game/gear.ts,
 * ignore_drop is game/ignore-cmd.ts and needs GameState), and player/ sits
 * BELOW game/ in this port's dependency order. update_stuff and redraw_stuff,
 * the two functions that follow it in the C file, have no port at all - a
 * ratified divergence, not an omission (game/known.ts:153).
 *
 * ORDER IS LOAD-BEARING. Upstream runs ignore before combine, and ignore_drop
 * raises PN_COMBINE on its way out (obj-ignore.c L710). So an ignore pass's
 * combine happens in the SAME notice_stuff call, not the next one. Swapping the
 * two branches would defer it by a turn and nothing would ever notice, which is
 * why it is written down here.
 */

import { PN } from "../player/types.js";
import type { GameState } from "./context.js";
import { ignoreDrop } from "./ignore-cmd.js";

/**
 * Handle player->upkeep->notice: clear each raised bit and do its work, in
 * upstream's order. Cheap to call - the C's own first line is an early return
 * on an empty mask, and every loop site calls it unconditionally.
 */
export function noticeStuff(state: GameState): void {
  const up = state.actor.player.upkeep;

  /* player-calcs.c L2537. */
  if (!up.notice) return;

  /* Deal with ignore stuff (L2540-2543). */
  if (up.notice & PN.IGNORE) {
    up.notice &= ~PN.IGNORE;
    ignoreDrop(state);
  }

  /* Combine the pack (L2546-2549).
   *
   * combine_pack needs z_info's pack_size / quiver_slot_size / thrown mult,
   * which GameState does not carry (state.z is only the turn-loop and AI
   * subset), so the work is a session-bound closure exactly like overflowPack.
   *
   * When nothing is bound the bit is LEFT SET rather than cleared, and that is
   * deliberate: a worldless harness that raises PN_COMBINE still OWES the
   * combine, and silently clearing it would make an unwired build
   * indistinguishable from a wired one. The bit is the evidence; see
   * notice.test.ts, which asserts both halves. */
  if (up.notice & PN.COMBINE) {
    if (state.combinePack) {
      up.notice &= ~PN.COMBINE;
      state.combinePack();
    }
  }

  /* PN_MON_MESSAGE / show_monster_messages (L2552-2557) is absent along with
   * the mon_msg[] queue itself - PORT_TODO 3.1. There is no bit for it in PN
   * either, on purpose: a constant nothing raises reads as ported. */
}

/**
 * on_new_level's own notice pass (game-world.c:1034-1035): arriving on a level
 * asks for a combine unconditionally, then drains immediately.
 *
 * Deliberately runs on arena levels too - upstream's arena early-return is at
 * L1043, seven lines AFTER this, so the one thing an arena level shares with a
 * real level change is exactly this. A helper rather than two lines repeated at
 * each of the port's four level-entry paths (session/game.ts).
 */
export function noticeNewLevel(state: GameState): void {
  state.actor.player.upkeep.notice |= PN.COMBINE;
  noticeStuff(state);
}
