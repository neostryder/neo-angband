/**
 * The web host's single-value settings, kept in one house JSON document
 * (`neo-angband/web/settings`) instead of one browser-storage key each (#288).
 * Each setting used to live under its own key with its own string encoding
 * ("1", "yes", a bare number, a JSON string); `LEGACY` records each one so
 * field-document.ts can read and convert it.
 */

import { settingsFormat, type Settings } from "@rpgm-tools/neo-angband-mod-sdk";

import { fieldDocument, legacyJson, type FieldReader, type FieldWriter, type LegacyFields } from "./field-document";

export const SETTINGS_STORAGE_KEY = "neo-angband:settings";

export type { Settings };
export type SettingName = keyof Settings;
export type SettingsWriter = FieldWriter;

function wholeNumber(raw: string): number | undefined {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

const stringJson = legacyJson<unknown>("neo:autoplayerSpeed");

const LEGACY: LegacyFields<Settings> = {
  locale: { key: "neo:locale", parse: (raw) => raw },
  autoplayerSpeed: {
    key: stringJson.key,
    parse: (raw) => {
      const value = stringJson.parse(raw);
      return typeof value === "string" ? value : undefined;
    },
  },
  storagePersistenceAsked: { key: "neo:storageAsked", parse: (raw) => (raw === "1" ? true : undefined) },
  desktopShellRefreshed: { key: "neo:desktop-shell-refreshed", parse: (raw) => (raw.length > 0 ? true : undefined) },
  updateChannel: { key: "neo-angband:update-channel", parse: (raw) => raw },
  sidebarMode: { key: "neo-angband:sidebar-mode", parse: wholeNumber },
  logLevel: { key: "neo-angband:log-level", parse: (raw) => raw },
  tileMode: { key: "neo-angband:graf", parse: wholeNumber },
  controlProfile: { key: "neo-angband:control-profile", parse: (raw) => raw },
  allowThirdPartyMods: {
    key: "neo-angband:allow-third-party-mods",
    parse: (raw) => (raw === "yes" ? true : raw === "no" ? false : undefined),
  },
};

const settings = fieldDocument({ format: settingsFormat, storageKey: SETTINGS_STORAGE_KEY, empty: {}, legacy: LEGACY });

/** One setting, or undefined for its default. Never throws. */
export function readSetting<K extends SettingName>(store: FieldReader | null | undefined, name: K): Settings[K] | undefined {
  return settings.read(store, name);
}

/**
 * Store one setting; `undefined` returns it to its default. A document this
 * build cannot read (a newer schema version) is left alone, so an older build
 * never erases what a newer one saved. Returns whether the value was stored.
 */
export function writeSetting<K extends SettingName>(
  store: FieldWriter | null | undefined,
  name: K,
  value: Settings[K] | undefined,
): boolean {
  return settings.write(store, name, value);
}

/** Move every setting still under its old key into the document, once, at boot. */
export function convertLegacySettings(store: Pick<Storage, "getItem" | "setItem" | "removeItem">): void {
  settings.convert(store);
}
