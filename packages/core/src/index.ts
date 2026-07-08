/**
 * @neo-angband/core - the headless game engine.
 *
 * Phase 0 scaffold. The engine grows here by dependency order:
 * rng -> dice/expressions -> flags -> world kernel -> entities ->
 * effects -> game loop. See docs/PORT_PLAN.md at the repository root.
 *
 * Parity baseline: Angband 4.2.6 (see reference/ and parity/).
 */

export * from "./rng";
export * from "./loc";
export * from "./events";
export * from "./cmd";
export * from "./msg";
export * from "./color";
export * from "./bitflag";
export * from "./expression";
export * from "./dice";
export * from "./generated";
export * from "./constants";

/** Upstream release this port is verified against. */
export const PARITY_BASELINE = "4.2.6";

/** Port version, tracked independently of the baseline. */
export const ENGINE_VERSION = "0.1.0";
export * from "./world/feature";
export * from "./world/chunk";
export * from "./world/view";
export * from "./world/scatter";
export * from "./world/flow";
export * from "./effects/effect";
export * from "./effects/interpreter";
export * from "./effects/handlers";
export * from "./mon/types";
export * from "./mon/bind";
export * from "./mon/monster";
export * from "./mon/make";
export * from "./obj/types";
export * from "./obj/bind";
export * from "./obj/object";
export * from "./obj/make";
export * from "./player/types";
export * from "./player/bind";
export * from "./player/player";
export * from "./player/calcs";
export * from "./player/birth";
export * from "./save/buffer";
export * from "./save/integrity";
export * from "./gen/util";
export * from "./gen/room";
export * from "./gen/cave";
export * from "./gen/generate";
export * from "./session/boot";

// Some small derived constants and geometry helpers are defined
// independently by more than one domain (identical values/behavior).
// Re-export a single canonical copy so the barrel is unambiguous rather
// than dropping the name from two colliding `export *`s.
// - OF_SIZE/ELEM_MAX: flag-array sizes derived from the generated lists,
//   defined by both obj/types and player/types.
// - nextGrid: next_grid(grid, dir), defined by both world/view and
//   gen/util as grid + DDGRID[dir].
export { OF_SIZE, ELEM_MAX } from "./obj/types";
export { nextGrid } from "./world/view";
