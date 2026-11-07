/**
 * `ctx.keybindings`: the player's keymap editor, for a mod that draws its own
 * controls screen. Present with `keymap:edit`. It works on the current keyset
 * (original or roguelike, from `rogue_like_commands`), exactly like the game's
 * own keymap editor, unless a call names the other one, and every change is
 * saved at once, as that editor saves.
 *
 * A binding the player sets here is the player's, even when it replaces one a
 * mod created with `ctx.keymaps`: that mod no longer owns it and will not remove
 * it when it is turned off.
 */

import type { GameState } from "@rpgm-tools/neo-angband-core";
import { keyForKeyset, type KeypressCommandRow } from "./command-menu";
import { inputEvents } from "./input-door";
import {
  isBindableTriggerKey,
  keymapAdd,
  keymapEntries,
  keymapModeFor,
  keymapOwner,
  keymapRemove,
  saveKeymapPrefs,
  type KeymapMode,
} from "./keymap-store";
import type { ModGameCommand, ModKeybindings } from "@rpgm-tools/neo-angband-core";
export type { ModGameCommand, ModKeybinding, ModKeybindings } from "@rpgm-tools/neo-angband-core";

type Keyset = "original" | "roguelike";

let commandRows: () => readonly (KeypressCommandRow & { readonly id?: string })[] = () => [];

/** The live keypress command table, set once by the host at boot. */
export function setModCommandCatalogue(read: () => readonly (KeypressCommandRow & { readonly id?: string })[]): void {
  commandRows = read;
}

function gameCommands(): readonly ModGameCommand[] {
  return Object.freeze(commandRows().flatMap((row, index) => row.cat === null ? [] : [Object.freeze({
    id: row.id ?? `core:keypress-command:${index}`,
    name: row.desc,
    group: row.cat,
    keys: Object.freeze({ original: keyForKeyset(row, false), roguelike: keyForKeyset(row, true) }),
    control: row.ctrl ?? null,
  })]));
}

export function createModKeybindings(state: GameState): ModKeybindings {
  const current = () => keymapModeFor(state.options?.get("rogue_like_commands") ?? false);
  /* An omitted keyset is the one in use; anything but the two names is no keyset. */
  const modeOf = (keyset: Keyset | undefined): KeymapMode | null =>
    keyset === undefined ? current() : keyset === "original" ? "orig" : keyset === "roguelike" ? "rogue" : null;
  let pending: ((key: string | null) => void) | null = null;
  return Object.freeze({
    keyset: () => (current() === "rogue" ? "roguelike" : "original"),
    list: (keyset?: Keyset) => {
      const mode = modeOf(keyset);
      if (mode === null) return Object.freeze([]);
      return Object.freeze(keymapEntries(mode).map(([trigger, action]) =>
        Object.freeze({ trigger, action, owner: keymapOwner(mode, trigger) })));
    },
    set: (trigger: string, action: string, keyset?: Keyset): boolean => {
      const mode = modeOf(keyset);
      if (mode === null || !isBindableTriggerKey(trigger) || action.length === 0) return false;
      keymapAdd(mode, trigger, action);
      saveKeymapPrefs();
      return true;
    },
    remove: (trigger: string, keyset?: Keyset): boolean => {
      const mode = modeOf(keyset);
      if (mode === null) return false;
      const removed = keymapRemove(mode, trigger);
      if (removed) saveKeymapPrefs();
      return removed;
    },
    commands: gameCommands,
    capture: (): Promise<string | null> => {
      pending?.(null);
      return new Promise<string | null>((resolve) => {
        const finish = (key: string | null): void => {
          inputEvents.removeEventListener("keydown", onKey, true);
          if (pending === finish) pending = null;
          resolve(key);
        };
        const onKey = (ev: KeyboardEvent): void => {
          if (ev.key !== "Escape" && !isBindableTriggerKey(ev.key)) return;
          ev.preventDefault();
          ev.stopImmediatePropagation();
          finish(ev.key === "Escape" ? null : ev.key);
        };
        pending = finish;
        inputEvents.addEventListener("keydown", onKey, true);
      });
    },
    cancelCapture: (): boolean => {
      if (!pending) return false;
      pending(null);
      return true;
    },
  });
}
