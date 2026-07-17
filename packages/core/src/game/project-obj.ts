/**
 * Projection effects on objects, ported from reference/src/project-obj.c
 * (Angband 4.2.6): the project_o driver over the floor pile at a grid, the
 * per-projection object handlers (elemental destruction driven by the
 * EL_INFO_HATES / EL_INFO_IGNORE bits), and inven_damage (the pack-side
 * casualty roll elemental hits on the player make).
 *
 * KILL_TRAP's chest unlock (is_locked_chest / unlock_chest), the mimic reveal
 * on object destruction (obj->mimicking_m_idx -> become_aware via
 * state.becomeAware) and the protected_obj parameter (the object that created
 * the projection, so it does not destroy itself) are ported here.
 *
 * Knowledge / ignore integration (gap 6.12, C project-obj.c L86-90, L146,
 * L537, L546-569):
 * - inven_damage's obj->known->to_h / to_d / to_a writes (L86-90, L103-104) are
 *   subsumed by the on-demand known shadow: objectKnownShadow reads the live
 *   obj->to_* gated by p->obj_k, so decrementing them here is reflected in every
 *   later describe without a separate twin write (there is no persistent twin to
 *   update, and no known twin to object_delete on destruction).
 * - inven_damage now labels the casualty with gear_to_label (L143) and project_o
 *   gates its "unaffected" / destruction / "Click!" messages on
 *   ignore_item_ok (state.isIgnored, L363-364, L546-569). square_isseen still
 *   stands in for the obj->known visibility half, matching the rest of this
 *   driver (the persistent floor twin is game/known.ts' reduced glyph memory).
 */

import type { Loc } from "../loc";
import { ELEM, PROJ } from "../generated";
import { EL_INFO_HATES, EL_INFO_IGNORE } from "../obj/types";
import type { GameObject } from "../obj/object";
import { tvalIsAmmo, tvalIsArmor, tvalIsRod, tvalIsWeapon } from "../obj/object";
import { isLockedChest, unlockChest } from "../obj/chest";
import { ODESC } from "../obj/desc";
import { squareIsSeen } from "../world/view";
import type { GameState } from "./context";
import { describeObject } from "./describe";
import { floorExcise, floorPile } from "./floor";
import type { Gear } from "./gear";
import { gearObjectForUse } from "./gear";

/**
 * gear_to_label's label alphabet (obj-gear.c L446): a-z minus the roguelike
 * cardinal-movement keys h/j/k/l, then A-Z.
 */
const GEAR_LABELS = "abcdefgimnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * gear_to_label (obj-gear.c L443), reduced to the pack items inven_damage can
 * touch (equipment is exempt, so its slot letters are never needed): a quiver
 * handle takes its slot digit (I2D, L456-460), otherwise a pack handle takes its
 * listing letter (L462-466). Upstream reads the sorted upkeep->inven[] view; the
 * port's inven[] reorder is deferred (game/gear.ts), so the raw pack ordering -
 * the port's stand-in for the listing everywhere else - supplies the index.
 * Returns "" when the handle is neither (upstream's '\0').
 */
function gearToLabel(gear: Gear, handle: number): string {
  const qi = gear.quiver?.indexOf(handle) ?? -1;
  if (qi >= 0) return String(qi);
  const pi = gear.pack.indexOf(handle);
  if (pi >= 0 && pi < GEAR_LABELS.length) return GEAR_LABELS[pi]!;
  return "";
}

/** The world seams project_o/project_f need beyond the GameState. */
export interface ProjectWorldEnv {
  msg?(text: string): void;
  /**
   * protected_obj (project-obj.c L537): the object that created the
   * projection, which must not destroy itself. Absent when the projection has
   * no object source (the common case; no live caller projects from an object
   * yet).
   */
  protectedObj?: GameObject;
}

/** VERB_AGREEMENT over an object stack. */
function verbAgree(n: number, singular: string, plural: string): string {
  return n > 1 ? plural : singular;
}

/** One handler outcome (project_object_handler_context_t's out fields). */
interface ObjHandlerResult {
  doKill: boolean;
  ignore: boolean;
  noteKill: string | null;
}

/** project_object_elemental: destruction gated by the HATES/IGNORE bits. */
function elemental(
  obj: GameObject,
  out: ObjHandlerResult,
  element: number,
  singular: string,
  plural: string,
): void {
  const info = obj.elInfo[element];
  if (info && info.flags & EL_INFO_HATES) {
    out.doKill = true;
    out.noteKill = verbAgree(obj.number, singular, plural);
    out.ignore = (info.flags & EL_INFO_IGNORE) !== 0;
  }
}

/** The object handler for one projection type (null = no object effect). */
function runObjectHandler(typ: number, obj: GameObject): ObjHandlerResult {
  const out: ObjHandlerResult = { doKill: false, ignore: false, noteKill: null };
  switch (typ) {
    case PROJ.ACID:
      elemental(obj, out, ELEM.ACID, "melts", "melt");
      break;
    case PROJ.ELEC:
      elemental(obj, out, ELEM.ELEC, "is destroyed", "are destroyed");
      break;
    case PROJ.FIRE:
      elemental(obj, out, ELEM.FIRE, "burns up", "burn up");
      break;
    case PROJ.COLD:
      elemental(obj, out, ELEM.COLD, "shatters", "shatter");
      break;
    case PROJ.SOUND:
      elemental(obj, out, ELEM.SOUND, "shatters", "shatter");
      break;
    case PROJ.SHARD:
      elemental(obj, out, ELEM.SHARD, "shatters", "shatter");
      break;
    case PROJ.ICE:
      elemental(obj, out, ELEM.ICE, "shatters", "shatter");
      break;
    case PROJ.FORCE:
      elemental(obj, out, ELEM.FORCE, "shatters", "shatter");
      break;
    case PROJ.PLASMA:
      elemental(obj, out, ELEM.FIRE, "burns up", "burn up");
      elemental(obj, out, ELEM.ELEC, "is destroyed", "are destroyed");
      break;
    case PROJ.METEOR:
      elemental(obj, out, ELEM.FIRE, "burns up", "burn up");
      elemental(obj, out, ELEM.COLD, "shatters", "shatter");
      break;
    case PROJ.MANA:
      /* Mana -- destroys everything. */
      out.doKill = true;
      out.noteKill = verbAgree(obj.number, "is destroyed", "are destroyed");
      break;
    /* KILL_TRAP's chest unlock is handled in projectObject (it mutates the
     * object and messages instead of destroying it). Every other projection
     * has no object effect, exactly as the upstream stubs. */
    default:
      break;
  }
  return out;
}

/**
 * project_o: affect every object in the pile at `grid` (PROJECT_ITEM).
 * Returns whether anything the player can see happened.
 */
export function projectObject(
  state: GameState,
  _r: number,
  grid: Loc,
  _dam: number,
  typ: number,
  env: ProjectWorldEnv = {},
): boolean {
  let obvious = false;

  /* Scan a snapshot: destruction mutates the pile. */
  for (const obj of [...floorPile(state, grid)]) {
    /* KILL_TRAP unlocks a locked chest instead of destroying it. */
    if (typ === PROJ.KILL_TRAP) {
      if (isLockedChest(obj)) {
        unlockChest(obj);
        /* project_object_handler_KILL_TRAP L363-364: obj->known &&
         * !ignore_item_ok(player, obj). The chest's known->pval reveal (L365)
         * rides the on-demand shadow; squareIsSeen stands in for obj->known. */
        if (
          squareIsSeen(state.chunk, grid) &&
          !(state.isIgnored?.(obj) ?? false)
        ) {
          env.msg?.("Click!");
          obvious = true;
        }
      }
      continue;
    }

    const { doKill: rawKill, ignore, noteKill } = runObjectHandler(typ, obj);
    /* protected_obj never destroys itself. */
    const doKill = rawKill && obj !== env.protectedObj;
    if (!doKill) continue;

    /* Upstream gates the observed effect on obj->known && !ignore_item_ok(player,
     * obj) && square_isseen (L546-547); squareIsSeen stands in for obj->known. */
    const notIgnored = !(state.isIgnored?.(obj) ?? false);
    const observed = squareIsSeen(state.chunk, grid) && notIgnored;
    if (observed) obvious = true;

    if (obj.artifact || ignore) {
      /* Artifacts and ignoring objects resist (L554-560). */
      if (observed) {
        env.msg?.(
          `The ${describeObject(state, obj, ODESC.BASE)} ${verbAgree(obj.number, "is", "are")} unaffected!`,
        );
      }
    } else if (obj.mimickingMIdx) {
      /* Reveal a mimic instead of destroying its fake item (L561-565). */
      if (obvious) {
        const mon = state.monsters[obj.mimickingMIdx];
        if (mon) state.becomeAware?.(mon);
      }
    } else {
      /* Describe the destruction if it is observed (L566-571). */
      if (observed && noteKill) {
        env.msg?.(`The ${describeObject(state, obj, ODESC.BASE)} ${noteKill}!`);
      }
      floorExcise(state, grid, obj);
    }
  }

  return obvious;
}

/**
 * inven_damage (project-obj.c L42): give every vulnerable pack item a shot
 * at destruction on an elemental hit. `cperc` is in hundredths of a percent
 * (a 1-in-10000 roll per item). Weapons and armor are damaged (to_h/to_d or
 * to_a decremented) instead of destroyed; rods quarter the chance.
 * Returns the number of items destroyed.
 */
export function invenDamage(
  state: GameState,
  typ: number,
  cperc: number,
  env: ProjectWorldEnv = {},
): number {
  if (cperc <= 0) return 0;
  const player = state.actor.player;
  const gear = state.gear;
  let killed = 0;

  /* Scan a snapshot of the pack (equipment is exempt). */
  for (const handle of [...gear.pack]) {
    const obj = gear.store.get(handle);
    if (!obj) continue;
    if (obj.artifact) continue; /* for now, skip artifacts */

    const info = obj.elInfo[typ];
    if (!info || !(info.flags & EL_INFO_HATES) || info.flags & EL_INFO_IGNORE) {
      continue;
    }

    let chance = cperc;
    let damage = false;

    if (tvalIsWeapon(obj.tval) && !tvalIsAmmo(obj.tval)) {
      if (state.rng.randint0(10000) < cperc) {
        /* obj->to_h-- / obj->to_d-- (L85, L88). The known-twin writes at L86-90
         * (gated on p->obj_k->to_h / to_d) are subsumed by the on-demand shadow,
         * which reads the live obj->to_* under the same p->obj_k gate. */
        obj.toH--;
        obj.toD--;
        damage = true;
      } else {
        continue;
      }
    } else if (tvalIsArmor(obj.tval)) {
      if (state.rng.randint0(10000) < cperc) {
        /* obj->to_a-- (L102); the L103-104 known->to_a write is likewise
         * subsumed by the on-demand shadow. */
        obj.toA--;
        damage = true;
      } else {
        continue;
      }
    } else if (tvalIsRod(obj.tval)) {
      chance = Math.trunc(chance / 4);
    }

    /* Count the casualties (a damaged stack counts whole). */
    let amt = 0;
    if (damage) {
      amt = obj.number;
    } else {
      for (let j = 0; j < obj.number; j++) {
        if (state.rng.randint0(10000) < chance) amt++;
      }
    }
    if (!amt) continue;

    const prefix =
      obj.number > 1
        ? amt === obj.number
          ? "All of y"
          : amt > 1
            ? "Some of y"
            : "One of y"
        : "Y";
    /* "%sour %s (%c) %s %s!" (L139-145): the (%c) is gear_to_label. */
    const label = gearToLabel(gear, handle);
    env.msg?.(
      `${prefix}our ${describeObject(state, obj, ODESC.BASE)} (${label}) ${amt > 1 ? "were" : "was"} ${
        damage ? "damaged" : "destroyed"
      }!`,
    );

    if (damage) continue;

    /* Destroy amt items (the detached split is discarded). */
    gearObjectForUse(gear, player, handle, amt);
    killed += amt;
  }

  return killed;
}
