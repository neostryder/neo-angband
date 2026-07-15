/**
 * Message-stream consumption - a faithful port of the world-model half of
 * borg_parse (reference/src/borg/borg-messages.c) and the reaction pass of
 * borg_update (reference/src/borg/borg-update.c:2770-2860).
 *
 * Upstream this is a two-stage pipeline: borg_parse turns a raw game message
 * ("The orc dies.") into a tagged reaction ("DIED:the orc") via borg_react, and
 * borg_update later resolves each reaction against the tracked monster list with
 * borg_locate_kill (nearest record whose name matches, within a distance) and
 * mutates the world model (borg_delete_kill on death, etc.). The port collapses
 * the two stages into one pass over ctx.view.messages(), which is behaviorally
 * identical, and classifies each line with the same prefix/suffix tables.
 *
 * FIDELITY NOTE (fog-of-war). struct borg_kill stores no monster name (it reads
 * r_info[r_idx] on demand), so the frozen port cannot re-derive a tracked
 * record's name to match borg_locate_kill exactly. Instead a death / blink
 * message prunes the nearest tracked monster that is NOT visible this tick
 * (a visible monster is demonstrably not the one that just died/vanished),
 * within the same distances the C used (20 for death, small for blink). With
 * exact monster ids from the frozen view a dead monster already disappears from
 * view.monsters() and would expire on the 2000-turn clock regardless; consuming
 * the death message just prunes it immediately, matching upstream timing.
 */

import type { BorgWorld } from "./world/model";
import { distance } from "./think";

/** prefix_kill[] (borg-messages.c:64): the borg killed something. */
const PREFIX_KILL: readonly string[] = [
  "You have killed ",
  "You have slain ",
  "You have destroyed ",
];

/** suffix_died[] (borg-messages.c:76): a monster died. */
const SUFFIX_DIED: readonly string[] = [
  " die.",
  " dies.",
  " is destroyed.",
  " are destroyed.",
  " is destroyed!",
  " are destroyed!",
  " shrivel away in the light!",
  " shrivels away in the light!",
  " dissolve!",
  " dissolves!",
  " scream of agony!",
  " screams of agony!",
  " disintegrate!",
  " disintegrates!",
  " freeze and shatter!",
  " freezes and shatters!",
  " is drained dry!",
];

/** suffix_blink[] (borg-messages.c:96): a monster teleported / vanished. */
const SUFFIX_BLINK: readonly string[] = [
  " disappears!",
  " intones strange words.",
  " teleports away.",
  " blinks.",
  " makes a soft 'pop'.",
];

function anyPrefix(msg: string, table: readonly string[]): boolean {
  for (const p of table) if (msg.startsWith(p)) return true;
  return false;
}

function anySuffix(msg: string, table: readonly string[]): boolean {
  for (const s of table) if (msg.endsWith(s)) return true;
  return false;
}

/**
 * borg_locate_kill approximation: the index of the nearest tracked monster to
 * the borg that is not visible this tick, within `dist`, or 0 for none. Deleting
 * such a record is how the C prunes dead / vanished monsters.
 */
function locateStaleKill(
  w: BorgWorld,
  visibleIds: ReadonlySet<number>,
  dist: number,
): number {
  const px = w.self.c.x;
  const py = w.self.c.y;
  let best = 0;
  let bestD = dist + 1;
  for (const [i, k] of w.kills.entries()) {
    if (visibleIds.has(k.mIdx)) continue; /* still visible -> not the one gone */
    const d = distance(px, py, k.pos.x, k.pos.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Fold the message stream into the world model. Call once per perceive, after
 * the monster list has been refreshed from the current view.
 *
 * Returns the number of monster records deleted (for tests / debug).
 */
export function borgReactMessages(
  world: BorgWorld,
  messages: readonly string[],
  visibleIds: ReadonlySet<number>,
): number {
  let deleted = 0;

  for (const raw of messages) {
    const msg = raw.trim();
    if (!msg) continue;

    /* Deaths (borg-update.c:2785: DIED -> borg_delete_kill within 20). */
    if (anyPrefix(msg, PREFIX_KILL) || anySuffix(msg, SUFFIX_DIED)) {
      const k = locateStaleKill(world, visibleIds, 20);
      if (k > 0) {
        world.kills.delete(k);
        deleted += 1;
      }
      continue;
    }

    /* Blink / teleport (borg-update.c:1701: BLINK -> relocate/forget). With no
     * new position known, forget the nearest stale record so the borg does not
     * flow to where the monster used to be. */
    if (anySuffix(msg, SUFFIX_BLINK)) {
      const k = locateStaleKill(world, visibleIds, 20);
      if (k > 0) {
        world.kills.delete(k);
        deleted += 1;
      }
      continue;
    }
  }

  return deleted;
}
