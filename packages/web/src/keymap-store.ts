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

/**
 * A key upstream's trigger capture (keymap_get_trigger, ui-options.c:545-583)
 * and this port's runtime resolver both accept as a keymap TRIGGER: a single
 * printable character, or one of the named keys ui-event.c's `mappings` table
 * gives a bracketed text name to (ui-event.c:24-59) that a real keyboard can
 * send with no modifier held - today that is Enter (KC_ENTER, "Enter",
 * ui-event.h:169) and the F1-F12 row (KC_F1..KC_F12, "F1".."F12",
 * ui-event.h:144-155).
 *
 * Shared by keymap-edit.ts's trigger-capture prompt and main.ts's runtime
 * resolver so the two cannot independently decide what a trigger key is
 * allowed to be - which is how a bound Enter/F-key trigger could be accepted
 * by the editor yet silently never fire at the door (#62, #63).
 */
export function isBindableTriggerKey(key: string): boolean {
  return key.length === 1 || key === "Enter" || /^F([1-9]|1[0-2])$/u.test(key);
}

/**
 * Encode one captured keypress as a token inside a stored action string.
 * Upstream keeps an action as a raw `struct keypress` array (keymap_add,
 * ui-keymap.c:99); this port stores the action as plain text, so a named key
 * needs a textual stand-in. Upstream's own textual encoding for a
 * non-printable keycode is the bracketed name from ui-event.c's `mappings`
 * table: `keypress_to_text` (ui-event.c:233-260) writes literal "[Enter]" /
 * "[F5]" for KC_ENTER / KC_F5 rather than a raw control byte, and
 * `keypress_from_text` (ui-event.c:118, the `*str == '['` branch at
 * ui-event.c:174-188) parses that same bracket syntax back into a keycode.
 * Reusing it here means a single character still stores literally (matching
 * keypress_to_text's un-annotated case) and a named key stores as "[Name]".
 *
 * As with upstream's own format, an unescaped '[' always begins a keycode
 * name; this port does not (yet) implement upstream's backslash-escape for a
 * literal bracket, since none of the keys #62/#63 need are '[' or ']'.
 */
export function encodeActionToken(key: string): string {
  return key.length === 1 ? key : `[${key}]`;
}

/**
 * Split a stored action string back into the individual keypresses it
 * replays: the inverse of encodeActionToken / upstream's keypress_from_text
 * bracket parsing. A "[Name]" run is one token; anything else is split into
 * individual Unicode code points (surrogate-pair safe, unlike a bare
 * `[...action]` spread once brackets are mixed into the string).
 */
export function decodeActionTokens(action: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < action.length) {
    if (action[i] === "[") {
      const end = action.indexOf("]", i + 1);
      if (end > i) {
        tokens.push(action.slice(i + 1, end));
        i = end + 1;
        continue;
      }
    }
    const cp = action.codePointAt(i) ?? action.charCodeAt(i);
    tokens.push(String.fromCodePoint(cp));
    i += cp > 0xffff ? 2 : 1;
  }
  return tokens;
}
