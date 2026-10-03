/** Emit resolved facts without retaining game objects in event payloads. */
import type { CombatOutcomeEventData, DungeonLevelEventData, MotionEventData } from "../events.js";
import type { Loc } from "../loc.js";
import { squareIsView } from "../world/view.js";
import type { GameState } from "./context.js";

type Who = "player" | number;

function point(grid: Loc): Loc {
  return { x: grid.x, y: grid.y };
}

export function emitCombatOutcome(
  state: GameState,
  attacker: Who | null,
  target: Who,
  kind: CombatOutcomeEventData["kind"],
  hit: boolean,
  damage: number,
  died: boolean,
  grid: Loc,
): void {
  if (!state.events) return;
  state.events.emit("combat-outcome", {
    attacker, target, kind, hit, damage, died,
    grid: point(grid), seen: squareIsView(state.chunk, grid),
  });
}

export function emitHeal(state: GameState, who: Who, amount: number, grid: Loc): void {
  if (!state.events || amount <= 0) return;
  state.events.emit("heal", {
    who, amount, grid: point(grid), seen: squareIsView(state.chunk, grid),
  });
}

export function emitMotion(
  state: GameState,
  who: Who,
  from: Loc,
  to: Loc,
  kind: MotionEventData["kind"],
): void {
  if (!state.events || (from.x === to.x && from.y === to.y)) return;
  state.events.emit("motion", {
    who, from: point(from), to: point(to), kind,
    seen: squareIsView(state.chunk, to),
  });
}

/**
 * EVENT_NEW_LEVEL_DISPLAY (game-world.c:1031), sent to the bus as `dungeonlevel`
 * once the arrival's level, position and view are in place. A level change sends
 * it from the level changer; the host sends the session's first one through
 * StartedGame.announceArrival once its listeners are attached.
 */
export function emitDungeonLevel(state: GameState, cause: DungeonLevelEventData["cause"]): void {
  if (!state.events) return;
  state.events.emit("dungeonlevel", {
    depth: state.chunk.depth,
    levelId: state.levelSerial ?? 0,
    cause,
    arena: state.arenaLevel === true,
  });
}
