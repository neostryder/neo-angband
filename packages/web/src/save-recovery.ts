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

import { SaveFromFutureError, t } from "@rpgm-tools/neo-angband-core";
import type { OrphanStash } from "@rpgm-tools/neo-angband-core";

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

/**
 * The line shown when a still-present pack's content no longer matches what
 * this save was written with (issue #20) - a session-only mod that PATCHED a
 * record (a core sword's damage, say) rather than only adding one, so nothing
 * was orphaned when the patch changed or the pack was dropped: the record
 * still resolves under its own, still-present namespace, and the composed
 * value from save time is simply gone. Named rather than silent, on the same
 * "say so once" reasoning as `describeMigration` - MOD_SEAMS.md section 4d.
 *
 * Kept to the 78-column message line `describeMigration`/`describeLoadFailure`
 * budget for the common one-pack case; a longer list of ids is not truncated,
 * the same tradeoff `describeMigration` already makes for multiple notes.
 */
export function describePackMismatch(mismatchedPacks: readonly string[]): string {
  return `Session mod content changed since this was saved: ${mismatchedPacks.join(", ")}.`;
}

/**
 * The line shown on a load that QUARANTINED something: an item, a monster or a
 * level entity whose defining mod is no longer loaded, frozen into the save's
 * orphans store instead of being deleted (MOD_LIFECYCLE decision 7).
 *
 * Said with names, because the symptom without it is an item simply missing
 * from the pack. The save has always been right about this and the screen has
 * always been silent, which is the worst possible split: a guarantee that
 * nothing a player earned vanishes without a trace is worth nothing when the
 * trace is only in the file.
 *
 * PRESENT TENSE, AND ABOUT THE WHOLE STASH, because the caller is what makes
 * this a one-time line: `StartedGame.quarantined` is non-zero only on the load
 * where the loss actually happened, and on every later boot the store still
 * holds the same entities with nothing new to report. So the sentence describes
 * what is being held rather than claiming this load set all of it aside, which
 * would be wrong for a character that had already stranded something else.
 *
 * NAMES ARE CAPPED rather than truncated mid-word, on the same 78-column budget
 * the notes above keep, and the count carries the rest - uninstalling a content
 * mod can strand dozens of things at once, and a message line naming all of
 * them says less than one naming three and a number.
 */
export function describeQuarantine(stash: OrphanStash, limit = 3): string {
  if (stash.total === 0) return "";
  const named = stash.groups.flatMap((g) => g.items).slice(0, limit);
  const mods = stash.groups.map((g) => g.namespace).join(", ");
  const head = t(
    "orphans.note.head",
    "{count, plural, one {# thing of yours is} other {# things of yours are}} set aside: {mods} did not load.",
    { count: stash.total, mods },
  );
  const names =
    named.length > 0
      ? ` ${t("orphans.note.names", "{names}.", { names: named.map((i) => i.name).join(", ") })}`
      : "";
  return `${head}${names} ${t("orphans.note.where", "Nothing is lost - Mods, then Set aside, lists them.")}`;
}
