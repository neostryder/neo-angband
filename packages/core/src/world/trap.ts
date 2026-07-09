/**
 * Trap kinds bound from trap.json (upstream lib/gamedata/trap.txt via
 * init.c parse_trap_*), ported from the data half of reference/src/trap.c
 * (Angband 4.2.6). Pure data: the live trap instances and their behaviour
 * live in game/trap.ts (they mutate GameState).
 *
 * The "visibility" line is the kind's power random-value (rolled at
 * placement against trap_level and matched against the SEARCH skill when
 * revealing). Effects stay raw EffectRecordJson chains, built per
 * activation exactly like object effects (game/obj-cmd.ts).
 */

import { FlagSet, flagSize } from "../bitflag";
import { Dice } from "../dice";
import { OF, TRAP_FLAG_ENTRIES, TRF } from "../generated";
import type { RandomValue } from "../rng";
import type { EffectRecordJson } from "../obj/types";

/** TRF_SIZE = FLAG_SIZE(TRF_MAX): byte size of a trap FlagSet. */
export const TRF_SIZE = flagSize(TRAP_FLAG_ENTRIES.length);

/** struct trap_kind. */
export interface TrapKind {
  /** Index in the bound table (t_idx). */
  tidx: number;
  /** Short name ("pit"); lookup_trap matches on desc. */
  name: string;
  /** Longer description used by lookup_trap ("spiked pit"). */
  desc: string;
  glyph: string;
  color: string;
  /** appear: rarity (0 = never placed randomly), min depth, max number. */
  rarity: number;
  minDepth: number;
  maxNum: number;
  /** visibility: the power random-value. */
  power: RandomValue;
  flags: FlagSet;
  effect: EffectRecordJson[];
  effectXtra: EffectRecordJson[];
  /** save: OF_ flag indexes that let the player evade entirely. */
  saveFlags: number[];
  msg: string;
  msgGood: string;
  msgBad: string;
  msgXtra: string;
}

/** trap.json record shape (compiled from trap.txt). */
export interface TrapRecordJson {
  name: { name: string; desc: string };
  graphics: { glyph: string; color: string };
  appear?: { rarity: number; mindepth: number; maxnum: number };
  visibility?: string;
  flags?: string[];
  effect?: EffectRecordJson[];
  "effect-xtra"?: EffectRecordJson[];
  save?: string;
  desc?: string[];
  msg?: string[];
  "msg-good"?: string[];
  "msg-bad"?: string[];
  "msg-xtra"?: string[];
}

function parseTrapFlags(lines: string[] | undefined): FlagSet {
  const flags = new FlagSet(TRF_SIZE);
  if (!lines) return flags;
  for (const line of lines) {
    for (const raw of line.split("|")) {
      const name = raw.trim();
      if (!name) continue;
      const value = (TRF as Record<string, number>)[name];
      if (value === undefined || value === 0) {
        throw new Error(`trap: unknown flag ${name}`);
      }
      flags.on(value);
    }
  }
  return flags;
}

function parsePower(expr: string | undefined): RandomValue {
  if (!expr) return { base: 0, dice: 0, sides: 0, mBonus: 0 };
  const d = new Dice();
  if (!d.parseString(expr)) throw new Error(`trap: bad power "${expr}"`);
  return d.randomValue();
}

function parseSaveFlags(save: string | undefined): number[] {
  if (!save) return [];
  const out: number[] = [];
  for (const raw of save.split("|")) {
    const name = raw.trim();
    if (!name) continue;
    const value = (OF as Record<string, number>)[name];
    if (value === undefined) throw new Error(`trap: unknown save flag ${name}`);
    out.push(value);
  }
  return out;
}

const joined = (lines: string[] | undefined): string =>
  lines ? lines.join("") : "";

/** Bind trap.json records into the trap_kind table (index = t_idx). */
export function bindTraps(records: readonly TrapRecordJson[]): TrapKind[] {
  return records.map((rec, tidx) => ({
    tidx,
    name: rec.name.name,
    desc: rec.name.desc,
    glyph: rec.graphics.glyph,
    color: rec.graphics.color,
    rarity: rec.appear?.rarity ?? 0,
    minDepth: rec.appear?.mindepth ?? 0,
    maxNum: rec.appear?.maxnum ?? 0,
    power: parsePower(rec.visibility),
    flags: parseTrapFlags(rec.flags),
    effect: rec.effect ?? [],
    effectXtra: rec["effect-xtra"] ?? [],
    saveFlags: parseSaveFlags(rec.save),
    msg: joined(rec.msg),
    msgGood: joined(rec["msg-good"]),
    msgBad: joined(rec["msg-bad"]),
    msgXtra: joined(rec["msg-xtra"]),
  }));
}

/** lookup_trap: find a trap kind by its desc (partial match as upstream). */
export function lookupTrap(kinds: readonly TrapKind[], desc: string): TrapKind | null {
  let closest: TrapKind | null = null;
  for (const kind of kinds) {
    if (!kind.name) continue;
    if (kind.desc === desc) return kind;
    if (!closest && kind.desc.includes(desc)) closest = kind;
  }
  return closest;
}
