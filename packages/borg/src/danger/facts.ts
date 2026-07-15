/**
 * MonsterFacts: the exact r_info[] + borg_kill fields the danger evaluator reads
 * about a monster's race, gathered into one struct so the damage math can be a
 * faithful, testable port independent of where the data comes from.
 *
 * THE r_info GAP. Upstream borg_danger reads the full monster_race record
 * (r_ptr->blow[], r_ptr->spell_power, r_ptr->freq_innate / freq_spell,
 * r_ptr->sleep, r_ptr->friends, r_ptr->flags, r_ptr->level). The Borg only sees
 * the world through the frozen AgentView, whose MonsterView exposes raceFlags
 * (RF_*), spellFlags (RSF_*), level and speed - but NOT blows, spell_power,
 * spell frequency, sleep, or friends. The default resolver below therefore
 * derives what it can from MonsterView and the tracked borg_kill, and falls back
 * to faithful defaults for the rest (see resolveMonsterFacts). P8.6 wires perceive
 * to a real monster-race registry and can inject an exact resolver via
 * setFactsResolver on the per-world danger state, at which point the numbers
 * match upstream verbatim with no change to the math here.
 */

import { RSF } from "@neo-angband/core";
import type { BorgContext } from "../context";
import type { BorgKill } from "../world/kill";
import { MONBLOW } from "./tables";

/** One melee blow of a race (r_ptr->blow[k]): dice/sides and its MONBLOW kind. */
export interface BlowFacts {
  dice: number;
  sides: number;
  effect: MONBLOW;
}

/** The race-derived data borg_danger reads about a monster (see file header). */
export interface MonsterFacts {
  /** r_idx. */
  rIdx: number;
  /** RF_* codes present on the race (r_ptr->flags). */
  flags: ReadonlySet<string>;
  /** r_ptr->level. */
  level: number;
  /** r_ptr->sleep (alertness; higher == lighter sleeper). */
  sleep: number;
  /** r_ptr->spell_power (scales many spell/breath estimates). */
  spellPower: number;
  /** r_ptr->freq_innate (0..100). */
  freqInnate: number;
  /** r_ptr->freq_spell (0..100). */
  freqSpell: number;
  /** r_ptr->friends || r_ptr->friends_base. */
  hasFriends: boolean;
  /** r_ptr->blow[] (physical attacks). */
  blows: readonly BlowFacts[];
  /**
   * kill->spell[]: the RSF_* ordinals this monster can use, in ascending RSF
   * order (matching the C's RSF_NONE+1..RSF_MAX preload loop). Length is
   * kill->ranged_attack.
   */
  spells: readonly number[];
}

/** rf_has(facts.flags, "NAME"): does the race carry an RF_ flag. */
export function factHasFlag(facts: MonsterFacts, name: string): boolean {
  return facts.flags.has(name);
}

/** A resolver maps a tracked kill index to its MonsterFacts. */
export type FactsResolver = (ctx: BorgContext, killIndex: number) => MonsterFacts;

/**
 * The default resolver: build MonsterFacts from the tracked borg_kill plus the
 * matching MonsterView (when the monster is currently visible). Fields absent
 * from the frozen agent contract fall back to faithful borg_init-style defaults
 * (documented per field). Injecting a real resolver (setFactsResolver) restores
 * exact upstream numbers.
 */
export function defaultResolveMonsterFacts(ctx: BorgContext, killIndex: number): MonsterFacts {
  const kill: BorgKill = ctx.world.kills.at(killIndex);

  /* Find the live MonsterView for this kill (by game m_idx). */
  let mv: { raceFlags: string[]; spellFlags: string[]; level: number } | undefined;
  for (const m of ctx.view.monsters()) {
    if (m.id === kill.mIdx) {
      mv = m;
      break;
    }
  }

  const flags = new Set<string>(mv ? mv.raceFlags : []);
  const level = mv ? mv.level : kill.level;

  /* Derive the ranged-attack spell list from spellFlags, ascending RSF order
   * (borg_update_kill: for k in RSF_NONE+1..RSF_MAX if rsf_has -> kill->spell). */
  const spells = deriveSpellList(mv ? mv.spellFlags : []);

  return {
    rIdx: kill.rIdx,
    flags,
    level,
    /* GAP: r_ptr->sleep not on MonsterView; 0 == "never asleep" default. */
    sleep: 0,
    /* GAP: r_ptr->spell_power not on MonsterView; upstream defaults it to level. */
    spellPower: level,
    /* GAP: freq not on MonsterView; 0 makes borg_danger_spell treat the monster
     * as "never casts" (v2 == 0). Inject a real resolver for spell danger. */
    freqInnate: 0,
    freqSpell: 0,
    /* GAP: r_ptr->friends not on MonsterView. */
    hasFriends: false,
    /* GAP: r_ptr->blow[] not on MonsterView; no blows -> physical danger 0.
     * Inject a real resolver for melee danger. */
    blows: [],
    spells,
  };
}

/**
 * Map a set of RSF_* names (MonsterView.spellFlags) to their RSF ordinals in
 * ascending order, mirroring the upstream preload loop that fills kill->spell.
 */
export function deriveSpellList(spellFlagNames: readonly string[]): number[] {
  const rsf = RSF as unknown as Record<string, number>;
  const out: number[] = [];
  for (const name of spellFlagNames) {
    const v = rsf[name];
    if (typeof v === "number" && v > 0) out.push(v);
  }
  out.sort((a, b) => a - b);
  return out;
}
