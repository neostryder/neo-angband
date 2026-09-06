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
  keymapEntries,
  keymapFind,
  keymapModeFor,
  keymapOwner,
  keymapRemove,
  keymapRemoveOwnedBy,
  keymapSetOwner,
  saveKeymapPrefs,
} from "./keymap-store";
import type { ModKeymaps } from "./mod-plugin";

/** Capability required before a plugin may manage its own player keymaps. */
export const KEYMAP_WRITE_CAPABILITY = "keymap:write";

/** Build the current-keyset keymap facade for one live mod. */
export function createModKeymaps(owner: string, state: GameState): ModKeymaps {
  const mode = (): "orig" | "rogue" => keymapModeFor(state.options?.get("rogue_like_commands") ?? false);
  return Object.freeze({
    isBindableTriggerKey: (trigger: string): boolean =>
      isBindableTriggerKey(trigger) && keymapFind(mode(), trigger) === null,
    bind: (trigger: string, action: string): boolean => {
      if (!isBindableTriggerKey(trigger) || keymapFind(mode(), trigger) !== null || action.length === 0) {
        return false;
      }
      keymapAdd(mode(), trigger, action);
      keymapSetOwner(mode(), trigger, owner);
      saveKeymapPrefs();
      return true;
    },
    entries: () =>
      Object.freeze(
        keymapEntries(mode())
          .filter(([trigger]) => keymapOwner(mode(), trigger) === owner)
          .map(([trigger, action]) => Object.freeze({ trigger, action })),
      ),
    rebind: (trigger: string, action: string): boolean => {
      if (!isBindableTriggerKey(trigger) || keymapOwner(mode(), trigger) !== owner || action.length === 0) {
        return false;
      }
      keymapAdd(mode(), trigger, action);
      keymapSetOwner(mode(), trigger, owner);
      saveKeymapPrefs();
      return true;
    },
    remove: (trigger: string): boolean => {
      if (keymapOwner(mode(), trigger) !== owner) return false;
      const removed = keymapRemove(mode(), trigger);
      if (removed) saveKeymapPrefs();
      return removed;
    },
  });
}

/** Remove bindings a departing mod still owns, then persist the normal keymap pref. */
export function releaseModKeymaps(owner: string): void {
  if (keymapRemoveOwnedBy(owner)) saveKeymapPrefs();
}
