/**
 * The player's gear store: the world/UI-owned side of carried objects.
 *
 * The parity Player (player/player.ts) deliberately omits struct player's
 * gear list, keeping only equipment[] as per-body-slot object HANDLES
 * (0 = empty). This module owns the objects those handles point at: a
 * handle -> GameObject store plus an ordered pack of non-equipped handles.
 * It ports the equipment/carry substrate and the birth starting-kit from
 * reference/src/obj-gear.c (slot_by_type, wield_slot, inven_carry) and
 * reference/src/player-birth.c (wield_all, player_outfit) (Angband 4.2.6).
 *
 * LIVE vs DEFERRED (ledgered in parity/ledger/game-gear.yaml):
 * - LIVE: slot_by_type (empty-preferring), wield_slot (full tval switch),
 *   inven_carry's merge-or-add, wield_all's split-and-wear, player_outfit's
 *   start-item roll + prep + carry + wield (start_kit honoured).
 * - DEFERRED: p->au -= object_value_real(obj, number) starting-gold
 *   deduction (obj-value.c not ported, so starting gold is HIGHER than
 *   upstream until it lands); eopts birth-option exclusion (birth options
 *   not modelled - treated as "no exclusions", which equals upstream with
 *   default birth options); the pack_size overflow enforcement (a birth kit
 *   never overflows); the display knowledge twin (obj->known) and equip_cnt
 *   UI counter; the take-off / inventory-command layer; and the quiver.
 *   Wielding DOES learn modifier runes (obj-knowledge.c object_learn_on_wield,
 *   the only knowledge that changes real bonuses); see obj/knowledge.ts.
 */

import type { Constants } from "../constants";
import { ORIGIN, TV } from "../generated";
import type { Rng } from "../rng";
import type { ObjRegistry } from "../obj/bind";
import { tvalFindIdx } from "../obj/bind";
import type { GameObject } from "../obj/object";
import { objectLearnOnWield } from "../obj/knowledge";
import {
  distributeCharges,
  objectAbsorb,
  objectMergeable,
  objectStackable,
  OSTACK_PACK,
  tvalCanHaveCharges,
  tvalCanHaveTimeout,
  tvalIsBodyArmor,
  tvalIsFood,
  tvalIsHeadArmor,
  tvalIsLight,
  tvalIsMeleeWeapon,
  tvalIsMoney,
  tvalIsRing,
} from "../obj/object";
import type { StackLimits } from "../obj/object";
import { objectPrep } from "../obj/make";
import { objectValueReal } from "../obj/value";
import type { Player } from "../player/player";
import type { PlayerBody } from "../player/types";

/* ------------------------------------------------------------------ */
/* The gear store                                                       */
/* ------------------------------------------------------------------ */

/**
 * The player's live gear: every carried object by numeric handle, plus the
 * ordered list of pack (non-equipped) handles. Equipped objects stay in
 * `store` and are referenced by player.equipment[slot]; they are not in
 * `pack`. Handles start at 1 so 0 can mean "empty" in equipment[].
 */
export interface Gear {
  /** handle -> live object (both pack and equipped objects). */
  store: Map<number, GameObject>;
  /** The next handle to assign (always >= 1). */
  next: number;
  /** Ordered non-equipped handles (upstream p->gear minus equipment). */
  pack: number[];
}

/** A fresh, empty gear store. */
export function newGear(): Gear {
  return { store: new Map<number, GameObject>(), next: 1, pack: [] };
}

/** Store an object under a fresh handle and return it (no pack insertion). */
export function gearAdd(gear: Gear, obj: GameObject): number {
  const handle = gear.next;
  gear.next += 1;
  gear.store.set(handle, obj);
  return handle;
}

/** The object for a handle, or null (0 / unknown handle -> null). */
export function gearGet(gear: Gear, handle: number): GameObject | null {
  return gear.store.get(handle) ?? null;
}

/* ------------------------------------------------------------------ */
/* obj-util.c object copy / split                                       */
/* ------------------------------------------------------------------ */

/**
 * object_copy (obj-util.c): a faithful deep copy of the live struct. The
 * known twin and pile links are not part of GameObject (deferred), and
 * kind/ego/artifact/activation/effect stay shared references exactly as
 * upstream's memcpy leaves them.
 */
function objectCopy(src: GameObject): GameObject {
  return {
    ...src,
    flags: src.flags.clone(),
    modifiers: [...src.modifiers],
    elInfo: src.elInfo.map((e) => ({ resLevel: e.resLevel, flags: e.flags })),
    brands: src.brands ? [...src.brands] : null,
    slays: src.slays ? [...src.slays] : null,
    curses: src.curses
      ? src.curses.map((c) => ({ power: c.power, timeout: c.timeout }))
      : null,
    time: { ...src.time },
  };
}

/**
 * object_split (obj-util.c): split `amt` items off `src` into a fresh copy,
 * distributing wand/staff/rod charges, and reduce src by amt. Requires
 * src.number > amt (upstream assert). Exported for the floor-pile module
 * (floor_object_for_use splits floor stacks the same way).
 */
export function objectSplit(src: GameObject, amt: number): GameObject {
  const dest = objectCopy(src);
  /* Distribute charges of wands, staves, or rods (dest is a new stack). */
  distributeCharges(src, dest, amt, true);
  dest.number = amt;
  src.number -= amt;
  if (src.note) dest.note = src.note;
  return dest;
}

/* ------------------------------------------------------------------ */
/* obj-gear.c slot logic                                                */
/* ------------------------------------------------------------------ */

/**
 * slot_by_type (obj-gear.c L71-93): the index of a slot of the given type,
 * preferring an empty one (full = false) or a full one (full = true), else
 * any matching-type slot, else body.count when none exists.
 *
 * Upstream reads body.slots[i].obj to decide full/empty; here a slot is
 * "filled" when equipment[i] !== 0, so the equipment array is passed in.
 */
function slotByType(
  body: PlayerBody,
  equipment: readonly number[],
  type: string,
  full: boolean,
): number {
  let fallback = body.count;
  let i = 0;
  for (; i < body.count; i++) {
    if (type === body.slots[i]!.type) {
      const filled = (equipment[i] ?? 0) !== 0;
      if (full) {
        /* Found a full slot */
        if (filled) break;
      } else {
        /* Found an empty slot */
        if (!filled) break;
      }
      /* Not right for full/empty, but still the right type */
      if (fallback === body.count) fallback = i;
    }
  }
  /* Index for the best slot we found, or body.count if none found. */
  return i !== body.count ? i : fallback;
}

/**
 * wield_slot (obj-gear.c L341-367): the equipment slot an object of the
 * given tval likes (an open slot preferred for rings), or -1 for a
 * non-wearable tval.
 *
 * `equipment` (optional, defaults to all-empty) lets the empty-slot
 * preference work; wieldObject/wieldAll pass the player's real equipment
 * so a second ring lands in the free hand, matching upstream.
 */
export function wieldSlot(
  body: PlayerBody,
  tval: number,
  equipment?: readonly number[],
): number {
  const eq = equipment ?? new Array<number>(body.count).fill(0);

  switch (tval) {
    case TV.BOW:
      return slotByType(body, eq, "BOW", false);
    case TV.AMULET:
      return slotByType(body, eq, "AMULET", false);
    case TV.CLOAK:
      return slotByType(body, eq, "CLOAK", false);
    case TV.SHIELD:
      return slotByType(body, eq, "SHIELD", false);
    case TV.GLOVES:
      return slotByType(body, eq, "GLOVES", false);
    case TV.BOOTS:
      return slotByType(body, eq, "BOOTS", false);
    default:
      break;
  }

  if (tvalIsMeleeWeapon(tval)) return slotByType(body, eq, "WEAPON", false);
  if (tvalIsRing(tval)) return slotByType(body, eq, "RING", false);
  if (tvalIsLight(tval)) return slotByType(body, eq, "LIGHT", false);
  if (tvalIsBodyArmor(tval)) return slotByType(body, eq, "BODY_ARMOR", false);
  if (tvalIsHeadArmor(tval)) return slotByType(body, eq, "HAT", false);

  /* No slot available */
  return -1;
}

/* ------------------------------------------------------------------ */
/* inven_carry                                                          */
/* ------------------------------------------------------------------ */

/**
 * inven_carry (obj-gear.c L821): add an object to the pack. If a pack stack
 * is object_mergeable with the incoming object, object_absorb into it and
 * return that stack's handle; otherwise store the object under a fresh
 * pack handle and return it.
 *
 * FAITHFUL-ENOUGH: everything in the pack merges under OSTACK_PACK; the
 * quiver stack-mode and the pack_size overflow enforcement are DEFERRED (a
 * birth kit has no quiver and never overflows). See the module ledger.
 */
export function invenCarry(
  gear: Gear,
  obj: GameObject,
  limits: StackLimits,
): number {
  /* Check for combining with an existing pack stack. */
  for (const handle of gear.pack) {
    const stack = gear.store.get(handle);
    if (stack && objectMergeable(stack, obj, OSTACK_PACK, limits)) {
      objectAbsorb(stack, obj, ORIGIN.MIXED);
      return handle;
    }
  }

  /* We did not find an object to combine with: add a new pack handle. */
  const handle = gearAdd(gear, obj);
  gear.pack.push(handle);
  return handle;
}

/* ------------------------------------------------------------------ */
/* inven_carry_num / object_copy_amt / gear_object_for_use             */
/* ------------------------------------------------------------------ */

/**
 * pack_slots_used (obj-gear.c L257): the number of pack slots occupied.
 * Upstream discounts equipped and quivered gear; here equipped objects are
 * not in `pack` and the quiver is DEFERRED, so this is simply pack.length.
 */
export function packSlotsUsed(gear: Gear): number {
  return gear.pack.length;
}

/**
 * inven_carry_num (obj-gear.c L749): how many of `obj` the pack can accept.
 * A free pack slot takes the whole incoming stack; otherwise the remainder
 * is squeezed into partially-full stackable slots. The quiver path is
 * DEFERRED (no quiver in this model), so num_to_quiver is always 0.
 */
export function invenCarryNum(
  gear: Gear,
  obj: GameObject,
  constants: Constants,
): number {
  /* Treasure can always be picked up (never reached via a store). */
  if (tvalIsMoney(obj.tval)) return obj.number;

  const nFreeSlot = constants.packSize - packSlotsUsed(gear);

  /* A free slot holds everything (quiver DEFERRED: nothing goes there). */
  if (nFreeSlot > 0) return obj.number;

  /* See if we can add to partially-full inventory slots. */
  let numLeft = obj.number;
  for (const handle of gear.pack) {
    const stack = gear.store.get(handle);
    if (stack && objectStackable(stack, obj, OSTACK_PACK)) {
      numLeft -= stack.kind.base.maxStack - stack.number;
      if (numLeft <= 0) break;
    }
  }

  return obj.number - Math.max(numLeft, 0);
}

/**
 * object_copy_amt (obj-pile.c L743): a fresh copy of `src` holding `amt`
 * items, with wand/staff charges and rod/activation timeouts scaled to the
 * split (source unchanged). The AVERAGE charge time is deterministic.
 */
export function objectCopyAmt(src: GameObject, amt: number): GameObject {
  const dest = objectCopy(src);
  dest.number = amt;

  if (tvalCanHaveCharges(src.tval)) {
    dest.pval = Math.trunc((src.pval * amt) / src.number);
  }

  if (tvalCanHaveTimeout(src.tval)) {
    /* randcalc(src->time, 0, AVERAGE). */
    const t = src.time;
    const chargeTime = t.base + Math.trunc((t.dice * (t.sides + 1)) / 2);
    const maxTime = chargeTime * amt;
    dest.timeout = src.timeout > maxTime ? maxTime : src.timeout;
  }

  return dest;
}

/** The detached result of gear_object_for_use. */
export interface GearForUse {
  /** The removed object (a split copy, or the excised original stack). */
  obj: GameObject;
  /** True when the whole stack was taken and its slot is now empty. */
  noneLeft: boolean;
}

/**
 * Detach `handle` (or the free equipment/pack slot holding it) from the
 * gear. A pack handle is removed from the ordered pack; an equipped handle
 * clears its body slot. Either way the handle leaves the store map.
 */
function gearExcise(gear: Gear, player: Player, handle: number): void {
  const pi = gear.pack.indexOf(handle);
  if (pi >= 0) {
    gear.pack.splice(pi, 1);
    gear.store.delete(handle);
    return;
  }
  const si = player.equipment.indexOf(handle);
  if (si >= 0) {
    player.equipment[si] = 0;
    gear.store.delete(handle);
  }
}

/**
 * gear_object_for_use (obj-gear.c L524): remove `amt` items of the gear
 * object referenced by `handle`, returning a detached object to hand off.
 * When part of a stack is taken, the remainder stays under `handle` and a
 * fresh split is returned (noneLeft=false); when the whole stack is taken,
 * the original is excised (noneLeft=true). The total_weight upkeep and the
 * knowledge twin are DEFERRED (see the module ledger).
 */
export function gearObjectForUse(
  gear: Gear,
  player: Player,
  handle: number,
  amt: number,
): GearForUse {
  const obj = gear.store.get(handle);
  if (!obj) throw new Error(`gearObjectForUse: no object for handle ${handle}`);

  const num = Math.min(amt, obj.number);

  /* Split off a usable object if we are not taking the whole stack. */
  if (obj.number > num) {
    const usable = objectSplit(obj, num);
    return { obj: usable, noneLeft: false };
  }

  /* Using the entire stack. */
  gearExcise(gear, player, handle);
  return { obj, noneLeft: true };
}

/* ------------------------------------------------------------------ */
/* wield_all                                                            */
/* ------------------------------------------------------------------ */

/**
 * Wield the pack object with the given handle into its liked slot. If the
 * stack has more than one item, one item is split off to wear and the
 * remainder (number - 1) stays in the pack under a new handle (upstream
 * object_split in wield_all / inven_wield). Returns the filled slot, or -1
 * if the object cannot be wielded or the slot is already occupied.
 *
 * object_learn_on_wield runs the instant the item is worn (as in wield_all
 * and inven_wield), so a worn item's modifier runes become known and its
 * pval bonuses go live at once. The equip_cnt UI counter is DEFERRED.
 */
export function wieldObject(
  gear: Gear,
  player: Player,
  handle: number,
  env?: import("../obj/knowledge").RuneEnv,
): number {
  const obj = gear.store.get(handle);
  if (!obj) return -1;

  const slot = wieldSlot(player.body, obj.tval, player.equipment);
  if (slot < 0 || slot >= player.body.count) return -1;
  if ((player.equipment[slot] ?? 0) !== 0) return -1;

  /* Split if necessary: all but one go back to the pack as a new stack. */
  if (obj.number > 1) {
    const remainder = objectSplit(obj, obj.number - 1);
    gear.pack.push(gearAdd(gear, remainder));
  }

  /* Remove the wielded handle from the pack and wear it. */
  const idx = gear.pack.indexOf(handle);
  if (idx >= 0) gear.pack.splice(idx, 1);
  player.equipment[slot] = handle;

  /* Learn the runes that wearing makes obvious (obj-knowledge.c wield_all
   * L494-495). With an env the full obvious-flag/curse learning runs; the
   * env-less path (birth outfit, worldless tests) learns the modifier
   * runes, so worn pval bonuses apply immediately either way. */
  objectLearnOnWield(player, obj, env);

  return slot;
}

/**
 * wield_all (player-birth.c L462-507): try to wield everything wieldable in
 * the pack. Scans a snapshot of the current pack handles (so the split-off
 * remainders added during the pass are not re-scanned, matching upstream's
 * deferred pile_insert_end), wielding each object whose liked slot is empty.
 */
export function wieldAll(gear: Gear, player: Player): void {
  const handles = [...gear.pack];
  for (const handle of handles) {
    const obj = gear.store.get(handle);
    if (!obj) continue;

    /* Make sure we can wield it into an empty slot. */
    const slot = wieldSlot(player.body, obj.tval, player.equipment);
    if (slot < 0 || slot >= player.body.count) continue;
    if ((player.equipment[slot] ?? 0) !== 0) continue;

    wieldObject(gear, player, handle);
  }
}

/* ------------------------------------------------------------------ */
/* player_outfit                                                        */
/* ------------------------------------------------------------------ */

/** Options for the birth starting kit. */
export interface OutfitOptions {
  /**
   * birth_start_kit (default true): with the full kit every start_item is
   * granted; without it only a single food and a single light source.
   */
  startKit?: boolean;
}

/**
 * player_outfit (player-birth.c L584-666): give the player their class
 * starting equipment and wield everything wieldable.
 *
 * For each class start_item: roll the count in [min, max] via the project
 * Rng (rand_range), look the kind up by tval/sval name, honour the start_kit
 * option, prep it with MINIMISE at level 0 (object_prep), set number and
 * ORIGIN_BIRTH, carry it (invenCarry), and finally wield_all.
 *
 * wield_all learns each worn item's modifier runes (object_learn_on_wield);
 * for a default class kit those items carry no modifiers, so obj_k stays
 * empty at birth exactly as upstream.
 *
 * DEFERRED (see the module ledger): the p->au -= object_value_real(obj, num)
 * starting-gold deduction (obj-value.c not ported); the eopts birth-option
 * exclusion (birth options not modelled - treated as no exclusions, which
 * equals upstream with default birth options); and the display half of the
 * obj-knowledge block (object_flavor_aware / object_set_base_known / obj->known).
 */
export function outfitPlayer(
  gear: Gear,
  player: Player,
  reg: ObjRegistry,
  rng: Rng,
  constants: Constants,
  opts: OutfitOptions = {},
): void {
  const startKit = opts.startKit ?? true;
  const limits: StackLimits = {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  };

  /* Currently carrying nothing (running total is owned by the calc/inventory
   * side, which is DEFERRED; we mirror only the reset upstream performs). */
  player.upkeep.totalWeight = 0;

  /* Modifier runes are learned per item at wield_all (below); the display
   * half of the knowledge block (flavor_aware / base_known) is DEFERRED. */

  /* Give the player starting equipment. */
  for (const si of player.cls.startItems) {
    let num = rng.randRange(si.min, si.max);

    const tval = tvalFindIdx(si.tval);
    if (tval < 0) throw new Error(`outfit: unknown tval ${si.tval}`);
    const sval = reg.lookupSval(tval, si.sval);
    if (sval < 0) throw new Error(`outfit: unknown sval ${si.tval}:${si.sval}`);
    const kind = reg.lookupKind(tval, sval);
    if (!kind) throw new Error(`outfit: no kind ${si.tval}:${si.sval}`);

    /* Without start_kit, only start with 1 food and 1 light. (Upstream
     * tval_is_food_k / tval_is_light_k are TV_FOOD / TV_LIGHT only.) */
    if (!startKit) {
      if (!tvalIsFood(tval) && !tvalIsLight(tval)) continue;
      num = 1;
    }

    /* DEFERRED: eopts birth-option exclusion (treated as no exclusions). */

    /* Prepare a new item. */
    const obj = objectPrep(rng, reg, constants, kind, 0, "minimise");
    obj.number = num;
    obj.origin = ORIGIN.BIRTH;

    /* Deduct the cost of the item from starting cash (player-birth.c L654).
     * object_value_real draws no RNG. Upstream prices from obj->known; the
     * port has no known twin, so it prices the real object - the same
     * approximation the store path uses (obj/value.ts). */
    player.au -= objectValueReal(reg, obj, obj.number);
    /* DEFERRED: object knowledge (obj->known / flavor_aware / base_known). */

    /* Carry the item. */
    invenCarry(gear, obj, limits);
  }

  /* Sanity check: never let the outfit drive starting gold negative
   * (player-birth.c L662). */
  if (player.au < 0) player.au = 0;

  /* Now try wielding everything. */
  wieldAll(gear, player);
}
