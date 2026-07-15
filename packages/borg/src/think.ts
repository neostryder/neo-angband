/**
 * The decision entry point: borg_think_dungeon (reference/src/borg/
 * borg-think-dungeon.c). Upstream this is a long, priority-ordered ladder -
 * light, caution, recovery, attack, gather, flow, explore - where the first
 * applicable action wins. P8.6 ports that full ladder; each earlier subsystem
 * (flow P8.1, danger P8.2, power P8.3, fight P8.4, items P8.5) contributes a
 * stage the ladder calls in order.
 *
 * FOUNDATION STUB. Until the real ladder lands, `think` implements a minimal but
 * genuinely useful policy so the mod drives a real game end-to-end and every
 * seam (perceive -> world model -> act) is exercised: melee an adjacent visible
 * monster, otherwise step toward the nearest tracked monster, otherwise hold.
 * This is explicitly NOT the faithful decision logic - it is the socket the
 * ported ladder plugs into. The signature is stable; P8.6 replaces the body.
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "./context";

/** Keypad direction (1-9, 5 = center) from a signed (dx, dy) step. */
export function keypadDir(dx: number, dy: number): number {
  return (1 - Math.sign(dy)) * 3 + (Math.sign(dx) + 2);
}

/** Chebyshev distance (king moves), the Borg's grid distance metric. */
export function distance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Decide the next command for this think, or null to yield to a human.
 * (Foundation stub - see the file header.)
 */
export function think(ctx: BorgContext): AgentCommand | null {
  const { world, view, act } = ctx;
  const p = view.player();
  if (p.dead) return null;

  const px = p.grid.x;
  const py = p.grid.y;

  // 1. Melee an adjacent tracked monster.
  let nearest: { x: number; y: number; d: number } | null = null;
  for (const [, k] of world.kills.entries()) {
    const d = distance(px, py, k.pos.x, k.pos.y);
    if (d === 0) continue;
    if (d === 1) {
      return act.melee(keypadDir(k.pos.x - px, k.pos.y - py));
    }
    if (!nearest || d < nearest.d) {
      nearest = { x: k.pos.x, y: k.pos.y, d };
    }
  }

  // 2. Step toward the nearest tracked monster (single-step greedy; real
  //    pathfinding is borg_flow, P8.1).
  if (nearest) {
    const dx = Math.sign(nearest.x - px);
    const dy = Math.sign(nearest.y - py);
    if (dx !== 0 || dy !== 0) return act.move(keypadDir(dx, dy));
  }

  // 3. Nothing to do: hold (the ladder's explore stages arrive in P8.6).
  return act.hold();
}
