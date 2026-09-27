/**
 * The player's customised option defaults, one document per option page.
 *
 * Option names stay the option table's own identifiers (`rogue_like_commands`).
 * The game looks them up verbatim, so they are string values rather than
 * kebab-case ids.
 */

import { defineFormat, json } from "./index.js";
import type { Validator } from "./index.js";

const optionName: Validator<string> = {
  validate(value, path = "$") {
    if (typeof value !== "string" || !/^[a-z][a-z0-9_]*$/u.test(value)) {
      return { ok: false, issues: [{ path, message: "expected an option name" }] };
    }
    return { ok: true, value };
  },
};

export const customOptionsFormat = defineFormat({
  format: "neo-angband/player/custom-options",
  schemaVersion: 1,
  validator: json.object({
    page: json.enum(["birth", "interface", "cheat", "score", "special"] as const),
    options: json.array(json.object({
      name: optionName,
      enabled: json.boolean,
    })),
  }),
  sample: {
    page: "interface",
    options: [{ name: "rogue_like_commands", enabled: false }],
  },
});
