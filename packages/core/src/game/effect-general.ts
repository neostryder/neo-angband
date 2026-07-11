/**
 * The world-touching general effect handlers, ported from
 * reference/src/effect-handler-general.c (Angband 4.2.6): EF_GLYPH (L700, a
 * glyph of warding or a decoy on the player's grid), EF_WEB (L732, a web
 * spinner filling its surroundings), EF_DISENCHANT (L2003, disenchanting
 * a random piece of worn equipment), the stat family (RESTORE_STAT L773,
 * DRAIN_STAT L803 with its sustain save and rune learning,
 * LOSE_RANDOM_STAT L852, GAIN_STAT L875, SCRAMBLE_STATS / UNSCRAMBLE_STATS
 * L3634 for the TMD_SCRAMBLE timed chains), the experience pair
 * (RESTORE_EXP L893, GAIN_EXP L913), the drains (DRAIN_LIGHT L928,
 * DRAIN_MANA L956 healing a monster caster and soaked by a decoy) and
 * MON_TIMED_INC (L667). Like the other game-layer handlers they read their
 * environment from context.env.game and no-op when it is absent (the
 * worldless rule); GLYPH and WEB additionally need the trap system
 * (env.general.trapDeps) since glyphs and webs ARE trap kinds upstream.
 *
 * disenchantEquipment is exported separately: project-player.c's DISEN
 * handler applies the same disenchantment through effect_simple, so the
 * player side-effect table (game/player-side.ts) calls it directly.
 *
 * Simplifications, ledgered: the equipment letter in the disenchant message
 * (gear_to_label) and the ODESC_BASE description ride the display layer
 * (#25) - the kind's base name is used; obj->known->to_h/to_d/to_a display
 * sync likewise (knowledge is rune-based here). The decoy grid lives on
 * GameState.decoy; the monster-AI decoy targeting is deferred with lore
 * (#24).
 */

import { EF, MON_TMD, OF, PROJ, TMD } from "../generated";
import { DDGRID, distance, loc, locSum } from "../loc";
import { PROJECT } from "../world/project";
import { GLYPH_DECOY } from "../effects/effect";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
} from "../effects/interpreter";
import {
  DIR_TARGET,
  effectCalculateValue,
  sourcePlayer,
} from "../effects/interpreter";
import {
  equipLearnFlag,
  shapeLearnOnAssume,
  sustainFlag,
} from "../obj/knowledge";
import { ODESC } from "../obj/desc";
import { describeObject } from "./describe";
import type { EffectRecordJson } from "../obj/types";
import type { Shape } from "../player/types";
import { buildObjectEffectChain } from "./obj-cmd";
import { OBJ_PROPERTY } from "../obj/types";
import type { ObjectProperty } from "../obj/types";
import { STAT_MAX } from "../player/types";
import {
  PY_MAX_EXP,
  playerExpGain,
  playerExpLose,
  playerFixScramble,
  playerScrambleStats,
  playerStatDec,
  playerStatInc,
} from "../player/exp";
import type { ExpDeps } from "../player/exp";
import { monIncTimed } from "../mon/timed";
import { monsterWake } from "../mon/take-hit";
import { loreDoProbe } from "../mon/lore";
import { monsterIsVisible } from "../mon/predicate";
import { featIsTrapHolding } from "../world/chunk";
import { squareIsView } from "../world/view";
import { lookupTrap } from "../world/trap";
import type { GameState } from "./context";
import { gameEnv } from "./effect-game-env";
import { floorPile } from "./floor";
import { castProjection, playerCastSource } from "./project-cast";
import { pushObject } from "./project-feat";
import { placeTrap, squareIsTrap, squareRemoveAllTraps } from "./trap";
import type { TrapDeps } from "./trap";

/**
 * The general-handler seams, grouped on the game effect environment
 * (effect-game-env.ts GameEffectEnv.general). trapDeps backs glyph and web
 * creation; absent, those handlers no-op (the trap system is not wired).
 * properties backs desc_stat (the stat adjectives from object_property.txt);
 * expDeps lets experience gains ripple level changes.
 */
export interface GeneralEffectEnv {
  trapDeps?: TrapDeps;
  /** The bound object properties (ObjRegistry.properties), for desc_stat. */
  properties?: readonly (ObjectProperty | null)[];
  /** player_exp_gain's level-change ripple (player/exp.ts). */
  expDeps?: ExpDeps;
  /** get_check yes/no prompts (RECALL's depth/cancel checks). Default yes. */
  confirm?: (prompt: string) => boolean;
  /** The bound player shapes (PlayerRegistry.shapes), for EF_SHAPECHANGE. */
  shapes?: readonly Shape[];
}

/** desc_stat: the stat's (positive or negative) adjective from its property. */
function descStat(
  env: GeneralEffectEnv | undefined,
  stat: number,
  positive: boolean,
): string {
  const prop = env?.properties?.find(
    (pr) => pr && pr.type === OBJ_PROPERTY.STAT && pr.propIndex === stat,
  );
  if (!prop) return positive ? "better" : "worse";
  return positive ? prop.adjective : prop.negAdj;
}

/** player_of_has: the racial flags plus every equipped item's. */
function playerOfHas(state: GameState, flag: number): boolean {
  const p = state.actor.player;
  if (p.race.flags.has(flag)) return true;
  for (let i = 0; i < p.body.count; i++) {
    if (state.runeEnv.slotObject(i)?.flags.has(flag)) return true;
  }
  return false;
}

/** The expDeps fallback: level changes still recompute, messages ride ctx. */
function expDepsOf(
  ctx: EffectHandlerContext,
  env: GameEffectEnvLike,
): ExpDeps {
  if (env.general?.expDeps) return env.general.expDeps;
  return {
    rng: env.state.rng,
    msg: (t: string): void => say(ctx, t),
  };
}

/** The slice of GameEffectEnv these helpers need (keeps tests light). */
interface GameEffectEnvLike {
  state: GameState;
  general?: GeneralEffectEnv;
}

/** msg() over the effect context's optional message sink. */
function say(ctx: EffectHandlerContext, text: string): void {
  ctx.env.messages?.msg(text);
}

/**
 * EF_GLYPH: create a glyph of warding (or a decoy) under the player.
 */
const handleGLYPH: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;

  /* Always notice */
  ctx.ident = true;

  /* Only one decoy at a time */
  if (state.decoy && ctx.subtype === GLYPH_DECOY) {
    say(ctx, "You can only deploy one decoy at a time.");
    return false;
  }

  /* See if the effect works */
  const grid = state.actor.grid;
  if (!featIsTrapHolding(state.chunk.features, state.chunk.feat(grid))) {
    say(ctx, "There is no clear floor on which to cast the spell.");
    return false;
  }

  const trapDeps = env.general?.trapDeps;
  if (!trapDeps) return true;

  /* Push objects off the grid */
  if (floorPile(state, grid).length > 0) pushObject(state, grid);

  /* Create a glyph (square_add_glyph: the glyph kinds are traps). */
  const kind = lookupTrap(
    trapDeps.kinds,
    ctx.subtype === GLYPH_DECOY ? "decoy" : "glyph of warding",
  );
  if (!kind) return true;
  placeTrap(state, grid, kind.tidx, 0, trapDeps);
  if (ctx.subtype === GLYPH_DECOY) state.decoy = grid;

  return true;
};

/**
 * EF_WEB: the acting monster spins webs over its surroundings.
 */
const handleWEB: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;

  /* Get the creating monster; the player can't currently create webs. */
  const midx = env.monCurrent ?? 0;
  const mon = midx > 0 ? state.monsters[midx] : null;
  if (!mon) return false;

  /* Always notice */
  ctx.ident = true;

  const trapDeps = env.general?.trapDeps;
  if (!trapDeps) return true;
  const web = lookupTrap(trapDeps.kinds, "web");
  if (!web) return true;

  /* Increase the radius for higher spell power */
  let rad = 1;
  if (mon.race.spellPower > 40) rad++;
  if (mon.race.spellPower > 80) rad++;

  /* Check within the radius for clear floor */
  for (let y = mon.grid.y - rad; y <= mon.grid.y + rad; y++) {
    for (let x = mon.grid.x - rad; x <= mon.grid.x + rad; x++) {
      const grid = loc(x, y);
      if (distance(grid, mon.grid) > rad || !state.chunk.inBoundsFully(grid))
        continue;

      /* square_iswebbable: a floor grid with no existing trap or glyph. */
      if (squareIsTrap(state, grid)) continue;
      if (!state.chunk.isFloor(grid)) continue;

      /* Create a web */
      placeTrap(state, grid, web.tidx, 0, trapDeps);
    }
  }

  return true;
};

/**
 * The EF_DISENCHANT body, shared with the PROJ_DISEN player side effect
 * (project-player.c dispatches it through effect_simple): pick a random
 * disenchantable equipment slot (not rings, amulets or lights), let
 * artifacts resist 60% of the time, and knock a point (sometimes two) off
 * the item's enchantment.
 */
export function disenchantEquipment(
  state: GameState,
  opts: { msg?: (text: string) => void } = {},
): void {
  const p = state.actor.player;
  const rng = state.rng;
  const skip = (i: number): boolean => {
    const type = p.body.slots[i]?.type;
    return type === "RING" || type === "AMULET" || type === "LIGHT";
  };

  /* Count disenchantable slots */
  let count = 0;
  for (let i = 0; i < p.body.count; i++) {
    if (skip(i)) continue;
    count++;
  }

  /* Pick one at random */
  let slot = -1;
  for (let i = p.body.count - 1; i >= 0; i--) {
    if (skip(i)) continue;
    slot = i;
    if (rng.oneIn(count--)) break;
  }
  if (slot < 0) return;

  /* Get the item; no item, nothing happens */
  const obj = state.runeEnv.slotObject(slot);
  if (!obj) return;

  /* Nothing to disenchant */
  if (obj.toH <= 0 && obj.toD <= 0 && obj.toA <= 0) return;

  const name = describeObject(state, obj, ODESC.BASE);

  /* Artifacts have a 60% chance to resist */
  if (obj.artifact && rng.randint0(100) < 60) {
    opts.msg?.(
      `Your ${name} resist${obj.number !== 1 ? "" : "s"} disenchantment!`,
    );
    return;
  }

  /* Apply disenchantment, depending on which kind of equipment */
  const type = p.body.slots[slot]?.type;
  if (type === "WEAPON" || type === "BOW") {
    /* Disenchant to-hit */
    if (obj.toH > 0) obj.toH--;
    if (obj.toH > 5 && rng.randint0(100) < 20) obj.toH--;

    /* Disenchant to-dam */
    if (obj.toD > 0) obj.toD--;
    if (obj.toD > 5 && rng.randint0(100) < 20) obj.toD--;
  } else {
    /* Disenchant to-ac */
    if (obj.toA > 0) obj.toA--;
    if (obj.toA > 5 && rng.randint0(100) < 20) obj.toA--;
  }

  opts.msg?.(
    `Your ${name} ${obj.number !== 1 ? "were" : "was"} disenchanted!`,
  );

  /* Recalculate bonuses (PU_BONUS) */
  state.updateBonuses?.();
}

/**
 * EF_DISENCHANT: apply disenchantment to the player's equipment.
 */
const handleDISENCHANT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  ctx.ident = true;
  disenchantEquipment(env.state, {
    msg: (text): void => say(ctx, text),
  });
  return true;
};

/**
 * EF_RESTORE_STAT: restore a drained stat (subtype is the stat index).
 */
const handleRESTORE_STAT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const p = env.state.actor.player;
  const stat = ctx.subtype;

  /* ID */
  ctx.ident = true;

  /* Check bounds */
  if (stat < 0 || stat >= STAT_MAX) return false;

  /* Not needed */
  if (p.statCur[stat] === p.statMax[stat]) return true;

  /* Restore */
  p.statCur[stat] = p.statMax[stat]!;

  /* Recalculate bonuses (PU_BONUS) */
  env.state.updateBonuses?.();

  say(ctx, `You feel less ${descStat(env.general, stat, false)}.`);
  return true;
};

/**
 * EF_DRAIN_STAT: drain a stat temporarily (subtype is the stat index),
 * unless the matching sustain saves it (teaching the sustain rune either
 * way, as upstream equip_learn_flag runs on both branches).
 */
const handleDRAIN_STAT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const p = state.actor.player;
  const stat = ctx.subtype;
  const flag = sustainFlag(stat);

  /* Bounds check */
  if (flag < 0) return false;

  /* ID */
  ctx.ident = true;

  /* Sustain */
  if (playerOfHas(state, flag)) {
    equipLearnFlag(p, state.runeEnv, flag);
    say(
      ctx,
      `You feel very ${descStat(env.general, stat, false)} for a moment, but the feeling passes.`,
    );
    return true;
  }

  /* Attempt to reduce the stat */
  if (playerStatDec(p, stat, false)) {
    let dam = effectCalculateValue(ctx, false);
    const player = ctx.env.player;
    if (player?.applyDamageReduction) dam = player.applyDamageReduction(dam);
    equipLearnFlag(p, state.runeEnv, flag);
    say(ctx, `You feel very ${descStat(env.general, stat, false)}.`);
    if (player?.takeHit) player.takeHit(dam, "stat drain");
    state.updateBonuses?.();
  }

  return true;
};

/**
 * EF_LOSE_RANDOM_STAT: lose a stat point permanently, in a stat other than
 * the one in subtype.
 */
const handleLOSE_RANDOM_STAT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const safeStat = ctx.subtype;
  const lossStat =
    (state.rng.randint1(STAT_MAX - 1) + safeStat) % STAT_MAX;

  if (playerStatDec(state.actor.player, lossStat, true)) {
    say(ctx, `You feel very ${descStat(env.general, lossStat, false)}.`);
    state.updateBonuses?.();
  }

  ctx.ident = true;
  return true;
};

/**
 * EF_GAIN_STAT: gain a stat point (subtype is the stat index).
 */
const handleGAIN_STAT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const stat = ctx.subtype;

  if (playerStatInc(state.actor.player, state.rng, stat)) {
    say(ctx, `You feel very ${descStat(env.general, stat, true)}!`);
    state.updateBonuses?.();
  }

  ctx.ident = true;
  return true;
};

/**
 * EF_RESTORE_EXP: restore any drained experience.
 */
const handleRESTORE_EXP: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const p = env.state.actor.player;

  if (p.exp < p.maxExp) {
    if (ctx.origin.what !== "none") {
      say(ctx, "You feel your life energies returning.");
    }
    playerExpGain(p, p.maxExp - p.exp, expDepsOf(ctx, env));
  }

  ctx.ident = true;
  return true;
};

/**
 * EF_GAIN_EXP: gain experience (halved, a slight upstream hack to simplify
 * food descriptions).
 */
const handleGAIN_EXP: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const p = env.state.actor.player;
  const amount = effectCalculateValue(ctx, false);

  if (p.exp < PY_MAX_EXP) {
    say(ctx, "You feel more experienced.");
    playerExpGain(p, Math.trunc(amount / 2), expDepsOf(ctx, env));
  }

  ctx.ident = true;
  return true;
};

/**
 * EF_DRAIN_LIGHT: drain fuel from the player's light source, if it burns
 * fuel and has any.
 */
const handleDRAIN_LIGHT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const p = state.actor.player;
  const drain = effectCalculateValue(ctx, false);

  const lightSlot = p.body.slots.findIndex((s) => s.type === "LIGHT");
  const obj = lightSlot >= 0 ? state.runeEnv.slotObject(lightSlot) : null;

  if (obj && !obj.flags.has(OF.NO_FUEL) && obj.timeout > 0) {
    /* Reduce fuel */
    obj.timeout -= drain;
    if (obj.timeout < 1) obj.timeout = 1;

    /* Notice */
    if (!(p.timed[TMD.BLIND]! > 0)) {
      say(ctx, "Your light dims.");
      ctx.ident = true;
    }
  }

  return true;
};

/**
 * EF_DRAIN_MANA: drain mana from the player, healing a monster caster six
 * points per point drained. A decoy soaks the drain (and is destroyed);
 * the monster-vs-monster branch (MON_TMD_DISEN on the target) rides the
 * monster-spell targeting (#19).
 */
const handleDRAIN_MANA: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const p = state.actor.player;
  let drain = effectCalculateValue(ctx, false);
  const isMonster = ctx.origin.what !== "trap";
  const mon =
    ctx.origin.what === "monster" ? state.monsters[ctx.origin.monster] : null;

  ctx.ident = true;

  /* Target was a decoy - destroy it. */
  if (state.decoy) {
    const decoyKind = env.general?.trapDeps
      ? lookupTrap(env.general.trapDeps.kinds, "decoy")
      : null;
    squareRemoveAllTraps(state, state.decoy, decoyKind ? decoyKind.tidx : -1);
    state.decoy = null;
    return true;
  }

  /* The player has no mana. */
  if (!p.csp) {
    say(ctx, "The draining fails.");
    /* update_smart_learn(PF_NO_MANA) rides lore (#24). */
    return true;
  }

  /* Drain the given amount if the player has that much, or all of it. */
  if (drain >= p.csp) {
    drain = p.csp;
    p.csp = 0;
    p.cspFrac = 0;
  } else {
    p.csp -= drain;
  }

  /* Heal the monster. */
  if (isMonster && mon && mon.hp < mon.maxhp) {
    mon.hp += 6 * drain;
    if (mon.hp > mon.maxhp) mon.hp = mon.maxhp;
    if (monsterIsVisible(mon)) {
      /* MDESC_STANDARD rides the display layer; the race name stands in. */
      say(ctx, `${mon.race.name} appears healthier.`);
    }
  }

  return true;
};

/**
 * EF_RECALL: toggle Word of Recall (effect-handler-general.c L1096) - a
 * delayed level change counted down by process_world (game/loop.ts). The
 * get_check prompts are the injected confirm (default yes, as an
 * unprompted terminal would auto-accept); birth_no_recall /
 * birth_levels_persist are options (#30, off); force_descend and is_quest
 * read the teleport env; arenas are not modelled.
 */
const handleRECALL: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const p = state.actor.player;
  const tp = env.teleport ?? {};
  const confirm = env.general?.confirm ?? ((): boolean => true);
  ctx.ident = true;

  /* No recall from single combat. */
  if (state.arenaLevel) {
    say(ctx, "Nothing happens.");
    return true;
  }

  /* No recall from quest levels with force_descend. */
  if (tp.forceDescend && tp.isQuest?.(state.chunk.depth)) {
    say(ctx, "Nothing happens.");
    return true;
  }

  /* Warn the player if they're descending to an unrecallable level. */
  const getNext = tp.getNextLevel ?? ((from: number, dir: 1 | -1): number => from + dir);
  const targetDepth = getNext(p.maxDepth, 1);
  if (tp.forceDescend && !state.chunk.depth && tp.isQuest?.(targetDepth)) {
    if (!confirm("Are you sure you want to descend? ")) return false;
  }

  if (!p.wordRecall) {
    /* Reset recall depth. */
    if (state.chunk.depth > 0) {
      if (state.chunk.depth !== p.maxDepth) {
        if (confirm("Set recall depth to current depth? ")) {
          p.recallDepth = p.maxDepth = state.chunk.depth;
        }
      } else {
        p.recallDepth = p.maxDepth;
      }
    }

    p.wordRecall = state.rng.randint0(20) + 15;
    say(ctx, "The air about you becomes charged...");
  } else {
    /* Deactivate recall. */
    if (
      !confirm(
        "Word of Recall is already active.  Do you want to cancel it? ",
      )
    ) {
      return false;
    }

    p.wordRecall = 0;
    say(ctx, "A tension leaves the air around you...");
  }

  return true;
};

/**
 * EF_DEEP_DESCENT: a delayed drop of several levels (effect-handler-
 * general.c L1166), counted down by process_world. The target increment is
 * (4 / stair_skip) + 1 from the deepest reached depth.
 */
const handleDEEP_DESCENT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const p = state.actor.player;
  const tp = env.teleport ?? {};

  /* Calculate target depth. */
  const increment = Math.trunc(4 / state.z.stairSkip) + 1;
  const maxDepth = tp.maxDepth ?? 128;
  const targetDepth = Math.min(p.maxDepth + increment, maxDepth - 1);

  if (targetDepth > state.chunk.depth) {
    say(ctx, "The air around you starts to swirl...");
    p.deepDescent = 3 + state.rng.randint1(4);
  } else {
    say(
      ctx,
      "You sense a malevolent presence blocking passage to the levels below.",
    );
  }
  ctx.ident = true;
  return true;
};

/**
 * EF_SCRAMBLE_STATS / EF_UNSCRAMBLE_STATS: the TMD_SCRAMBLE timed effect's
 * on-begin / on-end chains.
 */
const handleSCRAMBLE_STATS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  playerScrambleStats(env.state.actor.player, env.state.rng);
  env.state.updateBonuses?.();
  return true;
};

const handleUNSCRAMBLE_STATS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  playerFixScramble(env.state.actor.player);
  env.state.updateBonuses?.();
  return true;
};

/**
 * EF_MON_TIMED_INC: extend a monster status condition on the casting
 * monster (effect-handler-general.c L667).
 */
const handleMON_TIMED_INC: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  if (ctx.origin.what !== "monster") return true;
  const { state } = env;
  const amount = effectCalculateValue(ctx, false);
  const mon = state.monsters[ctx.origin.monster];

  if (mon) {
    monIncTimed(
      state.rng,
      mon,
      ctx.subtype,
      Math.max(amount, 0),
      0,
      undefined,
      env.monShape,
    );
    ctx.ident = true;
  }

  return true;
};

/**
 * EF_SHAPECHANGE (L3449): assume the shape in the subtype - set
 * player.shape (null = normal), run the shape's own effect chain, learn
 * its obvious runes (shape_learn_on_assume) and refresh the bonuses.
 */
const handleSHAPECHANGE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const p = state.actor.player;
  const shape = env.general?.shapes?.[ctx.subtype];
  if (!shape) return false;

  /* Change shape. */
  p.shape = shape.name === "normal" ? null : shape;
  say(ctx, `You assume the shape of a ${shape.name}!`);
  say(ctx, "Your gear merges into your body.");

  /* Do effect. */
  if (shape.effects.length) {
    const chain = buildObjectEffectChain(
      shape.effects as EffectRecordJson[],
      state,
    );
    ctx.registry.effectDo(chain, ctx.env, {
      origin: sourcePlayer(),
      ident: { value: false },
      aware: true,
      dir: 0,
      beam: 0,
    });
  }

  /* Update. */
  shapeLearnOnAssume(p, state.runeEnv, shape);
  state.updateBonuses?.();
  return true;
};

/**
 * EF_COMMAND (L3479): bend the targeted monster to the player's will -
 * wake it, roll the explicit level-vs-level save, then start the paired
 * TMD_COMMAND / MON_TMD_COMMAND timers (game/mon-cmd.ts drives the
 * possession; the world tick keeps the timers aligned).
 */
const handleCOMMAND: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const p = state.actor.player;
  const amount = effectCalculateValue(ctx, false);
  const mon = state.monsters[state.target.midx] ?? null;

  ctx.ident = true;

  /* Need to choose a monster, not just point. */
  if (!mon) {
    say(ctx, "No monster selected!");
    return false;
  }

  /* Wake up, become aware. */
  monsterWake(state.rng, mon, false, 100);

  /* Explicit saving throw. */
  if (state.rng.randint1(p.lev) < state.rng.randint1(mon.race.level)) {
    const name = mon.race.name;
    say(
      ctx,
      `${name.charAt(0).toUpperCase()}${name.slice(1)} resists your command!`,
    );
    /* Take a turn and deduct mana when the monster resists. */
    return true;
  }

  /* Player is commanding; monster is commanded. */
  p.timed[TMD.COMMAND] = Math.max(amount, 0);
  monIncTimed(state.rng, mon, MON_TMD.COMMAND, Math.max(amount, 0), 0);
  return true;
};

/**
 * EF_BIZARRE (L3516): the Ring of Bazaar-tan Ishi's random effect - a
 * malignant aura (all stats and a quarter of the experience, permanently),
 * a dispel-all burst, a 300-damage mana ball or a 250-damage mana bolt.
 */
const handleBIZARRE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const p = state.actor.player;

  ctx.ident = true;

  switch (state.rng.randint1(10)) {
    case 1:
    case 2: {
      say(ctx, "You are surrounded by a malignant aura.");

      /* Decrease all stats (permanently). */
      for (let stat = 0; stat < STAT_MAX; stat++) {
        playerStatDec(p, stat, true);
      }

      /* Lose some experience (permanently). */
      playerExpLose(p, Math.trunc(p.exp / 4), true, expDepsOf(ctx, env));
      state.updateBonuses?.();
      return true;
    }

    case 3: {
      say(ctx, "You are surrounded by a powerful aura.");

      /* Dispel monsters. */
      ctx.registry.effectSimple(EF.PROJECT_LOS, ctx.env, {
        origin: ctx.origin,
        diceString: "1000",
        subtype: PROJ.DISP_ALL,
      });
      return true;
    }

    case 4:
    case 5:
    case 6: {
      /* Mana ball. */
      let flg =
        PROJECT.THRU |
        PROJECT.STOP |
        PROJECT.GRID |
        PROJECT.ITEM |
        PROJECT.KILL;
      let target = locSum(state.actor.grid, DDGRID[ctx.dir] ?? loc(0, 0));

      /* Ask for a target if no direction given. */
      if (ctx.dir === DIR_TARGET && env.aimed) {
        flg &= ~(PROJECT.STOP | PROJECT.THRU);
        target = env.aimed;
      }

      /* Aim at the target, explode. */
      return castProjection(
        state,
        env.cast,
        playerCastSource(state),
        target,
        300,
        PROJ.MANA,
        flg,
        3,
      );
    }

    default: {
      /* Mana bolt. */
      const flg = PROJECT.STOP | PROJECT.KILL | PROJECT.THRU;
      let target = locSum(state.actor.grid, DDGRID[ctx.dir] ?? loc(0, 0));

      /* Use an actual target. */
      if (ctx.dir === DIR_TARGET && env.aimed) target = env.aimed;

      /* Aim at the target, do NOT explode. */
      return castProjection(
        state,
        env.cast,
        playerCastSource(state),
        target,
        250,
        PROJ.MANA,
        flg,
        0,
      );
    }
  }
};

/**
 * EF_PROBE: learn everything about every visible monster in line of
 * sight, reporting its hit points (effect-handler-general.c L2451).
 * Monster names are the race name until MDESC (#25).
 */
const handlePROBE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  let probe = false;

  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (!mon || !mon.race) continue;
    if (!squareIsView(state.chunk, mon.grid)) continue;
    if (!monsterIsVisible(mon)) continue;

    if (!probe) say(ctx, "Probing...");
    const name = mon.race.name;
    say(
      ctx,
      `${name.charAt(0).toUpperCase()}${name.slice(1)} has ${mon.hp} hit ` +
        `point${mon.hp === 1 ? "" : "s"}.`,
    );
    loreDoProbe(state.lore, mon);
    probe = true;
  }

  if (probe) {
    say(ctx, "That's all.");
    ctx.ident = true;
  }
  return true;
};

/** The general handlers, keyed by upstream EF code. */
const GENERAL_HANDLERS: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  [EF.PROBE, handlePROBE],
  [EF.BIZARRE, handleBIZARRE],
  [EF.COMMAND, handleCOMMAND],
  [EF.SHAPECHANGE, handleSHAPECHANGE],
  [EF.GLYPH, handleGLYPH],
  [EF.WEB, handleWEB],
  [EF.DISENCHANT, handleDISENCHANT],
  [EF.RECALL, handleRECALL],
  [EF.DEEP_DESCENT, handleDEEP_DESCENT],
  [EF.RESTORE_STAT, handleRESTORE_STAT],
  [EF.DRAIN_STAT, handleDRAIN_STAT],
  [EF.LOSE_RANDOM_STAT, handleLOSE_RANDOM_STAT],
  [EF.GAIN_STAT, handleGAIN_STAT],
  [EF.RESTORE_EXP, handleRESTORE_EXP],
  [EF.GAIN_EXP, handleGAIN_EXP],
  [EF.DRAIN_LIGHT, handleDRAIN_LIGHT],
  [EF.DRAIN_MANA, handleDRAIN_MANA],
  [EF.SCRAMBLE_STATS, handleSCRAMBLE_STATS],
  [EF.UNSCRAMBLE_STATS, handleUNSCRAMBLE_STATS],
  [EF.MON_TIMED_INC, handleMON_TIMED_INC],
]);

/**
 * Register the general world-touching handlers, overriding the stubs
 * registerCoreHandlers installed. Call after registerCoreHandlers. Each
 * handler reads its game environment from context.env.game (attach it with
 * attachGameEnv) and no-ops when it is absent.
 */
export function registerGeneralHandlers(registry: EffectRegistry): void {
  for (const [code, handler] of GENERAL_HANDLERS) {
    registry.register(code, { handler, status: "implemented" });
  }
}

/** The general EF codes this module registers. */
export const GENERAL_HANDLER_CODES: readonly number[] = [
  ...GENERAL_HANDLERS.keys(),
];
