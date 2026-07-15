/**
 * The game (Escape) menu and death menu STRUCTURE: pure builders returning
 * the rows, hints, and stable tag letters, so main.ts only wires actions and
 * the tests can verify reachability without booting the whole shell.
 *
 * The game menu is this port's own discoverable home for the actions whose
 * keys a new player will not know (there is no direct upstream equivalent -
 * upstream buries them across keymaps); every row names its keyboard shortcut
 * in the hint so the menu teaches the keys rather than replacing them.
 *
 * The death menu follows ui-death.c death_actions (L356-367) with its stable
 * MN_CASELESS_TAGS letters, reduced to the actions this port implements:
 * Information (i), Messages (m), View scores (v), New Game (n). File dump /
 * Examine items / History / Spoilers / Quit are upstream rows with no web
 * backing yet (quit is meaningless in a browser tab) and are omitted rather
 * than shown dead.
 */

import type { MenuItem } from "./overlay";

export type GameMenuAction =
  | "resume"
  | "character"
  | "inventory"
  | "equipment"
  | "messages"
  | "knowledge"
  | "save"
  | "options"
  | "mods"
  | "help"
  | "abilities"
  | "equip-cmp"
  | "item-actions"
  | "switch"
  | "new";

export interface GameMenuEntry {
  action: GameMenuAction;
  item: MenuItem;
}

export const GAME_MENU_FOOTER = "[ a-z to choose, tap a row, ESC to resume ]";

/** The Escape menu rows, in order. Every action is also reachable by its own
 * key (named in the hint), by arrows+Enter, and by tap. */
export function gameMenuEntries(): GameMenuEntry[] {
  return [
    {
      action: "resume",
      item: { label: "Resume play", hint: "Close this menu and return to the dungeon (ESC)." },
    },
    {
      action: "character",
      item: { label: "Character sheet", hint: "Stats, skills, and history ('C')." },
    },
    {
      action: "inventory",
      item: { label: "Inventory", hint: "The items you are carrying ('i')." },
    },
    {
      action: "equipment",
      item: { label: "Equipment", hint: "What you are wearing and wielding ('e')." },
    },
    {
      action: "messages",
      item: { label: "Message history", hint: "Every message this session (Ctrl-P)." },
    },
    {
      action: "knowledge",
      item: { label: "Knowledge", hint: "Browse what you have learned - monster recall ('~')." },
    },
    {
      action: "save",
      item: { label: "Save game", hint: "Save now; the game also autosaves ('S')." },
    },
    {
      action: "options",
      item: { label: "Options", hint: "Interface, birth, and item-ignoring options ('=')." },
    },
    {
      action: "mods",
      item: { label: "Mods", hint: "Enable, order, and consent to mods; view conflicts and profiles." },
    },
    {
      action: "help",
      item: { label: "Help & keys", hint: "Commands, symbols, and a short guide ('?')." },
    },
    {
      action: "abilities",
      item: { label: "Abilities", hint: "Your racial and class abilities." },
    },
    {
      action: "equip-cmp",
      item: { label: "Compare equipment", hint: "Side-by-side equipment summary." },
    },
    {
      action: "item-actions",
      item: { label: "Item actions", hint: "Every action for one chosen item." },
    },
    {
      action: "switch",
      item: { label: "Switch character", hint: "Save this hero to its slot and pick another." },
    },
    {
      action: "new",
      item: { label: "New character", hint: "Save this hero to its slot and birth a new one." },
    },
  ];
}

export type DeathMenuAction = "info" | "messages" | "scores" | "new";

export interface DeathMenuEntry {
  action: DeathMenuAction;
  item: MenuItem;
}

export const DEATH_MENU_FOOTER = "[ letters or tap to choose, ESC to close ]";

/** death_actions (ui-death.c L356), reduced to the ported rows, with the
 * upstream tag letters (MN_CASELESS_TAGS). */
export function deathMenuEntries(): DeathMenuEntry[] {
  return [
    {
      action: "info",
      item: { label: "Information", tag: "i", hint: "The final character sheet." },
    },
    {
      action: "messages",
      item: { label: "Messages", tag: "m", hint: "The last messages of the run." },
    },
    {
      action: "scores",
      item: { label: "View scores", tag: "v", hint: "The Hall of Fame." },
    },
    {
      action: "new",
      item: { label: "New Game", tag: "n", hint: "Start a new character ('N')." },
    },
  ];
}
