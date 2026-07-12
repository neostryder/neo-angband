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
 * noteSpots() is the note_spot pass over the current field of view: every
 * SEEN grid is memorized with its floor pile. It then runs updateMonsters()
 * - the faithful port of update_mon (mon-util.c) - to refresh every live
 * monster's visibility flags from telepathy, infravision, see-invisible and
 * illumination. The session and front end call it after every updateView.
 *
 * update_mon only READS MFLAG_MARK; the detection-fade lifecycle
 * (MFLAG_MARK / MFLAG_SHOW clearing, game-world.c process_world) lives in
 * tickMonsterMarks() until the world-clock port absorbs it.
 */

import { MFLAG, OF, RF, SQUARE, TMD } from "../generated";
import type { Loc } from "../loc";
import { loc } from "../loc";
import { squareIsNoEsp, squareIsSeen, squareIsView } from "../world/view";
import { getLore, loreCountU16 } from "../mon/lore";
import {
  monsterIsCamouflaged,
  monsterIsEspDetectable,
  monsterIsInView,
  monsterIsInvisible,
  monsterIsVisible,
} from "../mon/predicate";
import { disturb } from "./player-path";
import type { Monster } from "../mon/monster";
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

/** OPT(player, disturb_near): shipped default true (options.c). */
function disturbNear(state: GameState): boolean {
  return state.options?.get("disturb_near") ?? true;
}

/**
 * update_mon (mon-util.c): recompute a single monster's visibility. When
 * `full`, recompute its distance to the player (mon->cdis); otherwise use the
 * stored one. Sets MFLAG_VISIBLE / MFLAG_VIEW from telepathy, infravision,
 * see-invisible and illumination, learns the associated lore flags, and
 * disturbs the player on appearance / disappearance. Draws no RNG.
 *
 * The player's derived flags (OF_TELEPATHY / OF_SEE_INVIS) and see_infra come
 * from the last calc_bonuses (state.playerState); the blind check reads
 * player->timed[TMD_BLIND] directly. update_mon only READS MFLAG_MARK - the
 * MARK / SHOW detection-fade lives in tickMonsterMarks.
 */
export function updateMon(
  state: GameState,
  mon: Monster,
  full: boolean,
): void {
  const c = state.chunk;
  const lore = getLore(state.lore, mon.race);

  /* If still generating the level, measure distances from the middle
   * (character_dungeon); a live refresh always uses the player's grid. */
  const pgrid: Loc = state.playing
    ? state.actor.grid
    : loc(Math.trunc(c.width / 2), Math.trunc(c.height / 2));

  /* Seen at all. */
  let flag = false;
  /* Seen by vision. */
  let easy = false;

  /* ESP permitted, see-invisible and infravision come from the derived
   * player state (racial / class innate flags, worn equipment, and the timed
   * player_flags_timed / see_infra bumps all flow through calc_bonuses). With
   * no derived state (worldless harness) fall back to a bare character: no OF
   * flags, racial infravision only. */
  const ps = state.playerState;
  let telepathyOk = ps ? ps.flags.has(OF.TELEPATHY) : false;
  const seeInvis = ps ? ps.flags.has(OF.SEE_INVIS) : false;
  const seeInfra = ps ? ps.seeInfra : state.actor.player.race.infravision;

  /* Compute distance, or just use the current one. */
  let d: number;
  if (full) {
    const dy = Math.abs(pgrid.y - mon.grid.y);
    const dx = Math.abs(pgrid.x - mon.grid.x);
    d = dy > dx ? dy + (dx >> 1) : dx + (dy >> 1);
    if (d > 255) d = 255;
    mon.cdis = d;
  } else {
    d = mon.cdis;
  }

  /* Detected (read-only: the MARK / SHOW fade belongs to tickMonsterMarks). */
  if (mon.mflag.has(MFLAG.MARK)) flag = true;

  /* Check if telepathy works here. */
  if (squareIsNoEsp(c, mon.grid) || squareIsNoEsp(c, pgrid)) {
    telepathyOk = false;
  }

  /* Nearby. */
  if (d <= state.z.maxSight) {
    /* Basic telepathy. */
    if (telepathyOk && monsterIsEspDetectable(mon)) {
      flag = true;
      /* Check for LOS so that MFLAG_VIEW is set later. */
      if (squareIsView(c, mon.grid)) easy = true;
    }

    /* Normal line of sight and player is not blind. */
    if (squareIsView(c, mon.grid) && !state.actor.player.timed[TMD.BLIND]) {
      /* Use "infravision". */
      if (d <= seeInfra) {
        /* Learn about warm / cold blood. */
        lore.flags.on(RF.COLD_BLOOD);
        if (!mon.race.flags.has(RF.COLD_BLOOD)) {
          easy = flag = true;
        }
      }

      /* Use illumination. */
      if (squareIsSeen(c, mon.grid)) {
        /* Learn about invisibility. */
        lore.flags.on(RF.INVISIBLE);
        if (monsterIsInvisible(mon)) {
          /* See invisible. */
          if (seeInvis) easy = flag = true;
        } else {
          easy = flag = true;
        }
      }

      /* path_analyse (learn intervening-square terrain): DEFERRED. */
    }
  }

  /* If a mimic looks like an ignored item, it's not seen (mon-util.c L394):
   *   if (monster_is_mimicking(mon) && ignore_item_ok(player, obj))
   *     easy = flag = false;
   * mon.mimickedObj is always 0 until mimic placement is generated, so the
   * guard never fires; resolving the handle to a GameObject is DEFERRED with
   * that work. */

  /* Is the monster now visible? */
  if (flag) {
    /* Learn about the monster's mind. */
    if (telepathyOk) {
      lore.flags.on(RF.EMPTY_MIND);
      lore.flags.on(RF.WEIRD_MIND);
      lore.flags.on(RF.SMART);
      lore.flags.on(RF.STUPID);
    }

    /* It was previously unseen. */
    if (!monsterIsVisible(mon)) {
      mon.mflag.on(MFLAG.VISIBLE);
      /* square_light_spot / PR_HEALTH / PR_MONLIST are presentation (#25). */
      /* Count "fresh" sightings (capped at SHRT_MAX). */
      loreCountU16(lore, "sights");
    }
  } else if (monsterIsVisible(mon)) {
    /* Not visible but was previously seen. With mimickedObj always 0 the
     * mimic caveat (!mon->mimicked_obj || ignore_item_ok) always clears. */
    if (mon.mimickedObj === 0) {
      mon.mflag.off(MFLAG.VISIBLE);
    }
  }

  /* Is the monster now easily visible? */
  if (easy) {
    if (!monsterIsInView(mon)) {
      mon.mflag.on(MFLAG.VIEW);
      /* Disturb on appearance. */
      if (disturbNear(state)) disturb(state);
    }
  } else {
    if (monsterIsInView(mon)) {
      mon.mflag.off(MFLAG.VIEW);
      /* Disturb on disappearance (but not for a camouflaged monster). */
      if (disturbNear(state) && !monsterIsCamouflaged(mon)) disturb(state);
    }
  }
}

/** update_monsters (mon-util.c): update every live (non-dead) monster. */
export function updateMonsters(state: GameState, full: boolean): void {
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    updateMon(state, mon, full);
  }
}

/**
 * note_spot pass: memorize every currently seen grid with its floor pile,
 * then refresh all monster visibility via update_mon.
 *
 * Called after every updateView. Upstream, movement sets PU_DISTANCE and
 * update() runs update_monsters(TRUE) - cdis and visibility recompute in one
 * pass - while a view-only change runs update_monsters(FALSE). Since cdis is
 * purely geometric (idempotent when nothing moved, correct when the player
 * did), noteSpots recomputes it here (full=true) so the d <= max_sight and
 * d <= see_infra gates never read a stale distance after a step.
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

  updateMonsters(state, true);
}

/**
 * The MFLAG_NICE / MFLAG_MARK / MFLAG_SHOW housekeeping process_world runs at
 * the end of a player turn (game-world.c:882-908): clear NICE; where a monster
 * is MARKed but no longer SHOWn, drop the mark and re-run update_mon; then
 * clear every SHOW. This keeps a freshly detected monster displayed for one
 * more refresh before fading. Interim home until the world-clock / process_world
 * port absorbs it (the NICE clear must be preserved when it does).
 */
export function tickMonsterMarks(state: GameState): void {
  /* Clear NICE flag, and show marked monsters. */
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    mon.mflag.off(MFLAG.NICE);
    if (mon.mflag.has(MFLAG.MARK) && !mon.mflag.has(MFLAG.SHOW)) {
      mon.mflag.off(MFLAG.MARK);
      updateMon(state, mon, false);
    }
  }

  /* Clear SHOW flag. */
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    mon.mflag.off(MFLAG.SHOW);
  }
}
