/**
 * Public API of the Borg danger / threat-evaluation subsystem (P8.2), a faithful
 * port of reference/src/borg/borg-danger.c and the fear-cache updaters from
 * borg-update.c.
 *
 * Entry points:
 *  - borgDanger(ctx, y, x, turns, average, fullDamage): total danger at a grid.
 *  - borgDangerOneKill(ctx, y, x, turns, i, average, fullDamage): per-monster.
 *  - borgFearGrid / borgFearRegional: the fear-cache updaters (borg-update.c).
 *  - getDangerGlobals(world) / getFearCaches(world): the per-Borg danger state
 *    the fight/think ports set before calling borgDanger (the analog of the C
 *    file-scope globals the maneuver code toggled).
 *
 * The low-level geometry (LOS, projection, distance) and the r_info bridge
 * (MonsterFacts, the facts resolver) are exported too so callers and P8.6 can
 * wire an exact monster-race resolver without touching the damage math.
 */

export {
  borgDanger,
  borgDangerOneKill,
  borgDangerPhysical,
  borgDangerSpell,
} from "./danger";

export * from "./tables";
export * from "./facts";
export * from "./globals";
export * from "./fear";
export * from "./state";

/* Geometry helpers, excluding names that also live in the flow subsystem
 * (trait, ddx_ddd, ddy_ddd) to keep the package-root barrel conflict-free. */
export {
  distance,
  borgDistance,
  squareInBounds,
  squareInBoundsFully,
  borgCaveFloorBold,
  borgCaveFloorGrid,
  borgFeatureProtected,
  borgLos,
  borgIncMotion,
  borgProjectable,
  borgProjectablePure,
} from "./geometry";
