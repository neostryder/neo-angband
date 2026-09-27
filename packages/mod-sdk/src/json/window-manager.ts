import { defineFormat, json } from "./index.js";

/**
 * The web host's window-manager feature switches. Each feature of the tiling
 * manager has its own switch so a player can turn it off without losing the
 * rest; a later feature adds a field under a new schema version.
 */
const validator = json.object({
  /** Panels can be dropped on each other's Tab target to share a space. */
  tabs: json.boolean,
  /** A window too small for every panel folds cramped panels into tabs. */
  fitSmallWindows: json.boolean,
  /** Dividers between panels cannot be dragged. */
  lockDividers: json.boolean,
});

export const windowManagerFormat = defineFormat({
  format: "neo-angband/web/window-manager",
  schemaVersion: 1,
  validator,
  sample: {
    tabs: true,
    fitSmallWindows: true,
    lockDividers: false,
  },
});
