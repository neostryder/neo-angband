/**
 * Projection effects on objects, ported from reference/src/project-obj.c
 * (Angband 4.2.6): the project_o driver over the floor pile at a grid, the
 * per-projection object handlers (elemental destruction driven by the
 * EL_INFO_HATES / EL_INFO_IGNORE bits), and inven_damage (the pack-side
 * casualty roll elemental hits on the player make).
 *
 * DEFERRED (ledgered in parity/ledger/game-project-obj.yaml):
 * - KILL_TRAP's chest unlock (is_locked_chest / unlock_chest): chests ride
 *   with obj-chest.c (#24).
 * - Mimic reveal (obj->mimicking_m_idx -> become_aware): mimics are not in
 *   the live loop yet.
 * - The protected_obj parameter (the object that created the projection);
 *   the engine's onObject hook does not thread it, and no live caller
 *   projects from an object yet.
 * - obj->known twin updates in inven_damage (display-only) and the ignore
 *   checks (ignore_item_ok, #24); gear_to_label lettering in messages.
 */

import type { Loc } from "../loc";
import { ELEM, PROJ } from "../generated";
import { EL_INFO_HATES, EL_INFO_IGNORE } from "../obj/types";
import type { GameObject } from "../obj/object";
import { tvalIsAmmo, tvalIsArmor, tvalIsRod, tvalIsWeapon } from "../obj/object";
import { squareIsSeen } from "../world/view";
import type { GameState } from "./context";
import { floorExcise, floorPile } from "./floor";
import { gearObjectForUse } from "./gear";

/** The world seams project_o/project_f need beyond the GameState. */
export interface ProjectWorldEnv {
  msg?(text: string): void;
}

/** VERB_AGREEMENT over an object stack. */
function verbAgree(n: number, singular: string, plural: string): string {
  return n > 1 ? plural : singular;
}

/** The kind's plain name (ODESC_BASE approximation until object_desc). */
function baseName(obj: GameObject): string {
  return obj.kind.name.replace(/[~&]/g, "").trim();
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
    /* KILL_TRAP's chest unlock: DEFERRED (chests, #24). Every other
     * projection has no object effect, exactly as the upstream stubs. */
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
    const { doKill, ignore, noteKill } = runObjectHandler(typ, obj);
    if (!doKill) continue;

    const seen = squareIsSeen(state.chunk, grid);
    if (seen) obvious = true;

    if (obj.artifact || ignore) {
      /* Artifacts and ignoring objects resist. */
      if (seen) {
        env.msg?.(
          `The ${baseName(obj)} ${verbAgree(obj.number, "is", "are")} unaffected!`,
        );
      }
    } else {
      /* Mimic reveal: DEFERRED (mimics not live). */
      if (seen && noteKill) {
        env.msg?.(`The ${baseName(obj)} ${noteKill}!`);
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
        obj.toH--;
        obj.toD--;
        damage = true;
      } else {
        continue;
      }
    } else if (tvalIsArmor(obj.tval)) {
      if (state.rng.randint0(10000) < cperc) {
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
    env.msg?.(
      `${prefix}our ${baseName(obj)} ${amt > 1 ? "were" : "was"} ${
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
