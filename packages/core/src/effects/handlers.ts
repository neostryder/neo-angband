/**
 * Effect handlers, ported from reference/src/effect-handler-general.c and
 * effect-handler-attack.c (Angband 4.2.6).
 *
 * This is the interpreter-skeleton wave: only handlers whose C bodies are
 * meaningful without the world/entity domains are implemented, against
 * the narrow interfaces of interpreter.ts. Every other upstream code is
 * registered as a NOT_IMPLEMENTED stub that records its invocation into
 * context.env.stubLog, so dispatch coverage is measurable and later
 * waves replace stubs one by one. EFFECT_HANDLER_MANIFEST lists the
 * split; parity/ledger/effects-interpreter.yaml mirrors it.
 *
 * Worldless no-op rule: an implemented handler that finds its player
 * slot absent returns true without acting (upstream would have
 * dereferenced a global that always exists there).
 */

import { EF, EFFECT_ENTRIES, TMD } from "../generated";
import type {
  EffectHandler,
  EffectHandlerContext,
  EffectRegistry,
} from "./interpreter";
import { effectCalculateValue } from "./interpreter";

/** can_disturb / lore argument used all over the timed calls. */
function notPlayerOrUnaware(context: EffectHandlerContext): boolean {
  return context.origin.what !== "player" || !context.aware;
}

function msg(context: EffectHandlerContext, text: string): void {
  context.env.messages?.msg(text);
}

/* ------------------------------------------------------------------ *
 * Implemented handlers.
 * ------------------------------------------------------------------ */

/**
 * EF_RANDOM: dummy; effect_do performs the actual selection and this
 * handler is never reached through a chain (kept for direct dispatch
 * parity with the upstream table).
 */
const handleRANDOM: EffectHandler = () => true;

/** EF_SELECT: dummy, as EF_RANDOM. */
const handleSELECT: EffectHandler = () => true;

/**
 * EF_DAMAGE: deal damage from the origin to the player.
 * Partial: the monster-origin branches that damage a targeted monster or
 * destroy a decoy need the monster/world domains and are deferred; killer
 * descriptions for monster/trap/object/chest origins need their
 * registries and use placeholders until then.
 */
const handleDAMAGE: EffectHandler = (context) => {
  let dam = effectCalculateValue(context, false);

  /* Always ID */
  context.ident = true;

  let killer: string;
  switch (context.origin.what) {
    case "monster":
      /* t_mon / decoy branches deferred (world domain). */
      killer = "a monster";
      break;
    case "trap":
      killer = "a trap";
      break;
    case "object":
      /* Must be a cursed weapon */
      killer = "an object";
      break;
    case "chestTrap":
      killer = "a chest trap";
      break;
    case "player":
      killer = context.msg ?? "yourself";
      break;
    case "none":
      killer = "a bug";
      break;
  }

  const player = context.env.player;
  if (!player || !player.takeHit) return true;

  /* Hit the player */
  if (player.applyDamageReduction) {
    dam = player.applyDamageReduction(dam);
  }
  if (dam && context.env.showDamage) {
    msg(context, `You take ${dam} damage.`);
  }
  player.takeHit(dam, killer);

  return true;
};

/**
 * EF_HEAL_HP: heal by a percentage of wounds (value.m_bonus) or a
 * minimum amount (base + XdY), whichever is larger.
 */
const handleHEAL_HP: EffectHandler = (context) => {
  /* Always ID */
  context.ident = true;

  const hp = context.env.player?.hp;
  if (!hp) return true;

  /* No healing needed */
  if (hp.chp >= hp.mhp) return true;

  /* Figure percentage healing level */
  let num = Math.trunc(((hp.mhp - hp.chp) * context.value.mBonus) / 100);

  /* Enforce minimum */
  const minh =
    context.value.base +
    context.env.rng.damroll(context.value.dice, context.value.sides);
  if (num < minh) num = minh;
  if (num <= 0) return true;

  /* Gain hitpoints, enforce maximum */
  hp.chp += num;
  if (hp.chp >= hp.mhp) {
    hp.chp = hp.mhp;
    hp.chpFrac = 0;
  }

  /* Print a nice message */
  if (num < 5) msg(context, "You feel a little better.");
  else if (num < 15) msg(context, "You feel better.");
  else if (num < 35) msg(context, "You feel much better.");
  else msg(context, "You feel very good.");

  return true;
};

/** EF_NOURISH: feed the player or set their satiety level. */
const handleNOURISH: EffectHandler = (context) => {
  let amount = effectCalculateValue(context, false);
  amount *= context.env.foodValue ?? 100; /* z_info->food_value */

  const timed = context.env.player?.timed;
  if (!timed) {
    context.ident = true;
    return true;
  }
  const disturb = notPlayerOrUnaware(context);

  if (context.subtype === 0) {
    /* Increase food level by amount */
    timed.incTimed(TMD.FOOD, Math.max(amount, 0), false, disturb, false);
  } else if (context.subtype === 1) {
    /* Decrease food level by amount */
    timed.decTimed(TMD.FOOD, Math.max(amount, 0), false, disturb);
  } else if (context.subtype === 2) {
    /* Set food level to amount, vomiting if necessary */
    const message = timed.timed(TMD.FOOD) > amount;
    if (message) msg(context, "You vomit!");
    timed.setTimed(TMD.FOOD, Math.max(amount, 0), false, disturb);
  } else if (context.subtype === 3) {
    /* Increase food level to amount if needed */
    if (timed.timed(TMD.FOOD) < amount) {
      timed.setTimed(TMD.FOOD, Math.max(amount + 1, 0), false, disturb);
    }
  } else {
    return false;
  }
  context.ident = true;
  return true;
};

/** EF_CRUNCH. */
const handleCRUNCH: EffectHandler = (context) => {
  if (context.env.rng.oneIn(2)) msg(context, "It's crunchy.");
  else msg(context, "It nearly breaks your tooth!");
  context.ident = true;
  return true;
};

/** EF_CURE: cure a player status condition. */
const handleCURE: EffectHandler = (context) => {
  const timed = context.env.player?.timed;
  if (timed) {
    timed.clearTimed(context.subtype, true, notPlayerOrUnaware(context));
  }
  context.ident = true;
  return true;
};

/** EF_TIMED_SET: set a (positive or negative) player status condition. */
const handleTIMED_SET: EffectHandler = (context) => {
  const amount = effectCalculateValue(context, false);
  const timed = context.env.player?.timed;
  if (timed) {
    timed.setTimed(
      context.subtype,
      Math.max(amount, 0),
      true,
      notPlayerOrUnaware(context),
    );
  }
  context.ident = true;
  return true;
};

/**
 * EF_TIMED_INC: extend a player status condition; if context.other is
 * set, increase by that amount when the player already has the status.
 * Partial: the decoy-destruction and monster-target branches need the
 * world/monster domains and are deferred.
 */
const handleTIMED_INC: EffectHandler = (context) => {
  const amount = effectCalculateValue(context, false);

  context.ident = true;

  /* Decoy / targeted-monster branches deferred (world domain). */

  const timed = context.env.player?.timed;
  if (!timed) return true;

  const disturb = notPlayerOrUnaware(context);
  if (!timed.timed(context.subtype) || !context.other) {
    timed.incTimed(context.subtype, Math.max(amount, 0), true, disturb, true);
  } else {
    timed.incTimed(context.subtype, context.other, true, disturb, true);
  }
  return true;
};

/** EF_TIMED_INC_NO_RES: as EF_TIMED_INC but unresistable (check=false). */
const handleTIMED_INC_NO_RES: EffectHandler = (context) => {
  const amount = effectCalculateValue(context, false);

  const timed = context.env.player?.timed;
  if (timed) {
    const disturb = notPlayerOrUnaware(context);
    if (!timed.timed(context.subtype) || !context.other) {
      timed.incTimed(
        context.subtype,
        Math.max(amount, 0),
        true,
        disturb,
        false,
      );
    } else {
      timed.incTimed(context.subtype, context.other, true, disturb, false);
    }
  }
  context.ident = true;
  return true;
};

/**
 * EF_TIMED_DEC: reduce a player status condition; if context.other is
 * set, decrease by the current value / context.other.
 */
const handleTIMED_DEC: EffectHandler = (context) => {
  let amount = effectCalculateValue(context, false);
  const timed = context.env.player?.timed;
  if (timed) {
    if (context.other) {
      amount = Math.trunc(timed.timed(context.subtype) / context.other);
    }
    timed.decTimed(
      context.subtype,
      Math.max(amount, 0),
      true,
      notPlayerOrUnaware(context),
    );
  }
  context.ident = true;
  return true;
};

/**
 * EF_SET_VALUE: fix the value for subsequent effects in the chain.
 * Quirk kept from upstream: effect_calculate_value returns the already
 * set value when one is active, so a second SET_VALUE while one is in
 * force re-asserts the old value instead of rolling its own dice.
 */
const handleSET_VALUE: EffectHandler = (context) => {
  context.shared.value = effectCalculateValue(context, false);
  return true;
};

/** EF_CLEAR_VALUE: clear a value set by EF_SET_VALUE. */
const handleCLEAR_VALUE: EffectHandler = (context) => {
  context.shared.value = 0;
  return true;
};

/* ------------------------------------------------------------------ *
 * Stubs and registration.
 * ------------------------------------------------------------------ */

/**
 * A NOT_IMPLEMENTED stub: records the dispatch (so tests and callers can
 * assert the machinery works) and reports completion, leaving ident
 * untouched.
 */
function makeStub(code: number, name: string): EffectHandler {
  return (context) => {
    context.env.stubLog?.push({
      code,
      name,
      value: { ...context.value },
      subtype: context.subtype,
      radius: context.radius,
      other: context.other,
      y: context.y,
      x: context.x,
      dir: context.dir,
      beam: context.beam,
      boost: context.boost,
    });
    return true;
  };
}

const IMPLEMENTED: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  [EF.RANDOM, handleRANDOM],
  [EF.SELECT, handleSELECT],
  [EF.HEAL_HP, handleHEAL_HP],
  [EF.NOURISH, handleNOURISH],
  [EF.CRUNCH, handleCRUNCH],
  [EF.CURE, handleCURE],
  [EF.TIMED_SET, handleTIMED_SET],
  [EF.TIMED_INC_NO_RES, handleTIMED_INC_NO_RES],
  [EF.TIMED_DEC, handleTIMED_DEC],
  [EF.SET_VALUE, handleSET_VALUE],
  [EF.CLEAR_VALUE, handleCLEAR_VALUE],
]);

/** Handlers whose C body is only partially portable this wave. */
const PARTIAL: ReadonlyMap<number, EffectHandler> = new Map<
  number,
  EffectHandler
>([
  [EF.DAMAGE, handleDAMAGE],
  [EF.TIMED_INC, handleTIMED_INC],
]);

function nameOf(code: number): string {
  return (EFFECT_ENTRIES[code - 1] as { name: string }).name;
}

/**
 * Register every upstream effect code: implemented and partial handlers
 * where available, recording stubs for the rest. aim/info/desc metadata
 * comes from the generated list-effects.h columns.
 */
export function registerCoreHandlers(registry: EffectRegistry): void {
  for (let code = 1; code < EFFECT_ENTRIES.length + 1; code++) {
    const implemented = IMPLEMENTED.get(code);
    const partial = PARTIAL.get(code);
    if (implemented) {
      registry.register(code, { handler: implemented, status: "implemented" });
    } else if (partial) {
      registry.register(code, { handler: partial, status: "partial" });
    } else {
      registry.register(code, {
        handler: makeStub(code, nameOf(code)),
        status: "stub",
      });
    }
  }
}

/**
 * Implemented vs stubbed coverage, by upstream name, for the parity
 * ledger and future agents.
 */
export const EFFECT_HANDLER_MANIFEST = {
  implemented: [...IMPLEMENTED.keys()].map(nameOf).sort(),
  partial: [...PARTIAL.keys()].map(nameOf).sort(),
  stubbed: EFFECT_ENTRIES.map((e) => e.name).filter(
    (name) =>
      !IMPLEMENTED.has(EF[name as keyof typeof EF]) &&
      !PARTIAL.has(EF[name as keyof typeof EF]),
  ),
  total: EFFECT_ENTRIES.length,
} as const;
