/**
 * What the character would BE, wearing something else.
 *
 * ------------------------------------------------------------------
 * WHY THIS EXISTS
 * ------------------------------------------------------------------
 *
 * `calc_bonuses` (player/calcs.ts) answers "what is this character, in this
 * gear". Two consumers need the same answer for gear the character is not in:
 *
 *  1. An autoplayer deciding whether to wear, buy or sell a thing. Upstream's
 *     borg does exactly this by WIELDING the candidate, recomputing, and
 *     reverting (borg-power.c / borg_notice).
 *  2. A player asking what an item would do for them, which wants the whole
 *     difference and not a score - which resist went, what happened to mana,
 *     whether the weapon is now too heavy to swing properly.
 *
 * The trap either one falls into alone is summing the item's own bonuses. That
 * is a second implementation of calc_bonuses, it cannot see the interactions
 * (the STR ring that changes the blow count, the cuirass that costs a caster
 * mana, the weight that costs speed), and it drifts from the real derive with
 * nothing to notice. So this module runs the REAL derive, `update: false`, over
 * a hypothetical equipment array, and nothing in the live game is written.
 *
 * ------------------------------------------------------------------
 * WHERE THE DERIVE COMES FROM, AND WHY IT IS NOT BUILT HERE
 * ------------------------------------------------------------------
 *
 * `state.derivedFor` is installed by the session (session/game.ts wireGame),
 * which is the only place that holds the whole calc_bonuses options bag: the
 * bound timed-effect table and the curse registry travel with it. A derive
 * assembled here would have to guess at both, and a hypothetical loadout
 * measured with a thinner bag than the live one is worse than no answer - it
 * looks like an answer. So an absent `derivedFor` produces null.
 *
 * ------------------------------------------------------------------
 * WHAT IS AND IS NOT MODELLED
 * ------------------------------------------------------------------
 *
 * Modelled: the worn set, per body slot, through the engine's own wield_slot; the
 * carried weight, because the STR encumbrance penalty reads it and buying heavy
 * armour is exactly where that bites; max hitpoints (a CON change moves them) and
 * max mana with the armour encumbrance (a caster's real cost of plate).
 *
 * NOT modelled: anything that happens as a CONSEQUENCE of the change rather than
 * being the change - the gold a purchase costs, an inscription, learning a rune
 * by wearing the thing. Those are outcomes of the action, not of the loadout, and
 * a comparison that folded them in would be answering a different question.
 */

import { calcHitpoints } from "../player/calcs.js";
import type { PlayerState } from "../player/calcs.js";
import { maxManaFrom, wornArmorWeight } from "../player/spell.js";
import { derivedStatsView, diffDerivedStats } from "../player/loadout.js";
import { STAT } from "../generated/index.js";
import { toCombatState, weightLimit } from "../player/calcs.js";
import { gearGet, wieldSlot } from "../game/gear.js";
import { objectWeightOne } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import type { GameState } from "../game/context.js";
import { itemView, playerViewFor } from "./entity-views.js";
import type {
  AgentViewDeps,
  ItemView,
  LoadoutChange,
  LoadoutItemRef,
  LoadoutPlacement,
  LoadoutSimulation,
  LoadoutView,
} from "./types.js";

/** calc_bonuses for a loadout, as GameState.derivedFor supplies it. */
export type LoadoutDerive = (
  equipment: readonly (GameObject | null)[],
  totalWeight?: number,
) => PlayerState;

/** What simulateLoadout may be told rather than reading off the state. */
export interface LoadoutSimOptions {
  /**
   * The same AgentViewDeps the live view was built with, so the ItemViews in the
   * result carry the same `value` / `kindId` fields the live ones do. Omitted
   * fields degrade exactly as they do in perceive.
   */
  viewDeps?: AgentViewDeps;
  /**
   * The derive to use. Defaults to `state.derivedFor`, which the session
   * installs; supply it directly only in a test that has no session.
   */
  derive?: LoadoutDerive;
}

/**
 * One entry of the hypothetical carried set: the object, how many of it, and the
 * gear handle it came from (0 for something being acquired, which has none).
 */
interface Carried {
  readonly handle: number;
  readonly obj: GameObject;
  number: number;
}

/** The working loadout the change is applied to. */
interface Working {
  /** By body slot; null for an empty slot. */
  readonly equip: (Carried | null)[];
  /** The pack, in pack order. */
  readonly pack: Carried[];
  /** Total carried weight in tenth pounds (upstream p->upkeep->total_weight). */
  weight: number;
  /** References that named nothing (see LoadoutSimulation.unresolved). */
  readonly unresolved: LoadoutItemRef[];
  /** The view deps every ItemView built from this loadout is built with. */
  readonly deps: AgentViewDeps;
}

/** The live loadout as a Working, before any change is applied. */
function liveLoadout(state: GameState, deps: AgentViewDeps): Working {
  const p = state.actor.player;
  const equip = p.equipment.map((handle): Carried | null => {
    if (!handle) return null;
    const obj = gearGet(state.gear, handle);
    return obj ? { handle, obj, number: obj.number } : null;
  });
  const pack: Carried[] = [];
  for (const handle of state.gear.pack) {
    const obj = gearGet(state.gear, handle);
    if (obj) pack.push({ handle, obj, number: obj.number });
  }
  return {
    equip,
    pack,
    weight: p.upkeep.totalWeight,
    unresolved: [],
    deps,
  };
}

/** The object a reference names, or null (recorded as unresolved by the caller). */
function resolveRef(state: GameState, ref: LoadoutItemRef): GameObject | null {
  switch (ref.from) {
    case "gear":
      return gearGet(state.gear, ref.handle);
    case "store": {
      const store = (state.stores ?? [])[ref.store];
      return store?.stock[ref.index] ?? null;
    }
    case "object":
      return ref.object;
  }
}

/** object_weight_one for a stack of `n` (obj-gear.c's total_weight term). */
function stackWeight(state: GameState, obj: GameObject, n: number): number {
  return n * objectWeightOne(obj, state.gear.curses);
}

/** Take `n` of `handle` out of the working loadout entirely (a sale, a drop). */
function release(
  state: GameState,
  w: Working,
  handle: number,
  n: number | undefined,
): void {
  if (!handle) return;
  const slot = w.equip.findIndex((c) => c?.handle === handle);
  if (slot >= 0) {
    const worn = w.equip[slot];
    if (!worn) return;
    const take = Math.min(n ?? worn.number, worn.number);
    w.weight -= stackWeight(state, worn.obj, take);
    if (take >= worn.number) w.equip[slot] = null;
    else worn.number -= take;
    return;
  }
  const at = w.pack.findIndex((c) => c.handle === handle);
  if (at < 0) {
    w.unresolved.push({ from: "gear", handle });
    return;
  }
  const held = w.pack[at]!;
  const take = Math.min(n ?? held.number, held.number);
  w.weight -= stackWeight(state, held.obj, take);
  if (take >= held.number) w.pack.splice(at, 1);
  else held.number -= take;
}

/** Take a slot's contents off and put them in the pack (weight unchanged). */
function removeSlot(w: Working, slot: number): void {
  const worn = w.equip[slot];
  if (!worn) return;
  w.equip[slot] = null;
  w.pack.push(worn);
}

/**
 * Wield one reference. Resolves the slot through the engine's own wield_slot
 * over the HYPOTHETICAL occupancy, so the second ring of a pair goes to the
 * second ring slot exactly as it would in play.
 */
function wield(
  state: GameState,
  w: Working,
  ref: LoadoutItemRef,
): { slot: number; worn: Carried; displaced: Carried | null } | null {
  const obj = resolveRef(state, ref);
  if (!obj) {
    w.unresolved.push(ref);
    return null;
  }
  const body = state.actor.player.body;
  /* wield_slot reads occupancy off a handle array; a slot holding an object
     with no handle (a ware being bought) still has to read as full, so the
     synthetic 1 stands in for "occupied by something". */
  const occupancy = w.equip.map((c) => (c ? c.handle || 1 : 0));
  const slot = wieldSlot(body, obj.tval, occupancy);
  if (slot < 0 || slot >= body.count) {
    w.unresolved.push(ref);
    return null;
  }

  /* An item already in the pack MOVES; anything else is being acquired, and
     its weight joins the carried total. */
  const fromPack = w.pack.findIndex(
    (c) => ref.from === "gear" && c.handle === ref.handle,
  );
  let worn: Carried;
  if (fromPack >= 0) {
    const held = w.pack[fromPack]!;
    if (held.number > 1) {
      /* Wielding one of a stack leaves the rest in the pack. */
      held.number -= 1;
      worn = { handle: held.handle, obj, number: 1 };
    } else {
      w.pack.splice(fromPack, 1);
      worn = held;
      worn.number = 1;
    }
  } else if (ref.from === "gear" && w.equip.some((c) => c?.handle === ref.handle)) {
    /* Already worn: moving it to the slot wield_slot picks, weight unchanged. */
    const at = w.equip.findIndex((c) => c?.handle === ref.handle);
    worn = w.equip[at]!;
    w.equip[at] = null;
  } else {
    worn = { handle: 0, obj, number: 1 };
    w.weight += stackWeight(state, obj, 1);
  }

  const displaced = w.equip[slot] ?? null;
  if (displaced) w.pack.push(displaced);
  w.equip[slot] = worn;
  return { slot, worn, displaced };
}

/** Put `n` of a reference into the pack without wearing it (a purchase). */
function carry(
  state: GameState,
  w: Working,
  ref: LoadoutItemRef,
  n: number | undefined,
): void {
  const obj = resolveRef(state, ref);
  if (!obj) {
    w.unresolved.push(ref);
    return;
  }
  const count = Math.max(1, n ?? obj.number);
  const handle = ref.from === "gear" ? ref.handle : 0;
  const existing = handle ? w.pack.find((c) => c.handle === handle) : undefined;
  if (existing) existing.number += count;
  else w.pack.push({ handle, obj, number: count });
  w.weight += stackWeight(state, obj, count);
}

/** Apply the whole change, in the documented order. */
function applyChange(
  state: GameState,
  w: Working,
  change: LoadoutChange,
): LoadoutPlacement[] {
  for (const entry of change.release ?? []) {
    release(state, w, entry.handle, entry.number);
  }
  for (const slot of change.remove ?? []) {
    if (slot >= 0 && slot < w.equip.length) removeSlot(w, slot);
  }
  const placed: Array<{ slot: number; worn: Carried; displaced: Carried | null }> = [];
  for (const ref of change.wield ?? []) {
    const done = wield(state, w, ref);
    if (done) placed.push(done);
  }
  for (const entry of change.carry ?? []) {
    carry(state, w, entry.item, entry.number);
  }
  /* Placements are built last so `displaced` is described from the objects, not
     from a Carried whose count a later step may have changed. */
  return placed.map(({ slot, worn, displaced }) => ({
    slot,
    worn: viewOf(state, w, worn),
    displaced: displaced ? viewOf(state, w, displaced) : null,
  }));
}

/** One Carried as an ItemView, with its hypothetical stack count. */
function viewOf(state: GameState, w: Working, c: Carried): ItemView {
  return itemView(c.handle, c.obj, state, w.deps, c.number);
}

/** Derive and describe one working loadout. */
function describe(
  state: GameState,
  w: Working,
  derive: LoadoutDerive,
): LoadoutView {
  const p = state.actor.player;
  const equipObjects = w.equip.map((c) => c?.obj ?? null);
  const derived = derive(equipObjects, w.weight);
  const armorWeight = wornArmorWeight(p, equipObjects);
  const maxHp = calcHitpoints(
    p.playerHp[p.lev - 1] ?? p.hitdie,
    p.lev,
    derived.statInd[STAT.CON] ?? 0,
  );
  const maxSp = maxManaFrom(p, derived.statInd, armorWeight);
  /* calc_mana owns cumber_armor (player-calcs.c:1524-1529); the same predicate
     the session records after its own calc_mana call. */
  const cumberArmor =
    p.cls.magic.totalSpells > 0 &&
    Math.trunc((armorWeight - p.cls.magic.spellWeight) / 10) > 0;
  const stats = derivedStatsView(derived, {
    maxHp,
    maxSp,
    cumberArmor,
    totalWeight: w.weight,
    weightLimit: weightLimit(derived),
  });
  return {
    player: playerViewFor(state, w.deps, {
      playerState: derived,
      combat: toCombatState(derived),
      speed: derived.speed,
      light: derived.curLight,
      maxHp,
      maxSp,
    }),
    equipment: w.equip.map((c) => (c ? viewOf(state, w, c) : null)),
    inventory: w.pack.map((c) => viewOf(state, w, c)),
    stats,
  };
}

/**
 * Derive the character both as it stands and with `change` applied, and diff the
 * two. Returns null when the state has no `derivedFor` installed (a worldless
 * harness), because an approximate answer here is indistinguishable from a real
 * one at every call site.
 *
 * PURE: nothing on the GameState, the player, the gear or any object is written.
 * The derive runs with `update: false`, which is what keeps calc_bonuses' own two
 * faithful side effects (zeroing TMD_FASTCAST on a stun grade, the town-light
 * redraw flag) out of it.
 */
export function simulateLoadout(
  state: GameState,
  change: LoadoutChange,
  opts: LoadoutSimOptions = {},
): LoadoutSimulation | null {
  const derive = opts.derive ?? state.derivedFor;
  if (!derive) return null;
  const deps = opts.viewDeps ?? {};

  const before = describe(state, liveLoadout(state, deps), derive);

  const afterWork = liveLoadout(state, deps);
  const placements = applyChange(state, afterWork, change);
  const after = describe(state, afterWork, derive);

  return {
    before,
    after,
    delta: diffDerivedStats(before.stats, after.stats),
    placements,
    unresolved: afterWork.unresolved,
  };
}
