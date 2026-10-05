/** Emit resolved facts without retaining game objects in event payloads. */
import type { CombatOutcomeEventData, DungeonLevelEventData, MotionEventData, PerceivedActor } from "../events.js";
import type { Loc } from "../loc.js";
import type { Monster } from "../mon/monster.js";
import { squareIsView } from "../world/view.js";
import { assignedMonsterId, knownMonsterId, monsterIsKnown } from "../agent/known-world.js";
import type { GameState } from "./context.js";

/* A monster by its record or its index. A sender that may have deleted the
 * monster already passes the record, which keeps its flags after deletion. */
type Who = "player" | number | Monster;

function rawWho(who: Who): "player" | number {
  return typeof who === "object" ? who.midx : who;
}

function perceived(state: GameState, who: Who, observable = true): PerceivedActor {
  if (who === "player") return "player";
  const mon = typeof who === "number" ? (state.monsters[who] ?? null) : who;
  if (!mon || !monsterIsKnown(state, mon)) return "unseen";
  const id = observable ? knownMonsterId(state, mon) : assignedMonsterId(state, mon);
  return id === undefined ? "unseen" : { monster: id };
}

function point(grid: Loc): Loc {
  return { x: grid.x, y: grid.y };
}

const motionOrigins = new WeakMap<Monster, { grid: Loc; seen: boolean }>();

/** The destination's perception cannot establish what the player knew before the move. */
export function rememberMotionOrigin(state: GameState, mon: Monster): void {
  motionOrigins.set(mon, { grid: point(mon.grid), seen: monsterIsKnown(state, mon) && squareIsView(state.chunk, mon.grid) });
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
  const seen = squareIsView(state.chunk, grid);
  const targetMon = typeof target === "number" ? state.monsters[target] : typeof target === "object" ? target : null;
  const observable = target === "player" || (seen && !!targetMon && monsterIsKnown(state, targetMon));
  state.events.emit("combat-outcome", {
    attacker: attacker === null ? null : rawWho(attacker),
    target: rawWho(target),
    perceivedAttacker: attacker === null ? null : perceived(state, attacker, observable),
    perceivedTarget: perceived(state, target, observable),
    kind, hit, damage, died,
    grid: point(grid), seen,
  });
}

export function emitHeal(state: GameState, who: Who, amount: number, grid: Loc): void {
  if (!state.events || amount <= 0) return;
  const seen = squareIsView(state.chunk, grid);
  state.events.emit("heal", {
    who: rawWho(who), perceivedWho: perceived(state, who, seen),
    amount, grid: point(grid), seen,
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
  const mon = typeof who === "number" ? state.monsters[who] : typeof who === "object" ? who : null;
  const origin = mon ? motionOrigins.get(mon) : undefined;
  if (mon) motionOrigins.delete(mon);
  const seen = squareIsView(state.chunk, to);
  state.events.emit("motion", {
    who: rawWho(who), perceivedWho: perceived(state, who, seen),
    from: point(from), to: point(to), kind,
    seen,
    fromSeen: who === "player" || (origin?.seen === true && origin.grid.x === from.x && origin.grid.y === from.y),
  });
}

/**
 * EVENT_NEW_LEVEL_DISPLAY (game-world.c:1031), sent to the bus as `dungeonlevel`
 * once the arrival's level, position and view are in place. A level change sends
 * it from the level changer; the host sends the session's first one through
 * StartedGame.announceArrival once its listeners are attached.
 *
 * A listener that throws goes to state.onEventFault and the arrival carries on:
 * the feeling, the search, and the host's autosave and redraw after the change
 * all still run, as player-command's sender does for the command.
 */
export function emitDungeonLevel(state: GameState, cause: DungeonLevelEventData["cause"]): void {
  if (!state.events) return;
  try {
    state.events.emit("dungeonlevel", {
      depth: state.chunk.depth,
      levelId: state.levelSerial ?? 0,
      cause,
      arena: state.arenaLevel === true,
    });
  } catch (error) {
    state.onEventFault?.("dungeonlevel", error);
  }
}
