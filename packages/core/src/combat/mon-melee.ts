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
 * All four items this header used to list as DEFERRED are ported: monster lore
 * and smart-learn (mon/lore.ts loreLearnFlagIfVisible, project-player.ts:171),
 * monster-vs-monster melee (game/mon-cmd.ts:317 monsterAttackMonster),
 * react_to_slay blocking a theft on the player's pack (game/mon-side.ts:421) and
 * attaching stolen gold/items to the thief's pile (mon/make.ts monsterCarry, used
 * at game/known.ts:854).
 *
 * ONE REMAINS: the monster-vs-monster theft path does not apply react_to_slay
 * (mon/steal.ts:234 vs mon-util.c:1548), so a slay-bearing item cannot resist
 * being stolen by a monster from another monster. No RNG impact.
 */

import type { Rng, RandomValue } from "../rng.js";
import type { Loc } from "../loc.js";
import { locEq } from "../loc.js";
import type { Monster } from "../mon/monster.js";
import type { BlowMethod } from "../mon/types.js";
import type { Player } from "../player/player.js";
import { ELEM, MON_TMD, PROJ, RF, STAT, TMD } from "../generated/index.js";
import { STUN_DAM_REDUCTION, STUN_HIT_REDUCTION, testHit } from "./hit.js";

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
  /** Flush pure-element smart-learn after the complete elemental sequence. */
  finishElemental?: () => void;
  /** p->is_dead after the last takeHit. */
  readonly playerDied: boolean;
  /** msg(): route a blow message to the game's sink. An optional msgt (the
   * blow method's sound channel, e.g. MON_HIT) plays the typed sound. */
  msg(text: string, msgt?: string): void;
  /** monster_desc(mon, MDESC_STANDARD): "The kobold" / "Something", for the
   * per-blow "m_name act." message (drawn once per attack, no RNG). */
  readonly monName: string;
  /** OPT(p, show_damage): append the " (N)" suffix to the blow message. */
  readonly showDamage: boolean;
  /** monster_is_visible(mon): gates the "%s misses you." message (a visible
   * monster's missed blow is announced; an unseen one is silent). */
  readonly monVisible: boolean;
  /**
   * disturb(p): the two disturbs make_attack_normal performs itself, which are
   * NOT take_hit's - a connecting blow disturbs before the damage roll
   * (mon-attack.c L594) and a visible miss disturbs before its message (L721),
   * and neither of those touches HP.
   */
  disturb?(): void;
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
  /**
   * monster_is_visible(mon); affects only messaging. The live path supplies it
   * through MonBlowEnv.monVisible (game/mon-side.ts makeMonBlowEnv); this default
   * is for the worldless harness.
   */
  monVisible?: boolean;
  /**
   * The world-touching blow environment (game/mon-side.ts), bound to the
   * attacking monster. When present, blow effects apply for real in upstream
   * RNG order; the `rng` argument MUST be the same stream this env draws from
   * (state.rng), because the env's reused helpers (adjust_dam, inven_damage,
   * ...) draw from it and interleave with this driver's own rolls.
   */
  env?: MonBlowEnv;
  /**
   * The blow-effect handler table (BlowEffectRegistry). A real game passes
   * `state.blowEffects`, which wireGame seeds with core's 30 and a mod can add
   * to; omitting it falls back to a lazily-built core-only registry, which is
   * what the worldless harnesses and the direct-call tests use.
   */
  blowEffects?: BlowEffectRegistry;
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

export interface BlowEffectContext {
  rng: Rng;
  /** damage = randcalc(dice, rlev, RANDOMISE), after stun reduction. */
  baseDamage: number;
  ac: number;
  rlev: number;
  /** method->phys: whether the blow has a physical component. */
  phys: boolean;
  /** The blow method, for display_blow_message_vs_player's action + msgt. */
  method: BlowMethod;
  /** In the worldless path HP is applied after the handler returns. */
  willPlayerDie?: (damage: number) => boolean;
}

export interface BlowEffectResult {
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
 * monster_blow_method_action (mon-blows.c L74): pick one of the blow method's
 * action messages via randint0(num_messages) and substitute the player-target
 * tags. Returns null when the method carries no messages (act == NULL upstream,
 * which yields the "You take N damage." fallback).
 *
 * The randint0(num_messages) draw is ALWAYS performed so the RNG stream matches
 * upstream whether or not the message is shown. randint0 (Rand_div) short-
 * circuits for num_messages <= 1, so only the multi-message methods (INSULT and
 * MOAN, 8 each) consume any RNG here; every other blow is byte-identical.
 *
 * For a blow against the player (upstream midx < 0) the tags resolve to the
 * fixed second-person words, not a monster_desc: {target}->you, {oftarget}->
 * your, {has}->have (mon-blows.c L116-152).
 */
function monsterBlowMethodAction(method: BlowMethod, rng: Rng): string | null {
  const n = method.messages.length;
  if (n === 0) return null;
  const choice = rng.randint0(n);
  const raw = method.messages[choice] ?? method.messages[0]!;
  return raw
    .replace(/\{target\}/g, "you")
    .replace(/\{oftarget\}/g, "your")
    .replace(/\{has\}/g, "have");
}

/**
 * display_blow_message_vs_player (mon-blows.c L194): show "m_name act." for a
 * blow that lands on the player, with the " (N)" damage suffix when show_damage
 * is on and the blow dealt HP. When `sink` is null (the worldless recording
 * path) the message is drawn but not emitted, so both paths consume RNG
 * identically. The fullstop is dropped when the action ends in "'" or "!".
 */
function displayBlowMessageVsPlayer(
  rng: Rng,
  method: BlowMethod,
  reduced: number,
  monName: string,
  showDamage: boolean,
  sink: ((text: string, msgt: string) => void) | null,
): void {
  const act = monsterBlowMethodAction(method, rng);
  if (!sink) return;
  /* msgt(method->msgt, ...) (mon-blows.c L206-213): the blow line plays the
   * method's sound channel (blow_methods.txt msg:, e.g. MON_HIT). */
  if (act !== null) {
    const fullstop = act.endsWith("'") || act.endsWith("!") ? "" : ".";
    const tail = reduced > 0 && showDamage ? ` (${reduced})` : "";
    sink(`${monName} ${act}${fullstop}${tail}`, method.msgt);
  } else if (reduced > 0 && showDamage) {
    sink(`You take ${reduced} damage.`, method.msgt);
  }
}

/**
 * Live-path blow message: emit "The kobold hits you." through the env sink
 * immediately before take_hit (display_blow_message_vs_player, called from every
 * damage-dealing melee_effect_handler in mon-blows.c).
 */
function emitBlowMessageLive(
  env: MonBlowEnv,
  ctx: BlowEffectContext,
  reduced: number,
): void {
  displayBlowMessageVsPlayer(
    ctx.rng,
    ctx.method,
    reduced,
    env.monName,
    env.showDamage,
    (text: string, msgt: string): void => env.msg(text, msgt),
  );
}

/**
 * Recording-path blow message: perform the randint0(num_messages) draw without
 * emitting (the worldless intent-recording path has no sink or monster name).
 * Keeps the two paths in RNG lock-step; for every multi-message method in the
 * vanilla data (INSULT / MOAN) the draw is the effect's first RNG event, so its
 * position matches upstream.
 */
function drawBlowMessage(ctx: BlowEffectContext): void {
  displayBlowMessageVsPlayer(ctx.rng, ctx.method, 0, "", false, null);
}

/* ------------------------------------------------------------------ *
 * The blow-effect registry (melee_handler_for_blow_effect, as a table)
 * ------------------------------------------------------------------ */

/**
 * One RBE_ blow effect's behaviour, on BOTH paths.
 *
 * Upstream's `melee_effect_handler_f` is one function per effect; the port needs
 * two, because it resolves a blow twice over. `record` is the worldless path,
 * which computes HP damage and logs the rest as intents; `live` is the real one,
 * which applies HP and every consequence through a MonBlowEnv in upstream's RNG
 * order.
 *
 * BOTH must come from the same registry entry. A registry only one path consults
 * is the failure this project keeps re-earning: a modded blow would behave one
 * way in the recording harness and another in the game, and nothing would say so.
 *
 * Mods do not normally implement this interface by hand - see `blowEffect()`,
 * which derives both methods from one declarative description. The interface is
 * the seam so that a mod CAN write both when it needs to, and so that
 * `handlerFor()` hands back something wrappable.
 */
export interface BlowEffectHandler {
  /** Worldless: HP damage plus recorded side-effect intents. */
  record(ctx: BlowEffectContext): BlowEffectResult;
  /** Live: apply the blow for real through the env, in upstream RNG order. */
  live(ctx: BlowEffectContext, env: MonBlowEnv): LiveBlowResult;
}

/**
 * `melee_handler_for_blow_effect` (mon-blows.c:1191) as a real table.
 *
 * Core seeds this with its 30 handlers at boot (`registerCoreBlowEffects`), so a
 * mod can ADD a 31st effect and have `blow_effects.json`'s new record actually
 * do something, OVERRIDE one of the 30, or WRAP one - `handlerFor` returns the
 * handler currently installed, which is what a wrapper needs to call through to.
 *
 * Same shape as `EffectRegistry` deliberately: a mod author who has learned one
 * registry in this engine has learned them all.
 */
export class BlowEffectRegistry {
  private readonly handlers = new Map<string, BlowEffectHandler>();

  /** Install (or replace) the handler for an RBE_ effect name. */
  register(name: string, handler: BlowEffectHandler): void {
    this.handlers.set(name, handler);
  }

  /** The handler currently installed, or null. Wrap by re-registering around it. */
  handlerFor(name: string): BlowEffectHandler | null {
    return this.handlers.get(name) ?? null;
  }

  /** Whether anything answers for this effect name. */
  has(name: string): boolean {
    return this.handlers.has(name);
  }

  /** Every registered effect name, in registration order. */
  names(): readonly string[] {
    return [...this.handlers.keys()];
  }
}

/**
 * The registry used when a caller supplied none.
 *
 * This exists for the worldless harnesses and the direct-call tests, NOT as the
 * game's registry: `wireGame` builds a fresh one per game and puts it on
 * `GameState.blowEffects`, because a module-level singleton shared across games
 * would let one game's mod leak into the next. A mod never reaches this one -
 * the registry facade refuses to register when the host wired no registry, which
 * is what stops "the mod registered and nothing read it".
 */
let coreFallback: BlowEffectRegistry | null = null;
function fallbackRegistry(): BlowEffectRegistry {
  if (coreFallback === null) {
    coreFallback = new BlowEffectRegistry();
    registerCoreBlowEffects(coreFallback);
  }
  return coreFallback;
}

/**
 * Resolve one RBE_ blow effect: compute the HP damage the effect deals to the
 * player (context->damage after the handler runs) and record any timed /
 * stat / inventory / elemental side-effect intents.
 *
 * The message draw stays HERE rather than inside the handlers.
 * `display_blow_message_vs_player` draws `randint0(num_messages)` before
 * take_hit in every upstream handler, so hoisting it is what keeps the stream
 * aligned - and it means a mod's handler cannot forget it and silently shift
 * every subsequent roll.
 */
function resolveBlowEffect(
  name: string,
  ctx: BlowEffectContext,
  registry: BlowEffectRegistry = fallbackRegistry(),
): BlowEffectResult {
  drawBlowMessage(ctx);
  const handler = registry.handlerFor(name);
  if (handler !== null) return handler.record(ctx);
  /* Unknown effect: deal the base damage, as the fallthrough would. Upstream
   * reports "ERROR: Effect handler not found" here (mon-attack.c:650); a
   * mod-added blow_effects record with no registered handler lands on this. */
  return { hpDamage: ctx.baseDamage, obvious: true, sideEffects: [] };
}

/**
 * melee_handler_for_blow_effect (mon-blows.c:1191): upstream's name -> handler
 * table, as a list. The two switch statements in this file (resolveBlowEffect
 * for the recording path, resolveBlowEffectLive for the live path) are the
 * handlers themselves; this list is the table's key set, so a test can prove the
 * mapping total against the pack in both directions.
 *
 * Upstream's table has exactly these 30 entries (mon-blows.c:1197-1226) and
 * blow_effects.txt defines exactly the same 30 names, so a NULL handler (which
 * upstream reports as "ERROR: Effect handler not found", mon-attack.c:650/841)
 * is unreachable with vanilla data.
 */
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
export interface LiveBlowResult {
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
    emitBlowMessageLive(env, ctx, reducedDamage);
    env.takeHit(reducedDamage);
  }
  env.finishElemental?.();
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
  registry: BlowEffectRegistry = fallbackRegistry(),
): LiveBlowResult {
  const handler = registry.handlerFor(name);
  if (handler !== null) return handler.live(ctx, env);
  /* Unknown effect: deal the base damage, as the fallthrough would. */
  const reduced = env.applyReduction(ctx.baseDamage);
  emitBlowMessageLive(env, ctx, reduced);
  env.takeHit(reduced);
  return {
    contextDamage: ctx.baseDamage,
    reducedDamage: reduced,
    obvious: true,
    blinked: false,
  };
}

/* ------------------------------------------------------------------ *
 * Core's 30 handlers
 * ------------------------------------------------------------------ */

/** The shape every live handler returns; `blinked` defaults false. */
function live(
  contextDamage: number,
  reducedDamage: number,
  blinked = false,
): LiveBlowResult {
  return { contextDamage, reducedDamage, obvious: true, blinked };
}

/**
 * The damage-then-consequence sequence almost every mon-blows.c handler runs:
 * reduce, show the message, take the hit, and do the rest only if the player
 * survived. Factored out because it was written 20 times in the old switch and
 * a divergence in any copy would have been invisible.
 *
 * `damage` is context->damage BEFORE player_apply_damage_reduction, which is
 * what the cut/stun critical is computed from - not the HP actually lost.
 */
function hitThen(
  ctx: BlowEffectContext,
  env: MonBlowEnv,
  damage: number,
  after?: (contextDamage: number) => boolean | void,
): LiveBlowResult {
  const reduced = env.applyReduction(damage);
  emitBlowMessageLive(env, ctx, reduced);
  env.takeHit(reduced);
  if (env.playerDied) return live(damage, reduced);
  return live(damage, reduced, after?.(damage) === true);
}

/**
 * Seed a registry with the 30 handlers upstream ships
 * (`melee_handler_for_blow_effect`, mon-blows.c:1197-1226).
 *
 * These bodies are the two switch statements this registry replaced, lifted
 * case by case with nothing rewritten - the RNG draws sit exactly where they
 * sat, including the places where the two paths disagree about ORDER. BLIND is
 * the clearest: the recording path draws the message first and the duration
 * second, the live path draws the duration first. That is a port wart, it is
 * observable through a multi-message method like INSULT, and core keeps its
 * warts. `blow-vectors.json` is what proves none of them moved.
 */
export function registerCoreBlowEffects(registry: BlowEffectRegistry): void {
  const r = (name: string, handler: BlowEffectHandler): void =>
    registry.register(name, handler);

  r("NONE", {
    record: () => ({ hpDamage: 0, obvious: true, sideEffects: [] }),
    /* melee_effect_handler_NONE (mon-blows.c L638): show the message (with its
     * randint0(num_messages) draw) for a no-damage hit; no take_hit. */
    live: (ctx, env) => {
      emitBlowMessageLive(env, ctx, 0);
      return live(0, 0);
    },
  });

  r("HURT", {
    record: (ctx) => ({
      hpDamage: adjustDamArmor(ctx.baseDamage, ctx.ac),
      obvious: true,
      sideEffects: [],
    }),
    live: (ctx, env) => hitThen(ctx, env, adjustDamArmor(ctx.baseDamage, ctx.ac)),
  });

  /* The four pure elementals. On the WORLDLESS path the physical component
   * becomes HP damage and the elemental component is recorded as an intent; the
   * LIVE path applies adjust_dam, inven_damage and the resist check in full
   * through applyElemental. */
  for (const name of ["ACID", "ELEC", "FIRE", "COLD"]) {
    r(name, {
      record: (ctx) => ({
        hpDamage: ctx.phys ? adjustDamArmor(ctx.baseDamage, ctx.ac + 50) : 0,
        obvious: true,
        sideEffects: [
          {
            kind: "elemental",
            element: ELEMENT_OF_EFFECT[name] as string,
            damage: ctx.baseDamage,
          },
        ],
      }),
      live: (ctx, env) => {
        const res = applyElemental(env, name, ctx, true);
        return live(res.contextDamage, res.reducedDamage);
      },
    });
  }

  r("POISON", {
    record: (ctx) => ({
      hpDamage: ctx.phys ? adjustDamArmor(ctx.baseDamage, ctx.ac + 50) : 0,
      obvious: true,
      sideEffects: [
        { kind: "elemental", element: "POIS", damage: ctx.baseDamage },
        {
          kind: "timed",
          effect: "POISONED",
          amount: 5 + ctx.rng.randint1(ctx.rlev),
        },
      ],
    }),
    live: (ctx, env) => {
      const res = applyElemental(env, "POISON", ctx, false);
      if (!env.playerDied) {
        /* player_inc_timed(TMD_POISONED, 5 + randint1(rlev)). */
        env.incTimed(TMD.POISONED, 5 + ctx.rng.randint1(ctx.rlev), true);
      }
      return live(res.contextDamage, res.reducedDamage);
    },
  });

  r("DISENCHANT", {
    record: (ctx) => ({
      hpDamage: ctx.baseDamage,
      obvious: true,
      sideEffects: [{ kind: "disenchant" }],
    }),
    live: (ctx, env) =>
      hitThen(ctx, env, ctx.baseDamage, () => {
        if (!env.resists(ELEM.DISEN)) env.disenchant();
      }),
  });

  r("DRAIN_CHARGES", {
    record: (ctx) => ({
      hpDamage: ctx.baseDamage,
      obvious: false,
      sideEffects: [{ kind: "drainCharges" }],
    }),
    live: (ctx, env) =>
      hitThen(ctx, env, ctx.baseDamage, () => env.drainCharges(ctx.rlev)),
  });

  r("EAT_GOLD", {
    record: (ctx) => ({
      hpDamage: ctx.baseDamage,
      obvious: true,
      sideEffects: [{ kind: "eatGold" }],
    }),
    live: (ctx, env) => hitThen(ctx, env, ctx.baseDamage, () => env.eatGold()),
  });

  r("EAT_ITEM", {
    record: (ctx) => ({
      hpDamage: ctx.baseDamage,
      obvious: true,
      sideEffects: [{ kind: "eatItem" }],
    }),
    /* monster_damage_target(context, false): returns only on death. */
    live: (ctx, env) =>
      hitThen(ctx, env, ctx.baseDamage, () => env.eatItem().blinked),
  });

  r("EAT_FOOD", {
    record: (ctx) => ({
      hpDamage: ctx.baseDamage,
      obvious: true,
      sideEffects: [{ kind: "eatFood" }],
    }),
    live: (ctx, env) => hitThen(ctx, env, ctx.baseDamage, () => env.eatFood()),
  });

  r("EAT_LIGHT", {
    record: (ctx) => ({
      hpDamage: ctx.baseDamage,
      obvious: true,
      sideEffects: [{ kind: "eatLight" }],
    }),
    live: (ctx, env) => hitThen(ctx, env, ctx.baseDamage, () => env.eatLight()),
  });

  /* melee_effect_timed: the duration argument is drawn BEFORE the damage on the
   * live path, and AFTER the message on the recording path. Two of these take a
   * saving throw first; the other two do not. */
  const timed = (
    name: string,
    intent: string,
    tmd: number,
    amount: (ctx: BlowEffectContext) => number,
    save?: string,
  ): void =>
    r(name, {
      record: (ctx) => ({
        hpDamage: ctx.baseDamage,
        obvious: true,
        sideEffects: [{ kind: "timed", effect: intent, amount: amount(ctx) }],
      }),
      live: (ctx, env) => {
        const dur = amount(ctx);
        return hitThen(ctx, env, ctx.baseDamage, () => {
          if (save !== undefined && env.saveVsSkill()) env.msg(save);
          else env.incTimed(tmd, dur, true);
        });
      },
    });

  timed("BLIND", "BLIND", TMD.BLIND, (ctx) => 10 + ctx.rng.randint1(ctx.rlev));
  timed("CONFUSE", "CONFUSED", TMD.CONFUSED, (ctx) => 3 + ctx.rng.randint1(ctx.rlev));
  timed(
    "TERRIFY",
    "AFRAID",
    TMD.AFRAID,
    (ctx) => 3 + ctx.rng.randint1(ctx.rlev),
    "You stand your ground!",
  );
  timed(
    "PARALYZE",
    "PARALYZED",
    TMD.PARALYZED,
    (ctx) => 3 + ctx.rng.randint1(ctx.rlev),
    "You resist the effects!",
  );

  for (const name of ["LOSE_STR", "LOSE_INT", "LOSE_WIS", "LOSE_DEX", "LOSE_CON"]) {
    r(name, {
      record: (ctx) => ({
        hpDamage: ctx.baseDamage,
        obvious: true,
        sideEffects: [{ kind: "drainStat", stat: STAT_OF_EFFECT[name] as string }],
      }),
      live: (ctx, env) =>
        hitThen(ctx, env, ctx.baseDamage, () =>
          env.drainStat(STAT_OF_LIVE_EFFECT[name]!),
        ),
    });
  }

  r("LOSE_ALL", {
    record: (ctx) => ({
      hpDamage: ctx.baseDamage,
      obvious: true,
      /* Upstream's order here is STR, DEX, CON, INT, WIS - not the STAT order. */
      sideEffects: ["STR", "DEX", "CON", "INT", "WIS"].map((stat) => ({
        kind: "drainStat" as const,
        stat,
      })),
    }),
    live: (ctx, env) =>
      hitThen(ctx, env, ctx.baseDamage, () => {
        env.drainStat(STAT.STR);
        env.drainStat(STAT.DEX);
        env.drainStat(STAT.CON);
        env.drainStat(STAT.INT);
        env.drainStat(STAT.WIS);
      }),
  });

  r("SHATTER", {
    record: (ctx) => {
      const hp = adjustDamArmor(ctx.baseDamage, ctx.ac);
      const side: BlowSideEffect[] = [];
      /* monster_damage_target() returns immediately on death (mon-blows.c
       * L1095), before either SHATTER side-effect gate or its RNG draw. */
      if (ctx.willPlayerDie?.(hp)) {
        return { hpDamage: hp, obvious: true, sideEffects: side };
      }
      if (hp > 23) side.push({ kind: "earthquake", radius: Math.trunc(hp / 12) });
      if (hp > 100) {
        const value = hp - 100;
        if (ctx.rng.randint1(value) > 40) {
          side.push({ kind: "knockback", distance: 1 + Math.trunc(value / 40) });
        }
      }
      return { hpDamage: hp, obvious: true, sideEffects: side };
    },
    live: (ctx, env) =>
      hitThen(ctx, env, adjustDamArmor(ctx.baseDamage, ctx.ac), (cd) => {
        if (cd > 23) env.earthquake(Math.trunc(cd / 12));
        if (cd > 100) {
          const value = cd - 100;
          if (ctx.rng.randint1(value) > 40) env.thrust(1 + Math.trunc(value / 40));
        }
      }),
  });

  for (const name of ["EXP_10", "EXP_20", "EXP_40", "EXP_80"]) {
    const spec = EXP_DRAIN[name] as { holdChance: number; dice: number };
    r(name, {
      record: (ctx) => ({
        hpDamage: ctx.baseDamage,
        obvious: true,
        /* damroll(N, 6) is evaluated as the handler's argument. */
        sideEffects: [
          {
            kind: "loseExp",
            holdChance: spec.holdChance,
            amount: ctx.rng.damroll(spec.dice, 6),
          },
        ],
      }),
      live: (ctx, env) => {
        /* ...which on the live path means BEFORE take_hit. */
        const drainAmount = ctx.rng.damroll(spec.dice, 6);
        return hitThen(ctx, env, ctx.baseDamage, () =>
          env.drainExp(spec.holdChance, drainAmount),
        );
      },
    });
  }

  r("HALLU", {
    record: (ctx) => ({
      hpDamage: ctx.baseDamage,
      obvious: true,
      sideEffects: [
        {
          kind: "timed",
          effect: "IMAGE",
          amount: 3 + ctx.rng.randint1(Math.trunc(ctx.rlev / 2)),
        },
      ],
    }),
    /* Unlike the other timed blows, HALLU draws its duration AFTER take_hit. */
    live: (ctx, env) =>
      hitThen(ctx, env, ctx.baseDamage, () => {
        env.incTimed(TMD.IMAGE, 3 + ctx.rng.randint1(Math.trunc(ctx.rlev / 2)), true);
      }),
  });

  r("BLACK_BREATH", {
    record: (ctx) => ({
      hpDamage: ctx.baseDamage,
      obvious: true,
      sideEffects: ctx.rng.oneIn(5)
        ? [
            {
              kind: "timed",
              effect: "BLACKBREATH",
              amount: Math.trunc(ctx.baseDamage / 10),
            },
          ]
        : [],
    }),
    live: (ctx, env) =>
      hitThen(ctx, env, ctx.baseDamage, () => {
        if (ctx.rng.oneIn(5)) {
          env.incTimed(TMD.BLACKBREATH, Math.trunc(ctx.baseDamage / 10), false);
        }
      }),
  });
}

/* ------------------------------------------------------------------ *
 * Authoring a blow effect from one description
 * ------------------------------------------------------------------ */

/**
 * What a mod says its blow effect does, once, for both paths.
 *
 * Writing a `BlowEffectHandler` by hand means writing the same effect twice and
 * keeping the two in step forever - the exact trap this registry exists to close
 * at the CORE level, and it would be perverse to hand it straight to mods. So
 * this is the shape a mod normally uses: describe the damage and the
 * consequences, and let `blowEffect()` derive the recording and live handlers.
 *
 * The split between `before` and `after` is about WHEN THE DICE ARE ROLLED, not
 * when the effect applies. Upstream's timed blows roll their duration before the
 * blow lands and apply it afterwards; the knockback roll happens after. Both
 * lists are applied only if the player survived the blow, exactly as
 * `monster_damage_target` does.
 */
export interface BlowEffectSpec {
  /**
   * context->damage: what the blow deals before player damage reduction.
   * Defaults to the blow's rolled damage. Call `adjustDamArmor` here if the
   * effect is meant to be reduced by armour, as HURT and SHATTER are.
   */
  damage?: (ctx: BlowEffectContext) => number;
  /** Consequences whose dice are rolled BEFORE the blow lands. */
  before?: (ctx: BlowEffectContext) => readonly BlowSideEffect[];
  /** Consequences whose dice are rolled AFTER it lands, if the player lived. */
  after?: (ctx: BlowEffectContext) => readonly BlowSideEffect[];
  /** Whether the blow is obvious to the player (context->obvious). */
  obvious?: boolean;
}

/**
 * Build a handler from a spec, so a mod writes its effect once.
 *
 * The live half applies each described side effect through the env with
 * `applyBlowSideEffect`, which is the same vocabulary the worldless path
 * records. A mod that describes "poison the player for 2d6 turns" therefore
 * gets a recorded intent in the harness and a real `player_inc_timed` in the
 * game, from one line, with no chance of the two disagreeing.
 */
export function blowEffect(spec: BlowEffectSpec): BlowEffectHandler {
  const damageOf = (ctx: BlowEffectContext): number =>
    spec.damage ? spec.damage(ctx) : ctx.baseDamage;
  const obvious = spec.obvious ?? true;
  return {
    record: (ctx) => {
      const damage = damageOf(ctx);
      const before = spec.before ? [...spec.before(ctx)] : [];
      /* The worldless path has no HP model of its own, so "did the player
       * survive" is the caller's willPlayerDie, the same gate SHATTER uses. */
      const died = ctx.willPlayerDie?.(damage) === true;
      const after = died || !spec.after ? [] : [...spec.after(ctx)];
      return { hpDamage: damage, obvious, sideEffects: [...before, ...after] };
    },
    live: (ctx, env) => {
      const damage = damageOf(ctx);
      const before = spec.before ? [...spec.before(ctx)] : [];
      const result = hitThen(ctx, env, damage, () => {
        let blinked = false;
        for (const effect of [...before, ...(spec.after?.(ctx) ?? [])]) {
          if (applyBlowSideEffect(env, effect)) blinked = true;
          if (env.playerDied) break;
        }
        return blinked;
      });
      return { ...result, obvious };
    },
  };
}

/**
 * Apply one recorded side-effect intent to the world. Returns whether it blinked
 * the monster away (context->blinked), which only the two thefts do.
 *
 * This is what makes `BlowSideEffect` a shared VOCABULARY rather than a
 * worldless-only log: the same value that gets recorded in the harness is the
 * one that gets applied in the game.
 */
export function applyBlowSideEffect(
  env: MonBlowEnv,
  effect: BlowSideEffect,
): boolean {
  switch (effect.kind) {
    case "timed": {
      const tmd = (TMD as Record<string, number | undefined>)[effect.effect];
      if (tmd !== undefined) env.incTimed(tmd, effect.amount, true);
      return false;
    }
    case "drainStat": {
      const stat = (STAT as Record<string, number | undefined>)[effect.stat];
      if (stat !== undefined) env.drainStat(stat);
      return false;
    }
    case "loseExp":
      env.drainExp(effect.holdChance, effect.amount);
      return false;
    case "drainCharges":
      env.drainCharges(0);
      return false;
    case "eatGold":
      return env.eatGold();
    case "eatItem":
      return env.eatItem().blinked;
    case "eatFood":
      env.eatFood();
      return false;
    case "eatLight":
      env.eatLight();
      return false;
    case "disenchant":
      env.disenchant();
      return false;
    case "elemental": {
      const elem = (ELEM as Record<string, number | undefined>)[effect.element];
      if (elem !== undefined) {
        env.invenDamage(elem, Math.min(effect.damage * 5, 300));
      }
      return false;
    }
    case "earthquake":
      env.earthquake(effect.radius);
      return false;
    case "knockback":
      env.thrust(effect.distance);
      return false;
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
      /* Visible monster missed the player: announce it (mon-attack.c L718). No
       * RNG is drawn; unseen monsters and no-miss methods stay silent. */
      if (env && env.monVisible && blow.method.miss) {
        /* disturb(p) before the line (mon-attack.c L719-721): a MISS the player
         * can see is still news, and stops a run or a rest. Nothing here reduces
         * HP, so take_hit's own disturb cannot stand in for it. */
        env.disturb?.();
        env.msg(`${env.monName} misses you.`);
      }
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

    /* "Always disturbing" (mon-attack.c L593-594): the blow CONNECTED, so the
     * player is disturbed before anything else happens - before protection from
     * evil, before the damage roll, and regardless of whether the blow ends up
     * doing any damage at all. take_hit's disturb (player-util.c:207) covers only
     * the damaging blows; a 0-damage effect blow like BLIND or a repelled evil
     * monster is disturbing here and nowhere else. */
    env?.disturb?.();

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
      method: blow.method,
      /* The worldless path applies hpDamage after resolveBlowEffect(), unlike
       * C's monster_damage_target(); predict its return value for handlers
       * that must stop before later RNG draws (mon-blows.c L1095). */
      ...(env
        ? {}
        : { willPlayerDie: (pendingDamage: number) => defender.chp - pendingDamage < 0 }),
    };

    /* context->damage after the handler (unreduced; feeds the cut/stun crit). */
    let contextDamage: number;
    /* The HP actually dealt this blow (reported / totalled). */
    let dealtDamage: number;
    let obvious: boolean;
    const blowSide: BlowSideEffect[] = [];

    if (env) {
      const res = resolveBlowEffectLive(effectName, blowCtx, env, opts.blowEffects);
      contextDamage = res.contextDamage;
      dealtDamage = res.reducedDamage;
      obvious = res.obvious;
      if (res.blinked) blinked = true;
      if (dealtDamage > 0) totalDamage += dealtDamage;
      if (env.playerDied) playerDied = true;
    } else {
      const res = resolveBlowEffect(effectName, blowCtx, opts.blowEffects);
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
