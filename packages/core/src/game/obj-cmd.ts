/**
 * Object commands, ported from reference/src/cmd-obj.c (Angband 4.2.6) with
 * the obj-gear.c inventory verbs they sit on: take off / wield / drop, and
 * the use family (eat, quaff, read, use staff, aim wand, zap rod, activate)
 * running each object's effect chain through the effect interpreter with a
 * player source - the same stack monster spells cast through.
 *
 * Knowledge rides on the ported FlavorKnowledge (obj/knowledge.ts):
 * unaware flavored items aim at random when they secretly need a direction,
 * single-use items learn their flavor on use, devices are marked tried.
 * The deeper known-object bookkeeping (obj->known twins, work_obj copies
 * for messaging) is knowledge/UI work (#24/#25) and is replaced by hooks.
 *
 * Inscribe/uninscribe/refill (fuel) are ported below (cmd-obj.c
 * do_cmd_inscribe/do_cmd_uninscribe/do_cmd_refill + refill_lamp,
 * obj-util.c obj_can_refill/obj_has_inscrip). Autoinscribe
 * (do_cmd_autoinscribe/apply_autoinscription) runs its guards and the
 * carried/ignored checks but is a structural no-op until the per-kind
 * note_aware/note_unaware registry and its knowledge-menu UI land (#24);
 * see ObjCmdDeps.autoNote.
 *
 * DEFERRED with their subsystems (ledgered in game-obj-cmd.yaml):
 * cast/study (player spells #22), the glyph-of-warding push_object
 * interaction (traps #21), command repetition, and the !t take-off
 * confirmation prompt (get_check, UI).
 */

import type { Constants } from "../constants";
import { EFFECT_ENTRIES, OF, TMD } from "../generated";
import { DDD } from "../loc";
import { SKILL } from "../player/types";
import { EffectBuilder } from "../effects/effect";
import type { Effect, EffectBuilderInjections } from "../effects/effect";
import { sourcePlayer } from "../effects/interpreter";
import type { EffectRegistry } from "../effects/interpreter";
import type { EffectRecordJson, ObjectKind } from "../obj/types";
import type { GameObject, StackLimits } from "../obj/object";
import {
  tvalIsEdible,
  tvalIsFuel,
  tvalIsLight,
  tvalIsPotion,
  tvalIsRod,
  tvalIsScroll,
  tvalIsStaff,
  tvalIsWand,
  tvalCanHaveTimeout,
} from "../obj/object";
import { FlavorKnowledge, NOOP_FLAVOR_AWARE_DEPS } from "../obj/knowledge";
import type { FlavorAwareDeps } from "../obj/knowledge";
import { ignoreItemOk } from "../obj/ignore";
import type { GameState, ItemTargetRef, PlayerCommand } from "./context";
import { dropNear, floorObjectForUse, floorPile } from "./floor";
import type { FloorEnv } from "./floor";
import type { TeleportEnv } from "./effect-teleport";
import {
  gearGet,
  gearObjectForUse,
  invenCarry,
  invenCarryNum,
  objectSplit,
  wieldObject,
  wieldSlot,
} from "./gear";
import { buildEffectContext } from "./effect-env";
import type { EffectEnvDeps } from "./effect-env";
import { attachGameEnv } from "./effect-game-env";
import { describeObject } from "./describe";
import type { CastContext } from "./project-cast";
import type { ActionRegistry } from "./player-turn";
import { targetFix, targetGet, targetOkay, targetRelease } from "./target";

/** enum use (cmd-obj.c). */
export const USE = { TIMEOUT: 0, CHARGE: 1, SINGLE: 2 } as const;
export type UseKind = (typeof USE)[keyof typeof USE];

/** Hooks for messages and unported-subsystem gaps; all optional. */
export interface ObjCmdEnv {
  /** msg / msgt / activation_message. */
  msg?: (text: string) => void;
  /**
   * get_aim_dir: keypad 1-9, or DIR_TARGET (5) to use the player's
   * current target (game/target.ts). The prompt itself is UI (#25).
   */
  chooseDir?: () => number;
  /** get_check for the !t take-off confirmation (UI); default true. */
  confirm?: (prompt: string) => boolean;
}

/** Everything the object commands need beyond the state. */
export interface ObjCmdDeps {
  constants: Constants;
  /** The effect interpreter with the game handlers registered. */
  registry: EffectRegistry;
  /** The projection cast context (bound projections, player actor). */
  cast: CastContext;
  /** EffectEnvDeps for buildEffectContext (bound timed table, hooks). */
  envDeps: EffectEnvDeps;
  /** Per-game flavor knowledge; absent, everything counts as aware. */
  flavor?: FlavorKnowledge;
  /**
   * The ignore/notice side effects of becoming aware (object_flavor_aware
   * L2276-2279, #89), used alongside `flavor`. The in-play caller
   * (session/game.ts) supplies the real ignore-settings-backed deps; absent,
   * falls back to NOOP_FLAVOR_AWARE_DEPS (the bare aware-bit flip).
   */
  flavorDeps?: FlavorAwareDeps;
  /** Extra effect-builder injections (summon/shape names, mod bases). */
  inject?: EffectBuilderInjections;
  /** Teleport-family seams (trap predicates; wired by game/trap.ts). */
  teleport?: TeleportEnv;
  /** General-handler seams (trap access for glyphs; effect-general.ts). */
  general?: import("./effect-general").GeneralEffectEnv;
  /** Item-targeting seams (get_item, ego/curse tables; effect-item.ts). */
  item?: import("./effect-item").ItemEffectEnv;
  /** Summoning seams (summon table + live placement; effect-summon.ts). */
  summon?: import("./effect-summon").SummonEffectEnv;
  /** Floor-pile seams (isTrap for drop placement). */
  floorEnv?: FloorEnv;
  env?: ObjCmdEnv;
  /**
   * get_autoinscription (obj-ignore.c L229): the per-kind note_aware /
   * note_unaware autoinscription registry. Not modeled yet - there is no
   * knowledge-menu UI to register one (#24) - so leaving this absent makes
   * autoinscribe a structural no-op, exactly as upstream with no
   * autoinscriptions configured for any kind.
   */
  autoNote?: (kind: ObjectKind, aware: boolean) => string | null;
}

function stackLimits(constants: Constants): StackLimits {
  return {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  };
}

/* ------------------------------------------------------------------ *
 * obj-gear.c inventory verbs.
 * ------------------------------------------------------------------ */

/**
 * inven_takeoff (obj-gear.c L1033): de-equip an object back into the pack.
 * Returns whether the handle was equipped. (Upstream does not re-combine;
 * the caller runs combine_pack, which the port's pack model does lazily on
 * the next inven_carry.)
 */
export function invenTakeoff(state: GameState, handle: number): boolean {
  const player = state.actor.player;
  const slot = player.equipment.indexOf(handle);
  if (slot < 0) return false;
  player.equipment[slot] = 0;
  state.gear.pack.push(handle);
  state.updateBonuses?.(); /* PU_BONUS */
  return true;
}

/**
 * inven_wield (obj-gear.c L931): wield a pack object into its slot, taking
 * off whatever occupies it first. Returns the slot, or -1 when the object
 * cannot be worn.
 */
export function invenWield(state: GameState, handle: number): number {
  const player = state.actor.player;
  const obj = gearGet(state.gear, handle);
  if (!obj) return -1;

  const slot = wieldSlot(player.body, obj.tval, player.equipment);
  if (slot < 0 || slot >= player.body.count) return -1;

  /* If the slot is taken, replace the item in the slot. */
  const oldHandle = player.equipment[slot] ?? 0;
  if (oldHandle !== 0) invenTakeoff(state, oldHandle);

  const worn = wieldObject(state.gear, player, handle, state.runeEnv);
  state.updateBonuses?.(); /* PU_BONUS */
  return worn;
}

/**
 * inven_drop (obj-gear.c L1078): drop amt of a carried object near the
 * player (equipment is taken off first). Returns the dropped object, or
 * null when nothing was dropped.
 */
export function invenDrop(
  state: GameState,
  handle: number,
  amt: number,
  floorEnv: FloorEnv = {},
): GameObject | null {
  if (amt <= 0) return null;
  const obj = gearGet(state.gear, handle);
  if (!obj) return null;
  if (amt > obj.number) amt = obj.number;

  /* Take off equipment, don't combine. */
  if (state.actor.player.equipment.includes(handle)) {
    invenTakeoff(state, handle);
  }

  const { obj: dropped } = gearObjectForUse(
    state.gear,
    state.actor.player,
    handle,
    amt,
  );
  dropNear(state, dropped, 0, state.actor.grid, false, floorEnv);
  return dropped;
}

/* ------------------------------------------------------------------ *
 * cmd-obj.c use machinery.
 * ------------------------------------------------------------------ */

/** beam_chance (cmd-obj.c L112). */
export function beamChance(tval: number): number {
  if (tvalIsWand(tval)) return 20;
  if (tvalIsRod(tval)) return 10;
  return 0;
}

/** The difficulty level of a used object (artifact / activation / kind). */
function objectLevel(obj: GameObject): number {
  if (obj.artifact) return obj.artifact.level;
  if (obj.activation) return obj.activation.level;
  return obj.kind.level;
}

/**
 * get_use_device_chance (obj-util.c L930): failure rate out of 1000 for
 * using a device, from the device skill against the item level.
 */
export function getUseDeviceChance(state: GameState, obj: GameObject): number {
  const skill = state.actor.combat.skills[SKILL.DEVICE] ?? 0;
  const lev = objectLevel(obj);
  const x = 2 * (skill - lev) + 1;
  let fail = -370 * x;
  fail = Math.trunc(fail / (5 + Math.abs(x)));
  fail += 380;
  return fail;
}

/**
 * check_devices (cmd-obj.c L59): can the device be used this turn?
 * Returns 1 usable, 0 failed-but-retryable, -1 unusable.
 */
export function checkDevices(
  state: GameState,
  obj: GameObject,
  env: ObjCmdEnv = {},
): number {
  let action: string;
  let what: string | null = null;
  if (tvalIsRod(obj.tval)) {
    action = "zap the rod";
  } else if (tvalIsWand(obj.tval)) {
    action = "use the wand";
    what = "wand";
  } else if (tvalIsStaff(obj.tval)) {
    action = "use the staff";
    what = "staff";
  } else {
    action = "activate it";
  }

  /* Notice empty staffs / wands. */
  if (what && obj.pval <= 0) {
    env.msg?.(`The ${what} has no charges left.`);
    return -1;
  }

  const fail = getUseDeviceChance(state, obj);
  if (state.rng.randint1(1000) < fail) {
    env.msg?.(`You failed to ${action} properly.`);
    return fail < 1001 ? 0 : -1;
  }
  return 1;
}

/**
 * number_charging (obj-util.c L1020): how many rods in a stack are still
 * charging, from the average charge time.
 */
export function numberCharging(obj: GameObject): number {
  const t = obj.time;
  const chargeTime = t.base + Math.trunc((t.dice * (t.sides + 1)) / 2);
  if (chargeTime <= 0) return 0;
  if (obj.timeout <= 0) return 0;
  const num = Math.trunc((obj.timeout + chargeTime - 1) / chargeTime);
  return Math.min(num, obj.number);
}

/** obj_can_zap (obj-util.c L709): any rod in the stack not charging? */
export function objCanZap(obj: GameObject): boolean {
  return tvalCanHaveTimeout(obj.tval) && numberCharging(obj) < obj.number;
}

/* ------------------------------------------------------------------ *
 * Inscriptions and refuelling (cmd-obj.c, obj-util.c, obj-ignore.c).
 * ------------------------------------------------------------------ */

/** obj_has_inscrip (obj-util.c L841): does this object carry an inscription? */
export function objHasInscrip(obj: GameObject): boolean {
  return !!obj.note;
}

/** The equipped light source, or null when no LIGHT slot is worn. */
function equippedLight(state: GameState): GameObject | null {
  const lightSlot = state.actor.player.body.slots.findIndex(
    (s) => s.type === "LIGHT",
  );
  return lightSlot >= 0 ? state.runeEnv.slotObject(lightSlot) : null;
}

/**
 * obj_can_refill (obj-util.c L743): is `obj` a valid fuel source for the
 * currently equipped light - a flask of oil, or another TAKES_FUEL lantern
 * still holding fuel (its timeout)?
 */
export function objCanRefill(state: GameState, obj: GameObject): boolean {
  if (obj.flags.has(OF.NO_FUEL)) return false;

  const light = equippedLight(state);
  if (light && light.flags.has(OF.TAKES_FUEL)) {
    if (tvalIsFuel(obj.tval)) return true;
    if (
      tvalIsLight(obj.tval) &&
      obj.flags.has(OF.TAKES_FUEL) &&
      obj.timeout > 0
    ) {
      return true;
    }
  }
  return false;
}

/**
 * refill_lamp (cmd-obj.c L1008): add `obj`'s fuel (its timeout for a donor
 * lantern, or pval for a flask of oil) to `lamp`, capping at
 * constants.fuelLamp. A stacked donor lantern splits off one empty unit
 * (carried back if there's room, else dropped); a lone donor is emptied in
 * place. A flask is consumed entirely (one unit, from the pack or floor).
 * Recomputes the light radius (PU_TORCH) afterward.
 */
export function refillLamp(
  state: GameState,
  lamp: GameObject,
  obj: GameObject,
  opts: { handle?: number; fromFloor?: boolean },
  deps: ObjCmdDeps,
): void {
  const env = deps.env ?? {};

  lamp.timeout += obj.timeout ? obj.timeout : obj.pval;
  env.msg?.("You fuel your lamp.");
  if (lamp.timeout >= deps.constants.fuelLamp) {
    lamp.timeout = deps.constants.fuelLamp;
    env.msg?.("Your lamp is full.");
  }

  if (obj.flags.has(OF.TAKES_FUEL)) {
    /* Refilled from a lantern: empty it (splitting one off if stacked). */
    if (obj.number > 1) {
      const used = objectSplit(obj, 1);
      used.timeout = 0;
      const carried = opts.handle !== undefined && !opts.fromFloor;
      if (carried && invenCarryNum(state.gear, used, deps.constants) > 0) {
        invenCarry(state.gear, used, stackLimits(deps.constants));
      } else {
        /* Overflow / floor donor: drop_near's own breakage roll (randint0)
         * fires here exactly as upstream, even at chance=0 (a real, faithful
         * RNG draw on this rare branch only - see obj-cmd.test.ts). */
        dropNear(state, used, 0, state.actor.grid, false, deps.floorEnv);
      }
    } else {
      obj.timeout = 0;
    }
  } else {
    /* Refilled from a flask: consume one unit entirely. */
    if (opts.fromFloor) {
      floorObjectForUse(state, obj, 1);
    } else if (opts.handle !== undefined) {
      gearObjectForUse(state.gear, state.actor.player, opts.handle, 1);
    }
  }

  /* PU_TORCH: force the light-radius recalc so a just-refuelled, previously
   * spent (timeout 0) lantern stops reading as dark (player/calcs.ts). */
  state.updateBonuses?.();
}

/** Is `obj` presently carried (pack or equipped), by identity? */
function objIsCarried(state: GameState, obj: GameObject): boolean {
  for (const [handle, stored] of state.gear.store) {
    if (stored !== obj) continue;
    return (
      state.gear.pack.includes(handle) ||
      state.actor.player.equipment.includes(handle)
    );
  }
  return false;
}

/**
 * apply_autoinscription (obj-ignore.c L242): put the kind's registered
 * autoinscription on `obj`, unless it is already inscribed, not carried, or
 * ignored. Also clears a stale unaware autoinscription once the kind
 * becomes aware. Returns 1 when an inscription was applied, 0 otherwise
 * (upstream's int return, kept for parity though callers ignore it).
 *
 * runes_autoinscribe (obj-ignore.c L259, rune-based autoinscription) rides
 * the rune-knowledge system and is deferred to #24.
 */
export function applyAutoinscription(
  state: GameState,
  obj: GameObject,
  deps: ObjCmdDeps,
): number {
  const aware = deps.flavor ? deps.flavor.isAware(obj.kind) : true;
  const note = deps.autoNote?.(obj.kind, aware) ?? null;

  /* Remove an unaware inscription once aware, if it no longer applies. */
  if (aware && obj.note) {
    const unawareNote = deps.autoNote?.(obj.kind, false) ?? null;
    if (unawareNote && obj.note === unawareNote && (!note || obj.note !== note)) {
      obj.note = null;
    }
  }

  if (!note) return 0;
  if (obj.note) return 0;
  if (!objIsCarried(state, obj)) return 0;
  if (ignoreItemOk(obj, state.ignore, aware)) return 0;

  obj.note = note.length > 0 ? note : null;
  deps.env?.msg?.(`You autoinscribe ${describeObject(state, obj)}.`);
  return 1;
}

/** randcalc(obj->time, 0, RANDOMISE): the recharge time roll. */
function rollRechargeTime(state: GameState, obj: GameObject): number {
  return state.rng.randcalc(obj.time, 0, "randomise");
}

/** Build an object's effect chain from its raw records (per use). */
export function buildObjectEffectChain(
  records: readonly EffectRecordJson[],
  state: GameState,
  inject: EffectBuilderInjections = {},
): Effect | null {
  const builder = new EffectBuilder({
    ...inject,
    baseValues: {
      PLAYER_LEVEL: () => state.actor.player.lev,
      MAX_SIGHT: () => state.z.maxSight,
      DUNGEON_LEVEL: () => state.chunk.depth,
      ...inject.baseValues,
    },
  });
  for (const e of records) {
    let spec = e.eff;
    const hasType = e.type !== undefined && e.type !== "";
    if (hasType || e.radius || e.other) spec += ":" + (e.type ?? "");
    if (e.radius || e.other) spec += ":" + (e.radius ?? 0);
    if (e.other) spec += ":" + e.other;
    builder.effect(spec);
    if (e.dice) builder.dice(e.dice);
    for (const x of e.expr ?? []) builder.expr(x.name, x.base, x.expr);
  }
  return builder.build();
}

/** effect_aim over an effect name, from the generated base table. */
const EFFECT_NEEDS_AIM = new Map<string, boolean>(
  EFFECT_ENTRIES.map((e) => [e.name, e.aim]),
);

/** effect_aim over a raw record chain: any effect marked as aimed. */
export function effectRecordsNeedAim(
  records: readonly EffectRecordJson[],
): boolean {
  /* RANDOM/SELECT children share the parent walk; the flat list covers them. */
  return records.some(
    (e) => EFFECT_NEEDS_AIM.get(e.eff.split(":")[0] ?? e.eff) === true,
  );
}

/** obj_needs_aim (obj-util.c L899), on the raw effect records. */
export function objNeedsAim(
  obj: GameObject,
  deps: Pick<ObjCmdDeps, "flavor">,
): boolean {
  const aimed = effectRecordsNeedAim(obj.effect ?? []);
  const aware = deps.flavor ? deps.flavor.isAware(obj.kind) : true;
  return aimed || tvalIsWand(obj.tval) || (tvalIsRod(obj.tval) && !aware);
}

/** player_is_shapechanged (player-util.c L1065): null shape = normal. */
export function playerIsShapechanged(state: GameState): boolean {
  return state.actor.player.shape !== null;
}

/**
 * player_resume_normal_shape (player-util.c L1048): back to normal form,
 * killing the vampire attack and refreshing the bonuses.
 */
export function playerResumeNormalShape(
  state: GameState,
  env: Pick<ObjCmdEnv, "msg"> = {},
): void {
  state.actor.player.shape = null;
  env.msg?.("You resume your usual shape.");
  /* Kill vampire attack. */
  state.actor.player.timed[TMD.ATT_VAMP] = 0;
  state.updateBonuses?.();
}

/**
 * player_get_resume_normal_shape (player-util.c L1022): a shapechanged
 * player must return to normal form before acting with hands/voice. The
 * y/n/r prompt is the confirm seam (headless default: change back and
 * proceed).
 */
export function playerGetResumeNormalShape(
  state: GameState,
  env: Pick<ObjCmdEnv, "msg" | "confirm"> = {},
): boolean {
  if (!playerIsShapechanged(state)) return true;
  env.msg?.(
    `You cannot do this while in ${state.actor.player.shape!.name} form.`,
  );
  if (env.confirm?.("Change back and continue? ") ?? true) {
    playerResumeNormalShape(state, env);
    return true;
  }
  return false;
}

/**
 * player_confuse_dir (player-util.c): confusion randomises the direction
 * 75% of the time (always for "no direction").
 */
export function playerConfuseDir(state: GameState, dir: number): number {
  if ((state.actor.player.timed[TMD.CONFUSED] ?? 0) > 0) {
    if (dir === 5 || state.rng.randint0(100) < 75) {
      return DDD[state.rng.randint0(8)] as number;
    }
  }
  return dir;
}

/** The result of useAux, for the command wrappers. */
export interface UseResult {
  /** The effect ran (or the device fizzled) and the turn is spent. */
  turnSpent: boolean;
  /** effect_do reported the effect as used. */
  used: boolean;
}

/**
 * use_aux (cmd-obj.c L407): use an object the right way - aim resolution,
 * the device check, charge/timeout/single-use deduction with restore on an
 * unused effect, and the effect chain run with a player source.
 */
export function useAux(
  state: GameState,
  obj: GameObject,
  use: UseKind,
  deps: ObjCmdDeps,
  opts: {
    fromFloor?: boolean;
    handle?: number;
    dir?: number;
    /** cmd_get_arg_item "tgtitem": the shell's pre-resolved item-effect pick. */
    tgtItem?: ItemTargetRef;
    /** cmd_get_arg_choice "tgtcurse": the REMOVE_CURSE curse index. */
    tgtCurse?: number;
  } = {},
): UseResult {
  const env = deps.env ?? {};
  const fromFloor = opts.fromFloor ?? false;
  const wasAware = deps.flavor ? deps.flavor.isAware(obj.kind) : true;

  /* Determine whether we know an item needs to be aimed. */
  const knownAim =
    tvalIsWand(obj.tval) || tvalIsRod(obj.tval) || wasAware;

  let dir = 5;
  if (objNeedsAim(obj, deps)) {
    if (!knownAim) {
      /* Unknown things with no obvious aim get a random direction. */
      dir = DDD[state.rng.randint0(8)] as number;
    } else {
      dir = opts.dir ?? env.chooseDir?.() ?? 5;
    }
    /* Confusion wrecks aim. */
    dir = playerConfuseDir(state, dir);
  }

  /* Check for use if necessary. */
  let canUse = 1;
  if (use === USE.CHARGE || use === USE.TIMEOUT) {
    canUse = checkDevices(state, obj, env);
  }

  if (canUse > 0) {
    const beam = beamChance(obj.tval);
    const level = objectLevel(obj);
    const boost = Math.max(
      Math.trunc(((state.actor.combat.skills[SKILL.DEVICE] ?? 0) - level) / 2),
      0,
    );

    /* Sound / message. */
    if (obj.activation?.message) env.msg?.(obj.activation.message);
    else if (obj.effectMsg) env.msg?.(obj.effectMsg);

    /* Tentatively deduct floor-object usage before the effect (the effect
     * could leave the object inaccessible). */
    let deductBefore = false;
    let charges = 0;
    let singleUsed: GameObject | null = null;
    if (fromFloor) {
      if (use === USE.SINGLE) {
        deductBefore = true;
        singleUsed = floorObjectForUse(state, obj, 1).usable;
      } else if (use === USE.CHARGE) {
        deductBefore = true;
        charges = obj.pval;
        obj.pval--;
      } else if (use === USE.TIMEOUT) {
        deductBefore = true;
        charges = obj.timeout;
        obj.timeout += rollRechargeTime(state, obj);
      }
    }

    /* Do effect. */
    const chain = buildObjectEffectChain(obj.effect ?? [], state, deps.inject);
    const ctx = attachGameEnv(buildEffectContext(state, deps.envDeps), {
      state,
      cast: deps.cast,
      /* target_get inside the handlers: a DIR_TARGET cast re-reads the
       * live target per handler, as upstream. */
      get aimed() {
        return targetOkay(state) ? targetGet(state) : undefined;
      },
      ...(deps.teleport ? { teleport: deps.teleport } : {}),
      ...(deps.general ? { general: deps.general } : {}),
      ...(deps.item ? { item: deps.item } : {}),
      ...(deps.summon ? { summon: deps.summon } : {}),
      /* Flavor knowledge for item-identifying effects (EF_IDENTIFY fires the
       * object_flavor_aware side effect of player_know_object). */
      ...(deps.flavor ? { flavor: deps.flavor } : {}),
      ...(deps.flavorDeps ? { flavorDeps: deps.flavorDeps } : {}),
    });
    const ident = { value: false };
    targetFix(state);
    /* cmd_get_item "tgtitem" / "tgtcurse" presets: the item-choosing effects
     * read state.itemTarget / state.curseTarget through the getItem seam. Set
     * before the run, cleared after (cmd_set_arg_item's scope). */
    state.itemRequest = null;
    state.itemTarget = opts.tgtItem ?? null;
    state.curseTarget = opts.tgtCurse ?? null;
    const used = deps.registry.effectDo(chain, ctx, {
      origin: sourcePlayer(),
      obj,
      ident,
      aware: wasAware,
      dir,
      beam,
      boost,
    });
    state.itemTarget = null;
    state.curseTarget = null;
    targetRelease(state);

    if (!used && deductBefore) {
      /* Restore the tentative deduction. */
      if (use === USE.SINGLE && singleUsed) {
        dropNear(state, singleUsed, 0, state.actor.grid, true, deps.floorEnv);
      } else if (use === USE.CHARGE) {
        obj.pval = charges;
      } else if (use === USE.TIMEOUT) {
        obj.timeout = charges;
      }
    }

    /* Increase knowledge. */
    if (deps.flavor) {
      const knowObj = singleUsed ?? obj;
      const flavorDeps = deps.flavorDeps ?? NOOP_FLAVOR_AWARE_DEPS;
      if (use === USE.SINGLE) {
        /* Single use items are automatically learned. */
        if (!wasAware) deps.flavor.objectFlavorAware(knowObj.kind, flavorDeps);
      } else if (!wasAware && ident.value) {
        deps.flavor.objectFlavorAware(knowObj.kind, flavorDeps);
      } else {
        deps.flavor.setTried(knowObj.kind);
      }
    }

    /* Use up, deduct charge, or apply timeout if it wasn't done before. */
    if (used && !deductBefore) {
      if (use === USE.CHARGE) {
        obj.pval--;
      } else if (use === USE.TIMEOUT) {
        obj.timeout += rollRechargeTime(state, obj);
      } else if (use === USE.SINGLE && opts.handle !== undefined) {
        gearObjectForUse(state.gear, state.actor.player, opts.handle, 1);
      }
    }
  }

  /* Use the turn (even a device fizzle spends it, as upstream). */
  return { turnSpent: true, used: canUse > 0 };
}

/* ------------------------------------------------------------------ *
 * Command actions.
 * ------------------------------------------------------------------ */

/** Resolve a command's object: a gear handle or a floor pile position. */
function commandObject(
  state: GameState,
  cmd: PlayerCommand,
): { obj: GameObject; handle?: number; fromFloor: boolean } | null {
  const args = cmd.args ?? {};
  const handle = typeof args["handle"] === "number" ? args["handle"] : null;
  if (handle !== null) {
    const obj = gearGet(state.gear, handle);
    return obj ? { obj, handle, fromFloor: false } : null;
  }
  const floorIdx = typeof args["floor"] === "number" ? args["floor"] : null;
  if (floorIdx !== null) {
    const pile = floorPile(state, state.actor.grid);
    const obj = pile[floorIdx];
    return obj ? { obj, fromFloor: true } : null;
  }
  return null;
}

function commandDir(cmd: PlayerCommand): number | undefined {
  const d = cmd.args?.["dir"] ?? cmd.dir;
  return typeof d === "number" ? d : undefined;
}

/** cmd_get_arg_item "tgtitem": the shell's pre-resolved item-effect target. */
function commandTargetItem(cmd: PlayerCommand): ItemTargetRef | undefined {
  const t = cmd.args?.["tgtitem"];
  if (t && typeof t === "object") {
    if (typeof (t as { handle?: unknown }).handle === "number") {
      return { handle: (t as { handle: number }).handle };
    }
    if (typeof (t as { floor?: unknown }).floor === "number") {
      return { floor: (t as { floor: number }).floor };
    }
  }
  return undefined;
}

/** A use command over a tval filter and use kind. */
function useCommand(
  deps: ObjCmdDeps,
  filter: (obj: GameObject) => boolean,
  use: UseKind,
) {
  return (state: GameState, cmd: PlayerCommand): number => {
    const found = commandObject(state, cmd);
    if (!found || !filter(found.obj)) return 0;
    if (use === USE.TIMEOUT && !objCanZap(found.obj)) {
      deps.env?.msg?.("That item is still charging.");
      return 0;
    }
    const dir = commandDir(cmd);
    const tgtItem = commandTargetItem(cmd);
    const tgtCurse = cmd.args?.["tgtcurse"];
    const result = useAux(state, found.obj, use, deps, {
      fromFloor: found.fromFloor,
      ...(found.handle !== undefined ? { handle: found.handle } : {}),
      ...(dir !== undefined ? { dir } : {}),
      ...(tgtItem ? { tgtItem } : {}),
      ...(typeof tgtCurse === "number" ? { tgtCurse } : {}),
    });
    return result.turnSpent ? state.z.moveEnergy : 0;
  };
}

/**
 * Register the object commands (wield / takeoff / drop / eat / quaff /
 * read / use-staff / aim-wand / zap-rod / activate) on the registry.
 */
export function installObjCommands(
  registry: ActionRegistry,
  deps: ObjCmdDeps,
): void {
  /* player_get_resume_normal_shape gates the hands/voice commands
   * (cmd-obj.c: takeoff/wield/drop, scroll/staff/wand/rod/activate);
   * eating and quaffing stay possible in any shape. */
  const gated = (
    fn: (state: GameState, cmd: PlayerCommand) => number,
  ): ((state: GameState, cmd: PlayerCommand) => number) => {
    return (state, cmd) =>
      playerGetResumeNormalShape(state, deps.env ?? {}) ? fn(state, cmd) : 0;
  };

  /* do_cmd_wield: wear/wield from the pack or the floor. */
  registry.register("wield", gated((state, cmd) => {
    const found = commandObject(state, cmd);
    if (!found) return 0;
    let handle = found.handle;
    if (found.fromFloor) {
      /* Get a floor item and carry it first (inven_wield's floor path). */
      const { usable } = floorObjectForUse(state, found.obj, 1);
      handle = invenCarry(state.gear, usable, stackLimits(deps.constants));
    }
    if (handle === undefined) return 0;
    const slot = invenWield(state, handle);
    return slot >= 0 ? state.z.moveEnergy : 0;
  }));

  /* do_cmd_takeoff: energy is half a turn. */
  registry.register("takeoff", gated((state, cmd) => {
    const args = cmd.args ?? {};
    const handle = typeof args["handle"] === "number" ? args["handle"] : null;
    if (handle === null) return 0;
    return invenTakeoff(state, handle)
      ? Math.trunc(state.z.moveEnergy / 2)
      : 0;
  }));

  /* do_cmd_drop: energy is half a turn. */
  registry.register("drop", gated((state, cmd) => {
    const args = cmd.args ?? {};
    const handle = typeof args["handle"] === "number" ? args["handle"] : null;
    if (handle === null) return 0;
    const obj = gearGet(state.gear, handle);
    if (!obj) return 0;
    const amt =
      typeof args["quantity"] === "number" ? args["quantity"] : obj.number;
    return invenDrop(state, handle, amt, deps.floorEnv)
      ? Math.trunc(state.z.moveEnergy / 2)
      : 0;
  }));

  registry.register(
    "eat",
    useCommand(deps, (o) => tvalIsEdible(o.tval), USE.SINGLE),
  );
  registry.register(
    "quaff",
    useCommand(deps, (o) => tvalIsPotion(o.tval), USE.SINGLE),
  );
  registry.register(
    "read",
    gated(useCommand(deps, (o) => tvalIsScroll(o.tval), USE.SINGLE)),
  );
  registry.register(
    "use-staff",
    gated(useCommand(deps, (o) => tvalIsStaff(o.tval), USE.CHARGE)),
  );
  registry.register(
    "aim-wand",
    gated(useCommand(deps, (o) => tvalIsWand(o.tval), USE.CHARGE)),
  );
  registry.register(
    "zap-rod",
    gated(useCommand(deps, (o) => tvalIsRod(o.tval), USE.TIMEOUT)),
  );
  /* obj_can_activate: an activation and not recharging. */
  registry.register(
    "activate",
    gated(
      useCommand(
        deps,
        (o) =>
          (o.activation !== null || o.artifact !== null) && o.timeout === 0,
        USE.TIMEOUT,
      ),
    ),
  );

  /* do_cmd_inscribe (cmd-obj.c L179): set the note. Upstream's
   * quark_add("") does NOT return 0 (z-quark.c L31: it adds a new,
   * non-zero, empty quark, so obj->note stays truthy and object_desc
   * renders " {}"). This port intentionally maps "" -> null instead: it is
   * a deliberate normalization (not literal parity) that keeps note's
   * truthiness meaningful for objectStackable/objectCombine (object.ts
   * L844/L920), which already compare/merge notes by truthiness. No
   * energy; upstream's PN_COMBINE/PN_IGNORE notice + PR_INVEN/PR_EQUIP
   * redraw are UI bookkeeping this port doesn't model (combine already runs
   * lazily on the next inven_carry; ignore/display refresh is #25). */
  registry.register("inscribe", gated((state, cmd) => {
    const found = commandObject(state, cmd);
    if (!found) return 0;
    const raw = cmd.args?.["inscription"];
    const text = typeof raw === "string" ? raw : "";
    found.obj.note = text.length > 0 ? text : null;
    return 0;
  }));

  /* do_cmd_uninscribe (cmd-obj.c L153). */
  registry.register("uninscribe", gated((state, cmd) => {
    const found = commandObject(state, cmd);
    if (!found || !objHasInscrip(found.obj)) return 0;
    found.obj.note = null;
    deps.env?.msg?.("Inscription removed.");
    return 0;
  }));

  /* do_cmd_autoinscribe (cmd-obj.c L219): not gated by
   * player_get_resume_normal_shape - upstream just no-ops while
   * shapechanged, with no resume prompt. */
  registry.register("autoinscribe", (state, _cmd) => {
    if (playerIsShapechanged(state)) return 0;
    for (const obj of floorPile(state, state.actor.grid)) {
      applyAutoinscription(state, obj, deps);
    }
    for (const obj of state.gear.store.values()) {
      applyAutoinscription(state, obj, deps);
    }
    return 0;
  });

  /* do_cmd_refill (cmd-obj.c L1071): validate the equipped light, then
   * refill it from the chosen fuel source. Half a turn on success. */
  registry.register("refill", gated((state, cmd) => {
    const light = equippedLight(state);
    if (!light || !tvalIsLight(light.tval)) {
      deps.env?.msg?.("You are not wielding a light.");
      return 0;
    }
    if (light.flags.has(OF.NO_FUEL) || !light.flags.has(OF.TAKES_FUEL)) {
      deps.env?.msg?.("Your light cannot be refilled.");
      return 0;
    }

    const found = commandObject(state, cmd);
    if (!found || !objCanRefill(state, found.obj)) return 0;

    refillLamp(
      state,
      light,
      found.obj,
      {
        fromFloor: found.fromFloor,
        ...(found.handle !== undefined ? { handle: found.handle } : {}),
      },
      deps,
    );
    return Math.trunc(state.z.moveEnergy / 2);
  }));
}
