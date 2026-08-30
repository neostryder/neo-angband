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

import type { CharMeta } from "./roster";

/** The Storage subset this module needs. */
export interface OrphanStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

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

const ORPHANED_KEY = "neo-angband-orphaned-saves";

function readAll(storage: OrphanStorage): OrphanedSave[] {
  const raw = storage.getItem(ORPHANED_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as OrphanedSave[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Every orphaned save, most recently removed first. */
export function listOrphanedSaves(storage: OrphanStorage): OrphanedSave[] {
  return readAll(storage)
    .slice()
    .sort((a, b) => b.removedAt - a.removedAt);
}

/** Add one or more orphaned saves; best-effort, like roster.ts's own writes. */
export function addOrphanedSaves(storage: OrphanStorage, entries: readonly OrphanedSave[]): void {
  if (entries.length === 0) return;
  try {
    storage.setItem(ORPHANED_KEY, JSON.stringify([...readAll(storage), ...entries]));
  } catch {
    /* quota exceeded / storage disabled - the profile deletion above this
     * still proceeds, the same degrade-silently contract roster.ts keeps. */
  }
}

/** Remove one orphaned save once it has been reclaimed. */
export function removeOrphanedSave(storage: OrphanStorage, id: string): void {
  try {
    storage.setItem(ORPHANED_KEY, JSON.stringify(readAll(storage).filter((o) => o.id !== id)));
  } catch {
    /* best-effort */
  }
}
