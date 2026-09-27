import { defineFormat, json, type Infer } from "./index.js";
import { nonNegativeInt } from "./scalars.js";

/**
 * The web host's single-value settings, one field each. Every field is
 * optional: an absent field means the setting's own default. Values are typed
 * here and range-checked by the module that owns the setting, so a value a
 * later build adds to a list (a new update channel, say) does not make the
 * whole document unreadable to this one.
 */
const validator = json.object({
  /** The player's language as a BCP 47 tag; absent means English. */
  locale: json.optional(json.string),
  /** A mod autoplayer's pump rate: turbo, fast, normal or slow. */
  autoplayerSpeed: json.optional(json.string),
  /** The browser has already been asked for persistent storage. */
  storagePersistenceAsked: json.optional(json.boolean),
  /** The installed desktop shell has already been refreshed once. */
  desktopShellRefreshed: json.optional(json.boolean),
  /** The update channel: stable, beta or early. */
  updateChannel: json.optional(json.string),
  /** The sidebar layout index; absent means the default layout. */
  sidebarMode: json.optional(nonNegativeInt),
  /** The console log level: error, warn, info or debug. */
  logLevel: json.optional(json.string),
  /** The graphics mode's grafID; absent means text. */
  tileMode: json.optional(nonNegativeInt),
  /** The control profile: desktop or touch. */
  controlProfile: json.optional(json.string),
  /** Mods from third-party sources may be installed. */
  allowThirdPartyMods: json.optional(json.boolean),
});

export const settingsFormat = defineFormat({
  format: "neo-angband/web/settings",
  schemaVersion: 1,
  validator,
  sample: {
    locale: "de",
    autoplayerSpeed: "normal",
    storagePersistenceAsked: true,
    desktopShellRefreshed: true,
    updateChannel: "stable",
    sidebarMode: 1,
    logLevel: "warn",
    tileMode: 2,
    controlProfile: "desktop",
    allowThirdPartyMods: false,
  },
});

export type Settings = Infer<typeof validator>;
