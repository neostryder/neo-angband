/**
 * The item-targeting effect handlers, ported from
 * reference/src/effect-handler-general.c (Angband 4.2.6): EF_ENCHANT (L2095
 * with enchant_spell / enchant / enchant_score, L255), EF_RECHARGE (L2127
 * with recharge_failure_chance, effects.c L563), EF_REMOVE_CURSE (L1051 with
 * uncurse_object, L179), EF_BRAND_WEAPON / EF_BRAND_AMMO / EF_BRAND_BOLTS
 * (L3233 with brand_object, L427), EF_CURSE_ARMOR / EF_CURSE_WEAPON (L3103),
 * EF_CREATE_ARROWS (L3315) and EF_TAP_DEVICE (L3370).
 *
 * These effects target an object the player chooses (upstream get_item /
 * cmd_get_item "tgtitem"). The chooser is the injected
 * ItemEffectEnv.getItem seam (the item menu rides presentation, #25); absent,
 * the choosing handlers return false unused - exactly the upstream cancel
 * path, so the scroll or spell is not consumed.
 *
 * Simplifications, ledgered in parity/ledger/game-effect-item.yaml:
 * ODESC descriptions ride the display layer (the kind's base name is used);
 * obj->known sync rides rune-based knowledge; EF_IDENTIFY needs the
 * per-object rune enumeration (object_learn_unknown_rune) and rides the
 * knowledge/detection batch (#24).
 */

import { EF, OF, ORIGIN, TMD, TV } from "../generated";
import {
  ENCH_TOAC,
  ENCH_TOBOTH,
  ENCH_TODAM,
  ENCH_TOHIT,
} from "../effects/effect";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
} from "../effects/interpreter";
import { effectCalculateValue } from "../effects/interpreter";
import type { GameObject } from "../obj/object";
import {
  appendObjectCurse,
  removeObjectCurse,
  tvalCanHaveCharges,
  tvalIsAmmo,
  tvalIsArmor,
  tvalIsStaff,
  tvalIsWand,
  tvalIsWeapon,
} from "../obj/object";
import {
  buildRuneList,
  objectLearnUnknownRune,
  objectRunesKnown,
  playerLearnFlagRune,
} from "../obj/knowledge";
import { ODESC } from "../obj/desc";
import { describeObject } from "./describe";
import type { ObjRegistry } from "../obj/bind";
import { egoApplyMagic, makeObject } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import type { GameState } from "./context";
import { gearObjectForUse } from "./gear";
import { dropNear, floorExcise } from "./floor";
import { gameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";

/** The get_item request: prompt/reject texts, the tester, allowed sources. */
export interface ItemRequest {
  /** The prompt ("Enchant which item? "). */
  prompt: string;
  /** The nothing-to-choose message ("You have nothing to enchant."). */
  reject: string;
  /** item_tester: which objects qualify. */
  tester: (obj: GameObject) => boolean;
  /** USE_EQUIP / USE_INVEN / USE_QUIVER / USE_FLOOR. */
  mode: { equip?: boolean; inven?: boolean; quiver?: boolean; floor?: boolean };
  /**
   * REMOVE_CURSE: after the item pick, get_curse chooses which removable curse
   * to lift. The shell prompts for it (and rides it on args.tgtcurse) only when
   * this is set and the chosen object has more than one removable curse.
   */
  curses?: boolean;
}

/**
 * enchant_spell's get_item request (effect-handler-general.c L383): a weapon,
 * or armour when the enchant targets AC only. Shared by the ENCHANT handler
 * (enchantSpell) and the shell probe (requestForEffect) so the tval filter can
 * never drift between them.
 */
function enchantRequest(numAc: number): ItemRequest {
  return {
    prompt: "Enchant which item? ",
    reject: "You have nothing to enchant.",
    tester: numAc
      ? (o: GameObject): boolean => tvalIsArmor(o.tval)
      : (o: GameObject): boolean => tvalIsWeapon(o.tval),
    mode: { equip: true, inven: true, quiver: true, floor: true },
  };
}

/** item_tester_uncursable (obj-util.c): a removable (power in (0,100)) curse. */
function uncursableTester(o: GameObject): boolean {
  return !!o.curses?.some((c, i) => i > 0 && c.power > 0 && c.power < 100);
}

/**
 * requestForEffect (single source of truth): the ItemRequest a choosing handler
 * uses for a given EF code and decoded subtype. Both each handler and the pure
 * shell probe (itemTargetRequest) read it, so the prompt / reject / tval filter
 * / item modes never drift. Returns null for non-choosing effects and for the
 * auto-target ones (BRAND_WEAPON / CURSE_ARMOR / CURSE_WEAPON / ACQUIRE).
 */
export function requestForEffect(
  code: number,
  subtype: number,
  state: GameState,
): ItemRequest | null {
  switch (code) {
    case EF.ENCHANT:
      /* enchant_spell L383: filter = num_ac ? armour : weapon. The first
       * getItem targets a weapon unless the effect is AC-only. */
      return enchantRequest((subtype & (ENCH_TOHIT | ENCH_TODAM)) === 0 ? 1 : 0);
    case EF.RECHARGE:
      return {
        prompt: "Recharge which item? ",
        reject: "You have nothing to recharge.",
        tester: (o) => tvalCanHaveCharges(o.tval),
        mode: { inven: true, floor: true },
      };
    case EF.REMOVE_CURSE:
      return {
        prompt: "Uncurse which item? ",
        reject: "You have no curses to remove.",
        tester: uncursableTester,
        mode: { equip: true, inven: true, quiver: true, floor: true },
        curses: true,
      };
    case EF.BRAND_AMMO:
      return {
        prompt: "Brand which kind of ammunition? ",
        reject: "You have nothing to brand.",
        tester: (o) => tvalIsAmmo(o.tval),
        mode: { inven: true, quiver: true, floor: true },
      };
    case EF.BRAND_BOLTS:
      return {
        prompt: "Brand which bolts? ",
        reject: "You have no bolts to brand.",
        tester: (o) => o.tval === TV.BOLT,
        mode: { inven: true, quiver: true, floor: true },
      };
    case EF.CREATE_ARROWS:
      return {
        prompt: "Make arrows from which staff? ",
        reject: "You have no staff to use.",
        tester: (o) => tvalIsStaff(o.tval),
        mode: { inven: true, floor: true },
      };
    case EF.TAP_DEVICE:
      return {
        prompt: "Drain charges from which item? ",
        reject: "You have nothing to drain charges from.",
        tester: (o) => tvalCanHaveCharges(o.tval),
        mode: { inven: true, floor: true },
      };
    case EF.IDENTIFY: {
      /* item_tester_unknown (L247): not all runes known. */
      const runes = buildRuneList(state.runeEnv);
      const player = state.actor.player;
      return {
        prompt: "Identify which item? ",
        reject: "You have nothing to identify.",
        tester: (o) => !objectRunesKnown(player, state.runeEnv, o, runes),
        mode: { equip: true, inven: true, quiver: true, floor: true },
      };
    }
    default:
      return null;
  }
}

/**
 * itemTargetRequest (the RNG-free shell probe): walk a built effect chain and
 * return the ItemRequest the first item-choosing handler will use, decoding
 * subtype exactly as the handler does. The shell calls this before running the
 * effect so it can pre-resolve the target and the effect runs EXACTLY ONCE
 * (preserving the pre-getItem RNG draw order); chain construction draws no RNG.
 * Returns null for objects / spells with no item-target effect.
 */
export function itemTargetRequest(
  chain: import("../effects/effect").Effect | null,
  state: GameState,
): ItemRequest | null {
  for (let e = chain; e; e = e.next) {
    if (typeof e.index !== "number") continue;
    const req = requestForEffect(e.index, e.subtype, state);
    if (req) return req;
  }
  return null;
}

/**
 * The dice_string format built inline in effect_handler_REMOVE_CURSE
 * (effect-handler-general.c L1071-1085), from the effect's un-rolled dice
 * spec (base/dice/sides). Pure: does not draw the RNG (mirrors
 * Dice.randomValue(), not Dice.roll()).
 */
function formatUncurseDiceString(v: import("../rng").RandomValue): string {
  if (v.dice === 1 && v.base) return `${v.base}+d${v.sides}`;
  if (v.dice && v.base) return `${v.base}+${v.dice}d${v.sides}`;
  if (v.dice === 1) return `d${v.sides}`;
  if (v.dice) return `${v.dice}d${v.sides}`;
  return `${v.base}`;
}

/**
 * The curse-removal picker's header needs the spell's "strength" dice
 * formula (ui-curse.c curse_menu's `dice_string` parameter) BEFORE the effect
 * runs, so the shell can show "Remove which curse (spell strength <dice>)?"
 * while still pre-resolving the item/curse pick (preserving RNG order). This
 * walks the already-built chain to the REMOVE_CURSE node and formats its raw
 * (un-rolled) dice spec - a pure read, no RNG draw. Returns null when the
 * chain has no REMOVE_CURSE effect.
 */
export function removeCurseDiceString(
  chain: import("../effects/effect").Effect | null,
): string | null {
  for (let e = chain; e; e = e.next) {
    if (e.index !== EF.REMOVE_CURSE) continue;
    const rv = e.dice ? e.dice.randomValue() : { base: 0, dice: 0, sides: 0, mBonus: 0 };
    return formatUncurseDiceString(rv);
  }
  return null;
}

/**
 * The item-effect seams, grouped on the game effect environment
 * (GameEffectEnv.item). getItem is upstream get_item / cmd_get_item; absent,
 * the choosing handlers return false unused (the cancel path). reg backs
 * brand_object's ego lookup and the curse table; makeDeps backs
 * CREATE_ARROWS' arrow generation.
 */
export interface ItemEffectEnv {
  /** get_item: choose an object matching the request, or null to cancel. */
  getItem?: (req: ItemRequest) => GameObject | null;
  /**
   * get_curse: pick which removable curse to lift (REMOVE_CURSE). Given the
   * object and the eligible curse indices; default picks the first.
   */
  chooseCurse?: (obj: GameObject, removable: readonly number[]) => number | null;
  /** The bound object registry (egos for branding, the curse table). */
  reg?: ObjRegistry;
  /** Object generation (CREATE_ARROWS). */
  makeDeps?: MakeDeps;
}

/** msg() over the effect context's optional message sink. */
function say(ctx: EffectHandlerContext, text: string): void {
  ctx.env.messages?.msg(text);
}

/** object_is_carried: the object lives in the player's gear store. */
function objectIsCarried(state: GameState, obj: GameObject): boolean {
  for (const o of state.gear.store.values()) {
    if (o === obj) return true;
  }
  return false;
}

/**
 * Destroy one item of the stack, wherever it lives (the recharge backfire /
 * staff consumption path: gear_object_for_use or floor_object_for_use plus
 * object_delete).
 */
function destroyOneItem(state: GameState, obj: GameObject): void {
  for (const [handle, o] of state.gear.store) {
    if (o === obj) {
      gearObjectForUse(state.gear, state.actor.player, handle, 1);
      return;
    }
  }
  /* On the floor: shrink the stack, or excise the last one. */
  for (const [key, pile] of state.floor) {
    if (!pile.includes(obj)) continue;
    if (obj.number > 1) {
      obj.number--;
    } else {
      const grid = {
        x: key % state.chunk.width,
        y: Math.trunc(key / state.chunk.width),
      };
      floorExcise(state, grid, obj);
    }
    return;
  }
}

/* ------------------------------------------------------------------ *
 * Enchantment (effect-handler-general.c L255)
 * ------------------------------------------------------------------ */

/** Used by the enchant() function (chance of failure). */
const ENCHANT_TABLE: readonly number[] = [
  0, 10, 20, 40, 80, 160, 280, 400, 550, 700, 800, 900, 950, 970, 990, 1000,
];

/** enchant_score: try to increase one bonus score. */
function enchantScore(
  state: GameState,
  score: number,
  isArtifact: boolean,
): { score: number; raised: boolean } {
  /* Artifacts resist enchantment half the time */
  if (isArtifact && state.rng.randint0(100) < 50) return { score, raised: false };

  /* Figure out the chance to enchant */
  let chance: number;
  if (score < 0) chance = 0;
  else if (score > 15) chance = 1000;
  else chance = ENCHANT_TABLE[score]!;

  /* If we roll less-than-or-equal to chance, it fails */
  if (state.rng.randint1(1000) <= chance) return { score, raised: false };

  return { score: score + 1, raised: true };
}

/**
 * enchant (L319): try `n` times to raise the item's to-hit / to-dam / to-ac
 * per `eflag`, with pile resistance (ammo is 20x easier) and the artifact
 * resist. Returns true if any bonus was raised. The obj->known display sync
 * rides rune knowledge.
 */
export function enchant(
  state: GameState,
  obj: GameObject,
  n: number,
  eflag: number,
): boolean {
  let res = false;
  const isArtifact = !!obj.artifact;

  /* Large piles resist enchantment */
  let prob = obj.number * 100;

  /* Missiles are easy to enchant */
  if (tvalIsAmmo(obj.tval)) prob = Math.trunc(prob / 20);

  /* Try "n" times */
  for (let i = 0; i < n; i++) {
    /* Roll for pile resistance */
    if (prob > 100 && state.rng.randint0(prob) >= 100) continue;

    /* Try the three kinds of enchantment we can do */
    if (eflag & ENCH_TOHIT) {
      const r = enchantScore(state, obj.toH, isArtifact);
      obj.toH = r.score;
      if (r.raised) res = true;
    }
    if (eflag & ENCH_TODAM) {
      const r = enchantScore(state, obj.toD, isArtifact);
      obj.toD = r.score;
      if (r.raised) res = true;
    }
    if (eflag & ENCH_TOAC) {
      const r = enchantScore(state, obj.toA, isArtifact);
      obj.toA = r.score;
      if (r.raised) res = true;
    }
  }

  if (!res) return false;

  /* Recalculate bonuses (PU_BONUS | PU_INVEN) */
  state.updateBonuses?.();
  return true;
}

/**
 * enchant_spell (L373): choose a weapon (or armour when num_ac) and enchant
 * it. Returns true if attempted, false if cancelled.
 */
function enchantSpell(
  ctx: EffectHandlerContext,
  env: GameEffectEnv,
  numHit: number,
  numDam: number,
  numAc: number,
): boolean {
  const { state } = env;
  const obj = env.item?.getItem?.(enchantRequest(numAc));
  if (!obj) return false;

  /* Describe (ODESC_BASE, obj-desc gates the name by knowledge) */
  const name = describeObject(state, obj, ODESC.BASE);
  say(
    ctx,
    `${objectIsCarried(state, obj) ? "Your" : "The"} ${name} glow${
      obj.number > 1 ? "" : "s"
    } brightly!`,
  );

  /* Enchant */
  let okay = false;
  if (numDam && enchant(state, obj, numHit, ENCH_TOBOTH)) okay = true;
  else if (enchant(state, obj, numHit, ENCH_TOHIT)) okay = true;
  else if (enchant(state, obj, numDam, ENCH_TODAM)) okay = true;
  if (enchant(state, obj, numAc, ENCH_TOAC)) okay = true;

  /* Failure */
  if (!okay) say(ctx, "The enchantment failed.");

  /* Something happened */
  return true;
}

/**
 * brand_object (L427): turn a non-magical object into the "of `name`" ego,
 * with its aura message and a 4-6 round hit/dam enchant. Artifacts, egos
 * and worthless items cannot be branded. player_know_object rides rune
 * knowledge.
 */
export function brandObject(
  ctx: EffectHandlerContext,
  env: GameEffectEnv,
  obj: GameObject | null,
  name: string,
): void {
  const { state } = env;
  const egos = env.item?.reg?.egos;

  if (obj && obj.kind.cost && !obj.artifact && !obj.ego && egos) {
    /* Get the right ego type for the object */
    const brand = `of ${name}`;
    const ego = egos.find(
      (e) => e.name === brand && e.possItems.has(obj.kind.kidx),
    );
    if (!ego) {
      say(ctx, "The branding failed.");
      return;
    }

    /* Describe (ODESC_BASE) */
    say(
      ctx,
      `The ${describeObject(state, obj, ODESC.BASE)} ${obj.number > 1 ? "are" : "is"} surrounded with an aura of ${name}.`,
    );

    /* Make it an ego item */
    obj.ego = ego;
    if (env.item?.reg) egoApplyMagic(state.rng, env.item.reg, obj, 0);
    state.updateBonuses?.();

    /* Enchant */
    enchant(state, obj, state.rng.randint0(3) + 4, ENCH_TOHIT | ENCH_TODAM);
  } else {
    say(ctx, "The branding failed.");
  }
}

/**
 * recharge_failure_chance (effects.c L563): N for the 1-in-N backfire.
 */
export function rechargeFailureChance(
  obj: GameObject,
  strength: number,
): number {
  /* Ease of recharge ranges from 9 down to 4 (wands) or 3 (staffs) */
  const easeOfRecharge = Math.trunc((100 - obj.kind.level) / 10);
  const rawChance =
    strength + easeOfRecharge - 2 * Math.trunc(obj.pval / obj.number);
  return rawChance > 1 ? rawChance : 1;
}

/* ------------------------------------------------------------------ *
 * The handlers
 * ------------------------------------------------------------------ */

/**
 * EF_ENCHANT: enchant an item per the subtype's ENCH_ flags, `value` times.
 */
const handleENCHANT: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const value = env.state.rng.randcalc(
    ctx.value,
    env.state.chunk.depth,
    "randomise",
  );
  let used = false;
  ctx.ident = true;

  if ((ctx.subtype & ENCH_TOBOTH) === ENCH_TOBOTH) {
    if (enchantSpell(ctx, env, value, value, 0)) used = true;
  } else if (ctx.subtype & ENCH_TOHIT) {
    if (enchantSpell(ctx, env, value, 0, 0)) used = true;
  } else if (ctx.subtype & ENCH_TODAM) {
    if (enchantSpell(ctx, env, 0, value, 0)) used = true;
  }
  if (ctx.subtype & ENCH_TOAC) {
    if (enchantSpell(ctx, env, 0, 0, value)) used = true;
  }

  return used;
};

/**
 * EF_RECHARGE: recharge a wand or staff; strength is value.base + the dice
 * roll. High-level and highly-charged items are harder; a backfire destroys
 * one item of the stack.
 */
const handleRECHARGE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const strength =
    ctx.value.base + state.rng.damroll(ctx.value.dice, ctx.value.sides);

  /* Immediately obvious */
  ctx.ident = true;

  /* The recharge_pow failure-rate display rides presentation (#25). */

  /* Get an item */
  const obj = env.item?.getItem?.(requestForEffect(EF.RECHARGE, 0, state)!);
  if (!obj) return false;

  const i = rechargeFailureChance(obj, strength);
  /* Back-fire */
  if (i <= 1 || state.rng.oneIn(i)) {
    say(ctx, "The recharge backfires!");
    say(ctx, "There is a bright flash of light.");
    destroyOneItem(state, obj);
  } else {
    /* Extract a "power" */
    const easeOfRecharge = Math.trunc((100 - obj.kind.level) / 10);
    const t = Math.trunc(strength / (10 - easeOfRecharge)) + 1;

    /* Recharge based on the power */
    if (t > 0) obj.pval += 2 + state.rng.randint1(t);
  }

  /* Something was done */
  return true;
};

/**
 * EF_REMOVE_CURSE: attempt to lift a curse from a chosen item
 * (uncurse_object, L179). Success removes the curse; failure makes the item
 * fragile, and a fragile item explodes one time in four.
 */
const handleREMOVE_CURSE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const strength = effectCalculateValue(ctx, false);
  ctx.ident = true;

  /* item_tester_uncursable: at least one removable (power < 100) curse.
   * Upstream tests the known twin; knowledge is rune-based here. */
  const obj = env.item?.getItem?.(requestForEffect(EF.REMOVE_CURSE, 0, state)!);
  if (!obj || !obj.curses) return false;

  /* get_curse: pick among the object's active curses. */
  const active: number[] = [];
  obj.curses.forEach((c, i) => {
    if (i > 0 && c.power > 0) active.push(i);
  });
  const pick = env.item?.chooseCurse
    ? env.item.chooseCurse(obj, active)
    : (active[0] ?? null);
  if (pick === null || pick === undefined) return false;

  const curse = obj.curses[pick]!;
  if (curse.power >= 100) {
    /* Curse is permanent */
    return false;
  } else if (strength >= curse.power) {
    /* Successfully removed this curse */
    removeObjectCurse(obj, pick);
    const name = env.item?.reg?.curses[pick]?.name ?? "";
    say(ctx, `The ${name} curse is removed!`);
  } else if (!obj.flags.has(OF.FRAGILE)) {
    /* Failure to remove, object is now fragile */
    say(
      ctx,
      `The spell fails; your ${describeObject(state, obj, ODESC.FULL)} is now fragile.`,
    );
    obj.flags.on(OF.FRAGILE);
    playerLearnFlagRune(state.actor.player, state.runeEnv, OF.FRAGILE);
  } else if (state.rng.oneIn(4)) {
    /* Failure - unlucky fragile object is destroyed */
    let dam = state.rng.damroll(5, 5);
    const player = ctx.env.player;
    if (player?.applyDamageReduction) dam = player.applyDamageReduction(dam);
    say(ctx, "There is a bang and a flash!");
    /* Artifacts are marked as lost (effect-handler-general.c L220-222). */
    if (obj.artifact) state.onArtifactLost?.(obj.artifact);
    destroyOneItem(state, obj);
    player?.takeHit?.(dam, "Failed uncursing");
  } else {
    /* Non-destructive failure */
    say(ctx, "The removal fails.");
  }

  /* Recalculate bonuses (PU_BONUS) */
  state.updateBonuses?.();
  return true;
};

/**
 * EF_BRAND_WEAPON: brand the wielded weapon Flame or Frost.
 */
const handleBRAND_WEAPON: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const slot = state.actor.player.body.slots.findIndex(
    (s) => s.type === "WEAPON",
  );
  const obj = slot >= 0 ? state.runeEnv.slotObject(slot) : null;

  /* Select the brand */
  const brand = state.rng.oneIn(2) ? "Flame" : "Frost";

  /* Brand the weapon */
  brandObject(ctx, env, obj, brand);

  ctx.ident = true;
  return true;
};

/**
 * EF_BRAND_AMMO: brand some non-magical ammo Flame, Frost or Venom.
 */
const handleBRAND_AMMO: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;

  /* Select the brand */
  const brand = state.rng.oneIn(3)
    ? "Flame"
    : state.rng.oneIn(2)
      ? "Frost"
      : "Venom";

  ctx.ident = true;

  /* Get an item */
  const obj = env.item?.getItem?.(requestForEffect(EF.BRAND_AMMO, 0, state)!);
  if (!obj) return false;

  /* Brand the ammo */
  brandObject(ctx, env, obj, brand);
  return true;
};

/**
 * EF_BRAND_BOLTS: brand some non-magical bolts Flame.
 */
const handleBRAND_BOLTS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  ctx.ident = true;

  /* Get an item */
  const obj = env.item?.getItem?.(
    requestForEffect(EF.BRAND_BOLTS, 0, env.state)!,
  );
  if (!obj) return false;

  /* Brand the bolts */
  brandObject(ctx, env, obj, "Flame");
  return true;
};

/** The shared CURSE_ARMOR / CURSE_WEAPON body. */
function curseWorn(
  ctx: EffectHandlerContext,
  env: GameEffectEnv,
  slotType: string,
  hurt: (obj: GameObject) => void,
  what: string,
): boolean {
  const { state } = env;
  const slot = state.actor.player.body.slots.findIndex(
    (s) => s.type === slotType,
  );
  const obj = slot >= 0 ? state.runeEnv.slotObject(slot) : null;

  /* Nothing to curse */
  if (!obj) return true;

  const name = describeObject(state, obj, ODESC.FULL);

  /* Attempt a saving throw for artifacts */
  if (obj.artifact && state.rng.randint0(100) < 50) {
    say(
      ctx,
      `A terrible black aura tries to surround your ${what}, but your ${name} resists the effects!`,
    );
  } else {
    const curses = env.item?.reg?.curses;
    say(ctx, `A terrible black aura blasts your ${name}!`);

    /* Take down bonus a wee bit */
    hurt(obj);

    /* Try to find enough appropriate curses */
    if (curses) {
      let num = state.rng.randint1(3);
      let maxTries = 20;
      while (num && maxTries) {
        const pick = state.rng.randint1(curses.length - 1);
        const power = 10 * state.rng.mBonus(9, state.chunk.depth);
        if (!curses[pick]?.poss[obj.tval]) {
          maxTries--;
          continue;
        }
        appendObjectCurse(state.rng, obj, pick, power, curses);
        num--;
      }
    }

    /* Recalculate bonuses (PU_BONUS | PU_MANA); weight upkeep rides gear. */
    state.updateBonuses?.();
  }

  ctx.ident = true;
  return true;
}

/**
 * EF_CURSE_ARMOR: a terrible black aura blasts the body armour.
 */
const handleCURSE_ARMOR: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  return curseWorn(
    ctx,
    env,
    "BODY_ARMOR",
    (obj) => {
      obj.toA -= env.state.rng.randint1(3);
    },
    "armor",
  );
};

/**
 * EF_CURSE_WEAPON: a terrible black aura blasts the wielded weapon.
 */
const handleCURSE_WEAPON: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  return curseWorn(
    ctx,
    env,
    "WEAPON",
    (obj) => {
      obj.toH = 0 - env.state.rng.randint1(3);
      obj.toD = 0 - env.state.rng.randint1(3);
    },
    "weapon",
  );
};

/**
 * EF_CREATE_ARROWS: turn a staff into arrows (better staves make better
 * arrows).
 */
const handleCREATE_ARROWS: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;

  /* Get an item */
  const obj = env.item?.getItem?.(requestForEffect(EF.CREATE_ARROWS, 0, state)!);
  if (!obj) return false;

  /* Extract the object "level" */
  const lev = obj.kind.level;

  /* Roll for good */
  let good = false;
  let great = false;
  if (state.rng.randint1(lev) > 25) {
    good = true;
    /* Roll for great */
    if (state.rng.randint1(lev) > 50) great = true;
  }

  /* Destroy the staff */
  destroyOneItem(state, obj);

  /* Make some arrows */
  if (env.item?.makeDeps) {
    const arrows = makeObject(
      state.rng,
      env.item.makeDeps,
      state.actor.player.lev,
      good,
      great,
      false,
      TV.ARROW,
      state.chunk.depth,
    );
    if (arrows) dropNear(state, arrows, 0, state.actor.grid, true);
  }

  return true;
};

/**
 * EF_TAP_DEVICE: drain a wand or staff's charges into mana.
 */
const handleTAP_DEVICE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  const p = state.actor.player;
  let used = false;

  /* Get an item */
  const obj = env.item?.getItem?.(requestForEffect(EF.TAP_DEVICE, 0, state)!);
  if (!obj) return false;

  /* Extract the object "level" and its energy. */
  const lev = obj.kind.level;
  let energy = 0;
  let item = "";
  if (tvalIsStaff(obj.tval)) {
    energy = Math.trunc(((5 + lev) * 3 * obj.pval) / 2);
    item = "staff";
  } else if (tvalIsWand(obj.tval)) {
    energy = Math.trunc(((5 + lev) * 3 * obj.pval) / 2);
    item = "wand";
  }

  /* Turn energy into mana. */
  if (energy < 36) {
    /* Require a reasonable amount of energy */
    say(ctx, `That ${item} had no useable energy`);
  } else if (p.csp < p.msp) {
    /* Drain the object. */
    obj.pval = 0;

    /* Increase mana. */
    p.csp += Math.trunc(energy / 6);
    p.cspFrac = 0;
    if (p.csp > p.msp) p.csp = p.msp;

    say(ctx, "You feel your head clear.");
    used = true;
    const stun = state.rng.randint1(2);
    ctx.env.player?.timed?.incTimed(
      TMD.STUN,
      stun,
      true,
      ctx.origin.what !== "player" || !ctx.aware,
      true,
    );
  } else {
    const cap = item.charAt(0).toUpperCase() + item.slice(1);
    say(ctx, `Your mana was already at its maximum.  ${cap} not drained.`);
  }

  return used;
};

/**
 * EF_ACQUIRE: conjure `value` great objects out of thin air (acquirement,
 * obj-make.c L1240).
 */
const handleACQUIRE: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  let num = effectCalculateValue(ctx, false);
  ctx.ident = true;
  if (!env.item?.makeDeps) return true;

  while (num-- > 0) {
    /* Make a good (or great) object (if possible) */
    const nice = makeObject(
      state.rng,
      env.item.makeDeps,
      state.chunk.depth,
      true,
      true,
      true,
      0,
      state.chunk.depth,
    );
    if (!nice) continue;

    nice.origin = ORIGIN.ACQUIRE;
    nice.originDepth = state.chunk.depth;

    /* Drop the object */
    dropNear(state, nice, 0, state.actor.grid, true);
  }
  return true;
};

/**
 * EF_IDENTIFY (effect-handler-general.c L1945): learn one random unknown
 * rune of a chosen not-fully-known item (object_learn_unknown_rune over the
 * rune list). Cancelling (or no chooser wired) leaves the effect unused.
 */
const handleIDENTIFY: EffectHandler = (ctx) => {
  const env = gameEnv(ctx);
  if (!env) return true;
  const { state } = env;
  ctx.ident = true;

  const runes = buildRuneList(state.runeEnv);
  const player = state.actor.player;

  /* Get an item (item_tester_unknown: not all runes known). */
  const obj =
    env.item?.getItem?.(requestForEffect(EF.IDENTIFY, 0, state)!) ?? null;
  if (!obj) return false;

  /* Identify the object. */
  objectLearnUnknownRune(state.rng, player, state.runeEnv, obj, runes);
  return true;
};

/** The item-targeting handlers, keyed by upstream EF code. */
const ITEM_HANDLERS: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  [EF.ENCHANT, handleENCHANT],
  [EF.RECHARGE, handleRECHARGE],
  [EF.REMOVE_CURSE, handleREMOVE_CURSE],
  [EF.BRAND_WEAPON, handleBRAND_WEAPON],
  [EF.BRAND_AMMO, handleBRAND_AMMO],
  [EF.BRAND_BOLTS, handleBRAND_BOLTS],
  [EF.CURSE_ARMOR, handleCURSE_ARMOR],
  [EF.CURSE_WEAPON, handleCURSE_WEAPON],
  [EF.CREATE_ARROWS, handleCREATE_ARROWS],
  [EF.TAP_DEVICE, handleTAP_DEVICE],
  [EF.ACQUIRE, handleACQUIRE],
  [EF.IDENTIFY, handleIDENTIFY],
]);

/**
 * Register the item-targeting handlers, overriding the stubs
 * registerCoreHandlers installed. Call after registerCoreHandlers. Each
 * handler reads its game environment from context.env.game (attach it with
 * attachGameEnv) and no-ops when it is absent.
 */
export function registerItemHandlers(registry: EffectRegistry): void {
  for (const [code, handler] of ITEM_HANDLERS) {
    registry.register(code, { handler, status: "implemented" });
  }
}

/** The item-targeting EF codes this module registers. */
export const ITEM_HANDLER_CODES: readonly number[] = [...ITEM_HANDLERS.keys()];
