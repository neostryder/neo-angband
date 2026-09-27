/**
 * Living characters carried out of a profile that is being deleted
 * (neo-angband#163), so choosing to keep a profile's saves has somewhere for
 * them to land.
 *
 * Lives in REAL, unscoped storage - not behind profile-scope.ts's namespacing
 * - because the whole point is to survive after the profile that owned them
 * no longer has a namespace at all, and to be reclaimable from ANY profile
 * afterward, not just whichever one is active at the moment of deletion.
 *
 * Tombstones do not travel through here, for the same reason
 * save-transfer.ts's exportCharacter refuses one: a dead character's save
 * bytes are already gone (roster.ts's markDead deletes them on death), so
 * there is nothing to carry. The departing profile's death ledger is not
 * carried either - transfer-gate.ts already treats "a roster that never saw
 * this lineage die" as an accepted, un-engineered-against gap, and this is
 * the same gap, not a new one.
 */

import {
  characterFromLegacy,
  epochFromTimestamp,
  LEGACY_ORPHAN_STORAGE_KEY,
  ORPHAN_STORAGE_KEY,
  orphanSavesFormat,
  orphansFromLegacy,
  parseDocument,
  serializeDocument,
  timestampFromEpoch,
  type CharacterRecord,
  type OrphanRecord,
} from "@rpgm-tools/neo-angband-mod-sdk";
import { canWriteStoredDocument, readStoredDocument, type DocumentStorage } from "./document-store";
import type { CharMeta } from "./roster";

/** The Storage subset this module needs. `removeItem` retires the previous key after a read-back. */
export type OrphanStorage = DocumentStorage;

/** One living character, lifted out of a profile's roster before deletion. */
export interface OrphanedSave {
  /** This entry's own id in the orphan list - distinct from the character's
   * roster slot id, which a reclaiming profile mints fresh. */
  readonly id: string;
  readonly fromProfileName: string;
  readonly removedAt: number;
  /** roster.ts's lineageOf(meta) at the moment of removal, so reclaiming can
   * run the same lineage gate (transfer-gate.ts) an imported file would. */
  readonly lineage: string;
  readonly meta: CharMeta;
  readonly save: string;
}

function toCharMeta(row: CharacterRecord): CharMeta {
  return {
    id: row.id,
    name: row.name,
    race: row.race,
    cls: row.cls,
    sex: row.sex,
    level: row.level,
    depth: row.depth,
    maxDepth: row.maxDepth,
    turn: row.turn,
    alive: row.alive,
    updatedAt: epochFromTimestamp(row.updatedAt),
    ...(row.lineage !== undefined ? { lineage: row.lineage } : {}),
  };
}

function toOrphan(row: OrphanRecord): OrphanedSave {
  return {
    id: row.id,
    fromProfileName: row.fromProfileName,
    removedAt: epochFromTimestamp(row.removedAt),
    lineage: row.lineage,
    meta: toCharMeta(row.meta),
    save: row.save,
  };
}

function fromOrphan(entry: OrphanedSave): OrphanRecord | null {
  const meta = characterFromLegacy(entry.meta);
  if (!meta || entry.id === "" || entry.lineage === "") return null;
  return {
    id: entry.id,
    fromProfileName: entry.fromProfileName,
    removedAt: timestampFromEpoch(entry.removedAt),
    lineage: entry.lineage,
    meta,
    save: entry.save,
  };
}

function readAll(storage: OrphanStorage): OrphanedSave[] {
  const data = readStoredDocument(
    storage,
    ORPHAN_STORAGE_KEY,
    LEGACY_ORPHAN_STORAGE_KEY,
    orphanSavesFormat,
    orphansFromLegacy,
  );
  return data ? data.orphans.map(toOrphan) : [];
}

function writeAll(storage: OrphanStorage, entries: readonly OrphanedSave[]): boolean {
  if (!canWriteStoredDocument(storage, ORPHAN_STORAGE_KEY, LEGACY_ORPHAN_STORAGE_KEY, orphanSavesFormat)) return false;
  const orphans: OrphanRecord[] = [];
  for (const entry of entries) {
    const row = fromOrphan(entry);
    if (!row) return false;
    orphans.push(row);
  }
  const text = serializeDocument(orphanSavesFormat, { orphans }, { compact: true });
  storage.setItem(ORPHAN_STORAGE_KEY, text);
  const written = storage.getItem(ORPHAN_STORAGE_KEY);
  return written === text && parseDocument(written, orphanSavesFormat).ok;
}

/** Every orphaned save, most recently removed first. */
export function listOrphanedSaves(storage: OrphanStorage): OrphanedSave[] {
  return readAll(storage)
    .slice()
    .sort((a, b) => b.removedAt - a.removedAt);
}

/** Add saves and verify the document before a caller removes their old profile. */
export function addOrphanedSaves(storage: OrphanStorage, entries: readonly OrphanedSave[]): boolean {
  if (entries.length === 0) return true;
  try {
    return writeAll(storage, [...readAll(storage), ...entries]);
  } catch {
    return false;
  }
}

/** Remove one orphaned save once it has been reclaimed. */
export function removeOrphanedSave(storage: OrphanStorage, id: string): void {
  try {
    writeAll(storage, readAll(storage).filter((o) => o.id !== id));
  } catch {
    /* best-effort */
  }
}
