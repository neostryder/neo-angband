/**
 * wr_description (save.c:47-66): the one-line summary stored INSIDE a savefile.
 *
 * Upstream writes this as its own "description" block, and reads it back without
 * loading the game: `savefile_get_description` (savefile.c:596-621) opens the
 * file, walks blocks until it finds that one, and returns the string. Two places
 * show the result to a player:
 *
 *   - `list_saves` (main.c:322-328), the `-l` switch: ` %-15s  %s` with the
 *     description, or ` %-15s` for a file that has none;
 *   - `get_savefile_selection` (ui-game.c:1258), the `-c` savefile menu.
 *
 * Which is why the description lives in the FILE rather than in an index beside
 * the saves: both readers start from a directory scan and ask each file what it
 * is. An index would be a second source of truth that can disagree with the
 * files it describes, and under the no-save-scumming policy (decision 16) the
 * disagreement costs a character - an orphaned save is one nothing can offer.
 *
 * Nothing calls this yet: the savefiles it describes are still localStorage
 * entries, so there is no file for a description to live in and no directory to
 * scan (Phase 5, parity/PLATFORM.md). It is ported now, cordoned per the
 * convention in `player/spell.ts`, because it is the FORMAT the rest of that work
 * is measured against - two exact player-visible strings the port had nowhere,
 * and the kind of string neither census can see (both are `%s`-anchored, so a
 * literal search finds no anchor to miss).
 */

/** Exactly the `player` fields wr_description reads. */
export interface SaveDescriptionSource {
  /** player->full_name. */
  readonly fullName: string;
  /** player->is_dead. */
  readonly isDead: boolean;
  /** player->died_from. Only read on the dead branch. */
  readonly diedFrom: string;
  /** player->lev. */
  readonly level: number;
  /** player->race->name. */
  readonly raceName: string;
  /** player->class->name. */
  readonly className: string;
  /** player->depth. */
  readonly depth: number;
}

/**
 * `savefile_desc` is `char[120]` (savefile.c:588) and `rd_string` truncates into
 * it, so a description read back from a savefile is at most 119 characters plus
 * the terminator. Applied on the WRITE side here, which is where upstream's
 * `buf[1024]` would have let a long name through: reading it back would silently
 * shorten it, and a value that changes when it makes a round trip is a value two
 * screens can disagree about.
 */
export const SAVEFILE_DESC_LEN = 120;

/**
 * The description string for a savefile.
 *
 * Both branches are verbatim from save.c:53-63. The dead one names what killed
 * the character rather than where they were, because a tombstone's depth is not
 * what a player is looking for in a list of saves.
 */
export function saveDescription(p: SaveDescriptionSource): string {
  const desc = p.isDead
    ? /* "%s, dead (%s)" (L54-56) */
      `${p.fullName}, dead (${p.diedFrom})`
    : /* "%s, L%d %s %s, at DL%d" (L58-63) */
      `${p.fullName}, L${p.level} ${p.raceName} ${p.className}, at DL${p.depth}`;
  return desc.slice(0, SAVEFILE_DESC_LEN - 1);
}
