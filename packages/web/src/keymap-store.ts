/**
 * User keymaps (keymap.c: keymap_add / keymap_remove / keymap_find).
 *
 * A keymap binds a single trigger key to an action: a string of keypresses fed
 * into the input queue when the trigger is pressed (do_cmd_keymaps, the runtime
 * hook lives in main.ts's top-level handler). Keymaps are per keyset mode -
 * KEYMAP_MODE_ORIG / KEYMAP_MODE_ROGUE - so the same trigger can differ between
 * the original and roguelike keysets, exactly as upstream keys them by mode.
 *
 * Persistence is per control profile in localStorage, shared across characters.
 * Desktop retains the original storage keys; Touch copies them once and then
 * saves independently. Each profile includes both keyset modes and mod owners.
 */

/** keymap modes (keymap.c KEYMAP_MODE_*). */
export type KeymapMode = "orig" | "rogue";

import { keyInput, keymapFormat, parseDocument, type Infer } from "@rpgm-tools/neo-angband-mod-sdk";
// parseDocument is used when a downloaded keymap file replaces the stored one.
import type { ControlProfile } from "./control-profile";
import { looksLikeEnvelope, writeStoredDocument } from "./json-storage";

let activeProfile: ControlProfile = "desktop";

function profileKey(key: string): string {
  return activeProfile === "desktop" ? key : `${key}:touch`;
}

/** trigger char -> action string, per mode. */
type KeymapTable = Record<string, string>;
const tables: Record<KeymapMode, KeymapTable> = { orig: {}, rogue: {} };
const typedKeys: Record<KeymapMode, Record<string, StoredBinding>> = { orig: {}, rogue: {} };

const KEYMAP_PREF_KEY = "neo-angband:keymaps";
/** Retired owner table, read only while converting an old keymap store. */
const KEYMAP_OWNER_PREF_KEY = "neo-angband:keymap-owners";

/** Mod owner per trigger, per mode. A missing entry means player-owned. */
type KeymapOwners = Record<KeymapMode, Record<string, string>>;
const owners: KeymapOwners = { orig: {}, rogue: {} };

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
  delete typedKeys[mode][trigger];
  /* The keymap editor owns this path. A player replacement turns a former mod
   * binding into the player's binding, so later mod teardown must leave it. */
  delete owners[mode][trigger];
}

/** keymap_remove (keymap.c): drop `trigger` in `mode`; returns whether one existed. */
export function keymapRemove(mode: KeymapMode, trigger: string): boolean {
  if (trigger in tables[mode]) {
    delete tables[mode][trigger];
    delete typedKeys[mode][trigger];
    delete owners[mode][trigger];
    return true;
  }
  return false;
}

/** All bindings for a mode (trigger, action) pairs, for the editor's listing. */
export function keymapEntries(mode: KeymapMode): [string, string][] {
  return Object.entries(tables[mode]);
}

/** The mod which owns this binding, or null for a player binding. */
export function keymapOwner(mode: KeymapMode, trigger: string): string | null {
  return owners[mode][trigger] ?? null;
}

/** Mark an existing binding as belonging to one mod. Only the facade calls this. */
export function keymapSetOwner(mode: KeymapMode, trigger: string, owner: string): void {
  if (!(trigger in tables[mode])) throw new Error("keymap owner requires an existing binding");
  owners[mode][trigger] = owner;
}

/** Remove every binding still owned by one mod. Returns whether anything changed. */
export function keymapRemoveOwnedBy(owner: string): boolean {
  let removed = false;
  for (const mode of ["orig", "rogue"] as const) {
    for (const [trigger] of keymapEntries(mode)) {
      if (keymapOwner(mode, trigger) === owner) removed = keymapRemove(mode, trigger) || removed;
    }
  }
  return removed;
}

interface StoredKey {
  key: string;
  code: string;
  modifiers: Infer<typeof keyInput>["modifiers"];
}

interface StoredBinding {
  mode: KeymapMode;
  trigger: StoredKey;
  action: StoredKey[];
  owner?: string;
}

/**
 * The older tables stored a trigger as the browser's `key` string and an
 * action as bracket text. `code` was not stored, so a converted key uses the
 * physical code a desktop keyboard reports for that string. Modifiers were
 * not stored either: Shift is already part of the letter.
 */
export function keyInputFromToken(token: string): StoredKey | null {
  if (token.length === 0) return null;
  let code = token;
  if (/^[a-zA-Z]$/u.test(token)) code = `Key${token.toUpperCase()}`;
  else if (/^[0-9]$/u.test(token)) code = `Digit${token}`;
  return { key: token, code, modifiers: [] };
}

function actionFromSteps(steps: readonly { key: string }[]): string {
  return steps.map((step) => encodeActionToken(step.key)).join("");
}

function applyBindings(bindings: readonly StoredBinding[]): void {
  for (const row of bindings) {
    const action = actionFromSteps(row.action);
    if (row.trigger.key.length === 0 || action.length === 0) continue;
    tables[row.mode][row.trigger.key] = action;
    typedKeys[row.mode][row.trigger.key] = row;
    if (row.owner && row.owner.length > 0) owners[row.mode][row.trigger.key] = row.owner;
  }
}

function bindingsFromTables(): StoredBinding[] {
  const bindings: StoredBinding[] = [];
  for (const mode of ["orig", "rogue"] as const) {
    for (const [trigger, action] of Object.entries(tables[mode])) {
      const original = typedKeys[mode][trigger];
      const triggerKey = original && actionFromSteps(original.action) === action
        ? original.trigger : keyInputFromToken(trigger);
      const steps = original && actionFromSteps(original.action) === action ? original.action : decodeActionTokens(action)
        .map((token) => keyInputFromToken(token))
        .filter((step): step is StoredKey => step !== null);
      if (!triggerKey || steps.length === 0) continue;
      const owner = owners[mode][trigger];
      bindings.push({
        mode,
        trigger: triggerKey,
        action: steps,
        ...(owner ? { owner } : {}),
      });
    }
  }
  return bindings;
}

function legacyBindings(raw: string | null, ownersRaw: string | null): { bindings: StoredBinding[] } | null {
  if (raw === null && ownersRaw === null) return null;
  let data: unknown = {};
  if (raw !== null) {
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const ownerMap: Record<KeymapMode, Record<string, string>> = { orig: {}, rogue: {} };
  if (ownersRaw !== null) {
    try {
      const parsed = JSON.parse(ownersRaw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const mode of ["orig", "rogue"] as const) {
          const known = (parsed as Record<string, unknown>)[mode];
          if (!known || typeof known !== "object") continue;
          for (const [trigger, owner] of Object.entries(known as Record<string, unknown>)) {
            if (typeof owner === "string" && owner.length > 0) ownerMap[mode][trigger] = owner;
          }
        }
      }
    } catch {
      /* A damaged owner table leaves every binding player-owned. */
    }
  }
  const bindings: StoredBinding[] = [];
  for (const mode of ["orig", "rogue"] as const) {
    const table = (data as Record<string, unknown>)[mode];
    if (!table || typeof table !== "object" || Array.isArray(table)) continue;
    for (const [trigger, action] of Object.entries(table as Record<string, unknown>)) {
      if (typeof action !== "string") continue;
      const triggerKey = keyInputFromToken(trigger);
      const steps = decodeActionTokens(action)
        .map((token) => keyInputFromToken(token))
        .filter((step): step is StoredKey => step !== null);
      if (!triggerKey || steps.length === 0) continue;
      const owner = ownerMap[mode][trigger];
      bindings.push({ mode, trigger: triggerKey, action: steps, ...(owner ? { owner } : {}) });
    }
  }
  return { bindings };
}

/** Load saved keymaps into the live tables (boot, before first input). */
export function loadKeymapPrefs(profile: ControlProfile = "desktop"): void {
  activeProfile = profile;
  clearKeymaps();
  let storage: Storage;
  try {
    storage = localStorage;
  } catch {
    return;
  }
  const key = profileKey(KEYMAP_PREF_KEY);
  const ownerKey = profileKey(KEYMAP_OWNER_PREF_KEY);
  // Touch starts from Desktop's converted document, then saves independently.
  try {
    if (profile === "touch" && storage.getItem(key) === null) {
      const desktop = storage.getItem(KEYMAP_PREF_KEY);
      const desktopOwners = storage.getItem(KEYMAP_OWNER_PREF_KEY);
      if (desktop !== null && looksLikeEnvelope(desktop)) {
        const parsed = parseDocument(desktop, keymapFormat);
        if (parsed.ok) writeStoredDocument(storage, key, keymapFormat, parsed.data);
      } else {
        const converted = legacyBindings(desktop, desktopOwners);
        if (converted) {
          const saved = writeStoredDocument(storage, KEYMAP_PREF_KEY, keymapFormat, converted, [KEYMAP_OWNER_PREF_KEY]);
          if (saved) writeStoredDocument(storage, key, keymapFormat, saved);
        }
      }
    }
  } catch {
    /* Storage can be unavailable. */
  }
  let raw: string | null = null;
  let ownersRaw: string | null = null;
  try {
    raw = storage.getItem(key);
    ownersRaw = storage.getItem(ownerKey);
  } catch {
    return;
  }
  if (raw !== null && looksLikeEnvelope(raw)) {
    const parsed = parseDocument(raw, keymapFormat);
    if (parsed.ok) applyBindings(parsed.data.bindings);
    return;
  }
  const converted = legacyBindings(raw, ownersRaw);
  if (converted === null) return;
  const written = writeStoredDocument(storage, key, keymapFormat, converted, [ownerKey]);
  if (written) applyBindings(written.bindings);
}

/** Replace the active profile's keymap document with a file the player imported. */
export function installKeymapDocument(text: string): boolean {
  const parsed = parseDocument(text, keymapFormat);
  if (!parsed.ok) return false;
  try {
    const written = writeStoredDocument(
      localStorage,
      profileKey(KEYMAP_PREF_KEY),
      keymapFormat,
      parsed.data,
      [profileKey(KEYMAP_OWNER_PREF_KEY)],
    );
    if (!written) return false;
    clearKeymaps();
    applyBindings(written.bindings);
    return true;
  } catch {
    return false;
  }
}

/** Persist the live keymaps as the user's keymap document. */
export function saveKeymapPrefs(): boolean {
  try {
    return writeStoredDocument(
      localStorage,
      profileKey(KEYMAP_PREF_KEY),
      keymapFormat,
      { bindings: bindingsFromTables() },
      [profileKey(KEYMAP_OWNER_PREF_KEY)],
    ) !== null;
  } catch {
    /* ignore: storage may be unavailable (private mode). */
    return false;
  }
}

/** Test hook: forget every keymap. */
export function clearKeymaps(): void {
  tables.orig = {};
  tables.rogue = {};
  typedKeys.orig = {};
  typedKeys.rogue = {};
  owners.orig = {};
  owners.rogue = {};
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
