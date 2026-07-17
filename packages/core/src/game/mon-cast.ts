/**
 * do_mon_spell, ported from reference/src/mon-spell.c (Angband 4.2.6): a
 * monster casts a spell by RSF_ index. This is the convergence point of the
 * whole projection -> effect stack - it looks up the bound spell, rolls the
 * hit, and runs the spell's effect chain through the effect interpreter with a
 * monster source and the live game environment, so every attack / status /
 * teleport handler already registered fires against the real GameState.
 *
 * It lives in game/ (not mon/) because it drives effect_do, and effects/ sits
 * above mon/ in the layering (effects/effect.ts imports mon/timed); do_mon_spell
 * composes the interpreter, the effect environment and the projection cast
 * context, all of which are game-layer concerns.
 *
 * The record -> Effect chain conversion goes through EffectBuilder: bindSpells
 * (mon/bind.ts) stores each spell effect's expr directives separately from the
 * parsed dice, so the chain must be rebuilt so the builder applies dice then
 * expr (binding SPELL_POWER / MAX_SIGHT). The spell message, the disturb, and
 * the fail-rune learning are injected hooks (UI / lore, #24). Summon and
 * shapechange subtypes need their name resolvers injected (mon-summon.c /
 * player shapes); absent, the chain cannot build and the cast fizzles (the
 * summon effect itself is a stub until monster generation lands).
 */

import { EffectBuilder } from "../effects/effect";
import type { Effect, EffectBuilderInjections } from "../effects/effect";
import { sourceMonster } from "../effects/interpreter";
import type { EffectRegistry } from "../effects/interpreter";
import { testHit } from "../combat/hit";
import { checkHit } from "../combat/mon-melee";
import { chanceOfSpellHit } from "../mon/spell";
import type { MonsterSpell } from "../mon/types";
import type { Monster } from "../mon/monster";
import type { Loc } from "../loc";
import { buildEffectContext } from "./effect-env";
import type { EffectEnvDeps } from "./effect-env";
import { attachGameEnv } from "./effect-game-env";
import type { TeleportEnv } from "./effect-teleport";
import type { CastContext } from "./project-cast";
import type { GameState } from "./context";
import { spellMessageText } from "./mon-message";
import { disturb } from "./player-path";
import { ELEM, OF, PF, TMD } from "../generated";
import { equipLearnElement } from "../obj/knowledge";
import { playerIncCheck } from "../player/timed";
import type { PlayerIncCheckQueries } from "../player/timed";
import type { TimedEffect } from "../player/types";

/** Hooks for the UI / lore consequences of casting a monster spell. */
export interface MonSpellHooks {
  /** disturb(player): the player's rest / run is interrupted. */
  disturb?: () => void;
  /** spell_message: describe the cast (seen, whether it hit). */
  message?: (
    mon: Monster,
    spell: MonsterSpell,
    seen: boolean,
    hits: boolean,
  ) => void;
  /** The message shown when the player saves against the spell. */
  saveMessage?: (text: string) => void;
  /** spell_check_for_fail_rune: learn a rune a save implies (lore, #24). */
  failRune?: (spell: MonsterSpell) => void;
  /** A spell whose effect chain could not be built (deferred subtype). */
  unresolved?: (spell: MonsterSpell, err: unknown) => void;
}

/** Everything do_mon_spell needs beyond the state and the spell index. */
export interface DoMonSpellDeps {
  registry: EffectRegistry;
  /** The projection cast context (bound projections, range, player actor). */
  cast: CastContext;
  /** The bound monster spells, keyed by RSF index (MonsterRegistry.spells). */
  spells: ReadonlyMap<number, MonsterSpell>;
  /** EffectEnvDeps for buildEffectContext (the bound timed table, hooks). */
  envDeps: EffectEnvDeps;
  /** player->state.skills[SKILL_SAVE], for the saving throw. */
  saveSkill: number;
  /** Extra subtype / base-value injections (summon, shape, mods). */
  inject?: EffectBuilderInjections;
  /** Teleport-family seams (trap predicates, level change; game/trap.ts). */
  teleport?: TeleportEnv;
  /** General-handler seams (trap access for webs; effect-general.ts). */
  general?: import("./effect-general").GeneralEffectEnv;
  /** Summoning seams (summon table + live placement; effect-summon.ts). */
  summon?: import("./effect-summon").SummonEffectEnv;
  /** MON_TMD_CHANGED shapechange hooks (game/mon-shape.ts). */
  monShape?: import("../mon/timed").MonShapeHooks;
  hooks?: MonSpellHooks;
}

/**
 * Rebuild a spell's effect chain from its bound records so EffectBuilder binds
 * the dice and then the expr directives (SPELL_POWER / MAX_SIGHT). Throws when
 * a subtype cannot be resolved (an uninjected summon / shape name).
 */
export function buildSpellEffectChain(
  spell: MonsterSpell,
  inject: EffectBuilderInjections,
): Effect | null {
  const builder = new EffectBuilder(inject);
  for (const e of spell.effects) {
    let spec = e.eff;
    const hasType = e.type !== null && e.type !== "";
    if (hasType || e.radius || e.other) spec += ":" + (e.type ?? "");
    if (e.radius || e.other) spec += ":" + e.radius;
    if (e.other) spec += ":" + e.other;
    builder.effect(spec);
    if (e.diceRaw) builder.dice(e.diceRaw);
    for (const x of e.exprs) builder.expr(x.name, x.base, x.expr);
  }
  return builder.build();
}

/** The spell_check_for_fail_rune seams (mon-spell.c L291). */
export interface FailRuneEnv {
  /** equip_learn_element(player, ELEM_NEXUS): a save vs teleport-level. */
  learnNexus: () => void;
  /** player_inc_check(player, subtype, false) for an EF_TIMED_INC subtype. */
  incCheck: (timedName: string) => void;
}

/** Everything buildMonSpellHooks needs to wire the UI/lore consequences. */
export interface MonSpellHooksDeps {
  /**
   * projections[type].lash_desc for the {type}/{oftype} message tags, keyed by
   * the projection name the caster's first blow's lash_type resolves to.
   */
  lashDesc?: (projectionName: string) => string | null;
  /** panel_contains for the "(offscreen)" naming tag; default on-screen. */
  panelContains?: (grid: Loc) => boolean;
  /** spell_check_for_fail_rune seams (equip_learn_element + player_inc_check). */
  failRune?: FailRuneEnv;
}

/**
 * spell_check_for_fail_rune (mon-spell.c L291): after the player saves against a
 * spell, learn the object rune that would also have prevented it - ELEM_NEXUS
 * for a teleport-level effect, and the timed-effect foil for each EF_TIMED_INC.
 * The effect names are the bound EF_ names on each spell effect line.
 */
function spellCheckForFailRune(spell: MonsterSpell, env: FailRuneEnv): void {
  for (const e of spell.effects) {
    if (e.eff === "TELEPORT_LEVEL") {
      env.learnNexus();
    } else if (e.eff === "TIMED_INC") {
      env.incCheck(e.type ?? "");
    }
  }
}

/**
 * buildFailRuneEnv: the spell_check_for_fail_rune seams over the live state -
 * equip_learn_element(player, ELEM_NEXUS) for a teleport-level save, and a
 * real player_inc_check(player, subtype, false) (with its own equip-learn side
 * effects) for each EF_TIMED_INC, resolved against the bound timed table and
 * the derived player state. Mirrors the query construction the lore layer uses
 * (game/lore-color.ts); absent derived state, the queries read as "nothing".
 */
export function buildFailRuneEnv(
  state: GameState,
  timedTable: readonly TimedEffect[],
): FailRuneEnv {
  const p = state.actor.player;
  const queries: PlayerIncCheckQueries = {
    objectFlag: (name): boolean => {
      const i = (OF as Record<string, number>)[name];
      return i !== undefined && (state.playerState?.flags.has(i) ?? false);
    },
    resistLevel: (name): number => {
      const i = (ELEM as Record<string, number>)[name];
      return i !== undefined
        ? (state.playerState?.elInfo[i]?.resLevel ?? 0)
        : 0;
    },
    playerFlag: (name): boolean => {
      const i = (PF as Record<string, number>)[name];
      return i !== undefined && (state.playerState?.pflags.has(i) ?? false);
    },
    timedActive: (name): boolean => {
      const i = (TMD as Record<string, number>)[name];
      return i !== undefined && (p.timed[i] ?? 0) > 0;
    },
  };
  const byIndex = new Map<number, TimedEffect>();
  for (const e of timedTable) byIndex.set(e.index, e);
  return {
    learnNexus: (): void => {
      equipLearnElement(p, state.runeEnv, ELEM.NEXUS);
    },
    incCheck: (timedName): void => {
      const idx = (TMD as Record<string, number>)[timedName];
      if (idx === undefined) return;
      const eff = byIndex.get(idx);
      if (eff) playerIncCheck(eff, queries);
    },
  };
}

/**
 * buildMonSpellHooks: assemble the MonSpellHooks do_mon_spell fires - the
 * disturb (mon-spell.c L368), the cast message (spell_message, L369), the
 * saving-throw message and its fail-rune learning (L382-383). Installed via
 * installMonsterCasting so a monster's cast actually announces itself and, on a
 * save, teaches the runes upstream would.
 */
export function buildMonSpellHooks(
  state: GameState,
  deps: MonSpellHooksDeps = {},
): MonSpellHooks {
  return {
    /* disturb(player): a cast interrupts the player's rest / run (L368). */
    disturb: () => disturb(state),
    /* spell_message (L369): the seen/blind/miss cast line. */
    message: (mon, spell, seen, hits): void => {
      const targetMon =
        mon.target.midx > 0 ? (state.monsters[mon.target.midx] ?? null) : null;
      const out = spellMessageText(mon, spell, seen, hits, {
        targetMon,
        ...(deps.panelContains ? { panelContains: deps.panelContains } : {}),
        ...(deps.lashDesc ? { lashDesc: deps.lashDesc } : {}),
      });
      if (out) state.msg?.(out.text);
    },
    /* The save message (L382). */
    saveMessage: (text): void => state.msg?.(text),
    /* spell_check_for_fail_rune (L383): learn the foil rune on a save. */
    ...(deps.failRune
      ? { failRune: (spell): void => spellCheckForFailRune(spell, deps.failRune!) }
      : {}),
  };
}

/**
 * do_mon_spell: process a monster spell (RSF_ index) cast by monster `midx`.
 * Returns whether a real spell was processed (false only when the spell or the
 * caster is missing).
 */
export function doMonSpell(
  state: GameState,
  midx: number,
  spellIndex: number,
  seen: boolean,
  deps: DoMonSpellDeps,
): boolean {
  const spell = deps.spells.get(spellIndex);
  const mon = state.monsters[midx];
  if (!spell || !mon) return false;

  /* See if it hits. A monster may be aiming at another monster (target.midx). */
  const targetMidx = mon.target.midx;
  let hits: boolean;
  if (spell.hit === 100) {
    hits = true;
  } else if (spell.hit === 0) {
    hits = false;
  } else if (targetMidx > 0) {
    const tmon = state.monsters[targetMidx];
    hits = tmon
      ? testHit(state.rng, chanceOfSpellHit(mon, spell), tmon.race.ac)
      : false;
  } else {
    hits = checkHit(state.rng, chanceOfSpellHit(mon, spell), state.actor.defense);
  }

  /* Tell the player what is going on. */
  deps.hooks?.disturb?.();
  deps.hooks?.message?.(mon, spell, seen, hits);

  if (!hits) return true;

  /* Get the right power-level of save message for this caster. */
  let level = spell.levels[0]!;
  for (let i = 1; i < spell.levels.length; i++) {
    const next = spell.levels[i]!;
    if (mon.race.spellPower >= next.power) level = next;
    else break;
  }

  /* Try a saving throw, if the spell offers one and the target is the player. */
  if (
    level.saveMessage &&
    targetMidx <= 0 &&
    state.rng.randint0(100) < deps.saveSkill
  ) {
    deps.hooks?.saveMessage?.(level.saveMessage);
    deps.hooks?.failRune?.(spell);
    return true;
  }

  /* Build the effect chain (per cast, so SPELL_POWER binds this caster). */
  const inject: EffectBuilderInjections = {
    ...deps.inject,
    baseValues: {
      SPELL_POWER: () => mon.race.spellPower,
      MAX_SIGHT: () => state.z.maxSight,
      ...deps.inject?.baseValues,
    },
  };

  let chain: Effect | null;
  try {
    chain = buildSpellEffectChain(spell, inject);
  } catch (err) {
    /* An uninjected summon / shape subtype: the cast fizzles (deferred). */
    deps.hooks?.unresolved?.(spell, err);
    return true;
  }

  const ctx = attachGameEnv(buildEffectContext(state, deps.envDeps), {
    state,
    cast: deps.cast,
    monCurrent: midx,
    ...(deps.envDeps.takeHitHooks
      ? { takeHitHooks: deps.envDeps.takeHitHooks }
      : {}),
    ...(deps.teleport ? { teleport: deps.teleport } : {}),
    ...(deps.general ? { general: deps.general } : {}),
    ...(deps.summon ? { summon: deps.summon } : {}),
    ...(deps.monShape ? { monShape: deps.monShape } : {}),
  });

  deps.registry.effectDo(chain, ctx, {
    origin: sourceMonster(midx),
    aware: true,
  });
  return true;
}
