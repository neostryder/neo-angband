/**
 * Game-layer object naming: the bridge from a live GameState to the pure
 * object_desc engine (obj/desc.ts). It supplies the player, the rune registry
 * (state.runeEnv) and the flavour-awareness view (state.isAware / a tried
 * seam), so presentation code can name an object with a single call that gates
 * exactly by the player's real knowledge, as upstream does.
 */

import { ODESC, objectDesc } from "../obj/desc";
import type { KnownDesc } from "../obj/known-object";
import type { GameObject } from "../obj/object";
import type { GameState } from "./context";

/** Build the flavour-awareness view object_desc needs from the game state. */
export function knownDescOf(state: GameState): KnownDesc {
  return {
    isAware: (kind) => (state.isAware ? state.isAware(kind) : false),
    /* object_flavor_was_tried: only affects the in-store "{tried}" marker.
     * The port has no live tried seam on GameState yet, so it reports false;
     * ledgered in game-describe.yaml. */
    isTried: () => false,
    /* OPT(p, show_flavors) (obj-desc.c L89): once aware, keep the flavour only
     * when the option is on. Reads the wired option store; absent (worldless
     * tests), it reports true so the prior seam-absent behaviour is preserved. */
    showFlavors: () => state.options?.get("show_flavors") ?? true,
    /* The per-game flavour assignment (flavor_init), installed by wireGame.
     * Absent seams leave object_desc on its tval-only fallback. */
    ...(state.hasFlavor ? { hasFlavor: state.hasFlavor } : {}),
    ...(state.flavorText ? { flavorText: state.flavorText } : {}),
    /* kind->everseen / ego->everseen (obj-desc.c L633-637): a live describe of
     * an item whose name the player knows marks it seen for the object/ego
     * knowledge browsers. Pure Set insert, no RNG. Absent (worldless) = no-op. */
    ...(state.everseen
      ? {
          markKindSeen: (kind) => state.everseen!.markKind(kind),
          markEgoSeen: (ego) => state.everseen!.markEgo(ego),
        }
      : {}),
  };
}

/**
 * object_desc for a live object, gated by the player's knowledge. `mode`
 * defaults to the common "full name with prefix" combination
 * (ODESC_PREFIX | ODESC_FULL). Pass `altnum` with ODESC.ALTNUM to describe a
 * different stack count than obj.number (the object-list accumulation).
 */
export function describeObject(
  state: GameState,
  obj: GameObject | null,
  mode: number = ODESC.PREFIX | ODESC.FULL,
  altnum?: number,
): string {
  return objectDesc(
    obj,
    mode,
    state.actor.player,
    state.runeEnv,
    knownDescOf(state),
    altnum,
  );
}
