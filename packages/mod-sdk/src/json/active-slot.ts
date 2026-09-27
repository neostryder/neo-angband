import { defineFormat, json, type ValidationResult } from "./index.js";

/** Browser-storage key for the active-slot document. */
export const ACTIVE_STORAGE_KEY = "neo-angband-active-slot";
/** Previous key: the slot id as a raw string, not a JSON document. */
export const LEGACY_ACTIVE_STORAGE_KEY = "neo-angband-active";

export interface ActiveSlot {
  activeSlotId: string;
}

const shape = json.object({ activeSlotId: json.string });

const validator = {
  validate(value: unknown, path = "$"): ValidationResult<ActiveSlot> {
    const result = shape.validate(value, path);
    if (!result.ok) return result;
    if (result.value.activeSlotId === "") {
      return { ok: false, issues: [{ path: `${path}["activeSlotId"]`, message: "activeSlotId must be nonempty" }] };
    }
    return result;
  },
};

export const activeSlotFormat = defineFormat({
  format: "neo-angband/web/active-slot",
  schemaVersion: 1,
  validator,
  sample: { activeSlotId: "c1" },
});

/** A raw slot id from the previous key, or null when the text is empty. */
export function activeSlotFromLegacy(raw: string): ActiveSlot | null {
  if (raw === "") return null;
  const slot: ActiveSlot = { activeSlotId: raw };
  const checked = validator.validate(slot);
  return checked.ok ? checked.value : null;
}
