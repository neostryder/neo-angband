/**
 * The bug-fixes mod's "Misc. string fixes" patch: cosmetic corrections to the
 * text Angband 4.2.6 itself ships. Core keeps upstream's wording EXACTLY - this
 * runs only when the bug-fixes mod is enabled and its `bugfix.miscStrings` flag
 * is on, exactly like every other rule in that mod.
 *
 * WHAT THIS ACTUALLY IS, measured rather than assumed. Sweeping every
 * player-visible literal in reference/src for warts found:
 *
 * - 38 literals with TWO spaces after sentence-ending punctuation ("Saving
 *   failed.  Try again? ", "A panic save exists.  Use it? ", ...). This is the
 *   old typographic convention, used deliberately and consistently upstream, so
 *   it is a presentation PREFERENCE rather than a defect - which is why it is
 *   opt-in behind a mod flag and not a core change.
 * - ZERO misspellings. A pass over msg()/msgt()/get_check() text for the usual
 *   suspects (recieve, seperate, occured, acheive, neccessary, definately, teh,
 *   loosing) turned up nothing. If one is ever found, add it to CORRECTIONS
 *   below rather than widening the whitespace rule.
 *
 * So the patch is one mechanical rule plus an empty exact-match table. Saying
 * that plainly is the point: an item called "Misc. string fixes" invites a pile
 * of unexamined edits, and there is nothing here to edit but the spacing.
 */

/**
 * Exact-match corrections for genuine upstream typos, applied before the
 * whitespace rule. Empty by measurement, not by omission - see the module note.
 * Keys are the upstream text verbatim.
 */
export const MISC_STRING_CORRECTIONS: Readonly<Record<string, string>> = {};

/**
 * Collapse the double space upstream puts after a sentence to a single one.
 *
 * Deliberately narrow: only after `.`, `!` or `?` and only when a capital,
 * a digit or a quote follows, so it cannot touch column alignment in the help
 * text or the two spaces inside a name. Runs of three or more are left alone -
 * those are alignment, not sentence spacing.
 */
function singleSpaceSentences(text: string): string {
  return text.replace(/([.!?]) {2}(?=["'A-Z0-9])/gu, "$1 ");
}

/**
 * The patch: upstream's text in, the corrected text out. Identity for anything
 * with no wart, so the caller can apply it unconditionally once the flag is on.
 */
export function miscStringFix(text: string): string {
  const exact = MISC_STRING_CORRECTIONS[text];
  if (exact !== undefined) return exact;
  return singleSpaceSentences(text);
}
