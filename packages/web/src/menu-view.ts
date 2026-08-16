/**
 * A menu as a QUESTION with choices, rather than as rows on a grid.
 *
 * WHY THIS EXISTS. `registry:menu` has reached menu CONTENT since #138: a mod
 * can add, reorder, retitle and re-tag rows at the `selectFromMenu` choke point,
 * and every row already carries a stable id and a `MenuSemantics`. What no mod
 * could reach was how a menu is PRESENTED. `selectFromMenu` paints a lettered
 * single-column list, reads keys, and resolves - all of it inside one closure in
 * `overlay.ts` - so a console-RPG frame, a radial command dial or a floating
 * window with a detail pane was out of reach even though the rows were already
 * semantic. That is MOD_REACH gap 21's menu third, and this module is the data
 * half of the answer.
 *
 * THE SHAPE IS THE HUD'S, WITH ONE DIFFERENCE THAT CHANGES EVERYTHING. A HUD
 * section is drawn; a menu is ASKED. So the consumer boundary is not
 * `present(frame)` but `ask(question) -> answer`: whoever takes a menu owns its
 * input too, because a presentation that could not accept a choice would not be
 * a presentation of a menu. That is also why a presenter may DECLINE one
 * question and take the next - a radial dial for the six command verbs has no
 * opinion about the mod manager's thirty-row list, and forcing it to have one
 * would make the seam unusable for the case it exists for.
 *
 * IDS, NOT INDICES. A choice is accepted by its stable `id`. An index is a fact
 * about a layout, and a presenter that reorders or groups its choices - which is
 * the whole point - has no index the game would recognise. `selectFromMenu`
 * already maps ids back to the caller's own source position, because a
 * `registry:menu` transformer could already reorder rows before any of this.
 *
 * WHAT IS DELIBERATELY NOT HERE: geometry. A menu has no published region yet -
 * `regions.ts` names `messages` / `sidebar` / `map` / `status`, all of which tile
 * the screen, and a floating menu is by definition one that OVERLAPS. Regions
 * that overlap, are ordered, and can be created by a mod are the next step of
 * gap 21; until then a presenter positions itself and `style` tells it whether
 * the game would have cleared the screen or drawn a box over the map.
 *
 * PURE. Nothing here reads a terminal or a game state, so a question can be
 * built and answered by a test with no canvas.
 */

import type { MenuSemantics } from "@rpgm-tools/neo-angband-core";

/** One thing the player may choose. */
export interface MenuChoice {
  /**
   * Stable identity, never a display string. This is what an answer names, and
   * what survives a presenter grouping the choices into wedges of a dial.
   */
  readonly id: string;
  /** What this choice MEANS, independent of its label or the current layout. */
  readonly semantic: MenuSemantics;
  /** The game's own wording for it. */
  readonly label: string;
  /** The faithful terminal's colour for the label, as CSS. Its projection. */
  readonly color?: string;
  /** Shown, but not choosable: a spell too high level, an item that cannot be used. */
  readonly disabled: boolean;
  /**
   * The letter the faithful terminal offers for this choice, where the game
   * fixed one (`option_actions[]`'s stable a/b/d/h). Absent means the terminal
   * would have used the row's position, which is a layout fact and not yours.
   */
  readonly tag?: string;
  /** One line of help for this choice while it is under the cursor. */
  readonly hint?: string;
  /** A right-hand annotation the terminal draws in its own colour. */
  readonly suffix?: { readonly text: string; readonly color: string; readonly col: number };
  /** The object's inscription, for the item pickers that allow `@`-tag select. */
  readonly inscrip?: string | null;
}

/** One line of the detail pane for the choice under the cursor. */
export interface MenuDetailLine {
  readonly text: string;
  readonly color?: string;
  readonly runs?: readonly { readonly text: string; readonly color: string }[];
}

/**
 * A key the CALLER handles itself, above choosing.
 *
 * The store's p/g buy and s/d sell, the death screen's Ctrl-X, the birth
 * screen's '='. A presenter that shows none of these is not broken - it just
 * offers fewer ways out than the terminal does - but a presenter reimagining a
 * store had better offer "buy", and it cannot invent the key.
 */
export interface MenuCommandKey {
  readonly key: string;
  /** True for a control chord (Ctrl-X); `key` is named unmodified and lower case. */
  readonly ctrl: boolean;
}

/**
 * One question the game is asking, with everything needed to ask it another way.
 */
export interface MenuQuestion {
  /**
   * The stable menu id - the same one `registry:menu` transformers key on
   * (`game:main`, `store:command`, `birth:race`). Match on this to decide
   * whether you have a better way to ask THIS question.
   */
  readonly id: string;
  readonly title: string;
  /** A one-line subtitle under the title, where the game has one. */
  readonly subtitle?: string;
  /** The game's own key legend. Wrong for a presenter with different keys - it
   *  is here to be replaced, not repeated. */
  readonly footer: string;
  readonly choices: readonly MenuChoice[];
  /**
   * `screen` - the game would have cleared the terminal for this.
   * `overlay` - it would have drawn a box over the map and left the dungeon
   * visible beside it (upstream's item picker never blanks the level to ask
   * which book you meant).
   */
  readonly style: "screen" | "overlay";
  /** Which choice the game would start on. An index into `choices`. */
  readonly cursor: number;
  /**
   * Read-only: choosing re-displays rather than resolving, and only cancelling
   * exits (the ability browser). Answering `choose` here is refused.
   */
  readonly browseOnly: boolean;
  /** The command keys the caller handles itself; see `MenuCommandKey`. */
  readonly commands: readonly MenuCommandKey[];
  /**
   * The detail pane for one choice, by its index in `choices`.
   *
   * A CALL BACK INTO THE GAME, and the one thing in a question that is not
   * frozen data: the pane is computed per cursor position (a spell's failure
   * rate, a mod's description) and materialising all of them up front would run
   * work for choices nobody looks at. Safe to call as often as the cursor moves,
   * and it returns an empty list where the game has no pane.
   */
  detail(index: number): readonly MenuDetailLine[];
}

/**
 * What a presenter answers with.
 *
 * `cancel` is ESC. `choose` names a choice by id. `command` runs one of
 * `question.commands` - the caller's own handler, exactly as the key would - and
 * the question is then asked again unless that handler resolved it. `options` is
 * the birth screen's '=', which closes the menu so the caller can open a
 * sub-flow and re-ask.
 */
export type MenuAnswer =
  | { readonly kind: "choose"; readonly choice: string }
  | { readonly kind: "cancel" }
  | { readonly kind: "command"; readonly key: string; readonly ctrl?: boolean; readonly cursor: number }
  | { readonly kind: "options" };

/**
 * The consumer boundary for menus: one owner for all of them, asked per question.
 *
 * Returning `undefined` DECLINES this question and the game asks it its own way.
 * That is the expected case, not a failure - see the module header.
 */
export interface MenuPresenter {
  ask(question: MenuQuestion): Promise<MenuAnswer | undefined> | MenuAnswer | undefined;
}

/** The rows a question is built from: `MenuItem` after transformers have run. */
export interface MenuQuestionRow {
  readonly id?: string;
  readonly semantic?: MenuSemantics;
  readonly label: string;
  readonly color?: string;
  readonly disabled?: boolean;
  readonly tag?: string;
  readonly hint?: string;
  readonly suffix?: { readonly text: string; readonly color: string; readonly col: number };
  readonly inscrip?: string | null;
}

/** Everything `buildMenuQuestion` needs, as values. */
export interface MenuQuestionParams {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly footer: string;
  readonly rows: readonly MenuQuestionRow[];
  readonly style: "screen" | "overlay";
  readonly cursor: number;
  readonly browseOnly: boolean;
  readonly commandKeys: readonly string[];
  readonly ctrlCommandKeys: readonly string[];
  readonly optionsKey?: string;
  readonly detail?: (index: number) => readonly MenuDetailLine[];
}

/**
 * One question, frozen, from the rows the game was about to paint.
 *
 * Frozen for the reason `snapshotHudFrame` copies: a presenter may hold a
 * question while it animates, and what crossed the boundary must not be an array
 * the next menu reuses. `detail` is the one live edge and says so.
 *
 * A row with no id gets one from its position. That only happens for the legacy
 * two-argument `selectFromMenu` overload used by renderer tests; production
 * callers all declare ids, and a question with a duplicate id would make an
 * answer ambiguous, so the position is appended rather than substituted.
 */
export function buildMenuQuestion(p: MenuQuestionParams): MenuQuestion {
  const detail = p.detail;
  const commands: MenuCommandKey[] = [
    ...p.commandKeys.map((key) => ({ key, ctrl: false })),
    ...p.ctrlCommandKeys.map((key) => ({ key, ctrl: true })),
  ];
  /* The birth screen's '=' is a command from a presenter's point of view - a key
   * that does something other than choose - even though the host answers it with
   * its own sentinel rather than by calling a handler. Hiding it would leave a
   * reimagined birth screen with no way to reach the birth options. */
  if (p.optionsKey !== undefined) commands.push({ key: p.optionsKey, ctrl: false });
  return Object.freeze({
    id: p.id,
    title: p.title,
    ...(p.subtitle === undefined ? {} : { subtitle: p.subtitle }),
    footer: p.footer,
    choices: Object.freeze(p.rows.map((row, index) => menuChoice(row, index, p.id))),
    style: p.style,
    cursor: p.cursor,
    browseOnly: p.browseOnly,
    commands: Object.freeze(commands),
    detail: (index: number) => (detail ? freezeDetail(detail(index)) : []),
  });
}

function menuChoice(row: MenuQuestionRow, index: number, menuId: string): MenuChoice {
  return Object.freeze({
    id: row.id ?? `${menuId}:row:${index}`,
    semantic: Object.freeze(row.semantic ?? { kind: "choice", ref: index }),
    label: row.label,
    ...(row.color === undefined ? {} : { color: row.color }),
    disabled: row.disabled === true,
    ...(row.tag === undefined ? {} : { tag: row.tag }),
    ...(row.hint === undefined ? {} : { hint: row.hint }),
    ...(row.suffix === undefined ? {} : { suffix: Object.freeze({ ...row.suffix }) }),
    ...(row.inscrip === undefined ? {} : { inscrip: row.inscrip }),
  });
}

/**
 * A detail pane the presenter owns, so a game object that happens to be mutable
 * cannot be reached back through it.
 *
 * Built per call rather than cached: the pane's whole reason for being a callback
 * is that it changes with the cursor, and a cache keyed on the index would go
 * stale exactly when the caller repaints for a reason other than a cursor move.
 */
function freezeDetail(lines: readonly MenuDetailLine[]): readonly MenuDetailLine[] {
  return Object.freeze(
    lines.map((line) =>
      Object.freeze({
        text: line.text,
        ...(line.color === undefined ? {} : { color: line.color }),
        ...(line.runs === undefined
          ? {}
          : { runs: Object.freeze(line.runs.map((run) => Object.freeze({ ...run }))) }),
      }),
    ),
  );
}
