/**
 * The pending-input queue (Term key queue / inkey's Term_key_push, term.c).
 *
 * Angband keymaps expand a trigger key into a sequence of keypresses that are
 * fed into the input queue; every subsequent inkey() (the top-level command
 * reader AND each sub-menu / prompt) pulls the next queued key exactly as if the
 * player had typed it, so a keymap can drive menus (e.g. "qc" = quaff, then pick
 * item c). This shell has no single inkey(): the top-level game handler and each
 * modal attach their own capturing `keydown` listener on `window`, and the
 * top-level handler yields (returns early) whenever a modal is open. So a
 * synthesized keydown dispatched to `window` is delivered to whichever listener
 * is currently active - the modal's when one is open, the top-level's otherwise
 * - which is precisely the routing inkey() performs.
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

/** Marker on events this module synthesised, so a keymap never re-expands its
 * own output (upstream: keymap actions are not themselves keymapped). */
const SYNTH_FLAG = "__neoKeymapSynth";

const queue: SynthKey[] = [];
let pumping = false;

function makeKeyEvent(k: SynthKey): Event {
  const ev = new Event("keydown", { cancelable: true, bubbles: false });
  Object.assign(ev as object, {
    key: k.key,
    ctrlKey: !!k.ctrlKey,
    shiftKey: !!k.shiftKey,
    altKey: !!k.altKey,
    metaKey: !!k.metaKey,
    [SYNTH_FLAG]: true,
  });
  return ev;
}

function pump(): void {
  if (pumping || queue.length === 0) return;
  pumping = true;
  setTimeout(() => {
    pumping = false;
    const next = queue.shift();
    if (!next) return;
    window.dispatchEvent(makeKeyEvent(next));
    if (queue.length > 0) pump();
  }, 0);
}

/** Feed a sequence of keypresses into the input stream (keymap expansion). */
export function enqueueKeys(keys: readonly SynthKey[]): void {
  if (keys.length === 0) return;
  queue.push(...keys);
  pump();
}

/** Whether `ev` was synthesised here (a keymap's own output - do not re-expand). */
export function isSynthKey(ev: Event): boolean {
  return (ev as unknown as Record<string, unknown>)[SYNTH_FLAG] === true;
}

/** Test hook: drop any pending synthesised keys. */
export function clearInputQueue(): void {
  queue.length = 0;
  pumping = false;
}
