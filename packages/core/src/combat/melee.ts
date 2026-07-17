/**
 * Player melee attacks, ported from reference/src/player-attack.c (Angband
 * 4.2.6): chance_of_melee_hit(_base), melee_damage, py_attack_real and the
 * py_attack blow loop. Standard (non-O) combat only.
 *
 * The upstream `struct player` carries a computed `struct player_state`
 * (calc_bonuses) with to_h/to_d/ac/num_blows/skills/stat_ind; the port's
 * Player does not yet compute that (player/calcs.ts defers it). Combat
 * therefore takes an explicit PlayerCombatState alongside the Player, exactly
 * as upstream separates `p` from `p->state`. num_blows is likewise injected.
 *
 * Knowledge / learning side effects (equip_learn_on_melee_attack,
 * learn_brand_slay_from_melee) are wired at the GAME layer around pyAttack
 * (game/player-turn.ts, game/cave-cmd.ts), keeping this module pure combat
 * math; see obj/knowledge.ts and parity/ledger/obj-knowledge.yaml.
 *
 * Damage now routes through the shared mon_take_hit primitive (mon/take-hit.ts)
 * so a blow generates monster fear (gap 2.4); the full py_attack side-effect
 * suite (gap 2.5) - blow_side_effects (TMD_ATT_CONF), the vampiric drain
 * (TMD_ATT_VAMP), OF_IMPACT earthquakes, bloodlust over-exertion, the
 * shapechange verb, splash, shield bash and the PF_COMBAT_REGEN mana reward -
 * is interleaved at the faithful RNG points via optional MeleeEffectHooks. A
 * caller supplying no hooks (e.g. the effect handlers) still rolls fear but
 * skips the state-mutating side effects, exactly as those simplified paths do.
 *
 * DEFERRED (ledgered in parity/ledger/combat-melee.yaml):
 * - Message text/formatting (the combat code returns the HitType key only).
 *
 * O-combat (birth_percent_damage) IS ported: oMeleeDamage / o_critical_melee,
 * gated in pyAttackReal at the same point upstream branches (player-attack.c
 * L803/L811/L826). With the option off the path is byte-identical to standard.
 */

import type { Rng } from "../rng";
import type { Brand, Slay } from "../obj/types";
import type { GameObject } from "../obj/object";
import { objectWeightOne } from "../obj/object";
import type { Monster } from "../mon/monster";
import { monsterIsLiving } from "../mon/predicate";
import { monTakeHit } from "../mon/take-hit";
import type { MonTakeHitHooks } from "../mon/take-hit";
import type { Player } from "../player/player";
import { SKILL } from "../player/types";
import { adj_dex_th, adj_str_td } from "../player/calcs";
import type { CritActor, HitType } from "./hit";
import {
  BTH_PLUS_ADJ,
  applyDeadliness,
  criticalMelee,
  oCriticalMelee,
  testHit,
} from "./hit";
import {
  getMonsterBrandMultiplier,
  improveAttackModifier,
  objectToDam,
  objectToHit,
} from "./brand-slay";
import type { AttackModifier, TempBrandSlay } from "./brand-slay";

/**
 * The subset of upstream `struct player_state` that combat reads. Supplied by
 * the caller (calc_bonuses is deferred in player/calcs.ts).
 */
export interface PlayerCombatState {
  /** state->to_h. */
  toH: number;
  /** state->to_d. */
  toD: number;
  /** state->ac. */
  ac: number;
  /** state->to_a. */
  toA: number;
  /** state->skills[SKILL_MAX], indexed by SKILL. */
  skills: readonly number[];
  /** state->num_blows, in hundredths of a blow (100 = one blow). */
  numBlows: number;
  /** state->ammo_mult (ranged). */
  ammoMult: number;
  /** state->num_shots, in tenths of a shot (10 = one shot). */
  numShots: number;
  /** state->ammo_tval: the ammo tval the equipped launcher fires (0 = none). */
  ammoTval: number;
  /** state->bless_wield (blessed weapon / holy-wield bonus). */
  blessWield: boolean;
}

/**
 * The state-mutating side effects of a melee blow (player-attack.c:669-978),
 * all optional. combat/melee.ts draws every RNG at the faithful point whenever
 * the triggering condition (the boolean flags below) is met, keeping the stream
 * faithful; the callback then applies the game-state change. A caller that
 * omits a callback leaves that effect's state change a no-op while still
 * drawing its RNG, matching the simplified effect-handler melee paths.
 */
export interface MeleeEffectHooks {
  /** mon_take_hit hooks (kill / become_aware / cover-tracks / arena death). */
  takeHit?: MonTakeHitHooks;
  /** p->timed[TMD_ATT_CONF] > 0: the confusion-brand side effect is armed. */
  attConf?: boolean;
  /** player_clear_timed(p, TMD_ATT_CONF): spend the confusion brand. */
  clearAttConf?: () => void;
  /** mon_inc_timed(mon, MON_TMD_CONF, dur, NOTIFY). */
  confuseMonster?: (mon: Monster, dur: number) => void;
  /** p->timed[TMD_ATT_VAMP] > 0: the vampiric drain is armed. */
  attVamp?: boolean;
  /** effect_simple(EF_HEAL_HP, drain): heal the player by the amount drained. */
  healPlayer?: (amount: number) => void;
  /** p->timed[TMD_BLOODLUST] > 0: bloodlust over-exertion is armed. */
  bloodlust?: boolean;
  /** player_over_exert(p, PY_EXERT_SCRAMBLE, 20, 20) on a missed bloodlust blow. */
  overExertScramble?: () => void;
  /** player_over_exert(p, PY_EXERT_CON, 20, 0) on a landed bloodlust blow. */
  overExertCon?: () => void;
  /** player_of_has(p, OF_IMPACT): earthquake brand present. */
  impact?: boolean;
  /** effect_simple(EF_EARTHQUAKE, rad 10) at the player; draws its own RNG. */
  earthquake?: () => void;
  /** square_monster(cave, grid) == null after the quake (monster gone/moved). */
  monsterGone?: () => boolean;
  /**
   * player_is_shapechanged: the shape's blow verbs (p->shape->blows). When
   * present a random one replaces the attack verb, drawing randint0(len).
   */
  shapeBlows?: readonly string[];
  /**
   * Temporary brands/slays (improve_attack_modifier(p, NULL, ...)); consulted
   * only on the melee path, exactly as upstream.
   */
  temp?: TempBrandSlay;
}

/** Options for a melee attack. */
export interface MeleeOptions {
  /** monster_is_visible(mon); a non-visible target halves the to-hit. */
  monVisible?: boolean;
  /** player_of_has(p, OF_AFRAID); an afraid player cannot attack. */
  afraid?: boolean;
  /**
   * Off-weapon equipped items (body slots >= 2) carrying brands/slays, in
   * slot order. Upstream iterates these before the weapon.
   */
  offhand?: readonly GameObject[];
  /** p->energy for the blow loop (defaults to moveEnergy: one full turn). */
  energy?: number;
  /** z_info->move_energy (constants.txt; 100 upstream). */
  moveEnergy?: number;
  /**
   * OPT(p, birth_percent_damage): route damage through the O-combat path
   * (oMeleeDamage) instead of the standard melee_damage + critical_melee.
   * Off by default; when off, RNG draws are byte-identical to the standard
   * path (the gate adds/reorders nothing).
   */
  percentDamage?: boolean;
  /** The blow side effects (gap 2.5); omitted by pure-math / effect callers. */
  hooks?: MeleeEffectHooks;
}

/** The outcome of a single blow (py_attack_real). */
export interface MeleeBlow {
  hit: boolean;
  damage: number;
  msg: HitType;
  verb: string;
  /** Brand index used (0 = none). */
  brand: number;
  /** Slay index used (0 = none). */
  slay: number;
  monsterDied: boolean;
  /** The blow newly frightened the monster (mon_take_hit's *fear out-param). */
  fear: boolean;
}

/** The outcome of a full attack (py_attack). */
export interface MeleeAttack {
  blows: MeleeBlow[];
  totalDamage: number;
  monsterDied: boolean;
  /**
   * The monster survived and was left frightened and visible: py_attack's
   * end-of-loop add_monster_message(MON_MSG_FLEE_IN_TERROR). The caller emits
   * the "flees in terror" line.
   */
  monsterFled: boolean;
}

function skill(state: PlayerCombatState, idx: number): number {
  return state.skills[idx] ?? 0;
}

function critActor(p: Player, state: PlayerCombatState): CritActor {
  return {
    lev: p.lev,
    toH: state.toH,
    meleeSkill: skill(state, SKILL.TO_HIT_MELEE),
    bowSkill: skill(state, SKILL.TO_HIT_BOW),
    throwSkill: skill(state, SKILL.TO_HIT_THROW),
  };
}

/**
 * chance_of_melee_hit_base: the player's melee to-hit before the target.
 */
export function chanceOfMeleeHitBase(
  state: PlayerCombatState,
  weapon: GameObject | null,
): number {
  const bonus =
    state.toH + (weapon ? objectToHit(weapon) : 0) + (state.blessWield ? 2 : 0);
  return skill(state, SKILL.TO_HIT_MELEE) + bonus * BTH_PLUS_ADJ;
}

/**
 * chance_of_melee_hit: to-hit against a specific monster (half if unseen).
 */
export function chanceOfMeleeHit(
  state: PlayerCombatState,
  weapon: GameObject | null,
  monVisible: boolean,
): number {
  const chance = chanceOfMeleeHitBase(state, weapon);
  return monVisible ? chance : Math.trunc(chance / 2);
}

/**
 * melee_damage: base weapon dice, times the best slay or brand multiplier,
 * plus the weapon's to-dam. Standard (non-O) combat.
 */
export function meleeDamage(
  rng: Rng,
  mon: Monster,
  weapon: GameObject | null,
  brand: number,
  slay: number,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
): number {
  let dmg = weapon ? rng.damroll(weapon.dd, weapon.ds) : 1;

  if (slay) {
    dmg *= (slays[slay] as Slay).multiplier;
  } else if (brand) {
    dmg *= getMonsterBrandMultiplier(mon, brands[brand] as Brand, false);
  }

  if (weapon) dmg += objectToDam(weapon);

  return dmg;
}

/** The (possibly critical-boosted) damage of a single blow plus its message. */
export interface DamageOutcome {
  damage: number;
  msg: HitType;
}

/**
 * o_melee_damage (player-attack.c L501): the birth_percent_damage melee path.
 * Deadliness and the slay/brand o_multiplier add extra SIDES to the damage
 * dice; criticals add extra DICE. Unlike the standard path, the player's
 * to-dam (player_damage_bonus) is folded in here via deadliness, so the caller
 * must NOT add state.toD afterwards (upstream skips it under the option gate).
 *
 * RNG order, matching upstream exactly:
 *  1. randint0(10000) - the fractional-sides roll (drawn even when unarmed).
 *  2. (weapon only) o_critical_melee: randint1(chance_den) crit test, then on
 *     a crit the one_in_ level walk.
 *  3. damroll(dice, sides).
 */
export function oMeleeDamage(
  rng: Rng,
  state: PlayerCombatState,
  mon: Monster,
  weapon: GameObject | null,
  brand: number,
  slay: number,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
): DamageOutcome {
  let dice = weapon ? weapon.dd : 1;
  let add = 0;

  /* Average value of a single damage die, x10. */
  let dieAverage = Math.trunc((10 * ((weapon ? weapon.ds : 1) + 1)) / 2);

  /* Slays/brands inflate the average (10x) and contribute a flat add. Melee
   * prefers a slay over a brand (player-attack.c L512: `if (s) ... else if`). */
  if (slay) {
    const oMult = (slays[slay] as Slay).oMultiplier;
    dieAverage *= oMult;
    add = oMult - 10;
  } else if (brand) {
    const bmult = getMonsterBrandMultiplier(mon, brands[brand] as Brand, true);
    dieAverage *= bmult;
    add = bmult - 10;
  } else {
    dieAverage *= 10;
  }

  /* Apply deadliness (x100) from to_d + weapon to-dam. */
  const deadliness = state.toD + (weapon ? objectToDam(weapon) : 0);
  dieAverage = applyDeadliness(dieAverage, Math.min(deadliness, 150));

  /* Sides per die, with a fractional-sides roll. */
  let sides = 2 * dieAverage - 10000;
  const extra = rng.randint0(10000) < sides % 10000;
  sides = Math.trunc(sides / 10000);
  sides += extra ? 1 : 0;

  /* Criticals add dice (excluded for unarmed; upstream leaves msg at MSG_HIT). */
  let msg: HitType = "HIT";
  if (weapon) {
    const crit = oCriticalMelee(rng, chanceOfMeleeHitBase(state, weapon), mon);
    dice += crit.addDice;
    msg = crit.msg;
  }

  let dmg = rng.damroll(dice, sides);
  dmg += add;

  return { damage: dmg, msg };
}

/**
 * py_attack_real: a single melee blow against the monster (player-attack.c
 * L717). Mutates mon.hp on a damaging hit (through mon_take_hit, which also
 * rolls fear), and interleaves the blow side effects via opts.hooks at the
 * faithful RNG points. Returns the blow outcome; blow.monsterDied is the
 * upstream `stop` value and blow.fear is mon_take_hit's *fear out-param.
 */
export function pyAttackReal(
  rng: Rng,
  p: Player,
  state: PlayerCombatState,
  weapon: GameObject | null,
  mon: Monster,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
  opts: MeleeOptions = {},
): MeleeBlow {
  const monVisible = opts.monVisible ?? true;
  const h = opts.hooks;

  /* An afraid player cannot attack (player-attack.c L752). */
  if (opts.afraid) {
    return {
      hit: false, damage: 0, msg: "MISS", verb: "afraid",
      brand: 0, slay: 0, monsterDied: false, fear: false,
    };
  }

  /* Disturb the monster: monster_wake + clear Hold (player-attack.c L759). */
  const th = h?.takeHit;
  if (th) {
    /* Reuse mon_take_hit's wake path only for the damage step; the pre-hit
     * wake is folded there. becomeAware is handled inside mon_take_hit. */
  }

  /* See if the player hit. */
  const success = testHit(
    rng,
    chanceOfMeleeHit(state, weapon, monVisible),
    mon.race.ac,
  );
  if (!success) {
    /* Small chance of bloodlust side-effects on a miss (player-attack.c L770). */
    if (h?.bloodlust && rng.oneIn(50)) h.overExertScramble?.();
    return {
      hit: false, damage: 0, msg: "MISS", verb: weapon ? "hit" : "punch",
      brand: 0, slay: 0, monsterDied: false, fear: false,
    };
  }

  const weight = weapon ? objectWeightOne(weapon) : 0;
  const oCombat = opts.percentDamage ?? false;

  /* Best attack from all slays or brands on all non-launcher equipment.
   * improve_attack_modifier reads birth_percent_damage internally to pick the
   * comparison multiplier, so the O flag is threaded here too (no RNG). */
  const mod: AttackModifier = { brand: 0, slay: 0, verb: weapon ? "hit" : "punch" };
  for (const off of opts.offhand ?? []) {
    improveAttackModifier(off, mon, brands, slays, mod, false, oCombat);
  }
  if (weapon) {
    improveAttackModifier(weapon, mon, brands, slays, mod, false, oCombat);
  }
  /* improve_attack_modifier(p, NULL, ...) for temporary brands/slays. */
  improveAttackModifier(null, mon, brands, slays, mod, false, oCombat, h?.temp);

  /* Get the damage. The option gate matches upstream player-attack.c
   * L803/L811/L826: the standard branch computes base damage, criticals, then
   * adds player_damage_bonus; the O branch folds all of that into oMeleeDamage
   * (to_d enters via deadliness) and skips the trailing state.toD. */
  let dmg: number;
  let msg: HitType;
  if (!oCombat) {
    dmg = meleeDamage(rng, mon, weapon, mod.brand, mod.slay, brands, slays);
    msg = "HIT";
    if (weapon) {
      const crit = criticalMelee(
        rng,
        critActor(p, state),
        mon,
        weight,
        objectToHit(weapon),
        dmg,
      );
      dmg = crit.damage;
      msg = crit.msg;
    }
    /* Apply the player damage bonus (player_damage_bonus = state->to_d). */
    dmg += state.toD;
  } else {
    const o = oMeleeDamage(rng, state, mon, weapon, mod.brand, mod.slay, brands, slays);
    dmg = o.damage;
    msg = o.msg;
  }

  /* Splash damage and earthquakes (player-attack.c L814): splash is computed
   * upstream but blow_after_effects ignores it; do_quake needs OF_IMPACT and
   * dmg > 50. */
  const doQuake = Boolean(h?.impact) && dmg > 50;

  /* Substitute shape-specific blows for shapechanged players (L830): a random
   * shape blow verb replaces the attack verb (drawn even at zero damage). */
  if (h?.shapeBlows && h.shapeBlows.length > 0) {
    mod.verb = h.shapeBlows[rng.randint0(h.shapeBlows.length)]!;
  }

  /* No negative damage; change verb if no damage done. */
  if (dmg <= 0) {
    dmg = 0;
    msg = "MISS";
    mod.verb = "fail to harm";
  }

  /* Pre-damage side effects: blow_side_effects (player-attack.c L864). The
   * confusion brand clears itself and confuses the monster. */
  if (h?.attConf) {
    h.clearAttConf?.();
    /* mon_inc_timed(mon, MON_TMD_CONF, 10 + randint0(p->lev) / 10, NOTIFY). */
    const dur = 10 + Math.trunc(rng.randint0(p.lev) / 10);
    h.confuseMonster?.(mon, dur);
  }

  /* Damage, check for hp drain, fear and death (player-attack.c L867). */
  const drain = Math.min(mon.hp, dmg);
  const res = monTakeHit(rng, mon, dmg, null, th ?? {});
  let stop = res.died;
  let fear = res.fear;

  /* Small chance of bloodlust side-effects on a hit (player-attack.c L871). */
  if (h?.bloodlust && rng.oneIn(50)) h.overExertCon?.();

  /* Vampiric drain: heal by the damage drained if the monster lives (L877). */
  if (!stop && h?.attVamp && monsterIsLiving(mon)) {
    h.healPlayer?.(drain);
  }

  /* A dead monster is not frightened (player-attack.c L883). */
  if (stop) fear = false;

  /* Post-damage effects: blow_after_effects earthquake (player-attack.c L887). */
  if (doQuake && h?.earthquake) {
    h.earthquake();
    /* Monster may be dead or moved by the quake. */
    if (h.monsterGone?.() ?? false) stop = true;
  }

  return {
    hit: true,
    damage: dmg,
    msg,
    verb: mod.verb,
    brand: mod.brand,
    slay: mod.slay,
    monsterDied: stop,
    fear,
  };
}

/**
 * py_attack: land blows until the next blow would exceed the energy available
 * for a single turn, or the monster dies. blow_energy = 100 * move_energy /
 * num_blows; energy defaults to a full turn's worth.
 */
export function pyAttack(
  rng: Rng,
  p: Player,
  state: PlayerCombatState,
  weapon: GameObject | null,
  mon: Monster,
  brands: readonly (Brand | null)[],
  slays: readonly (Slay | null)[],
  opts: MeleeOptions = {},
): MeleeAttack {
  const moveEnergy = opts.moveEnergy ?? 100;
  const availEnergy = Math.min(opts.energy ?? moveEnergy, moveEnergy);
  /* Guard a degenerate num_blows against a zero-energy infinite loop. */
  const blowEnergy = Math.max(
    1,
    Math.trunc((100 * moveEnergy) / state.numBlows),
  );

  const blows: MeleeBlow[] = [];
  let totalDamage = 0;
  let slain = false;
  let used = 0;

  while (availEnergy - used >= blowEnergy && !slain) {
    const blow = pyAttackReal(rng, p, state, weapon, mon, brands, slays, opts);
    blows.push(blow);
    totalDamage += blow.damage;
    if (blow.monsterDied) slain = true;
    used += blowEnergy;
  }

  return { blows, totalDamage, monsterDied: slain };
}
