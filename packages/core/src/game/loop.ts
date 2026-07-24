/**
 * The main game loop, ported from run_game_loop() and process_world() in
 * reference/src/game-world.c, plus player_regen_hp / player_regen_mana /
 * player_adjust_hp_precise / player_adjust_mana_precise and decrease_timeouts
 * (Angband 4.2.6).
 *
 * runGameLoop advances the world until the player must enter a command (the
 * injected provider returns null), the player dies, or a level change is
 * requested. It reproduces the upstream ordering exactly: the player acts
 * first; before each player action any monster holding more energy than the
 * player acts (process_monsters(player.energy + 1)); then the rest of the
 * monsters act (process_monsters(0)), monsters are reset, process_world runs
 * every ten game turns, the player is energised and the game-turn counter
 * advances.
 *
 * process_world here wires the periodic upkeep this task owns: HP and mana
 * regeneration (the exact fixed-point 2^16 formulas), the player timed array
 * countdown (decrease_timeouts, routed through playerDecTimed for grade / wear-
 * off messages), food digestion, light-source fuel burn, damage-over-time
 * (poison / cut / black-breath / starvation), inventory recharge, ambient
 * creature generation, and the word-of-recall / deep-descent countdowns - see
 * processWorld below. Monster timeouts count down inside process_monster_timed
 * (monster-turn.ts); the day-night town cycle relight is handled in
 * session/game.ts. Remaining ledgered items are noted in
 * parity/ledger/game-loop.yaml.
 */

import { MON_TMD, OF, PF, STAT, TMD } from "../generated";
import { TMD_MAX } from "../player/types";
import { los } from "../world/view";
import { makeNoise, updateScent } from "../world/flow";
import { convertManaToHp } from "../player/combat-regen";
import {
  MON_TMD_FLG_NOTIFY,
  monClearTimed,
  monDecTimed,
} from "../mon/timed";
import { getCommandedMonster } from "./mon-cmd";
import { adj_con_fix, calcStatIndices } from "../player/calcs";
import { equipLearnAfterTime, equipLearnFlag } from "../obj/knowledge";
import { playerClearTimed, playerDecTimed, playerTimedGradeEq } from "../player/timed";
import { tickMonsterMarks } from "./known";
import {
  caveMonsterCount,
  compactMonsters,
  digestFood,
  isDaytime,
  playAmbientSound,
  playerHasWorld,
  playerOfHasWorld,
  playerTakeTerrainDamage,
  playerUpdateLight,
  processDamageOverTime,
  processExpDrain,
  processFaintOrStarve,
  rechargeObjects,
} from "./world";
import type { Player } from "../player/player";
import type { GameState } from "./context";
import {
  givePlayerEnergy,
  processMonsters,
  resetMonsters,
} from "./scheduler";
import { processPlayer } from "./player-turn";
import type { ActionRegistry } from "./player-turn";

/** player-util.h regeneration constants (regen factor / base, times 2^16). */
const PY_REGEN_NORMAL = 197;
const PY_REGEN_WEAK = 98;
const PY_REGEN_FAINT = 33;
const PY_REGEN_HPBASE = 1442;
const PY_REGEN_MNBASE = 524;

/** Why runGameLoop returned control. */
export const LOOP_STATUS = {
  /** The command provider is empty: the player must act. */
  INPUT: "input",
  /** player->is_dead. */
  DEAD: "dead",
  /** player->upkeep->generate_level (a stair/recall change; regen deferred). */
  LEVEL_CHANGE: "level-change",
  /** player->upkeep->playing cleared. */
  STOPPED: "stopped",
} as const;
export type LoopStatus = (typeof LOOP_STATUS)[keyof typeof LOOP_STATUS];

/**
 * player_adjust_hp_precise: add hp_gain (in 2^16ths) to chp/chp_frac, clamped
 * at mhp. Reproduces the upstream fixed-point split.
 */
export function playerAdjustHpPrecise(p: Player, hpGain: number): void {
  const old32 = p.chp * 65536 + p.chpFrac;
  const new32 = old32 + hpGain;
  if (new32 < 0) {
    const remainder = new32 % 65536;
    p.chp = Math.trunc(new32 / 65536);
    if (remainder) {
      p.chpFrac = 65536 + remainder;
      p.chp -= 1;
    } else {
      p.chpFrac = 0;
    }
  } else {
    p.chp = Math.trunc(new32 / 65536);
    p.chpFrac = new32 & 0xffff;
  }
  if (p.chp >= p.mhp) {
    p.chp = p.mhp;
    p.chpFrac = 0;
  }
}

/**
 * player_adjust_mana_precise: add sp_gain (in 2^16ths) to csp/csp_frac,
 * clamped to [0, msp]. Returns the amount actually applied in 2^16ths (which
 * differs from sp_gain when the clamp bites); the PF_COMBAT_REGEN mana degen
 * path in player_regen_mana feeds the returned (negative) delta to
 * convert_mana_to_hp. Faithful to player-util.c:585-653 - the C recomputes the
 * applied delta as new_32 - old_32 whenever the clamp fires, which for the
 * non-overflow range in play is simply (final - old_32) in every case.
 */
export function playerAdjustManaPrecise(p: Player, spGain: number): number {
  if (spGain === 0) return 0;
  const old32 = p.csp * 65536 + p.cspFrac;
  const new32 = old32 + spGain;
  if (new32 < 0) {
    const remainder = new32 % 65536;
    p.csp = Math.trunc(new32 / 65536);
    if (remainder) {
      p.cspFrac = 65536 + remainder;
      p.csp -= 1;
    } else {
      p.cspFrac = 0;
    }
  } else {
    p.csp = Math.trunc(new32 / 65536);
    p.cspFrac = new32 & 0xffff;
  }
  if (p.csp >= p.msp) {
    p.csp = p.msp;
    p.cspFrac = 0;
  } else if (p.csp < 0) {
    p.csp = 0;
    p.cspFrac = 0;
  }
  return p.csp * 65536 + p.cspFrac - old32;
}

/* player-util.h:61: REST_REQUIRED_FOR_REGEN. */
const REST_REQUIRED_FOR_REGEN = 5;

/**
 * player-util.c:1381: the conditional REST_ modes (COMPLETE=-2, ALL_POINTS=-1,
 * SOME_POINTS=-3) rest until a condition is met rather than for a fixed count.
 */
function playerRestingIsSpecial(count: number): boolean {
  return count === -1 || count === -2 || count === -3;
}

/**
 * player_resting_can_regenerate (player-util.c:1461): the player earns the x2
 * regeneration bonus once REST_REQUIRED_FOR_REGEN turns of the current rest
 * have elapsed, or immediately for the conditional REST_ modes. The rest
 * command (WP-11, web) sets state.resting; absent when not resting. No RNG.
 */
function playerRestingCanRegenerate(state: GameState): boolean {
  const r = state.resting;
  if (!r) return false;
  return r.turnsRested >= REST_REQUIRED_FOR_REGEN || playerRestingIsSpecial(r.count);
}

/**
 * player_is_resting (player-util.c:1397): true while a rest command is running.
 * Gates the noise/scent update below. Driven by state.resting (WP-11, web).
 */
function playerIsResting(state: GameState): boolean {
  const r = state.resting;
  if (!r) return false;
  return r.count > 0 || playerRestingIsSpecial(r.count);
}

/**
 * player_regen_hp (player-util.c:436-481): one turn of HP regeneration. The
 * food-tier base percent, the up-to-1/3 fed bonus, the OF_REGEN x2 and resting
 * x2 speed-ups, the OF_IMPAIR_HP halving, and the paralyse/poison/stun/cut
 * zeroing, then the fixed-point adjust and the change-driven equip learning.
 */
export function playerRegenHp(state: GameState): void {
  const p = state.actor.player;
  const oldChp = p.chp;
  const food = p.timed[TMD.FOOD] ?? 0;
  let percent = 0;
  if (food >= state.z.foodWeak) percent = PY_REGEN_NORMAL;
  else if (food >= state.z.foodFaint) percent = PY_REGEN_WEAK;
  else if (food >= state.z.foodStarve) percent = PY_REGEN_FAINT;

  /* Food bonus - better fed players regenerate up to 1/3 faster. */
  const fedPct = Math.trunc(food / state.z.foodValue);
  percent = Math.trunc((percent * (100 + Math.trunc(fedPct / 3))) / 100);

  /* Various things speed up regeneration. */
  if (playerOfHasWorld(state, OF.REGEN)) percent *= 2;
  if (playerRestingCanRegenerate(state)) percent *= 2;

  /* Some things slow it down. */
  if (playerOfHasWorld(state, OF.IMPAIR_HP)) percent = Math.trunc(percent / 2);

  /* Things that interfere with physical healing. */
  if (p.timed[TMD.PARALYZED] ?? 0) percent = 0;
  if (p.timed[TMD.POISONED] ?? 0) percent = 0;
  if (p.timed[TMD.STUN] ?? 0) percent = 0;
  if (p.timed[TMD.CUT] ?? 0) percent = 0;

  const hpGain = p.mhp * percent + PY_REGEN_HPBASE;
  playerAdjustHpPrecise(p, hpGain);

  /* Notice changes. */
  if (oldChp !== p.chp) {
    equipLearnFlag(p, state.runeEnv, OF.REGEN);
    equipLearnFlag(p, state.runeEnv, OF.IMPAIR_HP);
  }
}

/**
 * player_regen_mana (player-util.c:487-530): one turn of mana regeneration.
 * PF_COMBAT_REGEN (Blackguard) suppresses the OF_REGEN / resting speed-ups
 * while above half HP, then degenerates mana (percent /= -2) and converts the
 * lost SP to HP at double efficiency; otherwise OF_IMPAIR_MANA halves the gain.
 */
export function playerRegenMana(state: GameState): void {
  const p = state.actor.player;
  const oldCsp = p.csp;
  let percent = PY_REGEN_NORMAL;
  const combatRegen = playerHasWorld(state, PF.COMBAT_REGEN);

  /* Various things speed up regeneration, but shouldn't punish healthy BGs. */
  if (!(combatRegen && p.chp > Math.trunc(p.mhp / 2))) {
    if (playerOfHasWorld(state, OF.REGEN)) percent *= 2;
    if (playerRestingCanRegenerate(state)) percent *= 2;
  }

  /* Some things slow it down. */
  if (combatRegen) {
    percent = Math.trunc(percent / -2);
  } else if (playerOfHasWorld(state, OF.IMPAIR_MANA)) {
    percent = Math.trunc(percent / 2);
  }

  /* Regenerate mana. */
  let spGain = p.msp * percent;
  if (percent >= 0) spGain += PY_REGEN_MNBASE;
  spGain = playerAdjustManaPrecise(p, spGain);

  /* SP degen heals BGs at double efficiency vs casting. */
  if (spGain < 0 && combatRegen) {
    convertManaToHp(p, -spGain * 2);
  }

  /* Notice changes. */
  if (oldCsp !== p.csp) {
    equipLearnFlag(p, state.runeEnv, OF.REGEN);
    equipLearnFlag(p, state.runeEnv, OF.IMPAIR_MANA);
  }
}

/**
 * decrease_timeouts (game-world.c L280): count the player timed effects down.
 * Most drop by 1; poison / stun / cut drop by the CON regeneration adjust (cut
 * maintains at 0 for a Mortal Wound or a Rock player); TMD_FOOD is handled by
 * digestion and does not decrement here. TMD_COMMAND stays aligned with the
 * commanded monster's timer, and a commanded monster out of sight is out of
 * mind (game-world.c L324).
 *
 * Each per-effect decrement routes through player_dec_timed (with the bound
 * timed table + hooks from state.world), so grade transitions and wear-off
 * messages fire. Absent the world env, it falls back to the raw mutation for
 * worldless callers. The curse-timeout countdown (L343-364) is DEFERRED with
 * the curse subsystem; it draws no RNG while no cursed items are equipped.
 */
export function decreaseTimeouts(state: GameState): void {
  const p = state.actor.player;
  const conInd = calcStatIndices(p.race, p.cls, p.statCur)[STAT.CON] ?? 0;
  const adjust = (adj_con_fix[conInd] ?? 0) + 1;
  const env = state.world;
  const table = env?.timedTable;
  const thooks = env?.timedHooks ?? {};

  for (let i = 0; i < TMD_MAX; i++) {
    const cur = p.timed[i] ?? 0;
    if (!cur) continue;
    let decr = 1;

    /* Special cases. */
    if (i === TMD.FOOD) {
      decr = 0;
    } else if (i === TMD.CUT) {
      const cut = table?.[TMD.CUT];
      if (cut && playerTimedGradeEq(p, cut, "Mortal Wound")) decr = 0;
      else decr = adjust;
      /* Rock players just maintain. */
      if (playerHasWorld(state, PF.ROCK)) decr = 0;
    } else if (i === TMD.POISONED || i === TMD.STUN) {
      decr = adjust;
    } else if (i === TMD.COMMAND) {
      const mon = getCommandedMonster(state);
      if (mon && !los(state.chunk, state.actor.grid, mon.grid)) {
        /* Out of sight is out of mind. */
        monClearTimed(state.rng, mon, MON_TMD.COMMAND, MON_TMD_FLG_NOTIFY);
        const cmd = table?.[TMD.COMMAND];
        if (cmd) playerClearTimed(p, cmd, true, true, thooks);
        else p.timed[i] = 0;
      } else if (mon) {
        /* Keep the monster timer aligned. */
        monDecTimed(state.rng, mon, MON_TMD.COMMAND, decr, 0);
      }
    }

    /* Decrement the effect. */
    const eff = table?.[i];
    if (eff) playerDecTimed(p, eff, decr, false, true, thooks);
    else p.timed[i] = Math.max(0, cur - decr);
  }
}

/**
 * Decrease trap timeouts (game-world.c L759): every disabled trap counts its
 * timeout down; the square_memorize_traps / square_light_spot refresh when a
 * seen trap re-arms is a presentation concern (#25) and is DEFERRED. No RNG.
 */
function decreaseTrapTimeouts(state: GameState): void {
  for (const traps of state.traps.values()) {
    for (const trap of traps) {
      if (trap.timeout) trap.timeout--;
    }
  }
}

/**
 * process_world (game-world.c L532): the once-every-ten-game-turns upkeep,
 * reproduced statement by statement in upstream order (take_hit early-returns
 * on death and the RNG draw sequence are order-sensitive). The MFLAG detection
 * fade (tickMonsterMarks), monster-list compaction, ambient sound + town clock,
 * ambient monster generation, damage / healing over time, food digestion,
 * HP/mana regen, timed-effect countdown, light-fuel burn, experience drain,
 * rod / activatable recharge, learn-after-time, trap timeouts, and the
 * involuntary Word-of-Recall / Deep-Descent movement all run here.
 */
export function processWorld(state: GameState): void {
  const p = state.actor.player;

  /* MFLAG_NICE / MARK / SHOW detection-fade housekeeping (game-world.c:882). */
  tickMonsterMarks(state);

  /* Compact the monster list if we're approaching the limit. */
  if (caveMonsterCount(state) + 32 > state.z.levelMonsterMax) {
    compactMonsters(state, 64);
  }
  /* Too many holes in the monster list - compress (RNG-free, slot reuse). */
  if (caveMonsterCount(state) + 32 < state.monsters.length) {
    compactMonsters(state, 0);
  }

  /*** Check the Time ***/

  /* Play an ambient sound at regular intervals. */
  if (state.turn % Math.trunc((10 * state.z.dayLength) / 4) === 0) {
    playAmbientSound(state);
  }

  /* Handle stores and sunshine. */
  if (state.chunk.depth === 0) {
    /* Daybreak / nightfall in town. */
    if (state.turn % Math.trunc((10 * state.z.dayLength) / 2) === 0) {
      const dawn = state.turn % (10 * state.z.dayLength) === 0;
      state.msg?.(dawn ? "The sun has risen." : "The sun has fallen.");
      state.world?.caveIlluminate?.(state, dawn);
    }
  } else {
    /* Update the stores once a day while in the dungeon. */
    if (state.turn % (10 * state.z.storeTurns) === 0) {
      state.daycount = (state.daycount ?? 0) + 1;
    }
  }

  /* Check for light change (PU_BONUS folds into the recompute below). */

  /* Check for creature generation. The one_in_ roll is drawn UNCONDITIONALLY
   * each world tick so the seeded stream stays stable even if the spawn hook
   * is absent; pick_and_place_distant_monster then draws its own variable
   * sequence (x-then-y per attempt, then get_mon_num / placement). */
  if (state.rng.oneIn(state.z.allocMonsterChance)) {
    state.world?.spawnAmbientMonster?.(state);
  }

  /*** Damage (or healing) over Time ***/
  if (processDamageOverTime(state)) return;

  /*** Check the Food, and Regenerate ***/

  /* Digest (the gorged branch flags PU_BONUS, folded into the recompute below). */
  digestFood(state);

  /* Faint or starving. */
  if (processFaintOrStarve(state)) return;

  /* Regenerate Hit Points if needed. */
  if (p.chp < p.mhp) playerRegenHp(state);

  /* Regenerate or lose mana. */
  playerRegenMana(state);

  /* Timeout various things. */
  decreaseTimeouts(state);

  /* Process light (PU_TORCH). */
  playerUpdateLight(state);

  /* Update noise and scent (not if resting) - game-world.c:731-735. The
   * monster movement AI reads these floods (monster-turn.ts:257-269) to track
   * the player through corridors and around corners once LOS breaks. Neither
   * make_noise nor update_scent draws RNG, so the seeded stream is unaffected.
   * The resting guard rides the WP-11 seam (false today). */
  if (!playerIsResting(state)) {
    const src = {
      grid: state.actor.grid,
      covertTracks: (p.timed[TMD.COVERTRACKS] ?? 0) > 0,
    };
    makeNoise(state.chunk, src);
    updateScent(state.chunk, src);
  }

  /*** Process Inventory ***/

  /* Handle experience draining (OF_DRAIN_EXP). */
  processExpDrain(state);

  /* Recharge activatable objects and rods. */
  rechargeObjects(state);

  /* Notice things after time (game-world.c L755: every 100 game turns). */
  if (state.turn % 100 === 0) equipLearnAfterTime(p, state.runeEnv);

  /* Decrease trap timeouts. */
  decreaseTrapTimeouts(state);

  /* Apply the collapsed PU_TORCH / PU_BONUS recompute: UNLIGHT and the gorged
   * digest branch flag PU_BONUS, and PU_TORCH (torch radius) is set every tick,
   * so recompute the derived state once when the bonus hook is installed. */
  state.updateBonuses?.();

  /*** Involuntary Movement ***/

  /* Delayed Word-of-Recall; suspended in arenas (game-world.c L784). */
  if (p.wordRecall > 0 && !state.arenaLevel) {
    p.wordRecall--;
    if (p.wordRecall === 0) {
      if (state.chunk.depth > 0) {
        state.msg?.("You feel yourself yanked upwards!");
        state.targetDepth = 0;
      } else {
        state.msg?.("You feel yourself yanked downwards!");
        /* player_set_recall_depth: non-persistent levels use max_depth. */
        p.recallDepth = p.maxDepth;
        state.targetDepth = p.recallDepth;
      }
      state.generateLevel = true;
    }
  }

  /* Delayed Deep Descent. */
  if (p.deepDescent > 0) {
    p.deepDescent--;
    if (p.deepDescent === 0) {
      const increment = Math.trunc(4 / state.z.stairSkip) + 1;
      const targetDepth = Math.min(
        p.maxDepth + increment,
        state.z.maxDepth - 1,
      );
      if (targetDepth > state.chunk.depth) {
        state.msg?.("The floor opens beneath you!");
        state.targetDepth = targetDepth;
        state.generateLevel = true;
      } else {
        /* The disastrous EF_DESTRUCTION fallback rides that handler. */
        state.msg?.("You are thrown back in an explosion!");
      }
    }
  }
}

/** Non-null when the loop must stop and hand control back to the caller. */
function loopStop(state: GameState): LoopStatus | null {
  if (state.isDead) return LOOP_STATUS.DEAD;
  if (!state.playing) return LOOP_STATUS.STOPPED;
  if (state.generateLevel) return LOOP_STATUS.LEVEL_CHANGE;
  return null;
}

/**
 * Take player turns while the player has the energy, letting any monster with
 * strictly more energy act first (process_monsters(player.energy + 1)).
 * Returns a stop status, or null when the player ran out of energy normally.
 */
function playerTurnsWhileEnergised(
  state: GameState,
  registry: ActionRegistry,
): LoopStatus | null {
  while (state.actor.energy >= state.z.moveEnergy) {
    processMonsters(state, state.actor.energy + 1);
    const s = loopStop(state);
    if (s) return s;

    const r = processPlayer(state, registry);
    const s2 = loopStop(state);
    if (s2) return s2;
    /* Terrain damage after each acted turn (game-world.c:864). */
    if (r.energyUsed) {
      playerTakeTerrainDamage(state);
      const s3 = loopStop(state);
      if (s3) return s3;
    }
    if (r.needsInput || !r.energyUsed) return LOOP_STATUS.INPUT;
  }
  return null;
}

/**
 * run_game_loop: advance until the player must act, dies, or a level change is
 * requested. Deterministic under the seeded state.rng.
 */
export function runGameLoop(
  state: GameState,
  registry: ActionRegistry,
): LoopStatus {
  /* The player's own turn first. */
  {
    const r = processPlayer(state, registry);
    const s = loopStop(state);
    if (s) return s;
    /* Player can be damaged by terrain (game-world.c:864): fiery terrain (lava)
     * burns the player after each acted turn. */
    if (r.energyUsed) {
      playerTakeTerrainDamage(state);
      const st = loopStop(state);
      if (st) return st;
    }
    if (r.needsInput || !r.energyUsed) return LOOP_STATUS.INPUT;
  }

  /* The player may still have energy for another turn. */
  {
    const s = playerTurnsWhileEnergised(state, registry);
    if (s) return s;
  }

  /* Run the world until the player is needed again. */
  for (;;) {
    const s = loopStop(state);
    if (s) return s;

    processMonsters(state, 0);
    resetMonsters(state);
    const s2 = loopStop(state);
    if (s2) return s2;

    if (state.turn % 10 === 0) {
      processWorld(state);
      const s3 = loopStop(state);
      if (s3) return s3;
    }

    givePlayerEnergy(state);
    state.turn++;

    const s4 = playerTurnsWhileEnergised(state, registry);
    if (s4) return s4;
  }
}
