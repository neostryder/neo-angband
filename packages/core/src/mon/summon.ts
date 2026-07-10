/**
 * Monster summon types, ported from reference/src/mon-summon.c (Angband
 * 4.2.6): the summon table built from summon.txt (here the already-parsed
 * summon.json records bound by bindMonsters) and the race-eligibility
 * predicate summon_specific_okay.
 *
 * This module is the world-free half of mon-summon.c: the table lookups
 * (summon_name_to_idx, summon_message_type, summon_fallback_type,
 * summon_desc) and the "okay" test. The placement half (summon_specific,
 * call_monster, select_shape) needs the live cave and lives in
 * game/mon-place.ts.
 *
 * Divergences by design:
 * - The upstream file-static summon_specific_type / kin_base globals become
 *   explicit parameters (type is passed to okay(); the kin base is captured
 *   by the caller from the summoner's race), so concurrent interpreters
 *   cannot trample each other.
 * - message_type stays the msgt NAME (sound/message channels ride #26/#25);
 *   upstream resolves it to a message index at parse time.
 */

import { RF } from "../generated";
import type { MonsterBase, MonsterRace, SummonType } from "./types";

/** One bound summon type (struct summon, resolved). */
export interface BoundSummon {
  /** Position in the table (the EF_SUMMON subtype value). */
  index: number;
  name: string;
  /** The message type NAME (msgt:); sound dispatch rides #26. */
  messageType: string;
  /** uniques: whether uniques may answer this summon. */
  uniqueAllowed: boolean;
  /** base: allowed monster bases (empty = no base restriction). */
  bases: readonly MonsterBase[];
  /** race-flag: required RF_ flag (0 = none). */
  raceFlag: number;
  /** fallback: the summon type used when this one fails (-1 = none). */
  fallback: number;
  desc: string;
}

/**
 * The bound summon table (finish_parse_summon). Records bind in file order,
 * matching the upstream reversed-linked-list copy, so a record's array
 * position is its upstream summon index.
 */
export class SummonTable {
  readonly kinds: BoundSummon[];

  constructor(
    records: readonly SummonType[],
    bases: ReadonlyMap<string, MonsterBase>,
  ) {
    this.kinds = records.map((rec, index) => {
      const bound: MonsterBase[] = [];
      for (const name of rec.baseNames) {
        const base = bases.get(name);
        if (!base) throw new Error(`summon: unknown monster base ${name}`);
        bound.push(base);
      }
      let raceFlag = 0;
      if (rec.raceFlag) {
        const value = (RF as Record<string, number>)[rec.raceFlag];
        if (value === undefined || value === 0) {
          throw new Error(`summon: bad race flag ${rec.raceFlag}`);
        }
        raceFlag = value;
      }
      return {
        index,
        name: rec.name,
        messageType: rec.msgt,
        uniqueAllowed: rec.uniquesAllowed,
        bases: bound,
        raceFlag,
        fallback: -1,
        desc: rec.desc,
      };
    });
    /* Add indices of fallback summons (finish_parse_summon). */
    for (let i = 0; i < this.kinds.length; i++) {
      const name = records[i]!.fallbackName;
      this.kinds[i]!.fallback = name ? this.nameToIdx(name) : -1;
    }
  }

  /** summon_name_to_idx: the index for a summon name, or -1. */
  nameToIdx(name: string): number {
    for (const kind of this.kinds) {
      if (kind.name === name) return kind.index;
    }
    return -1;
  }

  /** summon_message_type: the msgt name for a summon type. */
  messageType(type: number): string {
    return this.kinds[type]?.messageType ?? "";
  }

  /** summon_fallback_type: the fallback index for a summon type (-1 none). */
  fallbackType(type: number): number {
    return this.kinds[type]?.fallback ?? -1;
  }

  /** summon_desc: the description for a summon type. */
  desc(type: number): string {
    return this.kinds[type]?.desc ?? "";
  }
}

/**
 * summon_specific_okay: whether a race may answer a summon of the given
 * type. `kinBase` is the summoner's race base, read only by the KIN type
 * (upstream's kin_base global, made a parameter).
 */
export function summonSpecificOkay(
  table: SummonTable,
  type: number,
  race: MonsterRace,
  kinBase: MonsterBase | null,
): boolean {
  const summon = table.kinds[type];
  if (!summon) return false;
  const unique = race.flags.has(RF.UNIQUE);

  /* Forbid uniques? */
  if (!summon.uniqueAllowed && unique) return false;

  /* A valid base and no match means disallowed. */
  if (summon.bases.length > 0 && !summon.bases.some((b) => b === race.base)) {
    return false;
  }

  /* A valid race flag and no match means disallowed. */
  if (summon.raceFlag && !race.flags.has(summon.raceFlag)) return false;

  /* Special case - summon kin. */
  if (type === table.nameToIdx("KIN")) {
    return !unique && race.base === kinBase;
  }

  /* If we made it here, we're fine. */
  return true;
}
