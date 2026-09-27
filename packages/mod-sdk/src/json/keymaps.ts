import { defineFormat, json, keyInput, type ValidationIssue } from "./index.js";

/**
 * Player keymaps and the mod that owns each one.
 *
 * A trigger and every step of its action are key input. The in-memory tables
 * still match on the `key` string the browser reports; `code` is recorded so
 * the document can name the physical key. An owner is omitted for a binding
 * the player owns.
 */
const binding = json.object({
  mode: json.enum(["orig", "rogue"] as const),
  trigger: keyInput,
  action: json.array(keyInput),
  owner: json.optional(json.string),
});

const validator = json.object({
  bindings: json.array(binding),
});

const keymapValidator: typeof validator = {
  validate(value, path = "$") {
    const result = validator.validate(value, path);
    if (!result.ok) return result;
    const issues: ValidationIssue[] = [];
    result.value.bindings.forEach((row, index) => {
      if (row.action.length === 0) {
        issues.push({ path: `${path}["bindings"][${index}]["action"]`, message: "expected at least one key" });
      }
      if (row.owner !== undefined && row.owner.length === 0) {
        issues.push({ path: `${path}["bindings"][${index}]["owner"]`, message: "omit an empty owner" });
      }
    });
    return issues.length ? { ok: false as const, issues } : result;
  },
};

export const keymapFormat = defineFormat({
  format: "neo-angband/prefs/keymaps",
  schemaVersion: 1,
  validator: keymapValidator,
  sample: {
    bindings: [
      {
        mode: "orig",
        trigger: { key: "X", code: "KeyX", modifiers: [] },
        action: [
          { key: "q", code: "KeyQ", modifiers: [] },
          { key: "Enter", code: "Enter", modifiers: [] },
        ],
      },
    ],
  },
});
