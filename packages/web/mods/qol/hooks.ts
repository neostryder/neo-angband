/**
 * The `qol` mod's behaviour, as the mod's OWN code.
 *
 * Nothing in this file is compiled into core. Delete this folder and the game
 * loses auto-dig entirely - there is no `qol.autoDig` string, and no dig-on-walk
 * branch, anywhere in packages/core. That is the whole point of the mod being a
 * mod (Aaron, 2026-07-29: "the whole point of making them mods was to exclude
 * them from the core game").
 *
 * ------------------------------------------------------------------
 * ENTRY POINT CONTRACT - identical in every mod that changes behaviour
 * ------------------------------------------------------------------
 *
 *   export default function <mod>Hooks(
 *     flags: Readonly<Record<string, boolean>>,
 *   ): ModHooks;
 *
 * `flags` is the host's RESOLVED per-patch choice map: every `rules[].flag` this
 * mod declares in its manifest.json, mapped to the value the player's toggles
 * settled on (manifest `default` unless they changed it). The host calls this
 * ONCE per enabled mod, in load order, and folds the results with
 * composeModHooks (mod/hooks.ts) into the single ModHooks core holds.
 *
 * Three rules make this shape work:
 *
 *  1. THE MOD READS ITS OWN FLAGS. Core never sees a flag name. A hook is
 *     installed only if the patch that needs it is on, so a patch the player
 *     switched off is not merely inert - its hook is ABSENT, and core takes the
 *     faithful path with one undefined check.
 *  2. NEVER RETURN A FUNCTION THAT SELF-DISABLES. `walkBlockedByDiggable: () =>
 *     flags.x ? ... : null` would be wrong even though it behaves the same: an
 *     installed hook is a promise to core that something wants that point, and
 *     composeModHooks would let it shadow a later mod's handler.
 *  3. A DISABLED MOD IS NEVER CALLED AT ALL. The host does not invoke this
 *     function for a mod the player has not enabled, so returning `{}` here
 *     means "enabled, but every patch off".
 *
 * The mod is a plain ES module importing @neo-angband/core's public API - the
 * same API a third-party mod has. It uses no private path and no test hook.
 */

import type { CaveCmdDeps, ModHooks } from "@neo-angband/core";
import { movementTunnelTest, tunnelAux } from "@neo-angband/core";

export default function qolHooks(
  flags: Readonly<Record<string, boolean>>,
): ModHooks {
  const hooks: ModHooks = {};

  /*
   * "Auto-dig on walk" (qol.autoDig), ported from neostryder's Angband fork
   * (do_cmd_movement_tunnel_test / the move_player change): walking into known
   * diggable terrain you can actually dig begins one tunnel attempt instead of
   * faithful 4.2.6's no-energy bump.
   *
   * Both core primitives this needs are public, and using them rather than
   * reimplementing them is deliberate - a reimplemented dig roll would drift
   * from the tunnel command's:
   *
   *  - movementTunnelTest: known, not permanent rock, impassable, diggable, and
   *    diggable with a positive chance for the current weapon / best pack digger.
   *    RNG-FREE, which is what lets this decline for free.
   *  - tunnelAux: ONE do_cmd_tunnel_aux attempt with the real roll, messages and
   *    payouts (rubble finds, treasure). It DRAWS RNG, so it is reached only
   *    after the decision to handle the walk is final.
   *
   * Declining returns null BEFORE any draw, so a walk this mod does not handle
   * leaves the stream exactly where faithful core would - the hook's documented
   * contract, and what makes the mod safe to enable mid-character.
   *
   * Source-fork behaviour, kept exactly: dig, do NOT step onto the grid, and
   * spend a full move (energy_use = move_energy) whether the attempt succeeded
   * or not.
   */
  if (flags["qol.autoDig"] === true) {
    hooks.walkBlockedByDiggable = (state, grid, deps): number | null => {
      if (!movementTunnelTest(state, grid)) return null;
      /* deps is the live CaveCmdDeps the session built; core types it as unknown
       * so ModHooks does not drag the cave-command types into every consumer. */
      tunnelAux(state, grid, deps as CaveCmdDeps);
      return state.z.moveEnergy;
    };
  }

  return hooks;
}
