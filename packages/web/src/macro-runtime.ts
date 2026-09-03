/**
 * The consented keymap door for in-process plugins.
 *
 * Keymaps are user-global preferences, so this facade intentionally delegates
 * to keymap-store rather than writing storage itself. That keeps a plugin's
 * binding in the live resolver and persists it through the one normal path.
 */

import type { GameState } from "@rpgm-tools/neo-angband-core";
import {
  isBindableTriggerKey,
  keymapAdd,
  keymapFind,
  keymapModeFor,
  saveKeymapPrefs,
} from "./keymap-store";
import type { ModKeymaps } from "./mod-plugin";

/** Capability required before a plugin may create a player keymap. */
export const KEYMAP_WRITE_CAPABILITY = "keymap:write";

/** Build the current-keyset keymap facade for one live game. */
export function createModKeymaps(state: GameState): ModKeymaps {
  const mode = (): "orig" | "rogue" => keymapModeFor(state.options?.get("rogue_like_commands") ?? false);
  return Object.freeze({
    isBindableTriggerKey: (trigger: string): boolean =>
      isBindableTriggerKey(trigger) && keymapFind(mode(), trigger) === null,
    bind: (trigger: string, action: string): boolean => {
      if (!isBindableTriggerKey(trigger) || keymapFind(mode(), trigger) !== null || action.length === 0) {
        return false;
      }
      keymapAdd(mode(), trigger, action);
      saveKeymapPrefs();
      return true;
    },
  });
}
