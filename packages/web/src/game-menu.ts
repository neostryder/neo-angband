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
 * The death menu is ui-death.c death_actions (L356-367) in full, in upstream's
 * order and with its stable MN_CASELESS_TAGS letters. Three of the rows were
 * omitted here for a while on reasoning that did not survive re-reading the C:
 * Examine items (x) needs nothing the inspect command has not had for months,
 * Spoilers (s) reaches the same handler as the wizard menu's Create spoilers,
 * and Quit (q) is exactly the port's leave-play-for-the-title action, which the
 * game menu has offered all along.
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
  | "graphics"
  | "mods"
  | "help"
  | "abilities"
  | "equip-cmp"
  | "item-actions"
  | "switch"
  | "new"
  | "exit";

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
      action: "graphics",
      item: { label: "Graphics", hint: "Choose a tile set or ASCII (upstream's frontend Graphics menu)." },
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
    {
      action: "exit",
      item: {
        label: "Save and exit",
        hint: "Save and leave play for the title screen and character list (Ctrl-X).",
      },
    },
  ];
}

export type DeathMenuAction =
  | "info"
  | "messages"
  | "dump"
  | "scores"
  | "examine"
  | "history"
  | "spoilers"
  | "new"
  | "quit";

export interface DeathMenuEntry {
  action: DeathMenuAction;
  item: MenuItem;
}

export const DEATH_MENU_FOOTER = "[ letters or tap to choose, ESC to quit ]";

/** death_actions (ui-death.c L356-367), every row, in upstream's order, with
 * its tag letter (MN_CASELESS_TAGS). Quit is last because death_screen's own
 * comment requires it to be. */
export function deathMenuEntries(): DeathMenuEntry[] {
  return [
    {
      action: "info",
      item: { label: "Information", tag: "i", hint: "The final character sheet and gear." },
    },
    {
      action: "messages",
      item: { label: "Messages", tag: "m", hint: "The last messages of the run." },
    },
    {
      action: "dump",
      item: { label: "File dump", tag: "f", hint: "Download the character dump as text." },
    },
    {
      action: "scores",
      item: { label: "View scores", tag: "v", hint: "The Hall of Fame." },
    },
    {
      action: "examine",
      item: { label: "Examine items", tag: "x", hint: "Inspect what the hero was carrying." },
    },
    {
      action: "history",
      item: { label: "History", tag: "h", hint: "The character's life history." },
    },
    {
      action: "spoilers",
      item: { label: "Spoilers", tag: "s", hint: "Generate the spoiler files." },
    },
    {
      action: "new",
      item: { label: "New Game", tag: "n", hint: "Start a new character ('N' or Ctrl-N)." },
    },
    {
      action: "quit",
      item: { label: "Quit", tag: "q", hint: "Leave play for the title screen (Ctrl-X)." },
    },
  ];
}
