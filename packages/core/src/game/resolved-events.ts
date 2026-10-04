/** Emit resolved facts without retaining game objects in event payloads. */
import type { CombatOutcomeEventData, DungeonLevelEventData, MotionEventData, PerceivedActor } from "../events.js";
import type { Loc } from "../loc.js";
import type { Monster } from "../mon/monster.js";
import { squareIsView } from "../world/view.js";
import { knownMonsterId, monsterIsKnown } from "../agent/known-world.js";
import type { GameState } from "./context.js";

/* A monster by its record or its index. A sender that may have deleted the
 * monster already passes the record, which keeps its flags after deletion. */
type Who = "player" | number | Monster;

function rawWho(who: Who): "player" | number {
  return typeof who === "object" ? who.midx : who;
}

function perceived(state: GameState, who: Who): PerceivedActor {
  if (who === "player") return "player";
  const mon = typeof who === "number" ? (state.monsters[who] ?? null) : who;
  if (!mon || !monsterIsKnown(state, mon)) return "unseen";
  return { monster: knownMonsterId(state, mon) };
}

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
    attacker: attacker === null ? null : rawWho(attacker),
    target: rawWho(target),
    perceivedAttacker: attacker === null ? null : perceived(state, attacker),
    perceivedTarget: perceived(state, target),
    kind, hit, damage, died,
    grid: point(grid), seen: squareIsView(state.chunk, grid),
  });
}

export function emitHeal(state: GameState, who: Who, amount: number, grid: Loc): void {
  if (!state.events || amount <= 0) return;
  state.events.emit("heal", {
    who: rawWho(who), perceivedWho: perceived(state, who),
    amount, grid: point(grid), seen: squareIsView(state.chunk, grid),
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
    who: rawWho(who), perceivedWho: perceived(state, who),
    from: point(from), to: point(to), kind,
    seen: squareIsView(state.chunk, to),
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
