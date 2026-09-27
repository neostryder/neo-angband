/**
 * A `.neochar` character file: one pretty JSON document.
 *
 * `save` is the game document when this build can read the slot, and the
 * original slot text when it cannot. An unreadable slot still has to travel,
 * because exporting it is how a later build gets a second look.
 */

import { defineFormat, json, utcTimestamp, type ValidationResult, type Validator } from "./index.js";

const metaShape = json.object({
  name: json.string,
  race: json.string,
  cls: json.string,
  sex: json.string,
  level: json.integer,
  depth: json.integer,
  maxDepth: json.integer,
  turn: json.integer,
  alive: json.boolean,
});

export interface CharacterExportMeta {
  name: string;
  race: string;
  cls: string;
  sex: string;
  level: number;
  depth: number;
  maxDepth: number;
  turn: number;
  alive: boolean;
}

export interface CharacterExport {
  engine: string;
  exportedAt: string;
  lineage?: string;
  meta: CharacterExportMeta;
  save: unknown;
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => item !== undefined && isJsonValue(item));
  if (typeof value === "object" && value !== null) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value as Record<string, unknown>).every((item) => item !== undefined && isJsonValue(item));
  }
  return false;
}

const jsonValue: Validator<unknown> = {
  validate(value, path = "$"): ValidationResult<unknown> {
    return isJsonValue(value)
      ? { ok: true, value }
      : { ok: false, issues: [{ path, message: "expected a JSON value" }] };
  },
};

const shape = json.object({
  engine: json.string,
  exportedAt: utcTimestamp,
  lineage: json.optional(json.string),
  meta: metaShape,
  save: jsonValue,
});

const validator: Validator<CharacterExport> = {
  validate(value, path = "$"): ValidationResult<CharacterExport> {
    const result = shape.validate(value, path);
    if (!result.ok) return result;
    if (result.value.lineage === "") {
      return { ok: false, issues: [{ path: `${path}["lineage"]`, message: "omit an empty lineage" }] };
    }
    return result;
  },
};

export const characterExportFormat = defineFormat({
  format: "neo-angband/web/character-export",
  schemaVersion: 1,
  validator,
  sample: {
    engine: "1.18.0",
    exportedAt: "2026-01-02T03:04:05.000Z",
    lineage: "c1",
    meta: {
      name: "Test",
      race: "Human",
      cls: "Warrior",
      sex: "Female",
      level: 1,
      depth: 0,
      maxDepth: 0,
      turn: 1,
      alive: true,
    },
    save: {
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
  },
});
