/**
 * The web host's single-value settings, kept in one house JSON document
 * (`neo-angband/web/settings`) instead of one browser-storage key each (#288).
 *
 * Each setting used to live under its own key with its own string encoding
 * ("1", "yes", a bare number, a JSON string). A read that finds no field in
 * the document falls back to that old key once, so a setting saved by an
 * earlier build is never lost; the next write of that setting, or the one-time
 * `convertLegacySettings` pass at boot, moves it into the document and removes
 * the old key after the document reads back.
 */

import { parseDocument, serializeDocument, settingsFormat, type Settings } from "@rpgm-tools/neo-angband-mod-sdk";

export const SETTINGS_STORAGE_KEY = "neo-angband:settings";

export type { Settings };
export type SettingName = keyof Settings;

type Reader = Pick<Storage, "getItem">;
/** A store a setting can be written to; `removeItem` lets the old key be cleared. */
export type SettingsWriter = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;
type Writer = SettingsWriter;

/** Where each setting lived before the document, and how it was spelled there. */
const LEGACY: { readonly [K in SettingName]-?: { readonly key: string; parse(raw: string): Settings[K] | undefined } } = {
  locale: { key: "neo:locale", parse: (raw) => raw },
  autoplayerSpeed: {
    key: "neo:autoplayerSpeed",
    parse: (raw) => {
      try {
        const value: unknown = JSON.parse(raw);
        return typeof value === "string" ? value : undefined;
      } catch {
        return undefined;
      }
    },
  },
  storagePersistenceAsked: { key: "neo:storageAsked", parse: (raw) => (raw === "1" ? true : undefined) },
  desktopShellRefreshed: { key: "neo:desktop-shell-refreshed", parse: (raw) => (raw.length > 0 ? true : undefined) },
  updateChannel: { key: "neo-angband:update-channel", parse: (raw) => raw },
  sidebarMode: { key: "neo-angband:sidebar-mode", parse: (raw) => wholeNumber(raw) },
  logLevel: { key: "neo-angband:log-level", parse: (raw) => raw },
  tileMode: { key: "neo-angband:graf", parse: (raw) => wholeNumber(raw) },
  controlProfile: { key: "neo-angband:control-profile", parse: (raw) => raw },
  allowThirdPartyMods: {
    key: "neo-angband:allow-third-party-mods",
    parse: (raw) => (raw === "yes" ? true : raw === "no" ? false : undefined),
  },
};

function wholeNumber(raw: string): number | undefined {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

type DocumentRead = { readonly kind: "absent" } | { readonly kind: "ok"; readonly data: Settings } | { readonly kind: "blocked" };

/** The stored document. A future or damaged one is "blocked": read around it, never overwrite it. */
function readDocument(store: Reader): DocumentRead {
  const raw = store.getItem(SETTINGS_STORAGE_KEY);
  if (raw === null) return { kind: "absent" };
  const parsed = parseDocument(raw, settingsFormat);
  return parsed.ok ? { kind: "ok", data: parsed.data } : { kind: "blocked" };
}

/** One setting, or undefined for its default. Never throws. */
export function readSetting<K extends SettingName>(store: Reader | null | undefined, name: K): Settings[K] | undefined {
  if (!store) return undefined;
  try {
    const doc = readDocument(store);
    if (doc.kind === "ok" && doc.data[name] !== undefined) return doc.data[name];
    const raw = store.getItem(LEGACY[name].key);
    return raw === null ? undefined : LEGACY[name].parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Store one setting; `undefined` returns it to its default. A document this
 * build cannot read (a newer schema version) is left alone, so an older build
 * never erases what a newer one saved. Returns whether the value was stored.
 */
export function writeSetting<K extends SettingName>(
  store: Writer | null | undefined,
  name: K,
  value: Settings[K] | undefined,
): boolean {
  if (!store) return false;
  try {
    const doc = readDocument(store);
    if (doc.kind === "blocked") return false;
    const next: Record<string, unknown> = { ...(doc.kind === "ok" ? doc.data : {}) };
    if (value === undefined) delete next[name];
    else next[name] = value;
    store.setItem(SETTINGS_STORAGE_KEY, serializeDocument(settingsFormat, next as Settings, { compact: true }));
    const back = readDocument(store);
    if (back.kind !== "ok" || back.data[name] !== value) return false;
    store.removeItem?.(LEGACY[name].key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move every setting still under its old key into the document, once. Each
 * old key is removed only after the document reads back holding its value. A
 * document this build cannot read is left alone, and so are the old keys.
 */
export function convertLegacySettings(store: Pick<Storage, "getItem" | "setItem" | "removeItem">): void {
  try {
    const doc = readDocument(store);
    if (doc.kind === "blocked") return;
    const next: Record<string, unknown> = { ...(doc.kind === "ok" ? doc.data : {}) };
    const moved: string[] = [];
    for (const name of Object.keys(LEGACY) as SettingName[]) {
      const legacy = LEGACY[name];
      const raw = store.getItem(legacy.key);
      if (raw === null) continue;
      if (next[name] === undefined) {
        const value = legacy.parse(raw);
        if (value !== undefined) next[name] = value;
      }
      moved.push(legacy.key);
    }
    if (moved.length === 0) return;
    store.setItem(SETTINGS_STORAGE_KEY, serializeDocument(settingsFormat, next as Settings, { compact: true }));
    const back = readDocument(store);
    if (back.kind !== "ok") return;
    for (const key of moved) store.removeItem(key);
  } catch {
    /* A setting that stays under its old key still reads through the fallback. */
  }
}
