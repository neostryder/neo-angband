import { defineFormat, json } from "./index.js";
import { nonempty } from "./scalars.js";

/** Aware autoinscriptions, named the way an `inscribe` line named them. */
export const autoinscriptionFormat = defineFormat({
  format: "neo-angband/prefs/autoinscriptions",
  schemaVersion: 1,
  validator: json.object({
    notes: json.array(json.object({
      tval: nonempty,
      sval: nonempty,
      text: json.string,
    })),
  }),
  sample: {
    notes: [{ tval: "potion", sval: "Cure Light Wounds", text: "@q1" }],
  },
});
