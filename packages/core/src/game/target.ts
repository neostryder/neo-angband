/**
 * Targeting, ported from reference/src/target.c (Angband 4.2.6): the
 * player's persistent target (a monster or a location), the target-able
 * test, the fix/release protocol that keeps a mid-spell target's grid
 * alive after the monster dies, the interesting-grid scan the look/target
 * UI walks, and target_set_closest.
 *
 * The upstream file-statics (target_set, target_fixed, target, old_target)
 * live on GameState.target (a TargetState) so saves/tests stay explicit.
 * The interactive half of targeting (ui-target.c: the * key browsing loop,
 * panels, prompts) rides presentation (#25); this module is the complete
 * bookkeeping half those menus drive, and effect handlers reach it through
 * the aimed seam (obj-cmd / spell-cmd resolve DIR_TARGET through
 * targetOkay + targetGet exactly as the upstream handlers do).
 *
 * Reductions, ledgered in parity/ledger/game-target.yaml: monster names in
 * messages are the race name (MDESC rides #25), panel restriction is an
 * injected predicate defaulting to "everything" (panels are UI state),
 * ignore_known_item_ok treats no known objects as ignored (ignore is a
 * later #24 slice), and monster_race_track is lore's (healthWho covers
 * health_track).
 */

import { MON_TMD, TF, TMD } from "../generated";
import type { Loc } from "../loc";
import { loc } from "../loc";
import type { Monster } from "../mon/monster";
import {
  monsterIsDestroyed,
  monsterIsInView,
  monsterIsObvious,
  monsterIsVisible,
} from "../mon/predicate";
import { PROJECT, projectable } from "../world/project";
import { squareIsSeen } from "../world/view";
import type { GameState } from "./context";
import { monsterAt, squareMonster } from "./context";
import { knownFeat, knownObject, squareIsKnown } from "./known";
import { squareIsVisibleTrap } from "./trap";

/** Bit flags for target_get_monsters / target_set_closest (target.h). */
export const TARGET = {
  KILL: 0x01,
  LOOK: 0x02,
  XTRA: 0x04,
  GRID: 0x08,
  QUIET: 0x10,
} as const;

/**
 * The target.c file-statics: whether a target is set, whether it is fixed
 * for the duration of a spell, the current target (monster index + grid)
 * and the saved old target the release step inspects.
 */
export interface TargetState {
  /** target_set. */
  set: boolean;
  /** target_fixed. */
  fixed: boolean;
  /** target.midx (0 = a location target or none). */
  midx: number;
  /** target.grid. */
  grid: Loc;
  /** old_target, saved by targetFix. */
  oldMidx: number;
  oldGrid: Loc;
}

/** A fresh, unset target. */
export function newTargetState(): TargetState {
  return {
    set: false,
    fixed: false,
    midx: 0,
    grid: loc(0, 0),
    oldMidx: 0,
    oldGrid: loc(0, 0),
  };
}

/**
 * look_mon_desc (L56): the monster health/status description ("wounded,
 * asleep, afraid"). PROBE and the look UI read it.
 */
export function lookMonDesc(mon: Monster): string {
  const living = !monsterIsDestroyed(mon);

  let buf: string;
  if (mon.hp >= mon.maxhp) {
    buf = living ? "unhurt" : "undamaged";
  } else {
    const perc = Math.trunc((100 * mon.hp) / mon.maxhp);
    if (perc >= 60) buf = living ? "somewhat wounded" : "somewhat damaged";
    else if (perc >= 25) buf = living ? "wounded" : "damaged";
    else if (perc >= 10) buf = living ? "badly wounded" : "badly damaged";
    else buf = living ? "almost dead" : "almost destroyed";
  }

  if (mon.mTimed[MON_TMD.SLEEP]) buf += ", asleep";
  if (mon.mTimed[MON_TMD.HOLD]) buf += ", held";
  if (mon.mTimed[MON_TMD.DISEN]) buf += ", disenchanted";
  if (mon.mTimed[MON_TMD.CONF]) buf += ", confused";
  if (mon.mTimed[MON_TMD.FEAR]) buf += ", afraid";
  if (mon.mTimed[MON_TMD.STUN]) buf += ", stunned";
  if (mon.mTimed[MON_TMD.SLOW]) buf += ", slowed";
  if (mon.mTimed[MON_TMD.FAST]) buf += ", hasted";
  return buf;
}

/**
 * target_able (L110): a reasonable target is an obvious monster the player
 * could hit with a projection while not hallucinating.
 */
export function targetAble(state: GameState, mon: Monster | null): boolean {
  return (
    !!mon &&
    !!mon.race &&
    monsterIsObvious(mon) &&
    projectable(
      state.chunk,
      state.actor.grid,
      mon.grid,
      PROJECT.NONE,
      state.z.maxRange,
    ) &&
    !((state.actor.player.timed[TMD.IMAGE] ?? 0) > 0)
  );
}

/**
 * target_okay (L124): update (a monster target's grid follows the monster)
 * and verify the target.
 */
export function targetOkay(state: GameState): boolean {
  const t = state.target;
  if (!t.set) return false;

  if (t.midx > 0) {
    const mon = monsterAt(state, t.midx);
    if (targetAble(state, mon)) {
      /* Get the monster location. */
      t.grid = mon!.grid;
      return true;
    }
  } else if (t.grid.x && t.grid.y) {
    /* Allow a direction without a monster. */
    return true;
  }

  return false;
}

/**
 * target_set_monster (L152): set the target to a monster (or nobody); if
 * the target is fixed, keep the grid so further effects of a spell that
 * killed the monster still have somewhere to land.
 */
export function targetSetMonster(
  state: GameState,
  mon: Monster | null,
): boolean {
  const t = state.target;
  if (mon && targetAble(state, mon)) {
    t.set = true;
    t.midx = mon.midx;
    t.grid = mon.grid;
    return true;
  } else if (t.fixed) {
    t.midx = 0;
    return true;
  }

  t.set = false;
  t.midx = 0;
  t.grid = loc(0, 0);
  return false;
}

/** target_set_location (L180): target a legal (fully in-bounds) grid. */
export function targetSetLocation(state: GameState, grid: Loc): void {
  const t = state.target;
  if (state.chunk.inBoundsFully(grid)) {
    t.set = true;
    t.midx = 0;
    t.grid = grid;
    return;
  }
  t.set = false;
  t.midx = 0;
  t.grid = loc(0, 0);
}

/** target_is_set (L203). */
export function targetIsSet(state: GameState): boolean {
  return state.target.set;
}

/** target_fix (L211): freeze the target for the duration of a spell. */
export function targetFix(state: GameState): void {
  const t = state.target;
  t.oldMidx = t.midx;
  t.oldGrid = t.grid;
  t.fixed = true;
}

/**
 * target_release (L220): unfreeze; if the old target is a now-dead (or no
 * longer viewed) monster, cancel the grid.
 */
export function targetRelease(state: GameState): void {
  const t = state.target;
  t.fixed = false;
  if (t.oldMidx !== 0) {
    const mon = monsterAt(state, t.oldMidx);
    if (!mon || !mon.race || !monsterIsInView(mon)) {
      t.grid = loc(0, 0);
    }
  }
}

/** The approximate double distance cmp_distance (L240) sorts by. */
function doubleDistance(from: Loc, to: Loc): number {
  const kx = Math.abs(to.x - from.x);
  const ky = Math.abs(to.y - from.y);
  return kx > ky ? kx + kx + ky : ky + ky + kx;
}

/**
 * target_pick (L276): from a set of interesting points, pick the closest
 * in (roughly) the given direction from (x1, y1). Returns the index into
 * `targets`, or -1. The look UI's direction-key cycling drives it.
 */
export function targetPick(
  y1: number,
  x1: number,
  dy: number,
  dx: number,
  targets: readonly Loc[],
): number {
  let bI = -1;
  let bV = 9999;

  for (let i = 0; i < targets.length; i++) {
    const x2 = targets[i]!.x;
    const y2 = targets[i]!.y;

    /* Directed distance. */
    const x3 = x2 - x1;
    const y3 = y2 - y1;

    /* Verify quadrant. */
    if (dx && x3 * dx <= 0) continue;
    if (dy && y3 * dy <= 0) continue;

    const x4 = Math.abs(x3);
    const y4 = Math.abs(y3);

    /* Verify quadrant. */
    if (dy && !dx && x4 > y4) continue;
    if (dx && !dy && y4 > x4) continue;

    /* Approximate double distance. */
    const v = x4 > y4 ? x4 + x4 + y4 : y4 + y4 + x4;

    if (bI >= 0 && v >= bV) continue;
    bI = i;
    bV = v;
  }

  return bI;
}

/**
 * target_accept (L325): is a grid "interesting" (the look/target scan
 * stops on it)? Player grid, obvious monsters, visible traps, remembered
 * objects and remembered interesting terrain qualify; hallucination blanks
 * everything but the player.
 */
export function targetAccept(state: GameState, grid: Loc): boolean {
  /* Player grids are always interesting. */
  if (state.chunk.mon(grid) < 0) return true;

  /* Handle hallucination. */
  if ((state.actor.player.timed[TMD.IMAGE] ?? 0) > 0) return false;

  /* Obvious monsters. */
  const mon = squareMonster(state, grid);
  if (mon && monsterIsObvious(mon)) return true;

  /* Traps. */
  if (squareIsVisibleTrap(state, grid)) return true;

  /* Memorized objects (ignore_known_item_ok rides the ignore slice). */
  if (knownObject(state, grid)) return true;

  /* Interesting memorized features. */
  if (squareIsKnown(state, grid)) {
    const feat = knownFeat(state, grid);
    if (state.chunk.features.featHas(feat, TF.INTERESTING)) return true;
  }

  return false;
}

/**
 * coords_desc (L370): a location relative to the player, e.g.
 * "12 S, 35 W".
 */
export function coordsDesc(state: GameState, grid: Loc): string {
  const p = state.actor.grid;
  const ns = grid.y > p.y ? "S" : "N";
  const ew = grid.x < p.x ? "W" : "E";
  return `${Math.abs(grid.y - p.y)} ${ns}, ${Math.abs(grid.x - p.x)} ${ew}`;
}

/** target_get (L395): the currently targeted location. */
export function targetGet(state: GameState): Loc {
  return state.target.grid;
}

/** target_get_monster (L405): the currently targeted monster, or null. */
export function targetGetMonster(state: GameState): Monster | null {
  return monsterAt(state, state.target.midx);
}

/**
 * target_sighted (L414): the current target is in line of sight. The panel
 * test is the UI's (#25); an injected predicate stands in, defaulting to
 * everything on-panel.
 */
export function targetSighted(
  state: GameState,
  panelContains: (grid: Loc) => boolean = () => true,
): boolean {
  if (!targetOkay(state)) return false;
  const t = state.target;
  if (!panelContains(t.grid)) return false;
  /* Either the target is a grid and is visible, or it is a monster that
   * is visible. */
  if (!t.midx) return squareIsSeen(state.chunk, t.grid);
  const mon = monsterAt(state, t.midx);
  return !!mon && monsterIsVisible(mon);
}

/**
 * target_get_monsters (L437): the interesting locations, sorted by
 * distance to the player. With TARGET.KILL only target-able monsters
 * matching `pred` are included. Panel restriction is injected (upstream's
 * restrict_to_panel); absent, the scan covers max_range around the player
 * as the upstream else-branch does.
 */
export function targetGetMonsters(
  state: GameState,
  mode: number,
  pred?: (mon: Monster) => boolean,
  panel?: { minY: number; minX: number; maxY: number; maxX: number },
): Loc[] {
  const p = state.actor.grid;
  const minY = panel ? panel.minY : p.y - state.z.maxRange;
  const maxY = panel ? panel.maxY : p.y + state.z.maxRange + 1;
  const minX = panel ? panel.minX : p.x - state.z.maxRange;
  const maxX = panel ? panel.maxX : p.x + state.z.maxRange + 1;

  const targets: Loc[] = [];
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const grid = loc(x, y);
      if (!state.chunk.inBoundsFully(grid)) continue;
      if (!targetAccept(state, grid)) continue;

      if (mode & TARGET.KILL) {
        const mon = squareMonster(state, grid);
        if (!mon) continue;
        if (!targetAble(state, mon)) continue;
        if (pred && !pred(mon)) continue;
      }

      targets.push(grid);
    }
  }

  targets.sort(
    (a, b) => doubleDistance(p, a) - doubleDistance(p, b),
  );
  return targets;
}

/**
 * target_set_closest (L493): target the closest (target-able, matching)
 * monster, announcing it and tracking its health. Returns false (with
 * "No Available Target.") when nothing qualifies.
 */
export function targetSetClosest(
  state: GameState,
  mode: number,
  pred?: (mon: Monster) => boolean,
): boolean {
  /* Cancel old target. */
  targetSetMonster(state, null);

  const targets = targetGetMonsters(state, mode, pred);
  if (targets.length < 1) {
    state.msg?.("No Available Target.");
    return false;
  }

  /* Find the first monster in the queue. */
  const mon = squareMonster(state, targets[0]!);
  if (!targetAble(state, mon)) {
    state.msg?.("No Available Target.");
    return false;
  }

  /* Target the monster (MDESC_CAPITAL: the race name stands in). */
  if (!(mode & TARGET.QUIET)) {
    const name = mon!.race.name;
    state.msg?.(
      `${name.charAt(0).toUpperCase()}${name.slice(1)} is targeted.`,
    );
  }

  /* monster_race_track rides lore; health_track is the healthWho field. */
  state.healthWho = mon;
  targetSetMonster(state, mon);
  return true;
}
