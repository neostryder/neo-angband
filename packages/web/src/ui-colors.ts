/**
 * UI chrome colours, routed through the ported z-color table (core/color.ts)
 * (reference/src/z-color.c:30-60) so every web surface draws from the SAME
 * palette the C oracle uses. No
 * invented pastel hex may appear in the shell: the palette-lint test
 * (ui-colors.test.ts) fails the build if any UI source uses a #rrggbb literal
 * outside COLOR_TABLE.
 *
 * The semantic assignments are anchored to the reference, not chosen by eye:
 *   - curs_attrs[2][2] (reference/src/ui-menu.c:29-32):
 *       valid  row: { COLOUR_WHITE, COLOUR_L_BLUE }  (normal, cursor)
 *       greyed row: { COLOUR_SLATE, COLOUR_BLUE   }  (normal, cursor)
 *   - menu title / header / prompt: COLOUR_WHITE (reference/src/ui-menu.c:603-611).
 *   - QUESTION hint / emphasis: COLOUR_YELLOW (reference/src/ui-birth.c:795).
 *   - "-more-" prompt: COLOUR_L_BLUE (== #00ffff), per WO-5/REND-2.
 *   - terminal background: COLOUR_DARK (reference/src/z-color.c:32); terms are black.
 */
import {
  colorToCss,
  COLOUR_WHITE,
  COLOUR_L_BLUE,
  COLOUR_SLATE,
  COLOUR_BLUE,
  COLOUR_YELLOW,
  COLOUR_DARK,
  COLOUR_L_GREEN,
  COLOUR_L_RED,
} from "@rpgm-tools/neo-angband-core";

/** Titles, headers, labels, footers, and normal (non-cursor) menu/body text. */
export const UI_TEXT = colorToCss(COLOUR_WHITE);
/** Secondary / de-emphasised / disabled / hint text (greyed non-cursor row). */
export const UI_DIM = colorToCss(COLOUR_SLATE);
/** The selected / cursor row (valid-row cursor colour). */
export const UI_CURSOR = colorToCss(COLOUR_L_BLUE);
/** The "-more-" pager prompt (reference/src/ui-input.c:390). */
export const UI_MORE = colorToCss(COLOUR_L_BLUE);
/** A disabled row under the cursor (greyed-row cursor colour). */
export const UI_CURSOR_DISABLED = colorToCss(COLOUR_BLUE);
/** Gold headings and highlighted values (QUESTION hint colour). */
export const UI_GOLD = colorToCss(COLOUR_YELLOW);
/** The terminal background (empty cell / canvas clear). */
export const UI_BG = colorToCss(COLOUR_DARK);
/** Positive / enabled status; C uses COLOUR_L_GREEN for positive values (ui-display.c:165). */
export const UI_GOOD = colorToCss(COLOUR_L_GREEN);
/** Negative / dangerous status; C uses COLOUR_L_RED for warning values (ui-display.c:389). */
export const UI_BAD = colorToCss(COLOUR_L_RED);
