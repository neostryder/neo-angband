import { defineFormat, json, utcTimestamp, type ValidationResult } from "./index.js";
import { characterFromLegacy, characterRecord, timestampFromEpoch, type CharacterRecord } from "./character-record.js";

/** Browser-storage key for orphaned saves. This key is not profile-scoped. */
export const ORPHAN_STORAGE_KEY = "neo-angband-orphan-records";
/** Previous key: a bare JSON array with `removedAt` as epoch milliseconds. */
export const LEGACY_ORPHAN_STORAGE_KEY = "neo-angband-orphaned-saves";

export interface OrphanRecord {
  id: string;
  fromProfileName: string;
  removedAt: string;
  lineage: string;
  meta: CharacterRecord;
  /** Slot bytes, still in the storage wrapper. The save document inside them is decoded on load. */
  save: string;
}

export interface OrphanRecords {
  orphans: OrphanRecord[];
}

const shape = json.object({
  id: json.string,
  fromProfileName: json.string,
  removedAt: utcTimestamp,
  lineage: json.string,
  meta: characterRecord,
  save: json.string,
});

const orphanRecord = {
  validate(value: unknown, path = "$"): ValidationResult<OrphanRecord> {
    const result = shape.validate(value, path);
    if (!result.ok) return result;
    if (result.value.id === "") {
      return { ok: false, issues: [{ path: `${path}["id"]`, message: "id must be nonempty" }] };
    }
    if (result.value.lineage === "") {
      return { ok: false, issues: [{ path: `${path}["lineage"]`, message: "lineage must be nonempty" }] };
    }
    return result;
  },
};

export const orphanSavesFormat = defineFormat({
  format: "neo-angband/web/orphan-saves",
  schemaVersion: 1,
  validator: json.object({ orphans: json.array(orphanRecord) }),
  sample: {
    orphans: [
      {
        id: "orphan-1",
        fromProfileName: "Testing",
        removedAt: "2026-01-02T03:04:05.000Z",
        lineage: "c1",
        meta: {
          id: "c1",
          name: "Test",
          race: "Human",
          cls: "Warrior",
          sex: "Female",
          level: 1,
          depth: 0,
          maxDepth: 0,
          turn: 1,
          alive: true,
          updatedAt: "2026-01-02T03:04:05.000Z",
          lineage: "c1",
        },
        save: "c2F2ZQ==",
      },
    ],
  },
});

function orphanFromUnknown(value: unknown): OrphanRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row["id"] !== "string" || row["id"] === "") return null;
  if (typeof row["lineage"] !== "string" || row["lineage"] === "") return null;
  if (typeof row["save"] !== "string") return null;
  const meta = characterFromLegacy(row["meta"]);
  if (!meta) return null;
  const removedAt =
    typeof row["removedAt"] === "number" && Number.isFinite(row["removedAt"])
      ? timestampFromEpoch(row["removedAt"])
      : typeof row["removedAt"] === "string" && utcTimestamp.validate(row["removedAt"]).ok
        ? row["removedAt"]
        : timestampFromEpoch(0);
  const record: OrphanRecord = {
    id: row["id"],
    fromProfileName: typeof row["fromProfileName"] === "string" ? row["fromProfileName"] : "",
    removedAt,
    lineage: row["lineage"],
    meta,
    save: row["save"],
  };
  const checked = orphanRecord.validate(record);
  return checked.ok ? checked.value : null;
}

/** A bare orphan array, or null when the text is not one. */
export function orphansFromLegacy(raw: string): OrphanRecords | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const orphans: OrphanRecord[] = [];
  for (const item of value) {
    const row = orphanFromUnknown(item);
    if (!row) return null;
    orphans.push(row);
  }
  return { orphans };
}
