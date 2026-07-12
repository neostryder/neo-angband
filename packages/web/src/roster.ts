/**
 * The multi-character save roster (localStorage). Faithful to Angband's model
 * ([[neo-angband-save-scum-policy]] decision 16): many characters coexist,
 * each with its OWN authoritative save overwritten in place - there are no
 * snapshots to restore, so keeping several characters is not save-scumming.
 * Death turns a slot into a non-resumable tombstone that stays for the memorial
 * (the Hall of Fame feel), it is not silently deleted.
 *
 * This is the storage layer only; charselect.ts renders the picker and main.ts
 * wires boot / autosave / death to the active slot. Every accessor tolerates
 * storage being disabled (private mode / quota) by degrading to in-memory-less
 * behaviour rather than throwing, exactly as the old single-slot code did.
 */

/** The light metadata shown in the picker; the heavy save bytes live apart. */
export interface CharMeta {
  id: string;
  name: string;
  race: string;
  cls: string;
  sex: string;
  level: number;
  /** Current dungeon level (0 = town). */
  depth: number;
  /** Deepest level reached (the character screen's "Max Depth"). */
  maxDepth: number;
  turn: number;
  alive: boolean;
  /** epoch ms of the last save, for most-recent-first ordering. */
  updatedAt: number;
}

const ROSTER_KEY = "neo-angband-roster";
const ACTIVE_KEY = "neo-angband-active";
const SLOT_PREFIX = "neo-angband-save:";

function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota exceeded / storage disabled: keep playing unsaved. */
  }
}

function removeItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** The roster metadata, newest save first. Never throws. */
export function listRoster(): CharMeta[] {
  const raw = getItem(ROSTER_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as CharMeta[];
    if (!Array.isArray(list)) return [];
    return list.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function writeRoster(list: CharMeta[]): void {
  setItem(ROSTER_KEY, JSON.stringify(list));
}

/** The living characters (resumable); tombstones are excluded. */
export function livingRoster(): CharMeta[] {
  return listRoster().filter((c) => c.alive);
}

export function getMeta(id: string): CharMeta | null {
  return listRoster().find((c) => c.id === id) ?? null;
}

/** Insert or replace a character's metadata. */
export function upsertMeta(meta: CharMeta): void {
  const list = listRoster().filter((c) => c.id !== meta.id);
  list.push(meta);
  writeRoster(list);
}

export function getActiveId(): string | null {
  return getItem(ACTIVE_KEY);
}

export function setActiveId(id: string | null): void {
  if (id) setItem(ACTIVE_KEY, id);
  else removeItem(ACTIVE_KEY);
}

/** The base64 save bytes for a slot, or null if none / storage disabled. */
export function readSlotSave(id: string): string | null {
  return getItem(SLOT_PREFIX + id);
}

/** Write a slot's save bytes and refresh its metadata in one call. */
export function writeSlot(id: string, saveB64: string, meta: CharMeta): void {
  setItem(SLOT_PREFIX + id, saveB64);
  upsertMeta(meta);
}

/** Mark a slot dead (a tombstone): its meta stays, its bytes are dropped so a
 * dead character can never be resumed - faithful terminal death. */
export function markDead(id: string): void {
  removeItem(SLOT_PREFIX + id);
  const meta = getMeta(id);
  if (meta) upsertMeta({ ...meta, alive: false });
}

/** Remove a slot entirely (bytes + metadata) - used to clear a tombstone. */
export function deleteSlot(id: string): void {
  removeItem(SLOT_PREFIX + id);
  writeRoster(listRoster().filter((c) => c.id !== id));
  if (getActiveId() === id) setActiveId(null);
}

/** A fresh unique slot id (crypto.randomUUID where available). */
export function newCharId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
