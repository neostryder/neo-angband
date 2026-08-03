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
 * except the roster, which is MERGED; a save whose bytes are missing is not
 * invented; and only the game's own keys are touched.
 */

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

export const ROSTER_KEY = "neo-angband-roster";
export const ACTIVE_KEY = "neo-angband-active";
export const SLOT_PREFIX = "neo-angband-save:";

/**
 * Key prefixes this game owns. Anything else in the origin - a devtools key, an
 * extension's key - is left where it is.
 */
const OWNED = ["neo-angband-", "neo:"];

function isOwned(key: string): boolean {
  return OWNED.some((p) => key.startsWith(p));
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
  /** Characters this brings back, for the report the player is shown. */
  readonly recovered: readonly RecoveredChar[];
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

function parseRoster(raw: string | undefined): Meta[] {
  if (raw === undefined) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter(
      (m): m is Meta => typeof m === "object" && m !== null && typeof (m as Meta).id === "string",
    );
  } catch {
    return [];
  }
}

function stamp(m: Meta): number {
  return typeof m.updatedAt === "number" ? m.updatedAt : 0;
}

/**
 * Plan the merge. `sources` should be newest-origin-first: when the same character
 * exists in two of them with equal timestamps, the earlier entry in this list wins.
 */
export function planOriginMerge(
  target: OriginEntries,
  sources: readonly OriginSnapshot[],
): MergePlan {
  const writes: Record<string, string> = {};
  const recovered: RecoveredChar[] = [];
  const skippedUnplayed: RecoveredChar[] = [];

  /* The target's own characters are the baseline and are never displaced by an
   * older copy of themselves. */
  const merged = new Map<string, Meta>();
  for (const m of parseRoster(target[ROSTER_KEY])) merged.set(m.id, m);

  for (const src of sources) {
    for (const m of parseRoster(src.entries[ROSTER_KEY])) {
      const existing = merged.get(m.id);
      if (existing && stamp(existing) >= stamp(m)) continue;

      const slot = SLOT_PREFIX + m.id;
      const bytes = src.entries[slot];
      const named = {
        id: m.id,
        name: typeof m.name === "string" ? m.name : "(unnamed)",
        fromPort: src.port,
        hasSave: bytes !== undefined || target[slot] !== undefined,
      };

      /* A birth abandoned at turn 0 is not a character anybody lost; importing
       * every one of them would fill the character screen with rows the player
       * only ever pressed Enter through. Left in place, not deleted. */
      if (m.alive !== false && (m.turn ?? 0) <= 0) {
        skippedUnplayed.push(named);
        continue;
      }
      /* A living character with no bytes is not resumable, so importing its
       * metadata alone would offer the player a save that cannot be loaded. Skip
       * it unless the target has the bytes already. */
      if (m.alive !== false && bytes === undefined && target[slot] === undefined) {
        continue;
      }

      merged.set(m.id, m);
      if (bytes !== undefined && target[slot] === undefined) writes[slot] = bytes;
      recovered.push(named);
    }

    /* Everything else the game owns: filled in only where the target has nothing,
     * so settings the player has since chosen in the new origin stand. */
    for (const [key, value] of Object.entries(src.entries)) {
      if (!isOwned(key)) continue;
      if (key === ROSTER_KEY || key.startsWith(SLOT_PREFIX)) continue;
      if (key in target || key in writes) continue;
      writes[key] = value;
    }
  }

  if (recovered.length === 0 && Object.keys(writes).length === 0) {
    return { writes: {}, recovered: [], skippedUnplayed };
  }

  /* Only rewrite the roster when it actually gained something. */
  const targetIds = new Set(parseRoster(target[ROSTER_KEY]).map((m) => m.id));
  const changed =
    merged.size !== targetIds.size || [...merged.keys()].some((id) => !targetIds.has(id));
  if (changed || recovered.length > 0) {
    writes[ROSTER_KEY] = JSON.stringify([...merged.values()]);
  }

  /* An active pointer is only useful if it names a character that now exists. */
  const active = writes[ACTIVE_KEY];
  if (active !== undefined && !merged.has(active)) delete writes[ACTIVE_KEY];

  return { writes, recovered, skippedUnplayed };
}
