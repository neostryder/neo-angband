/**
 * @neo-angband/borg - the Borg: a faithful TypeScript port of Angband 4.2.6's
 * automatic player (reference/src/borg), packaged as a bundled mod that rides
 * the frozen perceive/act agent API (core/src/agent).
 *
 * Public surface: createBorg (build a controller to install), the world model
 * and context (for subsystems and debug HUDs), the Borg RNG, and the test
 * harness. Decision subsystems (flow, danger, power, fight, think) are ported in
 * P8.1-P8.7 and wired into the think ladder.
 */

export * from "./world/grid";
export * from "./world/kill";
export * from "./world/take";
export * from "./world/model";
export * from "./rng";
export * from "./context";
export * from "./perceive";
export * from "./think";
export * from "./controller";
export * from "./harness";

/* Decision subsystems (ported P8.1+). */
export * from "./trait";
export * from "./flow";
