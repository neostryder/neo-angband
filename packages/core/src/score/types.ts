/**
 * High-score domain types, ported from reference/src/score.h (Angband 4.2.6).
 *
 * Upstream struct high_score packs every field as a fixed-width, null-
 * terminated, space-padded ASCII string in a 128-byte record (the "number"
 * fields right-justified so a strcmp on "pts" orders scores). This port keeps
 * data as JSON with TYPED fields (PORT_PLAN.md decision 9): the numeric fields
 * become numbers, the string fields stay strings. The LOGIC (scoring math,
 * sort/insert order, gating, display formatting) is ported faithfully; only
 * the on-disk representation diverges from the binary scores.raw file. See
 * parity/ledger/high-scores.yaml.
 */

/** Maximum number of high scores kept (score.h MAX_HISCORES). */
export const MAX_HISCORES = 100;

/**
 * The value the `how` (method-of-death) field holds for a winner (score.h
 * WINNING_HOW). A winning record sorts before any non-winning record.
 */
export const WINNING_HOW = "Ripe Old Age";

/**
 * One high-score record (struct high_score). The fixed-width string fields of
 * the C become typed fields here; the port reconstructs the exact display
 * strings (see display.ts) from these values.
 *
 * `what` (upstream: version info) doubles as the "slot in use" marker in the C
 * (an empty `what` marks an unused record). This port stores only real records
 * in a compact array, so `what` is simply the build id; an empty string still
 * counts as an empty/invalid record for regularize.
 */
export interface HighScore {
  /** buildid the score was recorded under (score.h what[8], <= 7 chars). */
  what: string;
  /** total_points(): max_exp + 100 * max_depth (score.h pts). */
  pts: number;
  /** Gold at death (player->au; score.h gold). */
  gold: number;
  /** Game turn at death (the `turn` counter; score.h turns). */
  turns: number;
  /** Time stamp: "@YYYYMMDD" for a death, or "TODAY" (score.h day). */
  day: string;
  /** Player name, first 15 chars of full_name (score.h who[16]). */
  who: string;
  /** Player uid (score.h uid). */
  uid: number;
  /** Player race index (race->ridx; score.h p_r). */
  pRace: number;
  /** Player class index (class->cidx; score.h p_c). */
  pClass: number;
  /** Level at death (player->lev; score.h cur_lev). */
  curLev: number;
  /** Dungeon level at death (player->depth, the live cave depth; cur_dun). */
  curDun: number;
  /** Deepest character level reached (player->max_lev; max_lev). */
  maxLev: number;
  /** Deepest dungeon level reached (player->max_depth; max_dun). */
  maxDun: number;
  /** Method of death, first 31 chars of died_from (score.h how[32]). */
  how: string;
}

/**
 * The persistence seam. Core never touches storage directly (no filesystem,
 * no localStorage); a platform supplies read/write of the compact score list.
 * Mirrors highscore_read / highscore_write, minus the binary file, locking and
 * setuid dance of score.c (all platform concerns).
 */
export interface ScoreStore {
  /** Read the stored scores, best-first. Empty array when nothing is stored. */
  read(): HighScore[];
  /** Persist the (already ordered, already truncated) score list. */
  write(scores: HighScore[]): void;
}

/**
 * One record's display fields, BEFORE display_score_page joins them into prose.
 *
 * WHY THIS EXISTS. The three lines are a rendering: "1.  1234  Frodo the
 * Half-Troll Warrior, level 20" is one opaque string, and a front end that wants
 * to sort a leaderboard by turns, colour a row by rank or draw a class glyph
 * would have to parse it back apart - against a layout that a translation or a
 * long name changes. So the fields the C reads out of the record are published
 * beside the lines they were joined into.
 *
 * There is exactly ONE extraction: `scoreRow` builds this and then builds its
 * three lines FROM it. The alternative was a second extraction in the front end
 * beside the strings here, which is the two-transcriptions failure the screen
 * model exists to prevent - and the one nobody looks at is the one that rots.
 *
 * `rankText` and `pointsText` are the printf fields ("%3d", "%9s") rather than
 * bare numbers, because those widths are what makes the table line up on a
 * faithful terminal; a presenter with its own font ignores them and reads `rank`
 * and `points`.
 */
export interface ScoreRowFields {
  /** 1-based rank (start + 1 in display_score_page). */
  readonly rank: number;
  /** The rank in its "%3d" field. */
  readonly rankText: string;
  /** total_points() (score.h pts). */
  readonly points: number;
  /** The points in their "%9s" field. */
  readonly pointsText: string;
  /** The record's `who` - player->full_name at death. */
  readonly who: string;
  /** Race name, or "<none>" where the index resolves to nothing (the C's own). */
  readonly race: string;
  /** Class name, or "<none>"; see `race`. */
  readonly cls: string;
  /** cur_lev / max_lev. Upstream prints "(Max M)" only when they differ. */
  readonly level: number;
  readonly maxLevel: number;
  /** cur_dun / max_dun; depth 0 is the town, which upstream words differently. */
  readonly depth: number;
  readonly maxDepth: number;
  /** Method of death; WINNING_HOW for a winner. */
  readonly how: string;
  readonly uid: number;
  /** The stamp as display_score_page shows it ("2026-08-13", or "TODAY"). */
  readonly date: string;
  readonly gold: number;
  readonly turns: number;
}

/**
 * One rendered score entry (the three text lines display_score_page draws per
 * record, plus its colour and rank). The Term paging/scroll loop is the
 * shell's; this is the front-end-agnostic row data.
 */
export interface ScoreRow {
  /** 1-based rank (start + 1 in display_score_page). */
  rank: number;
  /** True when this row is the highlighted (current) entry. */
  highlighted: boolean;
  /** COLOUR_* attribute: L_GREEN when highlighted, else WHITE. */
  color: number;
  /** The fields the three lines below were built from; see `ScoreRowFields`. */
  fields: ScoreRowFields;
  /** Line 1: "  1.  <pts>  <name> the <race> <class>, level N (Max M)". */
  line1: string;
  /** Line 2: "Killed by X on dungeon level N (Max M)" / "... in the town". */
  line2: string;
  /** Line 3: "(User u, Date d, Gold g, Turn t).". */
  line3: string;
}

/**
 * Column at which display_score_page draws the 2nd and 3rd lines of each entry
 * (c_put_str(..., n * 4 + 3, 15) / (..., n * 4 + 4, 15)). Line 1 is at col 0.
 */
export const SCORE_DETAIL_INDENT = 15;

/** Entries shown per page (display_score_page dumps at most 5). */
export const SCORES_PER_PAGE = 5;
