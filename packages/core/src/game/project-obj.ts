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

import type { Loc } from "../loc.js";
import { locEq } from "../loc.js";
import { ELEM, PROJ } from "../generated/index.js";
import { EL_INFO_HATES, EL_INFO_IGNORE } from "../obj/types.js";
import type { GameObject } from "../obj/object.js";
import { tvalIsAmmo, tvalIsArmor, tvalIsRod, tvalIsWeapon } from "../obj/object.js";
import { isLockedChest, unlockChest } from "../obj/chest.js";
import { ODESC } from "../obj/desc.js";
import { squareIsSeen } from "../world/view.js";
import { projectionCodeFor } from "../world/projection.js";
import type { ProjectionInfo } from "../world/projection.js";
import type { GameState } from "./context.js";
import { describeObject } from "./describe.js";
import { floorExcise, floorPile } from "./floor.js";
import { cmdDisableRepeatFloorItem } from "./repeat.js";
import { gearObjectForUse, gearToLabel } from "./gear.js";

/**
 * gear_to_label (obj-gear.c:443) lives in game/gear.ts, beside the Gear it reads.
 * Re-exported here because inven_damage's own callers import it from this module;
 * equipment is exempt from inven_damage, so the two-argument form is all it needs.
 */
export { gearToLabel };

/** The world seams project_o/project_f need beyond the GameState. */
export interface ProjectWorldEnv {
  msg?(text: string): void;
  /**
   * The bound projection table, so a `typ` can be resolved to the CODE both
   * handler registries are keyed by. Without it only the compiled-in 56
   * resolve - which is every projection core ships; a mod's projection needs
   * this to reach its own handler. `castProjection` supplies it.
   */
  projections?: readonly ProjectionInfo[];
  /**
   * The object-handler table to dispatch through, defaulting to
   * PROJECT_OBJ_HANDLERS. Supplied by wireGame from
   * `GameState.projectionHandlers`, by identity, exactly as `featHandlers` is -
   * see that field and game/projection-handlers.ts.
   */
  objHandlers?: ReadonlyMap<string, ProjectObjHandler>;
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

/** What an object handler is handed. Mirrors project_object_handler_context_t. */
export interface ProjectObjCtx {
  /** The object being affected. */
  readonly obj: GameObject;
  /** The PROJ_ value, for a handler that wants it. */
  readonly typ: number;
  /** The out fields, written in place exactly as upstream's context is. */
  readonly out: ObjHandlerResult;
}

/** One projection's effect on an object. Writes `ctx.out`; returns nothing. */
export type ProjectObjHandler = (ctx: ProjectObjCtx) => void;

/** An elemental arm: destruction gated by that element's HATES/IGNORE bits. */
const hates =
  (element: number, singular: string, plural: string): ProjectObjHandler =>
  ({ obj, out }) => {
    elemental(obj, out, element, singular, plural);
  };

/**
 * project_o's switch, as a table keyed by projection CODE.
 *
 * Same rule as PROJECT_FEAT_HANDLERS and for the same reason: a PROJ_ number is
 * an index into a compiled-in enum and a mod's projection is appended past the
 * end of it, so only the `code` is a stable name. See project-feat.ts.
 *
 * Only the 11 codes with an object effect are here. Every other projection has
 * an empty stub upstream, so absence IS the faithful answer rather than an
 * omission - and `project-obj-vectors.json` records the outcome for all 56
 * codes, so a code that quietly gained or lost an effect fails there.
 *
 * PLASMA and METEOR call two elements IN ORDER, and the order is load-bearing:
 * the second `elemental` overwrites `noteKill` when it also hits, so PLASMA on
 * an object that hates both fire and electricity reports "is destroyed", not
 * "burns up".
 */
export const PROJECT_OBJ_HANDLERS: ReadonlyMap<string, ProjectObjHandler> =
  new Map<string, ProjectObjHandler>([
    ["ACID", hates(ELEM.ACID, "melts", "melt")],
    ["ELEC", hates(ELEM.ELEC, "is destroyed", "are destroyed")],
    ["FIRE", hates(ELEM.FIRE, "burns up", "burn up")],
    ["COLD", hates(ELEM.COLD, "shatters", "shatter")],
    ["SOUND", hates(ELEM.SOUND, "shatters", "shatter")],
    ["SHARD", hates(ELEM.SHARD, "shatters", "shatter")],
    ["ICE", hates(ELEM.ICE, "shatters", "shatter")],
    ["FORCE", hates(ELEM.FORCE, "shatters", "shatter")],
    [
      "PLASMA",
      ({ obj, out }): void => {
        elemental(obj, out, ELEM.FIRE, "burns up", "burn up");
        elemental(obj, out, ELEM.ELEC, "is destroyed", "are destroyed");
      },
    ],
    [
      "METEOR",
      ({ obj, out }): void => {
        elemental(obj, out, ELEM.FIRE, "burns up", "burn up");
        elemental(obj, out, ELEM.COLD, "shatters", "shatter");
      },
    ],
    [
      "MANA",
      ({ obj, out }): void => {
        /* Mana -- destroys everything. */
        out.doKill = true;
        out.noteKill = verbAgree(obj.number, "is destroyed", "are destroyed");
      },
    ],
  ]);

/**
 * Run the object handler for one projection type.
 *
 * This was an 11-case switch until 2026-08-08. KILL_TRAP's chest unlock is NOT
 * here and never was: it mutates the object and messages instead of destroying
 * it, so projectObject handles it ahead of this dispatch. That exception is
 * asserted rather than left implicit - see project-obj-vectors.test.ts.
 *
 * Exported because it is the entry point the recorded vectors replay through,
 * and because a caller with its own table needs somewhere to pass it.
 */
export function runObjectHandler(
  typ: number,
  obj: GameObject,
  env: ProjectWorldEnv = {},
): ObjHandlerResult {
  const out: ObjHandlerResult = { doKill: false, ignore: false, noteKill: null };
  const code = projectionCodeFor(typ, env.projections);
  const handler = code === undefined ? undefined : (env.objHandlers ?? PROJECT_OBJ_HANDLERS).get(code);
  handler?.({ obj, typ, out });
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

    const { doKill: rawKill, ignore, noteKill } = runObjectHandler(typ, obj, env);
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
      /* "Prevent command repetition, if necessary" (project-obj.c:573-576):
       * gated on the destroyed object being on the PLAYER's own grid, which is
       * the only pile a remembered args.floor can index. */
      if (locEq(grid, state.actor.grid)) {
        cmdDisableRepeatFloorItem(state.actor.player);
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
