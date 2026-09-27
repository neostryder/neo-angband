/** Emit resolved facts without retaining game objects in event payloads. */
import type { CombatOutcomeEventData, MotionEventData } from "../events.js";
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
