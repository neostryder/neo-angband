/**
 * Character auto-history creation and management, ported from
 * reference/src/player-history.c (Angband 4.2.6).
 *
 * struct history_info (player-history.h L47-54) becomes HistoryInfo below.
 * Upstream's `type` field is a bitflag SET (bitflag type[HIST_SIZE]); the
 * port models it as a single JS number bitmask, since HIST_MAX (11, see
 * generated/history-types.ts) fits comfortably in bits 0..10 and at most two
 * or three bits are ever combined (e.g. ARTIFACT_UNKNOWN|ARTIFACT_LOST on a
 * "Missed X" entry). historyAdd sets exactly one bit (1 << typeBit),
 * matching history_add's hist_wipe + hist_on(flags, type) (L127-134).
 *
 * Upstream's player_history struct additionally tracks `next`/`length` for
 * its manually-grown C array (history_init/history_realloc); the port's
 * Player.hist is a plain growable array, so array length stands in for
 * `next` and there is nothing to persist beyond the entries themselves.
 *
 * This module is pure (player/ layer): every function takes explicit
 * dlev/clev/turn stamps and a `nameFn` for artifact text, exactly like
 * history_add_full's parameters, so it draws no RNG and depends on no
 * GameState. The game-layer stamp (dlev/clev/turn off live state) and the
 * artifact fake-name builder live in game/history.ts.
 */

import { HIST } from "../generated";
import type { Player } from "./player";

/** struct history_info (player-history.h L47-54). */
export interface HistoryInfo {
  /** bitflag type[HIST_SIZE]: bitmask of HIST_* bits (1 << HIST.X). */
  type: number;
  /** int16_t dlev: dungeon level (feet = dlev * 50) when recorded. */
  dlev: number;
  /** int16_t clev: character level when recorded. */
  clev: number;
  /** uint8_t a_idx: the artifact this item relates to (0 = none). */
  aIdx: number;
  /** int32_t turn: the turn this item was recorded on. */
  turn: number;
  /** char event[80]: the text of the item (truncated to 79 chars + NUL). */
  event: string;
}

/** hist_has(f, flag): whether bit `flagBit` is set in the type bitmask. */
export function histHas(type: number, flagBit: number): boolean {
  return (type & (1 << flagBit)) !== 0;
}

/** hist_on(f, flag): set bit `flagBit` on the entry's type bitmask. */
function histOn(entry: HistoryInfo, flagBit: number): void {
  entry.type |= 1 << flagBit;
}

/** hist_off(f, flag): clear bit `flagBit` on the entry's type bitmask. */
function histOff(entry: HistoryInfo, flagBit: number): void {
  entry.type &= ~(1 << flagBit);
}

/** history_clear (player-history.c L56-67): empty the log. */
export function historyClear(p: Player): void {
  p.hist = [];
}

/**
 * history_add_full (player-history.c L76-105): append a fully-specified
 * entry. `text` is truncated to 79 characters (my_strcpy into event[80]
 * leaves room for the NUL). Always succeeds (the port's array has no fixed
 * capacity to fail against), matching the C's unconditional `return true`.
 */
export function historyAddFull(
  p: Player,
  type: number,
  aIdx: number,
  dlev: number,
  clev: number,
  turn: number,
  text: string,
): boolean {
  p.hist.push({ type, dlev, clev, aIdx, turn, event: text.slice(0, 79) });
  return true;
}

/**
 * history_add (player-history.c L127-134): add an entry with a single HIST_*
 * type bit, no artifact. Mirrors history_add_with_flags's stamp (aidx 0,
 * p->depth, p->lev, p->total_energy/100) via the caller-supplied dlev/clev/
 * turn (the game layer reads those off live state; see game/history.ts).
 */
export function historyAdd(
  p: Player,
  text: string,
  typeBit: number,
  dlev: number,
  clev: number,
  turn: number,
): boolean {
  return historyAddFull(p, 1 << typeBit, 0, dlev, clev, turn, text);
}

/**
 * history_is_artifact_known (player-history.c L139-153): true if a KNOWN
 * entry for this artifact exists. Scans newest-first, exactly as upstream.
 */
export function historyIsArtifactKnown(
  p: Player,
  art: { aidx: number },
): boolean {
  for (let i = p.hist.length - 1; i >= 0; i--) {
    const e = p.hist[i]!;
    if (histHas(e.type, HIST.ARTIFACT_KNOWN) && e.aIdx === art.aidx) return true;
  }
  return false;
}

/**
 * history_mark_artifact_known (player-history.c L158-173): flip the first
 * (newest) matching-aidx entry from UNKNOWN to KNOWN. Returns whether a
 * matching entry was found.
 */
function historyMarkArtifactKnown(p: Player, art: { aidx: number }): boolean {
  for (let i = p.hist.length - 1; i >= 0; i--) {
    const e = p.hist[i]!;
    if (e.aIdx === art.aidx) {
      histOff(e, HIST.ARTIFACT_UNKNOWN);
      histOn(e, HIST.ARTIFACT_KNOWN);
      return true;
    }
  }
  return false;
}

/**
 * history_mark_artifact_lost (player-history.c L178-192): flip the LOST bit
 * on the first (newest) matching-aidx entry. Returns whether found.
 */
function historyMarkArtifactLost(p: Player, art: { aidx: number }): boolean {
  for (let i = p.hist.length - 1; i >= 0; i--) {
    const e = p.hist[i]!;
    if (e.aIdx === art.aidx) {
      histOn(e, HIST.ARTIFACT_LOST);
      return true;
    }
  }
  return false;
}

/** An artifact-like value: only the fields history needs. */
export interface HistoryArtifactRef {
  aidx: number;
}

/**
 * history_find_artifact (player-history.c L223-241): reveal an existing
 * artifact entry, or log a new "Found <name>" KNOWN entry. `nameFn` builds
 * the spoiled artifact name (get_artifact_name, L197-215); the game layer's
 * artifactHistoryName is RNG-free (objectPrep with the "maximise" aspect).
 */
export function historyFindArtifact<A extends HistoryArtifactRef>(
  p: Player,
  art: A,
  dlev: number,
  clev: number,
  turn: number,
  nameFn: (art: A) => string,
): void {
  if (!historyMarkArtifactKnown(p, art)) {
    const text = `Found ${nameFn(art)}`;
    historyAddFull(p, 1 << HIST.ARTIFACT_KNOWN, art.aidx, dlev, clev, turn, text);
  }
}

/**
 * history_lose_artifact (player-history.c L246-266): mark an artifact lost,
 * or log a new "Missed <name>" UNKNOWN|LOST entry.
 */
export function historyLoseArtifact<A extends HistoryArtifactRef>(
  p: Player,
  art: A,
  dlev: number,
  clev: number,
  turn: number,
  nameFn: (art: A) => string,
): void {
  if (!historyMarkArtifactLost(p, art)) {
    const text = `Missed ${nameFn(art)}`;
    const type = (1 << HIST.ARTIFACT_UNKNOWN) | (1 << HIST.ARTIFACT_LOST);
    historyAddFull(p, type, art.aidx, dlev, clev, turn, text);
  }
}

/**
 * history_unmask_unknown (player-history.c L272-283): convert every
 * ARTIFACT_UNKNOWN entry to ARTIFACT_KNOWN. Called once at death (matching
 * player-util.c death_knowledge L309) so the memorial/char-dump shows real
 * artifact names; 4.2.6 never writes a HIST_PLAYER_DEATH entry (verified:
 * zero uses of that type in reference/src), so death logs nothing new here.
 */
export function historyUnmaskUnknown(p: Player): void {
  for (let i = p.hist.length - 1; i >= 0; i--) {
    const e = p.hist[i]!;
    if (histHas(e.type, HIST.ARTIFACT_UNKNOWN)) {
      histOff(e, HIST.ARTIFACT_UNKNOWN);
      histOn(e, HIST.ARTIFACT_KNOWN);
    }
  }
}

/** history_get_list (player-history.c L288-294): the entries, oldest-first. */
export function historyGetList(p: Player): readonly HistoryInfo[] {
  return p.hist;
}
