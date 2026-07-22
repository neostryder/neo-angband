/**
 * Web high-score wiring: the platform half of the score subsystem.
 *
 * The core (packages/core/src/score) owns the scoring math, table ordering,
 * gating, and row formatting; this module supplies the two platform concerns
 * the core deliberately does not touch:
 *
 *  1. PERSISTENCE - a ScoreStore backed by localStorage (JSON), the JSON-store
 *     seam replacing score.c's binary scores.raw file, its lock file and the
 *     setuid dance. The stored list is the compact HighScore[] (best-first).
 *  2. THE SCREEN - rendering scorePageRows to the glyph terminal and driving
 *     the paging/scroll/keypress loop (display_scores_aux, ui-score.c L117).
 *
 * With nothing stored the store returns an empty list and the screen shows an
 * empty Hall of Fame - it degrades gracefully.
 */

import {
  highscoreRegularize,
  scorePageRows,
  buildScore,
  predictScore,
  MAX_HISCORES,
  SCORES_PER_PAGE,
  SCORE_DETAIL_INDENT,
  colorToCss,
} from "@neo-angband/core";
import { UI_TEXT, UI_DIM } from "./ui-colors";
import type {
  HighScore,
  ScoreStore,
  ScoreRow,
  ScoreNameResolver,
  Player,
  BuildScoreDeps,
} from "@neo-angband/core";
import type { GlyphTerm } from "./term";

/** Version-name shown in the page title (ui-score.c VERSION_NAME). */
const VERSION_NAME = "Neo Angband";

/**
 * A ScoreStore persisting the compact score list as JSON in localStorage. The
 * stored value is regularized on read (highscore_regularize) so a corrupted or
 * out-of-order blob still yields a valid, ordered list - the same defensive
 * posture as highscore_read's regularize-on-load.
 */
export function createLocalStorageScoreStore(
  key = "neo-angband-scores",
): ScoreStore {
  return {
    read(): HighScore[] {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(key);
      } catch {
        return []; // storage unavailable (private mode, etc.) -> empty table
      }
      if (!raw) return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
      if (!Array.isArray(parsed)) return [];
      // Trust the shape loosely; regularize drops anything invalid.
      const { scores } = highscoreRegularize(parsed as HighScore[]);
      return scores.slice(0, MAX_HISCORES);
    },
    write(scores: HighScore[]): void {
      try {
        localStorage.setItem(key, JSON.stringify(scores.slice(0, MAX_HISCORES)));
      } catch {
        /* storage full / unavailable - scores are a nicety, never fatal */
      }
    },
  };
}

/** Build a ScoreNameResolver from a player registry (race/class index -> name). */
export function registryNameResolver(reg: {
  races: readonly { name: string }[];
  classes: readonly { name: string }[];
}): ScoreNameResolver {
  return {
    raceName: (i) => reg.races[i]?.name ?? null,
    className: (i) => reg.classes[i]?.name ?? null,
  };
}

/**
 * The score screen: renders the Hall of Fame to the terminal and runs the
 * paging/scroll loop of display_scores_aux (ui-score.c L117). Resolves when the
 * user presses Escape. `highlight` is the index to draw in light green (or -1).
 *
 * Faithful behaviour preserved:
 *  - 5 entries per page (SCORES_PER_PAGE), each 3 lines + a blank (4 rows).
 *  - Title at row 0: "<from position N>" when scrolled in, else centered.
 *  - ARROW_UP pages back (only when allowScrolling); any other key pages
 *    forward, wrapping to the top at the end when scrolling, else exiting.
 */
export function showScoreScreen(
  term: GlyphTerm,
  scores: readonly HighScore[],
  names: ScoreNameResolver,
  options: {
    from?: number;
    to?: number;
    highlight?: number;
    allowScrolling?: boolean;
  } = {},
): Promise<void> {
  const allowScrolling = options.allowScrolling ?? true;
  let from = options.from ?? 0;
  let to = options.to ?? (allowScrolling ? SCORES_PER_PAGE : 10);
  const highlight = options.highlight ?? -1;
  if (from < 0) from = 0;
  if (to > MAX_HISCORES) to = MAX_HISCORES;

  // Count real records (display_scores_aux L129 loop).
  let count = Math.min(scores.length, MAX_HISCORES);
  if (count > to && !allowScrolling) count = to;

  return new Promise<void>((resolve) => {
    let k = from;

    const paint = (): void => {
      term.clear();
      // Title (display_scores_aux L146).
      if (k > 0) {
        term.print(
          21,
          0,
          `${VERSION_NAME} Hall of Fame (from position ${k + 1})`,
          UI_TEXT,
        );
      } else {
        term.print(30, 0, `${VERSION_NAME} Hall of Fame`, UI_TEXT);
      }

      const rows: ScoreRow[] = scorePageRows(scores, k, count, highlight, names);
      rows.forEach((row, n) => {
        const css = colorToCss(row.color);
        term.print(0, n * 4 + 2, row.line1, css);
        term.print(SCORE_DETAIL_INDENT, n * 4 + 3, row.line2, css);
        term.print(SCORE_DETAIL_INDENT, n * 4 + 4, row.line3, css);
      });

      const prompt = allowScrolling
        ? "[Press ESC to exit, up for prior page, any other key for next page.]"
        : "[Press ESC to exit, any other key to page forward till done.]";
      term.print(allowScrolling ? 6 : 9, 23, prompt, UI_DIM);
    };

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      if (ev.key === "Escape") {
        window.removeEventListener("keydown", onKey);
        resolve();
        return;
      }
      if (ev.key === "ArrowUp" && allowScrolling) {
        if (k === 0) {
          k = count - SCORES_PER_PAGE;
          while (k % SCORES_PER_PAGE) k++;
        } else if (k < SCORES_PER_PAGE) {
          k = 0;
        } else {
          k = k - SCORES_PER_PAGE;
        }
      } else {
        k += SCORES_PER_PAGE;
        if (k >= count) {
          if (allowScrolling) {
            k = 0;
          } else {
            window.removeEventListener("keydown", onKey);
            resolve();
            return;
          }
        }
      }
      paint();
    };

    window.addEventListener("keydown", onKey);
    paint();
  });
}

/**
 * predict_score (ui-score.c L193): show the current character's neighbourhood
 * in the table. Builds the provisional entry (build_score with "nobody (yet!)"
 * when alive), resolves the window, and runs the screen.
 */
export function showPredictedScores(
  term: GlyphTerm,
  store: ScoreStore,
  player: Player,
  build: Omit<BuildScoreDeps, "diedFrom" | "deathTime"> & {
    diedFrom?: string;
    deathTime?: Date | null;
  },
  names: ScoreNameResolver,
  isDead: boolean,
): Promise<void> {
  const scores = store.read();
  const entry = buildScore(player, {
    ...build,
    diedFrom: build.diedFrom ?? "nobody (yet!)",
    ...(isDead ? { deathTime: build.deathTime ?? new Date() } : {}),
  });
  const p = predictScore(scores, entry, isDead);
  return showScoreScreen(term, p.scores, names, {
    from: p.from,
    to: p.to,
    highlight: p.highlight,
    allowScrolling: true,
  });
}
