/**
 * Pickup commands, ported from reference/src/cmd-pickup.c (Angband 4.2.6):
 * gold pickup, the inscription-driven auto-pickup rules (!g / =g / =g<n>),
 * partial pickup into the pack, do_autopickup on stepping, and the 'g'et
 * command, wired into the action registry.
 *
 * Energy accounting: upstream queues CMD_AUTOPICKUP as a separate command
 * after a step, charging picked * move_energy / 10 (capped at move_energy)
 * on that later command. The port's command provider is injected (the
 * engine cannot push commands), so walkAction adds the same capped cost to
 * the step's energy via the state.autoPickup hook - the total energy spent
 * is identical, only the single-command split differs (ledgered).
 *
 * Unported-subsystem seams (inert defaults): isIgnored (obj-ignore #24),
 * chooseItem (the multi-object pickup menu, ui #25 - defaults to the pile
 * head when unwired, so 'g' picks one item per press; packages/web/src's
 * pickupCmd wires a real lettered picker, reusing the same selectFromMenu
 * as the other item menus), messages/disturb hooks, and square_know_pile /
 * OFLOOR_VISIBLE marking (knowledge #24 - everything on the grid is visible).
 *
 * playerPickupAux calls object_touch (obj-knowledge.c L960-972) when an object
 * enters the pack: it marks the object ASSESSED (revealing its combat bracket
 * and artifact name) and fires state.onArtifactFound (history_find_artifact).
 * Find-on-sight is also wired now: square_know_pile's reduced port
 * (game/known.ts) touches the pile on the player's own grid, so an artifact is
 * found the instant its grid becomes known, not only on pickup.
 * historyFindArtifact's per-aidx de-dupe keeps both paths safe.
 */

import type { Constants } from "../constants.js";
import { PF } from "../generated/index.js";
import type { GameObject, StackLimits } from "../obj/object.js";
import {
  OSTACK_PACK,
  objectPackTotal,
  objectStackable,
  tvalIsMoney,
  tvalIsMushroom,
  tvalIsZapper,
} from "../obj/object.js";
import { objectTouch } from "../obj/known-object.js";
import { ODESC } from "../obj/desc.js";
import { NOOP_FLAVOR_AWARE_DEPS } from "../obj/knowledge.js";
import type { GameState } from "./context.js";
import { describeObject } from "./describe.js";
import { floorExcise, floorObjectForUse, floorPile } from "./floor.js";
import {
  gearGet,
  invenCarryNum,
  invenCarryResult,
  packTotalSuppressed,
  packTotalView,
} from "./gear.js";
import { gearToLabel } from "./project-obj.js";
import type { ActionRegistry } from "./player-turn.js";

/** Hooks and options for the pickup routines; every slot is optional. */
export interface PickupEnv {
  /** ignore_item_ok (obj-ignore.c, #24). Default: nothing is ignored. */
  isIgnored?: (obj: GameObject) => boolean;
  /** OPT(player, pickup_always). Shipped default false. */
  pickupAlways?: boolean;
  /** OPT(player, pickup_inven). Shipped default true. */
  pickupInven?: boolean;
  /** get_item over the floor list (the pickup menu, ui #25). */
  chooseItem?: (list: readonly GameObject[]) => GameObject | null;
  /**
   * get_quantity(NULL, max) on a PARTIAL pickup (cmd-pickup.c L270): only some
   * of the stack fits, so upstream asks how much of it to take. Answering 0
   * (which ESCAPE gives) abandons the pickup - but not the turn, since
   * player_pickup_item has already counted the object (L389).
   *
   * With no hook the whole carryable amount is taken, which is what a headless
   * caller (the borg, the agent seam, a test) wants: upstream's default answer
   * is 1, but a caller with no way to answer would then never make progress.
   */
  getQuantity?: (max: number) => number;
  /** Gold was picked up (message/sound hook). */
  onGold?: (total: number, name: string, singleKind: boolean) => void;
  /**
   * An object entered the pack: the message hook receives the finished
   * inven_carry line ("You have 5 Potions of Cure Light Wounds (a)."), built
   * from the MERGED pack stack so it reports the combined count and slot letter
   * (obj-gear.c:893-921), not the bare floor object.
   */
  onPickup?: (msg: string) => void;
  /** disturb(player). */
  disturb?: () => void;
}

/** What the pickup routines need from the binder. */
export interface PickupDeps {
  /** Bound constants (pack_size for inven_carry_num, quiver limits). */
  constants: Constants;
  env?: PickupEnv;
  /**
   * update_stuff's PU_INVEN after inven_carry (obj-gear.c:889-891 sets PU_INVEN
   * and then calls update_stuff itself): rebuild the computed quiver so picked-up
   * ammo is routed out of the pack and into the quiver, exactly as the
   * wield/takeoff/drop/store paths do. Without it, shots/arrows/bolts sit in the
   * pack until some later gear change forces a calc_inventory.
   *
   * Called once per CARRIED OBJECT, before that object's "You have %s (%c)."
   * message - not once per command. That is where upstream calls it (L891, four
   * lines above the message at L893-921) and the ordering is the whole point: the
   * %c is gear_to_label of the sorted upkeep->inven[] listing, so a label read
   * before the rebuild names the pre-pickup listing. It was previously invoked
   * once per command, after every message, which is what let a picked-up scroll be
   * announced at one letter and be found at another.
   */
  refreshInventory?: () => void;
}

function stackLimits(constants: Constants): StackLimits {
  return {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  };
}

/** check_for_inscrip (obj-util.c): occurrences of `inscrip` in the note. */
export function checkForInscrip(obj: GameObject, inscrip: string): number {
  if (!obj.note) return 0;
  let n = 0;
  let at = obj.note.indexOf(inscrip);
  while (at >= 0) {
    n++;
    at = obj.note.indexOf(inscrip, at + 1);
  }
  return n;
}

/**
 * check_for_inscrip_with_int: occurrences of `inscrip` immediately followed
 * by a digit; `value` is the integer after the first such occurrence.
 */
export function checkForInscripWithInt(
  obj: GameObject,
  inscrip: string,
): { count: number; value: number } {
  if (!obj.note) return { count: 0, value: 0 };
  let n = 0;
  let value = 0;
  let at = obj.note.indexOf(inscrip);
  while (at >= 0) {
    const rest = obj.note.slice(at + inscrip.length);
    if (/^\d/.test(rest)) {
      if (n === 0) value = parseInt(rest, 10);
      n++;
    }
    at = obj.note.indexOf(inscrip, at + 1);
  }
  return { count: n, value };
}

/** find_stack_object_in_inventory: pack stacks similar to obj, in order. */
function packStacksSimilarTo(
  state: GameState,
  obj: GameObject,
): GameObject[] {
  const out: GameObject[] = [];
  for (const handle of state.gear.pack) {
    const stack = state.gear.store.get(handle);
    if (stack && objectStackable(stack, obj, OSTACK_PACK)) out.push(stack);
  }
  return out;
}

/**
 * player_pickup_gold: pick up all gold at the player's grid, effortlessly.
 * Returns the total picked up (already added to p.au).
 */
export function playerPickupGold(state: GameState, env: PickupEnv = {}): number {
  const grid = state.actor.grid;
  let totalGold = 0;
  let name = "";
  let verbal = false;
  let atMostOne = true;

  for (const obj of [...floorPile(state, grid)]) {
    if (!tvalIsMoney(obj.tval)) continue;

    /* Multiple types if we have a second name, otherwise record the name. */
    if (totalGold && obj.kind.name !== name) atMostOne = false;
    else name = obj.kind.name;

    /* Remember whether feedback message is in order. */
    if (!env.isIgnored?.(obj)) verbal = true;

    totalGold += obj.pval;
    floorExcise(state, grid, obj);
  }

  if (totalGold) {
    state.actor.player.au += totalGold;
    if (verbal) env.onGold?.(totalGold, name, atMostOne);
  }
  return totalGold;
}

/**
 * auto_pickup_okay: how many of a floor object to pick up automatically -
 * pack capacity gated by the !g / =g / =g<n> inscriptions and the
 * pickup_always / pickup_inven options.
 */
export function autoPickupOkay(
  state: GameState,
  obj: GameObject,
  deps: PickupDeps,
): number {
  const env = deps.env ?? {};
  const num = invenCarryNum(state.gear, obj, deps.constants);
  if (!num) return 0;

  if (env.pickupAlways ?? state.options?.get("pickup_always") ?? false)
    return num;
  if (checkForInscrip(obj, "!g")) return 0;

  const objHasAuto = checkForInscrip(obj, "=g");
  const objMax = checkForInscripWithInt(obj, "=g");
  const objMaxauto = objMax.count ? objMax.value : Number.MAX_SAFE_INTEGER;
  if (objHasAuto > objMax.count) return num;

  if (
    (env.pickupInven ?? state.options?.get("pickup_inven") ?? true) ||
    objMax.count
  ) {
    const matches = packStacksSimilarTo(state, obj);
    const gearObj = matches[0];
    if (!gearObj) {
      if (objMax.count) return Math.min(num, objMaxauto);
      return 0;
    }
    if (!checkForInscrip(gearObj, "!g")) {
      const gearHasAuto = checkForInscrip(gearObj, "=g");
      const gearMax = checkForInscripWithInt(gearObj, "=g");
      if (gearHasAuto > gearMax.count) return num;
      if (objMax.count || gearMax.count) {
        /* Use the pack inscription if have both. */
        const maxNum = gearMax.count ? gearMax.value : objMaxauto;
        let packNum = 0;
        for (const stack of matches) packNum += stack.number;
        if (packNum >= maxNum) return 0;
        return Math.min(num, maxNum - packNum);
      }
      return num;
    }
  }

  return 0;
}

/**
 * player_pickup_aux: move a floor object (or part of it) into the pack.
 * The caller has confirmed inven_carry_num > 0.
 */
function playerPickupAux(
  state: GameState,
  obj: GameObject,
  autoMax: number,
  deps: PickupDeps,
): void {
  const env = deps.env ?? {};
  let max = invenCarryNum(state.gear, obj, deps.constants);
  if (max === 0) throw new Error(`Failed pickup of ${obj.kind.name}`);

  /* Allow auto-pickup to limit the number if it wants to. */
  if (autoMax && max > autoMax) max = autoMax;

  const limits = stackLimits(deps.constants);
  let handle: number;
  let combining = false;
  if (max === obj.number) {
    if (obj.grid) floorExcise(state, obj.grid, obj);
    obj.grid = null;
    ({ handle, combining } = invenCarryResult(state.gear, obj, limits));
  } else {
    /* Partial pickup (cmd-pickup.c L262-274): an auto-pickup limit answers for
     * itself, otherwise upstream asks - get_quantity(NULL, max) - and a 0
     * answer abandons the pickup. */
    const num = autoMax || (env.getQuantity?.(max) ?? max);
    if (num <= 0) return;
    const { usable } = floorObjectForUse(state, obj, num);
    ({ handle, combining } = invenCarryResult(state.gear, usable, limits));
  }
  /* object_touch (obj-knowledge.c L960-972; cmd-pickup.c L322 also touches the
   * grid pile on pickup): mark the object ASSESSED so it reveals its combat
   * bracket and, if an artifact, its name on entry to the pack; auto-notice the
   * artifact and log the find (history_find_artifact). onArtifactFound is read
   * through the state-level hook (not PickupEnv) so it survives a later
   * installPickup call that only supplies message hooks (main.ts's "reinstall").
   * (ASSESSED is idempotent, so re-touching an item already seen on the grid via
   * squareKnowPile is harmless.) */
  objectTouch(obj, { onArtifactFound: () => state.onArtifactFound?.(obj.artifact!) });

  /*
   * Hobbits ID mushrooms on pickup, gnomes ID wands and staffs on pickup
   * (obj-gear.c:879-886). Uses tvalIsMushroom / tvalIsZapper so those
   * predicates sit on the live path (W2-012 / W2-013). No RNG.
   */
  const stack = gearGet(state.gear, handle);

  /* apply_autoinscription (obj-gear.c:868): inven_carry autoinscribes in its
   * NON-combining branch only - an object absorbed into an existing stack keeps
   * that stack's inscription. This is the pickup half of the autoinscription
   * story; without it a registered note only landed on the explicit `{`
   * autoinscribe command. */
  if (!combining && stack) state.autoinscribeObject?.(stack);

  if (!combining && stack && state.flavorKnown && !state.flavorKnown.isAware(stack.kind)) {
    const p = state.actor.player;
    const pflags = state.playerState?.pflags ?? p.race.pflags;
    const hasMushroom =
      pflags.has(PF.KNOW_MUSHROOM) || p.cls.pflags.has(PF.KNOW_MUSHROOM);
    const hasZapper =
      pflags.has(PF.KNOW_ZAPPER) || p.cls.pflags.has(PF.KNOW_ZAPPER);
    const flavorDeps = state.flavorAwareDeps ?? NOOP_FLAVOR_AWARE_DEPS;
    if (hasMushroom && tvalIsMushroom(stack.tval)) {
      state.flavorKnown.objectFlavorAware(stack.kind, flavorDeps);
      env.onPickup?.("Mushrooms for breakfast!");
    } else if (hasZapper && tvalIsZapper(stack.tval)) {
      state.flavorKnown.objectFlavorAware(stack.kind, flavorDeps);
    }
  }

  /* inven_carry's own "You have %s (%c)." message (obj-gear.c:893-921): describe
   * the MERGED pack stack so the count and slot letter reflect the combined
   * total (e.g. "You have 5 Potions of Cure Light Wounds (a).") rather than the
   * bare floor object ("You have a Potion...").
   *
   * The count is the AGGREGATE across every like stack in the pack
   * (object_pack_total, L908), not this stack's own number, and the letter is
   * the FIRST such stack's - so five flasks split over slots c and f read
   * "You have 5 Flasks of oil (1st c)." Suppressed for charge/recharge items,
   * whose notice belongs to one stack (L899-905); note inven_carry alone omits
   * the object_is_equipped arm of that test, because a just-carried object
   * cannot be equipped. */
  if (stack) {
    /* update_stuff after PU_INVEN (obj-gear.c:889-891), and it happens HERE -
     * before the message, not after the command - because the (%c) below is
     * gear_to_label of the sorted upkeep->inven[] listing. Refresh it late and the
     * letter names the listing as it was before this object joined it. */
    deps.refreshInventory?.();

    let total: number;
    let first: GameObject | null;
    if (packTotalSuppressed(stack)) {
      total = stack.number;
      first = stack;
    } else {
      const view = packTotalView(state.gear);
      ({ total, first } = objectPackTotal(view, stack, false));
    }
    const name = describeObject(
      state,
      stack,
      ODESC.PREFIX | ODESC.FULL | ODESC.ALTNUM,
      total,
    );
    /* gear_to_label(p, first) in BOTH arms (L913): the letter names the first
     * like stack even when the total is not an aggregate. */
    const label = first
      ? packLabelOf(state, first)
      : gearToLabel(state.gear, handle);
    const suffix = label ? ` (${total > (first?.number ?? total) ? "1st " : ""}${label})` : "";
    env.onPickup?.(`You have ${name}${suffix}.`);
  }
}

/** gear_to_label for an object we hold by reference rather than by handle. */
function packLabelOf(state: GameState, obj: GameObject): string {
  for (const handle of state.gear.pack) {
    if (state.gear.store.get(handle) === obj) {
      return gearToLabel(state.gear, handle);
    }
  }
  return "";
}

/**
 * player_pickup_item: pick up gold, then a specific object (when given) or
 * one chosen from the floor list. Returns the number of objects picked up
 * (the command's energy multiplier).
 */
export function playerPickupItem(
  state: GameState,
  obj: GameObject | null,
  deps: PickupDeps,
): number {
  const env = deps.env ?? {};
  const grid = state.actor.grid;

  /* square_know_pile is knowledge (#24); everything here is visible. */

  /* Always pickup gold, effortlessly. */
  playerPickupGold(state, env);

  /* Nothing else to pick up -- return. */
  if (floorPile(state, grid).length === 0) return 0;

  /* We're given an object - pick it up. */
  if (obj) {
    if (invenCarryNum(state.gear, obj, deps.constants) > 0) {
      playerPickupAux(state, obj, 0, deps);
      return 1;
    }
    return 0;
  }

  /* Tally objects that can be at least partially picked up. */
  const floorList = floorPile(state, grid).filter(
    (o) => !env.isIgnored?.(o),
  );
  const canPickup = floorList.filter(
    (o) => invenCarryNum(state.gear, o, deps.constants) > 0,
  );
  if (canPickup.length === 0) return 0;

  /* One object picks up directly; several go through the menu seam
   * (defaulting to the pile head - one item per 'g' press). */
  let current: GameObject | null;
  if (canPickup.length === 1) current = canPickup[0]!;
  else current = env.chooseItem?.(canPickup) ?? canPickup[0]!;

  if (current) {
    playerPickupAux(state, current, 0, deps);
    return 1;
  }
  return 0;
}

/**
 * do_autopickup: pick up everything on the player's grid that requires no
 * action - gold always, objects per auto_pickup_okay. Returns the number
 * of objects picked up.
 */
export function doAutopickup(state: GameState, deps: PickupDeps): number {
  const env = deps.env ?? {};
  const grid = state.actor.grid;
  if (floorPile(state, grid).length === 0) return 0;

  /* Always pickup gold, effortlessly. */
  playerPickupGold(state, env);

  let picked = 0;
  for (const obj of [...floorPile(state, grid)]) {
    /* Ignore all hidden objects and non-objects. */
    if (env.isIgnored?.(obj)) continue;
    env.disturb?.();
    const autoNum = autoPickupOkay(state, obj, deps);
    if (autoNum) {
      playerPickupAux(state, obj, autoNum, deps);
      picked++;
    }
  }
  return picked;
}

/** do_cmd_pickup / do_cmd_autopickup energy: picked * move_energy / 10. */
function pickupEnergy(state: GameState, picked: number): number {
  const cost = Math.trunc((picked * state.z.moveEnergy) / 10);
  return Math.min(cost, state.z.moveEnergy);
}

/**
 * Register the pickup commands on the action registry and install the
 * state.autoPickup hook that walkAction runs after a step.
 */
export function installPickup(
  state: GameState,
  registry: ActionRegistry,
  deps: PickupDeps,
): void {
  /* Rebuild the computed quiver after any pickup that carried something, so
   * ammo lands in the quiver rather than the pack (PU_INVEN; see PickupDeps). */
  const pickedThen = (s: GameState, picked: number): number => {
    if (picked > 0) deps.refreshInventory?.();
    return pickupEnergy(s, picked);
  };
  registry.register("pickup", (s) => pickedThen(s, playerPickupItem(s, null, deps)));
  registry.register("autopickup", (s) => pickedThen(s, doAutopickup(s, deps)));
  state.autoPickup = (s): number => pickedThen(s, doAutopickup(s, deps));
}
