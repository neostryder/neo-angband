/**
 * The keymap editor (do_cmd_keymaps -> keymap_actions[], ui-options.c L586-763):
 * query / create / remove a keymap for the current keyset. Reachable from the
 * '=' options menu ("Edit keymaps (advanced)", 'e').
 *
 * The pref-file "Load" / "Save" rows (ui-options.c L735-736) are omitted: the
 * port has no filesystem and keymaps persist automatically to localStorage
 * (keymap-store.ts) as soon as they are created / removed - the same user-pref
 * model as colours. Everything else mirrors ui_keymap_query / _create / _remove.
 */

import type { GlyphTerm } from "./term";
import { selectFromMenu } from "./overlay";
import { UI_TEXT } from "./ui-colors";
import {
  keymapAdd,
  keymapEntries,
  keymapFind,
  keymapModeFor,
  keymapRemove,
  saveKeymapPrefs,
} from "./keymap-store";

/** Read a single keypress inline (keymap_get_trigger-style). ESC returns null. */
function captureKey(term: GlyphTerm, prompt: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const { cols } = term.size();
    term.print(0, 0, prompt.slice(0, cols - 1), UI_TEXT);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.ctrlKey || ev.altKey || ev.metaKey) {
        if (!(ev.key === "u" || ev.key === "U")) return; // allow ^U through to callers
      }
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key.length !== 1 && ev.key !== "Escape") return; // ignore Shift/Arrows/etc.
      window.removeEventListener("keydown", onKey, true);
      resolve(ev.key === "Escape" ? null : ev.key);
    };
    window.addEventListener("keydown", onKey, true);
  });
}

/**
 * Read an action sequence (ui_keymap_create's inner loop, L648-690): printable
 * keys accumulate, '=' finishes, Backspace/Delete removes the last, Ctrl-U
 * resets, ESC cancels. Returns the action string, or null if cancelled.
 */
function captureAction(term: GlyphTerm, prompt: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let buf = "";
    const paint = (): void => {
      const { cols } = term.size();
      term.print(0, 0, `${prompt}${buf}`.slice(0, cols - 1).padEnd(cols - 1), UI_TEXT);
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key === "Escape") {
        window.removeEventListener("keydown", onKey, true);
        resolve(null);
        return;
      }
      if ((ev.ctrlKey && (ev.key === "u" || ev.key === "U"))) {
        buf = ""; // Ctrl-U reset
        paint();
        return;
      }
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
      if (ev.key === "Backspace" || ev.key === "Delete") {
        buf = buf.slice(0, -1);
        paint();
        return;
      }
      if (ev.key === "=") {
        window.removeEventListener("keydown", onKey, true);
        resolve(buf);
        return;
      }
      if (ev.key.length === 1) {
        buf += ev.key;
        paint();
      }
    };
    window.addEventListener("keydown", onKey, true);
    paint();
  });
}

/** Show a status message and wait for any key (upstream's msg + anykey). */
function ack(term: GlyphTerm, text: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const { cols } = term.size();
    term.print(0, 0, `${text}  [press any key]`.slice(0, cols - 1).padEnd(cols - 1), UI_TEXT);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key.length !== 1 && ev.key !== "Escape" && ev.key !== "Enter") return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      window.removeEventListener("keydown", onKey, true);
      resolve();
    };
    window.addEventListener("keydown", onKey, true);
  });
}

/** A y/n confirm inline (get_check "Keep this keymap? "). */
function confirm(term: GlyphTerm, prompt: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const { cols } = term.size();
    term.print(0, 0, prompt.slice(0, cols - 1).padEnd(cols - 1), UI_TEXT);
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (ev.key.length !== 1 && ev.key !== "Escape") return;
      window.removeEventListener("keydown", onKey, true);
      resolve(ev.key === "y" || ev.key === "Y");
    };
    window.addEventListener("keydown", onKey, true);
  });
}

/**
 * do_cmd_keymaps (ui-options.c L743): the query / create / remove menu for the
 * current keyset. `roguelike` selects the keymap mode. `notify` shows a status
 * line (message). Loops until ESC. Persists on every create / remove.
 */
export async function runKeymapEditor(term: GlyphTerm, roguelike: boolean): Promise<void> {
  const mode = keymapModeFor(roguelike);
  for (;;) {
    const count = keymapEntries(mode).length;
    const idx = await selectFromMenu(
      term,
      `Keymaps (${roguelike ? "roguelike" : "original"} keyset, ${count} defined)`,
      [
        { label: "Query a keymap" },
        { label: "Create a keymap" },
        { label: "Remove a keymap" },
      ],
      "[ a-c to choose, ESC to return ]",
    );
    if (idx === null) return;

    if (idx === 0) {
      // ui_keymap_query (L586): show the action bound to a trigger.
      const trigger = await captureKey(term, "Key: ");
      if (trigger === null) continue;
      const action = keymapFind(mode, trigger);
      await ack(term, action ? `Keymap: ${trigger} -> ${action}` : "No keymap with that trigger.");
    } else if (idx === 1) {
      // ui_keymap_create (L618): trigger, then an action sequence, then confirm.
      const trigger = await captureKey(term, "Key: ");
      if (trigger === null) continue;
      if (trigger === "=") {
        await ack(term, "The '=' key is reserved.");
        continue;
      }
      const action = await captureAction(term, "Action ('=' when done, Ctrl-U resets): ");
      if (action === null || action.length === 0) continue;
      const keep = await confirm(term, `Keep this keymap ('${trigger}' -> "${action}")? [y/n] `);
      if (keep) {
        keymapAdd(mode, trigger, action);
        saveKeymapPrefs();
        await ack(term, "Keymap added.");
      }
    } else {
      // ui_keymap_remove (L699).
      const trigger = await captureKey(term, "Key: ");
      if (trigger === null) continue;
      const removed = keymapRemove(mode, trigger);
      if (removed) saveKeymapPrefs();
      await ack(term, removed ? "Removed." : "No keymap to remove!");
    }
  }
}
