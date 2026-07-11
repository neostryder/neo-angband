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
  tvalIsBook,
  playerObjectToBook,
  spellCollectFromBook,
  spellByIndex,
  spellChance,
  spellOkayToCast,
  spellOkayToStudy,
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
export function characterSheetLines(state: GameState, name?: string): ScreenLine[] {
  const deps = name ? { fullName: name } : {};
  const lines: ScreenLine[] = [];
  // Stat block.
  lines.push({ text: "Stat   Self    RB   CB   EB   Best   Cur", color: LABEL });
  for (const row of statTable(state, deps)) {
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
  for (const panel of characterPanels(state, deps)) {
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

/**
 * The spellbooks in the pack this class can actually use (its own realm's
 * books), as a selection menu. Empty for non-casters or a caster carrying no
 * usable book. Handles map the chosen index back to the book's gear handle.
 */
export function magicBooks(state: GameState): { items: MenuItem[]; handles: number[] } {
  const player = state.actor.player;
  const items: MenuItem[] = [];
  const handles: number[] = [];
  for (const handle of state.gear.pack) {
    const obj = gearGet(state.gear, handle);
    if (!obj || !tvalIsBook(obj.tval)) continue;
    if (!playerObjectToBook(player, obj)) continue;
    items.push({ label: objectName(state, obj), color: objectColor(obj) });
    handles.push(handle);
  }
  return { items, handles };
}

/**
 * The spell list of a book as a menu, faithful to the cast/study spell picker
 * (textui_book_browse columns: name, level, mana, fail%). `mode` decides which
 * spells are selectable: "cast" enables learned spells (low-mana ones stay
 * castable but are flagged, matching upstream's over-exert), "study" enables
 * only spells okay to study (right level, not yet known). Returns the parallel
 * class-wide sidx list so the caller dispatches cast/study by args.spell.
 */
export function bookSpellMenu(
  state: GameState,
  bookObj: GameObject,
  mode: "cast" | "study",
): { items: MenuItem[]; sidx: number[] } {
  const player = state.actor.player;
  const statInd = state.statInd ?? [];
  const items: MenuItem[] = [];
  const sidx: number[] = [];
  for (const idx of spellCollectFromBook(player, bookObj)) {
    const spell = spellByIndex(player.cls, idx);
    if (!spell) continue;
    const name = spell.name.padEnd(20).slice(0, 20);
    const lv = String(spell.level).padStart(2);
    const mana = String(spell.mana).padStart(2);
    let disabled = false;
    let tail: string;
    if (mode === "cast") {
      if (!spellOkayToCast(player, idx)) {
        disabled = true;
        tail = "  (unknown)";
      } else {
        const fail = String(spellChance(player, statInd, idx)).padStart(2);
        const low = spell.mana > player.csp ? " low mana" : "";
        tail = ` ${fail}%${low}`;
      }
    } else {
      disabled = !spellOkayToStudy(player, idx);
      const fail = String(spell.fail).padStart(2);
      tail = disabled ? "  (cannot learn)" : ` ${fail}%`;
    }
    items.push({
      label: `${name} Lv ${lv} Mana ${mana}${tail}`,
      disabled,
      color: DIM,
    });
    sidx.push(idx);
  }
  return { items, sidx };
}

/** The message-history lines (Ctrl-P): whole log, newest last. */
export function messageHistoryLines(log: MessageLog): ScreenLine[] {
  const all = log.all();
  if (all.length === 0) return [{ text: "(no messages yet)", color: DIM }];
  return all.map((m) => ({ text: formatMessage(m), color: m.color ?? FG }));
}
