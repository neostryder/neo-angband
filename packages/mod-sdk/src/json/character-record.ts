/**
 * One character row, shared by the roster and the orphan list.
 *
 * `updatedAt` is a UTC timestamp here. Callers that still sort by epoch
 * milliseconds convert at the storage boundary.
 */

import { json, utcTimestamp, type ValidationResult } from "./index.js";

const shape = json.object({
  id: json.string,
  name: json.string,
  race: json.string,
  cls: json.string,
  sex: json.string,
  level: json.integer,
  depth: json.integer,
  maxDepth: json.integer,
  turn: json.integer,
  alive: json.boolean,
  updatedAt: utcTimestamp,
  lineage: json.optional(json.string),
});

export interface CharacterRecord {
  id: string;
  name: string;
  race: string;
  cls: string;
  sex: string;
  level: number;
  depth: number;
  maxDepth: number;
  turn: number;
  alive: boolean;
  updatedAt: string;
  lineage?: string;
}

function issue(path: string, message: string): ValidationResult<CharacterRecord> {
  return { ok: false, issues: [{ path, message }] };
}

export const characterRecord = {
  validate(value: unknown, path = "$"): ValidationResult<CharacterRecord> {
    const result = shape.validate(value, path);
    if (!result.ok) return result;
    if (result.value.id === "") return issue(`${path}["id"]`, "id must be nonempty");
    if (result.value.lineage === "") return issue(`${path}["lineage"]`, "omit an empty lineage");
    return result;
  },
};

export function timestampFromEpoch(ms: number): string {
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

export function epochFromTimestamp(stamp: string): number {
  return Date.parse(stamp);
}

function finiteInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(Math.trunc(value))
    ? Math.trunc(value)
    : 0;
}

/**
 * A roster row from a build that stored epoch milliseconds and omitted fields.
 * A missing `alive` stays true: only a boolean false is a tombstone.
 * Returns null when there is no id to address the slot by.
 */
export function characterFromLegacy(value: unknown): CharacterRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row["id"] !== "string" || row["id"] === "") return null;
  const text = (key: string): string => (typeof row[key] === "string" ? (row[key] as string) : "");
  let updatedAt: string;
  if (typeof row["updatedAt"] === "number" && Number.isFinite(row["updatedAt"])) {
    updatedAt = timestampFromEpoch(row["updatedAt"]);
  } else if (typeof row["updatedAt"] === "string" && utcTimestamp.validate(row["updatedAt"]).ok) {
    updatedAt = row["updatedAt"];
  } else {
    updatedAt = timestampFromEpoch(0);
  }
  const lineage = text("lineage");
  const record: CharacterRecord = {
    id: row["id"],
    name: text("name"),
    race: text("race"),
    cls: text("cls"),
    sex: text("sex"),
    level: finiteInt(row["level"]),
    depth: finiteInt(row["depth"]),
    maxDepth: finiteInt(row["maxDepth"]),
    turn: finiteInt(row["turn"]),
    alive: row["alive"] !== false,
    updatedAt,
    ...(lineage !== "" ? { lineage } : {}),
  };
  const checked = characterRecord.validate(record);
  return checked.ok ? checked.value : null;
}
