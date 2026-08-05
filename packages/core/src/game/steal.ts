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
 * The PR_GOLD redraw has no port equivalent (the front end repaints
 * unconditionally after every action), and the object-knowledge bookkeeping is
 * ported - objectGrab / objectSee live in obj/known-object.ts. Monster-thief EAT_ITEM (mon-blows.c L876) is wired from
 * game/mon-cmd.ts via mon/steal.ts stealMonsterItem(midx >= 0).
 */

import type { Constants } from "../constants.js";
import { PF, STAT, TMD } from "../generated/index.js";
import { DDGRID, distance, locSum } from "../loc.js";
import type { Loc } from "../loc.js";
import { SKILL } from "../player/types.js";
import { adj_dex_th } from "../player/calcs.js";
import type { StackLimits } from "../obj/object.js";
import { objectWeightOne, tvalIsMoney } from "../obj/object.js";
import { MDESC_STANDARD, MDESC_TARG, monsterDesc } from "../mon/desc.js";
import type { Monster } from "../mon/monster.js";
import { monsterWake } from "../mon/take-hit.js";
import { stealMonsterItem } from "../mon/steal.js";
import type { StealEnv } from "../mon/steal.js";
import type { GameState, PlayerCommand } from "./context.js";
import { monsterMax, squareMonster } from "./context.js";
import { describeObject } from "./describe.js";
import { dropNear } from "./floor.js";
import type { FloorEnv } from "./floor.js";
import { invenCarry, invenCarryNum } from "./gear.js";
import { playerHasWorld } from "./world.js";
import { teleportPlayer } from "./effect-teleport.js";
import { playerConfuseDir } from "./obj-cmd.js";
import type { ActionRegistry } from "./player-turn.js";

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
      invenCarry(state.gear, state.actor.player, obj, limits);
    },
    dropStolen: (obj) => {
      /* object_desc captured before the drop (upstream order); drop_near draws. */
      const name = describeObject(state, obj);
      dropNear(state, obj, 0, state.actor.grid, true, true, floorEnv);
      msg(`You drop ${name}.`);
    },
    /* The monster-thief branch (midx >= 0) is unreachable from here - the player
     * steal command always passes -1 - but these are answered truthfully rather
     * than stubbed, because a stub is a lie that survives a refactor. */
    thief: (midx) => state.monsters[midx] ?? null,
    slays: state.slays,
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
