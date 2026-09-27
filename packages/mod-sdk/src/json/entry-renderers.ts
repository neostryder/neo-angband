import { defineFormat, json } from "./index.js";
import { nonempty } from "./scalars.js";

/**
 * Character-screen renderer rows. `*` in a colour or symbol field means
 * "leave that part unchanged", the same token the old line used.
 */
export const entryRendererFormat = defineFormat({
  format: "neo-angband/prefs/entry-renderers",
  schemaVersion: 1,
  validator: json.object({
    renderers: json.array(json.object({
      name: nonempty,
      colors: nonempty,
      labelColors: nonempty,
      symbols: json.string,
    })),
  }),
  sample: {
    renderers: [{ name: "HEALTH", colors: "rR", labelColors: "w", symbols: "*" }],
  },
});
