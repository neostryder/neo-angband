/**
 * Monster melee attacks against the player, ported from
 * reference/src/mon-attack.c (make_attack_normal, monster_critical, check_hit,
 * chance_of_monster_hit, adjust_dam_armor) and the RBE_ blow-effect handlers
 * in reference/src/mon-blows.c (Angband 4.2.6).
 *
 * The blow loop, to-hit test, monster critical, per-blow damage roll and the
 * cut/stun rolls are ported faithfully. Blow EFFECTS resolve one of two ways:
 *
 * - When a world-touching MonBlowEnv is injected (the live game), every
 *   melee_effect_handler_* runs its real consequences inline in the EXACT
 *   upstream RNG order: adjust_dam elemental resist rolls (env.elementalDam),
 *   inven_damage, player_apply_damage_reduction on the HP dealt, and all the
 *   status / stat / exp / theft / disenchant / earthquake / knockback effects.
 *   This is the analog of project-player's onSideEffects seam: combat/ stays
 *   worldless, and game/mon-side.ts (makeMonBlowEnv) supplies the environment.
 *   The unreduced context->damage drives the side-effect math and the cut/stun
 *   critical; only the HP actually subtracted goes through damage reduction.
 *
 * - When no env is injected (the worldless harness / unit tests), the effects
 *   that need the player timed / resist / inventory / stat systems are recorded
 *   as structured BlowSideEffect intents (the "stub log"), exactly as before.
 *
 * Additional per-blow rolls now ported inside the blow loop: the protection
 * from evil repel (randint0(100) drawn when PROTEVIL is up vs an evil monster),
 * the PARALYZE damage=1 pre-clamp, and the "player moved" early-out (a blow that
 * relocates the player via earthquake / knockback skips the remaining blows).
 *
 * DEFERRED (ledgered in parity/ledger/combat-melee.yaml): monster lore /
 * smart-learn, monster-vs-monster melee (monster_attack_monster), react_to_slay
 * blocking a theft (the item is stolen regardless; no RNG impact), and attaching
 * stolen gold/items to the monster's held-object pile (monster_carry, coordinated
 * with the loot-drops gap; the item/gold is still removed from the player and no
 * RNG is drawn by the attach).
 */

import type { Rng, RandomValue } from "../rng";
import type { Loc } from "../loc";
import { locEq } from "../loc";
import type { Monster } from "../mon/monster";
import type { Player } from "../player/player";
import { ELEM, MON_TMD, PROJ, RF, STAT, TMD } from "../generated";
import { STUN_DAM_REDUCTION, STUN_HIT_REDUCTION, testHit } from "./hit";

/** A defender's combat AC contribution (upstream p->state.ac + p->state.to_a). */
export interface DefenderState {
  /** state->ac. */
  ac: number;
  /** state->to_a. */
  toA: number;
}

/**
 * A recorded blow side effect ("stub log"): the intent a fully-modelled
 * player-timed / resist / inventory system would apply. `element` and status
 * `amount` durations use the exact upstream formulas.
 */
export type BlowSideEffect =
  | { kind: "timed"; effect: string; amount: number }
  | { kind: "drainStat"; stat: string }
  | { kind: "loseExp"; holdChance: number; amount: number }
  | { kind: "drainCharges" }
  | { kind: "eatGold" }
  | { kind: "eatItem" }
  | { kind: "eatFood" }
  | { kind: "eatLight" }
  | { kind: "disenchant" }
  | { kind: "elemental"; element: string; damage: number }
  | { kind: "earthquake"; radius: number }
  | { kind: "knockback"; distance: number };

/** The outcome of a single monster blow. */
export interface MonBlow {
  hit: boolean;
  /** RBE_ effect name (e.g. "HURT", "POISON"). */
  effect: string;
  /** RBM_ method name (e.g. "HIT", "CLAW"). */
  method: string;
  /** HP damage actually dealt to the player. */
  damage: number;
  sideEffects: BlowSideEffect[];
  obvious: boolean;
}

/** The outcome of a full monster attack (make_attack_normal). */
export interface MonMeleeAttack {
  /** false only when RF_NEVER_BLOW blocked the attack entirely. */
  attacked: boolean;
  blows: MonBlow[];
  totalDamage: number;
  playerDied: boolean;
  /** Aggregated side-effect intents across all blows. */
  sideEffects: BlowSideEffect[];
}

/**
 * The world-touching environment a monster blow needs: the analog of
 * project-player's onSideEffects hook. It keeps combat/ worldless - when
 * absent, monMeleeAttack falls back to the stub-log intents. Implemented by
 * game/mon-side.ts (makeMonBlowEnv), bound to the attacking monster.
 */
export interface MonBlowEnv {
  /** p->grid, read to detect the "player moved" mid-loop break. */
  playerGrid(): Loc;
  /** player_apply_damage_reduction(p, dam): the HP actually taken. */
  applyReduction(dam: number): number;
  /** take_hit(p, reducedDam, ddesc): subtract HP, set is_dead. */
  takeHit(reducedDam: number): void;
  /** p->is_dead after the last takeHit. */
  readonly playerDied: boolean;
  /** msg(): route a blow message to the game's sink. */
  msg(text: string): void;
  /** adjust_dam(p, proj, dam, RANDOMISE): elemental damage after resists. */
  elementalDam(proj: number, dam: number): number;
  /** inven_damage(p, elem, cperc): pack casualties from an elemental hit. */
  invenDamage(elem: number, cperc: number): void;
  /** player_resists(p, elem): el_info[elem].res_level > 0. */
  resists(elem: number): boolean;
  /** player_inc_timed(p, tmd, amount, ..., check): returns whether noticed. */
  incTimed(tmd: number, amount: number, check: boolean): boolean;
  /** randint0(100) < p->state.skills[SKILL_SAVE] (the melee saving throw). */
  saveVsSkill(): boolean;
  /** effect_simple(EF_DRAIN_STAT): sustain check then player_stat_dec. */
  drainStat(stat: number): void;
  /** player_of_has(p, OF_HOLD_LIFE). */
  hasHoldLife(): boolean;
  /** melee_effect_experience's HOLD_LIFE gate and player_exp_lose. */
  drainExp(chance: number, drainAmount: number): void;
  /** DRAIN_CHARGES: drain a random charged wand/staff, healing the monster. */
  drainCharges(rlev: number): void;
  /** EAT_GOLD: save-or-steal the player's gold; returns context->blinked. */
  eatGold(): boolean;
  /** EAT_ITEM: save-or-steal a pack item; returns blinked / obvious. */
  eatItem(): { blinked: boolean; obvious: boolean };
  /** EAT_FOOD: eat a random edible pack item. */
  eatFood(): void;
  /** EAT_LIGHT: EF_DRAIN_LIGHT "250+1d250". */
  eatLight(): void;
  /** EF_DISENCHANT on the player's equipment. */
  disenchant(): void;
  /** EF_EARTHQUAKE centred on the monster, given radius. */
  earthquake(radius: number): void;
  /** thrust_away(monster grid, player grid, dist). */
  thrust(dist: number): void;
  /** Blink the monster away (EF_TELEPORT max_sight*2+5) after the blows. */
  blinkAway(): void;
}

/** Options for a monster melee attack. */
export interface MonMeleeOptions {
  /** monster_is_visible(mon); affects only messaging (DEFERRED). */
  monVisible?: boolean;
  /**
   * The world-touching blow environment (game/mon-side.ts), bound to the
   * attacking monster. When present, blow effects apply for real in upstream
   * RNG order; the `rng` argument MUST be the same stream this env draws from
   * (state.rng), because the env's reused helpers (adjust_dam, inven_damage,
   * ...) draw from it and interleave with this driver's own rolls.
   */
  env?: MonBlowEnv;
}

/* ------------------------------------------------------------------ *
 * Shared math (mon-attack.c)
 * ------------------------------------------------------------------ */

/**
 * chance_of_monster_hit_base: a monster's to-hit from race level and the
 * blow's power.
 */
export function chanceOfMonsterHitBase(level: number, effectPower: number): number {
  return Math.max(level, 1) * 3 + effectPower;
}

/**
 * chance_of_monster_hit: the base value, reduced if the monster is stunned.
 */
export function chanceOfMonsterHit(
  mon: Monster,
  level: number,
  effectPower: number,
): number {
  let toHit = chanceOfMonsterHitBase(level, effectPower);
  if ((mon.mTimed[MON_TMD.STUN] ?? 0) > 0) {
    toHit = Math.trunc((toHit * (100 - STUN_HIT_REDUCTION)) / 100);
  }
  return toHit;
}

/**
 * check_hit: does an attack with the given to-hit land on the player? Uses the
 * player's total AC (state.ac + state.to_a).
 */
export function checkHit(rng: Rng, toHit: number, def: DefenderState): boolean {
  return testHit(rng, toHit, def.ac + def.toA);
}

/**
 * adjust_dam_armor: physical damage remaining after armor (mon-attack.c).
 */
export function adjustDamArmor(damage: number, ac: number): number {
  return damage - Math.trunc((damage * (ac < 240 ? ac : 240)) / 400);
}

/**
 * monster_critical: the "cut/stun" critical tier of a monster blow. All hits
 * doing >= 95% of the maximum possible (and >= 20, or sometimes N) qualify.
 * Returns a tier 0..(6+extra) used to index the cut/stun amount tables.
 */
export function monsterCritical(
  rng: Rng,
  dice: RandomValue,
  rlev: number,
  dam: number,
): number {
  let max = 0;
  const total = rng.randcalc(dice, rlev, "maximise");

  /* Must do at least 95% of perfect */
  if (dam < Math.trunc((total * 19) / 20)) return 0;

  /* Weak blows rarely work */
  if (dam < 20 && rng.randint0(100) >= dam) return 0;

  /* Perfect damage */
  if (dam === total) max++;

  /* Super-charge */
  if (dam >= 20) {
    while (rng.randint0(100) < 2) max++;
  }

  /* Critical damage */
  if (dam > 45) return 6 + max;
  if (dam > 33) return 5 + max;
  if (dam > 25) return 4 + max;
  if (dam > 18) return 3 + max;
  if (dam > 11) return 2 + max;
  return 1 + max;
}

/** Cut amount for a monster_critical tier (make_attack_normal cut switch). */
function cutAmount(rng: Rng, tier: number): number {
  switch (tier) {
    case 0:
      return 0;
    case 1:
      return rng.randint1(5);
    case 2:
      return rng.randint1(5) + 5;
    case 3:
      return rng.randint1(20) + 20;
    case 4:
      return rng.randint1(50) + 50;
    case 5:
      return rng.randint1(100) + 100;
    case 6:
      return 300;
    default:
      return 500;
  }
}

/** Stun amount for a monster_critical tier (make_attack_normal stun switch). */
function stunAmount(rng: Rng, tier: number): number {
  switch (tier) {
    case 0:
      return 0;
    case 1:
      return rng.randint1(5);
    case 2:
      return rng.randint1(10) + 10;
    case 3:
      return rng.randint1(20) + 20;
    case 4:
      return rng.randint1(30) + 30;
    case 5:
      return rng.randint1(40) + 40;
    case 6:
      return 100;
    default:
      return 200;
  }
}

/* ------------------------------------------------------------------ *
 * Blow-effect resolution (mon-blows.c handlers)
 * ------------------------------------------------------------------ */

interface BlowEffectContext {
  rng: Rng;
  /** damage = randcalc(dice, rlev, RANDOMISE), after stun reduction. */
  baseDamage: number;
  ac: number;
  rlev: number;
  /** method->phys: whether the blow has a physical component. */
  phys: boolean;
}

interface BlowEffectResult {
  /** context->damage after the handler (HP dealt, and used by cut/stun crit). */
  hpDamage: number;
  obvious: boolean;
  sideEffects: BlowSideEffect[];
}

const ELEMENT_OF_EFFECT: Readonly<Record<string, string>> = {
  ACID: "ACID",
  ELEC: "ELEC",
  FIRE: "FIRE",
  COLD: "COLD",
  POISON: "POIS",
};

const STAT_OF_EFFECT: Readonly<Record<string, string>> = {
  LOSE_STR: "STR",
  LOSE_INT: "INT",
  LOSE_WIS: "WIS",
  LOSE_DEX: "DEX",
  LOSE_CON: "CON",
};

/** Experience-drain effects: OF_HOLD_LIFE resist chance and base drain dice. */
const EXP_DRAIN: Readonly<Record<string, { holdChance: number; dice: number }>> = {
  EXP_10: { holdChance: 95, dice: 10 },
  EXP_20: { holdChance: 90, dice: 20 },
  EXP_40: { holdChance: 75, dice: 40 },
  EXP_80: { holdChance: 50, dice: 80 },
};

/**
 * Resolve one RBE_ blow effect: compute the HP damage the effect deals to the
 * player (context->damage after the handler runs) and record any timed /
 * stat / inventory / elemental side-effect intents.
 */
function resolveBlowEffect(
  name: string,
  ctx: BlowEffectContext,
): BlowEffectResult {
  const { rng, baseDamage, ac, rlev, phys } = ctx;
  const side: BlowSideEffect[] = [];

  /* Elemental blows: physical component to HP; elemental component deferred. */
  if (name === "ACID" || name === "ELEC" || name === "FIRE" || name === "COLD") {
    const physical = phys ? adjustDamArmor(baseDamage, ac + 50) : 0;
    side.push({
      kind: "elemental",
      element: ELEMENT_OF_EFFECT[name] as string,
      damage: baseDamage,
    });
    return { hpDamage: physical, obvious: true, sideEffects: side };
  }

  switch (name) {
    case "NONE":
      return { hpDamage: 0, obvious: true, sideEffects: side };

    case "HURT":
      return {
        hpDamage: adjustDamArmor(baseDamage, ac),
        obvious: true,
        sideEffects: side,
      };

    case "POISON": {
      const physical = phys ? adjustDamArmor(baseDamage, ac + 50) : 0;
      side.push({ kind: "elemental", element: "POIS", damage: baseDamage });
      side.push({
        kind: "timed",
        effect: "POISONED",
        amount: 5 + rng.randint1(rlev),
      });
      return { hpDamage: physical, obvious: true, sideEffects: side };
    }

    case "DISENCHANT":
      side.push({ kind: "disenchant" });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "DRAIN_CHARGES":
      side.push({ kind: "drainCharges" });
      return { hpDamage: baseDamage, obvious: false, sideEffects: side };

    case "EAT_GOLD":
      side.push({ kind: "eatGold" });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "EAT_ITEM":
      side.push({ kind: "eatItem" });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "EAT_FOOD":
      side.push({ kind: "eatFood" });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "EAT_LIGHT":
      side.push({ kind: "eatLight" });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "BLIND":
      side.push({
        kind: "timed",
        effect: "BLIND",
        amount: 10 + rng.randint1(rlev),
      });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "CONFUSE":
      side.push({
        kind: "timed",
        effect: "CONFUSED",
        amount: 3 + rng.randint1(rlev),
      });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "TERRIFY":
      side.push({
        kind: "timed",
        effect: "AFRAID",
        amount: 3 + rng.randint1(rlev),
      });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "PARALYZE":
      side.push({
        kind: "timed",
        effect: "PARALYZED",
        amount: 3 + rng.randint1(rlev),
      });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "LOSE_STR":
    case "LOSE_INT":
    case "LOSE_WIS":
    case "LOSE_DEX":
    case "LOSE_CON":
      side.push({ kind: "drainStat", stat: STAT_OF_EFFECT[name] as string });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "LOSE_ALL":
      for (const stat of ["STR", "DEX", "CON", "INT", "WIS"]) {
        side.push({ kind: "drainStat", stat });
      }
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "SHATTER": {
      const hp = adjustDamArmor(baseDamage, ac);
      if (hp > 23) {
        side.push({ kind: "earthquake", radius: Math.trunc(hp / 12) });
      }
      if (hp > 100) {
        const value = hp - 100;
        if (rng.randint1(value) > 40) {
          side.push({ kind: "knockback", distance: 1 + Math.trunc(value / 40) });
        }
      }
      return { hpDamage: hp, obvious: true, sideEffects: side };
    }

    case "EXP_10":
    case "EXP_20":
    case "EXP_40":
    case "EXP_80": {
      const spec = EXP_DRAIN[name] as { holdChance: number; dice: number };
      /* damroll(N, 6) is evaluated as the handler's argument. */
      const amount = rng.damroll(spec.dice, 6);
      side.push({ kind: "loseExp", holdChance: spec.holdChance, amount });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };
    }

    case "HALLU":
      side.push({
        kind: "timed",
        effect: "IMAGE",
        amount: 3 + rng.randint1(Math.trunc(rlev / 2)),
      });
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    case "BLACK_BREATH":
      if (rng.oneIn(5)) {
        side.push({
          kind: "timed",
          effect: "BLACKBREATH",
          amount: Math.trunc(baseDamage / 10),
        });
      }
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };

    default:
      /* Unknown effect: deal the base damage, as the fallthrough would. */
      return { hpDamage: baseDamage, obvious: true, sideEffects: side };
  }
}

/** The set of RBE_ effect names this port resolves (for coverage checks). */
export const RESOLVED_BLOW_EFFECTS: readonly string[] = [
  "NONE",
  "HURT",
  "POISON",
  "DISENCHANT",
  "DRAIN_CHARGES",
  "EAT_GOLD",
  "EAT_ITEM",
  "EAT_FOOD",
  "EAT_LIGHT",
  "ACID",
  "ELEC",
  "FIRE",
  "COLD",
  "BLIND",
  "CONFUSE",
  "TERRIFY",
  "PARALYZE",
  "LOSE_STR",
  "LOSE_INT",
  "LOSE_WIS",
  "LOSE_DEX",
  "LOSE_CON",
  "LOSE_ALL",
  "SHATTER",
  "EXP_10",
  "EXP_20",
  "EXP_40",
  "EXP_80",
  "HALLU",
  "BLACK_BREATH",
];

/* ------------------------------------------------------------------ *
 * Live blow-effect resolution (mon-blows.c handlers with a MonBlowEnv)
 * ------------------------------------------------------------------ */

/** effect name -> { proj: PROJ_ value, elem: ELEM_ value } for elementals. */
const ELEMENTAL_OF_EFFECT: Readonly<
  Record<string, { proj: number; elem: number }>
> = {
  ACID: { proj: PROJ.ACID, elem: ELEM.ACID },
  ELEC: { proj: PROJ.ELEC, elem: ELEM.ELEC },
  FIRE: { proj: PROJ.FIRE, elem: ELEM.FIRE },
  COLD: { proj: PROJ.COLD, elem: ELEM.COLD },
  POISON: { proj: PROJ.POIS, elem: ELEM.POIS },
};

/** The "You are covered in acid!" flavour lines (melee_effect_elemental). */
const ELEMENTAL_MESSAGE: Readonly<Record<string, string>> = {
  ACID: "You are covered in acid!",
  ELEC: "You are struck by electricity!",
  FIRE: "You are enveloped in flames!",
  COLD: "You are covered with frost!",
};

const STAT_OF_LIVE_EFFECT: Readonly<Record<string, number>> = {
  LOSE_STR: STAT.STR,
  LOSE_INT: STAT.INT,
  LOSE_WIS: STAT.WIS,
  LOSE_DEX: STAT.DEX,
  LOSE_CON: STAT.CON,
};

/** The outcome of a live blow effect (context->damage, HP taken, blinked). */
interface LiveBlowResult {
  /** context->damage after the handler (unreduced; feeds the cut/stun crit). */
  contextDamage: number;
  /** The HP actually subtracted (post player_apply_damage_reduction). */
  reducedDamage: number;
  obvious: boolean;
  /** context->blinked (EAT_GOLD / EAT_ITEM theft). */
  blinked: boolean;
}

/**
 * melee_effect_elemental (mon-blows.c L417): physical vs elemental, the larger
 * to HP, inven_damage on the elemental component. RNG order: [adjust_dam
 * denominator] then [inven_damage per-item saves].
 */
function applyElemental(
  env: MonBlowEnv,
  name: string,
  ctx: BlowEffectContext,
  pure: boolean,
): { contextDamage: number; reducedDamage: number } {
  if (pure) {
    const line = ELEMENTAL_MESSAGE[name];
    if (line) env.msg(line);
  }
  const map = ELEMENTAL_OF_EFFECT[name]!;
  const physical = ctx.phys ? adjustDamArmor(ctx.baseDamage, ctx.ac + 50) : 0;
  const elementalDam = env.elementalDam(map.proj, ctx.baseDamage);
  const contextDamage = physical > elementalDam ? physical : elementalDam;
  if (elementalDam > 0) {
    env.invenDamage(map.elem, Math.min(elementalDam * 5, 300));
  }
  let reducedDamage = 0;
  if (contextDamage > 0) {
    reducedDamage = env.applyReduction(contextDamage);
    env.takeHit(reducedDamage);
  }
  return { contextDamage, reducedDamage };
}

/**
 * Resolve one RBE_ blow effect for real, running each mon-blows.c handler in
 * the exact upstream RNG order and applying HP through the env. Returns the
 * (unreduced) context->damage for the cut/stun critical, the reduced HP dealt,
 * and context->blinked. The PARALYZE damage=1 pre-clamp is applied by the
 * caller before this runs (mon-blows.c L1020).
 */
function resolveBlowEffectLive(
  name: string,
  ctx: BlowEffectContext,
  env: MonBlowEnv,
): LiveBlowResult {
  const { rng, baseDamage, ac, rlev } = ctx;
  const done = (
    contextDamage: number,
    reducedDamage: number,
    blinked = false,
  ): LiveBlowResult => ({ contextDamage, reducedDamage, obvious: true, blinked });

  /* Elemental blows (pure). */
  if (name === "ACID" || name === "ELEC" || name === "FIRE" || name === "COLD") {
    const r = applyElemental(env, name, ctx, true);
    return done(r.contextDamage, r.reducedDamage);
  }

  switch (name) {
    case "NONE":
      return done(0, 0);

    case "HURT": {
      const cd = adjustDamArmor(baseDamage, ac);
      const reduced = env.applyReduction(cd);
      env.takeHit(reduced);
      return done(cd, reduced);
    }

    case "POISON": {
      const r = applyElemental(env, name, ctx, false);
      if (!env.playerDied) {
        /* player_inc_timed(TMD_POISONED, 5 + randint1(rlev)). */
        env.incTimed(TMD.POISONED, 5 + rng.randint1(rlev), true);
      }
      return done(r.contextDamage, r.reducedDamage);
    }

    case "DISENCHANT": {
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied && !env.resists(ELEM.DISEN)) env.disenchant();
      return done(baseDamage, reduced);
    }

    case "DRAIN_CHARGES": {
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied) env.drainCharges(rlev);
      return done(baseDamage, reduced);
    }

    case "EAT_GOLD": {
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (env.playerDied) return done(baseDamage, reduced);
      const blinked = env.eatGold();
      return done(baseDamage, reduced, blinked);
    }

    case "EAT_ITEM": {
      /* monster_damage_target(context, false): returns only on death. */
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (env.playerDied) return done(baseDamage, reduced);
      const r = env.eatItem();
      return done(baseDamage, reduced, r.blinked);
    }

    case "EAT_FOOD": {
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied) env.eatFood();
      return done(baseDamage, reduced);
    }

    case "EAT_LIGHT": {
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied) env.eatLight();
      return done(baseDamage, reduced);
    }

    case "BLIND": {
      /* melee_effect_timed: duration arg drawn first, then damage, no save. */
      const amount = 10 + rng.randint1(rlev);
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied) env.incTimed(TMD.BLIND, amount, true);
      return done(baseDamage, reduced);
    }

    case "CONFUSE": {
      const amount = 3 + rng.randint1(rlev);
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied) env.incTimed(TMD.CONFUSED, amount, true);
      return done(baseDamage, reduced);
    }

    case "TERRIFY": {
      const amount = 3 + rng.randint1(rlev);
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied) {
        if (env.saveVsSkill()) env.msg("You stand your ground!");
        else env.incTimed(TMD.AFRAID, amount, true);
      }
      return done(baseDamage, reduced);
    }

    case "PARALYZE": {
      const amount = 3 + rng.randint1(rlev);
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied) {
        if (env.saveVsSkill()) env.msg("You resist the effects!");
        else env.incTimed(TMD.PARALYZED, amount, true);
      }
      return done(baseDamage, reduced);
    }

    case "LOSE_STR":
    case "LOSE_INT":
    case "LOSE_WIS":
    case "LOSE_DEX":
    case "LOSE_CON": {
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied) env.drainStat(STAT_OF_LIVE_EFFECT[name]!);
      return done(baseDamage, reduced);
    }

    case "LOSE_ALL": {
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied) {
        env.drainStat(STAT.STR);
        env.drainStat(STAT.DEX);
        env.drainStat(STAT.CON);
        env.drainStat(STAT.INT);
        env.drainStat(STAT.WIS);
      }
      return done(baseDamage, reduced);
    }

    case "SHATTER": {
      const cd = adjustDamArmor(baseDamage, ac);
      const reduced = env.applyReduction(cd);
      env.takeHit(reduced);
      if (env.playerDied) return done(cd, reduced);
      if (cd > 23) env.earthquake(Math.trunc(cd / 12));
      if (cd > 100) {
        const value = cd - 100;
        if (rng.randint1(value) > 40) env.thrust(1 + Math.trunc(value / 40));
      }
      return done(cd, reduced);
    }

    case "EXP_10":
    case "EXP_20":
    case "EXP_40":
    case "EXP_80": {
      const spec = EXP_DRAIN[name]!;
      /* damroll(N, 6) is evaluated as the handler's argument, before take_hit. */
      const drainAmount = rng.damroll(spec.dice, 6);
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied) env.drainExp(spec.holdChance, drainAmount);
      return done(baseDamage, reduced);
    }

    case "HALLU": {
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied) {
        env.incTimed(TMD.IMAGE, 3 + rng.randint1(Math.trunc(rlev / 2)), true);
      }
      return done(baseDamage, reduced);
    }

    case "BLACK_BREATH": {
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      if (!env.playerDied && rng.oneIn(5)) {
        env.incTimed(TMD.BLACKBREATH, Math.trunc(baseDamage / 10), false);
      }
      return done(baseDamage, reduced);
    }

    default: {
      /* Unknown effect: deal the base damage, as the fallthrough would. */
      const reduced = env.applyReduction(baseDamage);
      env.takeHit(reduced);
      return done(baseDamage, reduced);
    }
  }
}

/* ------------------------------------------------------------------ *
 * make_attack_normal
 * ------------------------------------------------------------------ */

/** Zero random_value, for blows that carry no damage dice. */
const ZERO_RV: RandomValue = { base: 0, dice: 0, sides: 0, mBonus: 0 };

/**
 * make_attack_normal: run all of the monster's blows against the player. When
 * `opts.env` is supplied the blow effects apply for real (HP through
 * player_apply_damage_reduction / take_hit, plus every status / stat / theft /
 * terrain consequence in the exact upstream RNG order); otherwise HP damage is
 * applied to `defender.chp` and the rest is recorded as BlowSideEffect intents.
 * Stops early if the player dies or a blow relocates the player.
 */
export function monMeleeAttack(
  rng: Rng,
  mon: Monster,
  defender: Player,
  def: DefenderState,
  opts: MonMeleeOptions = {},
): MonMeleeAttack {
  /* Not allowed to attack. */
  if (mon.race.flags.has(RF.NEVER_BLOW)) {
    return {
      attacked: false,
      blows: [],
      totalDamage: 0,
      playerDied: false,
      sideEffects: [],
    };
  }

  const env = opts.env;
  const rlev = mon.race.level >= 1 ? mon.race.level : 1;
  const stunned = (mon.mTimed[MON_TMD.STUN] ?? 0) > 0;

  const blows: MonBlow[] = [];
  const allSide: BlowSideEffect[] = [];
  let totalDamage = 0;
  let playerDied = false;
  let blinked = false;

  for (const blow of mon.race.blows) {
    /* No more attacks. */
    if (!blow.method) break;
    if (playerDied) break;

    /* p->grid at the start of the blow (mon-attack.c L568). */
    const pgrid: Loc | null = env ? env.playerGrid() : null;
    const effectName = blow.effect.name;

    /* Monster hits player (a "NONE" effect always connects, no to-hit roll). */
    const hit =
      effectName === "NONE" ||
      checkHit(rng, chanceOfMonsterHit(mon, mon.race.level, blow.effect.power), def);

    if (!hit) {
      blows.push({
        hit: false,
        effect: effectName,
        method: blow.method.name,
        damage: 0,
        sideEffects: [],
        obvious: false,
      });
      continue;
    }

    /* Apply "protection from evil" (mon-attack.c L597): an evil monster is
     * repelled on a high roll. The randint0(100) draw happens only when the
     * guard conditions hold, matching the C short-circuit order. */
    if (
      (defender.timed[TMD.PROTEVIL] ?? 0) > 0 &&
      mon.race.flags.has(RF.EVIL) &&
      defender.lev >= rlev &&
      rng.randint0(100) + defender.lev > 50
    ) {
      env?.msg(`${mon.race.name} is repelled.`);
      continue;
    }

    /* Roll dice, reduce when the attacker is stunned. */
    const diceRv = blow.dice ? blow.dice.randomValue() : ZERO_RV;
    let damage = blow.dice ? rng.randcalc(diceRv, rlev, "randomise") : 0;
    if (stunned) {
      damage = Math.trunc((damage * (100 - STUN_DAM_REDUCTION)) / 100);
    }

    /* PARALYZE pre-clamp (mon-blows.c L1020): a paralysed player always takes
     * at least 1 damage, so paralysis cannot be perma-locked at 0 damage. */
    if (
      effectName === "PARALYZE" &&
      (defender.timed[TMD.PARALYZED] ?? 0) > 0 &&
      damage < 1
    ) {
      damage = 1;
    }

    const blowCtx: BlowEffectContext = {
      rng,
      baseDamage: damage,
      ac: def.ac + def.toA,
      rlev,
      phys: blow.method.phys,
    };

    /* context->damage after the handler (unreduced; feeds the cut/stun crit). */
    let contextDamage: number;
    /* The HP actually dealt this blow (reported / totalled). */
    let dealtDamage: number;
    let obvious: boolean;
    const blowSide: BlowSideEffect[] = [];

    if (env) {
      const res = resolveBlowEffectLive(effectName, blowCtx, env);
      contextDamage = res.contextDamage;
      dealtDamage = res.reducedDamage;
      obvious = res.obvious;
      if (res.blinked) blinked = true;
      if (dealtDamage > 0) totalDamage += dealtDamage;
      if (env.playerDied) playerDied = true;
    } else {
      const res = resolveBlowEffect(effectName, blowCtx);
      contextDamage = res.hpDamage;
      dealtDamage = res.hpDamage;
      obvious = res.obvious;
      for (const s of res.sideEffects) blowSide.push(s);
      if (res.hpDamage > 0) {
        defender.chp -= res.hpDamage;
        totalDamage += res.hpDamage;
        if (defender.chp < 0) playerDied = true;
      }
    }

    /* Cut and stun (only one of the two), keyed off the UNREDUCED damage. */
    let doCut = blow.method.cut;
    let doStun = blow.method.stun;
    if (playerDied) {
      doCut = false;
      doStun = false;
    }
    if (doCut && doStun) {
      if (rng.randint0(100) < 50) doCut = false;
      else doStun = false;
    }
    if (doCut) {
      const tier = monsterCritical(rng, diceRv, rlev, contextDamage);
      const amt = cutAmount(rng, tier);
      if (amt) {
        if (env) env.incTimed(TMD.CUT, amt, true);
        else blowSide.push({ kind: "timed", effect: "CUT", amount: amt });
      }
    }
    if (doStun) {
      const tier = monsterCritical(rng, diceRv, rlev, contextDamage);
      const amt = stunAmount(rng, tier);
      if (amt) {
        if (env) env.incTimed(TMD.STUN, amt, true);
        else blowSide.push({ kind: "timed", effect: "STUN", amount: amt });
      }
    }

    for (const s of blowSide) allSide.push(s);
    blows.push({
      hit: true,
      effect: effectName,
      method: blow.method.name,
      damage: dealtDamage,
      sideEffects: blowSide,
      obvious,
    });

    /* Skip the other blows if the player has moved (mon-attack.c L736): an
     * earthquake or knockback relocated the player mid-loop. */
    if (env && pgrid && !locEq(env.playerGrid(), pgrid)) break;
  }

  /* Blink away (mon-attack.c L740): a monster that stole gold / an item
   * teleports after all its blows resolve. */
  if (env && blinked) env.blinkAway();

  return {
    attacked: true,
    blows,
    totalDamage,
    playerDied,
    sideEffects: allSide,
  };
}
