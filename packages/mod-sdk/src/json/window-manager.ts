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
  /** The dungeon view shows a grip that drags it to another place. */
  moveDungeonView: json.boolean,
  /** A panel that asks for a content height gets it until its divider is dragged. */
  fitToContent: json.boolean,
  /** Panels may float inside the game viewport. */
  floatingWindows: json.optional(json.boolean),
});

export const windowManagerFormat = defineFormat({
  format: "neo-angband/web/window-manager",
  schemaVersion: 1,
  validator,
  sample: {
    tabs: true,
    fitSmallWindows: true,
    lockDividers: false,
    moveDungeonView: true,
    fitToContent: true,
    floatingWindows: true,
  },
});
