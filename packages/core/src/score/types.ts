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
