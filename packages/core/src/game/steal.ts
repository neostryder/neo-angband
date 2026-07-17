/**
 * The "steal" command, ported from do_cmd_steal / do_cmd_steal_aux
 * (reference/src/cmd-cave.c L1016-1048, Angband 4.2.6): the rogue / PF_STEAL
 * ability to lift an item from an adjacent monster. The RNG core lives in
 * mon/steal.ts (stealMonsterItem); this module registers the command on the
 * action registry and binds the worldless StealEnv over the live GameState.
 *
 * do_cmd_steal_aux flow (L1016): spend move_energy up front, apply confusion to
 * the direction, then - if an adjacent monster is there AND the player has
 * PF_STEAL - steal_monster_item(mon, -1); otherwise "You spin around." The
 * energy is spent either way, exactly as upstream (energy_use is set before the
 * branch).
 *
 * The PF_STEAL gate reads the live derived state (player_has = pf_has(p->state.
 * pflags, ...), player.h L440), so it needs calc_bonuses to have run
 * (state.playerState); absent (worldless harness with no derived state), it
 * reads as "no steal ability", the same spin-around a non-rogue gets.
 *
 * DEFERRED (no RNG impact): the monster-thief reuse of steal_monster_item
 * (mon-blows.c L876, the EAT_ITEM blow against another monster) is not wired
 * here because monster-vs-monster melee (monster_attack_monster) is not yet
 * ported; the midx >= 0 branch exists in mon/steal.ts for when it lands. The
 * PR_GOLD redraw and the object-knowledge bookkeeping (object_grab /
 * object_see / delist) are UI / knowledge concerns (#24/#25).
 */

import type { Constants } from "../constants";
import { PF, STAT, TMD } from "../generated";
import { DDGRID, distance, locSum } from "../loc";
import type { Loc } from "../loc";
import { SKILL } from "../player/types";
import { adj_dex_th } from "../player/calcs";
import type { GameObject, StackLimits } from "../obj/object";
import { objectWeightOne, tvalIsMoney } from "../obj/object";
import { MDESC_STANDARD, MDESC_TARG, monsterDesc } from "../mon/desc";
import type { Monster } from "../mon/monster";
import { monsterWake } from "../mon/take-hit";
import { stealMonsterItem } from "../mon/steal";
import type { StealEnv } from "../mon/steal";
import type { GameState, PlayerCommand } from "./context";
import { monsterMax, squareMonster } from "./context";
import { describeObject } from "./describe";
import { dropNear } from "./floor";
import type { FloorEnv } from "./floor";
import { invenCarry, invenCarryNum } from "./gear";
import { playerHasWorld } from "./world";
import { teleportPlayer } from "./effect-teleport";
import { playerConfuseDir } from "./obj-cmd";
import type { ActionRegistry } from "./player-turn";

/** What the steal command needs beyond the state. */
export interface StealCmdDeps {
  /** Bound constants (pack_size for inven_carry_okay, quiver limits). */
  constants: Constants;
  /** msg() sink; falls back to state.msg. */
  msg?: (text: string) => void;
}

/**
 * effect_simple(EF_WAKE, source_monster(mon)) (mon-util.c L1527): wake every
 * sleeping monster within max_sight * 2 of the thief's victim, closer meaning
 * likelier to become aware. Replicates game/effect-monster.ts handleWAKE's loop
 * so the bungle path draws the same randint0(100) per sleeping monster.
 */
function wakeNear(state: GameState, mon: Monster): void {
  const radius = state.z.maxSight * 2;
  for (let i = 1; i < monsterMax(state); i++) {
    const other = state.monsters[i];
    if (!other) continue;
    const dist = distance(mon.grid, other.grid);
    if (dist < radius && other.mTimed[0]! > 0) {
      /* MON_TMD.SLEEP: closer means likelier to become aware. */
      monsterWake(state.rng, other, false, 100 - 2 * dist);
    }
  }
}

/** Build the StealEnv over the live game state for a player steal. */
function makeStealEnv(state: GameState, deps: StealCmdDeps): StealEnv {
  const msg = (t: string): void => (deps.msg ?? state.msg ?? (() => {}))(t);
  const p = state.actor.player;
  const limits: StackLimits = {
    quiverSlotSize: deps.constants.quiverSlotSize,
    thrownQuiverMult: deps.constants.thrownQuiverMult,
  };
  const floorEnv: FloorEnv = {
    ...(state.isIgnored ? { isIgnored: state.isIgnored } : {}),
  };

  return {
    msg,
    /* monster_desc(mon, MDESC_TARG) / MDESC_STANDARD (mon-util.c L1438/1524). */
    monName: (mon) => monsterDesc(mon, MDESC_TARG),
    monNameStandard: (mon) => monsterDesc(mon, MDESC_STANDARD),
    stealthSkill: state.actor.combat.skills[SKILL.STEALTH] ?? 0,
    dexToHit: adj_dex_th[state.statInd?.[STAT.DEX] ?? 0] ?? 0,
    playerSpeed: state.actor.speed,
    statusPenalty:
      (p.timed[TMD.BLIND] ?? 0) > 0 ||
      (p.timed[TMD.CONFUSED] ?? 0) > 0 ||
      (p.timed[TMD.IMAGE] ?? 0) > 0,
    attRun: (p.timed[TMD.ATT_RUN] ?? 0) > 0,
    objectWeight: (obj) => objectWeightOne(obj, state.runeEnv.curses),
    isMoney: (obj) => tvalIsMoney(obj.tval),
    objectName: (obj) => describeObject(state, obj),
    isIgnored: (obj) => state.isIgnored?.(obj) ?? false,
    canCarry: (obj) => invenCarryNum(state.gear, obj, deps.constants) > 0,
    gainGold: (obj) => {
      /* player->au += obj->pval; the PR_GOLD redraw is UI (#25). */
      p.au += obj.pval;
    },
    carry: (obj) => {
      /* object_grab is knowledge (#24); mirror pickup's artifact history log. */
      if (obj.artifact) state.onArtifactFound?.(obj.artifact);
      invenCarry(state.gear, obj, limits);
    },
    dropStolen: (obj) => {
      /* object_desc captured before the drop (upstream order); drop_near draws. */
      const name = describeObject(state, obj);
      dropNear(state, obj, 0, state.actor.grid, true, floorEnv);
      msg(`You drop ${name}.`);
    },
    wakeAll: (mon) => wakeNear(state, mon),
    hitAndRun: () => {
      msg("You vanish into the shadows!");
      teleportPlayer(state, 20, {});
      /* player_clear_timed(player, TMD_ATT_RUN, false, false): RNG-free; the
       * PU_BONUS recalc rides refreshDerived elsewhere. */
      p.timed[TMD.ATT_RUN] = 0;
    },
  };
}

/**
 * do_cmd_steal_aux (cmd-cave.c L1016): spend a turn, apply confusion, and
 * steal from an adjacent monster (with PF_STEAL) or spin around. Returns the
 * energy spent (always move_energy, matching upstream).
 */
function doCmdStealAux(state: GameState, dir: number, deps: StealCmdDeps): number {
  const msg = (t: string): void => (deps.msg ?? state.msg ?? (() => {}))(t);

  /* Take a turn (set before the branch, as upstream does). */
  const energy = state.z.moveEnergy;

  /* Apply confusion. */
  const cdir = playerConfuseDir(state, dir);
  const grid: Loc = locSum(state.actor.grid, DDGRID[cdir] as Loc);

  /* Attack or steal from monsters. */
  const mon = squareMonster(state, grid);
  if (mon && playerHasWorld(state, PF.STEAL)) {
    stealMonsterItem(state.rng, state.lore, mon, -1, makeStealEnv(state, deps));
  } else {
    /* Oops. */
    msg("You spin around.");
  }
  return energy;
}

/** Register the "steal" command on the action registry. */
export function installSteal(
  registry: ActionRegistry,
  deps: StealCmdDeps,
): void {
  registry.register("steal", (state, cmd: PlayerCommand) => {
    const dir = cmd.dir;
    /* cmd_get_direction: a real direction is required (no self / no-op). */
    if (dir === undefined || dir < 1 || dir > 9 || dir === 5) return 0;
    return doCmdStealAux(state, dir, deps);
  });
}
