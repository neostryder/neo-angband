/**
 * @neo-angband/core agent API (P7 phase 7): the frozen perceive/act/controller
 * facade every agent mod - the bundled Borg (P8) first, third-party and AI
 * agents after - drives the game through, with no privileged core access.
 *
 * See BORG_AS_MOD.md sections 3 and 5 for the contract this realizes, and
 * types.ts for the freeze-status note (CANDIDATE until a sample agent exercises
 * it and the maintainer ratifies the surface).
 */

export { AGENT_API_VERSION } from "./types";
export type {
  AgentCapabilities,
  AgentCommand,
  AgentActions,
  AgentController,
  AgentSession,
  AgentView,
  CellView,
  ControllerOptions,
  ItemView,
  MonsterView,
  PlayerStatusView,
  PlayerView,
  TargetView,
} from "./types";
export { createAgentView } from "./perceive";
export { createAgentActions } from "./act";
export { AgentCapabilityError, installController } from "./controller";
