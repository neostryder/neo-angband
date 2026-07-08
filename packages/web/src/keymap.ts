/**
 * Keyboard-to-command mapping: the original Angband keyset (hjkl +
 * diagonals, numpad) plus arrow keys, customizable later via settings.
 * Directions use keypad numbering exactly like the engine.
 */

export interface KeyBinding {
  kind: "walk" | "run";
  dir: number;
}

const DIRS: Record<string, number> = {
  // Roguelike keys.
  h: 4,
  j: 2,
  k: 8,
  l: 6,
  y: 7,
  u: 9,
  b: 1,
  n: 3,
  // Arrows.
  ArrowLeft: 4,
  ArrowDown: 2,
  ArrowUp: 8,
  ArrowRight: 6,
  // Numpad (event.key reports digits when NumLock is on).
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
};

/** Resolve a KeyboardEvent to a binding, or null when unbound. */
export function resolveKey(ev: KeyboardEvent): KeyBinding | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  const dir = DIRS[ev.key];
  if (dir === undefined) {
    // Shifted roguelike keys run instead of walk.
    const lower = ev.key.toLowerCase();
    const runDir = ev.shiftKey ? DIRS[lower] : undefined;
    return runDir !== undefined ? { kind: "run", dir: runDir } : null;
  }
  return { kind: "walk", dir };
}
