/**
 * The melee-adjacent effect handlers, ported from
 * reference/src/effect-handler-attack.c (Angband 4.2.6): EF_TAP_UNLIFE
 * (L1615, draining the closest undead into mana), EF_CURSE (L1665, direct
 * damage to the targeted monster), EF_JUMP_AND_BITE (L1710, jump next to
 * the closest living monster and drain it), EF_MOVE_ATTACK (L1785, move up
 * to four grids then unload melee blows), EF_MELEE_BLOWS (L1907, several
 * blows with an elemental side effect per damaging blow) and EF_SWEEP
 * (L1955, a blow at every adjacent monster).
 *
 * Melee routes through combat/melee.ts pyAttackReal with the same
 * learn-on-attack wrapping the walk command uses; kills ripple through
 * state.onPlayerKill + deleteMonster exactly like the melee commands.
 * closestTarget wraps the real target_set_closest (game/target.ts) - the
 * vampiric handlers retarget the player's target, exactly upstream; the
 * target_get of MELEE_BLOWS / MOVE_ATTACK reads the aimed seam
 * (GameEffectEnv.aimed, now backed by the live target) and falls back to
 * the effect direction.
 *
 * Simplifications, ledgered in parity/ledger/game-effect-melee.yaml:
 * MDESC names and message_pain grammar ride the display layer (#25) - the
 * race name stands in, pain messages are the flee message only.
 *
 * EF_SINGLE_COMBAT is modelled: the arena level is built in the session layer
 * (session/game.ts, arena_gen at gen-cave.c:3984), the kill gate is
 * arenaInterceptDeath (mon-util.c:1290) and the exit kills the original
 * (kill_arena_monster). game/arena.test.ts walks the round trip.
 */

import { EF, MON_MSG, TMD } from "../generated/index.js";
import { PROJECT } from "../world/project.js";
import type { Loc } from "../loc.js";
import { CLOCKWISE_GRID, DDGRID, DDGRID_DDD, distance, loc, locDiff, locSum } from "../loc.js";
import { DIR_TARGET, effectCalculateValue } from "../effects/interpreter.js";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
} from "../effects/interpreter.js";
import type { Monster } from "../mon/monster.js";
import {
  monsterIsLiving,
  monsterIsObvious,
  monsterIsUndead,
  monsterIsVisible,
} from "../mon/predicate.js";
import { getLore } from "../mon/lore.js";
import { monTakeHit } from "../mon/take-hit.js";
import { pyAttackReal } from "../combat/melee.js";
import { learnBrandSlayFromMelee } from "../combat/brand-slay.js";
import { equipLearnOnMeleeAttack } from "../obj/knowledge.js";
import type { GameState } from "./context.js";
import {
  arenaInterceptDeath,
  deleteMonster,
  gameTakeHitHooks,
  movePlayer,
  squareMonster,
} from "./context.js";
import { gameEnv } from "./effect-game-env.js";
import type { GameEffectEnv } from "./effect-game-env.js";
import {
  formatMonsterMessage,
  formatPainMessage,
  formatPainMessageShowDamage,
} from "./mon-message.js";
import { castProjection, playerCastSource } from "./project-cast.js";
import { squareIsPlayerTrap, squareIsWebbed } from "./trap.js";
import {
  TARGET,
  targetGetMonster,
  targetSetClosest,
  targetSetMonster,
} from "./target.js";

/** msg() over the effect context's optional message sink. */
function say(ctx: EffectHandlerContext, text: string): void {
  ctx.env.messages?.msg(text);
}

/**
 * target_set_closest(TARGET_KILL, pred) followed by target_get_monster, as
 * the vampiric handlers call it - the drain retargets the player's target,
 * exactly upstream.
 */
export function closestTarget(
  state: GameState,
  pred: (mon: Monster) => boolean,
): Monster | null {
  if (!targetSetClosest(state, TARGET.KILL, pred)) return null;
  return targetGetMonster(state);
}

/**
 * One player melee blow at the monster, with the learn-on-attack wrapping
 * the melee commands use. A kill rewards experience and deletes the
 * monster. Returns whether the monster died.
 */
function playerBlow(state: GameState, mon: Monster): boolean {
  learnBrandSlayFromMelee(
    state.actor.player,
    state.runeEnv,
    state.actor.weapon,
    {
      race: mon.race,
      visible: monsterIsVisible(mon),
      lore: getLore(state.lore, mon.race),
    },
  );
  const blow = pyAttackReal(
    state.rng,
    state.actor.player,
    state.actor.combat,
    state.actor.weapon,
    mon,
    state.brands,
    state.slays,
    {
      /* chance_of_melee_hit halves unseen targets (player-attack.c:104-109),
       * including effect-handler-attack.c's py_attack_real paths. */
      monVisible: monsterIsVisible(mon),
      percentDamage: state.options?.get("birth_percent_damage") ?? false,
      /* object_to_hit / object_to_dam / object_weight_one read the curse
       * templates of the weapon active curses (obj-util.c:296-330). */
      curses: state.curses,
    },
  );
  equipLearnOnMeleeAttack(state.actor.player, state.runeEnv);
  if (blow.monsterDied && !arenaInterceptDeath(state, mon)) {
    state.onPlayerKill?.(mon);
    deleteMonster(state, mon.midx);
  }
  return blow.monsterDied;
}

/**
 * mon_take_hit for effect damage: the monster dies (with the note said) or
 * flees. Rewards experience and deletes on a kill, exactly as
 * player_kill_monster does for the melee commands.
 */
function effectHit(
  ctx: EffectHandlerContext,
  state: GameState,
  mon: Monster,
  dam: number,
  note: string,
  showDamage = false,
): boolean {
  const result = monTakeHit(state.rng, mon, dam, note, {
    ...gameTakeHitHooks(state, mon),
    /* become_aware: a direct-damage effect (EF_TAP_UNLIFE, EF_CURSE, ...)
     * can reveal a camouflaged target, same as any other hit. */
    ...(state.becomeAware ? { becomeAware: state.becomeAware } : {}),
  });
  if (result.died) {
    if (arenaInterceptDeath(state, mon)) return true;
    if (monsterIsVisible(mon)) say(ctx, `${mon.race.name}${note}`);
    state.onPlayerKill?.(mon);
    deleteMonster(state, mon.midx);
    return true;
  }
  /*
   * A survivor gets its graded pain line, then the flee line
   * (effect-handler-attack.c:1651-1657 TAP_UNLIFE, 1693-1702 CURSE,
   * 1770-1776 JUMP_AND_BITE - all three gate both on monster_is_visible).
   * message_pain runs after mon_take_hit, so mon.hp is already the post-hit
   * value get_pain_msg_code (mon-msg.c:96) compares against. CURSE alone takes
   * the message_pain_show_damage branch, under OPT(player, show_damage).
   */
  if (monsterIsVisible(mon)) {
    const pain = showDamage
      ? formatPainMessageShowDamage(mon, dam)
      : formatPainMessage(mon, dam);
    if (pain) say(ctx, pain);
    if (result.fear) {
      /* add_monster_message(MON_MSG_FLEE_IN_TERROR): "The kobold flees in
       * terror!" through get_subject, not a bare race name. */
      const flee = formatMonsterMessage(mon, MON_MSG.FLEE_IN_TERROR);
      if (flee) say(ctx, flee);
    }
  }
  return false;
}

/** The EF_HEAL_HP minimum-amount branch (nested effect_simple calls). */
function healPlayer(ctx: EffectHandlerContext, amount: number): void {
  const hp = ctx.env.player?.hp;
  if (!hp || hp.chp >= hp.mhp || amount <= 0) return;
  hp.chp += amount;
  if (hp.chp >= hp.mhp) {
    hp.chp = hp.mhp;
    hp.chpFrac = 0;
  }
  if (amount < 5) say(ctx, "You feel a little better.");
  else if (amount < 15) say(ctx, "You feel better.");
  else if (amount < 35) say(ctx, "You feel much better.");
  else say(ctx, "You feel very good.");
}

/** The EF_RESTORE_MANA fixed-amount branch (nested effect_simple calls). */
function restoreMana(ctx: EffectHandlerContext, amount: number): void {
  const mana = ctx.env.player?.mana;
  if (!mana || amount <= 0) return;
  if (mana.csp < mana.msp) {
    mana.csp += amount;
    if (mana.csp > mana.msp) {
      mana.csp = mana.msp;
      mana.cspFrac = 0;
      say(ctx, "You feel your head clear.");
    } else {
      say(ctx, "You feel your head clear somewhat.");
    }
  }
}

/** The effect's target grid: the aimed seam for DIR_TARGET, else the dir. */
function aimedGrid(env: GameEffectEnv, ctx: EffectHandlerContext): Loc {
  if (ctx.dir === DIR_TARGET && env.aimed) return env.aimed;
  return locSum(env.state.actor.grid, DDGRID[ctx.dir] ?? loc(0, 0));
}

/**
 * EF_TAP_UNLIFE: draw power from the closest undead monster, gaining a
 * quarter of the drained hitpoints as mana.
 */
const handleTAP_UNLIFE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const amount = effectCalculateValue(ctx, false);

  ctx.ident = true;

  /* Closest undead monster */
  const mon = closestTarget(state, monsterIsUndead);
  if (!mon) return false;

  /* Hurt the monster */
  const drain = Math.trunc(Math.min(mon.hp, amount) / 4);
  /* effect-handler-attack.c:1637-1641: the suffix reports `amount` (the damage
   * dealt), not `drain` (the mana gained). */
  const tapTail = ctx.env.showDamage ? ` (${amount})` : "";
  say(ctx, `You draw power from the ${mon.race.name}.${tapTail}`);
  effectHit(ctx, state, mon, amount, " is destroyed!");

  /* Gain mana (effect_simple(EF_RESTORE_MANA, drain)) */
  restoreMana(ctx, drain);

  return true;
};

/**
 * EF_CURSE: curse the targeted monster for direct, unresistable damage.
 */
const handleCURSE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const dam = effectCalculateValue(ctx, false);

  ctx.ident = true;

  /* Need to choose a monster, not just point (target_get_monster; the
   * aimed seam stands in when no target bookkeeping is active). */
  const mon =
    targetGetMonster(state) ??
    (env.aimed ? squareMonster(state, env.aimed) : null);
  if (!mon) {
    say(ctx, "No monster selected!");
    return false;
  }

  /* display_dam (effect-handler-attack.c:1671): OPT(player, show_damage) puts
   * the damage in the death note AND selects message_pain_show_damage. */
  const displayDam = ctx.env.showDamage ?? false;
  const note = displayDam ? ` dies! (${dam})` : " dies!";
  effectHit(ctx, state, mon, dam, note, displayDam);
  return true;
};

/**
 * EF_SINGLE_COMBAT (effect-handler-attack.c L1856): drag the targeted
 * monster into an arena. High spell power resists; otherwise the arena
 * flags fire the level change (the session builds the arena around
 * state.healthWho - upstream's monster_index_move juggle only serves
 * arena_gen's memcpy and is not needed).
 */
const handleSINGLE_COMBAT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  ctx.ident = true;

  /* Already in an arena. */
  if (state.arenaLevel) {
    say(ctx, "You are already in single combat!");
    return false;
  }

  /* Need to choose a monster, not just point. */
  const mon = targetGetMonster(state);
  if (!mon) {
    say(ctx, "No monster selected!");
    return false;
  }

  /* Monsters with high spell power can resist. */
  if (
    mon.race.spellPower > 0 &&
    state.rng.randint0(mon.race.spellPower) > state.actor.player.lev
  ) {
    const name = mon.race.name;
    say(ctx, `${name.charAt(0).toUpperCase()}${name.slice(1)} resists!`);
    return true;
  }

  /* Head to the arena. */
  targetSetMonster(state, mon);
  state.healthWho = mon;
  state.arenaLevel = true;
  state.oldGrid = state.actor.grid;
  state.targetDepth = state.chunk.depth;
  state.generateLevel = true;
  return true;
};

/**
 * EF_JUMP_AND_BITE: jump next to the closest living monster and drain
 * hitpoints and nourishment from it.
 */
const handleJUMP_AND_BITE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const c = state.chunk;
  const amount = effectCalculateValue(ctx, false);

  ctx.ident = true;

  /* Closest living monster */
  const mon = closestTarget(state, monsterIsLiving);
  if (!mon) return false;
  const victim = mon.grid;
  const name = mon.race.name;

  /* Look next to the monster */
  const firstD = state.rng.randint0(8);
  let d = firstD;
  let grid = victim;
  for (; d < firstD + 8; d++) {
    grid = locSum(victim, DDGRID_DDD[d % 8]!);
    if (squareIsPlayerTrap(state, grid)) continue;
    if (squareIsWebbed(state, grid)) continue;
    /* square_isopen: floor with no occupant. */
    if (c.inBounds(grid) && c.isFloor(grid) && c.mon(grid) === 0) break;
  }

  /* Needed to be adjacent */
  if (d === firstD + 8) {
    say(ctx, `Not enough room next to ${name}!`);
    return false;
  }

  /* Move player (monster_swap + player_handle_post_move). */
  movePlayer(state, grid);
  state.updateFov?.(state);
  state.onPlayerMoved?.(state, grid);

  /* Now bite it */
  const drain = Math.min(mon.hp + 1, amount);
  /* effect-handler-attack.c:1755-1759: this one reports `drain` (the amount
   * healed/nourished), unlike EF_TAP_UNLIFE which reports the damage. */
  const biteTail = ctx.env.showDamage ? ` (${drain})` : "";
  say(ctx, `You bite ${name}.${biteTail}`);
  effectHit(ctx, state, mon, amount, " is drained dry!");

  /* Heal and nourish (effect_simple(EF_HEAL_HP) + TMD_FOOD). */
  healPlayer(ctx, drain);
  ctx.env.player?.timed?.incTimed(TMD.FOOD, drain, false, false, false);

  return true;
};

/**
 * EF_MOVE_ATTACK: move up to four grids toward the target, then land melee
 * blows scaled down by the distance travelled.
 */
const handleMOVE_ATTACK: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const c = state.chunk;
  let blows = effectCalculateValue(ctx, false);
  let moves = 4;

  /* Ask for a target */
  const target = aimedGrid(env, ctx);

  const mon = squareMonster(state, target);
  if (!mon || !monsterIsObvious(mon)) {
    say(ctx, "This spell must target a monster.");
    return false;
  }

  while (distance(state.actor.grid, target) > 1 && moves > 0) {
    const choice = [0, 1, -1];
    let attack = false;
    const diff = locDiff(target, state.actor.grid);

    /* Choice of direction simplified by prioritizing diagonals */
    let d: number;
    if (diff.x === 0) {
      d = diff.y < 0 ? 0 : 4; /* up : down */
    } else if (diff.y === 0) {
      d = diff.x < 0 ? 6 : 2; /* left : right */
    } else if (diff.x < 0) {
      d = diff.y < 0 ? 7 : 5; /* up-left : down-left */
    } else {
      d = diff.y < 0 ? 1 : 3; /* up-right : down-right */
    }

    /* We'll give up to 3 choices: d, d + 1, d - 1 */
    let next = state.actor.grid;
    for (let i = 0; i < 3; i++) {
      const dTest = (d + choice[i]! + 8) % 8;
      next = locSum(state.actor.grid, CLOCKWISE_GRID[dTest]!);
      if (c.isPassable(next)) {
        d = dTest;
        if (squareMonster(state, next)) attack = true;
        break;
      } else if (i === 2) {
        say(ctx, "The way is barred.");
        return moves !== 4;
      }
    }

    /* move_player: attack a blocker, otherwise step. */
    if (attack) {
      const blocker = squareMonster(state, next);
      if (blocker) playerBlow(state, blocker);
      return false;
    }
    movePlayer(state, next);
    state.updateFov?.(state);
    state.onPlayerMoved?.(state, next);
    moves--;
  }

  /* Reduce blows based on distance traveled, round to nearest blow */
  blows = Math.trunc((blows * moves + 2) / 4);

  /* Should return some energy if monster dies early */
  while (blows-- > 0) {
    if (playerBlow(state, mon)) break;
  }

  return true;
};

/**
 * EF_MELEE_BLOWS: several melee blows at an adjacent monster, applying an
 * elemental side effect after each damaging blow.
 */
const handleMELEE_BLOWS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  let blows = effectCalculateValue(ctx, false);
  const dam = ctx.radius;

  /* players only for now */
  if (ctx.origin.what !== "player") return false;

  /* Ask for a target if no direction given */
  const target = aimedGrid(env, ctx);

  /* Check target validity */
  const taim = distance(state.actor.grid, target);
  const mon = squareMonster(state, target);
  if (taim > 1) {
    say(ctx, `Target too far away (${taim}).`);
    return false;
  } else if (!mon) {
    say(ctx, "You must attack a monster.");
    return false;
  }

  while (blows-- > 0 && state.monsters[mon.midx] === mon) {
    /* Test for damaging the monster */
    const hp = mon.hp;
    if (playerBlow(state, mon)) return true;
    if (mon.hp === hp) continue;

    /* Apply side-effects */
    if (
      castProjection(
        state,
        env.cast,
        playerCastSource(state),
        target,
        dam,
        ctx.subtype,
        PROJECT.KILL,
        0,
      )
    ) {
      ctx.ident = true;
    }
  }
  return true;
};

/**
 * EF_SWEEP: spin around, landing a blow at every adjacent monster.
 */
const handleSWEEP: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  let blows = effectCalculateValue(ctx, false);

  /* Players only for now */
  if (ctx.origin.what !== "player") return false;

  /* Doing these like >1 blows means spinning around multiple times. */
  while (blows-- > 0) {
    for (let i = 0; i < 8; i++) {
      const target = locSum(state.actor.grid, CLOCKWISE_GRID[i]!);
      const mon = squareMonster(state, target);
      if (mon) playerBlow(state, mon);
    }
  }

  return true;
};

/** The melee-adjacent handlers, keyed by upstream EF code. */
const MELEE_HANDLERS: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  /* effect_handler_TAP_UNLIFE (effect-handler-attack.c:1615) */
  [EF.TAP_UNLIFE, handleTAP_UNLIFE],
  /* effect_handler_SINGLE_COMBAT (effect-handler-attack.c:1857) */
  [EF.SINGLE_COMBAT, handleSINGLE_COMBAT],
  [EF.CURSE, handleCURSE],
  /* effect_handler_JUMP_AND_BITE (effect-handler-attack.c:1710) */
  [EF.JUMP_AND_BITE, handleJUMP_AND_BITE],
  /* effect_handler_MOVE_ATTACK (effect-handler-attack.c:1785) */
  [EF.MOVE_ATTACK, handleMOVE_ATTACK],
  /* effect_handler_MELEE_BLOWS (effect-handler-attack.c:1907) */
  [EF.MELEE_BLOWS, handleMELEE_BLOWS],
  [EF.SWEEP, handleSWEEP],
]);

/**
 * Register the melee-adjacent handlers, overriding the stubs
 * registerCoreHandlers installed. Call after registerCoreHandlers. Each
 * handler reads its game environment from context.env.game (attach it with
 * attachGameEnv) and no-ops when it is absent.
 */
export function registerMeleeHandlers(registry: EffectRegistry): void {
  for (const [code, handler] of MELEE_HANDLERS) {
    registry.register(code, { handler, status: "implemented" });
  }
}

/** The melee-adjacent EF codes this module registers. */
export const MELEE_HANDLER_CODES: readonly number[] = [
  ...MELEE_HANDLERS.keys(),
];
