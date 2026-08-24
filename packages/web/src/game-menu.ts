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
import { t } from "@rpgm-tools/neo-angband-core";

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
  | "report"
  | "storage"
  | "abilities"
  | "equip-cmp"
  | "item-actions"
  | "switch"
  | "new"
  | "exit"
  | "quit";

export interface GameMenuEntry {
  action: GameMenuAction;
  item: MenuItem;
}

/**
 * A FUNCTION, not a constant: a locale is chosen at boot and can change while
 * the game runs (see i18n.ts's header), so a `const` computed at import time
 * would freeze whichever language happened to be active first.
 */
export function gameMenuFooter(): string {
  return t("menu.game.footer", "[ a-z to choose, tap a row, ESC to resume ]");
}

/** The Escape menu rows, in order. Every action is also reachable by its own
 * key (named in the hint), by arrows+Enter, and by tap.
 *
 * `canQuit` adds the desktop-only "Quit to desktop" row. Leaving play and quitting
 * the program used to be the same row, which is how "Save and exit" came to close
 * the app; separating them left the desktop build with no discoverable way out at
 * all, since a tab's close button has no equivalent there. */
export function gameMenuEntries(opts: { canQuit?: boolean } = {}): GameMenuEntry[] {
  const entries: GameMenuEntry[] = [
    {
      action: "resume",
      item: {
        label: t("menu.game.resume.label", "Resume play"),
        hint: t("menu.game.resume.hint", "Close this menu and return to the dungeon (ESC)."),
      },
    },
    {
      action: "character",
      item: {
        label: t("menu.game.character.label", "Character sheet"),
        hint: t("menu.game.character.hint", "Stats, skills, and history ('C')."),
      },
    },
    {
      action: "inventory",
      item: {
        label: t("menu.game.inventory.label", "Inventory"),
        hint: t("menu.game.inventory.hint", "The items you are carrying ('i')."),
      },
    },
    {
      action: "equipment",
      item: {
        label: t("menu.game.equipment.label", "Equipment"),
        hint: t("menu.game.equipment.hint", "What you are wearing and wielding ('e')."),
      },
    },
    {
      action: "messages",
      item: {
        label: t("menu.game.messages.label", "Message history"),
        hint: t("menu.game.messages.hint", "Every message this session (Ctrl-P)."),
      },
    },
    {
      action: "knowledge",
      item: {
        label: t("menu.game.knowledge.label", "Knowledge"),
        hint: t(
          "menu.game.knowledge.hint",
          "Browse what you have learned - monster recall ('~').",
        ),
      },
    },
    {
      action: "save",
      item: {
        label: t("menu.game.save.label", "Save game"),
        hint: t("menu.game.save.hint", "Save now; the game also autosaves ('S')."),
      },
    },
    {
      action: "options",
      item: {
        label: t("menu.game.options.label", "Options"),
        hint: t(
          "menu.game.options.hint",
          "Interface, birth, and item-ignoring options ('=').",
        ),
      },
    },
    {
      action: "graphics",
      item: {
        label: t("menu.game.graphics.label", "Graphics"),
        hint: t(
          "menu.game.graphics.hint",
          "Choose a tile set or ASCII (upstream's frontend Graphics menu).",
        ),
      },
    },
    {
      action: "mods",
      item: {
        label: t("menu.game.mods.label", "Mods"),
        hint: t(
          "menu.game.mods.hint",
          "Enable, order, and consent to mods; view conflicts and profiles.",
        ),
      },
    },
    {
      action: "help",
      item: {
        label: t("menu.game.help.label", "Help & keys"),
        hint: t("menu.game.help.hint", "Commands, symbols, and a short guide ('?')."),
      },
    },
    /* Next to Help because it is the same kind of row: the player is stuck and
     * looking for the way out. It has no keyboard shortcut of its own - every
     * single-letter key in play is upstream's, and taking one for a port feature
     * is the sort of divergence the parity mandate exists to refuse. The menu is
     * the whole of its discoverability, which is why it is here rather than
     * buried on the title screen. */
    {
      action: "report",
      item: {
        label: t("menu.game.report.label", "Report a problem"),
        hint: t(
          "menu.game.report.hint",
          "Write a file describing what went wrong. Nothing is sent anywhere.",
        ),
      },
    },
    /* Next to it for the same reason, and here rather than only on the character
     * list because a player in the dungeon is the one with something to lose. The
     * character list says the least it can in one line and points here; this row
     * is the other door. */
    {
      action: "storage",
      item: {
        label: t("menu.game.storage.label", "Where your characters live"),
        hint: t(
          "menu.game.storage.hint",
          "What stores your saves and mods - and what would destroy them.",
        ),
      },
    },
    {
      action: "abilities",
      item: {
        label: t("menu.game.abilities.label", "Abilities"),
        hint: t("menu.game.abilities.hint", "Your racial and class abilities."),
      },
    },
    {
      action: "equip-cmp",
      item: {
        label: t("menu.game.equip-cmp.label", "Compare equipment"),
        hint: t("menu.game.equip-cmp.hint", "Side-by-side equipment summary."),
      },
    },
    {
      action: "item-actions",
      item: {
        label: t("menu.game.item-actions.label", "Item actions"),
        hint: t("menu.game.item-actions.hint", "Every action for one chosen item."),
      },
    },
    {
      action: "switch",
      item: {
        label: t("menu.game.switch.label", "Switch character"),
        hint: t(
          "menu.game.switch.hint",
          "Save this hero to its slot and pick another.",
        ),
      },
    },
    {
      action: "new",
      item: {
        label: t("menu.game.new.label", "New character"),
        hint: t("menu.game.new.hint", "Save this hero to its slot and birth a new one."),
      },
    },
    {
      action: "exit",
      item: {
        label: t("menu.game.exit.label", "Save and exit"),
        hint: t(
          "menu.game.exit.hint",
          "Save and leave play for the title screen and character list.",
        ),
      },
    },
    /* Ctrl-X is deliberately NOT named on the row above any more: upstream's ^X
     * (textui_quit) ends the program, and this row does not. */
    ...(opts.canQuit
      ? [
          {
            action: "quit" as const,
            item: {
              label: t("menu.game.quit.label", "Quit to desktop"),
              hint: t("menu.game.quit.hint", "Save and close the game entirely (Ctrl-X)."),
            },
          },
        ]
      : []),
  ];
  return entries.map((entry) => ({
    ...entry,
    item: {
      ...entry.item,
      id: `core:game-menu:${entry.action}`,
      semantic: { kind: "command", ref: entry.action },
    },
  }));
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

/** See `gameMenuFooter`'s comment - the same reason applies here. */
export function deathMenuFooter(): string {
  return t("menu.death.footer", "[ letters or tap to choose, ESC to quit ]");
}

/** death_actions (ui-death.c L356-367), every row, in upstream's order, with
 * its tag letter (MN_CASELESS_TAGS). Quit is last because death_screen's own
 * comment requires it to be. */
export function deathMenuEntries(): DeathMenuEntry[] {
  const entries: DeathMenuEntry[] = [
    {
      action: "info",
      item: {
        label: t("menu.death.info.label", "Information"),
        tag: "i",
        hint: t("menu.death.info.hint", "The final character sheet and gear."),
      },
    },
    {
      action: "messages",
      item: {
        label: t("menu.death.messages.label", "Messages"),
        tag: "m",
        hint: t("menu.death.messages.hint", "The last messages of the run."),
      },
    },
    {
      action: "dump",
      item: {
        label: t("menu.death.dump.label", "File dump"),
        tag: "f",
        hint: t("menu.death.dump.hint", "Download the character dump as text."),
      },
    },
    {
      action: "scores",
      item: {
        label: t("menu.death.scores.label", "View scores"),
        tag: "v",
        hint: t("menu.death.scores.hint", "The Hall of Fame."),
      },
    },
    {
      action: "examine",
      item: {
        label: t("menu.death.examine.label", "Examine items"),
        tag: "x",
        hint: t("menu.death.examine.hint", "Inspect what the hero was carrying."),
      },
    },
    {
      action: "history",
      item: {
        label: t("menu.death.history.label", "History"),
        tag: "h",
        hint: t("menu.death.history.hint", "The character's life history."),
      },
    },
    {
      action: "spoilers",
      item: {
        label: t("menu.death.spoilers.label", "Spoilers"),
        tag: "s",
        hint: t("menu.death.spoilers.hint", "Generate the spoiler files."),
      },
    },
    {
      action: "new",
      item: {
        label: t("menu.death.new.label", "New Game"),
        tag: "n",
        hint: t("menu.death.new.hint", "Start a new character ('N' or Ctrl-N)."),
      },
    },
    {
      action: "quit",
      item: {
        label: t("menu.death.quit.label", "Quit"),
        tag: "q",
        hint: t("menu.death.quit.hint", "Leave play for the title screen (Ctrl-X)."),
      },
    },
  ];
  return entries.map((entry) => ({
    ...entry,
    item: {
      ...entry.item,
      id: `core:death-menu:${entry.action}`,
      semantic: { kind: "command", ref: entry.action },
    },
  }));
}
