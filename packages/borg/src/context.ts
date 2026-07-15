/**
 * The decision context handed to every Borg subsystem. Bundling the world
 * model, the perceive/act facades, and the Borg's private RNG into one object
 * lets the ported subsystems (flow, danger, power, fight, think) share state the
 * same way the C borg's file-scope globals did, without actual globals.
 */

import type { AgentView, AgentActions, Rng } from "@neo-angband/core";
import type { BorgWorld } from "./world/model";

/** Everything a decision subsystem needs, for one think. */
export interface BorgContext {
  /** The Borg's remembered world (written by perceive, read by everyone). */
  world: BorgWorld;
  /** PERCEIVE: the frozen read facade (raw current view). */
  view: AgentView;
  /** ACT: the frozen command builders. */
  act: AgentActions;
  /** The Borg's private simulation RNG (never the game RNG). */
  rng: Rng;
}
