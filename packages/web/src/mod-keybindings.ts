/**
 * `ctx.keybindings`: the player's keymap editor, for a mod that draws its own
 * controls screen. Present with `keymap:edit`. It works on the current keyset
 * (original or roguelike, from `rogue_like_commands`), exactly like the game's
 * own keymap editor, and every change is saved at once, as that editor saves.
 *
 * A binding the player sets here is the player's, even when it replaces one a
 * mod created with `ctx.keymaps`: that mod no longer owns it and will not remove
 * it when it is turned off.
 */

import type { GameState } from "@rpgm-tools/neo-angband-core";
import { inputEvents } from "./input-door";
import {
  isBindableTriggerKey,
  keymapAdd,
  keymapEntries,
  keymapModeFor,
  keymapOwner,
  keymapRemove,
  saveKeymapPrefs,
} from "./keymap-store";

export interface ModKeybinding {
  /** The key that runs the binding, such as "g" or "F5". */
  readonly trigger: string;
  /** The keys it presses, in the keymap action encoding ("R&[Enter]"). */
  readonly action: string;
  /** The mod that created it with `ctx.keymaps`, or null for the player's own. */
  readonly owner: string | null;
}

export interface ModKeybindings {
  /** "original" or "roguelike": the keyset these bindings belong to. */
  keyset(): "original" | "roguelike";
  list(): readonly ModKeybinding[];
  /** Bind or replace one trigger. False for a trigger no keymap can use, or an empty action. */
  set(trigger: string, action: string): boolean;
  /** Remove one binding; false when there was none. */
  remove(trigger: string): boolean;
  /**
   * Resolve with the next key the player presses that a keymap can use, or null
   * for Escape. The key is taken before the game sees it, so it runs nothing.
   * A second capture while one is waiting resolves the first with null.
   */
  capture(): Promise<string | null>;
}

export function createModKeybindings(state: GameState): ModKeybindings {
  const mode = () => keymapModeFor(state.options?.get("rogue_like_commands") ?? false);
  let pending: ((key: string | null) => void) | null = null;
  return Object.freeze({
    keyset: () => (mode() === "rogue" ? "roguelike" : "original"),
    list: () => Object.freeze(keymapEntries(mode()).map(([trigger, action]) =>
      Object.freeze({ trigger, action, owner: keymapOwner(mode(), trigger) }))),
    set: (trigger: string, action: string): boolean => {
      if (!isBindableTriggerKey(trigger) || action.length === 0) return false;
      keymapAdd(mode(), trigger, action);
      saveKeymapPrefs();
      return true;
    },
    remove: (trigger: string): boolean => {
      const removed = keymapRemove(mode(), trigger);
      if (removed) saveKeymapPrefs();
      return removed;
    },
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
  });
}
