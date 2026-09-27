import { defineFormat, json } from "./index.js";

const validator = json.object({ buildId: json.string });
export const buildIdFormat = defineFormat({
  format: "neo-angband/web/build-id",
  schemaVersion: 1,
  validator,
  sample: { buildId: "local-build" },
});
