/**
 * A tiny in-process demo agent, used to prove the controller seam (W1.5): a
 * bundled agent can drive the real game through the frozen perceive/act facade
 * with no privileged access. The real intelligence is the Borg (P8); this only
 * melees an adjacent monster and otherwise wanders, touching only view/act.
 *
 * Enable with ?agent=demo-wanderer (disabled by default). This is the same seam
 * the Borg rides - an in-process controller before the sandbox (W2.1).
 */

import type { AgentController } from "@neo-angband/core";

/** Keypad direction (1-9, 5 = center) from a signed (dx, dy) step. */
function keypadDir(dx: number, dy: number): number {
  return (1 - Math.sign(dy)) * 3 + (Math.sign(dx) + 2);
}

/** Build the demo wanderer controller (stateful: cycles wander directions). */
export function makeDemoWanderer(): AgentController {
  let step = 0;
  const dirs = [6, 2, 4, 8, 3, 1, 9, 7]; // cardinals then diagonals
  return (view, act) => {
    const p = view.player();
    if (p.dead) return null;
    // Melee an adjacent visible monster.
    for (const m of view.monsters()) {
      const dx = m.grid.x - p.grid.x;
      const dy = m.grid.y - p.grid.y;
      if ((dx !== 0 || dy !== 0) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
        return act.melee(keypadDir(dx, dy));
      }
    }
    // Otherwise wander one step.
    const dir = dirs[step % dirs.length] ?? 5;
    step += 1;
    return act.move(dir);
  };
}

/** The bundled in-process agents, by id. */
export const DEMO_AGENTS: Record<string, () => AgentController> = {
  "demo-wanderer": makeDemoWanderer,
};
