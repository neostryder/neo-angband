/**
 * Shared monster-origin sub-branches for the effect / projection layer, ported
 * from reference/src (Angband 4.2.6). These are the "a monster cast this"
 * refinements that several handlers share: resolving the monster a caster is
 * really aiming at (monster_target_monster), the confused-direction /
 * target-monster / decoy target selection (get_target's SRC_MONSTER branch,
 * effect-handler-attack.c L38), the decoy predicate and destruction
 * (mon-predicate.c L308, cave-square.c square_destroy_decoy), and the
 * monster-vs-monster damage primitive (mon-util.c L1193 mon_take_nonplayer_hit).
 *
 * They live in game/ (not mon/) because they mutate GameState and reuse the
 * cast-context consequence hooks (drops / messages), the same seam discipline
 * as the project_m / project_p drivers. mon/ exports (monsterWake,
 * monsterScaredByDamage, monsterEffectLevel, the predicates) are called, never
 * edited.
 */

import { MON_MSG, MON_TMD, TMD } from "../generated";
import { DDGRID, loc, locIsZero, locSum } from "../loc";
import type { Loc } from "../loc";
import type { Rng } from "../rng";
import type { Monster } from "../mon/monster";
import {
  monsterIsCamouflaged,
  monsterIsUnique,
  monsterIsVisible,
} from "../mon/predicate";
import { monsterEffectLevel } from "../mon/timed";
import { monsterScaredByDamage, monsterWake } from "../mon/take-hit";
import { los } from "../world/view";
import { lookupTrap } from "../world/trap";
import { deleteMonster } from "./context";
import type { GameState } from "./context";
import type { GameEffectEnv } from "./effect-game-env";
import { squareRemoveAllTraps } from "./trap";
import type { TrapDeps } from "./trap";

/**
 * CONF_RANDOM_CHANCE (mon-timed.h L31): the percentage chance, per confusion
 * level, that an aimed monster spell goes in a random direction instead.
 */
export const CONF_RANDOM_CHANCE = 40;

/**
 * monster_target_monster (effect-handler-general.c L96): the monster the
 * casting monster is targeting, or null. Only a SRC_MONSTER origin whose
 * caster has a positive target.midx targets another monster.
 */
export function monsterTargetMonster(
  state: GameState,
  casterMidx: number,
): Monster | null {
  const mon = state.monsters[casterMidx];
  if (!mon) return null;
  if (mon.target.midx > 0) {
    return state.monsters[mon.target.midx] ?? null;
  }
  return null;
}

/** cave_find_decoy (cave.c L719): the player's active decoy grid, or null. */
export function caveFindDecoy(state: GameState): Loc | null {
  const decoy = state.decoy ?? null;
  if (!decoy || locIsZero(decoy)) return null;
  return decoy;
}

/**
 * monster_is_decoyed (mon-predicate.c L308): whether a live decoy exists that
 * the monster can see.
 */
export function monsterIsDecoyed(state: GameState, mon: Monster): boolean {
  const decoy = caveFindDecoy(state);
  if (!decoy) return false;
  return los(state.chunk, mon.grid, decoy);
}

/**
 * square_destroy_decoy (cave-square.c): remove the decoy trap at the decoy
 * grid, clear cave->decoy, and announce it if the player can see it. trapDeps
 * supplies the "decoy" trap kind (only its tidx removal differs from a bare
 * clear); absent, the grid state is still cleared.
 */
export function destroyDecoy(
  state: GameState,
  trapDeps: TrapDeps | undefined,
  msg?: (text: string) => void,
): void {
  const decoy = caveFindDecoy(state);
  if (!decoy) return;
  const decoyKind = trapDeps ? lookupTrap(trapDeps.kinds, "decoy") : null;
  squareRemoveAllTraps(state, decoy, decoyKind ? decoyKind.tidx : -1);
  state.decoy = null;
  const blind = (state.actor.player.timed[TMD.BLIND] ?? 0) > 0;
  if (msg && los(state.chunk, state.actor.grid, decoy) && !blind) {
    msg("The decoy is destroyed!");
  }
}

/**
 * get_target's SRC_MONSTER branch (effect-handler-attack.c L38): resolve the
 * grid a monster's aimed spell/projection strikes. Confusion may send it in a
 * random direction (one randint1(100) draw is always made, matching the
 * upstream RNG stream for every monster-aimed projection); otherwise it aims
 * at a targeted monster, the decoy, or the player, in that order.
 */
export function monsterGetTarget(
  state: GameState,
  rng: Rng,
  casterMidx: number,
): Loc {
  const mon = state.monsters[casterMidx];
  /* Upstream breaks out to the caller's default (player grid) with no draw
   * when the monster is gone; keep that. */
  if (!mon) return state.actor.grid;

  let accuracy = 100;
  let confLevel = monsterEffectLevel(mon, MON_TMD.CONF);
  while (confLevel) {
    accuracy = Math.trunc((accuracy * (100 - CONF_RANDOM_CHANCE)) / 100);
    confLevel--;
  }

  if (rng.randint1(100) > accuracy) {
    const dir = rng.randint1(9);
    return locSum(mon.grid, DDGRID[dir] ?? loc(0, 0));
  }
  if (mon.target.midx > 0) {
    const tMon = state.monsters[mon.target.midx];
    if (tMon) return tMon.grid;
  }
  if (monsterIsDecoyed(state, mon)) {
    const decoy = caveFindDecoy(state);
    if (decoy) return decoy;
  }
  return state.actor.grid;
}

/**
 * mon_take_nonplayer_hit (mon-util.c L1193): apply `dam` to a monster from a
 * non-player source (another monster's spell, an EF_DAMAGE monster origin).
 * Uniques and arena monsters are reduced to but never killed by it. Death runs
 * the shape revert, death message and drops through the cast-context monster
 * hooks (the same ones project_m uses), then deletes the monster; a survivor
 * shows a pain/hurt message and may take fright (the fear roll is made, but the
 * EF_DAMAGE caller preserves the upstream quirk of not announcing it). Returns
 * whether the monster died.
 */
export function monTakeNonplayerHit(
  env: GameEffectEnv,
  tMon: Monster,
  dam: number,
  hurtMsg: number = MON_MSG.NONE,
  dieMsg: number = MON_MSG.DIE,
): boolean {
  const { state } = env;
  const rng = state.rng;
  const hooks = env.cast.hooks?.monster;

  /* "Unique" or arena monsters can only be "killed" by the player. */
  if (monsterIsUnique(tMon) || state.arenaLevel) {
    if (dam > tMon.hp) dam = tMon.hp;
  }

  /* Wake the monster up, doesn't become aware of the player. */
  monsterWake(rng, tMon, false, 0);

  /* Hurt the monster. */
  tMon.hp -= dam;

  if (tMon.hp < 0) {
    /* Shapechanged monsters revert on death. */
    if (tMon.originalRace) hooks?.revertShape?.(tMon);
    if (monsterIsVisible(tMon)) hooks?.message?.(tMon, dieMsg, false);
    /* Generate treasure, etc. (monster_death; removal done here). */
    hooks?.onMonsterDeath?.(tMon);
    deleteMonster(state, tMon.midx);
    return true;
  }

  if (!monsterIsCamouflaged(tMon)) {
    if (hurtMsg !== MON_MSG.NONE) {
      hooks?.message?.(tMon, hurtMsg, false);
    } else if (dam > 0) {
      hooks?.messagePain?.(tMon, dam);
    }
  }

  /* Sometimes a monster gets scared by damage (roll preserved even though the
   * EF_DAMAGE caller does not announce the resulting fear). */
  if (!tMon.mTimed[MON_TMD.FEAR] && dam > 0) {
    monsterScaredByDamage(rng, tMon, dam);
  }

  return false;
}
