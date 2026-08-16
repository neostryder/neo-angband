/**
 * High-score row formatting, ported from reference/src/ui-score.c
 * (Angband 4.2.6) display_score_page (L30). The C draws three lines per record
 * with Term calls; this produces the same strings as DATA (ScoreRow), leaving
 * the Term paging/scroll/keypress loop (display_scores_aux, L117) to the shell.
 *
 * The number fields the C reads back from the fixed-width record (pts printed
 * with "%9s"; user/gold/turns are the space-padded numbers with their leading
 * whitespace stripped) are reconstructed here from the typed HighScore, giving
 * byte-identical output.
 */

import { COLOUR_L_GREEN, COLOUR_WHITE } from "../color.js";
import { SCORES_PER_PAGE } from "./types.js";
import type { HighScore, ScoreRow, ScoreRowFields } from "./types.js";

/**
 * Resolvers for the race/class name a record's indices map to
 * (player_id2race / player_id2class in display_score_page). Return null for an
 * unknown index; the C prints "<none>" then. Supply from a PlayerRegistry:
 * `{ raceName: (i) => reg.races[i]?.name ?? null, ... }`.
 */
export interface ScoreNameResolver {
  raceName(ridx: number): string | null;
  className(cidx: number): string | null;
}

/** printf "%Ns": right-justify a string into at least N columns. */
function padStart(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

/**
 * Clean up the stored "when" for display (ui-score.c L100): an "@YYYYMMDD"
 * stamp (a leading '@' with total length 9) becomes "YYYY-MM-DD"; anything
 * else (e.g. "TODAY") is shown unchanged.
 */
function formatWhen(day: string): string {
  if (day.startsWith("@") && day.length === 9) {
    return `${day.slice(1, 5)}-${day.slice(5, 7)}-${day.slice(7, 9)}`;
  }
  return day;
}

/**
 * Build the three display lines for a single record at `start`, highlighted
 * when start === highlight. Faithful to the body of display_score_page's loop.
 */
export function scoreRow(
  scores: readonly HighScore[],
  start: number,
  highlight: number,
  names: ScoreNameResolver,
): ScoreRow {
  const score = scores[start]!;
  const highlighted = start === highlight;
  const color = highlighted ? COLOUR_L_GREEN : COLOUR_WHITE;

  /* THE ONE EXTRACTION. Every value the three lines below are made of is read
   * out of the record here, and the lines are then joined FROM these fields - so
   * a front end drawing its own Hall of Fame reads `fields` instead of parsing
   * "Frodo the Half-Troll Warrior, level 20" back apart. Publishing the fields
   * as a second, independent read beside the strings was the alternative, and it
   * is the two-transcriptions failure: the copy nobody looks at is the one that
   * rots. See ScoreRowFields. */
  const fields: ScoreRowFields = {
    rank: start + 1,
    rankText: padStart(String(start + 1), 3),
    points: score.pts,
    pointsText: padStart(String(score.pts), 9),
    who: score.who,
    /* player_id2race / player_id2class, with the C's own "<none>" for an index
     * that resolves to nothing (display_score_page). */
    race: names.raceName(score.pRace) ?? "<none>",
    cls: names.className(score.pClass) ?? "<none>",
    level: score.curLev,
    maxLevel: score.maxLev,
    depth: score.curDun,
    maxDepth: score.maxDun,
    how: score.how,
    uid: score.uid,
    date: formatWhen(score.day),
    gold: score.gold,
    turns: score.turns,
  };

  // Line 1: "%3d.%9s  %s the %s %s, level %d" (+ " (Max %d)" if mlev > clev).
  let line1 =
    `${fields.rankText}.${fields.pointsText}` +
    `  ${fields.who} the ${fields.race} ${fields.cls}, level ${fields.level}`;
  if (fields.maxLevel > fields.level) line1 += ` (Max ${fields.maxLevel})`;

  // Line 2: town vs dungeon death (+ " (Max %d)" if mdun > cdun).
  let line2 = !fields.depth
    ? `Killed by ${fields.how} in the town`
    : `Killed by ${fields.how} on dungeon level ${fields.depth}`;
  if (fields.maxDepth > fields.depth) line2 += ` (Max ${fields.maxDepth})`;

  // Line 3: "(User %s, Date %s, Gold %s, Turn %s)." - the numeric fields are
  // the stripped (no leading space) decimal values.
  const line3 =
    `(User ${fields.uid}, Date ${fields.date}, ` +
    `Gold ${fields.gold}, Turn ${fields.turns}).`;

  return { rank: fields.rank, highlighted, color, fields, line1, line2, line3 };
}

/**
 * display_score_page (ui-score.c L30): the rows for one page - up to 5 entries
 * starting at `start`, stopping at `count`. `highlight` is the index to draw in
 * L_GREEN (or -1 for none).
 */
export function scorePageRows(
  scores: readonly HighScore[],
  start: number,
  count: number,
  highlight: number,
  names: ScoreNameResolver,
): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (let n = 0; start < count && n < SCORES_PER_PAGE; start++, n++) {
    rows.push(scoreRow(scores, start, highlight, names));
  }
  return rows;
}

/**
 * All rows for the inclusive-exclusive range [from, to) clamped to the real
 * record count, in one flat list (convenience over paging). `highlight` is the
 * highlighted index or -1. Useful for a scroll surface that renders every row.
 */
export function scoreRows(
  scores: readonly HighScore[],
  from: number,
  to: number,
  highlight: number,
  names: ScoreNameResolver,
): ScoreRow[] {
  const start = Math.max(0, from);
  const end = Math.min(to, scores.length);
  const rows: ScoreRow[] = [];
  for (let i = start; i < end; i++) {
    rows.push(scoreRow(scores, i, highlight, names));
  }
  return rows;
}
