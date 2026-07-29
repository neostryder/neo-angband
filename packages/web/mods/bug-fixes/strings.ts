/**
 * "Misc. string fixes" (bugfix.miscStrings) - cosmetic corrections to the text
 * Angband 4.2.6 itself ships, and the bug-fixes mod's own code. Core keeps
 * upstream's wording EXACTLY; nothing here is compiled into it.
 *
 * WHAT THIS ACTUALLY IS, measured rather than assumed, over the 577 distinct
 * literals reference/src hands to msg / msgt / get_check / get_string /
 * get_quantity. Sentence-break spacing splits like this:
 *
 * | break        | one space | two spaces |
 * | ------------ | --------- | ---------- |
 * | after `.`    | 2         | 15         |
 * | after `!`    | 3         | 0          |
 * | after `?`    | 0         | 0          |
 *
 * So upstream is NOT inconsistent about wanting two spaces - it is consistent
 * about it (15 of 17) and slips twice. The patch therefore normalizes the
 * MINORITY form up to the majority, rather than flattening the majority down:
 * exactly Aaron's rule, that a convention used throughout is not a defect and
 * only the less-frequent variant gets corrected.
 *
 * The three `!` breaks are the judgement call. Pooled across terminators they
 * are minority spellings of one convention and get the same treatment; split by
 * terminator they are 3 of 3 and would be the local majority. Pooling wins here
 * because the convention is "two spaces after a sentence", not "after a period",
 * and because a reader sees one message stream, not three punctuation classes.
 * Dropping the three `!` entries below is the whole change if that reading is
 * wrong.
 *
 * ZERO misspellings, also measured: a pass over the same corpus for the usual
 * suspects (recieve, seperate, occured, acheive, neccessary, definately, teh,
 * loosing) turned up nothing, and so did a separate sweep of the gamedata
 * descriptions - see MISSPELLINGS below.
 *
 * A general rewrite rule was considered and rejected. Messages reach the sink
 * already interpolated, so a blanket ". " -> ".  " would rewrite object
 * inscriptions and character names the player typed. An exact-match table
 * cannot misfire that way, and the measurement says it needs four rows - five
 * single-spaced literals upstream, one of which the port cannot emit.
 *
 * THE LIMIT THE messageText HOOK IMPOSES, and which this patch respects: a hook
 * may only RESTATE a message. Changing what a message MEANS would put text in
 * front of the player that upstream never wrote, and no census could see it,
 * because a paraphrase fills the slot it should have left empty (Aaron,
 * 2026-07-28). Every row below differs from its key by exactly one doubled
 * space, and the mod's test asserts that mechanically.
 */

/**
 * Upstream's own single-spaced sentence breaks, normalized to the double space
 * it uses everywhere else. Keys are the upstream text VERBATIM; the host must
 * hand this function the finished message for the lookup to hit.
 *
 * "Non-existent glyph requested. Please report this bug." (ui-prefs.c) is a
 * sixth instance upstream, deliberately absent here: the port has no glyph
 * request path to emit it (text-census KNOWN_ABSENT, internal-error category),
 * so a row for it would be a rule nothing can ever apply.
 */
export const MISC_STRING_CORRECTIONS: Readonly<Record<string, string>> = {
  /* effect-handler-general.c: its three sibling messages ("Bad effect
   * description passed to effect_info().  Please report this bug." and friends)
   * are double-spaced, so this one is a slip and not a house style. */
  "Bad effect passed to effect_do(). Please report this bug.":
    "Bad effect passed to effect_do().  Please report this bug.",
  /* effect-handler-general.c, EARTHQUAKE. */
  "The ground shakes! The ceiling caves in!": "The ground shakes!  The ceiling caves in!",
  /* mon-make.c place_new_monster_one's allocation failure. */
  "Warning! Could not allocate a new monster.": "Warning!  Could not allocate a new monster.",
  /* effect-handler-general.c, the unresisted cold branch. */
  "Oops! It feels deathly cold!": "Oops!  It feels deathly cold!",
};

/**
 * The misspellings sweep, kept as data so the claim "zero" is checkable rather
 * than asserted. Each is a wrong spelling paired with the right one; the test
 * asserts none of the wrong forms appears in upstream's message corpus OR in
 * the gamedata descriptions, and any that turns up gets a row above.
 */
export const MISSPELLINGS: readonly (readonly [string, string])[] = [
  ["recieve", "receive"],
  ["seperate", "separate"],
  ["occured", "occurred"],
  ["occurance", "occurrence"],
  ["acheive", "achieve"],
  ["neccessary", "necessary"],
  ["definately", "definitely"],
  ["accidently", "accidentally"],
  ["begining", "beginning"],
  ["existance", "existence"],
  ["persistant", "persistent"],
  ["independant", "independent"],
  ["noticable", "noticeable"],
  ["wierd", "weird"],
  ["thier", "their"],
  ["teh", "the"],
  ["loosing", "losing"],
  ["gaurd", "guard"],
  ["peice", "piece"],
  ["releive", "relieve"],
  ["seige", "siege"],
  ["succesful", "successful"],
  ["untill", "until"],
  ["wich", "which"],
];

/**
 * The patch: upstream's text in, the corrected text out. Identity for anything
 * with no wart, so the host can apply it unconditionally once the hook is
 * installed.
 */
export function miscStringFix(text: string): string {
  return MISC_STRING_CORRECTIONS[text] ?? text;
}
