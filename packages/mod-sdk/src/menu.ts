/**
 * The public, renderer-neutral shape of a menu: a QUESTION with choices.
 *
 * The third of the display seams, after `frontend.ts` (the dungeon) and `hud.ts`
 * (everything drawn around it). This one is different in kind, and the
 * difference is worth understanding before writing against it: a HUD section is
 * DRAWN, a menu is ASKED. So the boundary is not `present(frame)` but
 * `ask(question) -> answer`, and taking a menu means taking its input too. A
 * presentation that could not accept a choice would not be a presentation of a
 * menu.
 *
 * ONE GRANT, `ui:menu.replace`, for every menu in the game - not one per menu id,
 * which would be a consent list nobody could read. The fine choice is made per
 * question instead: your presenter is offered all of them and returns
 * `undefined` for the ones you have no better way to ask. That is the expected
 * case, not a failure. A radial dial for the six command verbs genuinely has no
 * opinion about the mod manager's thirty-row list, and the game asks those its
 * own way.
 *
 * This module contains types only. A folder plugin may `import type` from the
 * SDK while its built JavaScript continues to have no bare engine import.
 */

/**
 * What a choice MEANS, independent of its wording or the current layout.
 *
 * The same shape `registry:menu` transformers already see. `kind` identifies the
 * broad interaction (`command`, `item`, `category`, `toggle`, ...) and `ref`
 * names the concrete target where there is one, so a presenter can give the
 * "cast a spell" choice its own icon without matching on an English label.
 */
export interface MenuSemantics {
  readonly kind: string;
  readonly ref?: string | number;
  readonly data?: Readonly<Record<string, string | number | boolean | null>>;
}

/** One thing the player may choose. */
export interface MenuChoice {
  /**
   * Stable identity, never a display string. This is what your answer names -
   * and what survives you grouping the choices into the wedges of a dial, which
   * is the whole reason an index would not do.
   */
  readonly id: string;
  readonly semantic: MenuSemantics;
  /** The game's own wording. Yours to replace; theirs to fall back on. */
  readonly label: string;
  /** The faithful terminal's colour for the label, as CSS. Its projection, not yours. */
  readonly color?: string;
  /** Shown, but not choosable. Answering with it is refused. */
  readonly disabled: boolean;
  /**
   * The letter the game fixed for this choice, where it fixed one. Absent means
   * the terminal would have lettered it by position, which is a layout fact and
   * not something to reproduce.
   */
  readonly tag?: string;
  /** One line of help for this choice while it is under the cursor. */
  readonly hint?: string;
  /** A right-hand annotation the terminal draws at its own column, in its own colour. */
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
 * A key the game handles ITSELF, above choosing: the store's buy and sell, the
 * death screen's Ctrl-X, the birth screen's '='.
 *
 * Answer `{kind: "command", key}` to run one. You cannot invent these - they
 * belong to whoever opened the menu - so a presenter reimagining a store reads
 * this list to find out what else that screen can do.
 */
export interface MenuCommandKey {
  readonly key: string;
  /** True for a control chord; `key` is named unmodified and lower case ("x" for Ctrl-X). */
  readonly ctrl: boolean;
}

/** One question the game is asking. */
export interface MenuQuestion {
  /**
   * The stable menu id - the same one `registry:menu` transformers key on
   * (`game:main`, `store:command`, `birth:race`). Match on this to decide
   * whether you have a better way to ask THIS question.
   */
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  /** The game's own key legend. Wrong for a presenter with different keys - it
   *  is here to be replaced, not repeated. */
  readonly footer: string;
  readonly choices: readonly MenuChoice[];
  /**
   * `screen` - the game would have cleared the terminal for this question.
   * `overlay` - it would have drawn a box over the map and left the dungeon
   * visible beside it, which is what upstream does for "which book did you
   * mean". Menus have no published region yet; until they do, this is what
   * tells you whether you are interrupting the game or decorating it.
   */
  readonly style: "screen" | "overlay";
  /** Which choice the game would start on: an index into `choices`. */
  readonly cursor: number;
  /**
   * Read-only: the game would let the player look and not pick. Answering
   * `choose` here is refused and the game asks the question instead.
   */
  readonly browseOnly: boolean;
  readonly commands: readonly MenuCommandKey[];
  /**
   * The detail pane for one choice, by its index in `choices`.
   *
   * The one live edge of a question - everything else is frozen data you may
   * keep. Computed per cursor position (a spell's failure rate, a mod's
   * description), so call it as the cursor moves rather than materialising all
   * of them; it returns an empty list where the game has no pane.
   */
  detail(index: number): readonly MenuDetailLine[];
}

/**
 * Your answer.
 *
 * `cancel` is what ESC means. `choose` names a choice by its `id`. `command`
 * runs one of `question.commands` and the question is then asked AGAIN unless
 * that command resolved it - so a store presenter can offer "buy" without
 * knowing what buying does. `options` is the birth screen's '=' and closes the
 * menu so the game can open its sub-flow and re-ask.
 */
export type MenuAnswer =
  | { readonly kind: "choose"; readonly choice: string }
  | { readonly kind: "cancel" }
  | { readonly kind: "command"; readonly key: string; readonly ctrl?: boolean; readonly cursor: number }
  | { readonly kind: "options" };

/**
 * The consumer boundary: one presenter for every menu, asked per question.
 *
 * Returning `undefined` declines THIS question and the game asks it its own way.
 * Throwing costs you the seam for the rest of the session, on every menu - one
 * report, then the game takes its questions back.
 */
export interface MenuPresenter {
  ask(question: MenuQuestion): Promise<MenuAnswer | undefined> | MenuAnswer | undefined;
}
