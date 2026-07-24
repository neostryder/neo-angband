/**
 * The once-every-ten-game-turns world upkeep helpers, ported statement by
 * statement from reference/src/game-world.c process_world (Angband 4.2.6) plus
 * player_update_light / player_over_exert (player-util.c) and compact_monsters
 * (mon-make.c). The orchestrating processWorld / decreaseTimeouts stay in
 * game/loop.ts (where the turn loop and HP/mana regen live); this module holds
 * the individual steps so loop.ts reads as the upstream statement list.
 *
 * Every RNG-drawing step is reproduced in exact upstream order so the seeded
 * stream is faithful for save determinism:
 *  - ambient monster: one_in_(alloc_monster_chance), drawn UNCONDITIONALLY each
 *    world tick (spawnAmbientMonster in mon-place.ts draws x-then-y per attempt);
 *  - damage over time: poison / cut are RNG-free, but each take_hit can draw the
 *    bloodlust death-save randint0(10) (state.rng is always threaded in);
 *  - bloodlust over-exert: randint0(100) per set PY_EXERT_* flag in SOURCE order
 *    (CON, FAINT, SCRAMBLE, CUT, CONF, HALLU, SLOW, HP), then randint1(amount);
 *  - black breath: three one_in_(2) always drawn in order when active;
 *  - faint: one_in_(10) then randint0(5); starvation: RNG-free;
 *  - exp drain: one_in_(10) then damroll(10,6) only when gated;
 *  - recharge / trap timeouts / town clock: RNG-free (randcalc AVERAGE);
 *  - compact_monsters(c, 64) on an overcrowded level: randint0(100) per
 *    candidate in the vicious-iteration order.
 */

import { ELEM, MSG, OF, PF, PROJ, RF, STAT, TMD } from "../generated";
import type { Loc } from "../loc";
import type { GameObject } from "../obj/object";
import { tvalIsLight } from "../obj/object";
import { equipLearnElement, equipLearnFlag } from "../obj/knowledge";
import type { ProjectionInfo } from "../world/projection";
import { adjustDam } from "../world/projection";
import { invenDamage } from "./project-obj";
import {
  numberCharging,
  rechargeTimeout,
  tvalCanHaveTimeout,
} from "../obj/recharge";
import type { TimedEffect } from "../player/types";
import type { PlayerTimedHooks } from "../player/timed";
import {
  playerDecTimed,
  playerIncTimed,
  playerSetTimed,
  playerTimedGradeEq,
} from "../player/timed";
import type {
  DamageReduction,
  TakeHitHooks,
  TakeHitTarget,
} from "../player/take-hit";
import { playerApplyDamageReduction, takeHit } from "../player/take-hit";
import type { ExpDeps } from "../player/exp";
import { playerExpLose, playerStatDec } from "../player/exp";
import { turnEnergy } from "../mon/monster";
import { monsterIsUnique } from "../mon/predicate";
import { gearGet, gearObjectForUse } from "./gear";
import { disturb } from "./player-path";
import { DEFAULT_HITPOINT_WARN } from "./project-cast";
import { deleteMonster } from "./context";
import type { GameState } from "./context";

/** player-util.h PY_EXERT_* over-exertion bit flags. */
const PY_EXERT_CON = 0x01;
const PY_EXERT_FAINT = 0x02;
const PY_EXERT_SCRAMBLE = 0x04;
const PY_EXERT_CUT = 0x08;
const PY_EXERT_CONF = 0x10;
const PY_EXERT_HALLU = 0x20;
const PY_EXERT_SLOW = 0x40;
const PY_EXERT_HP = 0x80;

/**
 * The process_world upkeep environment the world clock needs beyond the bare
 * GameState: the bound timed-effect table (so decrements route through the
 * grade / message machinery), the take_hit / timed hooks, the ambient-spawn and
 * cave-illuminate hooks, and the experience deps. Installed by the session
 * (wireGame) and the test harness.
 */
export interface WorldClockEnv {
  /** The bound player timed-effect table (player/bind.ts), indexed by TMD. */
  timedTable: readonly TimedEffect[];
  /** player_set_timed / player_dec_timed hooks (onMessage, onNotify). */
  timedHooks?: PlayerTimedHooks;
  /** take_hit consequences for the DoT sources (onDeath, onMessage, ...). */
  takeHitHooks?: TakeHitHooks;
  /** ExpDeps for player_exp_lose (black breath, exp drain). */
  expDeps?: ExpDeps;
  /**
   * pick_and_place_distant_monster: place a random monster far from the player,
   * returning whether one spawned. The one_in_(alloc_monster_chance) roll is
   * drawn in processWorld whether or not this hook is present.
   */
  spawnAmbientMonster?: (state: GameState) => boolean;
  /** cave_illuminate on the town dawn / nightfall boundary. */
  caveIlluminate?: (state: GameState, dawn: boolean) => void;
  /**
   * The bound projection table (reg.projections), so player_take_terrain_damage
   * can run adjust_dam(PROJ_FIRE, ...) against the player's fire resistance for
   * fiery terrain (lava). Absent in bare test harnesses; terrain damage no-ops.
   */
  projections?: readonly ProjectionInfo[];
}

/** is_daytime (game-world.c L125): the first half of each day is daylight. */
export function isDaytime(turn: number, dayLength: number): boolean {
  return turn % (10 * dayLength) < (10 * dayLength) / 2;
}

/** A standalone world message ("The sun has risen.", "You faint...", ...). */
function worldMsg(state: GameState, text: string): void {
  const sink = state.world?.timedHooks?.onMessage;
  if (sink) sink(text, "");
  else state.msg?.(text);
}

/** player_of_has over the live derived state (racial + worn object flags). */
export function playerOfHasWorld(state: GameState, flag: number): boolean {
  return state.playerState?.flags.has(flag) ?? false;
}

/** player_has over the live derived state (class / race player flags). */
export function playerHasWorld(state: GameState, flag: number): boolean {
  return state.playerState?.pflags.has(flag) ?? false;
}

/** state.dam_red / state.perc_dam_red from the last calc_bonuses (else zero). */
function worldReduction(state: GameState): DamageReduction {
  const ps = state.playerState;
  if (!ps) return { damRed: 0, percDamRed: 0 };
  return { damRed: ps.damRed, percDamRed: ps.percDamRed };
}

/** A TakeHitTarget view whose chp / is_dead writes back to the state. */
function worldTakeHitTarget(state: GameState): TakeHitTarget {
  const p = state.actor.player;
  return {
    get chp(): number {
      return p.chp;
    },
    set chp(v: number) {
      p.chp = v;
    },
    mhp: p.mhp,
    lev: p.lev,
    get isDead(): boolean {
      return state.isDead;
    },
    set isDead(v: boolean) {
      state.isDead = v;
    },
    timed: p.timed,
    /* Bug fix (verify t2verify__options-settings-screen): "hitpoint_warn" is
     * not a boolean option name (it is the scalar OptionState.hitpointWarn
     * field), so the old `state.options?.get("hitpoint_warn")` always
     * returned false and the low-hp warning threshold collapsed to 0. */
    hitpointWarn: state.options?.hitpointWarn ?? DEFAULT_HITPOINT_WARN,
  };
}

/** player_apply_damage_reduction on the live player. */
export function applyWorldDamageReduction(state: GameState, dam: number): number {
  return playerApplyDamageReduction(worldTakeHitTarget(state), worldReduction(state), dam);
}

/**
 * take_hit on the live player, always threading state.rng so the bloodlust
 * death-save randint0(10) (player-util.c L232) is drawn faithfully for every
 * DoT source, not just the bloodlust over-exert block.
 */
export function worldTakeHit(state: GameState, dam: number, killer: string): void {
  const hooks: TakeHitHooks = {
    rng: state.rng,
    ...(state.world?.takeHitHooks ?? {}),
  };
  takeHit(worldTakeHitTarget(state), dam, killer, hooks);
}

/**
 * player_check_terrain_damage (player-util.c:913-935): the fire damage a step
 * onto fiery terrain (lava) would inflict right now. base 100+randint1(100),
 * adjust_dam for the live fire resistance, OF_FEATHER halves. `actual` mirrors
 * C's parameter: when true the mitigating fire-resist rune is learned
 * (equip_learn_element, the actual damage path); when false (move_player's
 * pre-move threshold/confirm check) nothing is learned. The RNG drawn is
 * IDENTICAL either way, so calling this once for the pre-move check and once for
 * the post-turn damage reproduces C's faithful double draw. Zero when the grid
 * is not fiery or without a bound projection table.
 */
export function playerCheckTerrainDamage(
  state: GameState,
  grid: Loc,
  actual: boolean,
): number {
  if (!state.chunk.isFiery(grid)) return 0;
  const projections = state.world?.projections;
  if (!projections) return 0;

  const res = state.playerState?.elInfo[ELEM.FIRE]?.resLevel ?? 0;
  /* adjust_dam(actual=true): learn the fire-resist rune from the mitigation. */
  if (actual) equipLearnElement(state.actor.player, state.runeEnv, PROJ.FIRE);
  let dam = adjustDam(
    state.rng,
    projections,
    PROJ.FIRE,
    100 + state.rng.randint1(100),
    "randomise",
    res,
  );
  /* Feather fall makes one lightfooted (player-util.c:926). */
  if (playerOfHasWorld(state, OF.FEATHER)) dam = Math.trunc(dam / 2);
  return dam;
}

/**
 * player_take_terrain_damage (player-util.c:913-966): fiery terrain (lava) burns
 * the player once per acted turn while they stand on it (called at the
 * game-world.c:864 seam, after the command uses energy). Draws the actual fire
 * damage via playerCheckTerrainDamage(actual=true), then damage reduction, the
 * feature hurt message, inven_damage(PROJ_FIRE) on the RAW damage, and take_hit
 * with the die message. Returns true if the player died.
 */
export function playerTakeTerrainDamage(state: GameState): boolean {
  const grid = state.actor.grid;
  const dam = playerCheckTerrainDamage(state, grid, true);
  if (dam <= 0) return false;

  const feat = state.chunk.feature(grid);
  /* Inventory damage is on the RAW incoming damage; the player takes the
   * reduced amount (player-util.c:954-965). */
  const reduced = applyWorldDamageReduction(state, dam);
  const damText =
    reduced > 0 && state.options?.get("show_damage") ? ` (${reduced})` : "";
  worldMsg(state, `${feat.hurtMsg}${damText}`);
  invenDamage(state, PROJ.FIRE, dam);
  worldTakeHit(state, reduced, feat.dieMsg);
  return state.isDead;
}

/**
 * player_over_exert (player-util.c L820): random bad stuff from over-exertion.
 * Tests each PY_EXERT_* flag in SOURCE if-block order (CON, FAINT, SCRAMBLE,
 * CUT, CONF, HALLU, SLOW, HP), drawing randint0(100) per set flag and, on a
 * hit, randint1(amount) (or the CON perm sub-roll). Returns true if the player
 * died in the HP branch.
 */
export function playerOverExert(
  state: GameState,
  flag: number,
  chance: number,
  amount: number,
): boolean {
  if (chance <= 0) return false;

  const p = state.actor.player;
  const rng = state.rng;
  const env = state.world;
  const table = env?.timedTable;
  const thooks = env?.timedHooks ?? {};
  const inc = (idx: number, amt: number, check: boolean): void => {
    const eff = table?.[idx];
    if (eff) playerIncTimed(p, eff, amt, true, true, check, thooks);
  };

  /* CON damage. */
  if (flag & PY_EXERT_CON) {
    if (rng.randint0(100) < chance) {
      const perm = rng.randint0(100) < Math.trunc(chance / 2) && chance >= 50;
      worldMsg(state, "You have damaged your health!");
      playerStatDec(p, STAT.CON, perm);
    }
  }

  /* Fainting. */
  if (flag & PY_EXERT_FAINT) {
    if (rng.randint0(100) < chance) {
      worldMsg(state, "You faint from the effort!");
      inc(TMD.PARALYZED, rng.randint1(amount), false);
    }
  }

  /* Scrambled stats. */
  if (flag & PY_EXERT_SCRAMBLE) {
    if (rng.randint0(100) < chance) inc(TMD.SCRAMBLE, rng.randint1(amount), true);
  }

  /* Cut damage. */
  if (flag & PY_EXERT_CUT) {
    if (rng.randint0(100) < chance) {
      worldMsg(state, "Wounds appear on your body!");
      inc(TMD.CUT, rng.randint1(amount), false);
    }
  }

  /* Confusion. */
  if (flag & PY_EXERT_CONF) {
    if (rng.randint0(100) < chance) inc(TMD.CONFUSED, rng.randint1(amount), true);
  }

  /* Hallucination. */
  if (flag & PY_EXERT_HALLU) {
    if (rng.randint0(100) < chance) inc(TMD.IMAGE, rng.randint1(amount), true);
  }

  /* Slowing. */
  if (flag & PY_EXERT_SLOW) {
    if (rng.randint0(100) < chance) {
      worldMsg(state, "You feel suddenly lethargic.");
      inc(TMD.SLOW, rng.randint1(amount), false);
    }
  }

  /* HP. */
  if (flag & PY_EXERT_HP) {
    if (rng.randint0(100) < chance) {
      const dam = applyWorldDamageReduction(state, rng.randint1(amount));
      worldMsg(state, "You cry out in sudden pain!");
      worldTakeHit(state, dam, "over-exertion");
    }
  }

  return state.isDead;
}

/**
 * Damage (or healing) over time (game-world.c L586-651): poison, cuts,
 * bloodlust over-exert, timed heal and Black Breath, in order. Each take_hit
 * can end the game; returns true when the player died so processWorld
 * early-returns.
 */
export function processDamageOverTime(state: GameState): boolean {
  const p = state.actor.player;
  const table = state.world?.timedTable;

  /* Take damage from poison. */
  if (p.timed[TMD.POISONED]) {
    worldTakeHit(state, applyWorldDamageReduction(state, 1), "poison");
    if (state.isDead) return true;
  }

  /* Take damage from cuts, worse from serious cuts. */
  if (p.timed[TMD.CUT]) {
    let i: number;
    const cut = table?.[TMD.CUT];
    if (playerHasWorld(state, PF.ROCK)) {
      /* Rock players just maintain. */
      i = 0;
    } else if (
      cut &&
      (playerTimedGradeEq(p, cut, "Mortal Wound") ||
        playerTimedGradeEq(p, cut, "Deep Gash"))
    ) {
      i = 3;
    } else if (cut && playerTimedGradeEq(p, cut, "Severe Cut")) {
      i = 2;
    } else {
      i = 1;
    }
    worldTakeHit(state, applyWorldDamageReduction(state, i), "a fatal wound");
    if (state.isDead) return true;
  }

  /* Side effects of diminishing bloodlust. */
  if (p.timed[TMD.BLOODLUST]) {
    playerOverExert(
      state,
      PY_EXERT_HP | PY_EXERT_CUT | PY_EXERT_SLOW,
      Math.max(0, 10 - (p.timed[TMD.BLOODLUST] ?? 0)),
      Math.trunc(p.chp / 10),
    );
    if (state.isDead) return true;
  }

  /* Timed healing (EF_HEAL_HP "30": a clamped 30-HP heal with its message). */
  if (p.timed[TMD.HEAL]) {
    if (p.chp < p.mhp) {
      const num = 30;
      p.chp += num;
      if (p.chp >= p.mhp) {
        p.chp = p.mhp;
        p.chpFrac = 0;
      }
      /* 15 <= 30 < 35 grade bucket (effect-handler-attack.c L243). */
      worldMsg(state, "You feel much better.");
    }
  }

  /* Effects of Black Breath: three separate one_in_(2) rolls in order. */
  if (p.timed[TMD.BLACKBREATH]) {
    if (state.rng.oneIn(2)) {
      worldMsg(state, "The Black Breath sickens you.");
      playerStatDec(p, STAT.CON, false);
    }
    if (state.rng.oneIn(2)) {
      worldMsg(state, "The Black Breath saps your strength.");
      playerStatDec(p, STAT.STR, false);
    }
    if (state.rng.oneIn(2)) {
      /* Life draining. */
      const drain =
        100 + Math.trunc(p.exp / 100) * state.z.lifeDrainPercent;
      worldMsg(state, "The Black Breath dims your life force.");
      playerExpLose(p, drain, false, expDepsOf(state));
    }
  }

  return false;
}

/** A default ExpDeps ({ rng }) when the world env supplies none. */
function expDepsOf(state: GameState): ExpDeps {
  return state.world?.expDeps ?? { rng: state.rng };
}

/**
 * Digest (game-world.c L656-692): the normal turn%100 digestion, the ungated
 * fast-metabolism drain while TMD_HEAL is active, and the gorged branch. All
 * decrements route through player_dec_timed so hunger grade messages fire.
 * Returns true when the gorged branch ran (PU_BONUS).
 */
export function digestFood(state: GameState): boolean {
  const p = state.actor.player;
  const table = state.world?.timedTable;
  const foodEff = table?.[TMD.FOOD];
  if (!foodEff) return false;
  const thooks = state.world?.timedHooks ?? {};
  const dec = (v: number): void => {
    playerDecTimed(p, foodEff, v, false, true, thooks);
  };

  if (!playerTimedGradeEq(p, foodEff, "Full")) {
    /* Digest normally. */
    if (state.turn % 100 === 0) {
      /* Basic digestion rate based on speed. */
      let i = turnEnergy(state.actor.speed, state.z.moveEnergy);
      /* Adjust for food value. */
      i = Math.trunc((i * 100) / state.z.foodValue);
      /* Regeneration takes more food. */
      if (playerOfHasWorld(state, OF.REGEN)) i *= 2;
      /* Slow digestion takes less food. */
      if (playerOfHasWorld(state, OF.SLOW_DIGEST)) i = Math.trunc(i / 2);
      /* Minimal digestion. */
      if (i < 1) i = 1;
      dec(i);
    }

    /* Fast metabolism (ungated - runs every world tick while healing). */
    if (p.timed[TMD.HEAL]) {
      dec(8 * state.z.foodValue);
      if ((p.timed[TMD.FOOD] ?? 0) < state.z.foodHungry) {
        const healEff = table?.[TMD.HEAL];
        if (healEff) playerSetTimed(p, healEff, 0, true, true, thooks);
      }
    }
    return false;
  }

  /* Digest quickly when gorged. */
  dec(Math.trunc(5000 / state.z.foodValue));
  return true;
}

/**
 * Faint or starving (game-world.c L694-716): a Faint player may pass out
 * (one_in_(10) then randint0(5)); a Starving player takes take_hit. Returns
 * true when the player died.
 */
export function processFaintOrStarve(state: GameState): boolean {
  const p = state.actor.player;
  const table = state.world?.timedTable;
  const foodEff = table?.[TMD.FOOD];
  if (!foodEff) return false;

  if (playerTimedGradeEq(p, foodEff, "Faint")) {
    /* Faint occasionally. */
    if (!p.timed[TMD.PARALYZED] && state.rng.oneIn(10)) {
      worldMsg(state, "You faint from the lack of food.");
      disturb(state);
      const paralyzed = table?.[TMD.PARALYZED];
      if (paralyzed) {
        /* Faint (bypass free action). */
        playerIncTimed(
          p,
          paralyzed,
          1 + state.rng.randint0(5),
          true,
          true,
          false,
          state.world?.timedHooks ?? {},
        );
      }
    }
  } else if (playerTimedGradeEq(p, foodEff, "Starving")) {
    /* Calculate damage. */
    const i = Math.trunc((state.z.foodStarve - (p.timed[TMD.FOOD] ?? 0)) / 10);
    worldTakeHit(state, applyWorldDamageReduction(state, i), "starvation");
    if (state.isDead) return true;
  }

  return false;
}

/**
 * player_update_light (player-util.c L682): burn one turn of fuel in the
 * wielded light, dim / out messages, and delete a burnt-out torch. Draws no
 * RNG. Returns true when the light state changed enough to want a bonus recalc
 * (the light went out or a torch was consumed).
 */
export function playerUpdateLight(state: GameState): boolean {
  const p = state.actor.player;
  const lightSlot = p.body.slots.findIndex((s) => s.type === "LIGHT");
  if (lightSlot < 0) return false;
  const handle = p.equipment[lightSlot] ?? 0;
  const obj = handle ? gearGet(state.gear, handle) : null;
  let changed = false;

  /* Burn some fuel in the current light. */
  if (obj && tvalIsLight(obj.tval)) {
    let burnFuel = true;

    /* No wanton burning of light during the day in the town. */
    if (state.chunk.depth === 0 && isDaytime(state.turn, state.z.dayLength)) {
      burnFuel = false;
    }
    /* The NO_FUEL flag: well... */
    if (obj.flags.has(OF.NO_FUEL)) burnFuel = false;

    /* Use some fuel (except on artifacts, or during the day). */
    if (burnFuel && obj.timeout > 0) {
      obj.timeout--;

      /* Special treatment when blind. */
      if (p.timed[TMD.BLIND]) {
        /* Save some light for later. */
        if (obj.timeout === 0) obj.timeout++;
      } else if (obj.timeout === 0) {
        /* The light is now out. */
        disturb(state);
        worldMsg(state, "Your light has gone out!");
        changed = true;

        /* If it's a torch, now is the time to delete it. */
        if (obj.flags.has(OF.BURNS_OUT)) {
          gearObjectForUse(state.gear, p, handle, 1);
        }
      } else if (obj.timeout < 50 && obj.timeout % 20 === 0) {
        /* The light is getting dim. */
        disturb(state);
        worldMsg(state, "Your light is growing faint.");
      }
    }
  }

  /* Calculate torch radius (PU_TORCH). */
  return changed;
}

/**
 * recharged_notice (game-world.c L147): tell the player when an inscribed ("!!")
 * or (with notify_recharge) any item recharges. Message-only; no RNG.
 */
function rechargedNotice(state: GameState, obj: GameObject, all: boolean): void {
  let notify = state.options?.get("notify_recharge") ?? false;
  if (!notify && obj.note && obj.note.includes("!!")) notify = true;
  if (!notify) return;

  disturb(state);
  const name = obj.kind.name;
  if (obj.number > 1) {
    worldMsg(state, all ? `Your ${name} have recharged.` : `One of your ${name} has recharged.`);
  } else if (obj.artifact) {
    worldMsg(state, `The ${name} has recharged.`);
  } else {
    worldMsg(state, `Your ${name} has recharged.`);
  }
}

/**
 * recharge_objects (game-world.c L197): recharge activatable equipment, rods in
 * the pack and rods on the floor. randcalc AVERAGE is deterministic, so no RNG.
 */
export function rechargeObjects(state: GameState): void {
  const rng = state.rng;
  const p = state.actor.player;

  /* Recharge equipment (activatable objects). */
  for (const handle of p.equipment) {
    if (!handle) continue;
    const obj = gearGet(state.gear, handle);
    if (!obj) continue;
    if (rechargeTimeout(rng, obj)) rechargedNotice(state, obj, true);
  }

  /* Recharge the pack (rods only). */
  for (const handle of state.gear.pack) {
    const obj = gearGet(state.gear, handle);
    if (!obj) continue;
    const dischargedStack = numberCharging(rng, obj) === obj.number;
    if (tvalCanHaveTimeout(obj.tval) && rechargeTimeout(rng, obj)) {
      if (obj.timeout === 0) rechargedNotice(state, obj, true);
      else if (dischargedStack) rechargedNotice(state, obj, false);
    }
  }

  /* Recharge other level objects (rods on the floor). */
  for (const pile of state.floor.values()) {
    for (const obj of pile) {
      if (tvalCanHaveTimeout(obj.tval)) rechargeTimeout(rng, obj);
    }
  }
}

/** equip_learn_flag(OF_DRAIN_EXP) through the live rune environment. */
export function processExpDrain(state: GameState): void {
  const p = state.actor.player;
  if (!playerOfHasWorld(state, OF.DRAIN_EXP)) return;

  if (p.exp > 0 && state.rng.oneIn(10)) {
    const d =
      state.rng.damroll(10, 6) +
      Math.trunc(p.exp / 100) * state.z.lifeDrainPercent;
    playerExpLose(p, Math.trunc(d / 10), false, expDepsOf(state));
  }

  equipLearnFlag(p, state.runeEnv, OF.DRAIN_EXP);
}

/**
 * play_ambient_sound (game-world.c L257): pick a MSG_AMBIENT_* by depth and
 * day / night and emit it through state.sound.
 */
export function playAmbientSound(state: GameState): void {
  const depth = state.chunk.depth;
  const day = isDaytime(state.turn, state.z.dayLength);
  let msgt: string;
  if (depth === 0) msgt = day ? "AMBIENT_DAY" : "AMBIENT_NITE";
  else if (depth <= 20) msgt = "AMBIENT_DNG1";
  else if (depth <= 40) msgt = "AMBIENT_DNG2";
  else if (depth <= 60) msgt = "AMBIENT_DNG3";
  else if (depth <= 80) msgt = "AMBIENT_DNG4";
  else msgt = "AMBIENT_DNG5";
  const idx = (MSG as Record<string, number>)[msgt];
  if (idx !== undefined) state.sound?.(idx);
}

/**
 * compact_monsters (mon-make.c L482): when the monster list is overcrowded,
 * delete num_to_compact monsters, getting more vicious each iteration. Each
 * candidate that survives draws randint0(100) (the saving throw), a variable
 * number of draws that MUST be reproduced for save determinism on breeder-heavy
 * levels. The num_to_compact == 0 "too many holes" call is RNG-free (the outer
 * loop never runs) and is handled by slot reuse, so it is a no-op here.
 */
export function compactMonsters(state: GameState, numToCompact: number): void {
  if (numToCompact <= 0) return;

  let numCompacted = 0;
  for (let iter = 1; numCompacted < numToCompact; iter++) {
    /* Get more vicious each iteration. */
    const maxLev = 5 * iter;
    /* Get closer each iteration. */
    const minDis = 5 * (20 - iter);

    for (let mIdx = 1; mIdx < state.monsters.length; mIdx++) {
      const mon = state.monsters[mIdx];
      /* Skip dead / empty slots. */
      if (!mon) continue;
      /* High level monsters start out immune. */
      if (mon.race.level > maxLev) continue;
      /* Ignore nearby monsters. */
      if (minDis > 0 && mon.cdis < minDis) continue;

      /* Saving throw chance. */
      let chance = 90;
      /* Only compact Quest monsters in emergencies. */
      if (mon.race.flags.has(RF.QUESTOR) && iter < 1000) chance = 100;
      /* Try not to compact unique monsters. */
      if (monsterIsUnique(mon)) chance = 99;

      /* All monsters get a saving throw. */
      if (state.rng.randint0(100) < chance) continue;

      /* Delete the monster. */
      deleteMonster(state, mIdx);
      numCompacted++;
    }
  }
}

/** cave_monster_count (cave.c): the number of live monsters. */
export function caveMonsterCount(state: GameState): number {
  let n = 0;
  for (let i = 1; i < state.monsters.length; i++) {
    if (state.monsters[i]) n++;
  }
  return n;
}

/** The PY_EXERT_* over-exertion flags, exported for callers and tests. */
export const PY_EXERT = {
  CON: PY_EXERT_CON,
  FAINT: PY_EXERT_FAINT,
  SCRAMBLE: PY_EXERT_SCRAMBLE,
  CUT: PY_EXERT_CUT,
  CONF: PY_EXERT_CONF,
  HALLU: PY_EXERT_HALLU,
  SLOW: PY_EXERT_SLOW,
  HP: PY_EXERT_HP,
} as const;
