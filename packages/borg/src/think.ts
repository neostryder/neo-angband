/**
 * The decision entry point: a faithful port of borg_think's dungeon/store
 * dispatch (reference/src/borg/borg-think.c:321-466) feeding the priority-
 * ordered ladder borg_think_dungeon (borg-think-dungeon.c, ported in
 * think-ladder.ts).
 *
 * borg_think itself does: detect being in a shop -> borg_think_store; otherwise
 * advance the clock, borg_notice + borg_update (perception), borg_power, then
 * borg_think_dungeon. In this port the clock/notice/perceive/power steps are the
 * controller's job (controller.ts, so they run exactly once per decision and
 * before either branch); think() below performs the store-vs-dungeon dispatch
 * and primes the wiring session, then runs the chosen ladder. The first ladder
 * stage that yields a command wins; null means "yield to a human".
 *
 * keypadDir / distance stay exported here (the geometry the world model and the
 * flow/perception ports share).
 */

import type { AgentCommand } from "@neo-angband/core";
import type { BorgContext } from "./context";
import {
  getThinkSession,
  primeSession,
  buildStoreDeps,
} from "./think-session";
import { borgThinkStore } from "./store";
import { borgThinkDungeon } from "./think-ladder";

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
 *
 * Assumes the controller has already advanced the clock and run
 * perceive/borgNotice/borgPower for this view (borg-think.c ordering).
 */
export function think(ctx: BorgContext): AgentCommand | null {
  const p = ctx.view.player();
  if (p.dead) return null;

  const session = getThinkSession(ctx.world);
  primeSession(session, ctx);

  /* Store dispatch (borg-think.c:324): a host-supplied signal reports which
   * shop the borg stands in (default: never in a shop). */
  const shopNum = session.resolvers.inShop?.(ctx) ?? null;
  if (shopNum !== null && shopNum >= 0) {
    ctx.world.self.inShop = true;
    return borgThinkStore(ctx, shopNum, buildStoreDeps(session));
  }
  ctx.world.self.inShop = false;

  /* Dungeon / town ladder (borg-think.c:466). */
  return borgThinkDungeon(ctx, session);
}
