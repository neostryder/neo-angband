/**
 * The game ANNOUNCING that it is about to use the terminal.
 *
 * WHY THIS EXISTS. `ScreenHost.invoke(id)` runs the game's own code for one of a
 * screen's `actions` while a mod's presenter is drawing that screen. Four of
 * those actions PROMPT - they put a question on the faithful terminal and wait
 * for an answer - and the presenter's overlay is on top of it. The player is
 * asked a question they cannot see, and the game waits. The worst of the four is
 * the character sheet's rename, which reaches `persistSave()`: a player pressing
 * 'c' and typing can rename their character and write the save with nothing at
 * all visible on screen.
 *
 * THE RULING THAT SHAPED THIS: prompts inside `invoke` are NOT forbidden. That
 * would make the actions a mod can offer a strict subset of the game's, which is
 * exactly the seam being given up. The prompt has to be allowed to happen and be
 * SEEN. So the game says what it is about to do, a presenter that can stand
 * aside does, and one that cannot hands the screen back.
 *
 * THIS MODULE IS THE VOCABULARY OF THAT SENTENCE and nothing else. What is being
 * asked (`label`), which action asked it (`action`), how much of the screen it
 * needs (`extent`) and the rectangle it will land in (`clip`).
 *
 * `clip` IS `RegionCells`, DELIBERATELY. #261 is building an ordered region
 * stack, and a prompt belongs in its top `system` band - the band reserved for
 * whatever the player uses to regain control. Sharing the rectangle type from
 * day one is what makes the two designs meet instead of collide; a private
 * `{x,y,w,h}` here would have to be converted at the seam, and a converter
 * between two spellings of the same rectangle is where the bugs live (see
 * `neo-angband-two-tile-engines`).
 *
 * NO BOUNDARY COPY ANYWHERE, and that is a decision rather than an omission.
 * `freezeView` and `snapshotHudFrame` copy field by field BECAUSE they are built
 * from live arrays that the next frame reuses - the copy is what stops a
 * presenter holding last frame's cells. A `PromptRequest` is built from string
 * constants and two numbers off `term.size()` and is thrown away when the prompt
 * closes; there is no live array behind it to be reused, so a copy would buy
 * nothing and would cost what that class of copy always costs: a field added
 * here and forgotten in the copy, silently dropped at the boundary, with every
 * test that inspects the live object still passing. Freezing is enough, and it
 * is what makes "the presenter cannot alter what the game announced" true.
 *
 * PURE. Nothing here reads a terminal or a game state - the same rule
 * `screen-view.ts` and `menu-view.ts` follow - so a request can be built and
 * asserted by a test with no canvas.
 */

import type { RegionCells } from "./regions";

/**
 * How much of the terminal the game is about to write on.
 *
 * TWO VALUES, because upstream's prompts are two shapes and a presenter does
 * genuinely different things with them. `line` is `prt(prompt, 0, 0)` and its
 * relatives - the file-name prompt, `get_string`, `get_check` - which own row 0
 * and leave the rest of the screen alone, so a presenter can keep drawing and
 * simply not cover the top row. `screen` is the ones that call `term.clear()`
 * first - `promptText`'s title/field/footer page, an entire nested modal - where
 * there is nothing to stay out of the way OF and the honest answer is to get
 * out of the way completely.
 */
export type PromptExtent = "line" | "screen";

/**
 * One announcement: the game is about to ask the player something on the
 * terminal, underneath whatever the presenter is drawing.
 *
 * `id` is stable and is the prompt's identity (`charsheet:rename`), so a
 * presenter can special-case one prompt without matching on prose. `action` is
 * the `ScreenAction.id` that led here, which is the handle the presenter already
 * has - it is the id it passed to `invoke`. `label` is the game's own wording,
 * for a presenter that wants to caption its own standing-aside.
 */
export interface PromptRequest {
  readonly id: string;
  readonly action: string;
  readonly extent: PromptExtent;
  readonly clip: RegionCells;
  readonly label: string;
}

/** The terminal geometry a request is cut from: `term.size()`, as an argument. */
export interface PromptSurfaceSize {
  readonly cols: number;
  readonly rows: number;
}

/**
 * Build one announcement, frozen - the object AND its `clip`.
 *
 * FROZEN AT CONSTRUCTION rather than at the boundary, because there is only one
 * producer and it is this: a request that reached a presenter unfrozen would
 * have come from somewhere that is not this function, which is a bug the freeze
 * would not have caught anyway. Freezing `clip` separately is not decoration -
 * `Object.freeze` is shallow, and the rectangle is the one field a presenter is
 * most likely to keep hold of and lay its own geometry out from.
 *
 * The rectangles: `line` is row 0 at the terminal's full width, which is where
 * `prt(prompt, 0, 0)` lands; `screen` is the whole grid, because that is what
 * `term.clear()` takes. Both start at the origin, so neither is a guess.
 */
export function promptRequest(
  id: string,
  action: string,
  extent: PromptExtent,
  label: string,
  size: PromptSurfaceSize,
): PromptRequest {
  return Object.freeze({
    id,
    action,
    extent,
    clip: Object.freeze({
      col: 0,
      row: 0,
      cols: size.cols,
      rows: extent === "line" ? 1 : size.rows,
    }),
    label,
  });
}
