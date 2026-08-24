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

import { inputEvents } from "./input-door";
import {
  highscoreRegularize,
  scorePageRows,
  scoreRows,
  buildScore,
  predictScore,
  MAX_HISCORES,
  SCORES_PER_PAGE,
  SCORE_DETAIL_INDENT,
  colorToCss,
} from "@rpgm-tools/neo-angband-core";
import { UI_TEXT, UI_DIM } from "./ui-colors";
import { hallOfFameFooter, hallOfFameScreen, hallOfFameTitle } from "./screens";
import { screenFault, screenRegionSpec } from "./overlay";
import { ScreenAbandoned, showThroughPresenter } from "./screen-runtime";
import { popRegion, pushRegion, regionSurface } from "./ui-stack";
import type {
  HighScore,
  ScoreStore,
  ScoreRow,
  ScoreNameResolver,
  Player,
  BuildScoreDeps,
} from "@rpgm-tools/neo-angband-core";
import type { GridPointerInput, GridSurface } from "./term";

/** The Storage subset the score store uses (localStorage in the browser). */
export interface ScoreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Platform wiring for the store: where to write, and how to report failure. */
export interface ScoreStoreDeps {
  /**
   * msg(). highscore_write REPORTS every failure to the player (score.c
   * L126-169) - eight distinct messages - so the writer needs the message line.
   * Omitted, the failures are silent, which is what this module used to do.
   */
  msg?: ((text: string) => void) | undefined;
  /** The backing storage; defaults to localStorage. */
  storage?: ScoreStorage | undefined;
}

/**
 * A ScoreStore persisting the compact score list as JSON in browser storage,
 * ported from score.c's highscore_read / highscore_write - INCLUDING the parts
 * that used to be dismissed as filesystem trivia.
 *
 * Upstream does not simply write scores.raw. It takes a lock, writes
 * scores.new, rotates scores.raw to scores.old, renames scores.new into place,
 * and drops the lock - and it has a message for every step that can fail. Every
 * one of those steps has an honest analogue here, because storage keys are as
 * shared and as failure-prone as files:
 *
 *   scores.lok  ->  <key>.lok   a second TAB writing the same table
 *   scores.new  ->  <key>.new   the staged write
 *   scores.old  ->  <key>.old   the rotated previous table
 *   scores.raw  ->  <key>       the live table
 *
 * file_close's flush is the one step with no direct counterpart, so it becomes
 * the read-back: a quota-truncated or evicted setItem is only detectable by
 * reading the value back, and that is exactly the failure the old code hid
 * behind an empty catch ("scores are a nicety, never fatal"). They are not a
 * nicety - a lost write silently drops a character's only record of the run.
 *
 * The stored value is regularized on read (highscore_regularize) so a corrupted
 * or out-of-order blob still yields a valid, ordered list - the same defensive
 * posture as highscore_read's regularize-on-load.
 *
 * WART KEPT (score.c L123-128): a lock left behind by a crash blocks every
 * later write, with no way to clear it from inside the game. Upstream has the
 * same trap; core keeps it.
 */
export function createLocalStorageScoreStore(
  key = "neo-angband-scores",
  deps: ScoreStoreDeps = {},
): ScoreStore {
  const store: ScoreStorage | null = deps.storage ?? safeLocalStorage();
  const msg = deps.msg ?? ((): void => undefined);

  const CUR = key;
  const NEW = `${key}.new`;
  const OLD = `${key}.old`;
  const LOK = `${key}.lok`;

  /** file_read: null when the key is absent or storage is unavailable. */
  const get = (k: string): string | null => {
    if (!store) return null;
    try {
      return store.getItem(k);
    } catch {
      return null;
    }
  };

  /** file_open(MODE_WRITE) + file_write: false when the write did not happen. */
  const put = (k: string, v: string): boolean => {
    if (!store) return false;
    try {
      store.setItem(k, v);
      return true;
    } catch {
      return false; /* quota exceeded / storage disabled */
    }
  };

  /** file_delete: false when the key is still there afterwards. */
  const drop = (k: string): boolean => {
    if (!store) return false;
    try {
      store.removeItem(k);
    } catch {
      return false;
    }
    return get(k) === null;
  };

  /** file_move. */
  const move = (from: string, to: string): boolean => {
    const v = get(from);
    if (v === null) return false;
    if (!put(to, v)) return false;
    return drop(from);
  };

  return {
    read(): HighScore[] {
      const raw = get(CUR);
      if (!raw) return [];
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
      if (!Array.isArray(parsed)) return [];
      /* highscore_read gets fixed-size binary records, so upstream's only
       * corruption case is a short read; a JSON store can hand back null, a
       * number or a record with no fields at all, and highscoreRegularize
       * reads `what` unguarded. Drop non-records here - the representation is
       * the platform's, so guarding it is the platform's job - then let
       * regularize (score.c L63) reject the rest. */
      const rows = (parsed as unknown[]).filter(
        (r): r is HighScore =>
          typeof r === "object" && r !== null && typeof (r as HighScore).what === "string",
      );
      const { scores } = highscoreRegularize(rows);
      return scores.slice(0, MAX_HISCORES);
    },

    /** highscore_write (score.c L98-176), step for step. */
    write(scores: HighScore[]): void {
      const json = JSON.stringify(scores.slice(0, MAX_HISCORES));

      /* Lock scores (L121-128). */
      if (get(LOK) !== null) {
        msg("Lock file in place for scorefile; not writing.");
        return;
      }
      if (!put(LOK, "neo-angband")) {
        msg("Failed to create lock for scorefile; not writing.");
        return;
      }

      /* Open the new file for writing (L141-154). */
      if (!put(NEW, "")) {
        msg("Failed to open new scorefile for writing.");
        drop(LOK);
        return;
      }

      /* file_write (L156-166). */
      if (!put(NEW, json)) {
        msg("Failed to write new scores.");
        drop(LOK);
        drop(NEW);
        return;
      }

      /* file_close - here, the read-back that proves it landed (L168-176). */
      if (get(NEW) !== json) {
        msg("Failed to close new scores.");
        drop(LOK);
        drop(NEW);
        return;
      }

      /* Now move things around (L178-191). */
      if (get(OLD) !== null && !drop(OLD)) {
        msg("Couldn't delete old scorefile");
        drop(NEW);
      } else if (get(CUR) !== null && !move(CUR, OLD)) {
        msg("Couldn't move old scores.raw out of the way");
        drop(NEW);
      } else if (!move(NEW, CUR)) {
        msg("Couldn't rename new scorefile to scores.raw");
        move(OLD, CUR);
        drop(NEW);
      }

      /* Remove the lock (L193-195). */
      drop(LOK);
    },
  };
}

/** localStorage, or null where touching it throws (private mode, no DOM). */
function safeLocalStorage(): ScoreStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
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
 * The score screen: the Hall of Fame, offered to the installed screen presenter
 * first and drawn on the faithful terminal otherwise. Resolves when the user
 * presses Escape. `highlight` is the index to draw in light green (or -1).
 *
 * THE SEAM. This was the highest-value screen in the game for a UI-replacing mod
 * and the one screen a mod could not reach at all: `paint` called `term.clear()`
 * and `term.print()` directly and `showThroughPresenter` appeared nowhere in the
 * file, so a leaderboard - the first thing anybody rebuilds - could not even have
 * its frame reskinned. The model is `hallOfFameScreen` in `screens.ts`; this file
 * is the two ways of showing it.
 *
 * NO HOST AND NO ACTIONS, unlike the monster list and the character sheet: there
 * is no command on this screen, only paging, and the view a presenter is handed
 * carries EVERY record rather than the five the terminal has room for. Paging is
 * the terminal's answer to fitting three-line records onto 24 rows, not something
 * the game does on a mod's behalf.
 *
 * Faithful behaviour preserved:
 *  - 5 entries per page (SCORES_PER_PAGE), each 3 lines + a blank (4 rows).
 *  - Title at row 0: "<from position N>" when scrolled in, else centered.
 *  - ARROW_UP pages back (only when allowScrolling); any other key pages
 *    forward, wrapping to the top at the end when scrolling, else exiting.
 */
export function showScoreScreen(
  term: GridSurface & GridPointerInput,
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

  const view = hallOfFameScreen(scoreRows(scores, 0, count, highlight, names), {
    from,
    allowScrolling,
  });
  const taken = showThroughPresenter(view, screenFault);
  if (taken) {
    return taken.catch((error: unknown) => {
      /* The presenter died with the table open. It is already reported and the
       * seam is already out; all that is left is to show the player the screen
       * they asked for. */
      if (!(error instanceof ScreenAbandoned)) throw error;
      return showScoresOnTerminal();
    });
  }
  return showScoresOnTerminal();

  /** The faithful terminal's own Hall of Fame; see `showScoreScreen`. */
  function showScoresOnTerminal(): Promise<void> {
    const handle = pushRegion(screenRegionSpec(), term.size());
    const surface = regionSurface(term, handle.cells);
    return new Promise<void>((resolve) => {
      let k = from;

      const paint = (): void => {
        surface.clear();
        /* Title (display_scores_aux L146). Its two forms are `hallOfFameTitle`, the
         * same string the view publishes, so the two cannot disagree about the
         * wording; the COLUMN each is centred at is the C's own literal. */
        if (k > 0) {
          surface.print(21, 0, hallOfFameTitle(k), UI_TEXT);
        } else {
          surface.print(30, 0, hallOfFameTitle(0), UI_TEXT);
        }

        const rows: ScoreRow[] = scorePageRows(scores, k, count, highlight, names);
        rows.forEach((row, n) => {
          const css = colorToCss(row.color);
          surface.print(0, n * 4 + 2, row.line1, css);
          surface.print(SCORE_DETAIL_INDENT, n * 4 + 3, row.line2, css);
          surface.print(SCORE_DETAIL_INDENT, n * 4 + 4, row.line3, css);
        });

        surface.print(allowScrolling ? 6 : 9, 23, hallOfFameFooter(allowScrolling), UI_DIM);
      };

      const onKey = (ev: KeyboardEvent): void => {
        ev.preventDefault();
        if (ev.key === "Escape") {
          inputEvents.removeEventListener("keydown", onKey);
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
              inputEvents.removeEventListener("keydown", onKey);
              resolve();
              return;
            }
          }
        }
        paint();
      };

      inputEvents.addEventListener("keydown", onKey);
      paint();
    }).finally(() => {
      popRegion(handle);
    });
  }
}

/**
 * predict_score (ui-score.c L193): show the current character's neighbourhood
 * in the table. Builds the provisional entry (build_score with "nobody (yet!)"
 * when alive), resolves the window, and runs the screen.
 *
 * NOTHING IS WRITTEN. predict_score's parameter is display_scores_aux's
 * `allow_scrolling`, not a write flag: a live character is inserted into the
 * list `store.read()` handed back and that list is dropped when the screen
 * closes, so this is a preview in every case. The score table is only ever
 * written by `enterScore`, at a real death. `allowScrolling` false is the form
 * close_game uses on the way out of a living game (ui-game.c:1158) - the pages
 * run forward and the screen ends at the last one instead of wrapping to the
 * top; true is the Hall of Fame command (show_scores, ui-score.c:216).
 */
export function showPredictedScores(
  term: GridSurface & GridPointerInput,
  store: ScoreStore,
  player: Player,
  build: Omit<BuildScoreDeps, "diedFrom" | "deathTime"> & {
    diedFrom?: string;
    deathTime?: Date | null;
  },
  names: ScoreNameResolver,
  isDead: boolean,
  allowScrolling = true,
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
    allowScrolling,
  });
}
