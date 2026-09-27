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
 * the message pause and the open prompt, and `state:map.read` for the
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
  KnownLevelView,
  AgentView,
  BlastAreaResult,
  BookItemResult,
  GridInspectResult,
  InspectResult,
  ItemTesterResult,
  ItemRulesResult,
  LoadoutSlotsResult,
  LoadoutItemRef,
  TileActionsResult,
  TravelPathResult,
  SpellInspectResult,
} from "@rpgm-tools/neo-angband-core";
import { snapshotWorldFrame } from "./world-view";
import type { WorldFrame } from "./world-view";
import type { PromptDescriptor } from "./prompt-view";

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

export type InputDriver =
  | { readonly kind: "player" }
  | { readonly kind: "controller"; readonly owner: string; readonly label?: string; readonly reason?: string };

export function frozenDriver(driver: InputDriver): InputDriver {
  return Object.freeze({ ...driver });
}

export interface InputSnapshot {
  /** The core token; the same value `core.token` carries. */
  readonly token: InputToken;
  /** The host's current keyboard owner, independent of read capabilities. */
  readonly driver: InputDriver;
  /** Null when `state:interaction.read` is not granted. */
  readonly phase: InteractionPhase | null;
  /** Whether a "-more-" pause holds input. Null without `state:interaction.read`. */
  readonly messagePending: boolean | null;
  /** The live player_resting count; null without interaction read access. */
  readonly resting: Readonly<{ active: boolean; mode: number | null; turnsRemaining: number | null }> | null;
  /** Message history without consuming the agent's per-decision stream. */
  readonly messages: Readonly<{ token: InputToken; entries: readonly string[] }> | null;
  readonly storeStatus: Readonly<{ token: InputToken; feat: number; ready: boolean; noSelling: boolean; inventory: readonly Readonly<{ handle: number; eligible: boolean; price: number | null }>[] }> | null;
  readonly activeBlast: Readonly<{ token: InputToken; radius: number; element: string; wallsStop: boolean }> | null;
  /** The open question, or null without `state:interaction.read`. */
  readonly prompt: PromptDescriptor | null;
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
  driver?(): InputDriver;
  /** The view deps the host builds its own agent views with. */
  viewDeps(): AgentViewDeps;
  phase(): InteractionPhase;
  messagePending(): boolean;
  messages?(): readonly string[];
  storeStatus?(): Omit<NonNullable<InputSnapshot["storeStatus"]>, "token"> | null;
  characterKey?(): string | null;
  activeBlast?(): { readonly radius: number; readonly element: string; readonly wallsStop: boolean } | null;
  prompt(): PromptDescriptor | null;
  /** The last produced frame, live; this module copies it. */
  frame(): WorldFrame | null;
  /** Read the whole known level independently of the small snapshot. */
  knownLevel(caps: AgentCapabilities | undefined): KnownLevelView | null;
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
    driver: frozenDriver(source.driver?.() ?? { kind: "player" }),
    phase: interaction ? source.phase() : null,
    messagePending: interaction ? source.messagePending() : null,
    resting: interaction ? Object.freeze({ active: !!state.resting,
      mode: state.resting?.count ?? null,
      turnsRemaining: state.resting && state.resting.count > 0 ? state.resting.count : null }) : null,
    messages: grants(caps, "state:messages.read") && source.messages
      ? Object.freeze({ token: core.token, entries: Object.freeze([...source.messages()]) }) : null,
    storeStatus: grants(caps, "state:stores.read") && grants(caps, "state:inventory.read")
      && source.storeStatus ? (() => {
        const status = source.storeStatus!();
        return status ? Object.freeze({ ...status, token: core.token,
          inventory: Object.freeze(status.inventory.map((entry) => Object.freeze({ ...entry }))) }) : null;
      })() : null,
    activeBlast: interaction && grants(caps, MAP_READ_CAPABILITY) && source.activeBlast
      ? (() => { const blast = source.activeBlast!();
        return blast ? Object.freeze({ ...blast, token: core.token }) : null; })() : null,
    prompt: interaction ? source.prompt() : null,
    core,
    frame: live ? snapshotWorldFrame(live) : null,
  });
}

/** Read the bulk map with the same capability set as the core capture. */
export function buildKnownLevel(
  source: InputSnapshotSource,
  caps: AgentCapabilities | undefined,
): KnownLevelView | null {
  if (!source.state() || !grants(caps, MAP_READ_CAPABILITY)) return null;
  return source.knownLevel(caps);
}

/** Inspection methods from a view built for the calling mod. */
export interface ModInspect {
  inspectItem(ref: number | { floor: { x: number; y: number; index: number } } | { store: number; index: number }): InspectResult | null;
  bookForItem(handle: number): BookItemResult | null;
  compareLoadoutSlots(ref: Exclude<LoadoutItemRef, { from: "object" }>): LoadoutSlotsResult | null;
  monsterRecall(raceIndex: number): InspectResult | null;
  spellInfo(spellIndex: number): SpellInspectResult | null;
  itemTester(code: string): ItemTesterResult | null;
  projectionPath(to: { x: number; y: number }): GridInspectResult | null;
  blastArea(to: { x: number; y: number }, radius: number): BlastAreaResult | null;
  travelPath(to: { x: number; y: number }): TravelPathResult | null;
  tileActions(to: { x: number; y: number }): TileActionsResult | null;
  itemRules(): ItemRulesResult | null;
}

export function buildInspect(
  source: InputSnapshotSource,
  caps: AgentCapabilities | undefined,
): ModInspect {
  const view = (): AgentView | null => {
    const state = source.state();
    if (!state) return null;
    return createAgentView(state, undefined, source.viewDeps(), caps);
  };
  return Object.freeze({
    inspectItem: (ref) => view()?.inspectItem?.(ref) ?? null,
    bookForItem: (handle) => view()?.bookForItem?.(handle) ?? null,
    compareLoadoutSlots: (ref) => view()?.compareLoadoutSlots?.(ref) ?? null,
    monsterRecall: (raceIndex) => view()?.monsterRecall?.(raceIndex) ?? null,
    spellInfo: (spellIndex) => view()?.spellInfo?.(spellIndex) ?? null,
    itemTester: (code) => view()?.itemTester?.(code) ?? null,
    projectionPath: (to) => view()?.projectionPath?.(to) ?? null,
    blastArea: (to, radius) => view()?.blastArea?.(to, radius) ?? null,
    travelPath: (to) => view()?.travelPath?.(to) ?? null,
    tileActions: (to) => view()?.tileActions?.(to) ?? null,
    itemRules: () => view()?.itemRules?.() ?? null,
  } satisfies ModInspect);
}
