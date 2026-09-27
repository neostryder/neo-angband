/**
 * `ctx.snapshot()`: the whole interface's view of one input wait.
 *
 * WHY THIS EXISTS. core's `AgentView.capture()` freezes what the game knows at a
 * wait, stamped with the wait's token (agent/boundary.ts). Three things a whole-
 * interface mod needs at the same moment live here in the host instead: what the
 * shell is doing (ordinary play, a shop, a modal, a "-more-" pause, or no game
 * yet), whether a message pause is holding input, and the last world frame the
 * map was painted from. This module puts the four together under one token, so
 * a presenter draws every panel from one moment and can send an action back
 * with the token it was chosen against.
 *
 * CAPABILITIES. The core parts are read through an AgentView built with the
 * mod's own capability set, so each part is null unless its
 * `state:<domain>.read` is granted, exactly as for any other read. The host
 * parts use two domains of their own: `state:interaction.read` for the phase,
 * the message pause and (later) the open prompt, and `state:map.read` for the
 * frame, the same domain that already covers map cells.
 *
 * PURE with respect to the game: nothing here writes game state, knowledge or
 * RNG. The frame is copied with `snapshotWorldFrame`, the same ownership cut the
 * front-end seam uses, so a mod that keeps a snapshot keeps no live object.
 */

import { createAgentView } from "@rpgm-tools/neo-angband-core";
import type {
  AgentCapabilities,
  AgentViewDeps,
  CoreSnapshot,
  GameState,
  InputToken,
} from "@rpgm-tools/neo-angband-core";
import { snapshotWorldFrame } from "./world-view";
import type { WorldFrame } from "./world-view";

/** The capability for the host-side parts of a snapshot. */
export const INTERACTION_READ_CAPABILITY = "state:interaction.read";
const MAP_READ_CAPABILITY = "state:map.read";
const ANY_READ_CAPABILITY = "state:*.read";

/**
 * What the shell is doing at this moment.
 *
 * - `pregame`: the title, the roster or birth; no game screen is live.
 * - `play`: the dungeon or town, waiting on an ordinary command.
 * - `store`: a shop or the Home screen.
 * - `more`: a "-more-" pause is holding input until the player dismisses it.
 * - `modal`: any other full-screen takeover (options, an item list, the target
 *   loop, a recall page).
 * - `dead`: the character has died and the death screens own the terminal.
 */
export type InteractionPhase = "pregame" | "play" | "store" | "more" | "modal" | "dead";

export interface InputSnapshot {
  /** The core token; the same value `core.token` carries. */
  readonly token: InputToken;
  /** Null when `state:interaction.read` is not granted. */
  readonly phase: InteractionPhase | null;
  /** Whether a "-more-" pause holds input. Null without `state:interaction.read`. */
  readonly messagePending: boolean | null;
  /** Reserved for the typed prompt descriptor; null until that seam lands. */
  readonly prompt: null;
  /** What the game knows at this wait (agent/boundary.ts). */
  readonly core: CoreSnapshot;
  /**
   * The last world frame the map was painted from, copied. Null before the
   * first paint, or without `state:map.read`.
   */
  readonly frame: WorldFrame | null;
}

/** What the host supplies; main.ts implements it over its own state. */
export interface InputSnapshotSource {
  /** The live game, or undefined before one exists. */
  state(): GameState | undefined;
  /** The view deps the host builds its own agent views with. */
  viewDeps(): AgentViewDeps;
  phase(): InteractionPhase;
  messagePending(): boolean;
  /** The last produced frame, live; this module copies it. */
  frame(): WorldFrame | null;
}

function grants(caps: AgentCapabilities | undefined, cap: string): boolean {
  return !caps || caps.has(cap) || caps.has(ANY_READ_CAPABILITY);
}

/**
 * Build one snapshot, or null when no game exists yet. `caps` undefined means a
 * trusted host caller with every domain granted, as in createAgentView.
 */
export function buildInputSnapshot(
  source: InputSnapshotSource,
  caps: AgentCapabilities | undefined,
): InputSnapshot | null {
  const state = source.state();
  if (!state) return null;
  const view = createAgentView(state, undefined, source.viewDeps(), caps);
  const core = view.capture!();
  const interaction = grants(caps, INTERACTION_READ_CAPABILITY);
  const live = grants(caps, MAP_READ_CAPABILITY) ? source.frame() : null;
  return Object.freeze({
    token: core.token,
    phase: interaction ? source.phase() : null,
    messagePending: interaction ? source.messagePending() : null,
    prompt: null,
    core,
    frame: live ? snapshotWorldFrame(live) : null,
  });
}
