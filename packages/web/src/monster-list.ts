/**
 * The "list visible monsters" screen ('[', ui-mon-list.c).
 *
 * A MODULE rather than a closure in `main.ts` for the reason `charsheet.ts` is
 * one: this screen has an ACTION, so it needs a `ScreenHost`, and a seam that
 * only exists inside the game's entry point is a seam nothing can drive. The
 * character sheet's host wiring was untestable for exactly as long as it lived
 * in main.ts.
 *
 * The model is in `screens.ts` (`monsterListScreen`); this file is the two ways
 * of SHOWING it - offered to a presenter first, drawn on the faithful terminal
 * otherwise.
 */

import type { GridSurface, GridPointerInput } from "./term";
import { setActiveCellTap } from "./term";
import { inputEvents } from "./input-door";
import { menuNav, screenFault } from "./overlay";
import { ScreenAbandoned, showThroughPresenter } from "./screen-runtime";
import type { ScreenHost, ScreenView } from "./screen-view";
import {
  monsterListScreen,
  monsterListScreenLines,
  monsterListFooter,
  MONSTER_LIST_TITLE,
} from "./screens";
import { UI_TEXT, UI_DIM } from "./ui-colors";
import type { GameState } from "@rpgm-tools/neo-angband-core";

/**
 * do_cmd_monlist ('[', monster_list_show_interactive L388): the LOS/ESP sections
 * with counts, asleep tags and single-monster offsets. 'x' toggles sort-by-
 * experience (L410,456); the arrows / PageUp-Down scroll; ESC/Enter/Space (or a
 * footer tap) closes. Pure display - no turn, no RNG, no autosave.
 *
 * THE SEAM. A presenter is offered the list before the terminal draws it, and
 * `host` is how it reaches the one command the footer names: 'x' flips the sort
 * and the GAME re-sorts and hands back the new view, so the mod never has to know
 * what "by experience" means. `showTextScreen` cannot serve this screen - it has
 * no host, and no way to spell a footer that changes with the state.
 */
export function showMonsterList(
  term: GridSurface & GridPointerInput,
  state: GameState,
): Promise<void> {
  let sortExp = false;
  const viewFor = (): ScreenView => monsterListScreen(state, term.size().cols, sortExp);
  const host: ScreenHost = {
    invoke: (id: string): Promise<ScreenView | undefined> => {
      /* An unknown id is a no-op returning the current view, never an error: a
       * presenter written against a later engine must not be able to close the
       * player's list by asking for a command this one has not got. */
      if (id === "sort-exp") sortExp = !sortExp;
      return Promise.resolve(viewFor());
    },
  };
  const taken = showThroughPresenter(viewFor(), screenFault, host);
  if (taken) {
    return taken.catch((error: unknown) => {
      /* The presenter died with the list open. It is already reported and the
       * seam is already out; all that is left is to show the player the screen
       * they asked for - with whichever sort they had reached. */
      if (!(error instanceof ScreenAbandoned)) throw error;
      return showMonsterListOnTerminal(term, state, sortExp);
    });
  }
  return showMonsterListOnTerminal(term, state, sortExp);
}

/** The faithful terminal's own visible-monster list; see `showMonsterList`. */
function showMonsterListOnTerminal(
  term: GridSurface & GridPointerInput,
  state: GameState,
  initialSortExp: boolean,
): Promise<void> {
  return new Promise<void>((resolve) => {
    let sortExp = initialSortExp;
    let top = 0;
    const HEADER_ROW = 0;
    const BODY_TOP = 1;
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      const lines = monsterListScreenLines(state, cols, sortExp);
      term.print(0, HEADER_ROW, MONSTER_LIST_TITLE.slice(0, cols - 1), UI_TEXT);
      const bodyRows = rows - BODY_TOP - 1;
      const maxTop = Math.max(0, lines.length - bodyRows);
      if (top > maxTop) top = maxTop;
      for (let r = 0; r < bodyRows; r++) {
        const line = lines[top + r];
        if (!line) break;
        if (line.runs) {
          let x = 0;
          for (const run of line.runs) {
            if (x >= cols - 1) break;
            const chunk = run.text.slice(0, cols - 1 - x);
            term.print(x, BODY_TOP + r, chunk, run.color);
            x += chunk.length;
          }
        } else {
          term.print(0, BODY_TOP + r, line.text.slice(0, cols - 1), line.color ?? UI_TEXT);
        }
      }
      term.print(0, rows - 1, monsterListFooter(sortExp).slice(0, cols - 1), UI_DIM);
    };
    const finish = (): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      resolve();
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      const { rows } = term.size();
      const page = Math.max(1, rows - BODY_TOP - 2);
      if (ev.key === "Escape" || ev.key === "Enter" || ev.key === " ") {
        finish();
        return;
      }
      if (ev.key === "x" || ev.key === "X") {
        sortExp = !sortExp;
        top = 0;
        paint();
        return;
      }
      // Arrows AND numpad digits scroll (menuNav), so the numpad is not dead
      // in this list when NumLock is on.
      const nav = menuNav(ev);
      if (!nav) return;
      if (nav === "up") top = Math.max(0, top - 1);
      else if (nav === "down") top += 1;
      else if (nav === "pageup") top = Math.max(0, top - page);
      else if (nav === "pagedown") top += page;
      else if (nav === "home") top = 0;
      else if (nav === "end") top += page; // clamped in paint()
      paint();
    };
    inputEvents.addEventListener("keydown", onKey, true);
    setActiveCellTap(term, () => finish());
    paint();
  });
}
