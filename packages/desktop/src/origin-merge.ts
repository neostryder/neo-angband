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
 *   4. Anything that puts the game back on 45871 - NEO_ANGBAND_PORT is the honest
 *      way - finds it alive, at the turn it was copied at.
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
  for (const roster of [
    parseRoster(target[ROSTER_KEY]),
    ...sources.map((s) => parseRoster(s.entries[ROSTER_KEY])),
  ]) {
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
 */
export function planOriginMerge(
  target: OriginEntries,
  sources: readonly OriginSnapshot[],
  knownDead: Iterable<string> = [],
): MergePlan {
  const writes: Record<string, string> = {};
  const removes: string[] = [];
  const recovered: RecoveredChar[] = [];
  const skippedUnplayed: RecoveredChar[] = [];

  /* The target's own characters are the baseline and are never displaced by an
   * older copy of themselves. */
  const merged = new Map<string, Meta>();
  for (const m of parseRoster(target[ROSTER_KEY])) merged.set(m.id, m);

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
    for (const m of parseRoster(src.entries[ROSTER_KEY])) {
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
      if (!dead && (m.turn ?? 0) <= 0) {
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

    /* Everything else the game owns: filled in only where the target has nothing,
     * so settings the player has since chosen in the new origin stand. */
    for (const [key, value] of Object.entries(src.entries)) {
      if (!isOwned(key)) continue;
      if (key === ROSTER_KEY || key.startsWith(SLOT_PREFIX)) continue;
      if (key in target || key in writes) continue;
      writes[key] = value;
    }
  }

  if (
    recovered.length === 0 &&
    Object.keys(writes).length === 0 &&
    removes.length === 0 &&
    !flipped
  ) {
    return { writes: {}, removes: [], deaths: [...buried.keys()], recovered: [], skippedUnplayed };
  }

  /* Only rewrite the roster when it actually gained something - or when a burial
   * changed a row in it, which is a change the id set cannot see. */
  const targetIds = new Set(parseRoster(target[ROSTER_KEY]).map((m) => m.id));
  const changed =
    merged.size !== targetIds.size || [...merged.keys()].some((id) => !targetIds.has(id));
  if (changed || recovered.length > 0 || removes.length > 0 || flipped) {
    writes[ROSTER_KEY] = JSON.stringify([...merged.values()]);
  }

  /* An active pointer is only useful if it names a character that now exists, and
   * never a buried one: resuming would load bytes that are about to be gone. */
  const active = writes[ACTIVE_KEY];
  if (active !== undefined && (!merged.has(active) || buried.has(active))) {
    delete writes[ACTIVE_KEY];
  }
  /* Removed rather than blanked: getActiveId reads the raw item, so "" would be a
   * falsy-but-present pointer and setActiveId(null) itself removes the key. */
  const targetActive = target[ACTIVE_KEY];
  if (targetActive !== undefined && buried.has(targetActive) && !removes.includes(ACTIVE_KEY)) {
    removes.push(ACTIVE_KEY);
  }

  return { writes, removes, deaths: [...buried.keys()], recovered, skippedUnplayed };
}
