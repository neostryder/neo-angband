/**
 * Full-screen game views built from the core's UI data models: inventory,
 * equipment, character sheet, and message history. Each builder turns a core
 * model (gear list, char-sheet panels, stat table, message log) into styled
 * overlay lines the modal viewer renders; the object menus additionally return
 * the gear handles so a follow-up command (quaff/read/wield...) can reference
 * the picked item by `args.handle`.
 *
 * The core owns the data (describeObject gates names by knowledge/flavour;
 * characterPanels/statTable are the faithful ui-player.c port); this module is
 * pure presentation - no game mutation.
 */

import {
  describeObject,
  gearGet,
  characterPanels,
  statTable,
  colorToCss,
  colorCharToAttr,
  ODESC,
} from "@neo-angband/core";
import type { GameState, GameObject } from "@neo-angband/core";
import type { ScreenLine, MenuItem } from "./overlay";
import { menuLetter } from "./overlay";
import { MessageLog, format as formatMessage } from "./messages";

const FG = "#c8c8d4";
const DIM = "#8a8a94";
const LABEL = "#9aa0b4";

/** The display CSS color for an object (its kind's flavour/base attr). */
export function objectColor(obj: GameObject): string {
  return colorToCss(colorCharToAttr(obj.kind.dAttr));
}

/** knowledge-gated full name of a gear object, e.g. "a Potion of Cure Light Wounds". */
export function objectName(state: GameState, obj: GameObject): string {
  return describeObject(state, obj, ODESC.PREFIX | ODESC.FULL);
}

/** Pack handles in slot order (gear.pack is already the non-equipped order). */
export function packHandles(state: GameState): number[] {
  return [...state.gear.pack];
}

/**
 * Build an object-selection menu over the pack, optionally filtered (e.g. only
 * potions for quaff). Returns the menu items and the parallel gear handles so
 * the caller maps the chosen index to `args.handle`.
 */
export function packMenu(
  state: GameState,
  filter?: (obj: GameObject) => boolean,
): { items: MenuItem[]; handles: number[] } {
  const items: MenuItem[] = [];
  const handles: number[] = [];
  for (const handle of state.gear.pack) {
    const obj = gearGet(state.gear, handle);
    if (!obj) continue;
    if (filter && !filter(obj)) continue;
    items.push({ label: objectName(state, obj), color: objectColor(obj) });
    handles.push(handle);
  }
  return { items, handles };
}

/** The inventory viewer lines (i): every pack item, lettered. */
export function inventoryLines(state: GameState): ScreenLine[] {
  const lines: ScreenLine[] = [];
  let i = 0;
  for (const handle of state.gear.pack) {
    const obj = gearGet(state.gear, handle);
    if (!obj) continue;
    lines.push({
      text: `${menuLetter(i)}) ${objectName(state, obj)}`,
      color: objectColor(obj),
    });
    i++;
  }
  if (lines.length === 0) lines.push({ text: "(nothing carried)", color: DIM });
  return lines;
}

/** The equipment viewer lines (e): one row per body slot, worn item or empty. */
export function equipmentLines(state: GameState): ScreenLine[] {
  const player = state.actor.player;
  const lines: ScreenLine[] = [];
  const slots = player.body.slots;
  for (let i = 0; i < player.body.count; i++) {
    const slot = slots[i];
    const handle = player.equipment[i] ?? 0;
    const obj = handle ? gearGet(state.gear, handle) : null;
    const label = (slot?.name ?? `slot ${i}`).padEnd(12);
    if (obj) {
      lines.push({
        text: `${menuLetter(i)}) ${label} ${objectName(state, obj)}`,
        color: objectColor(obj),
      });
    } else {
      lines.push({ text: `   ${label} (nothing)`, color: DIM });
    }
  }
  return lines;
}

/** Equipment-slot menu for takeoff: the filled slots only, with body index. */
export function equipmentMenu(state: GameState): { items: MenuItem[]; handles: number[] } {
  const player = state.actor.player;
  const items: MenuItem[] = [];
  const handles: number[] = [];
  for (let i = 0; i < player.body.count; i++) {
    const handle = player.equipment[i] ?? 0;
    if (!handle) continue;
    const obj = gearGet(state.gear, handle);
    if (!obj) continue;
    const slot = player.body.slots[i];
    items.push({
      label: `${(slot?.name ?? "").padEnd(12)} ${objectName(state, obj)}`,
      color: objectColor(obj),
    });
    handles.push(handle);
  }
  return { items, handles };
}

/**
 * The character-sheet lines (C): the six-stat table then the five panels
 * (name/class, misc, level/exp, combat, skills), faithful to characterPanels /
 * statTable. Laid out as a scrollable single column so it reads at any width.
 */
export function characterSheetLines(state: GameState): ScreenLine[] {
  const lines: ScreenLine[] = [];
  // Stat block.
  lines.push({ text: "Stat   Self    RB   CB   EB   Best   Cur", color: LABEL });
  for (const row of statTable(state)) {
    const cur = row.drained ? row.reduced ?? "" : "";
    const flag = row.naturalMax ? "!" : " ";
    lines.push({
      text:
        `${row.label.slice(0, 4).padEnd(5)}` +
        `${row.natural.padStart(6)} ` +
        `${row.raceBonus.padStart(4)} ${row.classBonus.padStart(4)} ${row.equipBonus.padStart(4)} ` +
        `${row.best.padStart(6)}${flag} ${cur.padStart(6)}`,
      color: row.drained ? "#e0c040" : FG,
    });
  }
  lines.push({ text: "", color: FG });
  // Panels.
  for (const panel of characterPanels(state)) {
    for (const line of panel.lines) {
      if (!line.label && !line.value) {
        lines.push({ text: "", color: FG });
        continue;
      }
      // Some model labels already carry a trailing colon; normalize so we never
      // render "Turns used::". Label-only lines (section headers) show bare.
      const label = line.label.replace(/:\s*$/u, "");
      lines.push({
        text: line.value ? `${label}: ${line.value}` : label,
        color: colorToCss(line.color),
      });
    }
    lines.push({ text: "", color: FG });
  }
  return lines;
}

/** The message-history lines (Ctrl-P): whole log, newest last. */
export function messageHistoryLines(log: MessageLog): ScreenLine[] {
  const all = log.all();
  if (all.length === 0) return [{ text: "(no messages yet)", color: DIM }];
  return all.map((m) => ({ text: formatMessage(m), color: m.color ?? FG }));
}
