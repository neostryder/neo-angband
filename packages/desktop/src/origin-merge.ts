/**
 * Reuniting characters stranded in abandoned origins.
 *
 * The desktop shell served itself on an EPHEMERAL loopback port, so every launch
 * had a different origin and therefore a different localStorage - see
 * loopback-port.ts for the defect. Fixing the port stops the bleeding but does not
 * bring anything back: the characters written under the old origins are still in
 * the Chromium profile, intact, simply unreachable from the new one.
 *
 * Measured in the install that reported it: five origins, and THREE living
 * characters spread over two of them (one save of 160,904 base64 chars in one, two
 * of 535,080 and 191,976 in another). Under decision 16 - no save-scumming, death
 * is permanent - those are not files to shrug at. A platform bug is not a death.
 *
 * This module is the decision half: given the target origin's entries and
 * snapshots of the abandoned ones, work out exactly what to write. It is pure, so
 * the merge rules are tested rather than trusted; main.ts does the Electron work of
 * reading and writing an origin's storage.
 *
 * Conservative by construction. Nothing already in the target is overwritten
 * except the roster, which is MERGED, and a save whose bytes are missing is not
 * invented.
 *
 * Each player/testing profile is merged on its own. A profile keeps every key of
 * its own under `profile:<id>:` (web/profile-scope.ts), its own roster and saves
 * included, so the default profile is the unprefixed keys and each named profile
 * is planned as if its prefix were not there, then written back under it.
 */

import {
  ACTIVE_STORAGE_KEY,
  activeSlotFormat,
  activeSlotFromLegacy,
  characterFromLegacy,
  DEATHS_STORAGE_KEY,
  deathRecordsFormat,
  deathsFromLegacy,
  epochFromTimestamp,
  LEGACY_ACTIVE_STORAGE_KEY,
  LEGACY_DEATHS_STORAGE_KEY,
  LEGACY_ORPHAN_STORAGE_KEY,
  LEGACY_ROSTER_STORAGE_KEY,
  modSettingValuesFormat,
  modStateFormat,
  ORPHAN_STORAGE_KEY,
  orphanSavesFormat,
  orphansFromLegacy,
  parseDocument,
  profilesFormat,
  ROSTER_STORAGE_KEY,
  rosterFormat,
  rosterFromLegacy,
  serializeDocument,
  type CharacterRecord,
  type FormatDefinition,
} from "@rpgm-tools/neo-angband-mod-sdk";

/** One key/value pair set, as read from (or to be written to) an origin. */
export type OriginEntries = Readonly<Record<string, string>>;

export interface OriginSnapshot {
  /** The loopback port whose origin this was. For reporting. */
  readonly port: number;
  readonly entries: OriginEntries;
}

/** The roster metadata this module needs; the full shape lives in web/roster.ts. */
interface Meta {
  id: string;
  name?: string;
  updatedAt?: number;
  alive?: boolean;
  turn?: number;
}

/** Previous roster key. Abandoned origins still store a bare array under it. */
export const ROSTER_KEY = LEGACY_ROSTER_STORAGE_KEY;
/** Previous active-slot key. The value is a raw slot id. */
export const ACTIVE_KEY = LEGACY_ACTIVE_STORAGE_KEY;
/** Roster document written by a merge. */
export const ROSTER_DOCUMENT_KEY = ROSTER_STORAGE_KEY;
/** Active-slot document written by a merge. */
export const ACTIVE_DOCUMENT_KEY = ACTIVE_STORAGE_KEY;
export const SLOT_PREFIX = "neo-angband-save:";

/**
 * Keys left where they are. The desktop origin belongs to the game, but mods write
 * keys of their own under any name they like (Squire keeps `squire/panelScale`), so
 * a list of the game's prefixes would leave a mod's data behind. What is left out is
 * what software outside the game injects into the page, which names its keys with a
 * leading `__` (AdGuard's `__agwt_rt`).
 */
function isCarried(key: string): boolean {
  return !key.startsWith("__");
}

/** The prefix web/profile-scope.ts puts in front of a named profile's keys. */
export const PROFILE_KEY_PREFIX = "profile:";

/** `profile:<id>:` for a named profile's key, or "" for the default profile's. */
function scopeOf(key: string): string {
  if (!key.startsWith(PROFILE_KEY_PREFIX)) return "";
  const end = key.indexOf(":", PROFILE_KEY_PREFIX.length);
  return end > PROFILE_KEY_PREFIX.length ? key.slice(0, end + 1) : "";
}

/** The keys of one profile, with its prefix taken off. */
function withinScope(entries: OriginEntries, scope: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (scopeOf(key) === scope) out[key.slice(scope.length)] = value;
  }
  return out;
}

export interface RecoveredChar {
  readonly id: string;
  readonly name: string;
  /** Which abandoned origin it came from. */
  readonly fromPort: number;
  /** False for a tombstone (a dead character keeps its memorial, not its bytes). */
  readonly hasSave: boolean;
}

export interface MergePlan {
  /** Exactly what to write into the target origin. Empty means nothing to do. */
  readonly writes: Readonly<Record<string, string>>;
  /**
   * Save slots to DELETE from the target, because a tombstone somewhere says that
   * character is dead. The only deletion this module ever plans - see `buriedIds`
   * for why it is the one thing that must be destructive, and the name guard in
   * planOriginMerge for what stops it from firing on the wrong character.
   */
  readonly removes: readonly string[];
  /**
   * Every character id this pass knows to be dead, for the durable death ledger.
   *
   * THE LEDGER IS WHY THE RULE STILL WORKS NEXT YEAR. A tombstone only buries a
   * living copy while the origin holding it is still being read, and an origin is
   * read exactly once - `origins-merged.txt` then excludes it forever. So the one
   * record proving a character is dead can be sealed inside a handled origin while
   * a living copy of it sits in another, and the check that would catch that has
   * been switched off. Writing the ids to a file in the data folder, outside every
   * origin, is what survives the marker.
   */
  readonly deaths: readonly string[];
  /** Characters this brings back, for the report the player is shown. */
  readonly recovered: readonly RecoveredChar[];
  /** A storage document cannot be read, so source origins must stay eligible. */
  readonly blocked: boolean;
  /**
   * Living characters left where they were because they had never been played -
   * births abandoned at turn 0. Reported rather than hidden: their bytes are NOT
   * deleted from the origin they are in, so the count is a statement about what
   * this build chose not to import, not about what was destroyed.
   */
  readonly skippedUnplayed: readonly RecoveredChar[];
}

/** What became of an attempt to write the plan into the target origin. */
export interface MergeOutcome {
  /** Keys localStorage refused outright (a quota, typically). */
  readonly failedKeys: readonly string[];
  /** Keys that were accepted but were not there on the read-back. */
  readonly missingKeys: readonly string[];
}

/**
 * Which abandoned origins may now be recorded as handled - or null for none.
 *
 * "Handled" means "there is nothing left in it", and NOTHING LOOKS AT A HANDLED
 * PORT AGAIN. So the marker is a permanent claim, and every way of getting it wrong
 * hides a character forever:
 *
 *   - a port that could not be READ has not been handled. It is not empty; it is
 *     unopened. With the port ladder this is the likeliest failure of all, because
 *     the reason a port will not bind is usually that another copy of the game is
 *     serving itself on it - and that copy's origin is exactly where a roster is.
 *   - a write that was refused, or that did not survive the read-back, leaves the
 *     bytes only in the source. Marking it would strand them.
 *
 * `sources` is what was actually read, which is why this takes the snapshots rather
 * than the list of ports that were meant to be visited. The two were the same thing
 * while every port in the list was a dead ephemeral one that always bound, and
 * main.ts passed the wrong one of them for exactly that reason.
 */
export function handledPorts(
  done: Iterable<number>,
  sources: readonly OriginSnapshot[],
  outcome: MergeOutcome,
): readonly number[] | null {
  if (outcome.failedKeys.length > 0 || outcome.missingKeys.length > 0) return null;
  const all = new Set<number>(done);
  for (const s of sources) all.add(s.port);
  return [...all];
}

function documentToMeta(row: CharacterRecord): Meta {
  const { updatedAt, ...rest } = row;
  return { ...rest, updatedAt: epochFromTimestamp(updatedAt) };
}

function legacyRows(raw: string | undefined): Meta[] {
  if (raw === undefined) return [];
  const roster = rosterFromLegacy(raw);
  return roster ? roster.characters.map(documentToMeta) : [];
}

/** Rows from the document key when it parses, otherwise from the previous array. */
function rosterRows(entries: OriginEntries): Meta[] {
  const current = entries[ROSTER_DOCUMENT_KEY];
  if (current !== undefined) {
    const parsed = parseDocument(current, rosterFormat);
    return parsed.ok ? parsed.data.characters.map(documentToMeta) : [];
  }
  return legacyRows(entries[ROSTER_KEY]);
}

/** The roster document is present and this build cannot read it. */
function stateBlocked(entries: OriginEntries): boolean {
  const documents = [
    [ROSTER_STORAGE_KEY, LEGACY_ROSTER_STORAGE_KEY, rosterFormat, rosterFromLegacy],
    [ACTIVE_STORAGE_KEY, LEGACY_ACTIVE_STORAGE_KEY, activeSlotFormat, activeSlotFromLegacy],
    [DEATHS_STORAGE_KEY, LEGACY_DEATHS_STORAGE_KEY, deathRecordsFormat, deathsFromLegacy],
    [ORPHAN_STORAGE_KEY, LEGACY_ORPHAN_STORAGE_KEY, orphanSavesFormat, orphansFromLegacy],
  ] as const;
  for (const [key, oldKey, format, fromLegacy] of documents) {
    if (entries[key] !== undefined) {
      if (!parseDocument(entries[key], format.format).ok) return true;
    } else if (entries[oldKey] !== undefined && fromLegacy(entries[oldKey]) === null) {
      return true;
    }
  }
  return false;
}

function stamp(m: Meta): number {
  return typeof m.updatedAt === "number" ? m.updatedAt : 0;
}

/**
 * DEATH IS ABSORBING, AND THAT IS WHAT KEEPS THIS MODULE FROM BEING A SCUM TOOL.
 *
 * The merge is a COPY: nothing is deleted from the origin it was read from, which
 * is exactly right when the question is "did a platform bug hide my character" and
 * exactly wrong when the question is "is this character dead". Copying leaves a
 * pre-death snapshot of every character it carries across, so without this rule
 * the shipped machinery would resurrect one:
 *
 *   1. A copy of the game is on 45871 with a living character.
 *   2. It steps to 45872 (its usual port was taken) and the recovery brings the
 *      character over. 45871 still holds the LIVING copy, untouched.
 *   3. The character dies on 45872. Its bytes are dropped and its roster row
 *      becomes a tombstone - on 45872 only.
 *   4. Anything that reads 45871 again (the move to the game's own origin reads
 *      every old port) finds it alive, at the turn it was copied at.
 *
 * So the merge must never let a living copy outrank a tombstone, in EITHER
 * direction, and must not stop at declining to import: step 4's origin is the
 * TARGET, and the tombstone arrives as a source. Repairing it means deleting the
 * target's own save bytes, which is the one destructive act this file plans.
 *
 * Timestamps are deliberately not consulted. `alive` is not an opinion that a
 * later write can revise - it is a one-way door (decision 16, no save-scumming) -
 * and a snapshot played on AFTER the death carries the newer stamp, which is
 * precisely the case a newest-wins rule would get wrong.
 *
 * What this does NOT do, and cannot: a player who copies the whole data folder
 * before a fight has a copy of the whole data folder. No locally stored game can
 * prevent that, and pretending otherwise would be the only dishonest option here.
 * This closes the path the GAME opens by itself.
 */
export function buriedIds(
  target: OriginEntries,
  sources: readonly OriginSnapshot[],
  knownDead: Iterable<string> = [],
): Map<string, string | null> {
  /* id -> the name on the tombstone, or null when it carried none. The name is
   * kept because it is the guard on the deletion; see the loop in
   * planOriginMerge. */
  const buried = new Map<string, string | null>();
  for (const id of knownDead) if (!buried.has(id)) buried.set(id, null);
  for (const roster of [rosterRows(target), ...sources.map((s) => rosterRows(s.entries))]) {
    /* `=== false` and nothing looser. A row where `alive` is missing, or is the
     * string "false", or 0, or null, is not a tombstone - the game writes a
     * boolean, and guessing at anything else would delete a living character on
     * the strength of one corrupted byte. Undecidable means alive. */
    for (const m of roster) {
      if (m.alive !== false) continue;
      const name = typeof m.name === "string" ? m.name : null;
      /* A name once found is kept: a later nameless tombstone for the same id must
       * not erase the guard. */
      if (!buried.has(m.id) || buried.get(m.id) === null) buried.set(m.id, name);
    }
  }
  return buried;
}

/**
 * Plan the merge. `sources` should be newest-origin-first: when the same character
 * exists in two of them with equal timestamps, the earlier entry in this list wins.
 *
 * `keepUnplayedFrom` names the origin the player was using until this launch. Its
 * character list is the one on their screen, so a turn-0 row there is carried like
 * any other instead of being left behind as an abandoned birth.
 *
 * The death ledger (`knownDead`) applies to the default profile only, and only the
 * default profile's deaths are reported for it. Creating a profile can copy the
 * current one's characters, ids and all (copyScopedStorage), so a character that
 * died in a testing profile may still be alive in the default one, and burying it
 * there would delete a living character. A named profile's tombstones still bury
 * that profile's own living copies.
 */
export function planOriginMerge(
  target: OriginEntries,
  sources: readonly OriginSnapshot[],
  knownDead: Iterable<string> = [],
  keepUnplayedFrom?: number,
): MergePlan {
  const scopes = new Set<string>([""]);
  for (const entries of [target, ...sources.map((s) => s.entries)]) {
    for (const key of Object.keys(entries)) scopes.add(scopeOf(key));
  }
  const writes: Record<string, string> = {};
  const removes: string[] = [];
  const recovered: RecoveredChar[] = [];
  const skippedUnplayed: RecoveredChar[] = [];
  let deaths: readonly string[] = [];
  let blocked = false;
  for (const scope of scopes) {
    const plan = planScope(
      withinScope(target, scope),
      sources.map((s) => ({ port: s.port, entries: withinScope(s.entries, scope) })),
      scope === "" ? knownDead : [],
      keepUnplayedFrom,
    );
    if (scope === "") deaths = plan.deaths;
    blocked ||= plan.blocked;
    for (const [key, value] of Object.entries(plan.writes)) writes[scope + key] = value;
    for (const key of plan.removes) removes.push(scope + key);
    recovered.push(...plan.recovered);
    skippedUnplayed.push(...plan.skippedUnplayed);
  }
  mergeProfileIndex(target, sources, writes);
  /* One profile that cannot be read holds every origin back, as one unreadable
   * roster always has: marking an origin handled while part of it is unread would
   * strand that part. */
  if (blocked) return { writes: {}, removes: [], deaths, recovered: [], skippedUnplayed: [], blocked: true };
  return { writes, removes, deaths, recovered, skippedUnplayed, blocked: false };
}

/** planOriginMerge for one profile's keys, its prefix already removed. */
function planScope(
  target: OriginEntries,
  sources: readonly OriginSnapshot[],
  knownDead: Iterable<string>,
  keepUnplayedFrom: number | undefined,
): MergePlan {
  const writes: Record<string, string> = {};
  const removes: string[] = [];
  const recovered: RecoveredChar[] = [];
  const skippedUnplayed: RecoveredChar[] = [];

  /* The target's own characters are the baseline and are never displaced by an
   * older copy of themselves. */
  const merged = new Map<string, Meta>();
  if (stateBlocked(target) || sources.some((source) => stateBlocked(source.entries))) {
    return {
      writes: {},
      removes: [],
      deaths: [...buriedIds(target, sources, knownDead).keys()],
      recovered: [],
      skippedUnplayed: [],
      blocked: true,
    };
  }

  for (const m of rosterRows(target)) merged.set(m.id, m);

  /* Every id a tombstone anywhere settles, decided before a single byte is
   * imported or kept. See buriedIds. */
  const buried = buriedIds(target, sources, knownDead);

  /* The target's own rows first: turn a living row into the memorial it should
   * be, and plan away the resumable bytes behind it. This is the direction that
   * needs a deletion - the player has come back to the origin the character was
   * copied FROM, where it is still alive at the turn it was copied at. */
  let flipped = false;
  for (const [id, deadName] of buried) {
    const existing = merged.get(id);
    /*
     * THE GUARD ON THE ONLY DELETION IN THIS FILE.
     *
     * parseRoster accepts any object with a string `id`, deliberately - it is
     * reading data that may have been written by an older build or damaged by a
     * half-finished write, and refusing to parse it would strand characters. So an
     * id is NOT proof of identity here, and burying on an id alone would delete a
     * living character on the strength of a corrupted byte or an id collision.
     *
     * When both rows carry a name, they must agree. Disagreement means two
     * different characters that collided on an id, and the answer is to leave the
     * living one alone: failing to bury costs a save-scum opportunity, deleting
     * the wrong character costs a character. Only the second one is unrecoverable,
     * so the doubt goes to the player.
     */
    const sameCharacter =
      existing === undefined ||
      deadName === null ||
      typeof existing.name !== "string" ||
      existing.name.toLowerCase() === deadName.toLowerCase();
    if (!sameCharacter) continue;

    /* The row is KEPT and only its `alive` flag changes: a tombstone is a
     * memorial the player earned, and deleting the row would make the character
     * vanish from the memorial with nothing said. */
    if (existing && existing.alive !== false) {
      merged.set(id, { ...existing, alive: false });
      /* Tracked, because it is a change NOTHING ELSE CAN SEE. A target row whose
       * only difference is its `alive` flag adds no id, imports no bytes and
       * recovers no character, so every other "is there anything to do" test here
       * answers no - and the roster would keep saying the character is alive. */
      flipped = true;
    }
    const slot = SLOT_PREFIX + id;
    if (target[slot] !== undefined) removes.push(slot);
  }

  for (const src of sources) {
    for (const m of rosterRows(src.entries)) {
      const isBuried = buried.has(m.id);
      const existing = merged.get(m.id);
      /* A buried id the target already knows about needs nothing from any source:
       * the row is already the memorial and the bytes are already on the way out.
       * Otherwise the usual rule - an older copy never displaces a newer one. */
      if (existing && (isBuried || stamp(existing) >= stamp(m))) continue;

      const slot = SLOT_PREFIX + m.id;
      /* The bytes of a buried character are never carried, from anywhere. Reading
       * them into `writes` is precisely the resurrection this guards against. */
      const bytes = isBuried ? undefined : src.entries[slot];
      const dead = isBuried || m.alive === false;
      const named = {
        id: m.id,
        name: typeof m.name === "string" ? m.name : "(unnamed)",
        fromPort: src.port,
        hasSave: !dead && (bytes !== undefined || target[slot] !== undefined),
      };

      /* A birth abandoned at turn 0 is not a character anybody lost; importing
       * every one of them would fill the character screen with rows the player
       * only ever pressed Enter through. Left in place, not deleted. */
      if (!dead && (m.turn ?? 0) <= 0 && src.port !== keepUnplayedFrom) {
        skippedUnplayed.push(named);
        continue;
      }
      /* A living character with no bytes is not resumable, so importing its
       * metadata alone would offer the player a save that cannot be loaded. Skip
       * it unless the target has the bytes already. A DEAD one is a memorial and
       * legitimately has none. */
      if (!dead && bytes === undefined && target[slot] === undefined) {
        continue;
      }

      merged.set(m.id, dead ? { ...m, alive: false } : m);
      if (bytes !== undefined && target[slot] === undefined) writes[slot] = bytes;
      recovered.push(named);
    }

    /* Everything else: filled in only where the target has nothing, so a setting the
     * player has since changed in the new origin is kept. */
    for (const [key, value] of Object.entries(src.entries)) {
      if (!isCarried(key)) continue;
      if (
        key === ROSTER_KEY ||
        key === ROSTER_DOCUMENT_KEY ||
        key === ACTIVE_KEY ||
        key === ACTIVE_DOCUMENT_KEY ||
        key === LEGACY_DEATHS_STORAGE_KEY ||
        key === DEATHS_STORAGE_KEY ||
        key === LEGACY_ORPHAN_STORAGE_KEY ||
        key === ORPHAN_STORAGE_KEY ||
        key.startsWith(SLOT_PREFIX)
      ) {
        continue;
      }
      if (key === MOD_STATE_DOCUMENT_KEY && fillModState(target, writes, value)) continue;
      if (key === MOD_SETTINGS_DOCUMENT_KEY && fillModSettings(target, writes, value)) continue;
      if (key in target || key in writes) continue;
      writes[key] = value;
    }
    carryRecords(target, writes, src.entries, DEATHS_STORAGE_KEY, LEGACY_DEATHS_STORAGE_KEY, deathRecordsFormat, deathsFromLegacy);
    carryRecords(target, writes, src.entries, ORPHAN_STORAGE_KEY, LEGACY_ORPHAN_STORAGE_KEY, orphanSavesFormat, orphansFromLegacy);
  }

  const carried = carriedActiveId(target, sources);
  const activeUseful = carried !== null && merged.has(carried) && !buried.has(carried);
  if (
    recovered.length === 0 &&
    Object.keys(writes).length === 0 &&
    removes.length === 0 &&
    !flipped &&
    !activeUseful
  ) {
    return {
      writes: {},
      removes: [],
      deaths: [...buried.keys()],
      recovered: [],
      skippedUnplayed,
      blocked: false,
    };
  }

  /* Only rewrite the roster when it actually gained something - or when a burial
   * changed a row in it, which is a change the id set cannot see. */
  const targetIds = new Set(rosterRows(target).map((m) => m.id));
  const changed =
    merged.size !== targetIds.size || [...merged.keys()].some((id) => !targetIds.has(id));
  if (changed || recovered.length > 0 || removes.length > 0 || flipped) {
    const characters = [];
    for (const row of merged.values()) {
      const record = characterFromLegacy(row);
      if (record) characters.push(record);
    }
    writes[ROSTER_DOCUMENT_KEY] = serializeDocument(rosterFormat, { characters }, { compact: true });
  }

  /* An active pointer is only useful if it names a character that now exists, and
   * never a buried one: resuming would load bytes that are about to be gone. */
  if (activeUseful && carried !== null) {
    writes[ACTIVE_DOCUMENT_KEY] = serializeDocument(
      activeSlotFormat,
      { activeSlotId: carried },
      { compact: true },
    );
  }
  /* Removed rather than blanked: getActiveId treats a missing key as no offer. */
  const targetActive = readActiveId(target);
  if (targetActive !== null && buried.has(targetActive)) {
    if (target[ACTIVE_DOCUMENT_KEY] !== undefined && !removes.includes(ACTIVE_DOCUMENT_KEY)) {
      removes.push(ACTIVE_DOCUMENT_KEY);
    }
    if (target[ACTIVE_KEY] !== undefined && !removes.includes(ACTIVE_KEY)) {
      removes.push(ACTIVE_KEY);
    }
  }

  return { writes, removes, deaths: [...buried.keys()], recovered, skippedUnplayed, blocked: false };
}

/** Where web/profiles.ts keeps the list of named profiles, in the default profile's keys. */
export const PROFILES_DOCUMENT_KEY = "neo-angband:profiles";

/**
 * Add the source origins' named profiles to a target that already has a profile
 * list of its own, so their keys, carried under `profile:<id>:`, stay reachable
 * from the profile menu. The target keeps its own names, default name and active
 * profile. A target with no list at all gets the source's through the general key copy.
 */
function mergeProfileIndex(
  target: OriginEntries,
  sources: readonly OriginSnapshot[],
  writes: Record<string, string>,
): void {
  const current = target[PROFILES_DOCUMENT_KEY];
  if (current === undefined) return;
  const parsed = parseDocument(current, profilesFormat);
  if (!parsed.ok) return;
  const named = { ...parsed.data.named };
  let added = false;
  for (const src of sources) {
    const theirs = src.entries[PROFILES_DOCUMENT_KEY];
    if (theirs === undefined) continue;
    const other = parseDocument(theirs, profilesFormat);
    if (!other.ok) continue;
    for (const [id, profile] of Object.entries(other.data.named)) {
      if (id in named) continue;
      named[id] = profile;
      added = true;
    }
  }
  if (added) writes[PROFILES_DOCUMENT_KEY] = serializeDocument(profilesFormat, { ...parsed.data, named }, { compact: true });
}

/** web/mod-store.ts: one profile's enabled mods, consents and choices, and its setting values. */
export const MOD_STATE_DOCUMENT_KEY = "neo-angband:mod-state";
export const MOD_SETTINGS_DOCUMENT_KEY = "neo-angband:mod-settings";

/** Each entry of `from` whose key `into` lacks, or undefined when none was added. */
function fillMap<T>(into: Readonly<Record<string, T>> | undefined, from: Readonly<Record<string, T>> | undefined): Record<string, T> | undefined {
  if (from === undefined) return undefined;
  const out = { ...into };
  let added = false;
  for (const [k, v] of Object.entries(from)) {
    if (k in out) continue;
    out[k] = v;
    added = true;
  }
  return added ? out : undefined;
}

/**
 * Merge the mod manager's document field by field when the target already has one.
 *
 * The game writes this document on its first boot in a new origin, before the
 * player has chosen anything, so a whole-key fill would never bring the old
 * origin's mods back once that boot has happened. Per mod instead: the target keeps
 * every entry it has (a consent, a choice, a pin), and the source fills in the rest.
 * A mod the source had enabled is added to the end of the target's list unless the
 * target holds an explicit choice about it. Returns false when either side cannot
 * be read, which leaves the key to the plain fill-if-absent rule.
 */
function fillModState(target: OriginEntries, writes: Record<string, string>, value: string): boolean {
  const base = writes[MOD_STATE_DOCUMENT_KEY] ?? target[MOD_STATE_DOCUMENT_KEY];
  if (base === undefined) return false;
  const mine = parseDocument(base, modStateFormat);
  const theirs = parseDocument(value, modStateFormat);
  if (!mine.ok || !theirs.ok) return false;
  const out = { ...mine.data };
  let changed = false;
  for (const field of ["choices", "consents", "ruleChoices", "pins", "sectionChoices"] as const) {
    const filled = fillMap<unknown>(mine.data[field], theirs.data[field]);
    if (filled === undefined) continue;
    (out as Record<string, unknown>)[field] = filled;
    changed = true;
  }
  if (theirs.data.enabled !== undefined) {
    const enabled = [...(mine.data.enabled ?? [])];
    for (const id of theirs.data.enabled) {
      if (enabled.includes(id) || (mine.data.choices !== undefined && id in mine.data.choices)) continue;
      enabled.push(id);
      changed = true;
    }
    out.enabled = enabled;
  }
  if (changed) writes[MOD_STATE_DOCUMENT_KEY] = serializeDocument(modStateFormat, out, { compact: true });
  return true;
}

/** fillModState for the setting values: a mod's values come over when the target has none for it. */
function fillModSettings(target: OriginEntries, writes: Record<string, string>, value: string): boolean {
  const base = writes[MOD_SETTINGS_DOCUMENT_KEY] ?? target[MOD_SETTINGS_DOCUMENT_KEY];
  if (base === undefined) return false;
  const mine = parseDocument(base, modSettingValuesFormat);
  const theirs = parseDocument(value, modSettingValuesFormat);
  if (!mine.ok || !theirs.ok) return false;
  const values = fillMap(mine.data.values, theirs.data.values);
  if (values !== undefined) writes[MOD_SETTINGS_DOCUMENT_KEY] = serializeDocument(modSettingValuesFormat, { ...mine.data, values }, { compact: true });
  return true;
}

function readActiveId(entries: OriginEntries): string | null {
  const current = entries[ACTIVE_DOCUMENT_KEY];
  if (current !== undefined) {
    const parsed = parseDocument(current, activeSlotFormat);
    return parsed.ok ? parsed.data.activeSlotId : null;
  }
  const legacy = entries[ACTIVE_KEY];
  if (legacy === undefined) return null;
  const slot = activeSlotFromLegacy(legacy);
  return slot?.activeSlotId ?? null;
}

/**
 * The active id to copy in, when the target has none. The target's own pointer
 * is left for the game to convert; this only fills a target that has neither key.
 */
function carriedActiveId(target: OriginEntries, sources: readonly OriginSnapshot[]): string | null {
  if (target[ACTIVE_DOCUMENT_KEY] !== undefined || target[ACTIVE_KEY] !== undefined) return null;
  for (const src of sources) {
    const id = readActiveId(src.entries);
    if (id !== null) return id;
  }
  return null;
}

function carryRecords<T>(
  target: OriginEntries,
  writes: Record<string, string>,
  source: OriginEntries,
  key: string,
  legacyKey: string,
  format: FormatDefinition<T>,
  fromLegacy: (raw: string) => T | null,
): void {
  if (key in target || key in writes || legacyKey in target) return;
  const current = source[key];
  if (current !== undefined) {
    const parsed = parseDocument(current, format);
    if (parsed.ok) {
      writes[key] = serializeDocument(format, parsed.data, { compact: true });
    }
    return;
  }
  const legacy = source[legacyKey];
  if (legacy === undefined) return;
  const data = fromLegacy(legacy);
  if (data === null) return;
  writes[key] = serializeDocument(format, data, { compact: true });
}
