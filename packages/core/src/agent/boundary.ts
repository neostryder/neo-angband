/**
 * The input boundary: one token for each input wait, and one immutable capture
 * of the game as it stands at that wait.
 *
 * WHY THIS EXISTS. Every AgentView accessor is its own read. A presenter that
 * draws the player from one call, the pack from a second and the monsters from a
 * third cannot show that the three describe the same moment, and a presenter
 * that sends an action back cannot show that the action was chosen against the
 * game that will receive it. A whole-interface mod needs both: a single capture
 * it can draw from, and a token it can hand back with an action so the game can
 * refuse one aimed at a state that has since moved on.
 *
 * WHAT MOVES THE TOKEN. The revision is a counter on GameState, raised by
 * `bumpInputRevision`, and it is raised exactly where the game changes between
 * two input waits:
 *  - `runGameLoop`, when a call consumed a command or advanced the game turn. A
 *    call that returned INPUT with nothing consumed changed nothing, so a host
 *    that re-enters the loop while it waits does not age a token it gave out.
 *  - a completed level change, which the host performs after LEVEL_CHANGE and
 *    which does not pass back through the loop before the next wait.
 *  - the target setters, which change what "the target" means without a turn.
 * Anything that changes state through a queued command is covered by the first.
 *
 * THE EPOCH. The revision starts at 0 for every GameState, so a token kept
 * across a load would otherwise match the new game's first wait. Each GameState
 * gets its own epoch from a module counter the first time it is asked for one,
 * and a token only matches when both numbers do. Neither number is saved, and
 * neither touches the game RNG.
 *
 * PURE. Reading a token or taking a capture changes no game state, no knowledge
 * and no RNG stream; boundary.test.ts holds that against a serialized save, the
 * RNG state, the turn and the command queue.
 */

import type { GameState } from "../game/context.js";
import { AgentCapabilityError } from "./types.js";
import type {
  AgentView,
  ItemView,
  MonsterView,
  PlayerView,
  SpellbookView,
  StoreView,
  TargetView,
} from "./types.js";

/** Identifies one input wait of one game. Compare with `tokenIsCurrent`. */
export interface InputToken {
  readonly epoch: number;
  readonly revision: number;
}

const epochs = new WeakMap<GameState, number>();
let nextEpoch = 1;

function epochOf(state: GameState): number {
  let e = epochs.get(state);
  if (e === undefined) {
    e = nextEpoch++;
    epochs.set(state, e);
  }
  return e;
}

/** Mark that the game changed since the last input wait. */
export function bumpInputRevision(state: GameState): void {
  state.inputRevision = (state.inputRevision ?? 0) + 1;
}

/** The token for the game as it stands now. Frozen. */
export function inputToken(state: GameState): InputToken {
  return Object.freeze({
    epoch: epochOf(state),
    revision: state.inputRevision ?? 0,
  });
}

/**
 * Whether `token` names the game as it stands now. Anything that is not a token
 * of the right shape, including null, is not current.
 */
export function tokenIsCurrent(
  state: GameState,
  token: InputToken | null | undefined,
): boolean {
  if (!token || typeof token !== "object") return false;
  return (
    token.epoch === epochOf(state) &&
    token.revision === (state.inputRevision ?? 0)
  );
}

/**
 * The game at one input wait, as plain frozen data.
 *
 * Each part is what the AgentView accessor of the same name returns. A part
 * whose `state:<domain>.read` capability the caller does not hold is null
 * rather than a thrown error, so a capture is always available and never
 * carries more than the caller may read.
 *
 * The map and the message log are not here. The map is large and has its own
 * bulk read; messages() drains a per-decision buffer, so calling it from a
 * capture would change what the next decision sees.
 */
export interface CoreSnapshot {
  readonly token: InputToken;
  readonly turn: number | null;
  readonly player: PlayerView | null;
  readonly inventory: readonly ItemView[] | null;
  readonly equipment: readonly (ItemView | null)[] | null;
  readonly equipmentSlots: readonly { readonly type: string; readonly name: string }[] | null;
  readonly quiver: readonly ItemView[] | null;
  readonly floorHere: readonly ItemView[] | null;
  readonly monsters: readonly MonsterView[] | null;
  readonly target: TargetView | null;
  /** False when the target part was not readable, so null above is ambiguous. */
  readonly targetReadable: boolean;
  readonly stores: readonly StoreView[] | null;
  readonly spellbooks: readonly SpellbookView[] | null;
}

function granted<T>(read: () => T): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: read() };
  } catch (e) {
    if (e instanceof AgentCapabilityError) return { ok: false };
    throw e;
  }
}

function part<T>(read: () => T): T | null {
  const r = granted(read);
  return r.ok ? r.value : null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) {
      deepFreeze(v);
    }
  }
  return value;
}

/**
 * Capture the game through `view`'s own accessors, so every capability check
 * they make still applies. The result is a structured clone, deep-frozen: it
 * shares no object with the live game or with a previous capture.
 */
export function captureCoreSnapshot(
  state: GameState,
  view: AgentView,
): CoreSnapshot {
  const target = granted(() => view.target());
  const snap: CoreSnapshot = {
    token: inputToken(state),
    turn: part(() => view.turn()),
    player: part(() => view.player()),
    inventory: part(() => view.inventory()),
    equipment: part(() => view.equipment()),
    equipmentSlots: part(() => {
      view.equipment();
      return state.actor.player.body.slots.map(({ type, name }) => ({ type, name }));
    }),
    quiver: part(() => view.quiver!()),
    floorHere: part(() => view.floorItems(state.actor.grid.x, state.actor.grid.y)),
    monsters: part(() => view.monsters()),
    target: target.ok ? target.value : null,
    targetReadable: target.ok,
    stores: part(() => view.stores()),
    spellbooks: part(() => view.spellbooks()),
  };
  return deepFreeze(structuredClone(snap));
}
