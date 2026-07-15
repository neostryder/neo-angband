/**
 * Projection/targeting geometry the fight cluster needs that the danger
 * subsystem did not already export - a faithful port of the remaining pieces of
 * reference/src/borg/borg-projection.c (borg_offset_projectable,
 * borg_projectable_dark, borg_target, borg_target_unknown_wall).
 *
 * The core geometry (borg_los, borg_projectable, borg_projectable_pure,
 * borg_inc_motion, borg_distance) is reused verbatim from ../danger; only the
 * fight-specific helpers live here (per the P8.4 file-discipline rule: nothing
 * is added under danger/).
 */

import type { BorgContext } from "../context";
import { FEAT, borgCaveFloorGrid } from "../flow/flow-consts";
import { borgIncMotion } from "../danger";

/** z_info->max_range (20 in 4.2.6); read from the frozen constants when set. */
function maxRange(ctx: BorgContext): number {
  return ctx.view.constants().maxRange ?? 20;
}

/** Feature at a grid on the Borg's remembered map, or FEAT.NONE out of bounds. */
function featAt(ctx: BorgContext, y: number, x: number): number {
  if (!ctx.world.map.inBounds(x, y)) return FEAT.NONE;
  return ctx.world.map.at(x, y).feat;
}

/** kill index at a grid (0 for none / out of bounds). */
function killAt(ctx: BorgContext, y: number, x: number): number {
  if (!ctx.world.map.inBounds(x, y)) return 0;
  return ctx.world.map.at(x, y).kill;
}

/**
 * borg_offset_projectable (borg-projection.c:326): like projectable_pure but
 * treats every unknown grid AND rubble as an obstruction (used for the
 * offset-ball / vampire-strike targeting where we cannot afford surprises).
 */
export function borgOffsetProjectable(
  ctx: BorgContext,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
): boolean {
  let y = y1;
  let x = x1;
  const max = maxRange(ctx);
  for (let dist = 0; dist <= max; dist++) {
    const feat = featAt(ctx, y, x);
    /* Assume all unknown grids are walls. */
    if (dist && feat === FEAT.NONE) break;
    /* Never pass through rubble. */
    if (feat === FEAT.PASS_RUBBLE) break;
    /* Never pass through walls/doors. */
    if (dist && !borgCaveFloorGrid(ctx.world.map.at(x, y))) break;
    /* Arrival. */
    if (x === x2 && y === y2) return true;
    [y, x] = borgIncMotion(y, x, y1, x1, y2, x2);
  }
  return false;
}

/**
 * borg_projectable_dark (borg-projection.c:420): assume unknown grids are
 * floors, require at least one unknown grid on the path (shooting into
 * darkness / aiming light beams). Monsters stop the projection.
 */
export function borgProjectableDark(
  ctx: BorgContext,
  y1: number,
  x1: number,
  y2: number,
  x2: number,
): boolean {
  let y = y1;
  let x = x1;
  let unknown = 0;
  const max = maxRange(ctx);
  for (let dist = 0; dist <= max; dist++) {
    const feat = featAt(ctx, y, x);
    if (dist && feat === FEAT.NONE) unknown++;
    /* Never pass through walls/doors. */
    if (dist && feat !== FEAT.NONE && !borgCaveFloorGrid(ctx.world.map.at(x, y)))
      break;
    /* Arrival with the required unknown grid. */
    if (x === x2 && y === y2 && unknown >= 1) return true;
    /* Stop at monsters. */
    if (killAt(ctx, y, x)) break;
    [y, x] = borgIncMotion(y, x, y1, x1, y2, x2);
  }
  return false;
}

/**
 * borg_target (borg-projection.c:664): aim at a location. The C walks the
 * targeting cursor with keypresses; the perceive/act contract sets the target
 * directly. When requireMonster and a tracked monster occupies the grid, the
 * monster is targeted by m_idx; otherwise a bare location target is set.
 * Returns true (the C always succeeds when the panel holds the grid).
 */
export function borgTarget(
  ctx: BorgContext,
  y: number,
  x: number,
  requireMonster = false,
): boolean {
  const ki = killAt(ctx, y, x);
  if (requireMonster && ki && ctx.world.kills.has(ki)) {
    const midx = ctx.world.kills.at(ki).mIdx;
    if (midx && ctx.act.setTargetMonster(midx)) return true;
  }
  ctx.act.setTargetLocation(x, y);
  return true;
}

/**
 * borg_target_unknown_wall (borg-projection.c:738): after a missed shot, mark
 * an unknown grid along the target path as granite so the borg stops trying the
 * blocked line. Ported faithfully including the "in a hall" heuristic that keeps
 * the guessed wall off the borg's own corridor. Mutates the remembered map.
 */
export function borgTargetUnknownWall(
  ctx: BorgContext,
  y: number,
  x: number,
): boolean {
  const map = ctx.world.map;
  const cy = ctx.world.self.c.y;
  const cx = ctx.world.self.c.x;
  const feat = (yy: number, xx: number) => featAt(ctx, yy, xx);

  let xHall = false;
  let yHall = false;

  /* check for 'in a hall' x axis (borg-projection.c:774) */
  if (
    feat(cy + 1, cx) === FEAT.FLOOR &&
    feat(cy - 1, cx) === FEAT.FLOOR &&
    (feat(cy + 2, cx) === FEAT.FLOOR || feat(cy - 2, cx) === FEAT.FLOOR) &&
    feat(cy, cx + 1) !== FEAT.FLOOR &&
    feat(cy, cx - 1) !== FEAT.FLOOR
  )
    xHall = true;

  /* check for 'in a hall' y axis (borg-projection.c:786) */
  if (
    feat(cy, cx + 1) === FEAT.FLOOR &&
    feat(cy, cx - 1) === FEAT.FLOOR &&
    (feat(cy, cx + 2) === FEAT.FLOOR || feat(cy, cx - 2) === FEAT.FLOOR) &&
    feat(cy + 1, cx) !== FEAT.FLOOR &&
    feat(cy - 1, cx) !== FEAT.FLOOR
  )
    yHall = true;

  let nx = cx;
  let ny = cy;
  /* Guard against a runaway loop (path is bounded by the map). */
  for (let guard = 0; guard < 256; guard++) {
    const ki = killAt(ctx, ny, nx);
    if (ki && ctx.world.kills.has(ki)) {
      const kill = ctx.world.kills.at(ki);
      /* GAP: RF_PASS_WALL not on the kill record; skip the ghost special-case
       * (the generic unknown-grid guess below still fires). */
      void kill;
    }

    if (
      feat(ny, nx) === FEAT.NONE &&
      (ny !== cy || !yHall) &&
      (nx !== cx || !xHall)
    ) {
      if (map.inBounds(nx, ny)) map.at(nx, ny).feat = FEAT.GRANITE;
      return true;
    }

    /* Pathway reached the target. */
    if (nx === x && ny === y) {
      const [gy, gx] = borgIncMotion(y, x, y, x, cy, cx);
      if (map.inBounds(gx, gy)) map.at(gx, gy).feat = FEAT.GRANITE;
      return true;
    }

    [ny, nx] = borgIncMotion(ny, nx, cy, cx, y, x);
  }
  return false;
}
