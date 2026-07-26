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
 * (do_cmd_autoinscribe/apply_autoinscription) applies the per-kind
 * note_aware/note_unaware registry (obj/knowledge.ts AutoinscriptionRegistry,
 * wired through ObjCmdDeps.autoNote by session/game.ts). The separate
 * rune-based autoinscription (runes_autoinscribe, obj-ignore.c L217) rides the
 * rune knowledge system and stays deferred (#24).
 *
 * DEFERRED with their subsystems (ledgered in game-obj-cmd.yaml):
 * cast/study (player spells #22), the glyph-of-warding push_object
 * interaction (traps #21), command repetition, and the !t take-off
 * confirmation prompt (get_check, UI).
 */

import type { Constants } from "../constants";
import { EFFECT_ENTRIES, EQUIP_SLOT_ENTRIES, OF, TMD } from "../generated";
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
  tvalIsLauncher,
  tvalIsLight,
  tvalIsMeleeWeapon,
  tvalIsPotion,
  tvalIsRod,
  tvalIsScroll,
  tvalIsStaff,
  tvalIsWand,
  tvalIsWearable,
  tvalCanHaveCharges,
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
  calcInventory,
  combinePack,
  gearGet,
  gearObjectForUse,
  invenCarry,
  invenCarryNum,
  objectSplit,
  packIsOverfull,
  wieldObject,
  wieldSlot,
} from "./gear";
import type { CalcInventoryOpts } from "./gear";
import { disturb } from "./player-path";
import { buildEffectContext } from "./effect-env";
import type { EffectEnvDeps } from "./effect-env";
import { attachGameEnv } from "./effect-game-env";
import { describeObject } from "./describe";
import { ODESC, objDescNameFormat } from "../obj/desc";
import { substituteTimedMessage } from "../player/timed";
import { updatePlayerObjectKnowledge } from "./known";
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
   * note_unaware autoinscription lookup. session/game.ts wires this to the
   * per-game AutoinscriptionRegistry (obj/knowledge.ts), so a note registered
   * through the knowledge-menu manager (web) is applied on autoinscribe. Left
   * absent by worldless callers (game/harness.ts), which makes autoinscribe a
   * no-op exactly as upstream with no autoinscriptions configured.
   */
  autoNote?: (kind: ObjectKind, aware: boolean) => string | null;
  /**
   * player_exp_gain hook (player.c L269): object_learn_on_use rewards the
   * player with experience on a first identify-by-use (obj-knowledge.c
   * L1925-1936, gap 4.3). session/game.ts wires this to playerExpGain with the
   * real ExpDeps (the same hook already threaded into spell/trap/chest); absent
   * for worldless callers, where the XP side-channel is simply skipped.
   */
  expGain?: (amount: number) => void;
  /**
   * calc_inventory (player-calcs.c) inputs used to re-derive the quiver after a
   * wield / takeoff / drop (upstream's PU_INVEN -> update_stuff): the earlier_object
   * ammo tiebreak (ammoTval / objectValue), the preferred_quiver_slot keyset
   * (rogueLike) and the re-arrange message gate (characterDungeon). All optional;
   * absent hooks fall back to gear-order ammo assignment with no messages.
   */
  ammoTval?: () => number;
  objectValue?: (obj: GameObject) => number;
  rogueLike?: boolean;
  characterDungeon?: boolean;
}

/** Build calc_inventory options from the object-command deps (gap 4.1). */
function calcInvOpts(state: GameState, deps: ObjCmdDeps): CalcInventoryOpts {
  const o: CalcInventoryOpts = {};
  if (deps.env?.msg) o.msg = deps.env.msg;
  if (deps.rogueLike) o.rogueLike = deps.rogueLike;
  if (deps.characterDungeon) o.characterDungeon = deps.characterDungeon;
  const at = deps.ammoTval?.() ?? state.playerState?.ammoTval;
  if (at !== undefined) o.ammoTval = at;
  if (deps.objectValue) o.objectValue = deps.objectValue;
  return o;
}

/**
 * The combine_pack / pack_overflow seams for the command handlers: the message
 * sink, the calc_inventory inputs, and the drop_near environment
 * pack_overflow's drop needs (deps.floorEnv is the same one inven_drop uses).
 */
function packOpts(state: GameState, deps: ObjCmdDeps): PackOverflowOpts {
  const o: PackOverflowOpts = { calcInv: calcInvOpts(state, deps) };
  if (deps.env?.msg) o.msg = deps.env.msg;
  if (deps.floorEnv) o.floorEnv = deps.floorEnv;
  return o;
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
 * Seams for the combine_pack / pack_overflow tail of inven_wield and
 * do_cmd_takeoff. All optional; an absent msg simply drops the messages, as
 * everywhere else in this module.
 */
export interface PackOverflowOpts {
  /** msg / msgt sink for the wield line and the overflow messages. */
  msg?: (text: string) => void;
  /** calc_inventory inputs used by combine_pack's tail (quiver re-derive). */
  calcInv?: CalcInventoryOpts;
  /** drop_near seams (isTrap / onDrop / onBreak) for the overflowed item. */
  floorEnv?: FloorEnv;
}

/** calcInv with the shared msg sink filled in when the caller left it out. */
function overflowCalcInv(opts: PackOverflowOpts): CalcInventoryOpts {
  const base: CalcInventoryOpts = { ...opts.calcInv };
  if (!base.msg && opts.msg) base.msg = opts.msg;
  return base;
}

/**
 * pack_overflow (obj-gear.c L1345-1390): when the pack holds more than
 * pack_size slots, shed one item onto the floor. `handle` is upstream's `obj`
 * argument - the item to shed, normally whatever displaced into the pack; 0 is
 * upstream's NULL, meaning "shed the last item of the inventory listing".
 * Returns the object that left the pack, or null when nothing overflowed.
 *
 * The C's three messages and their order are reproduced exactly: the warning,
 * then "You drop X." with X described BEFORE the excise, then the drop, then
 * "You no longer have X."
 *
 * DIVERGENCE, flagged: upstream picks the NULL-case victim by walking
 * upkeep->inven[] to its last filled entry (L1359-1366), and that array is
 * sorted by earlier_object in calc_inventory (player-calcs.c L1191-1222). The
 * port defers that sort - gear.pack IS the listing, in insertion order - so the
 * victim here is gear.pack's last handle. Every in-port caller passes an
 * explicit handle, so this only bites a pack that was already overfull.
 */
export function packOverflow(
  state: GameState,
  handle: number,
  constants: Constants,
  opts: PackOverflowOpts = {},
): GameObject | null {
  if (!packIsOverfull(state.gear, constants)) return null;

  /* Disturbing (L1353). */
  disturb(state);

  /* Warning (L1356). */
  opts.msg?.("Your pack overflows!");

  /* Drop the last inventory item unless requested otherwise (L1359-1366). */
  const victim =
    handle !== 0
      ? handle
      : (state.gear.pack[state.gear.pack.length - 1] ?? 0);
  const obj = gearGet(state.gear, victim);
  /* Upstream asserts obj != NULL here (L1369). The port can reach a stale
   * handle where upstream reads freed memory: combine_pack (which runs just
   * before every caller's pack_overflow) may have absorbed the displaced item
   * into an earlier stack, which upstream frees while still holding the
   * pointer. Absorbing shrinks the pack, so an overfull pack with a stale
   * handle is a corner the C does not define; the port sheds nothing. */
  if (!obj) return null;

  /* Describe (L1372-1374) BEFORE the excise, so the count is the pre-drop one. */
  const name = describeObject(state, obj);

  /* Message (L1377). */
  opts.msg?.(`You drop ${name}.`);

  /* Excise the object and drop it (carefully) near the player (L1379-1380).
   * gear_excise_object re-runs calc_inventory (obj-gear.c L497). */
  const { obj: dropped } = gearObjectForUse(
    state.gear,
    state.actor.player,
    victim,
    obj.number,
  );
  calcInventory(state.gear, constants, overflowCalcInv(opts));
  /* drop_near(cave, &obj, 0, player->grid, false, true): prefer_pile. */
  dropNear(state, dropped, 0, state.actor.grid, true, opts.floorEnv ?? {});

  /* Describe (L1383). */
  opts.msg?.(`You no longer have ${name}.`);

  state.updateBonuses?.(); /* gear_excise_object's PU_BONUS (obj-gear.c L500). */
  return dropped;
}

/**
 * inven_wield (obj-gear.c L931-1017): wield a pack object into its slot,
 * taking off whatever occupies it first, then combine_pack + pack_overflow so
 * a displaced item that does not fit is dropped (L1009-1010). Returns the
 * slot, or -1 when the object cannot be worn. Read
 * `state.actor.player.equipment[slot]` for the handle actually worn - a wield
 * out of a stack equips a FRESH split, not `handle` (L947-968).
 *
 * The MSG_WIELD line and the OF_STICKY warning (L986-1008) live here rather
 * than in the command handler because upstream emits them BEFORE combine_pack,
 * while do_cmd_wield's "You were wielding ..." line comes AFTER it (cmd-obj.c
 * L346-352) and so reads the post-combine gear label.
 */
export function invenWield(
  state: GameState,
  handle: number,
  constants: Constants,
  opts: PackOverflowOpts = {},
): number {
  const player = state.actor.player;
  const obj = gearGet(state.gear, handle);
  if (!obj) return -1;

  const slot = wieldSlot(player.body, obj.tval, player.equipment);
  if (slot < 0 || slot >= player.body.count) return -1;

  /* `old` (L933): the slot's current occupant. Upstream just overwrites
   * body.slots[slot].obj, which leaves `old` in p->gear as a pack item; the
   * port's equipment[]/pack split needs the move spelled out. */
  const oldHandle = player.equipment[slot] ?? 0;
  if (oldHandle !== 0) invenTakeoff(state, oldHandle);

  const worn = wieldObject(
    state.gear,
    player,
    handle,
    state.runeEnv,
    "inven_wield",
  );
  if (worn < 0) return worn;
  const wornHandle = player.equipment[worn] ?? 0;
  const wornObj = gearGet(state.gear, wornHandle);

  /* Where is the item now, and the message (L991-1006). */
  if (wornObj && opts.msg) {
    const verb = tvalIsMeleeWeapon(wornObj.tval)
      ? "You are wielding"
      : tvalIsLauncher(wornObj.tval)
        ? "You are shooting with"
        : tvalIsLight(wornObj.tval)
          ? "Your light source is"
          : "You are wearing";
    opts.msg(
      `${verb} ${describeObject(state, wornObj)} (${gearLabelFor(state, wornHandle)}).`,
    );
    /* Sticky flag gets a special mention (L1008). */
    if (wornObj.flags.has(OF.STICKY)) {
      opts.msg("Oops! It feels deathly cold!");
    }
  }

  /* See if we have to overflow the pack (L1009-1010). */
  combinePack(state.gear, constants, overflowCalcInv(opts));
  packOverflow(state, oldHandle, constants, opts);

  /* object_learn_on_wield's player_learn_rune tail-calls
   * update_player_object_knowledge (obj-knowledge.c L1373): the wield learns the
   * obvious runes, and the sweep is what turns that into cross-object awareness
   * (e.g. a worn Ring of Strength becoming flavour-aware - KN-03). */
  updatePlayerObjectKnowledge(state);
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

/**
 * gear_to_label (obj-gear.c L443): the one-character label for a held object -
 * equipment slots index straight into the alphabet, a quiver handle takes its
 * slot digit, a pack handle its listing letter. The alphabet skips the
 * roguelike cardinal-movement keys h/j/k/l (L446). "" when the handle is not
 * currently held (upstream '\0').
 */
const GEAR_LABELS = "abcdefgimnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function gearLabelFor(state: GameState, handle: number): string {
  const p = state.actor.player;
  const eq = p.equipment.indexOf(handle);
  if (eq >= 0) return GEAR_LABELS[eq] ?? "";
  const qi = state.gear.quiver?.indexOf(handle) ?? -1;
  if (qi >= 0) return String(qi);
  const pi = state.gear.pack.indexOf(handle);
  if (pi >= 0 && pi < GEAR_LABELS.length) return GEAR_LABELS[pi] ?? "";
  return "";
}

/**
 * equip_describe (obj-gear.c L320-332): how a slot's occupant is being used,
 * for the "You cannot remove the X you are Y." refusal. A heavy weapon or
 * launcher reads as the slot's heavy wording instead, and a named slot (rings,
 * hands) interpolates the slot name into its describe template.
 */
function equipDescribe(state: GameState, slot: number): string {
  const p = state.actor.player;
  const bodySlot = p.body.slots[slot];
  if (!bodySlot) return "";
  const entry = EQUIP_SLOT_ENTRIES.find((e) => e.name === bodySlot.type);
  if (!entry) return "";
  const ps = state.playerState;
  if (bodySlot.type === "WEAPON" && (ps?.heavyWield || ps?.heavyShoot)) {
    return entry.heavyDescribe;
  }
  if (entry.named) return entry.describe.replace("%s", bodySlot.name);
  return entry.describe;
}

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

/**
 * object_effect (obj-util.c L886): the effect an object actually runs - the
 * ACTIVATION's effect when it has one, otherwise the kind/instance effect.
 * The activation wins outright, so an artifact or ego activation replaces the
 * base kind's effect rather than being appended to it.
 */
export function objectEffect(obj: GameObject): EffectRecordJson[] | null {
  if (obj.activation) return obj.activation.effect;
  return obj.effect;
}

/**
 * obj_is_activatable (obj-util.c L721): a WEARABLE object that has an effect.
 * Note both halves: a non-wearable with an effect (a potion) is not
 * "activatable", and a wearable's effect may come from its kind rather than an
 * activation - the rings of Flames / Acid / Ice / Lightning / Open Wounds /
 * Digging carry an `effect:` in object.txt and no `act:`, so they ARE
 * activatable even though obj.activation is null.
 */
export function objIsActivatable(obj: GameObject): boolean {
  if (!tvalIsWearable(obj.tval)) return false;
  const effect = objectEffect(obj);
  return effect !== null && effect.length > 0;
}

/**
 * obj_can_activate (obj-util.c L730): activatable AND not recharging. This is
 * NOT obj_can_zap: do_cmd_activate guards on this (cmd-obj.c L886) while
 * do_cmd_zap_rod guards on obj_can_zap (L851), and obj_can_zap requires a ROD
 * tval, so reusing it for activation refuses every artifact and ring.
 */
export function objCanActivate(obj: GameObject): boolean {
  return objIsActivatable(obj) && obj.timeout === 0;
}

/**
 * obj_can_wear (obj-util.c L810): wield_slot(obj) >= 0 - do_cmd_wield's
 * item_tester (cmd-obj.c L284). Over the shipped body plan this is exactly
 * tvalIsWearable (wield_slot handles the same tval set), but it is the slot
 * lookup that decides, so a body plan without some slot type changes the
 * answer. NOTE the upstream wart it inherits: slot_by_type's fallback for
 * "type not on this body" is `false`, i.e. slot 0 - so wield_slot returns 0,
 * not -1, and obj_can_wear stays true for a slot the body does not have.
 */
export function objCanWear(state: GameState, obj: GameObject): boolean {
  const player = state.actor.player;
  return wieldSlot(player.body, obj.tval, player.equipment) >= 0;
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
      /* effects.c L308-315: WEAPON_DAMAGE is a live damroll(dd, ds)+to_d
       * expression base. Keeping this provider lazy preserves the C draw
       * position: the roll occurs exactly when the expression is evaluated. */
      WEAPON_DAMAGE: () => {
        const weapon = state.actor.weapon;
        return weapon
          ? state.rng.damroll(weapon.dd, weapon.ds) + weapon.toD
          : 0;
      },
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
export function playerConfuseDir(
  state: GameState,
  dir: number,
  too = false,
): number {
  if ((state.actor.player.timed[TMD.CONFUSED] ?? 0) > 0) {
    let newDir = dir;
    if (dir === 5 || state.rng.randint0(100) < 75) {
      /* Random direction. */
      newDir = DDD[state.rng.randint0(8)] as number;
    }
    /* player-util.c L1363-1366: running is refused after the same confusion
     * roll, with the C's message. */
    if (too) {
      state.msg?.("You are too confused.");
      return dir;
    }
    /* player-util.c L1369: emit "You are confused." and report the change only
     * when the direction actually changed (a same-direction roll is silent).
     * The RNG draw above is unconditional whenever confused, matching C. */
    if (newDir !== dir) {
      state.msg?.("You are confused.");
      return newDir;
    }
  }
  return dir;
}

/**
 * object_learn_on_use (obj-knowledge.c L1925-1936), XP slice (gap 4.3): the
 * flavor-awareness half is handled by the caller (objectFlavorAware); this adds
 * the experience reward player_exp_gain(p, (lev + p->lev/2)/p->lev) with lev the
 * used object's KIND level. Integer division throughout, exactly as upstream.
 */
function objectLearnOnUseXp(
  state: GameState,
  obj: GameObject,
  deps: ObjCmdDeps,
): void {
  if (!deps.expGain) return;
  const p = state.actor.player;
  const lev = obj.kind.level;
  deps.expGain(Math.trunc((lev + Math.trunc(p.lev / 2)) / p.lev));
}

/** The result of useAux, for the command wrappers. */
export interface UseResult {
  /** The effect ran (or the device fizzled) and the turn is spent. */
  turnSpent: boolean;
  /** effect_do reported the effect as used. */
  used: boolean;
}

/**
 * activation_message (cmd-obj.c L127): print an activated object's custom
 * message. The message text comes from the activation (activation.txt msg:),
 * but an artifact carrying its own alt_msg (artifact.txt msg:) overrides it -
 * and the override only fires when the activation itself defines a message. The
 * text is run through print_custom_message's {name}/{kind}/{s}/{is} object-tag
 * substitution (obj-util.c L1118): {name} -> object_desc(PREFIX|BASE), {kind} ->
 * object_kind_name (easy_know), {s}/{is} keyed on the stack count.
 */
function activationMessage(
  state: GameState,
  obj: GameObject,
  env: ObjCmdEnv,
): void {
  if (!obj.activation?.message) return;
  const message =
    obj.artifact && obj.artifact.altMsg
      ? obj.artifact.altMsg
      : obj.activation.message;
  const text = substituteTimedMessage(message, {
    name: describeObject(state, obj, ODESC.PREFIX | ODESC.BASE),
    kind: objDescNameFormat(obj.kind.name, null, false),
    number: obj.number,
  });
  env.msg?.(text);
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

    /* Sound / message (cmd-obj.c L493-504): an activation prints the generic
     * "You activate it." then its own activation_message; otherwise the kind's
     * effect_msg (always) or vis_msg (only when not blind). */
    if (obj.activation) {
      env.msg?.("You activate it.");
      activationMessage(state, obj, env);
    } else if (obj.kind.effectMsg) {
      env.msg?.(obj.kind.effectMsg);
    } else if (
      obj.kind.visMsg &&
      (state.actor.player.timed[TMD.BLIND] ?? 0) === 0
    ) {
      env.msg?.(obj.kind.visMsg);
    }

    /* Capture the describe inputs before the effect can rearrange the pack
     * (cmd-obj.c L462-483): the gear label of the item and its stack count. The
     * port names a single stack rather than upstream's object_pack_total across
     * split stacks - ledgered; the aggregate "(1st %c)" split-stack form is not
     * reproduced. */
    const describeLabel =
      opts.handle !== undefined ? gearLabelFor(state, opts.handle) : "";
    const startNumber = obj.number;

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

    /* Do effect. use_aux takes its chain from object_effect(obj) (cmd-obj.c
     * L410 `struct effect *effect = object_effect(obj);`), so an activation's
     * effect REPLACES the base kind's - reading obj.effect here ran a
     * Narthanc-style artifact's (empty) kind effect instead of its activation. */
    const chain = buildObjectEffectChain(objectEffect(obj) ?? [], state, deps.inject);
    const ctx = attachGameEnv(buildEffectContext(state, deps.envDeps), {
      state,
      cast: deps.cast,
      /* take_hit consequences for effects that rebound damage onto the player
       * (EF_BANISH), so such a death records died_from too. */
      ...(deps.envDeps.takeHitHooks
        ? { takeHitHooks: deps.envDeps.takeHitHooks }
        : {}),
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
        if (!wasAware) {
          deps.flavor.objectFlavorAware(knowObj.kind, flavorDeps);
          objectLearnOnUseXp(state, knowObj, deps);
        }
      } else if (!wasAware && ident.value) {
        deps.flavor.objectFlavorAware(knowObj.kind, flavorDeps);
        objectLearnOnUseXp(state, knowObj, deps);
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

    /* Describe what's left (cmd-obj.c L633-706). Single-use items are always
     * described; a charge/timeout device only when it was just identified (and
     * never for wearables, which take the update-knowledge branch). Otherwise a
     * used charge device reports its remaining charges. */
    const describe =
      use === USE.SINGLE ||
      (!tvalIsWearable(obj.tval) && !wasAware && ident.value);
    if (describe) {
      const shown = startNumber - (used && use === USE.SINGLE ? 1 : 0);
      const name = describeObject(
        state,
        obj,
        ODESC.PREFIX | ODESC.FULL | ODESC.ALTNUM,
        shown,
      );
      if (fromFloor) env.msg?.(`You see ${name}.`);
      else env.msg?.(`You have ${name} (${describeLabel}).`);
    } else if (
      used &&
      use === USE.CHARGE &&
      tvalCanHaveCharges(obj.tval) &&
      (deps.flavor ? deps.flavor.isAware(obj.kind) : true)
    ) {
      /* inven_item_charges / floor_item_charges (obj-gear.c L790-799). */
      env.msg?.(
        `You have ${obj.pval} charge${obj.pval === 1 ? "" : "s"} remaining.`,
      );
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

/**
 * A use command over a tval filter and use kind.
 *
 * `ready` is the command's OWN pre-use guard, because upstream does NOT share
 * one: do_cmd_zap_rod tests obj_can_zap and says "That rod is still charging."
 * (cmd-obj.c L851-855) while do_cmd_activate tests obj_can_activate and says
 * "That item is still charging." (L886-890). obj_can_zap requires a rod tval,
 * so the two are not interchangeable - using obj_can_zap for activation
 * refused EVERY artifact and ring.
 */
function useCommand(
  deps: ObjCmdDeps,
  filter: (obj: GameObject) => boolean,
  use: UseKind,
  ready?: { ok: (obj: GameObject) => boolean; msg: string },
) {
  return (state: GameState, cmd: PlayerCommand): number => {
    const found = commandObject(state, cmd);
    if (!found || !filter(found.obj)) return 0;
    if (ready && !ready.ok(found.obj)) {
      deps.env?.msg?.(ready.msg);
      return 0;
    }
    if (use === USE.CHARGE && found.obj.pval <= 0) {
      /* do_cmd_aim_wand (cmd-obj.c L817-820) / do_cmd_use_staff (L783-786)
       * pre-check obj_has_charges and return BEFORE use_aux, so an empty
       * device costs no turn (checkDevices' "... no charges left." path in
       * useAux would otherwise burn one). */
      deps.env?.msg?.(
        tvalIsWand(found.obj.tval)
          ? "That wand has no charges."
          : "That staff has no charges.",
      );
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
    /* The occupant of the target slot is displaced back into the pack; capture
     * it (and its slot type) before the wield so do_cmd_wield's "You were
     * wielding ..." message reads the right wording (cmd-obj.c L333-354). */
    const targetSlot = wieldSlot(
      state.actor.player.body,
      found.obj.tval,
      state.actor.player.equipment,
    );
    const displacedHandle =
      targetSlot >= 0 ? (state.actor.player.equipment[targetSlot] ?? 0) : 0;
    const displaced = displacedHandle ? gearGet(state.gear, displacedHandle) : null;
    const displacedTval = displaced?.tval ?? 0;
    /* Prevent wielding into a stickied slot (cmd-obj.c L313-320). obj_can_takeoff
     * is !OF_STICKY (obj-util.c L794), and the refusal names the stuck item by
     * its base description plus equip_describe's wording for the slot. Draws no
     * RNG and spends no energy: the command aborts before inven_wield. */
    if (displaced && displaced.flags.has(OF.STICKY)) {
      deps.env?.msg?.(
        `You cannot remove the ${describeObject(state, displaced, ODESC.BASE)} ` +
          `you are ${equipDescribe(state, targetSlot)}.`,
      );
      return 0;
    }
    /* invenWield owns the MSG_WIELD line, the sticky warning, combine_pack and
     * pack_overflow, in that upstream order (obj-gear.c L986-1010). */
    const slot = invenWield(state, handle, deps.constants, packOpts(state, deps));
    if (slot < 0) return 0;
    /* The displaced item, now back in the pack - or on the floor if
     * pack_overflow shed it, in which case gear_to_label gives '\0' and the
     * port's gearLabelFor gives "" (cmd-obj.c L337-354, read AFTER
     * combine_pack, so the label is the post-combine one). */
    if (displaced) {
      const dname = describeObject(state, displaced);
      const dlabel = gearLabelFor(state, displacedHandle);
      const act = tvalIsMeleeWeapon(displacedTval)
        ? "You were wielding"
        : tvalIsLauncher(displacedTval) || tvalIsLight(displacedTval)
          ? "You were holding"
          : "You were wearing";
      deps.env?.msg?.(`${act} ${dname} (${dlabel}).`);
    }
    return state.z.moveEnergy;
  }));

  /* do_cmd_takeoff: energy is half a turn. */
  registry.register("takeoff", gated((state, cmd) => {
    const args = cmd.args ?? {};
    const handle = typeof args["handle"] === "number" ? args["handle"] : null;
    if (handle === null) return 0;
    const obj = gearGet(state.gear, handle);
    const tval = obj?.tval ?? 0;
    /* obj_can_takeoff (obj-util.c:794-796) is the takeoff-item filter in
     * do_cmd_takeoff (cmd-obj.c:251): a sticky item is not selectable, so this
     * direct command entry likewise aborts silently and spends no energy. */
    if (obj?.flags.has(OF.STICKY)) return 0;
    if (!invenTakeoff(state, handle)) return 0;
    /* inven_takeoff's message (obj-gear.c L1046-1065): the slot wording, then
     * the item named at its new pack label. */
    if (obj) {
      const act = tvalIsMeleeWeapon(tval)
        ? "You were wielding"
        : tvalIsLauncher(tval) || tvalIsLight(tval)
          ? "You were holding"
          : "You were wearing";
      deps.env?.msg?.(
        `${act} ${describeObject(state, obj)} (${gearLabelFor(state, handle)}).`,
      );
    }
    /* combine_pack (which re-runs calc_inventory for inven_takeoff's PU_INVEN,
     * obj-gear.c L1060) then pack_overflow on the item just taken off
     * (cmd-obj.c L255-257). */
    const opts = packOpts(state, deps);
    combinePack(state.gear, deps.constants, calcInvOpts(state, deps));
    packOverflow(state, handle, deps.constants, opts);
    return Math.trunc(state.z.moveEnergy / 2);
  }));

  /* do_cmd_drop: energy is half a turn. */
  registry.register("drop", gated((state, cmd) => {
    const args = cmd.args ?? {};
    const handle = typeof args["handle"] === "number" ? args["handle"] : null;
    if (handle === null) return 0;
    const obj = gearGet(state.gear, handle);
    if (!obj) return 0;
    /* Cannot drop stickied equipment (cmd-obj.c L377-381). The C checks
     * object_is_equipped && !obj_can_takeoff and aborts before inven_drop, so no
     * energy is spent and no RNG is drawn. */
    if (
      state.actor.player.equipment.includes(handle) &&
      obj.flags.has(OF.STICKY)
    ) {
      deps.env?.msg?.("Hmmm, it seems to be stuck.");
      return 0;
    }
    const amt =
      typeof args["quantity"] === "number" ? args["quantity"] : obj.number;
    /* Label and artifact-ness captured before the drop (inven_drop L1099). */
    const label = gearLabelFor(state, handle);
    const wasArtifact = obj.artifact !== null;
    const dropped = invenDrop(state, handle, amt, deps.floorEnv);
    if (!dropped) return 0;
    /* inven_drop's messages (obj-gear.c L1120-1163): the drop, then what's
     * left. The split-stack "(1st %c)" aggregate is not reproduced (ledgered
     * with the use_aux describe line above). Dropping an equipped item omits the
     * take-off line the port's inven_takeoff does not emit - also ledgered. */
    deps.env?.msg?.(`You drop ${describeObject(state, dropped)} (${label}).`);
    const remain = gearGet(state.gear, handle);
    if (remain) {
      deps.env?.msg?.(`You have ${describeObject(state, remain)} (${label}).`);
    } else if (wasArtifact) {
      deps.env?.msg?.(
        `You no longer have the ${describeObject(state, dropped, ODESC.FULL | ODESC.SINGULAR)} (${label}).`,
      );
    } else {
      deps.env?.msg?.(
        `You have ${describeObject(state, dropped, ODESC.PREFIX | ODESC.FULL | ODESC.ALTNUM, 0)} (${label}).`,
      );
    }
    /* gear_object_for_use sets PU_INVEN (obj-gear.c L617) -> calc_inventory. */
    calcInventory(state.gear, deps.constants, calcInvOpts(state, deps));
    return Math.trunc(state.z.moveEnergy / 2);
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
  /* do_cmd_zap_rod (cmd-obj.c L832): tval_is_rod filter, obj_can_zap guard. */
  registry.register(
    "zap-rod",
    gated(
      useCommand(deps, (o) => tvalIsRod(o.tval), USE.TIMEOUT, {
        ok: objCanZap,
        msg: "That rod is still charging.",
      }),
    ),
  );
  /* do_cmd_activate (cmd-obj.c L866): obj_is_activatable filter (a WEARABLE
   * with an object_effect - which includes the kind-effect rings that have no
   * activation), then the obj_can_activate guard. */
  registry.register(
    "activate",
    gated(
      useCommand(deps, objIsActivatable, USE.TIMEOUT, {
        ok: objCanActivate,
        msg: "That item is still charging.",
      }),
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
