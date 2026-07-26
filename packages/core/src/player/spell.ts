/**
 * Player spells, ported from reference/src/player-spell.c (Angband 4.2.6)
 * plus the spell-related pieces of player-calcs.c (calc_mana, calc_spells,
 * average_spell_stat) and init.c's write_book_kind (spellbook object kinds
 * are created FROM the class book definitions, exactly as upstream does at
 * class-parse time - object.txt carries no book kinds).
 *
 * This module is pure player/object domain logic: learning, fail chances,
 * mana, book lookups. The cast itself (running a spell's effect chain
 * against the live GameState) lives in game/spell-cmd.ts, the same split as
 * monster spells (mon/spell.ts vs game/mon-cast.ts).
 */

import { TMD, PF, TVAL_ENTRIES } from "../generated";
import type { ObjRegistry } from "../obj/bind";
import type { ObjectKind } from "../obj/types";
import { newElemInfo, newModifiersRv, newOfFlags } from "../obj/types";
import type { GameObject } from "../obj/object";
import type { ClassBook, ClassSpell, MagicRealm, PlayerClass } from "./types";
import type { Player } from "./player";
import { adj_mag_mana, adj_mag_study } from "./calcs";

/* ------------------------------------------------------------------ *
 * Constants and tables.
 * ------------------------------------------------------------------ */

/** PY_SPELL_ flags (player.h). */
export const PY_SPELL = { LEARNED: 0x01, WORKED: 0x02, FORGOTTEN: 0x04 } as const;

/** Stat Table (INT/WIS) -- minimum spell failure rate (player-spell.c L49). */
export const adj_mag_fail: readonly number[] = [
  99, 99, 99, 99, 99, 50, 30, 20, 15, 12, 11, 10, 9, 8, 7, 6, 6, 5, 5, 5, 4, 4,
  4, 4, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0,
];

/** Stat Table (INT/WIS) -- failure rate adjustment (player-spell.c L94). */
export const adj_mag_stat: readonly number[] = [
  -5, -4, -3, -3, -2, -1, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57,
];

const at = (table: readonly number[], i: number): number =>
  table[Math.max(0, Math.min(i, table.length - 1))] ?? 0;

/* ------------------------------------------------------------------ *
 * write_book_kind (init.c L208): spellbook object kinds from class books.
 * ------------------------------------------------------------------ */

/** book-graphics / book-properties records preserved raw by the binder. */
interface BookGraphicsJson {
  glyph: string;
  color: string;
}
interface BookPropertiesJson {
  cost: number;
  common: number;
  minmax: string;
}

function tvalByTextName(name: string): number {
  const idx = TVAL_ENTRIES.findIndex((t) => t.textName === name);
  if (idx < 0) throw new Error(`spell: unknown book tval "${name}"`);
  return idx;
}

/**
 * Create (or find) the object kind for every class book and stamp the
 * numeric tval/sval back onto the bound ClassBook, exactly as upstream
 * creates book kinds at class-parse time. Books shared between classes
 * (e.g. the priest and paladin prayer books) resolve to one kind. Run once
 * per bound registry, BEFORE building the allocation tables, so books
 * generate in the dungeon with their book-properties commonness.
 */
export function registerBookKinds(
  reg: ObjRegistry,
  classes: readonly PlayerClass[],
): void {
  for (const cls of classes) {
    for (const book of cls.magic.books) {
      const tval = tvalByTextName(book.tval);

      /* Check we haven't already made this book. */
      const existing = reg.kinds.find(
        (k) => k.tval === tval && k.name === book.name,
      );
      if (existing) {
        book.tvalIdx = tval;
        book.sval = existing.sval;
        continue;
      }

      /* The next sval for this tval. */
      let sval = 0;
      for (const k of reg.kinds) {
        if (k.tval === tval && k.sval > sval) sval = k.sval;
      }
      sval += 1;

      const base = reg.bases[tval];
      if (!base) throw new Error(`spell: no object base for tval ${tval}`);
      const graphics = book.graphics as BookGraphicsJson | null;
      const props = book.properties as BookPropertiesJson | null;
      let allocMin = 0;
      let allocMax = 0;
      if (props?.minmax) {
        const m = /^(\d+)\s+to\s+(\d+)$/.exec(props.minmax);
        if (m) {
          allocMin = parseInt(m[1]!, 10);
          allocMax = parseInt(m[2]!, 10);
        }
      }

      const kind: ObjectKind = {
        name: book.name,
        text: "",
        base,
        kidx: reg.kinds.length,
        tval,
        sval,
        pval: { base: 0, dice: 0, sides: 0, mBonus: 0 },
        toH: { base: 0, dice: 0, sides: 0, mBonus: 0 },
        toD: { base: 0, dice: 0, sides: 0, mBonus: 0 },
        toA: { base: 0, dice: 0, sides: 0, mBonus: 0 },
        ac: 0,
        dd: 1,
        ds: 1,
        weight: 30,
        cost: props?.cost ?? 0,
        flags: newOfFlags(),
        kindFlags: base.kindFlags.clone(),
        modifiers: newModifiersRv(),
        elInfo: newElemInfo(),
        brands: null,
        slays: null,
        curses: null,
        dAttr: graphics?.color ?? "R",
        dChar: graphics?.glyph ?? "*",
        allocProb: props?.common ?? 0,
        allocMin,
        allocMax,
        level: allocMin,
        activation: null,
        effect: null,
        power: 0,
        effectMsg: "",
        visMsg: "",
        time: { base: 0, dice: 0, sides: 0, mBonus: 0 },
        charge: { base: 0, dice: 0, sides: 0, mBonus: 0 },
        genMultProb: 0,
        stackSize: { base: 1, dice: 0, sides: 0, mBonus: 0 },
      };
      reg.kinds.push(kind);
      book.tvalIdx = tval;
      book.sval = sval;
    }
  }
}

/* ------------------------------------------------------------------ *
 * player-spell.c proper.
 * ------------------------------------------------------------------ */

/** player_spells_init: size the spell flag/order arrays for the class. */
export function playerSpellsInit(player: Player): void {
  const num = player.cls.magic.totalSpells;
  if (!num) return;
  player.spellFlags = new Array<number>(num).fill(0);
  player.spellOrder = new Array<number>(num).fill(99);
}

/** class_magic_realms: the distinct realms the class casts from. */
export function classMagicRealms(cls: PlayerClass): MagicRealm[] {
  const realms: MagicRealm[] = [];
  if (!cls.magic.totalSpells) return realms;
  for (const book of cls.magic.books) {
    if (!realms.some((r) => r.name === book.realm.name)) {
      realms.push(book.realm);
    }
  }
  return realms;
}

/** player_object_to_book: the class book an object is, or null. */
export function playerObjectToBook(
  player: Player,
  obj: GameObject,
): ClassBook | null {
  for (const book of player.cls.magic.books) {
    if (obj.tval === book.tvalIdx && obj.sval === book.sval) return book;
  }
  return null;
}

/** spell_by_index: the class spell with the given class-wide sidx. */
export function spellByIndex(
  cls: PlayerClass,
  index: number,
): ClassSpell | null {
  const magic = cls.magic;
  if (index < 0 || index >= magic.totalSpells) return null;
  let book = 0;
  let count = 0;
  while (count + (magic.books[book]?.numSpells ?? 0) - 1 < index) {
    count += magic.books[book]!.numSpells;
    book++;
  }
  return magic.books[book]?.spells[index - count] ?? null;
}

/** spell_collect_from_book: the sidx list of a book object's spells. */
export function spellCollectFromBook(
  player: Player,
  obj: GameObject,
): number[] {
  const book = playerObjectToBook(player, obj);
  if (!book) return [];
  return book.spells.map((s) => s.sidx);
}

/** spell_book_count_spells over a tester. */
export function spellBookCountSpells(
  player: Player,
  obj: GameObject,
  tester: (player: Player, spell: number) => boolean,
): number {
  const book = playerObjectToBook(player, obj);
  if (!book) return 0;
  return book.spells.filter((s) => tester(player, s.sidx)).length;
}

/** spell_okay_to_cast. */
export function spellOkayToCast(player: Player, spell: number): boolean {
  return ((player.spellFlags[spell] ?? 0) & PY_SPELL.LEARNED) !== 0;
}

/** spell_okay_to_study. */
export function spellOkayToStudy(player: Player, spellIndex: number): boolean {
  const spell = spellByIndex(player.cls, spellIndex);
  return (
    spell !== null &&
    spell.level <= player.lev &&
    ((player.spellFlags[spellIndex] ?? 0) & PY_SPELL.LEARNED) === 0
  );
}

/** spell_okay_to_browse. */
export function spellOkayToBrowse(player: Player, spellIndex: number): boolean {
  const spell = spellByIndex(player.cls, spellIndex);
  return spell !== null && spell.level < 99;
}

/** average_spell_stat: the mean casting-stat index over the class realms. */
export function averageSpellStat(
  cls: PlayerClass,
  statInd: readonly number[],
): number {
  const realms = classMagicRealms(cls);
  const count = realms.length;
  if (!count) return 0;
  let sum = 0;
  for (const r of realms) sum += statInd[r.stat] ?? 0;
  return Math.trunc((sum + count - 1) / count);
}

/** Hooks for unported inputs to spell_chance; all optional. */
export interface SpellChanceEnv {
  /** player_has(PF_ZERO_FAIL / PF_UNLIGHT / PF_BEAM): class pflags. */
  hasPf?: (pf: number) => boolean;
  /** square_islit(cave, player->grid) for the UNLIGHT penalty. */
  gridIsLit?: () => boolean;
  /**
   * player_of_has(p, OF_AFRAID) (player-spell.c:424): fear from ANY source -
   * the timed TMD_AFRAID synonym OR an OF_AFRAID object/intrinsic flag. The
   * game caller passes the computed player_state flags here; when omitted the
   * fallback reads timed[TMD_AFRAID] only, which misses equipment-borne fear.
   */
  afraid?: () => boolean;
}

/**
 * spell_chance: the percentage failure chance for a spell, from base fail,
 * level and casting-stat adjustments, low mana, fear, stunning and amnesia.
 */
export function spellChance(
  player: Player,
  statInd: readonly number[],
  spellIndex: number,
  env: SpellChanceEnv = {},
): number {
  if (!player.cls.magic.totalSpells) return 100;
  const spell = spellByIndex(player.cls, spellIndex);
  if (!spell) return 100;

  const hasPf = env.hasPf ?? ((pf: number): boolean => player.cls.pflags.has(pf));
  const statIdx = statInd[spell.realm.stat] ?? 0;

  /* Base rate, adjusted by effective level and the casting stat. */
  let chance = spell.fail;
  chance -= 3 * (player.lev - spell.level);
  chance -= at(adj_mag_stat, statIdx);

  /* Not enough mana to cast. */
  if (spell.mana > player.csp) chance += 5 * (spell.mana - player.csp);

  /* Get the minimum failure rate for the casting stat level. */
  let minfail = at(adj_mag_fail, statIdx);

  /* Non zero-fail characters never get better than 5 percent. */
  if (!hasPf(PF.ZERO_FAIL) && minfail < 5) minfail = 5;

  /* Necromancers are punished by being on lit squares. */
  if (hasPf(PF.UNLIGHT) && (env.gridIsLit?.() ?? false)) chance += 25;

  /* Fear makes spells harder (before minfail). Upstream reads player_of_has(
   * OF_AFRAID); the fallback below covers only the timed synonym, so the game
   * caller supplies env.afraid from the computed player_state flags. */
  const afraid = env.afraid ?? ((): boolean => (player.timed[TMD.AFRAID] ?? 0) > 0);
  if (afraid()) chance += 20;

  /* Minimal and maximal failure rate. */
  if (chance < minfail) chance = minfail;
  if (chance > 50) chance = 50;

  /* Stunning makes spells harder (after minfail). */
  const stun = player.timed[TMD.STUN] ?? 0;
  if (stun > 50) chance += 25;
  else if (stun) chance += 15;

  /* Amnesia makes spells very difficult. */
  if ((player.timed[TMD.AMNESIA] ?? 0) > 0) {
    chance = 50 + Math.trunc(chance / 2);
  }

  /* Always a 5 percent chance of working. */
  if (chance > 95) chance = 95;
  return chance;
}

/** spell_learn: learn a spell and append it to the learn order. */
export function spellLearn(
  player: Player,
  spellIndex: number,
  msg?: (text: string) => void,
): void {
  const spell = spellByIndex(player.cls, spellIndex);
  if (!spell) return;

  player.spellFlags[spellIndex] = (player.spellFlags[spellIndex] ?? 0) | PY_SPELL.LEARNED;

  /* Find the next open entry in spell_order[]. */
  for (let i = 0; i < player.cls.magic.totalSpells; i++) {
    if (player.spellOrder[i] === 99) {
      player.spellOrder[i] = spellIndex;
      break;
    }
  }

  msg?.(`You have learned the ${spell.realm.spellNoun} of ${spell.name}.`);
  player.upkeep.newSpells--;
  if (player.upkeep.newSpells > 0) {
    msg?.(
      `You can learn ${player.upkeep.newSpells} more ${spell.realm.spellNoun}` +
        `${player.upkeep.newSpells !== 1 ? "s" : ""}.`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * calc_spells / calc_mana (player-calcs.c).
 * ------------------------------------------------------------------ */

/**
 * calc_spells (player-calcs.c L1268): how many spells the player may learn,
 * forgetting or remembering spells as the allowance and level change.
 * Updates player.upkeep.newSpells.
 */
export function calcSpells(
  player: Player,
  statInd: readonly number[],
  msg?: (text: string) => void,
): void {
  const magic = player.cls.magic;
  const numTotal = magic.totalSpells;
  if (!numTotal) return;

  /* Save the new_spells value (player-calcs.c:1288) for the change check. */
  const oldSpells = player.upkeep.newSpells;

  /* Determine the number of spells allowed. */
  let levels = player.lev - magic.spellFirst + 1;
  if (levels < 0) levels = 0;
  const percentSpells = at(adj_mag_study, averageSpellStat(player.cls, statInd));
  const numAllowed = Math.trunc((percentSpells * levels + 50) / 100);

  /* Count the number of spells we know. */
  let numKnown = 0;
  for (let j = 0; j < numTotal; j++) {
    if ((player.spellFlags[j] ?? 0) & PY_SPELL.LEARNED) numKnown++;
  }
  player.upkeep.newSpells = numAllowed - numKnown;

  /* Forget spells which are too hard. */
  for (let i = numTotal - 1; i >= 0; i--) {
    const j = player.spellOrder[i] ?? 99;
    if (j >= 99) continue;
    const spell = spellByIndex(player.cls, j);
    if (!spell || spell.level <= player.lev) continue;
    if ((player.spellFlags[j] ?? 0) & PY_SPELL.LEARNED) {
      player.spellFlags[j] =
        ((player.spellFlags[j] ?? 0) | PY_SPELL.FORGOTTEN) & ~PY_SPELL.LEARNED;
      msg?.(`You have forgotten the ${spell.realm.spellNoun} of ${spell.name}.`);
      player.upkeep.newSpells++;
    }
  }

  /* Forget spells if we know too many spells. */
  for (let i = numTotal - 1; i >= 0; i--) {
    if (player.upkeep.newSpells >= 0) break;
    const j = player.spellOrder[i] ?? 99;
    if (j >= 99) continue;
    const spell = spellByIndex(player.cls, j);
    if (spell && (player.spellFlags[j] ?? 0) & PY_SPELL.LEARNED) {
      player.spellFlags[j] =
        ((player.spellFlags[j] ?? 0) | PY_SPELL.FORGOTTEN) & ~PY_SPELL.LEARNED;
      msg?.(`You have forgotten the ${spell.realm.spellNoun} of ${spell.name}.`);
      player.upkeep.newSpells++;
    }
  }

  /* Check for spells to remember. */
  for (let i = 0; i < numTotal; i++) {
    if (player.upkeep.newSpells <= 0) break;
    const j = player.spellOrder[i] ?? 99;
    if (j >= 99) break;
    const spell = spellByIndex(player.cls, j);
    if (!spell || spell.level > player.lev) continue;
    if ((player.spellFlags[j] ?? 0) & PY_SPELL.FORGOTTEN) {
      player.spellFlags[j] =
        ((player.spellFlags[j] ?? 0) & ~PY_SPELL.FORGOTTEN) | PY_SPELL.LEARNED;
      msg?.(`You have remembered the ${spell.realm.spellNoun} of ${spell.name}.`);
      player.upkeep.newSpells--;
    }
  }

  /* Cannot learn more spells than exist. */
  let learnable = 0;
  for (let j = 0; j < numTotal; j++) {
    const spell = spellByIndex(player.cls, j);
    if (!spell || spell.level > player.lev || spell.level === 0) continue;
    if ((player.spellFlags[j] ?? 0) & PY_SPELL.LEARNED) continue;
    learnable++;
  }
  if (player.upkeep.newSpells > learnable) {
    player.upkeep.newSpells = learnable;
  }

  /* Spell count changed: announce the new allowance (player-calcs.c:1433-1466).
     The realm spell_noun list is pluralised only when >1 new spell. The
     old!=new guard means load/boot recalcs (newSpells restored from save) stay
     silent - only a real change (level-up, stat shift) speaks. */
  if (oldSpells !== player.upkeep.newSpells && player.upkeep.newSpells > 0) {
    const realms = classMagicRealms(player.cls);
    const plural = player.upkeep.newSpells > 1;
    const suffix = plural ? "s" : "";
    let buf = realms.length > 0 ? `${realms[0]!.spellNoun}${suffix}` : "spells";
    for (let i = 1; i < realms.length; i++) {
      buf += i < realms.length - 1 ? ", " : " or ";
      buf += `${realms[i]!.spellNoun}${suffix}`;
    }
    msg?.(`You can learn ${player.upkeep.newSpells} more ${buf}.`);
  }
}

/**
 * calc_mana (player-calcs.c L1480): maximum mana from effective levels and
 * the casting stat, penalized by heavy armor over the class allowance.
 * `armorWeight` is the summed weight of worn body armor (the caller sums
 * the non-weapon/bow/ring/amulet/light slots). Updates msp and clamps csp.
 */
export function calcMana(
  player: Player,
  statInd: readonly number[],
  armorWeight: number,
): void {
  if (!player.cls.magic.totalSpells) {
    player.msp = 0;
    player.csp = 0;
    player.cspFrac = 0;
    return;
  }

  /* Extract "effective" player level. */
  const levels = player.lev - player.cls.magic.spellFirst + 1;
  let msp = 0;
  if (levels > 0) {
    msp = 1;
    msp += Math.trunc(
      (at(adj_mag_mana, averageSpellStat(player.cls, statInd)) * levels) / 100,
    );
  }

  /* Heavy armor penalizes mana. */
  const over = Math.trunc((armorWeight - player.cls.magic.spellWeight) / 10);
  if (over > 0) msp -= over;

  if (msp < 0) msp = 0;

  if (player.msp !== msp) {
    player.msp = msp;
    if (player.csp >= msp) {
      player.csp = msp;
      player.cspFrac = 0;
    }
  }
}
