import { defineFormat, json, type Infer, type Validator } from "./index.js";

const look: Validator<"Vanilla" | "Neo"> = {
  validate: (value, path = "$") => value === "Vanilla" || value === "Neo"
    ? { ok: true, value }
    : { ok: false, issues: [{ path, message: "expected Vanilla or Neo" }] },
};
const values = json.map(json.finiteNumber, json.string);
const validator = json.object({
  chosen: json.boolean,
  desired: look,
  active: look,
  pending: json.nullable(json.object({ look, modId: json.string })),
  snapshot: json.nullable(json.object({ enabled: json.boolean, settings: values, presetKeys: json.array(json.string) })),
  neoSettings: values,
  playerChanges: values,
});

export type LookState = Infer<typeof validator>;

export const lookFormat = defineFormat({
  format: "neo-angband/web/look",
  schemaVersion: 1,
  validator: {
    validate(value, path = "$") {
      const result = validator.validate(value, path);
      if (!result.ok) return result;
      const state = result.value;
      if ((state.pending !== null && (state.desired !== "Neo" || state.active !== "Vanilla" || state.pending.look !== "Neo" || state.pending.modId !== "anybandui")) ||
          (state.desired !== state.active && state.pending === null) ||
          (state.active === "Neo" && state.snapshot === null)) {
        return { ok: false, issues: [{ path, message: "inconsistent look state" }] };
      }
      return result;
    },
  },
  sample: { chosen: false, desired: "Vanilla", active: "Vanilla", pending: null, snapshot: null, neoSettings: {}, playerChanges: {} },
});
