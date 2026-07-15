/**
 * Host resolver factory: build the BorgResolvers seams from real engine data.
 *
 * The frozen AgentView deliberately omits per-race combat internals (blow[],
 * spell frequency, spell_power, sleep, friends) - a minimal, serializable
 * contract. The Borg is a TRUSTED, in-process mod, so its host CAN read the full
 * monster-race registry and hand the Borg an exact resolver. makeCoreResolvers
 * bridges core's MonsterRace records into the MonsterFacts the danger evaluator
 * needs, so the ported borg_danger math reproduces upstream verbatim instead of
 * running on the conservative zero-state defaults.
 *
 * This lives in the borg package (not a specific host) so web / cli / desktop
 * all wire the Borg the same faithful way. It depends only on @neo-angband/core,
 * which the package already depends on.
 */

import {
  MON_RACE_FLAG_ENTRIES,
  MON_SPELL_ENTRIES,
  type MonsterRace,
} from "@neo-angband/core";
import type { BorgResolvers } from "./think-session";
import type { BlowFacts, FactsResolver, MonsterFacts } from "./danger/facts";
import { defaultResolveMonsterFacts } from "./danger/facts";
import { borgMonBlowEffect } from "./danger/tables";

/** What the host supplies to build real resolvers. */
export interface CoreResolverInput {
  /** The bound monster-race registry (booted.registries...); indexed by ridx. */
  races: readonly MonsterRace[];
}

/** RF_* code names for the set flags in a race flag set (index == RF value). */
function raceFlagNames(race: MonsterRace): Set<string> {
  const out = new Set<string>();
  for (const f of race.flags) {
    const entry = MON_RACE_FLAG_ENTRIES[f];
    if (entry) out.add(entry.name);
  }
  return out;
}

/** RSF_* ordinals the race can cast, ascending (matches the C preload loop). */
function raceSpellOrdinals(race: MonsterRace): number[] {
  const out: number[] = [];
  for (const f of race.spellFlags) {
    // Only real spell entries (index maps to a known RSF_*), skip padding.
    if (MON_SPELL_ENTRIES[f]) out.push(f);
  }
  out.sort((a, b) => a - b);
  return out;
}

/** race.blow[] -> BlowFacts (dice/sides via Dice.randomValue, effect via name). */
function raceBlows(race: MonsterRace): BlowFacts[] {
  return race.blows.map((b) => {
    const rv = b.dice ? b.dice.randomValue() : null;
    return {
      dice: rv ? rv.dice : 0,
      sides: rv ? rv.sides : 0,
      effect: borgMonBlowEffect(b.effect.name),
    };
  });
}

/**
 * Build the resolvers that give the Borg real danger vision. Currently wires the
 * monster-race facts (the high-value fidelity item: without it the Borg sees no
 * melee/spell threat and never flees). Artifact-activation identity and the
 * in-shop signal stay on their conservative defaults until the host has data for
 * them (documented in BorgResolvers).
 */
export function makeCoreResolvers(input: CoreResolverInput): BorgResolvers {
  const byRidx = new Map<number, MonsterRace>();
  for (const r of input.races) byRidx.set(r.ridx, r);

  const resolveMonsterFacts: FactsResolver = (ctx, killIndex): MonsterFacts => {
    const kill = ctx.world.kills.at(killIndex);
    const race = byRidx.get(kill.rIdx);
    // Unknown race (e.g. a mod race the registry lacks): fall back to the
    // MonsterView-derived defaults rather than throwing.
    if (!race) return defaultResolveMonsterFacts(ctx, killIndex);

    return {
      rIdx: race.ridx,
      flags: raceFlagNames(race),
      level: race.level,
      sleep: race.sleep,
      spellPower: race.spellPower,
      freqInnate: race.freqInnate,
      freqSpell: race.freqSpell,
      hasFriends: race.friends.length > 0 || race.friendsBase.length > 0,
      blows: raceBlows(race),
      spells: raceSpellOrdinals(race),
    };
  };

  return { resolveMonsterFacts };
}
