/**
 * Serialize the live perceive facade into a ViewSnapshot for the worker
 * (MOD_INTEGRATION_PLAN.md Wave 2, W2.1).
 *
 * This is where perceive-side capability enforcement becomes real for a
 * sandboxed plugin: a domain is included ONLY if the plugin holds
 * "state:<domain>.read" (or the "state:*.read" wildcard). An ungranted domain
 * is simply absent from the snapshot - the plugin never receives that data, so
 * there is nothing to leak. This mirrors the in-process facade's per-domain
 * gate (core/agent/perceive.ts) but degrades to omission rather than throwing,
 * because the host is doing the reads on the plugin's behalf.
 *
 * The map domain covers both the cell grid and mapBounds; grids are carried
 * sparsely (only those the player sees or remembers), and floor objects ride
 * along for any grid that has them. See protocol.ts ViewSnapshot for the
 * worker-side reconstruction contract.
 */

import type { AgentCapabilities, AgentView } from "@neo-angband/core";
import { AGENT_STATE_DOMAINS } from "@neo-angband/core";
import type { ItemView, CellView } from "@neo-angband/core";
import type { ViewSnapshot } from "./protocol";

/** True if the plugin may read `domain` (specific grant or the wildcard). */
function granted(caps: AgentCapabilities, domain: string): boolean {
  return caps.has(`state:${domain}.read`) || caps.has("state:*.read");
}

/**
 * Build a capability-gated snapshot of `view`. Only granted domains are
 * present. `caps` is required here (a sandboxed plugin always carries a real
 * grant); the trusted-host "no caps" case never reaches the sandbox.
 */
export function serializeView(
  view: AgentView,
  caps: AgentCapabilities,
): ViewSnapshot {
  const D = AGENT_STATE_DOMAINS;
  const snap: ViewSnapshot = { apiVersion: view.apiVersion };

  if (granted(caps, D.turn)) snap.turn = view.turn();
  if (granted(caps, D.player)) snap.player = view.player();
  if (granted(caps, D.monsters)) snap.monsters = view.monsters();
  if (granted(caps, D.target)) snap.target = view.target();
  if (granted(caps, D.messages)) snap.messages = view.messages();
  if (granted(caps, D.stores)) snap.stores = view.stores();
  if (granted(caps, D.spells)) snap.spellbooks = view.spellbooks();
  if (granted(caps, D.constants)) snap.constants = view.constants();

  if (granted(caps, D.inventory)) {
    snap.inventory = view.inventory();
    snap.equipment = view.equipment();
  }

  // Map + floor: iterate in-bounds grids once, carrying the cells the player
  // sees or remembers (sparse) and the floor objects on any grid that has them.
  const wantMap = granted(caps, D.map);
  const wantFloor = granted(caps, D.floor);
  if (wantMap || wantFloor) {
    const bounds = view.mapBounds();
    if (wantMap) {
      snap.mapBounds = bounds;
      snap.cells = [];
    }
    if (wantFloor) snap.floor = {};
    const cells: CellView[] = snap.cells ?? [];
    const floor: Record<string, ItemView[]> = snap.floor ?? {};
    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        const cell = view.cell(x, y);
        if (!cell) continue;
        if (wantMap && (cell.known || cell.inView)) cells.push(cell);
        if (wantFloor && cell.objectCount > 0) {
          floor[`${x},${y}`] = view.floorItems(x, y);
        }
      }
    }
  }

  return snap;
}
