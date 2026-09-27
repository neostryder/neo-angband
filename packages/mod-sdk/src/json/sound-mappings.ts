import { defineFormat, json, type ValidationIssue } from "./index.js";
import { nonempty } from "./scalars.js";

/**
 * Message name to sample base-names. The message name is upstream's MSG_
 * symbol, which is not kebab-case, so it stays a string field.
 */
const mapping = json.object({
  message: nonempty,
  samples: json.array(nonempty),
});

const validator = json.object({
  mappings: json.array(mapping),
});

const soundValidator: typeof validator = {
  validate(value, path = "$") {
    const result = validator.validate(value, path);
    if (!result.ok) return result;
    const issues: ValidationIssue[] = [];
    result.value.mappings.forEach((row, index) => {
      if (row.samples.length === 0) {
        issues.push({ path: `${path}["mappings"][${index}]["samples"]`, message: "expected at least one sample" });
      }
    });
    return issues.length ? { ok: false as const, issues } : result;
  },
};

export const soundMappingFormat = defineFormat({
  format: "neo-angband/prefs/sound-mappings",
  schemaVersion: 1,
  validator: soundValidator,
  sample: {
    mappings: [{ message: "HIT", samples: ["plc_hit_hay", "plc_hit_body"] }],
  },
});
