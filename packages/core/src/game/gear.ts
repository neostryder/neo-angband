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
 *   never overflows); the knowledge twin (obj->known) and equip_cnt UI
 *   counter; the take-off / inventory-command layer; and the quiver.
 */

import type { Constants } from "../constants";
import { ORIGIN, TV } from "../generated";
import type { Rng } from "../rng";
import type { ObjRegistry } from "../obj/bind";
import { tvalFindIdx } from "../obj/bind";
import type { GameObject } from "../obj/object";
import {
  distributeCharges,
  objectAbsorb,
  objectMergeable,
  OSTACK_PACK,
  tvalIsBodyArmor,
  tvalIsFood,
  tvalIsHeadArmor,
  tvalIsLight,
  tvalIsMeleeWeapon,
  tvalIsRing,
} from "../obj/object";
import type { StackLimits } from "../obj/object";
import { objectPrep } from "../obj/make";
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
 * src.number > amt (upstream assert).
 */
function objectSplit(src: GameObject, amt: number): GameObject {
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
/* wield_all                                                            */
/* ------------------------------------------------------------------ */

/**
 * Wield the pack object with the given handle into its liked slot. If the
 * stack has more than one item, one item is split off to wear and the
 * remainder (number - 1) stays in the pack under a new handle (upstream
 * object_split in wield_all / inven_wield). Returns the filled slot, or -1
 * if the object cannot be wielded or the slot is already occupied.
 *
 * The knowledge twin (object_learn_on_wield) and the equip_cnt UI counter
 * are DEFERRED (see the module ledger).
 */
export function wieldObject(gear: Gear, player: Player, handle: number): number {
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
 * DEFERRED (see the module ledger): the p->au -= object_value_real(obj, num)
 * starting-gold deduction (obj-value.c not ported); the eopts birth-option
 * exclusion (birth options not modelled - treated as no exclusions, which
 * equals upstream with default birth options); and the whole obj-knowledge
 * block (obj_k / object_flavor_aware / object_set_base_known).
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

  /* DEFERRED: the obj_k obvious-knowledge block (knowledge system). */

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

    /* DEFERRED: p->au -= object_value_real(obj, num) (obj-value.c). */
    /* DEFERRED: object knowledge (obj->known / flavor_aware / base_known). */

    /* Carry the item. */
    invenCarry(gear, obj, limits);
  }

  /* Now try wielding everything. */
  wieldAll(gear, player);
}
