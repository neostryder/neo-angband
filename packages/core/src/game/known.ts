/**
 * The player's map knowledge, a reduction of the upstream player->cave twin
 * chunk (cave.c cave_know_*, cave-square.c square_memorize / square_forget /
 * square_know_pile / square_sense_pile, and cave-view.c note_spot).
 *
 * Upstream duplicates the whole chunk for the player's knowledge so memory
 * can go stale (you remember the door you saw, not the open floor it has
 * since become). This port keeps the same staleness property with a flat
 * remembered-feat array plus a remembered-floor-object marker per grid;
 * that is exactly what detection, magic mapping and the renderer's
 * remembered-terrain display need. The full twin (known traps as objects,
 * per-object known twins) rides later batches and is ledgered.
 *
 * noteSpots() is the note_spot / update_mon pass over the current field of
 * view: every SEEN grid is memorized with its floor pile, and monster
 * visibility flags (MFLAG VISIBLE / MARK / SHOW) are refreshed - a seen,
 * non-invisible, non-camouflaged monster is visible; a detection-marked
 * monster stays displayed for one more refresh (the SHOW lifecycle), then
 * fades. The session and front end call it after every updateView.
 */

import { MFLAG, SQUARE } from "../generated";
import type { Loc } from "../loc";
import { squareIsSeen } from "../world/view";
import { getLore, loreCountU16 } from "../mon/lore";
import {
  monsterIsCamouflaged,
  monsterIsInvisible,
} from "../mon/predicate";
import type { GameObject } from "../obj/object";
import type { GameState } from "./context";

/**
 * A remembered floor object: the pile head's display glyph, or a null
 * glyph for a sensed-but-unidentified something (upstream's
 * unknown_item_kind / unknown_gold_kind markers).
 */
export interface KnownObjectMemory {
  /** Display char of the remembered pile head; null = sensed-unknown. */
  ch: string | null;
  /** Display color char of the remembered pile head. */
  attr: string;
}

/** The player's knowledge of the current level. */
export interface KnownMap {
  width: number;
  height: number;
  /** Remembered feat per grid; -1 = unknown. May be stale, as upstream. */
  feat: Int16Array;
  /** Remembered floor objects by grid index (y * width + x). */
  objects: Map<number, KnownObjectMemory>;
}

/** A blank (all-unknown) knowledge map for a fresh level. */
export function newKnownMap(width: number, height: number): KnownMap {
  return {
    width,
    height,
    feat: new Int16Array(width * height).fill(-1),
    objects: new Map(),
  };
}

function gi(state: GameState, grid: Loc): number {
  return grid.y * state.chunk.width + grid.x;
}

/** square_memorize: remember the grid's current terrain. */
export function squareMemorize(state: GameState, grid: Loc): void {
  state.known.feat[gi(state, grid)] = state.chunk.feat(grid);
}

/** square_forget: forget the grid's terrain (and any remembered objects). */
export function squareForget(state: GameState, grid: Loc): void {
  state.known.feat[gi(state, grid)] = -1;
  state.known.objects.delete(gi(state, grid));
}

/** square_isknown: the player remembers some terrain here. */
export function squareIsKnown(state: GameState, grid: Loc): boolean {
  return state.known.feat[gi(state, grid)]! >= 0;
}

/** The remembered feat at a grid (-1 = unknown). */
export function knownFeat(state: GameState, grid: Loc): number {
  return state.known.feat[gi(state, grid)]!;
}

/**
 * square_ismemorybad: the player remembers terrain here that no longer
 * matches the live cave.
 */
export function squareMemoryBad(state: GameState, grid: Loc): boolean {
  const known = state.known.feat[gi(state, grid)]!;
  return known >= 0 && known !== state.chunk.feat(grid);
}

/** The remembered floor object at a grid, if any. */
export function knownObject(
  state: GameState,
  grid: Loc,
): KnownObjectMemory | null {
  return state.known.objects.get(gi(state, grid)) ?? null;
}

function pileHead(
  state: GameState,
  grid: Loc,
  pred?: (obj: GameObject) => boolean,
): GameObject | null {
  const pile = state.floor.get(gi(state, grid));
  if (!pile) return null;
  for (const obj of pile) {
    if (!pred || pred(obj)) return obj;
  }
  return null;
}

/**
 * square_know_pile (reduced): remember the (first matching) floor object
 * exactly; forget a remembered object that is no longer there. Without a
 * predicate the whole pile is considered (the note_spot case).
 */
export function squareKnowPile(
  state: GameState,
  grid: Loc,
  pred?: (obj: GameObject) => boolean,
): void {
  const head = pileHead(state, grid, pred);
  if (head) {
    state.known.objects.set(gi(state, grid), {
      ch: head.kind.dChar,
      attr: head.kind.dAttr,
    });
  } else if (!pileHead(state, grid)) {
    /* Nothing at all here: any memory is stale. */
    state.known.objects.delete(gi(state, grid));
  }
}

/**
 * square_sense_pile (reduced): become aware that something matching is
 * here without learning what (the null-glyph marker), keeping an exact
 * memory if one exists; forget stale memories like squareKnowPile.
 */
export function squareSensePile(
  state: GameState,
  grid: Loc,
  pred?: (obj: GameObject) => boolean,
): void {
  const idx = gi(state, grid);
  const head = pileHead(state, grid, pred);
  if (head) {
    const existing = state.known.objects.get(idx);
    if (!existing || existing.ch === null) {
      state.known.objects.set(idx, { ch: null, attr: "" });
    }
  } else if (!pileHead(state, grid)) {
    state.known.objects.delete(idx);
  }
}

/**
 * wiz_dark's forgetting half: erase all terrain and object memory (the
 * remembered map goes black; DTRAP marks are wiped with it).
 */
export function forgetMap(state: GameState): void {
  state.known.feat.fill(-1);
  state.known.objects.clear();
  for (let y = 0; y < state.chunk.height; y++) {
    for (let x = 0; x < state.chunk.width; x++) {
      state.chunk.sqinfoOff({ x, y }, SQUARE.DTRAP);
    }
  }
}

/**
 * note_spot + update_mon, reduced: memorize every currently seen grid with
 * its floor pile, and refresh monster visibility - seen, non-invisible,
 * non-camouflaged monsters are VISIBLE and MARKed; detection-marked
 * monsters (MARK + SHOW) stay displayed for one more refresh, then fade.
 * Call after every updateView.
 */
export function noteSpots(state: GameState): void {
  const c = state.chunk;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = { x, y };
      if (!squareIsSeen(c, grid)) continue;
      squareMemorize(state, grid);
      squareKnowPile(state, grid);
    }
  }

  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    const seen =
      squareIsSeen(c, mon.grid) &&
      !monsterIsInvisible(mon) &&
      !monsterIsCamouflaged(mon);
    if (seen) {
      /* Count "fresh" sightings (update_mon, mon-util.c L422). */
      if (!mon.mflag.has(MFLAG.VISIBLE)) {
        loreCountU16(getLore(state.lore, mon.race), "sights");
      }
      mon.mflag.on(MFLAG.VISIBLE);
      mon.mflag.on(MFLAG.MARK);
    } else if (mon.mflag.has(MFLAG.SHOW)) {
      /* Recently detected: keep the mark one refresh, then let it fade. */
      mon.mflag.off(MFLAG.SHOW);
    } else {
      mon.mflag.off(MFLAG.MARK);
      mon.mflag.off(MFLAG.VISIBLE);
    }
  }
}
