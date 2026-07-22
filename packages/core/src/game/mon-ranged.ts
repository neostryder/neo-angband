/**
 * make_ranged_attack and its spell-selection helpers, ported from
 * reference/src/mon-attack.c (Angband 4.2.6): the AI that decides whether and
 * which spell a monster casts on its turn, then hands the chosen spell to
 * do_mon_spell (game/mon-cast.ts). This is the decider; do_mon_spell is the
 * executor. It lives in game/ because it reads and mutates the GameState (the
 * monster, the player, the chunk) and drives the effect stack.
 *
 * The default-play path is complete: the frequency / range / line-of-sight gate
 * (monster_can_cast, honouring a player decoy via monster_get_target_dist_grid),
 * the "ineffective spell" pruning (remove_bad_spells: heal / haste / teleport-to
 * / whip / spit by range and status, RSF_HEAL_KIN's injured-kin scan, and the
 * birth_ai_learn knowledge filter unset_spells), the clean-bolt and summon-room
 * checks, the random pick, the spell-failure roll with its "tries to cast a
 * spell, but fails." line, and the disturb before the cast. Still injected:
 * become_aware (lore) and the monster-vs-monster witness path.
 */

import { MFLAG, MON_TMD, RSF, TMD } from "../generated";
import { distance } from "../loc";
import type { Loc } from "../loc";
import { los } from "../world/view";
import { PROJECT, projectable } from "../world/project";
import { monsterIsSmart, monsterIsStupid } from "../mon/predicate";
import {
  RST,
  RST_DAMAGE,
  ignoreSpells,
  monSpellIsInnate,
  testSpells,
  unsetSpells,
} from "../mon/spell";
import type { TimedFailLike } from "../obj/object";
import { ELEM_MAX } from "../obj/types";
import type { FlagSet } from "../bitflag";
import { getLore, loreCountU16, loreCountU8 } from "../mon/lore";
import type { Monster } from "../mon/monster";
import { squareIsEmpty, squareMonster } from "./context";
import { squareIsWarded } from "./trap";
import type { GameState } from "./context";
import { doMonSpell } from "./mon-cast";
import type { DoMonSpellDeps } from "./mon-cast";
import { monsterIsDecoyed } from "./monster-turn";
import { disturb } from "./player-path";
import { MDESC_STANDARD, monsterDesc } from "../mon/desc";

/** Extra configuration for make_ranged_attack beyond the do_mon_spell deps. */
export interface MakeRangedAttackConfig {
  /** (player not blind) && monster visible: the seen flag for do_mon_spell. */
  seen?: boolean;
  /** find_any_nearby_injured_kin (monster groups, #19): keep RSF_HEAL_KIN. */
  hasInjuredKin?: (midx: number) => boolean;
  /** become_aware when a camouflaged monster casts (lore, #24). */
  becomeAware?: (midx: number) => void;
  /** The "tries to cast a spell, but fails" message (spell failure). */
  failMessage?: (midx: number) => void;
}

/**
 * monster_get_target_dist_grid (mon-attack.c L65): the distance to and grid of
 * the monster's target, accounting for a player decoy - a decoyed monster aims
 * at the decoy grid, otherwise at the player.
 */
function targetDist(state: GameState, mon: Monster): number {
  if (monsterIsDecoyed(mon, state) && state.decoy) {
    return distance(mon.grid, state.decoy);
  }
  return mon.cdis;
}
function targetGrid(state: GameState, mon: Monster): Loc {
  if (monsterIsDecoyed(mon, state) && state.decoy) return state.decoy;
  return state.actor.grid;
}

/**
 * summon_possible (mon-attack.c L238): whether a summoned creature could appear
 * near a grid - an empty floor grid within 2, in line of sight, that is NOT a
 * glyph of warding. No summons at all on an arena level. S01.
 */
export function summonPossible(state: GameState, grid: Loc): boolean {
  /* No summons in arenas (L243). */
  if (state.arenaLevel) return false;
  const c = state.chunk;
  for (let y = grid.y - 2; y <= grid.y + 2; y++) {
    for (let x = grid.x - 2; x <= grid.x + 2; x++) {
      const near = { x, y };
      if (!c.inBounds(near)) continue;
      if (distance(grid, near) > 2) continue;
      /* Hack: no summon on a glyph of warding (L257). */
      if (squareIsWarded(state, near)) continue;
      if (squareIsEmpty(state, near) && los(c, grid, near)) return true;
    }
  }
  return false;
}

/** MAX_KIN_RADIUS / MAX_KIN_DISTANCE (mon-util.c L841-842). */
const MAX_KIN_RADIUS = 5;
const MAX_KIN_DISTANCE = 5;

/**
 * get_injured_kin (mon-util.c L849): the monster at `grid` if it is a different,
 * same-base, injured monster in line of sight within MAX_KIN_DISTANCE, else null.
 */
function getInjuredKin(state: GameState, mon: Monster, grid: Loc): Monster | null {
  if (grid.x === mon.grid.x && grid.y === mon.grid.y) return null;
  const kin = squareMonster(state, grid);
  if (!kin) return null;
  if (kin.race.base !== mon.race.base) return null;
  if (!los(state.chunk, mon.grid, grid)) return null;
  if (kin.hp === kin.maxhp) return null;
  if (distance(mon.grid, grid) > MAX_KIN_DISTANCE) return null;
  return kin;
}

/**
 * find_any_nearby_injured_kin (mon-util.c L885): whether any injured same-base
 * monster is within MAX_KIN_RADIUS. Drives the RSF_HEAL_KIN prune.
 */
export function findAnyNearbyInjuredKin(state: GameState, mon: Monster): boolean {
  for (let y = mon.grid.y - MAX_KIN_RADIUS; y <= mon.grid.y + MAX_KIN_RADIUS; y++) {
    for (let x = mon.grid.x - MAX_KIN_RADIUS; x <= mon.grid.x + MAX_KIN_RADIUS; x++) {
      if (getInjuredKin(state, mon, { x, y })) return true;
    }
  }
  return false;
}

/**
 * choose_nearby_injured_kin (mon-util.c L907): reservoir-sample (k = 1) one
 * injured same-base monster in LOS around `mon`, or null. Exported for the
 * RSF_HEAL_KIN effect handler (effects/), which heals the chosen kin.
 */
export function chooseNearbyInjuredKin(state: GameState, mon: Monster): Monster | null {
  let nseen = 0;
  let found: Monster | null = null;
  for (let y = mon.grid.y - MAX_KIN_RADIUS; y <= mon.grid.y + MAX_KIN_RADIUS; y++) {
    for (let x = mon.grid.x - MAX_KIN_RADIUS; x <= mon.grid.x + MAX_KIN_RADIUS; x++) {
      const kin = getInjuredKin(state, mon, { x, y });
      if (kin) {
        nseen++;
        if (state.rng.randint0(nseen) === 0) found = kin;
      }
    }
  }
  return found;
}

/** monster_spell_failrate: the chance a (non-innate) spell fizzles. */
export function monsterSpellFailrate(mon: Monster): number {
  /* MIN(spell_power, 1) as upstream (sic). */
  const power = Math.min(mon.race.spellPower, 1);
  let failrate = 0;
  if (!monsterIsStupid(mon)) {
    failrate = 25 - Math.trunc((power + 3) / 4);
    if ((mon.mTimed[MON_TMD.FEAR] ?? 0) > 0) failrate += 20;
    if ((mon.mTimed[MON_TMD.CONF] ?? 0) > 0 || (mon.mTimed[MON_TMD.DISEN] ?? 0) > 0) {
      failrate += 50;
    }
  }
  return failrate;
}

/**
 * remove_bad_spells (mon-attack.c L153): strip spells that would be wasted this
 * turn (a full-health caster's heal, an out-of-range whip, a teleport-to when
 * adjacent, ...), then - under birth_ai_learn - filter out spells the monster
 * has learned the player resists (unset_spells over its known_pstate memory).
 * `deps` carries the bound spell table and timed data the ai_learn block needs;
 * without it (worldless harnesses) the block is skipped, matching ai_learn off.
 */
export function removeBadSpells(
  state: GameState,
  mon: Monster,
  f: FlagSet,
  config: MakeRangedAttackConfig,
  deps?: Pick<DoMonSpellDeps, "spells" | "envDeps">,
): void {
  const tdist = targetDist(state, mon);

  /* Don't heal if full. */
  if (mon.hp >= mon.maxhp) f.off(RSF.HEAL);

  /* Don't heal others with no injured kin nearby (find_any_nearby_injured_kin,
   * scanned only when HEAL_KIN is set, as the C && short-circuits). A caller
   * override wins over the live scan. */
  if (f.has(RSF.HEAL_KIN)) {
    const hasKin = config.hasInjuredKin
      ? config.hasInjuredKin(mon.midx)
      : findAnyNearbyInjuredKin(state, mon);
    if (!hasKin) f.off(RSF.HEAL_KIN);
  }

  /* Don't haste if already well-hasted. */
  if ((mon.mTimed[MON_TMD.FAST] ?? 0) > 10) f.off(RSF.HASTE);

  /* Don't teleport-to a player who is already adjacent. */
  if (tdist === 1) {
    f.off(RSF.TELE_TO);
    f.off(RSF.TELE_SELF_TO);
  }

  /* Don't use the reach attacks when the player is too far. */
  if (tdist > 2) f.off(RSF.WHIP);
  if (tdist > 3) f.off(RSF.SPIT);

  /* Update acquired knowledge (mon-attack.c L192-227), under birth_ai_learn. */
  if (deps && (state.options?.get("birth_ai_learn") ?? false)) {
    /* Occasionally forget player status. */
    if (state.rng.oneIn(20)) {
      mon.knownPstate.flags.wipe();
      mon.knownPstate.pflags.wipe();
      mon.knownPstate.elInfo.fill(0);
    }

    /* Use the memorized info. */
    const aiFlags = mon.knownPstate.flags.clone();
    const aiPflags = mon.knownPstate.pflags.clone();
    let knowSomething = !aiFlags.isEmpty() || !aiPflags.isEmpty();

    const el = new Int16Array(ELEM_MAX);
    for (let i = 0; i < ELEM_MAX; i++) {
      el[i] = mon.knownPstate.elInfo[i] ?? 0;
      if (el[i] !== 0) knowSomething = true;
    }

    /* Cancel out certain flags based on knowledge. */
    if (knowSomething) {
      const timedFail = (name: string): readonly TimedFailLike[] | null => {
        const idx = (TMD as Record<string, number>)[name];
        if (idx === undefined) return null;
        for (const t of deps.envDeps.timedTable) {
          if (t.index === idx) return t.fail;
        }
        return null;
      };
      unsetSpells(state.rng, f, aiFlags, aiPflags, el, mon, deps.spells, timedFail);
    }
  }
}

/**
 * choose_attack_spell: pick a random spell from the flagset, filtered by
 * whether innate and/or non-innate spells are wanted. Returns RSF_NONE when the
 * (filtered) set is empty.
 */
export function chooseAttackSpell(
  state: GameState,
  f: FlagSet,
  innate: boolean,
  nonInnate: boolean,
): number {
  const spells: number[] = [];
  for (let i = RSF.NONE + 1; i < RSF.MAX; i++) {
    if (!innate && monSpellIsInnate(i)) continue;
    if (!nonInnate && !monSpellIsInnate(i)) continue;
    if (f.has(i)) spells.push(i);
  }
  if (spells.length === 0) return RSF.NONE;
  return spells[state.rng.randint0(spells.length)]!;
}

/**
 * monster_can_cast: whether a monster has a chance to cast (innate or not) this
 * turn - a frequency roll gated by the NICE flag, taunt, preferred range, the
 * maximum range and a clear short-range path. The witness path for a non-player
 * target is deferred (the target is always the player here).
 */
export function monsterCanCast(
  state: GameState,
  mon: Monster,
  innate: boolean,
  maxRange: number,
): boolean {
  let chance = innate ? mon.race.freqInnate : mon.race.freqSpell;
  const tdist = targetDist(state, mon);
  const tgrid = targetGrid(state, mon);

  /* Cannot cast when nice, or with no frequency. */
  if (mon.mflag.has(MFLAG.NICE)) return false;
  if (!chance) return false;

  /* A taunted player draws more melee; a preferred-range target draws spells. */
  if ((state.actor.player.timed[TMD.TAUNT] ?? 0) > 0) chance = Math.trunc(chance / 2);
  if (tdist === mon.bestRange) chance *= 2;

  /* Only cast occasionally, in range, with a clear path. The range check uses
   * the full max_range, but the PROJECT_SHORT path is quartered while the player
   * is covering their tracks (project.c L373: COVERTRACKS halves max_range twice).
   * The port's projectable does not self-quarter, so pass the reduced range. S02. */
  if (state.rng.randint0(100) >= chance) return false;
  if (tdist > maxRange) return false;
  const shortRange =
    (state.actor.player.timed[TMD.COVERTRACKS] ?? 0) > 0
      ? Math.trunc(maxRange / 4)
      : maxRange;
  if (!projectable(state.chunk, mon.grid, tgrid, PROJECT.SHORT, shortRange)) {
    return false;
  }

  return true;
}

/**
 * make_ranged_attack: a monster casts a spell, shoots a missile or breathes.
 * Returns whether an attempt was made (which spends the monster's turn).
 */
export function makeRangedAttack(
  state: GameState,
  midx: number,
  deps: DoMonSpellDeps,
  config: MakeRangedAttackConfig = {},
): boolean {
  const mon = state.monsters[midx];
  if (!mon) return false;
  const maxRange = deps.cast.maxRange;
  const seen = config.seen ?? true;

  /* Cast this turn? Try non-innate, then innate. */
  let innate = false;
  if (!monsterCanCast(state, mon, false, maxRange)) {
    if (!monsterCanCast(state, mon, true, maxRange)) return false;
    innate = true;
  }

  /* Work on a copy of the racial spell flags. */
  const f = mon.race.spellFlags.clone();

  /* Smart, badly-hurt monsters save their damage spells for escape. */
  if (
    monsterIsSmart(mon) &&
    mon.hp < Math.trunc(mon.maxhp / 10) &&
    state.rng.oneIn(2)
  ) {
    ignoreSpells(f, RST_DAMAGE);
  }

  /* Non-stupid monsters filter out ineffective spells. */
  if (!monsterIsStupid(mon)) {
    removeBadSpells(state, mon, f, config, deps);

    /* A bolt needs a clear, stopping path to the target. */
    const tgrid = targetGrid(state, mon);
    if (
      testSpells(f, RST.BOLT) &&
      !projectable(state.chunk, mon.grid, tgrid, PROJECT.STOP, maxRange)
    ) {
      ignoreSpells(f, RST.BOLT);
    }

    /* A summon needs somewhere to put the summoned creature. */
    if (!summonPossible(state, mon.grid)) ignoreSpells(f, RST.SUMMON);
  }

  /* No spells left. */
  if (f.isEmpty()) return false;

  /* Choose a spell to cast. */
  const thrown = chooseAttackSpell(state, f, innate, !innate);
  if (!thrown) return false;

  /* A hidden caster reveals itself (lore, #24). */
  config.becomeAware?.(midx);

  /* Spell failure (innate attacks never fail). */
  const failrate = monsterSpellFailrate(mon);
  if (!monSpellIsInnate(thrown) && state.rng.randint0(100) < failrate) {
    /* "X tries to cast a spell, but fails." (mon-attack.c L460). The name is
     * monster_desc(mon, MDESC_STANDARD); a caller-supplied override wins. */
    if (config.failMessage) {
      config.failMessage(midx);
    } else {
      state.msg?.(`${monsterDesc(mon, MDESC_STANDARD)} tries to cast a spell, but fails.`);
    }
    return true;
  }

  /* Cast the spell (disturb the player first, mon-attack.c L465). */
  disturb(state);
  doMonSpell(state, midx, thrown, seen, deps);

  /* Remember what the monster did (mon-attack.c L460). */
  const lore = getLore(state.lore, mon.race);
  if (seen) {
    lore.spellFlags.on(thrown);
    loreCountU8(lore, monSpellIsInnate(thrown) ? "castInnate" : "castSpell");
  }
  /* Always notice cause of death. */
  if (state.isDead) loreCountU16(lore, "deaths");
  return true;
}

/**
 * Install make_ranged_attack as the state's monsterCast hook, so monsters cast
 * during the game loop (the monster turn calls it before moving). The session /
 * loop wiring calls this once, after building the effect registry, projection
 * cast context and bound spells.
 */
export function installMonsterCasting(
  state: GameState,
  deps: DoMonSpellDeps,
  config: MakeRangedAttackConfig = {},
): void {
  state.monsterCast = (mon, s) => makeRangedAttack(s, mon.midx, deps, config);
}
