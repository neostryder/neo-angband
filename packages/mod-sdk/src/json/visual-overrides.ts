import { defineFormat, json } from "./index.js";
import { glyph, nonNegativeInt, uint8 } from "./scalars.js";

/**
 * ASCII attr/char overrides a player saved, plus message colours from the
 * same preference file. Names are the game's own names, so they stay strings
 * rather than kebab-case ids. A section that is absent is left unchanged.
 */
const painted = {
  color: uint8,
  glyph,
};

const monster = json.object({ name: json.string, ...painted });
const objectRow = json.object({ tval: json.string, sval: json.string, ...painted });
const feature = json.object({
  code: json.string,
  lighting: json.enum(["torch", "los", "lit", "dark", "all"] as const),
  ...painted,
});
const trap = json.object({
  trap: json.string,
  lighting: json.enum(["torch", "los", "lit", "dark", "all"] as const),
  ...painted,
});
const flavor = json.object({ index: nonNegativeInt, ...painted });
const projection = json.object({
  types: json.array(json.string),
  motion: json.enum(["static", "deg-0", "deg-45", "deg-90", "deg-135"] as const),
  ...painted,
});
const message = json.object({ message: nonNegativeInt, color: uint8 });

export const visualOverrideFormat = defineFormat({
  format: "neo-angband/prefs/visual-overrides",
  schemaVersion: 1,
  validator: json.object({
    monsters: json.optional(json.array(monster)),
    monsterBases: json.optional(json.array(monster)),
    objects: json.optional(json.array(objectRow)),
    features: json.optional(json.array(feature)),
    traps: json.optional(json.array(trap)),
    flavors: json.optional(json.array(flavor)),
    projections: json.optional(json.array(projection)),
    messages: json.optional(json.array(message)),
  }),
  sample: {
    monsters: [{ name: "Kobold", color: 4, glyph: "k" }],
    features: [{ code: "FLOOR", lighting: "torch", color: 1, glyph: "." }],
  },
});
