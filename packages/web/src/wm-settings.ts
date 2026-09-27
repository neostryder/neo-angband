/**
 * The window manager's feature switches, kept in their own house JSON document
 * (`neo-angband/web/window-manager`) in browser storage, separate from the
 * layout itself so that turning a feature off never touches an arrangement.
 */

import { parseDocument, serializeDocument, windowManagerFormat } from "@rpgm-tools/neo-angband-mod-sdk";

export const WM_SETTINGS_STORAGE_KEY = "neo-angband:window-manager";

export interface WmSettings {
  readonly tabs: boolean;
  readonly fitSmallWindows: boolean;
  readonly lockDividers: boolean;
  readonly moveDungeonView: boolean;
}

export const DEFAULT_WM_SETTINGS: WmSettings = Object.freeze({
  tabs: true,
  fitSmallWindows: true,
  lockDividers: false,
  moveDungeonView: true,
});

/** An absent, unreadable or future-version document reads as the defaults. */
export function readWmSettings(storage: Pick<Storage, "getItem">): WmSettings {
  try {
    const raw = storage.getItem(WM_SETTINGS_STORAGE_KEY);
    if (raw === null) return DEFAULT_WM_SETTINGS;
    const result = parseDocument(raw, windowManagerFormat);
    return result.ok ? Object.freeze({ ...result.data }) : DEFAULT_WM_SETTINGS;
  } catch {
    return DEFAULT_WM_SETTINGS;
  }
}

/**
 * Store the switches. A stored document this build cannot read (a newer
 * schema version) is left alone, so running an older build never erases what
 * a newer one saved. Returns whether the write happened.
 */
export function writeWmSettings(storage: Pick<Storage, "getItem" | "setItem">, settings: WmSettings): boolean {
  try {
    const raw = storage.getItem(WM_SETTINGS_STORAGE_KEY);
    if (raw !== null) {
      const existing = parseDocument(raw, windowManagerFormat);
      if (!existing.ok && existing.issues.some((issue) => issue.message === "future schema version")) return false;
    }
    storage.setItem(WM_SETTINGS_STORAGE_KEY, serializeDocument(windowManagerFormat, { ...settings }, { compact: true }));
    return true;
  } catch {
    return false;
  }
}
