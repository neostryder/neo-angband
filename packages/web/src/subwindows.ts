/**
 * The browser shell's first independent Angband terms.
 *
 * Upstream's defaults assign messages, inventory, the visible-monster list,
 * and the floor-item list to Term-1 through Term-4 (ui-init.c L94-97). The web
 * layout gives those four views simultaneous canvases and leaves all disabled
 * until the player opts in, preserving the former single-surface layout.
 */

import { COLOUR_RED, colorToCss } from "@rpgm-tools/neo-angband-core";
import type { Constants, GameState } from "@rpgm-tools/neo-angband-core";
import { format, type LoggedMessage, type MessageLog } from "./messages";
import {
  inventorySubwindowLines,
  monsterListSubwindowLines,
  objectListSubwindowLines,
} from "./screens";
import type { GridSurface } from "./term";
import type { ScreenLine } from "./overlay";
import { UI_TEXT } from "./ui-colors";

export type SubwindowId = "messages" | "inventory" | "monsters" | "items";

export interface SubwindowSettings {
  messages: boolean;
  inventory: boolean;
  monsters: boolean;
  items: boolean;
}

export const SUBWINDOW_STORAGE_KEY = "neo-angband:subwindows";
export const DEFAULT_SUBWINDOW_SETTINGS: Readonly<SubwindowSettings> = {
  messages: false,
  inventory: false,
  monsters: false,
  items: false,
};

export const SUBWINDOW_CHOICES: readonly { id: SubwindowId; label: string }[] = [
  { id: "messages", label: "Display messages" },
  { id: "inventory", label: "Display inventory" },
  { id: "monsters", label: "Display monster list" },
  { id: "items", label: "Display item list" },
];

/** Read only the four supported booleans; malformed or older data is harmless. */
export function readSubwindowSettings(storage: Pick<Storage, "getItem">): SubwindowSettings {
  try {
    const raw = storage.getItem(SUBWINDOW_STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_SUBWINDOW_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Record<SubwindowId, unknown>>;
    return {
      messages: parsed.messages === true,
      inventory: parsed.inventory === true,
      monsters: parsed.monsters === true,
      items: parsed.items === true,
    };
  } catch {
    return { ...DEFAULT_SUBWINDOW_SETTINGS };
  }
}

/** Persist the display setting outside the character save, like window flags. */
export function writeSubwindowSettings(
  storage: Pick<Storage, "setItem" | "removeItem">,
  settings: SubwindowSettings,
): void {
  if (!Object.values(settings).some(Boolean)) {
    storage.removeItem(SUBWINDOW_STORAGE_KEY);
    return;
  }
  storage.setItem(SUBWINDOW_STORAGE_KEY, JSON.stringify(settings));
}

/** Show the column and the independently enabled slots without changing content. */
export function applySubwindowVisibility(
  column: Pick<HTMLElement, "hidden" | "dataset">,
  slots: Readonly<Record<SubwindowId, Pick<HTMLElement, "hidden">>>,
  settings: SubwindowSettings,
): void {
  let count = 0;
  for (const choice of SUBWINDOW_CHOICES) {
    slots[choice.id].hidden = !settings[choice.id];
    if (settings[choice.id]) count++;
  }
  column.hidden = count === 0;
  column.dataset.count = String(count);
}

/** Paint styled terminal rows, optionally anchored to the bottom of the term. */
export function paintSubwindowLines(
  term: GridSurface,
  lines: readonly ScreenLine[],
  bottom = false,
): void {
  const { cols, rows } = term.size();
  term.clear();
  const visible = bottom ? lines.slice(-rows) : lines.slice(0, rows);
  const top = bottom ? rows - visible.length : 0;
  visible.forEach((line, index) => {
    const y = top + index;
    if (line.runs) {
      let x = 0;
      for (const run of line.runs) {
        if (x >= cols) break;
        const text = run.text.slice(0, cols - x);
        term.print(x, y, text, run.color);
        x += text.length;
      }
    } else {
      term.print(0, y, line.text.slice(0, cols), line.color ?? UI_TEXT);
    }
  });
  term.hideCursor();
}

/**
 * update_messages_subwindow (ui-display.c L1886-1933). Messages are oldest at
 * the top and newest at the bottom. Entries newer than the last repaint are
 * red; older entries retain their message type colour.
 */
export class MessageSubwindowPainter {
  private previousNewest: LoggedMessage | null = null;
  private paintedNewest: LoggedMessage | null = null;
  private paintedNewestText = "";
  private paintedLength = -1;
  private paintedCols = -1;
  private paintedRows = -1;

  paint(term: GridSurface, log: MessageLog): void {
    const all = log.all();
    const newest = all[all.length - 1] ?? null;
    const newestText = newest ? format(newest) : "";
    const { cols, rows } = term.size();
    /* Idle animation frames repaint the game but upstream updates this term
     * only on EVENT_STATE. Do not turn a fresh red message back to its ordinary
     * colour merely because another canvas requested a frame. */
    if (
      newest === this.paintedNewest &&
      newestText === this.paintedNewestText &&
      all.length === this.paintedLength &&
      cols === this.paintedCols &&
      rows === this.paintedRows
    ) {
      return;
    }
    const newestFirst = [...all].reverse();
    let fresh = true;
    const lines = newestFirst
      .slice(0, rows)
      .map((entry): ScreenLine => {
        if (entry === this.previousNewest) fresh = false;
        const color = fresh ? colorToCss(COLOUR_RED) : entry.color;
        return { text: format(entry), ...(color === undefined ? {} : { color }) };
      })
      .reverse();
    this.previousNewest = newestFirst[0] ?? null;
    this.paintedNewest = newest;
    this.paintedNewestText = newestText;
    this.paintedLength = all.length;
    this.paintedCols = cols;
    this.paintedRows = rows;
    paintSubwindowLines(term, lines, true);
  }
}

/** monster_list_show_subwindow, repainted from current game state. */
export function paintMonsterSubwindow(term: GridSurface, state: GameState): void {
  const { cols, rows } = term.size();
  paintSubwindowLines(term, monsterListSubwindowLines(state, rows, cols));
}

/** update_inven_subwindow, using the shared inventory screen model. */
export function paintInventorySubwindow(
  term: GridSurface,
  state: GameState,
  constants: Pick<Constants, "quiverSlotSize" | "thrownQuiverMult">,
): void {
  const { cols } = term.size();
  paintSubwindowLines(term, inventorySubwindowLines(state, cols, constants));
}

/** update_itemlist_subwindow, using the shared floor-item screen model. */
export function paintItemListSubwindow(term: GridSurface, state: GameState): void {
  const { cols, rows } = term.size();
  paintSubwindowLines(term, objectListSubwindowLines(state, rows, cols));
}
