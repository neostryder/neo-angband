/**
 * The ENTER command browser: textui_action_menu_choose (ui-context.c:1268) over
 * cmd_menu (:1157), the only route upstream offers to a nested command category
 * and a discoverable route to every command for a player who does not know the
 * keys. The port had neither, for any command list - which is why the debug
 * menu's categories looked absent, though the gap was never wizard-specific.
 *
 * Two levels, both plain scrolling menus with no tags:
 *
 *   textui_action_menu_choose - the cmds_all list NAMES whose menu_level is 0
 *     (`while (cmds_all[len].len && cmds_all[len].menu_level == 0) len++`,
 *     :1281-1283), in a window_make(19, 4, 58, 11) box at region {21, 5, 37, 6}.
 *   cmd_menu - one list's entries, each `desc` plus ` (key)` when the row has a
 *     key (cmd_sub_entry, :1126-1153), in a box two columns right and one row up
 *     per nesting level (`area.col += 2 * menu_level; area.row -= menu_level`,
 *     :1174-1175).
 *
 * ESC in the inner menu returns to the category list rather than to the game
 * (`result = true`, :1215-1221); ESC at the category list leaves. That is
 * upstream's own back-one-level rule, not a port convention.
 *
 * A row whose `cat` is null is a PORT ADDITION with no cmd_info behind it, and
 * is not listed - upstream's menu is cmds_all and nothing else.
 */

import { inputEvents } from "./input-door";
import { setActiveCellTap, type GridPointerInput, type GridSurface } from "./term";
import { menuNav, selectFromMenu } from "./overlay";
import type { MenuItem } from "./overlay";
import { UI_TEXT, UI_CURSOR } from "./ui-colors";
import type { MenuTransformRow } from "@rpgm-tools/neo-angband-core";

/** One listable command: what it is called, its key, and what running it does. */
export interface MenuCommand {
  /** Stable source identity when this command came from the keypress table. */
  id?: string;
  desc: string;
  /** The key in the player's current keyset, or null when it has none. */
  key: string | null;
  run: () => void;
  /**
   * cmd_info.nested_name (ui-game.c:225): this row is a PLACEHOLDER for a
   * nested list, not a command. Upstream's has `cmd` and `hook` both NULL and
   * cmd_menu recurses into the named list instead of returning
   * (ui-context.c:1196-1213), which is why "Debug mode commands" opens the nine
   * debug categories rather than doing anything.
   */
  nested?: () => CommandCategory[];
}

/** One cmds_all list: its displayed name and its entries, in table order. */
export interface CommandCategory {
  /** Stable source identity, separate from the display name a mod may retitle. */
  id?: string;
  name: string;
  commands: MenuCommand[];
}

/* window_make(19, 4, 58, 11) and region { 21, 5, 37, 6 } (:1270, :1291). */
const CAT_BOX = { x0: 19, y0: 4, x1: 58, y1: 11 };
const CAT_COL = 21;
const CAT_ROW = 5;
/* region { 23, 4, 37, 13 }, boxed at (col - 2, row - 1) - (col + 39, row + 13). */
const CMD_COL = 23;
const CMD_ROW = 4;
const CMD_ROWS = 13;

/**
 * keypress_to_readable (ui-event.c:302) for the keys this shell's table holds:
 * a printable key prints as itself, and a named key gets the bracketed form the
 * C reaches through keycode_find_desc ("Tab" -> "[Tab]"), which is the reason
 * that function un-ktrls a control character only when it has NO description.
 */
export function keypressToReadable(key: string): string {
  /* A control key is "^" + the un-ktrl'd character and is NOT bracketed
   * (:317-321). Bracketing is what keycode_find_desc's named keys get, and the
   * two are mutually exclusive upstream - the un-ktrl happens only when a
   * control character has NO description, which is the whole point of that
   * branch's comment about Tab. */
  if (key.length === 2 && key.startsWith("^")) return key;
  return key.length === 1 ? key : `[${key}]`;
}

/** cmd_sub_entry (:1126): the description, then " (key)" for a real command. */
export function commandEntryText(cmd: MenuCommand): string {
  return cmd.key === null ? cmd.desc : `${cmd.desc} (${keypressToReadable(cmd.key)})`;
}

/** window_make (ui-output.c:469): erase the region, then a '+'-cornered box. */
function windowMake(term: GridSurface & GridPointerInput, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) term.print(x, y, " ", UI_TEXT);
  }
  const w = x1 - x0;
  term.print(x0, y0, `+${"-".repeat(Math.max(0, w - 1))}+`, UI_TEXT);
  term.print(x0, y1, `+${"-".repeat(Math.max(0, w - 1))}+`, UI_TEXT);
  for (let y = y0 + 1; y < y1; y++) {
    term.print(x0, y, "|", UI_TEXT);
    term.print(x1, y, "|", UI_TEXT);
  }
}

/** curs_attrs[CURS_KNOWN] (ui-menu.c:29-32): L_BLUE on the cursor, else WHITE. */
function rowColor(selected: boolean): string {
  return selected ? UI_CURSOR : UI_TEXT;
}

/**
 * One scrolling menu inside a box. Resolves the chosen index, or null on ESC.
 * Shared by both levels because upstream's are both `menu_select` over
 * MN_SKIN_SCROLL with a NULL get_tag - there are no letters on either screen.
 */
function runMenu(
  term: GridSurface & GridPointerInput,
  items: readonly MenuItem[],
  box: { x0: number; y0: number; x1: number; y1: number },
  col: number,
  row: number,
  pageRows: number,
  redraw: () => void,
): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    let cursor = 0;
    let top = 0;
    const count = items.length;
    const page = Math.max(1, Math.min(pageRows, box.y1 - row));

    const paint = (): void => {
      const { cols } = term.size();
      /* screen_save / screen_load around each menu (ui-context.c:1182, :1230-
       * 1237): the box is drawn OVER the game screen and what it covered comes
       * back when it closes. This port has no screen stack, so the caller hands
       * in the repaint and every paint starts from a clean background - which
       * is what stops a closed inner box leaving its frame behind the category
       * list. Found by dumping the screens and reading them, not by review. */
      redraw();
      windowMake(term, box.x0, box.y0, box.x1, box.y1);
      if (cursor < top) top = cursor;
      if (cursor >= top + page) top = cursor - page + 1;
      for (let i = 0; i < page; i++) {
        const item = items[top + i];
        if (!item) break;
        const width = Math.max(0, Math.min(box.x1 - col, cols - 1 - col));
        term.print(col, row + i, item.label.slice(0, width), item.disabled ? UI_TEXT : rowColor(top + i === cursor));
      }
    };

    const finish = (value: number | null): void => {
      inputEvents.removeEventListener("keydown", onKey, true);
      setActiveCellTap(term, null);
      resolve(value);
    };

    const installTap = (): void => {
      setActiveCellTap(term, (cell) => {
        const i = top + (cell.row - row);
        if (cell.col < box.x0 || cell.col > box.x1) return;
        if (i >= 0 && i < count) finish(i);
      });
    };

    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") {
        finish(null);
        return;
      }
      if (ev.key === "Enter") {
        if (count > 0 && !items[cursor]?.disabled) finish(cursor);
        return;
      }
      if (ev.key.length === 1) {
        const tagged = items.findIndex((item) => item.tag === ev.key && !item.disabled);
        if (tagged >= 0) {
          finish(tagged);
          return;
        }
      }
      const nav = menuNav(ev);
      if (!nav || count === 0) return;
      /* menu_handle_keypress wraps at both ends (its is_valid_row loop turns a
       * cursor past the end into 0), the same rule the knowledge browser follows. */
      if (nav === "up") cursor = nextEnabled(items, cursor, -1);
      else if (nav === "down") cursor = nextEnabled(items, cursor, 1);
      else if (nav === "pageup") cursor = Math.max(0, cursor - page);
      else if (nav === "pagedown") cursor = Math.min(count - 1, cursor + page);
      else if (nav === "home") cursor = 0;
      else if (nav === "end") cursor = count - 1;
      paint();
    };

    inputEvents.addEventListener("keydown", onKey, true);
    installTap();
    paint();
  });
}

function nextEnabled(items: readonly MenuItem[], from: number, direction: -1 | 1): number {
  for (let tried = 0; tried < items.length; tried++) {
    const next = (from + direction * (tried + 1) + items.length) % items.length;
    if (!items[next]?.disabled) return next;
  }
  return from;
}

function scrollPicker(
  term: GridSurface & GridPointerInput,
  box: { x0: number; y0: number; x1: number; y1: number },
  col: number,
  row: number,
  pageRows: number,
  redraw: () => void,
): (items: readonly MenuItem[]) => Promise<string | null> {
  return async (items): Promise<string | null> => {
    const pick = await runMenu(term, items, box, col, row, pageRows, redraw);
    return pick === null ? null : items[pick]?.id ?? null;
  };
}

function categoryMenuId(category: CommandCategory, fallback: number): string {
  return category.id ?? `core:keypress-command-category:${category.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || fallback}`;
}

function commandListMenuId(category: CommandCategory): string {
  return categoryMenuId(category, 0).replace("core:keypress-command-category:", "core:keypress-command:");
}

function commandItems(category: CommandCategory): MenuItem[] {
  return category.commands.map((command, index) => ({
    id: command.id ?? `${categoryMenuId(category, 0)}:command:${index}`,
    label: commandEntryText(command),
    semantic: { kind: "keypress-command", ref: command.id ?? index },
  }));
}

/**
 * cmd_menu (ui-context.c:1157) for one list. Resolves the chosen command, or
 * null when ESC asks to go back to the containing menu.
 *
 * `level` is command_list.menu_level: upstream indents each nested menu two
 * columns right and one row up so the parent stays visible behind it.
 */
export async function runCommandList(
  term: GridSurface & GridPointerInput,
  category: CommandCategory,
  redraw: () => void,
  level = 0,
): Promise<MenuCommand | null> {
  const col = CMD_COL + 2 * level;
  const row = CMD_ROW - level;
  const box = { x0: col - 2, y0: row - 1, x1: col + 39, y1: row + CMD_ROWS };
  const items = commandItems(category);
  for (;;) {
    const pick = await selectFromMenu(
      term,
      commandListMenuId(category),
      category.name,
      items,
      undefined,
      { terminalPicker: scrollPicker(term, box, col, row, CMD_ROWS, redraw) },
    );
    if (pick === null) return null;
    const chosen = category.commands[pick];
    if (!chosen) return null;
    if (!chosen.nested) return chosen;
    /* A placeholder: recurse one level deeper, and on ESC come back to THIS
     * list rather than out (:1196-1213). The parent stays drawn behind, which
     * is what the two-column indent is for. */
    const inner = chosen.nested();
    const deeper = await runNestedList(term, inner, redraw, box, level + 1);
    if (deeper) return deeper;
  }
}

/**
 * The nested tier: a list of placeholders, each opening its own list. Upstream
 * reaches it by cmd_menu recursing on `nested_name` twice - cmd_debug holds
 * nine categories and each names a cmd_debug_* list (ui-game.c:341-351).
 */
async function runNestedList(
  term: GridSurface & GridPointerInput,
  categories: readonly CommandCategory[],
  redraw: () => void,
  parentBox: { x0: number; y0: number; x1: number; y1: number },
  level: number,
): Promise<MenuCommand | null> {
  const live = categories.filter((c) => c.commands.length > 0);
  if (live.length === 0) return null;
  const col = CMD_COL + 2 * level;
  const row = CMD_ROW - level;
  const box = { x0: col - 2, y0: row - 1, x1: col + 39, y1: row + CMD_ROWS };
  const under = (): void => {
    redraw();
    /* The containing list is still on screen behind this one. */
    windowMake(term, parentBox.x0, parentBox.y0, parentBox.x1, parentBox.y1);
  };
  for (;;) {
    const pick = await selectFromMenu(
      term,
      `core:keypress-command-nested:${level}`,
      "Commands",
      live.map((category, index) => ({
        id: categoryMenuId(category, index),
        label: category.name,
        semantic: { kind: "keypress-command-category", ref: categoryMenuId(category, index) },
      })),
      undefined,
      { terminalPicker: scrollPicker(term, box, col, row, CMD_ROWS, under) },
    );
    if (pick === null) return null;
    const category = live[pick];
    if (!category) return null;
    const chosen = await runCommandList(term, category, under, level + 1);
    if (chosen) return chosen;
  }
}

/**
 * textui_action_menu_choose (ui-context.c:1268). Loops category list -> command
 * list -> category list, exactly the C's own back-one-level, and resolves the
 * chosen command or null if the player left without choosing.
 *
 * It does NOT run the command: upstream returns the cmd_info and its caller
 * dispatches, and keeping that split is what lets the caller put the chosen
 * command through the same key_confirm_command gate a keypress goes through.
 */
export async function chooseCommand(
  term: GridSurface & GridPointerInput,
  categories: readonly CommandCategory[],
  redraw: () => void,
): Promise<MenuCommand | null> {
  const live = categories.filter((c) => c.commands.length > 0);
  if (live.length === 0) return null;
  for (;;) {
    const gi = await selectFromMenu(
      term,
      "core:keypress-command-categories",
      "Commands",
      live.map((category, index) => ({
        id: categoryMenuId(category, index),
        label: category.name,
        semantic: { kind: "keypress-command-category", ref: categoryMenuId(category, index) },
      })),
      undefined,
      {
        terminalPicker: scrollPicker(
          term,
          CAT_BOX,
          CAT_COL,
          CAT_ROW,
          CAT_BOX.y1 - CAT_ROW,
          redraw,
        ),
      },
    );
    if (gi === null) return null;
    const category = live[gi];
    if (!category) continue;
    /* The category box stays on screen behind the command list, which is why
     * upstream indents a nested menu - the parent is still visible (:1174). */
    const chosen = await runCommandList(term, category, () => {
      redraw();
      windowMake(term, CAT_BOX.x0, CAT_BOX.y0, CAT_BOX.x1, CAT_BOX.y1);
      const { cols } = term.size();
      for (let i = 0; i < live.length && CAT_ROW + i < CAT_BOX.y1; i++) {
        const width = Math.max(0, Math.min(CAT_BOX.x1 - CAT_COL, cols - 1 - CAT_COL));
        term.print(CAT_COL, CAT_ROW + i, live[i]!.name.slice(0, width), rowColor(i === gi));
      }
    });
    if (chosen) return chosen;
    /* ESC in the command list returns here rather than to the game (:1215). */
  }
}

/**
 * Group a flat cmds_all-shaped table into its lists, in first-appearance order,
 * dropping rows with no category (port additions) and rows with no key in the
 * player's current keyset.
 *
 * The keyset filter is upstream's too, in a roundabout way: cmd_sub_entry reads
 * `commands[oid].key[mode]` and prints no parenthesised key when it is 0, and a
 * row the port marks `r: null` has genuinely moved to a control key in that
 * keyset. Listing it with no key would offer the player a row that the menu can
 * still run - which is right, so such a row IS listed, just without a key.
 */
/**
 * cmd_lookup_key / cmd_sub_entry's `commands[oid].key[mode]` (ui-game.c:461,
 * ui-context.c:1132): the row's key in the keyset the player is using. `r`
 * absent means cmd_init copied key[0] into key[1] (ui-game.c:409-410), i.e.
 * "same as the original key"; `r: null` means it genuinely has none there.
 *
 * Exported and shared with the keydown dispatcher rather than spelled out in
 * both, because a test that reimplements the rule tests its own copy - which is
 * exactly what let "the browser ignores the keyset" survive a mutation run.
 */
export function keyForKeyset(
  row: { o?: string | null; r?: string | null },
  roguelike: boolean,
): string | null {
  const key = roguelike ? (row.r === undefined ? row.o : row.r) : row.o;
  return key ?? null;
}

export function groupCommands<T extends { id?: string; desc: string; cat: string | null }>(
  rows: readonly T[],
  keyOf: (row: T) => string | null,
  runOf: (row: T) => () => void,
  nestedOf: (row: T) => (() => CommandCategory[]) | undefined = () => undefined,
): CommandCategory[] {
  const out: CommandCategory[] = [];
  const byName = new Map<string, CommandCategory>();
  for (const row of rows) {
    if (row.cat === null) continue;
    let cat = byName.get(row.cat);
    if (!cat) {
      cat = { id: categoryMenuId({ name: row.cat, commands: [] }, out.length), name: row.cat, commands: [] };
      byName.set(row.cat, cat);
      out.push(cat);
    }
    const nested = nestedOf(row);
    cat.commands.push({
      id: row.id ?? `${cat.id}:command:${cat.commands.length}`,
      desc: row.desc,
      key: keyOf(row),
      run: runOf(row),
      ...(nested ? { nested } : {}),
    });
  }
  return out;
}

/** The one declarative registry target for the keypress command table. */
export const KEYPRESS_COMMAND_TABLE_ID = "core:keypress-command-table";

/** The non-runnable portion of a keypress command. `act` never crosses this boundary. */
export interface KeypressCommandRow {
  readonly desc: string;
  readonly cat: string | null;
  readonly o?: string | null;
  readonly r?: string | null;
  readonly ctrl?: string;
}

type KeypressCommandTransformer = (
  id: string,
  rows: readonly MenuTransformRow[],
) => readonly MenuTransformRow[];

function keypressCommandId(index: number): string {
  return `core:keypress-command:${index}`;
}

function keypressRows<T extends KeypressCommandRow>(commands: readonly T[]): readonly MenuTransformRow[] {
  return commands.map((command, index) => ({
    id: keypressCommandId(index),
    label: command.desc,
    semantic: {
      kind: "keypress-command",
      ref: index,
      data: {
        category: command.cat,
        originalKey: command.o ?? null,
        roguelikeKey: command.r ?? null,
        roguelikeUsesOriginal: command.r === undefined,
        controlKey: command.ctrl ?? null,
      },
    },
  }));
}

function stringOrNull(
  value: Readonly<Record<string, string | number | boolean | null>> | undefined,
  key: string,
  fallback: string | null,
): string | null {
  const next = value?.[key];
  return typeof next === "string" || next === null ? next : fallback;
}

/**
 * Run the actual keypress table through `registry:menu` without ever handing a
 * mod the runnable closure. Unknown row ids have no shell action and therefore
 * cannot become executable merely by being added to the declarative result.
 */
export function transformKeypressCommandTable<T extends KeypressCommandRow>(
  commands: readonly T[],
  transform: KeypressCommandTransformer,
): Array<T & { id: string }> {
  const originals = new Map(keypressRows(commands).map((row, index) => [row.id, commands[index]!]));
  const transformed = transform(KEYPRESS_COMMAND_TABLE_ID, keypressRows(commands));
  const output: Array<T & { id: string }> = [];
  for (const row of transformed) {
    const original = originals.get(row.id);
    if (!original) continue;
    const data = row.semantic.data;
    const roguelikeUsesOriginal = data?.roguelikeUsesOriginal === true;
    const roguelikeKey = roguelikeUsesOriginal
      ? undefined
      : stringOrNull(data, "roguelikeKey", original.r ?? null);
    const controlKey = stringOrNull(data, "controlKey", original.ctrl ?? null);
    output.push({
      ...original,
      id: row.id,
      desc: row.label,
      cat: stringOrNull(data, "category", original.cat),
      o: stringOrNull(data, "originalKey", original.o ?? null),
      ...(roguelikeKey === undefined ? {} : { r: roguelikeKey }),
      ...(controlKey === null ? {} : { ctrl: controlKey }),
    });
  }
  return output;
}
