/**
 * What happens to a character the game could not open.
 *
 * This is a permadeath game, so the two questions a player asks when a load
 * fails are "is my character gone" and "did the game just make it worse". Both
 * answers live here, and both used to be wrong: the boot path caught every
 * failure with a bare `catch`, said "Could not read the save; starting a new
 * game", and then let the throwaway game it started autosave straight over the
 * slot it had just failed to read. A save written by a NEWER build - perfectly
 * intact, readable by the very next release - went down that path too.
 */

import { SaveFromFutureError } from "@rpgm-tools/neo-angband-core";

/**
 * The message for a failed load. One line, under the 80-column terminal, and
 * never a word that suggests damage unless damage is what happened.
 *
 * `SaveFromFutureError` is the case worth separating: nothing is wrong, the
 * game is simply behind its own savefile. Telling that player their character
 * is unreadable invites them to delete something that would have opened after
 * an update.
 */
export function describeLoadFailure(err: unknown): string {
  if (err instanceof SaveFromFutureError) {
    return "Saved by a newer version of the game. Update, and it will open.";
  }
  return "Could not read that character. Its save is untouched, not overwritten.";
}

/**
 * The line shown when a save WAS opened, after being converted from an older
 * format. `notes` is whatever the migration could not carry across.
 *
 * Silence is the wrong default here. A character whose file was rewritten
 * should say so once, and a character that lost an item to a mod that is no
 * longer installed should say that loudly rather than let the player discover
 * an empty pack slot three levels down.
 */
export function describeMigration(migration: {
  applied: readonly string[];
  notes: readonly string[];
}): string {
  if (migration.notes.length > 0) {
    return `Save updated to this version. ${migration.notes.join(" ")}`;
  }
  if (migration.applied.length > 0) return "Save updated to this version's format.";
  return "";
}
