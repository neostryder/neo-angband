/**
 * Stealing objects from a monster, ported from reference/src/mon-util.c
 * (Angband 4.2.6): get_random_monster_object (L1405) and steal_monster_item
 * (L1430). This is the RNG core of the rogue / PF_STEAL "steal" command
 * (do_cmd_steal, cmd-cave.c L1016) and, upstream, of the EAT_ITEM melee blow
 * when the attacker's target is another monster (mon-blows.c L876).
 *
 * The heavy RNG order is the correctness crux, so it lives here worldless (like
 * combat/mon-melee.ts): stealMonsterItem draws every roll in strict upstream
 * order and mutates the monster's held pile directly, delegating the
 * player-facing world work (gold gain, pack carry, drop_near, ignore checks,
 * the hit-and-run teleport, EF_WAKE aggro) to the injected StealEnv. The game
 * binding (game/steal.ts) supplies that env over the live GameState.
 *
 * RNG draw order (mon-util.c L1430-1539), verified against the C:
 *   1. get_random_monster_object(mon): a reservoir pick over mon->held_obj -
 *      one_in_(i) for each non-quest-artifact held object, i counting from 1.
 *   2. (no object) one_in_(3), then monster_wake(mon, false, 100) on success
 *      (which draws randint0(100) for awareness).
 *   3. monster_reaction = guard/2 + randint1(MAX(guard, 1)); the item-weight
 *      term adds no RNG.
 *   4. success (reaction < skill): pile_excise, then either gold gain, or a
 *      drop_near (its own breakage / grid RNG) when the item is ignored or the
 *      pack is full, or a plain inven_carry; then mon_dec_timed(SLEEP) (which
 *      may draw for its save), then the hit-and-run teleport when TMD_ATT_RUN.
 *   5. decent fail (reaction/2 < skill): monster_wake(mon, true, 50).
 *   6. bungle (else): monster_wake(mon, true, 100), then EF_WAKE aggro.
 *
 * DEFERRED (noted, no RNG impact): the object knowledge bookkeeping upstream
 * threads here - object_grab / object_see / delist_object / object_delete - is
 * the knowledge subsystem (#24), carried by the env's carry/gainGold seams; and
 * react_to_slay blocking the monster-thief path (midx >= 0) is deferred exactly
 * as the EAT_ITEM blow already defers it (game/mon-side.ts), since that path is
 * only reachable through monster-vs-monster melee, which is not yet ported.
 */

import { KF } from "../generated";
import type { Rng } from "../rng";
import type { GameObject } from "../obj/object";
import type { Monster } from "./monster";
import { getLore } from "./lore";
import type { LoreStore } from "./lore";
import { monsterIsUnique } from "./predicate";
import { monsterWake } from "./take-hit";
import { MON_TMD } from "../generated";
import { monDecTimed, MON_TMD_FLG_NOTIFY } from "./timed";

/**
 * get_random_monster_object (mon-util.c L1405): pick one object from the
 * monster's held pile with uniform probability, skipping quest artifacts. The
 * reservoir draw (one_in_(i), i from 1) matches upstream exactly, so the choice
 * is the same for a given RNG stream.
 */
export function getRandomMonsterObject(
  rng: Rng,
  mon: Monster,
): GameObject | null {
  let pick: GameObject | null = null;
  let i = 1;
  for (const obj of mon.heldObj) {
    /* Check it isn't a quest artifact. */
    if (obj.artifact && obj.kind.kindFlags.has(KF.QUEST_ART)) continue;
    if (rng.oneIn(i)) pick = obj;
    i++;
  }
  return pick;
}

/**
 * The world-facing operations steal_monster_item delegates, so the RNG core
 * stays worldless. The game binding (game/steal.ts) supplies these over the
 * live GameState; the RNG-drawing seams (dropStolen, wakeAll, hitAndRun) run at
 * the exact point upstream draws them.
 */
export interface StealEnv {
  /** msg(): route messages to the game's sink. */
  msg(text: string): void;
  /** monster_desc(mon, MDESC_TARG) (mon-util.c L1438): the victim's name. */
  monName(mon: Monster): string;
  /**
   * monster_desc(mon, MDESC_STANDARD) (mon-util.c L1524): the re-described,
   * capitalised name for the bungle "cries out in anger" line. Defaults to
   * monName when absent.
   */
  monNameStandard?(mon: Monster): string;
  /** player->state.skills[SKILL_STEALTH]. */
  readonly stealthSkill: number;
  /** adj_dex_th[player->state.stat_ind[STAT_DEX]]. */
  readonly dexToHit: number;
  /** player->state.speed. */
  readonly playerSpeed: number;
  /** player->timed[TMD_BLIND] || [TMD_CONFUSED] || [TMD_IMAGE]. */
  readonly statusPenalty: boolean;
  /** player->timed[TMD_ATT_RUN] (the hit-and-run stance is active). */
  readonly attRun: boolean;
  /** object_weight_one(obj), curses folded in. */
  objectWeight(obj: GameObject): number;
  /** tval_is_money(obj). */
  isMoney(obj: GameObject): boolean;
  /** object_desc(obj, PREFIX|FULL): the display name for messages. */
  objectName(obj: GameObject): string;
  /** ignore_item_ok(player, obj). */
  isIgnored(obj: GameObject): boolean;
  /** inven_carry_okay(obj): the pack can accept it. */
  canCarry(obj: GameObject): boolean;
  /** player->au += obj->pval; PR_GOLD redraw; delist / object_delete. */
  gainGold(obj: GameObject): void;
  /** object_grab + inven_carry(player, obj, true, true). */
  carry(obj: GameObject): void;
  /**
   * drop_near(cave, &obj, 0, player->grid, true, true) then "You drop X." -
   * the name is captured before the drop (upstream order); draws drop_near RNG.
   */
  dropStolen(obj: GameObject): void;
  /** effect_simple(EF_WAKE, source_monster(mon)): aggro monsters in LOS. */
  wakeAll?(mon: Monster): void;
  /**
   * The TMD_ATT_RUN hit-and-run: "You vanish into the shadows!", EF_TELEPORT
   * "20", then clear TMD_ATT_RUN. Draws the teleport RNG.
   */
  hitAndRun?(): void;
  /** monster_desc for the thief (midx >= 0 path); the race name (#25). */
  thiefName?(midx: number): string;
  /** monster_carry(cave, thief, obj) (midx >= 0 path). */
  thiefCarry?(midx: number, obj: GameObject): void;
}

/** pile_excise(&mon->held_obj, obj): drop the object from the held pile. */
function pileExcise(mon: Monster, obj: GameObject): void {
  const at = mon.heldObj.indexOf(obj);
  if (at >= 0) mon.heldObj.splice(at, 1);
}

/**
 * steal_monster_item (mon-util.c L1430): the thief with index `midx` steals a
 * random item from `mon`. `midx < 0` is the player (do_cmd_steal); `midx >= 0`
 * is a monster thief (the EAT_ITEM blow against another monster). Every RNG
 * draw is issued in strict upstream order; see the module header.
 */
export function stealMonsterItem(
  rng: Rng,
  lore: LoreStore,
  mon: Monster,
  midx: number,
  env: StealEnv,
): void {
  /* Choose the victim item (drawn first, before anything else). */
  const obj = getRandomMonsterObject(rng, mon);
  const mName = env.monName(mon);

  if (midx < 0) {
    /* Base monster protection and player stealing skill. */
    const unique = monsterIsUnique(mon);
    let guard =
      Math.trunc((mon.race.level * (unique ? 4 : 3)) / 4) +
      mon.mspeed -
      env.playerSpeed;
    let stealSkill = env.stealthSkill + env.dexToHit;

    /* No object. */
    if (!obj) {
      env.msg(`You can find nothing to steal from ${mName}.`);
      if (rng.oneIn(3)) {
        /* Monster notices. */
        monsterWake(rng, mon, false, 100);
      }
      return;
    }

    /* Penalize some status conditions. */
    if (env.statusPenalty) {
      stealSkill = Math.trunc(stealSkill / 4);
    }
    if (mon.mTimed[MON_TMD.SLEEP]) {
      guard = Math.trunc(guard / 2);
    }

    /* Monster base reaction, plus allowance for item weight. */
    let monsterReaction =
      Math.trunc(guard / 2) + rng.randint1(Math.max(guard, 1));
    monsterReaction += Math.trunc(
      (obj.number * env.objectWeight(obj)) / 20,
    );

    /* Try and steal. */
    if (monsterReaction < stealSkill) {
      const wake = 35 - env.stealthSkill;

      /* Success! */
      obj.heldMIdx = 0;
      pileExcise(mon, obj);
      if (env.isMoney(obj)) {
        env.msg(`You steal ${obj.pval} gold pieces worth of treasure.`);
        env.gainGold(obj);
      } else {
        /* Drop immediately if ignored, or if inventory already full to
         * prevent pack overflow. */
        if (env.isIgnored(obj) || !env.canCarry(obj)) {
          env.dropStolen(obj);
        } else {
          env.carry(obj);
        }
      }

      /* Track thefts. */
      getLore(lore, mon.race).thefts++;

      /* Monster wakes a little. */
      monDecTimed(rng, mon, MON_TMD.SLEEP, wake, MON_TMD_FLG_NOTIFY);
    } else if (Math.trunc(monsterReaction / 2) < stealSkill) {
      /* Decent attempt, at least. */
      const oName = env.isMoney(obj) ? "treasure" : env.objectName(obj);
      env.msg(`You fail to steal ${oName} from ${mName}.`);
      /* Monster wakes, may notice. */
      monsterWake(rng, mon, true, 50);
    } else {
      /* Bungled it. */
      monsterWake(rng, mon, true, 100);
      env.msg(
        `${(env.monNameStandard ?? env.monName)(mon)} cries out in anger!`,
      );
      env.wakeAll?.(mon);
    }

    /* Player hit and run. */
    if (env.attRun) {
      env.hitAndRun?.();
    }
  } else {
    /* Monster thief (midx >= 0): only reachable via monster-vs-monster melee,
     * which is not yet ported. react_to_slay blocking the theft is DEFERRED
     * (no RNG), exactly as the EAT_ITEM blow defers it. */
    const tName = env.thiefName?.(midx) ?? "It";

    if (!obj /* || react_to_slay(obj, thief) -- DEFERRED */) {
      /* Fail to steal. */
      env.msg(`${tName} tries to steal something from ${mName}, but fails.`);
    } else {
      env.msg(`${tName} steals something from ${mName}!`);

      /* Steal and carry. */
      obj.heldMIdx = 0;
      pileExcise(mon, obj);
      env.thiefCarry?.(midx, obj);
    }
  }
}
