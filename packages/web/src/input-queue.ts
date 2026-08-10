/**
 * The pending-input queue (Term key queue / inkey's Term_key_push, term.c).
 *
 * Angband keymaps expand a trigger key into a sequence of keypresses that are
 * fed into the input queue; every subsequent inkey() (the top-level command
 * reader AND each sub-menu / prompt) pulls the next queued key exactly as if the
 * player had typed it, so a keymap can drive menus (e.g. "qc" = quaff, then pick
 * item c). This shell has no single inkey(): the top-level game handler and each
 * modal subscribes to the one input door. Synthesised input uses that same door,
 * so the top-most screen receives it just as inkey() would deliver it.
 *
 * Keys are delivered one per macrotask (setTimeout 0). A command that opens a
 * modal does so on the microtasks spawned while its trigger key is handled;
 * macrotasks run only after that microtask queue drains, so by the time the next
 * queued key is dispatched the modal's listener is attached and ready to consume
 * it. Delivering one-at-a-time (rather than all synchronously) is what lets each
 * opened menu register before the key meant for it arrives.
 */

/** A synthesized keypress. Keymap actions are plain characters (no modifiers). */
export interface SynthKey {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

import { clearQueuedUiInputs, enqueueUiInputs } from "./input-door";

/** Feed a sequence of keypresses into the input stream (keymap expansion). */
export function enqueueKeys(keys: readonly SynthKey[]): void {
  enqueueUiInputs(keys.map((key) => ({
    key: {
      key: key.key,
      modifiers: { ctrl: !!key.ctrlKey, shift: !!key.shiftKey, alt: !!key.altKey, meta: !!key.metaKey },
      repeat: false,
    },
  })));
}

/** Test hook: drop any pending synthesised keys. */
export function clearInputQueue(): void {
  clearQueuedUiInputs();
}
