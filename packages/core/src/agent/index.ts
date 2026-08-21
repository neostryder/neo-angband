/**
 * @rpgm-tools/neo-angband-core agent API (P7 phase 7): the frozen perceive/act/controller
 * facade every agent mod - the bundled Borg (P8) first, third-party and AI
 * agents after - drives the game through, with no privileged core access.
 *
 * See BORG_AS_MOD.md sections 3 and 5 for the contract this realizes. FROZEN at
 * AGENT_API_VERSION 1.0.0 (ratified 2026-07-14, the P7 -> P8 gate); add-only
 * from here (see types.ts freeze note).
 */

export { AGENT_API_VERSION, AGENT_STATE_DOMAINS } from "./types.js";
export type {
  AgentCapabilities,
  AgentCommand,
  AgentActions,
  AgentGlyphSource,
  AgentController,
  AgentSession,
  AgentView,
  AgentViewDeps,
  CellView,
  ControllerOptions,
  ItemView,
  LoadoutChange,
  LoadoutItemRef,
  LoadoutPlacement,
  LoadoutSimulation,
  LoadoutView,
  MonsterView,
  PlayerStatusView,
  PlayerView,
  SpellbookView,
  SpellView,
  StoreItemView,
  StoreView,
  TargetView,
} from "./types.js";
export { createAgentView } from "./perceive.js";
export { itemView, playerViewFor } from "./entity-views.js";
export type { PlayerViewDerived } from "./entity-views.js";
export { simulateLoadout } from "./loadout.js";
export type { LoadoutDerive, LoadoutSimOptions } from "./loadout.js";
export { createAgentActions } from "./act.js";
export { AgentCapabilityError, installController } from "./controller.js";
export { subscribeEvents } from "./events.js";
export type { AgentEventSubscription } from "./events.js";
