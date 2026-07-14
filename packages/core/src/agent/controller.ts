/**
 * The controller seam (P7.7): bind an AgentController as the game's nextCommand
 * provider. runGameLoop calls state.nextCommand() each time it needs a command
 * and returns LOOP_STATUS.INPUT when it yields null (game/loop.ts) - that is the
 * perceive -> think -> act boundary. installController wires a controller into
 * exactly that seam, hands it a perceive view and the act facade, and taps the
 * message sink so the view can report "messages since the last decision".
 *
 * Capability gating (MOD_LIFECYCLE section 4): a controller needs state:*.read
 * (perceive) and command:add (act). When a CapabilitySet is supplied and lacks
 * one, install throws an author-facing error. With no CapabilitySet (an
 * in-process trusted host, e.g. the bundled Borg before the sandbox), all are
 * granted.
 *
 * Determinism (the core-owned one-way ratchet, save-blocks.ts): a controller
 * that declares nondeterministic:true trips the ratchet once via
 * onNondeterministic - the runtime flips the save's determinism mode. A
 * deterministic controller (the procedural Borg) draws only the seeded RNG and
 * leaves the mode untouched.
 */

import type { GameState, PlayerCommand } from "../game/context";
import { createAgentView } from "./perceive";
import { createAgentActions } from "./act";
import type {
  AgentCapabilities,
  AgentController,
  AgentSession,
  ControllerOptions,
} from "./types";

/** Thrown when a controller is installed without a capability it requires. */
export class AgentCapabilityError extends Error {}

/** Capabilities every controller needs: read the whole state, drive commands. */
const REQUIRED_CAPABILITIES = ["state:*.read", "command:add"] as const;

function requireCapabilities(caps: AgentCapabilities): void {
  for (const cap of REQUIRED_CAPABILITIES) {
    if (!caps.has(cap)) {
      throw new AgentCapabilityError(
        `agent controller requires capability "${cap}" - grant it in the mod manifest`,
      );
    }
  }
}

/** A per-decision message tap: buffer messages, drain them when perceived. */
function makeMessageBuffer(): { push(text: string): void; drain(): string[] } {
  let buffer: string[] = [];
  return {
    push: (text) => {
      buffer.push(text);
    },
    drain: () => {
      const out = buffer;
      buffer = [];
      return out;
    },
  };
}

/**
 * Install `controller` as the state's command provider, returning a session with
 * the live facades and an uninstall that restores the previous provider and
 * message sink. The controller is invoked at each LOOP_STATUS.INPUT boundary.
 */
export function installController(
  state: GameState,
  controller: AgentController,
  opts: ControllerOptions = {},
): AgentSession {
  if (opts.capabilities) requireCapabilities(opts.capabilities);
  if (opts.nondeterministic) opts.onNondeterministic?.();

  const buffer = makeMessageBuffer();
  const view = createAgentView(state, buffer, opts.viewDeps);
  const act = createAgentActions(state);

  const prevNextCommand = state.nextCommand;
  const prevMsg = state.msg;

  /* Tap the message sink so the view reports messages since the last decision,
   * while still forwarding to whatever sink was installed (a shell renderer). */
  state.msg = (text: string): void => {
    buffer.push(text);
    prevMsg?.(text);
  };

  state.nextCommand = (): PlayerCommand | null => controller(view, act);

  return {
    view,
    act,
    uninstall: (): void => {
      state.nextCommand = prevNextCommand;
      if (prevMsg) state.msg = prevMsg;
      else delete state.msg;
    },
  };
}
