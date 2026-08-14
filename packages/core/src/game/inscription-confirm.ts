/**
 * The `!` / `^` inscription safety net - Angband's oldest and most-used way of
 * protecting yourself from your own fingers. Inscribe `!q` on a Potion of Death
 * and quaffing it asks first; `^t` on your body armour and every Take off asks;
 * `!*` or `^*` covers every command at once.
 *
 * Two upstream functions, both of which the port was missing entirely:
 *
 * - `key_confirm_command` (ui-input.c:1923-1948) scans the WORN EQUIPMENT for
 *   `^*` and `^<key>` and asks "Are you sure? " once per occurrence found, before
 *   the command key is turned into a command at all (ui-game.c:547; also
 *   ui-context.c:155, :349, :353, :585 for the context menus).
 * - `get_item_allow` (ui-object.c:634-679) scans the SELECTED OBJECT for
 *   `!<key>` - plus `!*` unless the command is harmless - and asks
 *   verify_object's "Really <verb> <the object>? " once per occurrence, from the
 *   item menu as a row is chosen (ui-object.c:958) and from the context menu's
 *   object actions (ui-context.c:855).
 *
 * The census found only "Are you sure? " here, because get_item_allow's prompt
 * is assembled by strnfmt and its literal fragments ("Really ", " %s? ") are
 * shorter than the anchor floor. The behaviour behind the one string it did find
 * is the whole feature.
 *
 * Both are pure counts and strings: core decides how many confirmations are owed
 * and what to say, and the shell awaits them, the same division walkTerrainPrompt
 * uses (game/player-turn.ts) because the core command path cannot block on UI.
 */

import type { Player } from "../player/player.js";
import type { GameObject } from "../obj/object.js";
import type { Gear } from "./gear.js";
import type { CommandCode } from "../cmd.js";
import { cmdVerb } from "../cmd.js";
import { checkForInscrip } from "./pickup.js";

/** get_check's prompt in key_confirm_command (ui-input.c:1942), verbatim. */
export const KEY_CONFIRM_PROMPT = "Are you sure? ";

/** cmd_verb's fallback when a command has no verb (ui-object.c:664-665). */
export const ITEM_ALLOW_FALLBACK_VERB = "do that with";

/**
 * UN_KTRL_CAP (ui-event.h:135): a control code becomes its CAPITAL letter, not
 * the lower-case one UN_KTRL would give. The comment there explains why - the
 * roguelike ignore command is Ctrl-D, and UN_KTRL would turn that into 'd', the
 * drop command in both keysets, so `!d` would fire on an ignore.
 */
export function unKtrlCap(key: string): string {
  const code = key.charCodeAt(0);
  return code < 0x20 ? String.fromCharCode(code + 64) : key;
}

/**
 * key_confirm_command (ui-input.c:1923-1948): how many times "Are you sure? "
 * must be answered before command key `key` may run. Zero almost always.
 *
 * Upstream asks per equipment slot and aborts on the first refusal, so a total
 * is equivalent - every prompt must be accepted for the command to proceed.
 *
 * The `key === "*"` case counts DOUBLE, and that is upstream's arithmetic, not a
 * slip here: verify_inscrip starts life as the string "^*" and only its second
 * byte is overwritten, so for '*' both terms of the sum count the same
 * inscription. Kept because core keeps upstream's warts.
 *
 * `key` is used RAW - no unKtrlCap. get_item_allow shifts a control code to its
 * capital and this function pointedly does not, so a roguelike Ctrl-chord looks
 * for a `^` plus a control byte, which no inscription can hold, and asks nothing.
 * That asymmetry is upstream's; do not tidy it.
 */
export function keyConfirmCount(player: Player, gear: Gear, key: string): number {
  let n = 0;
  for (let i = 0; i < player.body.count; i++) {
    const handle = player.equipment[i] ?? 0;
    const obj = handle ? gear.store.get(handle) : undefined;
    if (!obj) continue;
    n += checkForInscrip(obj, "^*") + checkForInscrip(obj, `^${key}`);
  }
  return n;
}

/** What get_item_allow owes: a prompt and how many times to ask it. */
export interface ItemAllowPrompt {
  /** verify_object's finished question (obj-util.c:1085), trailing space and all. */
  readonly prompt: string;
  /** How many matching inscriptions were found; each one asks again. */
  readonly count: number;
}

/**
 * get_item_allow (ui-object.c:634-679): the confirmations `obj` demands before
 * command key `key` may act on it, or null when it demands none.
 *
 * `isHarmless` is upstream's IS_HARMLESS flag - a harmless command (inspecting,
 * for instance) ignores a blanket `!*` but still honours its own `!<key>`.
 *
 * `describe` is object_desc(ODESC_PREFIX | ODESC_FULL) (obj-util.c:1082); the
 * shell passes its own namer so the format string stays here, next to the C
 * line it copies.
 */
export function itemAllowPrompt(
  obj: GameObject,
  key: string,
  cmd: CommandCode | null,
  isHarmless: boolean,
  describe: (obj: GameObject) => string,
): ItemAllowPrompt | null {
  const ch = unKtrlCap(key);
  let count = checkForInscrip(obj, `!${ch}`);
  if (!isHarmless) count += checkForInscrip(obj, "!*");
  if (!count) return null;
  const verb = (cmd ? cmdVerb(cmd) : null) ?? ITEM_ALLOW_FALLBACK_VERB;
  /* strnfmt "Really %s" (ui-object.c:667) then verify_object's "%s %s? "
   * (obj-util.c:1085) - one prompt built in two steps upstream. */
  return { prompt: `Really ${verb} ${describe(obj)}? `, count };
}
