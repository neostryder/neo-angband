/**
 * The danger evaluator's shared mutable state - the faithful analog of the
 * file-scope globals the C borg's danger code read (borg_attacking,
 * borg_fighting_unique, borg_on_glyph, borg_morgoth_position, the
 * borg_*_spell simulation flags, borg_tp_other_*, avoidance, ...).
 *
 * Upstream these are globals set by the fight / defend / magic subsystems while
 * they simulate a maneuver, then read by borg_danger. Those subsystems are
 * ported later (P8.4+); until then every flag defaults to its borg_init zero
 * state (inactive), which is the faithful "no maneuver in progress" value. The
 * fight/think ports set these before calling borgDanger, exactly as the C did.
 *
 * Bundling them into one object (created per Borg via createDangerGlobals) keeps
 * them off true module scope so multiple Borgs / tests do not share state - the
 * same approach BorgWorld takes for the rest of the upstream globals.
 */

import type { FearCaches } from "./fear";
import { defaultResolveMonsterFacts, type FactsResolver } from "./facts";

/** The subset of BORG spell ids the danger physical-blow branches test. */
export const BORG_SPELL = {
  RESTORATION: "RESTORATION",
  REVITALIZE: "REVITALIZE",
  UNHOLY_REPRIEVE: "UNHOLY_REPRIEVE",
  REMEMBRANCE: "REMEMBRANCE",
} as const;
export type BorgSpellId = (typeof BORG_SPELL)[keyof typeof BORG_SPELL];

/** A tracked glyph-of-warding location (track_glyph in borg-flow-glyph.c). */
export interface GlyphLoc {
  x: number;
  y: number;
}

/**
 * The mutable danger-evaluation context. Field names mirror the upstream globals
 * so the port reads the same way. All default inactive/zero (borg_init state).
 */
export interface DangerGlobals {
  /** borg_attacking: the borg is in the middle of resolving its own attack. */
  attacking: boolean;
  /** borg_fighting_unique: currently engaged with a unique monster. */
  fightingUnique: boolean;
  /** borg_create_door: the borg is/plans to be walled in by created doors. */
  createDoor: boolean;
  /** borg_on_glyph: the borg stands on a glyph of warding. */
  onGlyph: boolean;
  /** track_glyph: known glyph-of-warding locations. */
  trackGlyph: GlyphLoc[];
  /** borg_morgoth_position: sitting in the Morgoth "sea of runes". */
  morgothPosition: boolean;
  /** borg_as_position: sitting in the anti-summon "sea of runes". */
  asPosition: boolean;

  /* Simulation flags set while the fight/defend code weighs a maneuver. */
  /** borg_slow_spell: assume the monster is slowed. */
  slowSpell: boolean;
  /** borg_sleep_spell: assume a sleep-1/3 effect is available. */
  sleepSpell: boolean;
  /** borg_sleep_spell_ii: assume a sleep-2 effect is available. */
  sleepSpellIi: boolean;
  /** borg_confuse_spell: assume a confuse effect is available. */
  confuseSpell: boolean;
  /** borg_crush_spell: assume a crush effect is available. */
  crushSpell: boolean;
  /** borg_fear_mon_spell: assume a fear effect is available. */
  fearMonSpell: boolean;

  /** borg_tp_other_index[0..borg_tp_other_n]: kill indices teleported away. */
  tpOtherIndices: number[];

  /** avoidance: the current fear/avoidance threshold (borg-flow.c global). */
  avoidance: number;

  /** borg_items[INVEN_LIGHT].timeout: torch fuel remaining (EAT_LIGHT branch). */
  lightTimeout: number;
  /** of_has(borg_items[INVEN_LIGHT].flags, OF_NO_FUEL): a fuelless light. */
  lightNoFuel: boolean;

  /** borg_spell_legal(spell): the borg can legally cast the given spell. */
  spellLegal: (spell: BorgSpellId) => boolean;

  /** Live fear caches (borg_fear_region/monsters), consulted by borg_projectable. */
  fearRegion: FearCaches | null;

  /**
   * Resolve a tracked kill index to its MonsterFacts (the r_info + kill data the
   * damage math reads). Defaults to the MonsterView/kill-based resolver; P8.6 can
   * replace it with one backed by a real monster-race registry.
   */
  resolveFacts: FactsResolver;
}

/** Create a fresh danger-globals object in the borg_init zero state. */
export function createDangerGlobals(): DangerGlobals {
  return {
    attacking: false,
    fightingUnique: false,
    createDoor: false,
    onGlyph: false,
    trackGlyph: [],
    morgothPosition: false,
    asPosition: false,
    slowSpell: false,
    sleepSpell: false,
    sleepSpellIi: false,
    confuseSpell: false,
    crushSpell: false,
    fearMonSpell: false,
    tpOtherIndices: [],
    avoidance: 0,
    lightTimeout: 0,
    lightNoFuel: false,
    spellLegal: () => false,
    fearRegion: null,
    resolveFacts: defaultResolveMonsterFacts,
  };
}
