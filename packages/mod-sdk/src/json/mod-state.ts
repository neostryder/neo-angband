import { defineFormat, json, type Infer, type Validator } from "./index.js";

/* Mod ids, rule flags ("qol.autoDig", "bugfix.*") and section ids are all
 * author-chosen strings, so these maps accept any string key. */
function byName<T>(inner: Validator<T>): Validator<Record<string, T>> {
  return json.map(inner, json.string);
}

const pin = json.object({
  after: json.optional(json.array(json.string)),
  before: json.optional(json.array(json.string)),
});

/**
 * The mod manager's durable state for one profile. Every field is optional: an
 * absent `enabled` means the player has never set the enabled set, so the
 * defaults apply, which is different from an empty list.
 */
const validator = json.object({
  /** The enabled mods, in load order. */
  enabled: json.optional(json.array(json.string)),
  /** Mod id to the player's explicit on or off, which outranks an external manager's order. */
  choices: json.optional(byName(json.boolean)),
  /** Mod id to the capabilities the player approved for it. */
  consents: json.optional(byName(json.array(json.string))),
  /** Rule flag to the player's explicit on or off. */
  ruleChoices: json.optional(byName(json.boolean)),
  /** Mod id to the mods the player placed it after or before. */
  pins: json.optional(byName(pin)),
  /** Mod id to section id to the player's explicit on or off. */
  sectionChoices: json.optional(byName(byName(json.boolean))),
});

export type ModState = Infer<typeof validator>;

export const modStateFormat = defineFormat({
  format: "neo-angband/web/mod-state",
  schemaVersion: 1,
  validator,
  sample: {
    enabled: ["neo-angband-mod-qol", "neo-angband-mod-bug-fixes"],
    choices: { "neo-angband-mod-qol": true },
    consents: { "neo-angband-mod-qol": ["ui:panel.mount"] },
    ruleChoices: { "qol.autoDig": false },
    pins: { "neo-angband-mod-qol": { after: ["neo-angband-mod-bug-fixes"] } },
    sectionChoices: { "neo-angband-mod-qol": { tiles: true } },
  },
});
