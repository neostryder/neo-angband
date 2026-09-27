import { defineFormat, json, utcTimestamp, type ValidationResult } from "./index.js";
import { timestampFromEpoch } from "./character-record.js";

/** Browser-storage key for the death ledger document. */
export const DEATHS_STORAGE_KEY = "neo-angband-death-records";
/** Previous key: a bare JSON array with `at` as epoch milliseconds. */
export const LEGACY_DEATHS_STORAGE_KEY = "neo-angband-deaths";

export interface DeathRecordDocument {
  lineage: string;
  name: string;
  turn: number;
  at: string;
}

export interface DeathRecords {
  deaths: DeathRecordDocument[];
}

const shape = json.object({
  lineage: json.string,
  name: json.string,
  turn: json.integer,
  at: utcTimestamp,
});

const deathRecord = {
  validate(value: unknown, path = "$"): ValidationResult<DeathRecordDocument> {
    const result = shape.validate(value, path);
    if (!result.ok) return result;
    if (result.value.lineage === "") {
      return { ok: false, issues: [{ path: `${path}["lineage"]`, message: "lineage must be nonempty" }] };
    }
    return result;
  },
};

export const deathRecordsFormat = defineFormat({
  format: "neo-angband/web/death-records",
  schemaVersion: 1,
  validator: json.object({ deaths: json.array(deathRecord) }),
  sample: {
    deaths: [{ lineage: "c1", name: "Test", turn: 10, at: "2026-01-02T03:04:05.000Z" }],
  },
});

function deathFromUnknown(value: unknown): DeathRecordDocument | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row["lineage"] !== "string" || row["lineage"] === "") return null;
  const at =
    typeof row["at"] === "number" && Number.isFinite(row["at"])
      ? timestampFromEpoch(row["at"])
      : typeof row["at"] === "string" && utcTimestamp.validate(row["at"]).ok
        ? row["at"]
        : timestampFromEpoch(0);
  const turn = typeof row["turn"] === "number" && Number.isFinite(row["turn"]) ? Math.trunc(row["turn"]) : 0;
  const record: DeathRecordDocument = {
    lineage: row["lineage"],
    name: typeof row["name"] === "string" ? row["name"] : "",
    turn: Number.isSafeInteger(turn) ? turn : 0,
    at,
  };
  const checked = deathRecord.validate(record);
  return checked.ok ? checked.value : null;
}

/** A bare death array, or null when the text is not one. Rows without a lineage are dropped. */
export function deathsFromLegacy(raw: string): DeathRecords | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const deaths: DeathRecordDocument[] = [];
  for (const item of value) {
    const row = deathFromUnknown(item);
    if (!row) return null;
    deaths.push(row);
  }
  return { deaths };
}
