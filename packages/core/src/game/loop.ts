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
 * regeneration (the exact fixed-point 2^16 formulas) and the player timed
 * array countdown (decrease_timeouts). Monster timeouts count down inside
 * process_monster_timed (monster-turn.ts). Monster-list compaction, ambient
 * sound / day-night town cycle, random creature generation, damage-over-time
 * (poison/cut/starvation), food digestion, light, noise/scent laydown,
 * inventory recharge and word-of-recall / deep-descent are DEFERRED (ledgered
 * in parity/ledger/game-loop.yaml).
 */

import { STAT, TMD } from "../generated";
import { TMD_MAX } from "../player/types";
import { adj_con_fix, calcStatIndices } from "../player/calcs";
import { equipLearnAfterTime } from "../obj/knowledge";
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
 * player_adjust_mana_precise (positive-gain path): add sp_gain (in 2^16ths)
 * to csp/csp_frac, clamped to [0, msp].
 */
export function playerAdjustManaPrecise(p: Player, spGain: number): void {
  if (spGain === 0) return;
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
}

/**
 * player_regen_hp: default (food-tier) HP regeneration. The equipment-derived
 * modifiers (OF_REGEN / OF_IMPAIR_HP), resting bonus and Rock/PF specials are
 * DEFERRED; the food-tier percent, the fed-bonus scaling, and the
 * paralyse/poison/stun/cut zeroing are ported.
 */
export function playerRegenHp(state: GameState): void {
  const p = state.actor.player;
  const food = p.timed[TMD.FOOD] ?? 0;
  let percent = 0;
  if (food >= state.z.foodWeak) percent = PY_REGEN_NORMAL;
  else if (food >= state.z.foodFaint) percent = PY_REGEN_WEAK;
  else if (food >= state.z.foodStarve) percent = PY_REGEN_FAINT;

  /* Food bonus - better fed players regenerate up to 1/3 faster. */
  const fedPct = Math.trunc(food / state.z.foodValue);
  percent = Math.trunc((percent * (100 + Math.trunc(fedPct / 3))) / 100);

  /* Things that interfere with physical healing. */
  if (p.timed[TMD.PARALYZED] ?? 0) percent = 0;
  if (p.timed[TMD.POISONED] ?? 0) percent = 0;
  if (p.timed[TMD.STUN] ?? 0) percent = 0;
  if (p.timed[TMD.CUT] ?? 0) percent = 0;

  const hpGain = p.mhp * percent + PY_REGEN_HPBASE;
  playerAdjustHpPrecise(p, hpGain);
}

/**
 * player_regen_mana: default mana regeneration (PY_REGEN_NORMAL + base). The
 * PF_COMBAT_REGEN / OF_ modifiers and the resting bonus are DEFERRED.
 */
export function playerRegenMana(state: GameState): void {
  const p = state.actor.player;
  const percent = PY_REGEN_NORMAL;
  let spGain = p.msp * percent;
  if (percent >= 0) spGain += PY_REGEN_MNBASE;
  playerAdjustManaPrecise(p, spGain);
}

/**
 * decrease_timeouts: count the player timed effects down. Most drop by 1;
 * poison / stun / cut drop by the CON regeneration adjust (cut Mortal-Wound
 * maintenance, TMD_COMMAND monster sync, curse timeouts and grade-transition
 * messaging are DEFERRED); TMD_FOOD is handled by digestion (DEFERRED) and
 * does not decrement here.
 */
export function decreaseTimeouts(state: GameState): void {
  const p = state.actor.player;
  const conInd = calcStatIndices(p.race, p.cls, p.statCur)[STAT.CON] ?? 0;
  const adjust = (adj_con_fix[conInd] ?? 0) + 1;

  for (let i = 0; i < TMD_MAX; i++) {
    const cur = p.timed[i] ?? 0;
    if (!cur) continue;
    let decr = 1;
    if (i === TMD.FOOD) decr = 0;
    else if (i === TMD.CUT || i === TMD.POISONED || i === TMD.STUN) {
      decr = adjust;
    }
    p.timed[i] = Math.max(0, cur - decr);
  }
}

/**
 * process_world: the once-every-ten-turns upkeep this task owns. Regenerate
 * HP (when hurt) and mana, count the timed effects down, then the
 * involuntary movement countdowns (game-world.c L780): a pending Word of
 * Recall or Deep Descent fires a level change through the same
 * targetDepth / generateLevel signal the stairs use.
 */
export function processWorld(state: GameState): void {
  const p = state.actor.player;
  if (p.chp < p.mhp) playerRegenHp(state);
  playerRegenMana(state);
  decreaseTimeouts(state);

  /* Notice things after time (game-world.c L755: every 100 game turns). */
  if (state.turn % 100 === 0) equipLearnAfterTime(p, state.runeEnv);

  /* Delayed Word-of-Recall. */
  if (p.wordRecall > 0) {
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
