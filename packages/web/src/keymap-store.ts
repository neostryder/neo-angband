/**
 * User keymaps (keymap.c: keymap_add / keymap_remove / keymap_find).
 *
 * A keymap binds a single trigger key to an action: a string of keypresses fed
 * into the input queue when the trigger is pressed (do_cmd_keymaps, the runtime
 * hook lives in main.ts's top-level handler). Keymaps are per keyset mode -
 * KEYMAP_MODE_ORIG / KEYMAP_MODE_ROGUE - so the same trigger can differ between
 * the original and roguelike keysets, exactly as upstream keys them by mode.
 *
 * Persistence is a user-global pref in localStorage (like colours / graphics /
 * font). Upstream stores keymaps in a user pref file shared across characters,
 * not the per-character save; localStorage is the port's faithful equivalent.
 */

/** keymap modes (keymap.c KEYMAP_MODE_*). */
export type KeymapMode = "orig" | "rogue";

/** trigger char -> action string, per mode. */
type KeymapTable = Record<string, string>;
const tables: Record<KeymapMode, KeymapTable> = { orig: {}, rogue: {} };

const KEYMAP_PREF_KEY = "neo-angband:keymaps";

/** The keymap mode for the active keyset (rogue_like_commands). */
export function keymapModeFor(roguelike: boolean): KeymapMode {
  return roguelike ? "rogue" : "orig";
}

/** keymap_find (keymap.c): the action bound to `trigger` in `mode`, or null. */
export function keymapFind(mode: KeymapMode, trigger: string): string | null {
  return tables[mode][trigger] ?? null;
}

/** keymap_add (keymap.c): bind `trigger` to `action` in `mode` (replaces any). */
export function keymapAdd(mode: KeymapMode, trigger: string, action: string): void {
  tables[mode][trigger] = action;
}

/** keymap_remove (keymap.c): drop `trigger` in `mode`; returns whether one existed. */
export function keymapRemove(mode: KeymapMode, trigger: string): boolean {
  if (trigger in tables[mode]) {
    delete tables[mode][trigger];
    return true;
  }
  return false;
}

/** All bindings for a mode (trigger, action) pairs, for the editor's listing. */
export function keymapEntries(mode: KeymapMode): [string, string][] {
  return Object.entries(tables[mode]);
}

/** Load saved keymaps into the live tables (boot, before first input). */
export function loadKeymapPrefs(): void {
  try {
    const raw = localStorage.getItem(KEYMAP_PREF_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== "object") return;
    for (const mode of ["orig", "rogue"] as const) {
      const t = (data as Record<string, unknown>)[mode];
      if (t && typeof t === "object") {
        for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
          if (typeof v === "string" && k.length >= 1) tables[mode][k] = v;
        }
      }
    }
  } catch {
    /* ignore: a corrupt pref just means no custom keymaps. */
  }
}

/** Persist the live keymaps as the user's keymap pref. */
export function saveKeymapPrefs(): void {
  try {
    localStorage.setItem(KEYMAP_PREF_KEY, JSON.stringify(tables));
  } catch {
    /* ignore: storage may be unavailable (private mode). */
  }
}

/** Test hook: forget every keymap. */
export function clearKeymaps(): void {
  tables.orig = {};
  tables.rogue = {};
}
