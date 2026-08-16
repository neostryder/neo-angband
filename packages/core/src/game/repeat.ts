/**
 * cmd_disable_repeat / cmd_disable_repeat_floor_item (cmd-core.c L539-577) and
 * the `repeat_prev_allowed` static they write, on the path this port actually
 * runs. PORT_TODO 2.12.
 *
 * WHAT WAS WRONG, AND WHY IT LOOKED PORTED. `cmd.ts`'s CommandQueue is a
 * faithful port of upstream's whole ring buffer - `repeat_prev_allowed`,
 * `disableRepeat`, the `cmdq_push_copy` gate, all of it - and **nothing drives
 * it**. `mod/registry-host.ts:15` states that plainly: "cmd.ts CommandQueue is a
 * faithful port the web loop does not drive." The repeat the player gets is the
 * shell re-dispatching `lastRepeatCmd`, and that had no gate, so:
 *
 *  - all SEVEN `cmd_disable_repeat` sites were unported: taking the last of a
 *    stack (obj-gear.c:613), wielding (L1020), a full combine_pack (L1321),
 *    taking the last of a floor pile (obj-pile.c:856), accepting a character
 *    (player-birth.c:1309), creating a trap in wizard mode (cmd-wizard.c:933),
 *    and a store transaction (ui-store.c:1317, which is the shell's);
 *  - all FOUR `cmd_disable_repeat_floor_item` sites were too: leaving a level
 *    (game-world.c:1068), a monster dying or being deleted (mon-util.c:624,
 *    :671), and an object destroyed by a projection (project-obj.c:575).
 *
 * So this is the shipped-is-not-reachable shape, and PORT_TODO 2.12's own
 * description - "`repeatAllowed` in cmd.ts is a static table property, not the
 * runtime disable-for-this-item call" - was true of a class with no callers.
 * Adding the call there would have been perfectly faithful and completely inert.
 *
 * THE FLOOR-ITEM CASE IS WORSE HERE THAN UPSTREAM. Upstream's guard exists to
 * avoid dereferencing an object pointer the command still holds after the object
 * was freed; its own comment says so. This port addresses a floor object as
 * `args.floor`, an INDEX into the pile under the player. An index does not
 * dangle - it silently re-binds. Quaff the first potion off a two-item pile and
 * press the repeat key: index 0 is now the other object.
 *
 * ONE OF THE SEVEN IS NOT OWED, and that is a finding rather than a skip:
 * do_cmd_accept_character's `cmd_disable_repeat` (player-birth.c:1309, "so we
 * don't try to be born again") guards against CMD_BIRTH_* sitting in the same
 * queue as game commands. In this port birth is a shell flow, not a registry
 * command, so `lastRepeatCmd` can never hold a birth step - there is nothing for
 * the guard to stop. The other six are wired, plus all four floor-item sites.
 *
 * The flag lives on `player.upkeep` rather than in a module static or on
 * GameState; see PlayerUpkeep.repeatPrevAllowed for why (three of its writers are
 * in game/gear.ts, which cannot see a GameState).
 */

import { DIR_TARGET } from "../effects/interpreter.js";
import type { Player } from "../player/player.js";
import type { PlayerCommand } from "./context.js";

/**
 * cmd-core.c:353, inside process_command: every command starts out repeatable
 * and the handler gets to say otherwise. Also records whether this command
 * addressed a floor object, which is what disableRepeatFloorItem needs and what
 * upstream reads back off the queued command's args.
 */
export function repeatBeginCommand(p: Player, cmd: PlayerCommand): void {
  p.upkeep.repeatPrevAllowed = true;
  p.upkeep.lastCmdUsedFloorItem = cmd.args?.["floor"] !== undefined;
}

/**
 * cmd_disable_repeat (cmd-core.c:539): "do not allow the current command to be
 * repeated by the user using the repeat last command command".
 */
export function cmdDisableRepeat(p: Player): void {
  p.upkeep.repeatPrevAllowed = false;
}

/**
 * cmd_disable_repeat_floor_item (cmd-core.c:548): the same, but only when the
 * command being remembered used an item from the floor.
 *
 * MEASURED: upstream's early return at L556 ("avoids access to dangling object
 * references") is UNOBSERVABLE in this port, and not just untested. Clearing a
 * false flag is a no-op, so `if (!allowed) return; if (floor) allowed = false;`
 * and the second line alone agree on every input - deleting it kills no test, and
 * no test could be written that it would kill. It exists in the C to skip reading
 * freed object pointers; this port reads an index off `upkeep`, which is always
 * safe. Kept because it is upstream's control flow, recorded here rather than
 * counted as covered.
 */
export function cmdDisableRepeatFloorItem(p: Player): void {
  if (!p.upkeep.repeatPrevAllowed) return;
  if (p.upkeep.lastCmdUsedFloorItem) p.upkeep.repeatPrevAllowed = false;
}

/**
 * cmdq_push_copy's CMD_REPEAT gate (cmd-core.c:296-297): whether the repeat key
 * may re-dispatch the remembered command. Read by the shell.
 */
export function repeatPrevAllowed(p: Player): boolean {
  return p.upkeep.repeatPrevAllowed;
}

/**
 * Which stored direction a repeated command would re-ask about, if any.
 *
 * WHY A REPEAT HAS TO ASK AGAIN. Upstream's aimed commands do not read their
 * direction argument; they read it THROUGH cmd_get_target (cmd-core.c:955-969):
 *
 *     if (cmd_get_arg_direction(cmd, arg, &dir) == CMD_OK) {
 *             if (dir != DIR_TARGET || target_okay()) { ... return CMD_OK; }
 *     }
 *     if (get_aim_dir(&dir)) { cmd_set_arg_target(cmd, arg, dir); ... }
 *     return CMD_ARG_ABORTED;
 *
 * That runs on EVERY execution, so a stored DIR_TARGET is re-validated each time
 * and the aim prompt re-opens whenever the target has stopped being reachable.
 * The port asks once, in the shell, and the repeat key replayed the answer -
 * so firing at a monster that then walked out of view sent the missile into
 * rangedHelper's non-target branch, where DDX[5] and DDY[5] are both 0: a
 * zero-length path at the player's own feet. "It just fires and misses."
 *
 * THREE SLOTS, because three command shapes carry a direction: `dir` on a plain
 * aimed command, `args.dir` on the item verbs, and `args.tgtdir` on a
 * get_aim_dir a handler asks from INSIDE an effect (obj-cmd.ts:1310). They are
 * the same question and upstream re-asks all of them; a list rather than one
 * answer because a command can hold more than one.
 *
 * Pure on purpose: the prompt belongs to the shell, and this is the part of
 * cmd_get_target that can be tested without one.
 */
export type RepeatDirSlot = "dir" | "args.dir" | "args.tgtdir";

export function repeatDirSlots(cmd: PlayerCommand): readonly RepeatDirSlot[] {
  const slots: RepeatDirSlot[] = [];
  if (cmd.dir === DIR_TARGET) slots.push("dir");
  if (cmd.args?.["dir"] === DIR_TARGET) slots.push("args.dir");
  if (cmd.args?.["tgtdir"] === DIR_TARGET) slots.push("args.tgtdir");
  return slots;
}

/**
 * cmd_set_arg_target / cmd_set_arg_direction (cmd-core.c:967): write the answer
 * back into the command, so the direction the player just gave is the one that
 * executes. Returns a copy - the remembered command must not be edited in
 * place, or a cancelled re-prompt would still have changed it.
 */
export function withRepeatDir(
  cmd: PlayerCommand,
  slot: RepeatDirSlot,
  dir: number,
): PlayerCommand {
  if (slot === "dir") return { ...cmd, dir };
  const key = slot === "args.dir" ? "dir" : "tgtdir";
  return { ...cmd, args: { ...(cmd.args ?? {}), [key]: dir } };
}
