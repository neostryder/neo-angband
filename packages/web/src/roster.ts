/**
 * The multi-character save roster (localStorage). Faithful to Angband's model
 * (decision 16, docs/PORT_PLAN.md - no save-scumming): many characters coexist,
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
  /**
   * WHO this character is, as opposed to which slot they are in.
   *
   * The two are the same thing until a character is exported and imported
   * somewhere: the file lands in a NEW slot with a new id (save-transfer.ts says
   * why an id must never travel), and without this the copy and the original
   * would be unrelated strangers - which is exactly what let an export be used as
   * a restore point. It travels with the file; the slot id does not.
   *
   * Optional because rosters written before it exists do not have it, and
   * `lineageOf` reads those as their own slot id - which is what they were.
   */
  lineage?: string;
}

/** A death this roster has seen, kept after the tombstone itself is cleared. */
export interface DeathRecord {
  /** The lineage that died. The reason this record exists at all. */
  lineage: string;
  name: string;
  /** The turn they died on, so a refusal can say when. */
  turn: number;
  /** epoch ms, for trimming the oldest. */
  at: number;
}

const ROSTER_KEY = "neo-angband-roster";
const ACTIVE_KEY = "neo-angband-active";
const SLOT_PREFIX = "neo-angband-save:";
const DEATHS_KEY = "neo-angband-deaths";

/**
 * How many deaths are remembered. Generous, and bounded on purpose: the ledger
 * shares a ~5 MB localStorage budget with the savefiles, and a store this game
 * cannot write to is a lost character (roster.setItem's comment). At ~90 bytes a
 * record that is under 100 KB. Past the cap the oldest death stops being
 * enforceable, which is a strictly better failure than a roster that cannot save.
 */
const DEATHS_CAP = 1000;

function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A localStorage write, reporting whether it landed.
 *
 * This used to swallow the failure, which made every writer above it claim
 * success while nothing was stored - so a quota-exceeded save left the player
 * believing they were saved, and savefile_save's failure path (ui-game.c:1152)
 * could not exist however carefully it was written higher up.
 */
function setItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    /* quota exceeded / storage disabled. */
    return false;
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

function writeRoster(list: CharMeta[]): boolean {
  return setItem(ROSTER_KEY, JSON.stringify(list));
}

/** The living characters (resumable); tombstones are excluded. */
export function livingRoster(): CharMeta[] {
  return listRoster().filter((c) => c.alive);
}

export function getMeta(id: string): CharMeta | null {
  return listRoster().find((c) => c.id === id) ?? null;
}

/** Insert or replace a character's metadata; false if the write failed. */
export function upsertMeta(meta: CharMeta): boolean {
  const list = listRoster().filter((c) => c.id !== meta.id);
  list.push(meta);
  return writeRoster(list);
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

/**
 * Write a slot's save bytes and refresh its metadata in one call. False if
 * EITHER write failed - a save whose metadata did not land is not a save the
 * character-select screen can offer.
 */
export function writeSlot(id: string, saveB64: string, meta: CharMeta): boolean {
  const bytes = setItem(SLOT_PREFIX + id, saveB64);
  const metaOk = upsertMeta(meta);
  return bytes && metaOk;
}

/** Mark a slot dead (a tombstone): its meta stays, its bytes are dropped so a
 * dead character can never be resumed - faithful terminal death. */
export function markDead(id: string): boolean {
  removeItem(SLOT_PREFIX + id);
  const meta = getMeta(id);
  /* No meta at all means there is nothing to tombstone, which is not a
   * failure. A meta write that does not land IS one: the memorial is lost. */
  if (!meta) return true;
  recordDeath(meta);
  return upsertMeta({ ...meta, alive: false });
}

/** The character behind a slot: their lineage, or the slot they were born in. */
export function lineageOf(meta: Pick<CharMeta, "id" | "lineage">): string {
  return meta.lineage !== undefined && meta.lineage !== "" ? meta.lineage : meta.id;
}

/** Every death this roster remembers, oldest first. Never throws. */
export function listDeaths(): DeathRecord[] {
  const raw = getItem(DEATHS_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as DeathRecord[];
    if (!Array.isArray(list)) return [];
    return list.filter((d) => typeof d?.lineage === "string" && d.lineage !== "");
  } catch {
    return [];
  }
}

/**
 * Remember that this character died here, in a record that OUTLIVES the tombstone.
 *
 * The tombstone alone was not enough, and the hole was reachable in two
 * keypresses: the picker offers Del on a tombstone (it is a memorial, and a
 * player is entitled to clear it), and once the row was gone nothing connected the
 * dead character to an export file made before the death. Del then import was a
 * resurrection. This ledger is what the import gate actually consults, so
 * clearing a memorial no longer clears the death.
 *
 * Best-effort by design: a failure here must not fail the death save, which is
 * the write that matters (markDead's return value is savefile_save's).
 */
function recordDeath(meta: CharMeta): void {
  const rec: DeathRecord = {
    lineage: lineageOf(meta),
    name: meta.name,
    turn: meta.turn,
    at: Date.now(),
  };
  const kept = listDeaths().filter((d) => d.lineage !== rec.lineage);
  kept.push(rec);
  /* Oldest first, so dropping from the front drops the oldest. */
  setItem(DEATHS_KEY, JSON.stringify(kept.slice(Math.max(0, kept.length - DEATHS_CAP))));
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
