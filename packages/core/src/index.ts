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

/** Upstream release this port is verified against. */
export const PARITY_BASELINE = "4.2.6";

/** Port version, tracked independently of the baseline. */
export const ENGINE_VERSION = "0.1.0";
