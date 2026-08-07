/**
 * Game-layer object naming: the bridge from a live GameState to the pure
 * object_desc engine (obj/desc.ts). It supplies the player, the rune registry
 * (state.runeEnv) and the flavour-awareness view (state.isAware / a tried
 * seam), so presentation code can name an object with a single call that gates
 * exactly by the player's real knowledge, as upstream does.
 */

import { ODESC, objectDesc } from "../obj/desc.js";
import type { ObjectKnownView } from "../obj/ignore.js";
import type { KnownDesc } from "../obj/known-object.js";
import { objectFullyKnown, objectKnownShadow } from "../obj/known-object.js";
import type { GameObject } from "../obj/object.js";
import type { GameState } from "./context.js";

/** Build the flavour-awareness view object_desc needs from the game state. */
export function knownDescOf(state: GameState): KnownDesc {
  return {
    isAware: (kind) => (state.isAware ? state.isAware(kind) : false),
    /* object_flavor_was_tried (obj-knowledge.c:2257), the "{tried}" marker at
     * obj-desc.c:527. This used to be a hardcoded `false` saying the port had
     * no live tried seam. It has had one all along: FlavorKnowledge.setTried
     * is called on every device use (obj-cmd.ts:1444, knowledge.ts:623) and
     * the set is saved and restored - only this read was missing, so an
     * unidentified wand you had already zapped looked identical to one you
     * had never touched (PORT_TODO 3.27). */
    isTried: (kind) => state.flavorKnown?.wasTried(kind) ?? false,
    /* OPT(p, show_flavors) (obj-desc.c L89): once aware, keep the flavour only
     * when the option is on. Reads the wired option store; absent (worldless
     * tests), it reports true so the prior seam-absent behaviour is preserved. */
    showFlavors: () => state.options?.get("show_flavors") ?? true,
    /* The per-game flavour assignment (flavor_init), installed by wireGame.
     * Absent seams leave object_desc on its tval-only fallback. */
    ...(state.hasFlavor ? { hasFlavor: state.hasFlavor } : {}),
    ...(state.flavorText ? { flavorText: state.flavorText } : {}),
    /* ignore_item_ok(p, obj) (obj-desc.c:536-538), the "{ignore}" marker. The
     * predicate has been ported and in use since obj/ignore.ts:380 - the game
     * calls it as state.isIgnored on the pickup, running and projection paths
     * - and object_desc's own slot for it was simply never filled, so an item
     * the player had told the game to ignore said nothing about it in the
     * inventory (PORT_TODO 3.27). */
    ...(state.isIgnored ? { ignoreItemOk: state.isIgnored } : {}),
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
 * `obj->known` plus object_fully_known(obj) for a live object: the knowledge
 * view obj/ignore.ts reads. Upstream both are one pointer dereference off the
 * object; here the twin is synthesised on demand, so this is where that happens
 * for the ignore path.
 *
 * One shadow per call, as at every other synthesis site (obj/desc.ts:639,
 * game/equip-cmp.ts:422, game/ui-entry.ts:2035) - objectKnownShadow is pure and
 * allocation-only, and caching it would need an invalidation rule keyed on
 * every rune-learn and assessment, which is a bigger surface than the copy.
 */
export function objectKnownView(state: GameState, obj: GameObject): ObjectKnownView {
  const p = state.actor.player;
  const known = objectKnownShadow(obj, p, state.runeEnv, knownDescOf(state));
  return { known, fullyKnown: objectFullyKnown(obj, known, p, state.runeEnv) };
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
