/**
 * `randart.log`: the artifact-generation log, ported from the two file-scope
 * statics that carry it in the C.
 *
 * WHAT THIS IS. `do_randart` opens ANGBAND_DIR_USER/randart.log for writing
 * before it touches an artifact and closes it after (obj-randart.c
 * L3165-L3193), and every step of the design loop narrates itself into it -
 * 174 `file_putf(log_file, ...)` sites in obj-randart.c and 59 `log_obj(...)`
 * sites in obj-power.c, which is where a randart's POWER is worked out. It is
 * the only account of why a generated artifact came out the way it did, and the
 * maintainer's disposition on 2026-08-04 was **pursue parity**, so it is a port
 * with no asterisk rather than a spoiler dump to drop.
 *
 * A MODULE-LEVEL SINK, DELIBERATELY. Upstream has exactly this shape: two
 * statics (`log_file` in obj-randart.c, `object_log` in obj-power.c) that are
 * NULL for the whole game except inside do_randart, and `log_obj` opens with
 * `if (!object_log) return;`. Threading a log parameter through all 233 sites
 * would touch every signature in three modules to model a variable that is
 * global in the original. The port collapses the two statics into one because
 * they only ever point at the same file: object_power's `log_file` argument is
 * always do_randart's, and the one other caller that passes a different file is
 * `object_value_real`'s pricing log, which is behind `#ifdef PRICE_DEBUG` and
 * ships off (see randartLogPriceDebugNote).
 *
 * THE POWER LOG IS NOT DEAD WHEN THE SINK IS NULL - it is *skipped*, cheaply.
 * `objectPower` runs on every item the game prices, so the guard has to be a
 * null check and the message must not be built when there is no sink. That is
 * why the emitters take a thunk at the sites where formatting is not free.
 */

/** A sink for one already-formatted log line (upstream: file_putf). */
export type RandartLog = (text: string) => void;

let sink: RandartLog | null = null;

/**
 * Install the log sink, or null to close it. do_randart's file_open/file_close
 * pair (obj-randart.c L3166, L3190) is spelt as setRandartLog(f) /
 * setRandartLog(null) so an aborted generation cannot leave it open.
 */
export function setRandartLog(log: RandartLog | null): void {
  sink = log;
}

/** Whether a log is open, i.e. upstream's `if (!object_log) return;`. */
export function randartLogOpen(): boolean {
  return sink !== null;
}

/**
 * `file_putf(log_file, ...)` / `log_obj(...)`: append one already-formatted
 * chunk. Upstream's format strings carry their own "\n" (several deliberately
 * do NOT - see damage_dice_power, which ends "for damage dice, " so the next
 * line continues it), so callers pass the text exactly as the C composes it and
 * this adds nothing.
 */
export function randartLog(text: string): void {
  if (sink) sink(text);
}

/**
 * The same, for a line whose formatting is not free. Upstream pays that cost
 * unconditionally because file_vputf is inside log_obj; the port must not,
 * because objectPower is on the item-pricing path for every object in the game.
 */
export function randartLogf(build: () => string): void {
  if (sink) sink(build());
}

/**
 * `object_value_real`'s `pricing.log` (obj-power.c L1119-L1204) is NOT this
 * log and is NOT ported. It is guarded by `#ifdef PRICE_DEBUG`, which no
 * shipped configuration defines, so its seven file_putf sites are dead in every
 * build a player can obtain. Recorded here rather than left to be rediscovered
 * as a gap by the next census, which counts format strings and cannot see a
 * preprocessor condition.
 */
export const PRICE_DEBUG_LOG_NOT_PORTED = true;
