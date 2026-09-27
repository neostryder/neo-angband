import { defineFormat, json, type Infer } from "./index.js";

/**
 * The player's values for mod settings (PackSetting), mod id to setting id to
 * number, for one profile. It is its own document rather than a field of the
 * mod state, because the mod-state validator refuses fields it does not know,
 * and a build from before settings existed would then lose the whole mod state.
 */
const validator = json.object({
  values: json.optional(json.map(json.map(json.finiteNumber, json.string), json.string)),
});

export type ModSettingValues = Infer<typeof validator>;

export const modSettingValuesFormat = defineFormat({
  format: "neo-angband/web/mod-settings",
  schemaVersion: 1,
  validator,
  sample: { values: { "neo-angband-mod-anybandui": { crtStrength: 60 } } },
});
