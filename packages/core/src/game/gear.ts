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
 *   inven_carry's merge-or-add with quiver stack-mode routing, wield_all's
 *   split-and-wear, player_outfit's start-item roll + prep + carry + wield
 *   (birth_start_kit + eopts exclusion honoured), the real quiver subsystem
 *   (object_is_in_quiver, preferred_quiver_slot, quiver_absorb_num,
 *   calc_inventory's quiver assignment, pack_slots_used quiver accounting),
 *   combine_pack + inven_can_stack_partial, and minus_ac armour damage.
 * - DEFERRED: the pack_size overflow enforcement (pack_overflow); the display
 *   knowledge twin (obj->known) and equip_cnt UI counter; the inven[] display
 *   reorder half of calc_inventory (gear.pack already IS the listing, unsorted
 *   here). Wielding DOES learn modifier runes (obj-knowledge.c
 *   object_learn_on_wield); see obj/knowledge.ts.
 */

import type { Constants } from "../constants";
import { ELEM, OF, ORIGIN, TV } from "../generated";
import type { Rng } from "../rng";
import type { ObjRegistry } from "../obj/bind";
import { tvalFindIdx } from "../obj/bind";
import type { GameObject } from "../obj/object";
import { objectLearnOnWield } from "../obj/knowledge";
import {
  distributeCharges,
  objectAbsorb,
  objectAbsorbPartial,
  objectMergeable,
  objectStackable,
  OSTACK_PACK,
  OSTACK_QUIVER,
  tvalCanHaveCharges,
  tvalCanHaveTimeout,
  tvalIsAmmo,
  tvalIsBodyArmor,
  tvalIsFood,
  tvalIsHeadArmor,
  tvalIsLight,
  tvalIsMeleeWeapon,
  tvalIsMoney,
  tvalIsRing,
} from "../obj/object";
import type { StackLimits } from "../obj/object";
import { EL_INFO_IGNORE } from "../obj/types";
import { objectPrep } from "../obj/make";
import { objectValueReal } from "../obj/value";
import { earlierObject } from "../player/calcs";
import type { EarlierObjectOpts } from "../player/calcs";
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
  /**
   * Ordered non-equipped handles: the port's stand-in for upstream's master
   * gear list minus the equipment (upstream p->gear minus body slots). This is
   * the raw storage ordering AND the pack listing; ammo/throwing handles that
   * calc_inventory has routed into the quiver stay in this list (exactly as an
   * upstream quiver object stays on p->gear) and are additionally referenced by
   * `quiver` below - use objectIsInQuiver to tell them apart.
   */
  pack: number[];
  /**
   * upkeep->quiver[z_info->quiver_size]: the COMPUTED quiver view, one handle
   * per slot (0 = empty), filled by calcInventory. Optional so that a Gear built
   * without it (e.g. a save-load reconstruction, before calcInventory runs)
   * type-checks; it is a derived view and is rebuilt by calcInventory rather
   * than persisted. Empty/absent means the pre-quiver behaviour (ammo behaves
   * as a plain pack stack). Kept on Gear alongside `pack` (the inven view's
   * home) rather than on Player, mirroring how the port already keeps the pack
   * listing here while Player holds only equipment[] handles.
   */
  quiver?: number[];
}

/** A fresh, empty gear store (empty quiver; calcInventory sizes it). */
export function newGear(): Gear {
  return { store: new Map<number, GameObject>(), next: 1, pack: [], quiver: [] };
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
/* Quiver membership and slot preference (obj-gear.c)                   */
/* ------------------------------------------------------------------ */

/**
 * object_is_in_quiver (obj-gear.c L163-174): is the object referenced by
 * `handle` currently held in one of the computed quiver slots? A zero handle
 * (empty slot / no object) is never in the quiver.
 */
export function objectIsInQuiver(gear: Gear, handle: number): boolean {
  if (handle === 0) return false;
  return (gear.quiver ?? []).includes(handle);
}

/**
 * preferred_quiver_slot (obj-gear.c L1396-1427): the quiver slot an object's
 * inscription asks for, or -1 when it is not quiver-appropriate or not
 * inscribed with a matching @f/@v (fire / throw) key. The fire key depends on
 * the keyset: 't' under rogue-like commands, else 'f'; the throw key is always
 * 'v' (upstream hardwires these because cmd_lookup_key is in the UI layer).
 */
export function preferredQuiverSlot(obj: GameObject, rogueLike = false): number {
  let desiredSlot = -1;
  if (obj.note && (tvalIsAmmo(obj.tval) || obj.flags.has(OF.THROWING))) {
    const fireKey = rogueLike ? "t" : "f";
    const throwKey = "v";
    let s = obj.note.indexOf("@");
    while (s !== -1) {
      const k = obj.note[s + 1];
      if (k === fireKey || k === throwKey) {
        /* s[2] - '0': the single digit slot after the key. */
        desiredSlot = (obj.note.charCodeAt(s + 2) || 0) - "0".charCodeAt(0);
        break;
      }
      s = obj.note.indexOf("@", s + 1);
    }
  }
  return desiredSlot;
}

/* ------------------------------------------------------------------ */
/* minus_ac (obj-gear.c L376-438)                                       */
/* ------------------------------------------------------------------ */

/** The non-armour equipment slot types minus_ac skips (obj-gear.c L387-391). */
function slotIsArmour(type: string | undefined): boolean {
  return (
    type !== undefined &&
    type !== "WEAPON" &&
    type !== "BOW" &&
    type !== "RING" &&
    type !== "AMULET" &&
    type !== "LIGHT"
  );
}

/** Optional message / naming hooks for minusAc. */
export interface MinusAcEnv {
  /** msg(): the "Your %s is damaged!" / "is unaffected!" lines. */
  msg?: (text: string) => void;
  /** object_desc(ODESC_BASE): the bare armour name; defaults to kind.name. */
  describe?: (obj: GameObject) => string;
  /** PU_BONUS trigger fired after a to_a decrement (calc_bonuses refresh). */
  updateBonuses?: () => void;
}

/**
 * minus_ac (obj-gear.c L376-438): acid has hit the player, so attempt to
 * damage a piece of worn armour. Counts the armour slots, draws one at random
 * with the exact upstream reverse one_in_(count--) scan, and (if that item can
 * still lose armour) either reports it resists (EL_INFO_IGNORE on ELEM_ACID)
 * or decrements its to_a and prints the damage message. Returns whether there
 * was any effect (a piece was picked and had ac + to_a > 0), matching upstream
 * so the caller can halve the elemental damage.
 *
 * The RNG draw order is preserved bit-for-bit: the forward count loop, then
 * the reverse pick loop consuming one_in_(count--) per armour slot until it
 * breaks. `obj->known->to_a = obj->to_a` (L425-426) is DEFERRED - the port has
 * no per-object known twin (obj-knowledge #4.8); obj_k->to_a is 1 at birth so
 * the real to_a is already the shown value.
 */
export function minusAc(
  player: Player,
  gear: Gear,
  rng: Rng,
  env: MinusAcEnv = {},
): boolean {
  const body = player.body;

  /* Avoid crash during monster power calculations (L382): no gear, no effect. */
  if (gear.pack.length === 0 && player.equipment.every((h) => h === 0)) {
    return false;
  }

  /* Count the armour slots (L384-395). */
  let count = 0;
  for (let i = 0; i < body.count; i++) {
    if (slotIsArmour(body.slots[i]?.type)) count++;
  }

  /* Pick one at random with the reverse one_in_(count--) scan (L397-407). */
  let picked = body.count;
  for (let i = body.count - 1; i >= 0; i--) {
    if (!slotIsArmour(body.slots[i]?.type)) continue;
    if (rng.oneIn(count--)) {
      picked = i;
      break;
    }
  }

  /* Get the item in the picked slot (L410). */
  const handle = picked < body.count ? (player.equipment[picked] ?? 0) : 0;
  const obj = handle !== 0 ? (gear.store.get(handle) ?? null) : null;

  /* If we can still damage the item (L412-433). */
  if (obj && obj.ac + obj.toA > 0) {
    const name = env.describe ? env.describe(obj) : obj.kind.name;
    const acidEl = obj.elInfo[ELEM.ACID];
    if (acidEl && (acidEl.flags & EL_INFO_IGNORE) !== 0) {
      env.msg?.(`Your ${name} is unaffected!`);
    } else {
      env.msg?.(`Your ${name} is damaged!`);
      obj.toA--;
      /* DEFERRED: obj->known->to_a = obj->to_a (no known twin, #4.8). */
      env.updateBonuses?.(); /* PU_BONUS */
    }
    /* There was an effect. */
    return true;
  }

  /* No damage or effect (L435-436). */
  return false;
}

/* ------------------------------------------------------------------ */
/* inven_carry                                                          */
/* ------------------------------------------------------------------ */

/**
 * inven_carry (obj-gear.c L821-925): add an object to the gear. If a
 * non-equipped stack is object_mergeable with the incoming object, object_absorb
 * into it and return that stack's handle; otherwise store the object under a
 * fresh gear handle and return it. The merge test uses OSTACK_QUIVER when the
 * candidate stack is currently in the quiver (obj-gear.c L832-834) and
 * OSTACK_PACK otherwise, so a quiver stack honours the stricter quiver caps.
 *
 * The subsequent calc_inventory (upstream's update_stuff after PU_INVEN) is a
 * SEPARATE step here - callers run calcInventory when they want the quiver
 * re-derived. The pack_size overflow enforcement (pack_overflow) is DEFERRED.
 */
export function invenCarry(
  gear: Gear,
  obj: GameObject,
  limits: StackLimits,
): number {
  /* Check for combining with an existing non-equipped stack. */
  for (const handle of gear.pack) {
    const stack = gear.store.get(handle);
    const mode = objectIsInQuiver(gear, handle) ? OSTACK_QUIVER : OSTACK_PACK;
    if (stack && objectMergeable(stack, obj, mode, limits)) {
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
 * pack_slots_used (obj-gear.c L257-296): the number of pack slots occupied.
 * Equipped items don't count (they are absent from `pack`); ammo / throwing
 * items assigned to the quiver aggregate by weighted count into quiver slots
 * of quiver_slot_size, so a non-empty quiver frees up whole pack slots. When
 * the quiver is empty this equals pack.length (every item is a pack slot).
 */
export function packSlotsUsed(gear: Gear, constants: Constants): number {
  let packSlots = 0;
  let quiverAmmo = 0;

  for (const handle of gear.pack) {
    const obj = gear.store.get(handle);
    if (!obj) continue;
    let found = false;
    if (tvalIsAmmo(obj.tval) || obj.flags.has(OF.THROWING)) {
      if (objectIsInQuiver(gear, handle)) {
        quiverAmmo +=
          obj.number * (tvalIsAmmo(obj.tval) ? 1 : constants.thrownQuiverMult);
        found = true;
      }
    }
    /* Count regular slots. */
    if (!found) packSlots++;
  }

  /* Full slots, plus one for any remainder. */
  packSlots += Math.trunc(quiverAmmo / constants.quiverSlotSize);
  if (quiverAmmo % constants.quiverSlotSize) packSlots++;

  return packSlots;
}

/**
 * quiver_absorb_num (obj-gear.c L649-744): how many of `obj` the quiver can
 * take, and how many additional pack slots that costs. Reads the current
 * computed quiver (gear.quiver) exactly as upstream reads p->upkeep->quiver.
 * `nAddPack` is the number of extra pack slots the quiver may claim; the return
 * carries the leftover (nAddPack minus the slots consumed) alongside nToQuiver.
 */
export function quiverAbsorbNum(
  gear: Gear,
  obj: GameObject,
  constants: Constants,
  nAddPack: number,
  rogueLike = false,
): { nToQuiver: number; nAddPack: number } {
  const ammo = tvalIsAmmo(obj.tval);

  /* Must be ammo or good for throwing (L655). */
  if (ammo || obj.flags.has(OF.THROWING)) {
    let quiverCount = 0;
    let spaceFree = 0;
    let nEmpty = 0;
    const desiredSlot = preferredQuiverSlot(obj, rogueLike);
    let displaces = false;
    const qSize = constants.quiverSize;
    const qSlot = constants.quiverSlotSize;
    const quiver = gear.quiver ?? [];

    /* Count the current space this object could go into (L660-710). */
    for (let i = 0; i < qSize; i++) {
      const qHandle = quiver[i] ?? 0;
      const quiverObj = qHandle !== 0 ? gear.store.get(qHandle) : undefined;
      if (quiverObj) {
        const mult = tvalIsAmmo(quiverObj.tval) ? 1 : constants.thrownQuiverMult;
        quiverCount += quiverObj.number * mult;
        if (objectStackable(quiverObj, obj, OSTACK_PACK)) {
          spaceFree += qSlot - quiverObj.number * mult;
        } else if (
          desiredSlot === i &&
          preferredQuiverSlot(quiverObj, rogueLike) !== i
        ) {
          /* The added object prefers this slot, but it is occupied by a stack
           * that could be displaced elsewhere if a slot is available. */
          displaces = true;
          if (ammo) {
            spaceFree += qSlot - quiverObj.number * mult;
          } else {
            spaceFree += qSlot;
          }
        }
      } else {
        nEmpty++;
        /* Ammo fits any empty slot; a non-ammo throwing item only its
         * preferred slot (L699-708). */
        if (ammo || desiredSlot === i) {
          spaceFree += qSlot;
        }
      }
    }

    /* Only addable if there is free space and we either displace a pile with an
     * empty slot available or don't displace at all (L712-738). */
    if (spaceFree && ((displaces && nEmpty) || !displaces)) {
      const mult = ammo ? 1 : constants.thrownQuiverMult;
      const remainder = quiverCount % qSlot;
      let limitFromPack = remainder ? qSlot - remainder : 0;
      if (nAddPack > 0) limitFromPack += nAddPack * qSlot;

      spaceFree = Math.min(spaceFree, limitFromPack);
      const nToQuiver = Math.min(obj.number, Math.trunc(spaceFree / mult));
      const usedPack =
        nAddPack -
        Math.trunc((nToQuiver * mult + qSlot - 1 - remainder) / qSlot);
      return { nToQuiver, nAddPack: usedPack };
    }
  }

  /* Not suitable for the quiver or no space (L742-743). */
  return { nToQuiver: 0, nAddPack };
}

/**
 * inven_carry_num (obj-gear.c L749-780): how many of `obj` the gear can accept
 * across quiver and pack. The quiver absorbs what it can first; then a free
 * pack slot takes the rest, or the remainder squeezes into partially-full
 * stackable pack slots.
 */
export function invenCarryNum(
  gear: Gear,
  obj: GameObject,
  constants: Constants,
): number {
  /* Treasure can always be picked up (never reached via a store). */
  if (tvalIsMoney(obj.tval)) return obj.number;

  const nFreeSlot = constants.packSize - packSlotsUsed(gear, constants);

  /* Absorb as many as we can in the quiver (L760). quiver_absorb_num DECREMENTS
   * the free-slot count by the pack slots the quiver expands into (via
   * &n_free_slot); the port returns that decremented value as nAddPack. GR-01:
   * the >0 test must use the decremented nAddPack, not the pre-call nFreeSlot,
   * or capacity is over-reported when the quiver eats free pack slots but still
   * cannot hold the whole stack. */
  const { nToQuiver, nAddPack } = quiverAbsorbNum(gear, obj, constants, nFreeSlot);

  /* The quiver will get everything, or the pack can hold what's left (L763). */
  if (nToQuiver === obj.number || nAddPack > 0) return obj.number;

  /* See if we can add to partially-full inventory slots (L767-776). GR-02:
   * upstream iterates p->upkeep->inven[], which EXCLUDES ammo already sitting
   * in the quiver; gear.pack still carries those handles, so a stackable
   * quiver ammo stack would be double-counted as pack free space. Skip any
   * handle that is in the quiver. */
  let numLeft = obj.number - nToQuiver;
  for (const handle of gear.pack) {
    if (objectIsInQuiver(gear, handle)) continue;
    const stack = gear.store.get(handle);
    if (stack && objectStackable(stack, obj, OSTACK_PACK)) {
      numLeft -= stack.kind.base.maxStack - stack.number;
      if (numLeft <= 0) break;
    }
  }

  return obj.number - Math.max(numLeft, 0);
}

/* ------------------------------------------------------------------ */
/* calc_inventory (player-calcs.c) and combine_pack (obj-gear.c)        */
/* ------------------------------------------------------------------ */

/**
 * Hooks calc_inventory / combine_pack need beyond the gear: the keyset (for
 * preferred_quiver_slot), the earlier_object tiebreak inputs (ammo_tval /
 * object_value / awareness / browsability), and the reorder messages.
 */
export interface CalcInventoryOpts extends EarlierObjectOpts {
  /** rogue_like_commands: the fire key preferred_quiver_slot looks for. */
  rogueLike?: boolean;
  /** character_dungeon: gates the "You re-arrange your quiver." message. */
  characterDungeon?: boolean;
  /** msg(): the re-arrange / combine notices. */
  msg?: (text: string) => void;
}

/** Build EarlierObjectOpts (ammo tiebreak) from the calc-inventory opts. */
function earlierOpts(opts: CalcInventoryOpts): EarlierObjectOpts {
  const e: EarlierObjectOpts = { store: false };
  if (opts.ammoTval !== undefined) e.ammoTval = opts.ammoTval;
  if (opts.objectValue) e.objectValue = opts.objectValue;
  if (opts.isAware) e.isAware = opts.isAware;
  if (opts.canBrowse) e.canBrowse = opts.canBrowse;
  return e;
}

/**
 * calc_inventory (player-calcs.c:1023-1238), quiver half: rebuild gear.quiver
 * from the current non-equipped gear. First place inscribed items in their
 * preferred slots (splitting a stack that overflows quiver_slot_size, with the
 * excess going back to the pack), then fill the remaining slots in earlier_object
 * order with ammo. The pack/inven[] array-building half of upstream is a no-op
 * here: gear.pack already IS the ordered non-equipped listing and is not
 * re-sorted (display ordering is a UI concern).
 *
 * Split remainders are appended to gear.pack via object_split, exactly as
 * upstream's gear_insert_end. `n_stack_split <= n_pack_remaining` guards splits
 * so the pack can overflow by at most one slot, matching upstream.
 */
export function calcInventory(
  gear: Gear,
  constants: Constants,
  opts: CalcInventoryOpts = {},
): void {
  const qSize = constants.quiverSize;
  const qSlot = constants.quiverSlotSize;
  const rogueLike = opts.rogueLike ?? false;
  let nStackSplit = 0;
  const nPackRemaining = constants.packSize - packSlotsUsed(gear, constants);

  /* Copy the current quiver, then empty it (L1053-1061). */
  const oldQuiver: number[] = [];
  for (let i = 0; i < qSize; i++) oldQuiver[i] = gear.quiver?.[i] ?? 0;
  const quiver = new Array<number>(qSize).fill(0);
  gear.quiver = quiver;

  const assigned = new Set<number>();

  /* Fill quiver.  First, allocate inscribed items (L1063-1117). */
  for (const handle of [...gear.pack]) {
    const current = gear.store.get(handle);
    if (!current) continue;
    const prefslot = preferredQuiverSlot(current, rogueLike);
    if (prefslot >= 0 && prefslot < qSize && (quiver[prefslot] ?? 0) === 0) {
      const mult = tvalIsAmmo(current.tval) ? 1 : constants.thrownQuiverMult;
      let toQuiver = false;
      if (current.number * mult <= qSlot) {
        toQuiver = true;
      } else {
        const nsplit = Math.trunc(qSlot / mult);
        if (nsplit > 0 && nStackSplit <= nPackRemaining) {
          /* Split off the portion that goes to the pack; the quiver stack is
           * earlier in the gear list so it stays preferred (L1091-1102). */
          const rem = objectSplit(current, current.number - nsplit);
          gear.pack.push(gearAdd(gear, rem));
          nStackSplit++;
          toQuiver = true;
        }
      }
      if (toQuiver) {
        quiver[prefslot] = handle;
        assigned.add(handle);
      }
    }
  }

  /* Now fill the rest of the slots in order (L1119-1172). */
  for (let i = 0; i < qSize; i++) {
    if ((quiver[i] ?? 0) !== 0) continue;

    let first: GameObject | null = null;
    let firstHandle = 0;
    for (const handle of gear.pack) {
      if (assigned.has(handle)) continue;
      const current = gear.store.get(handle);
      if (!current || !tvalIsAmmo(current.tval)) continue;
      /* Only assign if, when a split is needed, there is room for it. */
      if (
        current.number <= qSlot ||
        (qSlot > 0 && nStackSplit <= nPackRemaining)
      ) {
        if (earlierObject(first, current, earlierOpts(opts))) {
          first = current;
          firstHandle = handle;
        }
      }
    }

    /* Nothing left in the gear. */
    if (!first) break;

    /* Put it in the slot, splitting (if needed) to fit (L1159-1168). */
    if (first.number > qSlot) {
      const rem = objectSplit(first, first.number - qSlot);
      gear.pack.push(gearAdd(gear, rem));
      nStackSplit++;
    }
    quiver[i] = firstHandle;
    assigned.add(firstHandle);
  }

  /* Note reordering (L1174-1182). */
  if (opts.characterDungeon) {
    for (let i = 0; i < qSize; i++) {
      if ((oldQuiver[i] ?? 0) !== 0 && quiver[i] !== oldQuiver[i]) {
        opts.msg?.("You re-arrange your quiver.");
        break;
      }
    }
  }
}

/**
 * inven_can_stack_partial (obj-gear.c L1183-1236): can obj1 and obj2 be merged
 * into two uneven stacks, with obj1 the (maximised) leading stack? Refuses when
 * obj1 is already at its per-stack limit, and (for a quiver->pack move) when the
 * quiver has no room, to avoid combining then re-splitting in calc_inventory.
 */
function invenCanStackPartial(
  gear: Gear,
  obj1: GameObject,
  obj2: GameObject,
  mode1: number,
  mode2: number,
  constants: Constants,
): boolean {
  const cmode = mode1 | mode2;
  if (!objectStackable(obj1, obj2, cmode)) return false;

  /* Verify the numbers suit uneven stacks (L1196-1233). OSTACK_STORE absorbs
   * without limit; the port's combine_pack never passes it. */
  if (mode1 & OSTACK_QUIVER) {
    const qlimit = Math.trunc(
      constants.quiverSlotSize /
        (tvalIsAmmo(obj1.tval) ? 1 : constants.thrownQuiverMult),
    );
    if (obj1.number === qlimit) return false;
    /* Moving items INTO the quiver: also check the overall quiver limits. */
    if (mode2 & ~OSTACK_QUIVER) {
      const nFreeSlot = constants.packSize - packSlotsUsed(gear, constants);
      const { nToQuiver } = quiverAbsorbNum(gear, obj2, constants, nFreeSlot);
      if (nToQuiver <= 0) return false;
    }
  } else if (obj1.number === obj1.kind.base.maxStack) {
    return false;
  }

  return true;
}

/**
 * combine_pack (obj-gear.c L1242-1323): sweep the gear from the back, merging
 * each stack fully into an earlier compatible stack where possible, else moving
 * items between stacks into two uneven stacks (inven_can_stack_partial). Runs
 * calc_inventory afterward. Returns whether any full combine happened (upstream
 * shows "You combine some items in your pack." and disables command repeat).
 */
export function combinePack(
  gear: Gear,
  constants: Constants,
  opts: CalcInventoryOpts = {},
): boolean {
  const limits: StackLimits = {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  };
  let displayMessage = false;

  /* Combine the pack (backwards) over a snapshot; removals mutate gear.pack. */
  for (const h1 of [...gear.pack].reverse()) {
    const obj1 = gear.store.get(h1);
    if (!obj1) continue;
    const idx1 = gear.pack.indexOf(h1);
    if (idx1 < 0) continue;

    /* Scan the items above obj1 (L1256). */
    for (let k = 0; k < idx1; k++) {
      const h2 = gear.pack[k]!;
      const obj2 = gear.store.get(h2);
      if (!obj2) continue;
      const mode2 = objectIsInQuiver(gear, h2) ? OSTACK_QUIVER : OSTACK_PACK;

      if (objectMergeable(obj2, obj1, mode2, limits)) {
        objectAbsorb(obj2, obj1, ORIGIN.MIXED);
        gear.pack.splice(idx1, 1);
        gear.store.delete(h1);
        displayMessage = true;
        break;
      }

      const mode1 = objectIsInQuiver(gear, h1) ? OSTACK_QUIVER : OSTACK_PACK;
      if (invenCanStackPartial(gear, obj2, obj1, mode2, mode1, constants)) {
        /* Shuffling items between stacks - no message (L1282-1287). */
        objectAbsorbPartial(obj2, obj1, mode2, mode1, limits, ORIGIN.MIXED);
        break;
      }
    }
  }

  calcInventory(gear, constants, opts);

  if (displayMessage) opts.msg?.("You combine some items in your pack.");
  return displayMessage;
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
  /* Clear any stale quiver reference (calc_inventory rebuilds it). */
  if (gear.quiver) {
    const qi = gear.quiver.indexOf(handle);
    if (qi >= 0) gear.quiver[qi] = 0;
  }

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
   * birth_start_kit: with the full kit every start_item is granted; without it
   * only a single food and a single light source. An explicit value overrides
   * the option lookup; when omitted, it is read from `opt("birth_start_kit")`
   * if `opt` is supplied, else defaults to true (player-birth.c L612).
   */
  startKit?: boolean;
  /**
   * OPT(p, name): the player's birth-option accessor, used to honour
   * birth_start_kit (gap 1.6) and the per-start-item eopts birth-option
   * exclusion (gap 1.8, player-birth.c L619-637). Absent = no options set,
   * i.e. full kit and no exclusions (equivalent to upstream's defaults).
   */
  opt?: (name: string) => boolean;
}

/**
 * Evaluate a start_item's eopts birth-option exclusion (player-birth.c
 * L619-637): each token is an option name, optionally "NOT-" prefixed
 * (init.c L3619-3634 stores +ind / -ind). A plain option excludes the item
 * when it is SET; a NOT- option excludes it when it is UNSET. Returns true if
 * the item should be included. With no accessor, nothing is excluded.
 */
function startItemIncluded(
  eopts: readonly string[],
  opt: ((name: string) => boolean) | undefined,
): boolean {
  if (eopts.length === 0 || !opt) return true;
  for (const token of eopts) {
    const negated = token.startsWith("NOT-");
    const name = negated ? token.slice(4) : token;
    if (negated) {
      if (!opt(name)) return false;
    } else {
      if (opt(name)) return false;
    }
  }
  return true;
}

/**
 * player_outfit (player-birth.c L584-666): give the player their class
 * starting equipment and wield everything wieldable.
 *
 * For each class start_item: roll the count in [min, max] via the project
 * Rng (rand_range), look the kind up by tval/sval name, honour birth_start_kit
 * (gap 1.6) and the eopts birth-option exclusion (gap 1.8), prep it with
 * MINIMISE at level 0 (object_prep), set number and ORIGIN_BIRTH, carry it
 * (invenCarry), and finally wield_all.
 *
 * wield_all learns each worn item's modifier runes (object_learn_on_wield);
 * for a default class kit those items carry no modifiers, so obj_k stays
 * empty at birth exactly as upstream.
 *
 * DEFERRED (see the module ledger): the display half of the obj-knowledge
 * block (object_flavor_aware / object_set_base_known / obj->known); and the
 * post-outfit calc_inventory (the caller runs it once the quiver is wired).
 */
export function outfitPlayer(
  gear: Gear,
  player: Player,
  reg: ObjRegistry,
  rng: Rng,
  constants: Constants,
  opts: OutfitOptions = {},
): void {
  const startKit =
    opts.startKit ?? (opts.opt ? opts.opt("birth_start_kit") : true);
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

    /* Exclude if configured to do so based on birth options (player-birth.c
     * L619-637). RNG order is preserved: rand_range(num) is drawn above, before
     * any continue, exactly as upstream. */
    if (!startItemIncluded(si.eopts, opts.opt)) continue;

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
