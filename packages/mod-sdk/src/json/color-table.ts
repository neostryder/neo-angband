import { color, defineFormat, json } from "./index.js";
import { uint8 } from "./scalars.js";

/**
 * Ids for the 32 palette rows, in angband_color_table order. Rows 29-31 have
 * no upstream name. `shade` is row 28, which the C table leaves unnamed.
 * `color.ts` keeps the same list; a web test fails if the two diverge.
 */
export const COLOR_PREF_IDS = [
  "dark",
  "white",
  "slate",
  "orange",
  "red",
  "green",
  "blue",
  "umber",
  "light-dark",
  "light-slate",
  "light-purple",
  "yellow",
  "light-red",
  "light-green",
  "light-blue",
  "light-umber",
  "purple",
  "violet",
  "teal",
  "mud",
  "light-yellow",
  "magenta-pink",
  "light-teal",
  "light-violet",
  "light-pink",
  "mustard",
  "blue-slate",
  "deep-light-blue",
  "shade",
  "unused-29",
  "unused-30",
  "unused-31",
] as const;

const entry = json.object({
  name: json.stableId,
  /** The extra palette byte upstream stores ahead of red. The web renderer does not use it. */
  kv: uint8,
  color,
});

const validator = json.object({
  colors: json.array(entry),
});

const colorTableValidator: typeof validator = {
  validate(value, path = "$") {
    const result = validator.validate(value, path);
    if (!result.ok) return result;
    const issues = [];
    if (result.value.colors.length !== COLOR_PREF_IDS.length) {
      issues.push({
        path: `${path}["colors"]`,
        message: `expected ${COLOR_PREF_IDS.length} palette rows`,
      });
    }
    result.value.colors.forEach((row, index) => {
      const expected = COLOR_PREF_IDS[index];
      if (expected !== undefined && row.name !== expected) {
        issues.push({
          path: `${path}["colors"][${index}]["name"]`,
          message: `expected ${expected}`,
        });
      }
    });
    return issues.length ? { ok: false as const, issues } : result;
  },
};

export const colorTableFormat = defineFormat({
  format: "neo-angband/prefs/color-table",
  schemaVersion: 1,
  validator: colorTableValidator,
  sample: {
    colors: COLOR_PREF_IDS.map((name) => ({
      name,
      kv: 0,
      color: { red: 0, green: 0, blue: 0, alpha: 255 },
    })),
  },
});
