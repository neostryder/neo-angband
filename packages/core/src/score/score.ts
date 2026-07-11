/**
 * High-score logic, ported from reference/src/score.c and score-util.c
 * (Angband 4.2.6): the scoring formula, the build/where/add/count/regularize
 * table operations, and the enter-score gating. All operations here are pure
 * over an in-memory HighScore[]; persistence arrives through the injected
 * ScoreStore seam (types.ts), never a filesystem.
 *
 * The port operates on a COMPACT list (only real records, no empty padding),
 * capped at MAX_HISCORES, rather than the C's fixed array of MAX_HISCORES
 * records with empty slots at the tail. The observable results (insert slot,
 * shift-and-truncate on add, sort order, count) are identical; see
 * parity/ledger/high-scores.yaml for the equivalence argument.
 */

import type { Player } from "../player/player";
import { MAX_HISCORES, WINNING_HOW } from "./types";
import type { HighScore, ScoreStore } from "./types";

/**
 * Default build id stamped into a record's `what` (score.c build_score uses
 * the global `buildid`). Kept local so this module does not depend on the
 * barrel's ENGINE_VERSION (which would be a circular import); the web shell
 * may pass a specific build id via BuildScoreDeps.buildid.
 */
const DEFAULT_BUILDID = "0.1.0";

/**
 * total_points (score.c L28): the whole score is max experience plus a flat
 * bonus per deepest dungeon level reached. Ported EXACTLY.
 */
export function totalPoints(p: Player): number {
  return p.maxExp + 100 * p.maxDepth;
}

/**
 * The non-Player state build_score reads (score.c build_score, L216). Upstream
 * pulls these from globals (turn, player_uid, buildid) or the live world
 * (p->depth is the current cave depth, distinct from p->max_depth). The port
 * keeps them off Player, so buildScore takes them as deps, matching the
 * char-sheet's deps idiom (game/char-sheet.ts).
 */
export interface BuildScoreDeps {
  /** died_from: the method-of-death string (p->died_from, or "nobody (yet!)"). */
  diedFrom: string;
  /** turn (game-world.c): the game-turn counter at death. */
  turn: number;
  /** p->depth: the LIVE dungeon depth (cur_dun), not max_depth. */
  depth: number;
  /** p->full_name: the character's name (only first 15 chars are kept). */
  fullName?: string;
  /** player_uid: the OS player id. Default 0 (the port has no OS uid). */
  uid?: number;
  /** buildid the record is stamped with (what[]). Default ENGINE_VERSION. */
  buildid?: string;
  /**
   * The time of death, for the "@YYYYMMDD" day stamp. NULL/undefined (the
   * player is not dead) yields "TODAY", exactly as build_score.
   */
  deathTime?: Date | null;
}

/** strftime "@%Y%m%d" in LOCAL time (build_score L235 uses localtime). */
function formatDay(deathTime: Date | null | undefined): string {
  if (!deathTime) return "TODAY";
  const y = String(deathTime.getFullYear()).padStart(4, "0");
  const m = String(deathTime.getMonth() + 1).padStart(2, "0");
  const d = String(deathTime.getDate()).padStart(2, "0");
  return `@${y}${m}${d}`;
}

/**
 * build_score (score.c L216): fill a score record from the player plus the
 * death-time and cause. The C truncates who to 15 chars ("%-.15s") and how to
 * 31 (my_strcpy into how[32]); reproduced here. `what` marks the record in
 * use (a non-empty build id).
 */
export function buildScore(p: Player, deps: BuildScoreDeps): HighScore {
  return {
    what: (deps.buildid ?? DEFAULT_BUILDID).slice(0, 7),
    pts: totalPoints(p),
    gold: p.au,
    turns: deps.turn,
    day: formatDay(deps.deathTime),
    who: (deps.fullName ?? "").slice(0, 15),
    uid: deps.uid ?? 0,
    pRace: p.race.ridx,
    pClass: p.cls.cidx,
    curLev: p.lev,
    curDun: deps.depth,
    maxLev: p.maxLev,
    maxDun: p.maxDepth,
    how: deps.diedFrom.slice(0, 31),
  };
}

/** A record is "empty"/unused when its build-id marker is blank (what[0]). */
function isEmpty(s: HighScore): boolean {
  return s.what.length === 0;
}

/**
 * highscore_valid (score-util.c L95): a non-empty record must have parseable
 * numeric fields. With typed storage the only ways a record can be invalid are
 * a blank build id (treated as empty) or a non-finite number in a numeric
 * field; NaN/Infinity would break the strtol-equivalent ordering, so they are
 * rejected exactly as an unparseable C field would be.
 */
export function highscoreValid(s: HighScore): boolean {
  if (isEmpty(s)) return true; // an empty record is valid (all-empty in C)
  const nums = [
    s.pts,
    s.gold,
    s.turns,
    s.uid,
    s.pRace,
    s.pClass,
    s.curLev,
    s.curDun,
    s.maxLev,
    s.maxDun,
  ];
  return nums.every((n) => Number.isFinite(n));
}

/**
 * highscore_cmp (score-util.c L43): order two records best-first. Winners
 * (how == WINNING_HOW) precede non-winners; then more points precede fewer;
 * ties keep their existing order (the C uses the record address, which for a
 * contiguous array is the current order - a stable sort reproduces this).
 * Returns <0 if a precedes b, >0 if a follows b, 0 for a true tie.
 */
export function highscoreCmp(a: HighScore, b: HighScore): number {
  const ae = isEmpty(a);
  const be = isEmpty(b);
  if (ae) return be ? 0 : 1; // empty records sort after non-empty ones
  if (be) return -1;

  const awinner = a.how === WINNING_HOW;
  const bwinner = b.how === WINNING_HOW;
  if (awinner !== bwinner) return awinner ? -1 : 1;

  if (a.pts !== b.pts) return a.pts > b.pts ? -1 : 1;
  return 0; // true tie: stable sort keeps current order
}

/**
 * highscore_where (score-util.c L276): the index a new (valid, non-empty)
 * entry would take in a best-first list. Ties prefer the NEW entry
 * (entry_pts >= score_pts). If it does not fit before any existing record it
 * takes the first free slot (list length while below the cap) or, when the
 * list is full, replaces the last record (index MAX_HISCORES - 1).
 */
export function highscoreWhere(
  entry: HighScore,
  scores: readonly HighScore[],
): number {
  const entryWinner = entry.how === WINNING_HOW;
  const entryPts = entry.pts;

  for (let i = 0; i < scores.length; i++) {
    const s = scores[i]!;
    const scoreWinner = s.how === WINNING_HOW;
    if (entryWinner !== scoreWinner) {
      if (entryWinner) return i;
      continue;
    }
    if (entryPts >= s.pts) return i;
  }

  // Did not fit before any record: first free slot, else replace the last.
  return scores.length < MAX_HISCORES ? scores.length : MAX_HISCORES - 1;
}

/**
 * highscore_add (score.c L72): insert an entry at its slot, shifting lower
 * records down and dropping anything past MAX_HISCORES. Mutates `scores` in
 * place (like the C on its array) and returns the slot used.
 *
 * The full-list case matches the C's memmove-with-zero-count: highscoreWhere
 * returns MAX_HISCORES - 1, splicing there pushes the old last record off the
 * end, and the truncation drops it - i.e. the last entry is replaced.
 */
export function highscoreAdd(entry: HighScore, scores: HighScore[]): number {
  const slot = highscoreWhere(entry, scores);
  scores.splice(slot, 0, entry);
  if (scores.length > MAX_HISCORES) scores.length = MAX_HISCORES;
  return slot;
}

/** highscore_count (score.c L84): number of real records. */
export function highscoreCount(scores: readonly HighScore[]): number {
  let n = 0;
  for (const s of scores) {
    if (isEmpty(s)) break; // empties are tail-only; stop at the first
    n++;
  }
  return n;
}

/**
 * highscore_regularize (score-util.c L199): force the list valid and ordered.
 * Invalid or empty records are dropped, and the remainder is stable-sorted
 * best-first (winners, then points, ties in place). Returns a NEW list plus a
 * flag reporting whether anything changed (the C's `irregular` return).
 */
export function highscoreRegularize(scores: readonly HighScore[]): {
  scores: HighScore[];
  irregular: boolean;
} {
  const kept: HighScore[] = [];
  let irregular = false;
  for (const s of scores) {
    if (!highscoreValid(s) || isEmpty(s)) {
      irregular = true; // an invalid/empty record in the body is an irregularity
      continue;
    }
    kept.push(s);
  }
  // Detect out-of-order before sorting (stable sort would otherwise hide it).
  for (let i = 1; i < kept.length; i++) {
    if (highscoreCmp(kept[i - 1]!, kept[i]!) > 0) {
      irregular = true;
      break;
    }
  }
  kept.sort(highscoreCmp);
  return { scores: kept, irregular };
}

/**
 * The outcome of enterScore: either entered (with its slot) or rejected with
 * the reason the C would msg() about. The C is void + msg(); the port returns
 * the decision so the shell owns the message.
 */
export type EnterScoreOutcome =
  | { entered: true; slot: number }
  | { entered: false; reason: "cheater" | "wizard" | "interrupted" | "retired" };

/**
 * The gating inputs enter_score checks (score.c L272). The port has no options
 * table or noscore flags on Player yet, so they arrive as an explicit seam
 * (defaults = a clean, scored character).
 */
export interface EnterScoreGating {
  /** Any OP_SCORE ("cheating") option is on (score.c L277 loop). */
  cheated?: boolean;
  /** p->noscore & (NOSCORE_WIZARD | NOSCORE_DEBUG): a wizard/debug character. */
  noscore?: boolean;
  /** p->total_winner: a winner is scored even when interrupted/retiring. */
  totalWinner?: boolean;
  /** p->died_from (score.c L299/L302): "Interrupting" / "Retiring" are gated. */
  diedFrom: string;
}

/**
 * enter_score (score.c L272): enter a character on the high-score table "if
 * legal". Cheaters, wizards/debug characters, and non-winning interrupted or
 * retiring deaths are not scored (in that priority order). Otherwise the entry
 * is built and added to the store's list.
 *
 * Faithful divergence from the C's read/add/write: here read/write go through
 * the injected ScoreStore, and highscoreAdd already truncates at MAX_HISCORES.
 */
export function enterScore(
  store: ScoreStore,
  player: Player,
  build: BuildScoreDeps,
  gating: EnterScoreGating,
): EnterScoreOutcome {
  if (gating.cheated) return { entered: false, reason: "cheater" };
  if (gating.noscore) return { entered: false, reason: "wizard" };
  if (!gating.totalWinner && gating.diedFrom === "Interrupting") {
    return { entered: false, reason: "interrupted" };
  }
  if (!gating.totalWinner && gating.diedFrom === "Retiring") {
    return { entered: false, reason: "retired" };
  }

  const entry = buildScore(player, build);
  const scores = store.read();
  const slot = highscoreAdd(entry, scores);
  store.write(scores);
  return { entered: true, slot };
}

/** The score range and highlight predict_score resolves for display. */
export interface PredictedScores {
  /** The score list to page over (the provisional entry inserted if alive). */
  scores: HighScore[];
  /** First index to show (from). */
  from: number;
  /** One past the last index to show (to). */
  to: number;
  /** The index to highlight (the current character), or -1 for none. */
  highlight: number;
}

/**
 * predict_score (ui-score.c L193): find where the current character sits and
 * pick the neighbourhood to show. A dead character is already in `scores`
 * (enter_score ran), so we only locate it (highscore_where); a live character
 * is provisionally inserted (highscore_add) so it appears in the table. On the
 * top ten we show ranks 1..15; otherwise a window around the entry.
 *
 * This is the DATA half; the shell (display_scores_aux) owns the paging loop.
 */
export function predictScore(
  scores: HighScore[],
  entry: HighScore,
  isDead: boolean,
): PredictedScores {
  const j = isDead
    ? highscoreWhere(entry, scores)
    : highscoreAdd(entry, scores);

  if (j < 10) {
    return { scores, from: 0, to: 15, highlight: j };
  }
  return { scores, from: j - 2, to: j + 7, highlight: j };
}
