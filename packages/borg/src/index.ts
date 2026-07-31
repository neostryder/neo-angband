/**
 * @rpgm-tools/neo-angband-borg - the Borg: a faithful TypeScript port of Angband 4.2.6's
 * automatic player (reference/src/borg), packaged as a bundled mod that rides
 * the frozen perceive/act agent API (core/src/agent).
 *
 * Public surface: createBorg (build a controller to install), the world model
 * and context (for subsystems and debug HUDs), the Borg RNG, and the test
 * harness. Decision subsystems (flow, danger, power, fight, think) are ported in
 * P8.1-P8.7 and wired into the think ladder.
 */

export * from "./world/grid.js";
export * from "./world/kill.js";
export * from "./world/take.js";
export * from "./world/model.js";
export * from "./rng.js";
export * from "./context.js";
export * from "./perceive.js";
export * from "./perceive-messages.js";
export * from "./perceive-facts.js";
export * from "./think.js";
export * from "./think-session.js";
export * from "./think-ladder.js";
export * from "./controller.js";
export * from "./activate.js";
export * from "./harness.js";

/* Decision subsystems (ported P8.1+). */
export * from "./trait/index.js";
export * from "./flow/index.js";
export * from "./danger/index.js";
export * from "./item/index.js";
export * from "./fight/index.js";
export * from "./store/index.js";

/* Host wiring: build real resolver seams from the engine's monster registry. */
export * from "./resolvers.js";
