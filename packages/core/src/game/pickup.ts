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
 * playerPickupAux fires state.onArtifactFound (object_touch's
 * history_find_artifact, obj-knowledge.c L960-972) when a picked object is
 * an artifact. Upstream also calls object_touch from square_know_pile the
 * instant an artifact's pile becomes known - i.e. on sight, not only on
 * pickup - which square_know_pile's reduced port (game/known.ts, #24 above)
 * does not yet reproduce; find-on-sight is deferred (ledgered in
 * parity/ledger/player-history.yaml). historyFindArtifact's per-aidx
 * de-dupe keeps both paths safe once find-on-sight lands.
 */

import type { Constants } from "../constants";
import type { GameObject, StackLimits } from "../obj/object";
import { OSTACK_PACK, objectStackable, tvalIsMoney } from "../obj/object";
import type { GameState } from "./context";
import { floorExcise, floorObjectForUse, floorPile } from "./floor";
import { invenCarry, invenCarryNum } from "./gear";
import type { ActionRegistry } from "./player-turn";

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
  /** Gold was picked up (message/sound hook). */
  onGold?: (total: number, name: string, singleKind: boolean) => void;
  /** An object entered the pack (message hook). */
  onPickup?: (obj: GameObject) => void;
  /** disturb(player). */
  disturb?: () => void;
}

/** What the pickup routines need from the binder. */
export interface PickupDeps {
  /** Bound constants (pack_size for inven_carry_num, quiver limits). */
  constants: Constants;
  env?: PickupEnv;
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
  if (max === obj.number) {
    if (obj.grid) floorExcise(state, obj.grid, obj);
    obj.grid = null;
    invenCarry(state.gear, obj, limits);
  } else {
    /* Partial pickup: auto-limit, or the whole carryable amount (the
     * get_quantity prompt defaults to max; the prompt itself is ui). */
    const num = autoMax || max;
    if (!num) return;
    const { usable } = floorObjectForUse(state, obj, num);
    invenCarry(state.gear, usable, limits);
  }
  /* object_touch (obj-knowledge.c L960-972): auto-notice artifacts on entry
   * to the pack and log the find (history_find_artifact). Read through the
   * state-level hook (not PickupEnv) so it survives a later installPickup
   * call that only supplies message hooks (main.ts's "reinstall"). */
  if (obj.artifact) state.onArtifactFound?.(obj.artifact);
  env.onPickup?.(obj);
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
  registry.register("pickup", (s) => pickupEnergy(s, playerPickupItem(s, null, deps)));
  registry.register("autopickup", (s) => pickupEnergy(s, doAutopickup(s, deps)));
  state.autoPickup = (s): number => pickupEnergy(s, doAutopickup(s, deps));
}
