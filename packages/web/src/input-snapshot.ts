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
import type { AgentCapabilities, AgentViewDeps, GameState, KnownLevelView, AgentView } from "@rpgm-tools/neo-angband-core";
import { REST_ALL_POINTS, REST_COMPLETE, REST_SOME_POINTS } from "@rpgm-tools/neo-angband-core";
import { snapshotWorldFrame } from "./world-view";
import type { WorldFrame } from "./world-view";
import type { PromptDescriptor } from "./prompt-view";
import type { InteractionPhase, InputDriver, InputSnapshot, ModInspect, RestMode } from "@rpgm-tools/neo-angband-core";
export type { InteractionPhase, InputDriver, InputSnapshot, ModInspect, RestMode } from "@rpgm-tools/neo-angband-core";

/** The capability for the host-side parts of a snapshot. */
export const INTERACTION_READ_CAPABILITY = "state:interaction.read";
const MAP_READ_CAPABILITY = "state:map.read";
const ANY_READ_CAPABILITY = "state:*.read";

export function frozenDriver(driver: InputDriver): InputDriver {
  return Object.freeze({ ...driver });
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
  messages?(): readonly Readonly<{ text: string; count: number; color?: string }>[];
  storeStatus?(): Omit<NonNullable<InputSnapshot["storeStatus"]>, "token"> | null;
  characterKey?(): string | null;
  characterSheet?(): import("./charsheet").CharacterSheetData | null;
  activeBlast?(): { readonly radius: number; readonly arc?: number; readonly element: string; readonly wallsStop: boolean } | null;
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
  const view = createAgentView(state, undefined, { ...source.viewDeps(), perceivedMonstersOnly: true }, caps);
  const core = view.capture!();
  const interaction = grants(caps, INTERACTION_READ_CAPABILITY);
  const live = grants(caps, MAP_READ_CAPABILITY) ? source.frame() : null;
  return Object.freeze({
    token: core.token,
    driver: frozenDriver(source.driver?.() ?? { kind: "player" }),
    phase: interaction ? source.phase() : null,
    messagePending: interaction ? source.messagePending() : null,
    resting: interaction ? restingView(state.resting) : null,
    messages: grants(caps, "state:messages.read") && source.messages
      ? (() => {
        const log = source.messages!().map((m) => Object.freeze({
          text: m.text,
          count: m.count,
          ...(m.color === undefined ? {} : { color: m.color }),
        }));
        return Object.freeze({
          token: core.token,
          entries: Object.freeze(log.map((m) => m.text)),
          log: Object.freeze(log),
        });
      })() : null,
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

export function buildInspect(
  source: InputSnapshotSource,
  caps: AgentCapabilities | undefined,
): ModInspect {
  const view = (): AgentView | null => {
    const state = source.state();
    if (!state) return null;
    return createAgentView(state, undefined, { ...source.viewDeps(), perceivedMonstersOnly: true }, caps);
  };
  return Object.freeze({
    inspectItem: (ref) => view()?.inspectItem?.(ref) ?? null,
    bookForItem: (handle) => view()?.bookForItem?.(handle) ?? null,
    compareLoadoutSlots: (ref) => view()?.compareLoadoutSlots?.(ref) ?? null,
    monsterRecall: (raceIndex) => view()?.monsterRecall?.(raceIndex) ?? null,
    spellInfo: (spellIndex) => view()?.spellInfo?.(spellIndex) ?? null,
    itemTester: (code) => view()?.itemTester?.(code) ?? null,
    projectionPath: (to) => view()?.projectionPath?.(to) ?? null,
    blastArea: (to, radius, arc) => view()?.blastArea?.(to, radius, arc) ?? null,
    travelPath: (to) => view()?.travelPath?.(to) ?? null,
    tileActions: (to) => view()?.tileActions?.(to) ?? null,
    itemRules: () => view()?.itemRules?.() ?? null,
    terrainCatalogue: () => view()?.terrainCatalogue?.() ?? null,
  } satisfies ModInspect);
}

const SPECIAL_REST_MODES: ReadonlyMap<number, RestMode> = new Map([
  [REST_COMPLETE, "complete"],
  [REST_ALL_POINTS, "all-points"],
  [REST_SOME_POINTS, "some-points"],
]);

function restingView(resting: { count: number; turnsRested: number } | undefined): InputSnapshot["resting"] {
  if (!resting) {
    return Object.freeze({ active: false, mode: null, turnsRequested: null, turnsRemaining: null, turnsRested: null });
  }
  const special = SPECIAL_REST_MODES.get(resting.count);
  const timed = special === undefined && resting.count > 0;
  return Object.freeze({
    active: true,
    mode: special ?? (timed ? "turns" : null),
    /* One state.resting record lives for the whole timed rest, so the turns
     * already rested plus the turns left is the length the rest was given. */
    turnsRequested: timed ? resting.turnsRested + resting.count : null,
    turnsRemaining: timed ? resting.count : null,
    turnsRested: resting.turnsRested,
  });
}
