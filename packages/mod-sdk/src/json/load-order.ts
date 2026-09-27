import { defineFormat, json } from "./index.js";

const validator = json.object({ order: json.array(json.stableId) });
export const loadOrderFormat = defineFormat({
  format: "neo-angband/mod/load-order",
  schemaVersion: 1,
  validator,
  sample: { order: ["demo-mod"] },
});
