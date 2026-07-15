/**
 * A bundled scripted-plugin mod that drives the game from inside a Web Worker
 * sandbox (MOD_INTEGRATION_PLAN.md Wave 2, W2.1). It is the sandbox twin of the
 * in-process demo wanderer (src/agents/demo.ts): identical behavior - melee an
 * adjacent monster, else wander - but running as untrusted, capability-scoped
 * code with no access to game state beyond the serialized view it is handed.
 *
 * Its manifest grants ONLY state:player.read, state:monsters.read and
 * command:add - deliberately narrow, to prove the gate: this plugin never
 * receives the map domain, so a call to view.cell() would throw. It touches
 * only player() and monsters(), which it holds.
 *
 * Enable with ?plugin=demo-sandbox (disabled by default). The runtime import
 * MUST come first (it neuters network globals as an import side effect).
 */

import {
  definePlugin,
  runWorkerRuntime,
} from "../../src/agents/sandbox/worker-runtime";

/** Keypad direction (1-9, 5 = center) from a signed (dx, dy) step. */
function keypadDir(dx: number, dy: number): number {
  return (1 - Math.sign(dy)) * 3 + (Math.sign(dx) + 2);
}

let step = 0;
const dirs = [6, 2, 4, 8, 3, 1, 9, 7]; // cardinals then diagonals

definePlugin({
  decide(view, act) {
    const p = view.player();
    if (p.dead) return null;
    // Melee an adjacent monster (player + monsters domains are granted).
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
  },
});

runWorkerRuntime(self as unknown as Parameters<typeof runWorkerRuntime>[0]);
