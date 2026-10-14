/**
 * The save document carried inside the storage wrapper.
 *
 * Compression and the integrity stamp stay outside this document. They are
 * what makes a save fit in browser storage and what detects a changed byte.
 * The field list stays open: `SAVE_VERSION` migrations and each mod's private
 * bag add fields this schema does not name, and a closed list would turn a
 * newer save into a damaged one.
 */

import { defineFormat, type ValidationResult, type Validator } from "./index.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

/**
 * The stable header every readable save has had, including saves written
 * before the envelope. Detailed fields belong to the save migration path.
 */
export function isSavedGameHeader(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    typeof value["version"] === "number" &&
    Number.isInteger(value["version"]) &&
    isRecord(value["player"]) &&
    isRecord(value["actor"]) &&
    isRecord(value["gear"]) &&
    isRecord(value["rng"]) &&
    typeof value["turn"] === "number" &&
    Number.isFinite(value["turn"]) &&
    typeof value["playing"] === "boolean" &&
    typeof value["isDead"] === "boolean" &&
    isRecord(value["flavor"])
  );
}

const validator: Validator<Record<string, unknown>> = {
  validate(value, path = "$"): ValidationResult<Record<string, unknown>> {
    if (!isSavedGameHeader(value)) {
      return { ok: false, issues: [{ path, message: "expected a save header" }] };
    }
    /* The same object, so a round trip keeps mod bags, key order and fields this version does not name. */
    return { ok: true, value };
  },
};

export const savedGameFormat = defineFormat({
  format: "neo-angband/core/saved-game",
  schemaVersion: 1,
  validator,
  sample: {
    version: 1,
    player: {},
    actor: {},
    gear: {},
    rng: {},
    turn: 0,
    playing: true,
    isDead: false,
    flavor: {},
  },
});
