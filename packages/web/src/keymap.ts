/**
 * Keyboard-to-command mapping.
 *
 * Angband has two movement keysets. The ORIGINAL keyset (the default,
 * upstream `rogue_like_commands` = false) moves with the numeric keypad;
 * the ROGUELIKE keyset (opt-in) adds hjkl + yubn diagonals. We honor that
 * default here: numpad and arrow keys always move; the roguelike letters
 * are gated behind the same option the engine exposes.
 *
 * Directions use keypad numbering exactly like the engine (1-9, 5 = self).
 */

export interface KeyBinding {
  kind: "walk" | "run";
  dir: number;
}

/** Original keyset: numpad + arrows. Always active. */
const DIRS_ORIGINAL: Record<string, number> = {
  // Numpad (event.key reports digits when NumLock is on).
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  // Arrow keys (orthogonal only, like the engine's arrow handling).
  ArrowLeft: 4,
  ArrowDown: 2,
  ArrowUp: 8,
  ArrowRight: 6,
};

/** Roguelike keyset: hjkl orthogonals + yubn diagonals. Opt-in. */
const DIRS_ROGUELIKE: Record<string, number> = {
  h: 4,
  j: 2,
  k: 8,
  l: 6,
  y: 7,
  u: 9,
  b: 1,
  n: 3,
};

/**
 * Resolve a KeyboardEvent to a movement binding, or null when unbound.
 * `roguelikeKeys` mirrors the engine's rogue_like_commands option and
 * defaults to false (the original numpad keyset), matching upstream.
 */
export function resolveKey(
  ev: KeyboardEvent,
  roguelikeKeys = false,
): KeyBinding | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return null;

  const dir = DIRS_ORIGINAL[ev.key];
  if (dir !== undefined) return { kind: "walk", dir };

  if (roguelikeKeys) {
    // In the roguelike keyset a lowercase letter walks; the shifted
    // (uppercase) letter runs, as upstream does.
    const runDir = DIRS_ROGUELIKE[ev.key.toLowerCase()];
    if (runDir !== undefined) {
      return { kind: ev.shiftKey ? "run" : "walk", dir: runDir };
    }
  }
  return null;
}
