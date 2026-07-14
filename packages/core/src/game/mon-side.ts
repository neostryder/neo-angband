/**
 * The world-touching side of monster melee blows, ported from the
 * melee_effect_handler_* consequences in reference/src/mon-blows.c (Angband
 * 4.2.6). This is the monster-melee analog of game/player-side.ts: combat/
 * mon-melee.ts is worldless and computes only the blow loop and RNG order, so
 * makeMonBlowEnv closes over the live GameState and returns a per-monster
 * MonBlowEnv that performs the inventory / resist / timed / stat / exp / theft /
 * terrain work the handlers need.
 *
 * Every method reuses the port's existing implementations so their internal RNG
 * draw counts already match the rest of the port: adjust_dam (world/projection),
 * inven_damage (game/project-obj), disenchant_equipment (game/effect-general),
 * player_stat_dec / player_exp_lose (player/exp), player_inc_timed (player/timed),
 * player_apply_damage_reduction / take_hit (player/take-hit), thrust_away
 * (game/thrust) and EF_EARTHQUAKE (routed through the injected earthquake dep,
 * which runs the terrain effect via the interpreter so its draws are shared).
 *
 * Stolen gold / items are attached to the monster's held-object pile
 * (monster_carry, mon/make.ts) so they drop on death via monster_death
 * (game/mon-death.ts). react_to_slay blocking a theft stays DEFERRED (no RNG
 * impact); ledgered in parity/ledger/combat-melee.yaml.
 */

import { ORIGIN, OF, STAT, TMD } from "../generated";
import { SKILL } from "../player/types";
import type { Loc } from "../loc";
import type { Monster } from "../mon/monster";
import { monsterCarry } from "../mon/make";
import type { Player } from "../player/player";
import type { TimedEffect } from "../player/types";
import type { ProjectionInfo } from "../world/projection";
import { adjustDam } from "../world/projection";
import { playerIncTimed } from "../player/timed";
import { playerExpLose, playerStatDec } from "../player/exp";
import type { ExpDeps } from "../player/exp";
import {
  playerApplyDamageReduction,
  takeHit,
} from "../player/take-hit";
import { equipLearnFlag } from "../obj/knowledge";
import { MAX_PVAL } from "../obj/types";
import { tvalCanHaveCharges, tvalIsEdible } from "../obj/object";
import type { GameObject } from "../obj/object";
import type { MakeDeps } from "../obj/make";
import { objectPrep } from "../obj/make";
import { ODESC } from "../obj/desc";
import type { MonBlowEnv } from "../combat/mon-melee";
import type { GameState } from "./context";
import type { PlayerProjActor } from "./project-player";
import { invenDamage } from "./project-obj";
import { disenchantEquipment } from "./effect-general";
import { describeObject } from "./describe";
import { gearObjectForUse } from "./gear";
import { thrustAway } from "./thrust";
import { teleportMonster } from "./effect-teleport";
import type { TeleportEnv } from "./effect-teleport";
import { disturb } from "./player-path";

/** Everything the monster-blow handlers need beyond the GameState. */
export interface MonBlowDeps {
  /** The bound timed-effect registry (players.timed), TMD-indexed. */
  timed: readonly TimedEffect[];
  /** The projection view of the player (resists / immunities / reduction). */
  actor: PlayerProjActor;
  /** The bound projection table (adjust_dam numerator/denominator). */
  projections: readonly ProjectionInfo[];
  /** Experience drains ripple levels through this. */
  expDeps: ExpDeps;
  /** z_info->life_drain_percent. */
  lifeDrainPercent: number;
  /** adj_dex_safe[] (player/calcs.ts), for the theft saving throws. */
  adjDexSafe: readonly number[];
  /** z_info->pack_size, for the random-inventory-slot theft picks. */
  packSize: number;
  /** Object generation deps: stolen gold is prepped into money objects. */
  makeDeps: MakeDeps;
  /** The teleport seam (blink-away and thrust post-move). */
  teleport?: TeleportEnv;
  /** EF_EARTHQUAKE routed through the effect interpreter (SHATTER). */
  earthquake?: (mon: Monster, radius: number) => void;
  /** msg(): route blow messages to the game's sink. */
  msg?: (text: string) => void;
}

/** The stat adjectives desc_stat uses for the drain message. */
const STAT_ADJECTIVE: readonly string[] = [
  "strong",
  "bright",
  "wise",
  "agile",
  "hale",
];

/** player_of_has: the racial flags plus every equipped item's. */
function playerOfHas(state: GameState, flag: number): boolean {
  const p = state.actor.player;
  if (p.race.flags.has(flag)) return true;
  for (let i = 0; i < p.body.count; i++) {
    if (state.runeEnv.slotObject(i)?.flags.has(flag)) return true;
  }
  return false;
}

/** sustain_flag(stat) over the OF_SUST_ block. */
function sustained(state: GameState, stat: number): boolean {
  return playerOfHas(state, OF.SUST_STR + stat);
}

/**
 * makeMonBlowEnv: the analog of makePlayerSideEffects. Returns a factory that
 * binds a MonBlowEnv to the attacking monster (so drainCharges can heal it and
 * blinkAway can teleport it). Installed on state.monBlowEnv by wireGame.
 */
export function makeMonBlowEnv(
  state: GameState,
  deps: MonBlowDeps,
): (mon: Monster) => MonBlowEnv {
  const msg = (t: string): void => deps.msg?.(t);
  const p = (): Player => state.actor.player;

  /* The pack object at inven[index] (null when the slot is empty). */
  const packItem = (
    idx: number,
  ): { handle: number; obj: GameObject } | null => {
    const handle = state.gear.pack[idx];
    if (handle === undefined) return null;
    const obj = state.gear.store.get(handle);
    if (!obj) return null;
    return { handle, obj };
  };

  return (mon: Monster): MonBlowEnv => ({
    playerGrid(): Loc {
      return state.actor.grid;
    },

    applyReduction(dam: number): number {
      return playerApplyDamageReduction(deps.actor, deps.actor.reduction, dam);
    },

    takeHit(reducedDam: number): void {
      takeHit(deps.actor, reducedDam, mon.race.name, {
        rng: state.rng,
        onMessage: (text: string): void => msg(text),
        /* take_hit (player-util.c L207): a blow that lands stops the player
         * running / resting. disturb draws no RNG. */
        onDisturb: (): void => disturb(state),
      });
    },

    get playerDied(): boolean {
      return deps.actor.isDead;
    },

    msg(text: string): void {
      msg(text);
    },

    elementalDam(proj: number, dam: number): number {
      return adjustDam(
        state.rng,
        deps.projections,
        proj,
        dam,
        "randomise",
        deps.actor.resistLevel(proj),
        deps.actor.minusAc,
      );
    },

    invenDamage(elem: number, cperc: number): void {
      invenDamage(state, elem, cperc, { msg });
    },

    resists(elem: number): boolean {
      return deps.actor.resistLevel(elem) > 0;
    },

    incTimed(tmd: number, amount: number, check: boolean): boolean {
      const effect = deps.timed[tmd];
      if (!effect) return false;
      return playerIncTimed(p(), effect, amount, true, true, check, {
        onMessage: (text: string): void => msg(text),
      });
    },

    saveVsSkill(): boolean {
      return (
        state.rng.randint0(100) < (state.actor.combat.skills[SKILL.SAVE] ?? 0)
      );
    },

    drainStat(stat: number): void {
      if (sustained(state, stat)) {
        equipLearnFlag(p(), state.runeEnv, OF.SUST_STR + stat);
        return;
      }
      if (playerStatDec(p(), stat, false)) {
        msg(
          `You're not as ${STAT_ADJECTIVE[stat] ?? "good"} as you used to be...`,
        );
      }
    },

    hasHoldLife(): boolean {
      return playerOfHas(state, OF.HOLD_LIFE);
    },

    drainExp(chance: number, drainAmount: number): void {
      const holdLife = playerOfHas(state, OF.HOLD_LIFE);
      /* randint0(100) is drawn only when HOLD_LIFE is present (short-circuit). */
      if (holdLife && state.rng.randint0(100) < chance) {
        msg("You keep hold of your life force!");
        return;
      }
      const d =
        drainAmount + Math.trunc(p().exp / 100) * deps.lifeDrainPercent;
      if (holdLife) {
        msg("You feel your life slipping away!");
        playerExpLose(p(), Math.trunc(d / 10), false, deps.expDeps);
      } else {
        msg("You feel your life draining away!");
        playerExpLose(p(), d, false, deps.expDeps);
      }
    },

    drainCharges(rlev: number): void {
      let unpower = 0;
      for (let tries = 0; tries < 10; tries++) {
        const idx = state.rng.randint0(deps.packSize);
        const item = packItem(idx);
        if (!item) continue;
        const obj = item.obj;

        /* Drain charged wands/staves. */
        if (tvalCanHaveCharges(obj.tval) && obj.pval) {
          unpower = Math.trunc(rlev / (obj.kind.level + 2)) + 1;
          obj.pval = Math.max(obj.pval - unpower, 0);
        }

        if (unpower) {
          msg("Energy drains from your pack!");
          /* Don't heal more than max hp (PR_HEALTH redraw rides #25). */
          const heal = Math.min(rlev * unpower, mon.maxhp - mon.hp);
          mon.hp += heal;
          break;
        }
      }
    },

    eatGold(): boolean {
      const current = p();
      const dexInd = state.statInd?.[STAT.DEX] ?? 0;
      /* Saving throw (unless paralyzed) based on dex and level. */
      if (
        (current.timed[TMD.PARALYZED] ?? 0) === 0 &&
        state.rng.randint0(100) < (deps.adjDexSafe[dexInd] ?? 0) + current.lev
      ) {
        msg("You quickly protect your money pouch!");
        /* Occasional blink anyway. */
        return state.rng.randint0(3) !== 0;
      }

      let gold = Math.trunc(current.au / 10) + state.rng.randint1(25);
      if (gold < 2) gold = 2;
      if (gold > 5000) gold = Math.trunc(current.au / 20) + state.rng.randint1(3000);
      if (gold > current.au) gold = current.au;
      current.au -= gold;
      if (gold <= 0) {
        msg("Nothing was stolen.");
        return false;
      }

      msg("Your purse feels lighter.");
      if (current.au) msg(`${gold} coins were stolen!`);
      else msg("All of your coins were stolen!");

      /* While we have gold, put it in objects and give it to the monster
       * (mon-blows.c L814-834). Prepped MINIMISE at level 0 (no RNG), with
       * ORIGIN.STOLEN so monster_death does not count it as dropped treasure. */
      const { makeDeps } = deps;
      while (gold > 0) {
        const kind = makeDeps.alloc.moneyKind(makeDeps.constants, "gold", gold);
        const obj = objectPrep(
          state.rng,
          makeDeps.reg,
          makeDeps.constants,
          kind,
          0,
          "minimise",
        );
        const amt = gold > MAX_PVAL ? MAX_PVAL : gold;
        obj.pval = amt;
        gold -= amt;
        obj.origin = ORIGIN.STOLEN;
        obj.originDepth = state.chunk.depth;
        monsterCarry(mon.heldObj, obj, mon.midx);
      }
      return true;
    },

    eatItem(): { blinked: boolean; obvious: boolean } {
      const current = p();
      const dexInd = state.statInd?.[STAT.DEX] ?? 0;
      const chance = (deps.adjDexSafe[dexInd] ?? 0) + current.lev;

      /* Saving throw (unless paralyzed) based on dex and level. */
      if (
        (current.timed[TMD.PARALYZED] ?? 0) === 0 &&
        state.rng.randint0(100) < chance
      ) {
        msg("You grab hold of your backpack!");
        return { blinked: true, obvious: true };
      }

      /* steal_player_item: break on the first non-null non-artifact item. */
      for (let tries = 0; tries < 10; tries++) {
        const idx = state.rng.randint0(deps.packSize);
        const item = packItem(idx);
        if (!item) continue;
        if (item.obj.artifact) continue;

        const name = describeObject(state, item.obj, ODESC.BASE);
        const split = item.obj.number > 1;
        /* react_to_slay blocking the theft is DEFERRED (no RNG); steal. */
        msg(`${split ? "One of your" : "Your"} ${name} was stolen!`);
        /* Steal one and carry it (mon-blows.c L292-294); the stolen object
         * keeps its own origin, so monster_death does not count it as a drop. */
        const { obj: stolen } = gearObjectForUse(
          state.gear,
          current,
          item.handle,
          1,
        );
        monsterCarry(mon.heldObj, stolen, mon.midx);
        return { blinked: true, obvious: true };
      }
      return { blinked: false, obvious: true };
    },

    eatFood(): void {
      const current = p();
      for (let tries = 0; tries < 10; tries++) {
        const idx = state.rng.randint0(deps.packSize);
        const item = packItem(idx);
        if (!item) continue;
        if (!tvalIsEdible(item.obj.tval)) continue;

        const name = describeObject(state, item.obj, ODESC.BASE);
        const one = item.obj.number === 1;
        msg(`${one ? "Your" : "One of your"} ${name} was eaten!`);
        gearObjectForUse(state.gear, current, item.handle, 1);
        break;
      }
    },

    eatLight(): void {
      const current = p();
      /* EF_DRAIN_LIGHT "250+1d250". */
      const drain = 250 + state.rng.randint1(250);
      const lightSlot = current.body.slots.findIndex((s) => s.type === "LIGHT");
      const obj = lightSlot >= 0 ? state.runeEnv.slotObject(lightSlot) : null;
      if (obj && !obj.flags.has(OF.NO_FUEL) && obj.timeout > 0) {
        obj.timeout -= drain;
        if (obj.timeout < 1) obj.timeout = 1;
        if (!((current.timed[TMD.BLIND] ?? 0) > 0)) msg("Your light dims.");
      }
    },

    disenchant(): void {
      disenchantEquipment(state, { msg });
    },

    earthquake(radius: number): void {
      deps.earthquake?.(mon, radius);
    },

    thrust(dist: number): void {
      thrustAway(state, mon.grid, state.actor.grid, dist, {
        msg,
        ...(deps.teleport?.onPlayerPostMove
          ? {
              onPlayerPostMove: (): void =>
                deps.teleport!.onPlayerPostMove!(true),
            }
          : {}),
      });
    },

    blinkAway(): void {
      teleportMonster(
        state,
        mon.midx,
        state.z.maxSight * 2 + 5,
        deps.teleport ?? {},
      );
    },
  });
}
