/**
 * The host <-> worker message protocol for the scripted-plugin sandbox
 * (MOD_INTEGRATION_PLAN.md Wave 2, W2.1).
 *
 * A scripted plugin is untrusted code. It runs in a Web Worker - no DOM, no
 * live game state, no shared memory - and communicates only through these
 * structured-clone-safe messages. The perceive facade already returns plain
 * serializable data (see core/agent/types.ts design note), which is exactly the
 * payload the host posts in; the plugin's decision crosses back as a plain
 * AgentCommand (or null to yield). That is the whole boundary: data in,
 * command out, nothing else reachable.
 *
 * Capability enforcement straddles the boundary. The host only serializes the
 * perceive domains the plugin was granted (serialize.ts, state:<domain>.read),
 * so an ungranted domain is simply absent from the snapshot. The worker runtime
 * neuters ambient globals (fetch/XMLHttpRequest/WebSocket) unless network:* is
 * granted, so a plugin cannot phone home behind the host's back. And the host
 * re-validates every command the worker returns against command:add before it
 * touches the game.
 *
 * This lives in the web host (not mod-sdk) for now because it is intrinsically
 * a browser/Worker concern; when a published external SDK lands (post-P8) the
 * worker-runtime authoring surface lifts into mod-sdk unchanged. The protocol
 * is versioned so a lifted runtime can refuse a mismatched host.
 */

import type {
  AgentCommand,
  CellView,
  GameConstants,
  ItemView,
  MonsterView,
  PlayerView,
  SpellbookView,
  StoreView,
  TargetView,
} from "@neo-angband/core";

/** Bumped on any breaking change to the message shapes below. */
export const SANDBOX_PROTOCOL_VERSION = "1.0.0";

/**
 * A capability-gated, structured-clone-safe snapshot of the perceive facade.
 * Only the domains the plugin was granted are present; an absent field means
 * the plugin lacks state:<domain>.read (or state:*.read), and the worker-side
 * view wrapper throws an AgentCapabilityError-shaped error if the plugin reads
 * it - identical to the in-process facade's behavior.
 *
 * cell()/floorItems() are parametric accessors, so their data is carried
 * sparsely: `cells` holds every grid the player currently sees or remembers
 * (an agent has no business reading truly unknown grids), and `floor` maps a
 * grid key to its objects. The worker synthesizes an unknown CellView for an
 * in-bounds grid absent from `cells`, and [] for a grid absent from `floor`.
 */
export interface ViewSnapshot {
  apiVersion: string;
  turn?: number;
  player?: PlayerView;
  monsters?: MonsterView[];
  /** In-view or remembered grids only (sparse); worker fills unknowns. */
  cells?: CellView[];
  mapBounds?: { width: number; height: number };
  inventory?: ItemView[];
  equipment?: Array<ItemView | null>;
  /** Grid key "x,y" -> floor objects, for grids that carry any. */
  floor?: Record<string, ItemView[]>;
  target?: TargetView | null;
  messages?: string[];
  stores?: StoreView[];
  spellbooks?: SpellbookView[];
  constants?: GameConstants;
}

/** A message from the host to the worker. */
export type HostToWorker =
  | {
      type: "init";
      protocolVersion: string;
      /** The plugin module URL the bootstrap dynamically imports. */
      pluginUrl: string;
      /** The exact capability strings the user granted this plugin. */
      capabilities: string[];
    }
  | { type: "decide"; seq: number; view: ViewSnapshot }
  | { type: "teardown" };

/** A message from the worker to the host. */
export type WorkerToHost =
  | { type: "ready"; protocolVersion: string; apiVersion: string }
  | { type: "command"; seq: number; command: AgentCommand | null }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "error"; phase: "init" | "decide"; message: string; stack?: string };

/**
 * Reserved command codes the worker's act facade emits for the two targeting
 * verbs (the only non-builder verbs in AgentActions). The host translates them
 * into the real target.c state actions before asking the plugin to decide
 * again, so the full act surface - including set-target - works across the
 * boundary. Kept distinct from any engine PlayerCommand code.
 */
export const TARGET_MONSTER_CODE = "sandbox:set-target-monster";
export const TARGET_LOCATION_CODE = "sandbox:set-target-location";
