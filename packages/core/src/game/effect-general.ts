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
 * GameState.decoy, and the monster AI targets it (game/monster-turn.ts:399-410
 * squareIsDecoyed / monsterIsDecoyed).
 */

import { EF, MON_TMD, OF, PROJ, TMD } from "../generated/index.js";
import { DDGRID, distance, loc, locSum } from "../loc.js";
import { PROJECT } from "../world/project.js";
import { GLYPH_DECOY } from "../effects/effect.js";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
} from "../effects/interpreter.js";
import {
  DIR_TARGET,
  effectCalculateValue,
  sourcePlayer,
} from "../effects/interpreter.js";
import {
  handleTIMED_INC as baseHandleTIMED_INC,
  timedIncEffectApplyToPlayer,
} from "../effects/handlers.js";
import {
  equipLearnFlag,
  shapeLearnOnAssume,
  sustainFlag,
} from "../obj/knowledge.js";
import { ODESC } from "../obj/desc.js";
import { describeObject } from "./describe.js";
import { GEAR_LABELS } from "./gear.js";
import type { EffectRecordJson } from "../obj/types.js";
import type { Shape } from "../player/types.js";
import { buildObjectEffectChain } from "./obj-cmd.js";
import { OBJ_PROPERTY } from "../obj/types.js";
import type { ObjectProperty } from "../obj/types.js";
import { STAT_MAX } from "../player/types.js";
import {
  PY_MAX_EXP,
  playerExpGain,
  playerExpLose,
  playerFixScramble,
  playerScrambleStats,
  playerStatDec,
  playerStatInc,
} from "../player/exp.js";
import type { ExpDeps } from "../player/exp.js";
import { monIncTimed } from "../mon/timed.js";
import { monsterWake } from "../mon/take-hit.js";
import { loreDoProbe } from "../mon/lore.js";
import { monsterIsVisible } from "../mon/predicate.js";
import { MDESC, MDESC_STANDARD, monsterDesc } from "../mon/desc.js";
import { featIsTrapHolding } from "../world/chunk.js";
import { squareIsView } from "../world/view.js";
import { lookupTrap } from "../world/trap.js";
import type { GameState } from "./context.js";
import { playerOfHas } from "./context.js";
import { gameEnv } from "./effect-game-env.js";
import {
  caveFindDecoy,
  destroyDecoy,
  monsterTargetMonster,
} from "./effect-mon-origin.js";
import { floorPile } from "./floor.js";
import { castProjection, playerCastSource } from "./project-cast.js";
import { pushObject } from "./project-feat.js";
import { placeTrap, squareIsTrap } from "./trap.js";
import type { TrapDeps } from "./trap.js";
import { dungeonGetNextLevel } from "./quest.js";

/**
 * The general-handler seams, grouped on the game effect environment
 * (effect-game-env.ts GameEffectEnv.general). trapDeps backs glyph and web
 * creation. It IS supplied in the live composition (session/game.ts:1698); a
 * caller that omits it gets no-op glyph/web handlers, which is the worldless
 * default and not a missing trap system (that is game/trap.ts).
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
  /**
   * get_quantity (ui-input.c L1206) for player_get_recall_depth's
   * "Which level do you wish to return to (0 to cancel)? " prompt. Only
   * reached under birth_levels_persist. 0 = cancel.
   */
  chooseDepth?: (prompt: string, max: number) => number;
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

/**
 * msg() over the effect context's optional message sink. `msgt` is a MSG_*
 * name, and passing one makes this the whole of msgt(): the sink plays the
 * type's sound as well (#239). It used to supply only the message half, with
 * every caller expected to add a `state.sound` of its own - which is why the
 * ones that did not were silent.
 */
function say(ctx: EffectHandlerContext, text: string, msgt?: string): void {
  ctx.env.messages?.msg(text, msgt);
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

  /* See if the effect works: square_istrappable (cave-square.c:220). */
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

      /* Create a web: square_add_web (cave-square.c:1331). */
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
  /* gear_to_label's equipment branch (obj-gear.c:452) is a single index into
   * the label table by body slot, and `slot` here IS that index. Both messages
   * below print it, as upstream does - without it the player is told an item
   * "was disenchanted" with no way to tell which of two rings of the same base
   * name it was. The row that deferred this called the letter part of the
   * display layer; GEAR_LABELS is game/gear.ts and known.ts:775 already
   * indexes it exactly this way. */
  const label = GEAR_LABELS[slot] ?? "";

  /* Artifacts have a 60% chance to resist */
  if (obj.artifact && rng.randint0(100) < 60) {
    opts.msg?.(
      `Your ${name} (${label}) resist${obj.number !== 1 ? "" : "s"} disenchantment!`,
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
    `Your ${name} (${label}) ${obj.number !== 1 ? "were" : "was"} disenchanted!`,
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
    /* show_damage " (N)" suffix (effect-handler-general.c L837-841). */
    const damText = dam > 0 && ctx.env.showDamage ? ` (${dam})` : "";
    say(ctx, `You feel very ${descStat(env.general, stat, false)}.${damText}`);
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

  /* Target is another monster - disenchant it (effect-handler-general.c:580).
   *
   * FIRST, before the decoy check, as upstream orders them: a monster aiming a
   * mana drain at another monster never reaches the player's mana or a decoy.
   * The row that deferred this said it "rides monster-spell targeting (#19)",
   * which stopped being true when monsterTargetMonster landed - it is imported
   * into this very file and used 300 lines below, and monIncTimed with
   * MON_TMD.DISEN is the whole body. */
  const tMon =
    ctx.origin.what === "monster"
      ? monsterTargetMonster(state, ctx.origin.monster)
      : null;
  if (tMon) {
    monIncTimed(
      state.rng,
      tMon,
      MON_TMD.DISEN,
      Math.max(drain, 0),
      0,
      undefined,
      env.monShape,
    );
    return true;
  }

  /* Target was a decoy - destroy it (effect-handler-general.c:586).
   *
   * Through the shared destroyDecoy, not open-coded. This block used to be a
   * line-for-line copy of that function's body MINUS its message, so a decoy
   * soaking a mana drain in full view of the player died in silence while the
   * same decoy killed by any of the five other callers announced itself. */
  if (state.decoy) {
    destroyDecoy(state, env.general?.trapDeps, (t) => say(ctx, t));
    return true;
  }

  /* The player has no mana. */
  if (!p.csp) {
    say(ctx, "The draining fails.");
    /* effect-handler-general.c:992 calls update_smart_learn(mon, player, 0,
     * PF_NO_MANA, -1) here, and that call DOES NOTHING in 4.2.6: mon-util.c:794
     * returns immediately when the flag is 0 and the element is out of range,
     * which is precisely that argument list. It is the only one of the nine
     * update_smart_learn call sites that passes a pflag at all, so the pflag arm
     * (mon-util.c:822-829) is unreachable and known_pstate.pflags is never
     * written in any game. Not ported, because porting it would reproduce a call
     * that returns before it reaches its own body. This line used to say the call
     * "rides lore (#24)", which named a blocker that was never the reason. */
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
      say(ctx, `${monsterDesc(mon, MDESC_STANDARD)} appears healthier.`);
    }
  }

  return true;
};

/**
 * player_get_recall_depth (player-util.c L100): under birth_levels_persist the
 * player CHOOSES which visited persistent level Word of Recall returns to.
 * Reached from exactly one place, effect_handler_RECALL's depth-0 branch
 * (effect-handler-general.c L1141), and only with that option on.
 *
 * The rules, exactly:
 *   - max_depth <= 0 (never left town) or birth_force_descend: no prompt at
 *     all, return true, recall_depth untouched (L109-111).
 *   - otherwise loop on get_quantity(prompt, p->max_depth): 0 cancels the whole
 *     scroll (return false); a depth with no entry in chunk_list re-prompts
 *     after "You must choose a level you have previously visited."
 *   - only on success is recall_depth assigned (L134).
 * get_quantity itself skips the prompt and yields 1 when max == 1
 * (ui-input.c L1211), so a max_depth of 1 never asks.
 *
 * `chooseDepth` is the get_quantity seam. With no seam an unprompted terminal
 * takes get_quantity's clamp-to-max, i.e. the deepest level reached, which is
 * always present in the cache.
 */
export function playerGetRecallDepth(
  state: GameState,
  chooseDepth?: (prompt: string, max: number) => number,
  say?: (text: string) => void,
): boolean {
  const p = state.actor.player;
  const forceDescend = state.options?.get("birth_force_descend") ?? false;
  if (p.maxDepth <= 0 || forceDescend) return true;

  const cache = state.levelCache;
  for (;;) {
    const chosen =
      p.maxDepth === 1
        ? 1
        : (chooseDepth?.(
            "Which level do you wish to return to (0 to cancel)? ",
            p.maxDepth,
          ) ?? p.maxDepth);
    if (chosen === 0) return false;
    /* chunk_list scan (L124-129): the port's frozen-level cache is keyed by
     * depth, which is the faithful identity for upstream's level name key. */
    if (cache?.has(chosen)) {
      p.recallDepth = chosen;
      return true;
    }
    say?.("You must choose a level you have previously visited.");
    /* An absent seam cannot answer differently on the next pass; upstream's
     * while (!level_ok) would spin forever, so stop rather than hang. */
    if (chooseDepth === undefined || p.maxDepth === 1) return false;
  }
}

/**
 * EF_RECALL: toggle Word of Recall (effect-handler-general.c L1096) - a
 * delayed level change counted down by process_world (game/loop.ts). The
 * get_check prompts are the injected confirm (default yes, as an
 * unprompted terminal would auto-accept). All four refusals are here in
 * upstream order: birth_no_recall (unless the character has already won),
 * force_descend on a quest level, single combat, and the force_descend
 * descend-into-a-quest warning. force_descend and is_quest read the teleport
 * env; birth_no_recall and birth_levels_persist read the option store.
 * birth_levels_persist suppresses the "set recall depth to current depth?"
 * prompt and turns on player_get_recall_depth.
 */
const handleRECALL: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const p = state.actor.player;
  const tp = env.teleport ?? {};
  const confirm = env.general?.confirm ?? ((): boolean => true);
  ctx.ident = true;

  /* No recall (effect-handler-general.c L1098-1102). The birth option "Word of
   * Recall has no effect" (#34) turns the scroll into a dead item for the whole
   * game EXCEPT once the character has won: total_winner re-enables it, which is
   * how a winner gets back to town to retire. This guard was absent, so the
   * option did nothing at all. */
  if (
    (state.options?.get("birth_no_recall") ?? false) &&
    !p.totalWinner
  ) {
    say(ctx, "Nothing happens.");
    return true;
  }

  /* No recall from quest levels with force_descend. */
  if (tp.forceDescend && tp.isQuest?.(state.chunk.depth)) {
    say(ctx, "Nothing happens.");
    return true;
  }

  /* No recall from single combat. */
  if (state.arenaLevel) {
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
    /* Reset recall depth (effect-handler-general.c L1129-1143). The
     * !OPT(birth_levels_persist) half of L1131 matters: with persistent levels
     * on, an off-max depth takes the ELSE arm (recall_depth = max_depth, no
     * prompt) instead of offering to re-anchor recall here. */
    const levelsPersist = state.options?.get("birth_levels_persist") ?? false;
    if (state.chunk.depth > 0) {
      if (state.chunk.depth !== p.maxDepth && !levelsPersist) {
        if (confirm("Set recall depth to current depth? ")) {
          p.recallDepth = p.maxDepth = state.chunk.depth;
        }
      } else {
        p.recallDepth = p.maxDepth;
      }
    } else if (levelsPersist) {
      /* L1140-1142: in town, persistent-levels players pick the destination,
       * and a cancel aborts the whole effect (no charge, no turn). */
      if (
        !playerGetRecallDepth(state, env.general?.chooseDepth, (t) =>
          say(ctx, t),
        )
      ) {
        return false;
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
 * EF_DEEP_DESCENT: a delayed drop of several levels
 * (effect-handler-general.c L1162-1181), counted down by process_world. The
 * target increment is (4 / stair_skip) + 1 from the deepest reached depth.
 */
const handleDEEP_DESCENT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const p = state.actor.player;

  /* Calculate target depth (effect-handler-general.c:1167-1169) - through
   * dungeon_get_next_level, so the quest scan and the max_depth clamp both
   * apply rather than a bare arithmetic min. */
  const increment = Math.trunc(4 / state.z.stairSkip) + 1;
  const targetDepth = dungeonGetNextLevel(p, p.maxDepth, increment, state.z);

  /* Both arms are msgt(MSG_TPLEVEL, ...) (effect-handler-general.c:1171,
   * :1178) - the message carries the type, and msgt's other half is the
   * sound. Neither half existed here (PORT_TODO 3.26); the second half is the
   * typed sink's job now (#239). */
  if (targetDepth > state.chunk.depth) {
    say(ctx, "The air around you starts to swirl...", "TPLEVEL");
    p.deepDescent = 3 + state.rng.randint1(4);
  } else {
    say(
      ctx,
      "You sense a malevolent presence blocking passage to the levels below.",
      "TPLEVEL",
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
 * The player TMD -> monster MON_TMD map used when a monster's EF_TIMED_INC
 * targets another monster (effect-handler-general.c L594-624). Subtypes with
 * no monster analogue are absent, so the effect is skipped for them, exactly
 * as the upstream default switch case does nothing.
 */
const TMD_TO_MON_TMD: Readonly<Record<number, number>> = {
  [TMD.CONFUSED]: MON_TMD.CONF,
  [TMD.SLOW]: MON_TMD.SLOW,
  [TMD.PARALYZED]: MON_TMD.HOLD,
  [TMD.BLIND]: MON_TMD.STUN,
  [TMD.AFRAID]: MON_TMD.FEAR,
  [TMD.AMNESIA]: MON_TMD.SLEEP,
};

/**
 * EF_TIMED_INC (effect-handler-general.c L575): extend a timed condition. The
 * game-layer override adds the SRC_MONSTER sub-branches the worldless base
 * cannot reach: a monster attack destroying the player's decoy
 * (square_destroy_decoy, gated on cave->mon_current > 0), or a monster
 * targeting another monster (monster_target_monster -> the TMD -> MON_TMD map
 * -> mon_inc_timed). Everything else (player origin, or a monster origin that
 * falls through to the player) delegates to the base handler so the player
 * player_inc_timed path stays single-sourced.
 */
const handleTIMED_INC: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env || ctx.origin.what !== "monster") return baseHandleTIMED_INC(ctx);

  const { state } = env;
  const amount = effectCalculateValue(ctx, false);

  ctx.ident = true;

  /* Destroy the decoy if it's a monster attack. */
  if ((env.monCurrent ?? 0) > 0 && caveFindDecoy(state)) {
    destroyDecoy(state, env.general?.trapDeps, (t) => say(ctx, t));
    return true;
  }

  /* A monster targeting another monster maps the player TMD to a MON_TMD. */
  const tMon = monsterTargetMonster(state, ctx.origin.monster);
  if (tMon) {
    const monEffect = TMD_TO_MON_TMD[ctx.subtype];
    if (monEffect !== undefined) {
      monIncTimed(
        state.rng,
        tMon,
        monEffect,
        Math.max(amount, 0),
        0,
        undefined,
        env.monShape,
      );
    }
    return true;
  }

  /* Otherwise the player is the target. */
  timedIncEffectApplyToPlayer(ctx, amount);
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
  /* player_shape_by_idx (player-util.c L1000) walks the shape list for a
   * matching sidx; bind.ts assigns sidx == array index (player/bind.ts L527),
   * so the array read IS that lookup. Upstream then re-resolves the same shape
   * by name through lookup_player_shape (L971) - a no-op round trip. Upstream
   * assert(shape)s a miss; the port declines the effect instead. */
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
    /* monster_desc(MDESC_STANDARD), not a hand-rolled capitalisation of the
     * race name: MDESC_STANDARD already carries CAPITAL, and it is the only
     * thing that renders an unseen monster as "Something" instead of naming a
     * race the player cannot see. */
    say(ctx, `${monsterDesc(mon, MDESC_STANDARD)} resists your command!`);
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
    /* PROBE's own flag set, NOT MDESC_STANDARD: IND_HID | CAPITAL | COMMA,
     * with no PRO_HID (effect-handler-general.c L2466). The loop has already
     * skipped every unseen monster, so the difference never shows in play -
     * but the flags are upstream's choice at this site and copying the wrong
     * constant here would make the next site that reuses them wrong too. */
    const name = monsterDesc(mon, MDESC.IND_HID | MDESC.CAPITAL | MDESC.COMMA);
    say(ctx, `${name} has ${mon.hp} hit point${mon.hp === 1 ? "" : "s"}.`);
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
  /* effect_handler_BIZARRE (effect-handler-general.c:3516) */
  [EF.BIZARRE, handleBIZARRE],
  [EF.COMMAND, handleCOMMAND],
  /* effect_handler_SHAPECHANGE (effect-handler-general.c:3449) */
  [EF.SHAPECHANGE, handleSHAPECHANGE],
  [EF.GLYPH, handleGLYPH],
  /* effect_handler_WEB (effect-handler-general.c:732) */
  [EF.WEB, handleWEB],
  [EF.DISENCHANT, handleDISENCHANT],
  [EF.RECALL, handleRECALL],
  /* effect_handler_DEEP_DESCENT (effect-handler-general.c:1163) */
  [EF.DEEP_DESCENT, handleDEEP_DESCENT],
  /* effect_handler_RESTORE_STAT (effect-handler-general.c:773) */
  [EF.RESTORE_STAT, handleRESTORE_STAT],
  [EF.DRAIN_STAT, handleDRAIN_STAT],
  /* effect_handler_LOSE_RANDOM_STAT (effect-handler-general.c:852) */
  [EF.LOSE_RANDOM_STAT, handleLOSE_RANDOM_STAT],
  /* effect_handler_GAIN_STAT (effect-handler-general.c:875) */
  [EF.GAIN_STAT, handleGAIN_STAT],
  /* effect_handler_RESTORE_EXP (effect-handler-general.c:893) */
  [EF.RESTORE_EXP, handleRESTORE_EXP],
  /* effect_handler_GAIN_EXP (effect-handler-general.c:913) */
  [EF.GAIN_EXP, handleGAIN_EXP],
  /* effect_handler_DRAIN_LIGHT (effect-handler-general.c:928) */
  [EF.DRAIN_LIGHT, handleDRAIN_LIGHT],
  /* effect_handler_DRAIN_MANA (effect-handler-general.c:956) */
  [EF.DRAIN_MANA, handleDRAIN_MANA],
  /* effect_handler_SCRAMBLE_STATS (effect-handler-general.c:3630) */
  [EF.SCRAMBLE_STATS, handleSCRAMBLE_STATS],
  /* effect_handler_UNSCRAMBLE_STATS (effect-handler-general.c:3642) */
  [EF.UNSCRAMBLE_STATS, handleUNSCRAMBLE_STATS],
  /* effect_handler_TIMED_INC (effect-handler-general.c:576) */
  [EF.TIMED_INC, handleTIMED_INC],
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
