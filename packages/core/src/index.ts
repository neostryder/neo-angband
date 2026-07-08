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

// The obj and player domains each derive the same flag-array sizes from
// the generated lists (OF_SIZE = flagSize(OF.MAX), ELEM_MAX). They are
// identical values; re-export obj/types' copies explicitly so the barrel
// has one unambiguous export rather than two colliding `export *` names.
export { OF_SIZE, ELEM_MAX } from "./obj/types";
