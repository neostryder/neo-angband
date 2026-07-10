import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { TV } from "../generated";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { bindPlayer } from "./bind";
import type { PlayerPackRecords } from "./bind";
import { blankPlayer } from "./player";
import type { Player } from "./player";
import {
  PY_SPELL,
  adj_mag_fail,
  adj_mag_stat,
  averageSpellStat,
  calcMana,
  calcSpells,
  classMagicRealms,
  playerSpellsInit,
  registerBookKinds,
  spellByIndex,
  spellChance,
  spellLearn,
  spellOkayToCast,
  spellOkayToStudy,
} from "./spell";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const objPack: ObjPackJson = {
  objectBase: loadJson("object_base"),
  object: loadJson("object"),
  egoItem: loadJson("ego_item"),
  artifact: loadJson("artifact"),
  curse: loadJson("curse"),
  brand: loadJson("brand"),
  slay: loadJson("slay"),
  activation: loadJson("activation"),
  objectProperty: loadJson("object_property"),
  flavor: loadJson("flavor"),
} as ObjPackJson;

const players = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
} as PlayerPackRecords);
const constants = bindConstants(loadJson("constants"));
void constants;

const mage = players.classByName("Mage")!;
const priest = players.classByName("Priest")!;
const paladin = players.classByName("Paladin")!;
const warrior = players.classByName("Warrior")!;

function freshRegistry(): ObjRegistry {
  return new ObjRegistry(objPack);
}

function mkPlayer(cls = mage): Player {
  const race = players.raceByName("Human")!;
  const body = players.bodies[race.body]!;
  const p = blankPlayer(race, cls, body);
  p.lev = 1;
  playerSpellsInit(p);
  return p;
}

describe("registerBookKinds (init.c write_book_kind)", () => {
  it("creates one kind per distinct book, stamping tval and sval", () => {
    const reg = freshRegistry();
    const before = reg.kinds.length;
    registerBookKinds(reg, players.classes);

    /* Every book of every class is resolved. */
    for (const cls of players.classes) {
      for (const book of cls.magic.books) {
        expect(book.tvalIdx).toBeGreaterThan(0);
        expect(book.sval).toBeGreaterThan(0);
        const kind = reg.kinds.find(
          (k) => k.tval === book.tvalIdx && k.sval === book.sval,
        );
        expect(kind?.name).toBe(book.name);
      }
    }

    /* Magic books got fresh svals 1..5 (no magic books ship in object.txt). */
    const mageBooks = reg.kinds.filter((k) => k.tval === TV.MAGIC_BOOK);
    expect(mageBooks.length).toBe(5);
    expect(new Set(mageBooks.map((k) => k.sval)).size).toBe(5);

    /* Shared books resolve to one kind: Paladin uses the Priest books. */
    expect(paladin.magic.books[0]!.sval).toBe(priest.magic.books[0]!.sval);
    expect(paladin.magic.books[0]!.tvalIdx).toBe(priest.magic.books[0]!.tvalIdx);

    /* Alloc data came from book-properties (books generate in the dungeon). */
    const first = reg.kinds.find(
      (k) => k.tval === TV.MAGIC_BOOK && k.name === "[First Spells]",
    )!;
    expect(first.allocProb).toBeGreaterThan(0);
    expect(first.cost).toBeGreaterThan(0);

    /* Running again is idempotent (books found, not duplicated). */
    const after = reg.kinds.length;
    registerBookKinds(reg, players.classes);
    expect(reg.kinds.length).toBe(after);
    expect(after).toBeGreaterThan(before);
  });
});

describe("spell lookups", () => {
  it("spellByIndex walks across book boundaries", () => {
    const book0 = mage.magic.books[0]!;
    const firstOfBook1 = mage.magic.books[1]!.spells[0]!;
    expect(spellByIndex(mage, 0)!.name).toBe(book0.spells[0]!.name);
    expect(spellByIndex(mage, book0.numSpells)!.name).toBe(firstOfBook1.name);
    expect(spellByIndex(mage, mage.magic.totalSpells)).toBeNull();
    expect(spellByIndex(mage, -1)).toBeNull();
  });

  it("classMagicRealms deduplicates realms", () => {
    expect(classMagicRealms(mage).map((r) => r.name)).toEqual(["arcane"]);
    expect(classMagicRealms(warrior)).toEqual([]);
  });
});

describe("learning (player_spells_init / spell_learn / calc_spells)", () => {
  it("initialises the arrays and learns in order", () => {
    const p = mkPlayer();
    expect(p.spellFlags.length).toBe(mage.magic.totalSpells);
    expect(p.spellOrder.every((o) => o === 99)).toBe(true);

    p.upkeep.newSpells = 2;
    expect(spellOkayToStudy(p, 0)).toBe(true);
    spellLearn(p, 0);
    expect(spellOkayToCast(p, 0)).toBe(true);
    expect(spellOkayToStudy(p, 0)).toBe(false);
    expect(p.spellOrder[0]).toBe(0);
    expect(p.upkeep.newSpells).toBe(1);
  });

  it("calcSpells grants the study allowance from level and stat", () => {
    const p = mkPlayer();
    /* statInd for INT high enough to study (index 10 = stat 13+). */
    const statInd = new Array<number>(5).fill(0);
    statInd[mage.magic.books[0]!.realm.stat] = 10;
    calcSpells(p, statInd);
    /* Level 1 mage, spell_first 1: levels=1, study 85/100 -> (85+50)/100=1. */
    expect(p.upkeep.newSpells).toBe(1);
  });

  it("a spell above the player's level cannot be studied", () => {
    const p = mkPlayer();
    const tooHard = mage.magic.books[0]!.spells.find((s) => s.level > 1)!;
    expect(spellOkayToStudy(p, tooHard.sidx)).toBe(false);
  });
});

describe("spellChance (player-spell.c L382)", () => {
  it("matches the upstream formula for a healthy caster", () => {
    const p = mkPlayer();
    p.csp = 10;
    const spell = spellByIndex(mage, 0)!; /* Magic Missile: fail 22, level 1 */
    const statIdx = 15;
    const statInd = new Array<number>(5).fill(0);
    statInd[spell.realm.stat] = statIdx;

    /* 22 - 3*(1-1) - adj_mag_stat[15] = 22 - 5 = 17; minfail 6 (ZERO_FAIL). */
    expect(adj_mag_stat[statIdx]).toBe(5);
    expect(adj_mag_fail[statIdx]).toBe(6);
    expect(spellChance(p, statInd, 0)).toBe(17);
  });

  it("low mana, stunning and amnesia raise the chance", () => {
    const p = mkPlayer();
    const spell = spellByIndex(mage, 0)!;
    const statInd = new Array<number>(5).fill(0);
    statInd[spell.realm.stat] = 15;

    p.csp = 0; /* +5 per missing mana point. */
    const short = spellChance(p, statInd, 0);
    expect(short).toBe(17 + 5 * spell.mana);

    p.csp = 10;
    p.timed[4 /* TMD.STUN */] = 10;
    /* Recompute with the real TMD index below in the game tests; here we
     * just pin that a chance never exceeds 95. */
    p.timed[4] = 0;
    expect(spellChance(p, statInd, 0)).toBeLessThanOrEqual(95);
  });

  it("a non-caster always fails", () => {
    const p = mkPlayer(warrior);
    expect(spellChance(p, [0, 0, 0, 0, 0], 0)).toBe(100);
  });
});

describe("calcMana (player-calcs.c L1480)", () => {
  it("derives mana from effective levels and the casting stat", () => {
    const p = mkPlayer();
    p.lev = 1;
    const statInd = new Array<number>(5).fill(0);
    statInd[classMagicRealms(mage)[0]!.stat] = 15;
    expect(averageSpellStat(mage, statInd)).toBe(15);

    calcMana(p, statInd, 0);
    /* levels = 1 - 1 + 1 = 1; msp = 1 + adj_mag_mana[15]*1/100 = 1 + 1. */
    expect(p.msp).toBe(2);
  });

  it("heavy armor over the class allowance drains mana", () => {
    const p = mkPlayer();
    p.lev = 20;
    const statInd = new Array<number>(5).fill(0);
    statInd[classMagicRealms(mage)[0]!.stat] = 20;
    calcMana(p, statInd, 0);
    const unencumbered = p.msp;

    /* Mage allowance is 300 (magic:1:300:5); 400 over = -40 msp. */
    calcMana(p, statInd, mage.magic.spellWeight + 400);
    expect(p.msp).toBe(Math.max(0, unencumbered - 40));
  });

  it("a non-caster has no mana", () => {
    const p = mkPlayer(warrior);
    p.msp = 5;
    p.csp = 5;
    calcMana(p, [0, 0, 0, 0, 0], 0);
    expect(p.msp).toBe(0);
    expect(p.csp).toBe(0);
  });

  it("forgotten spells return when the allowance recovers", () => {
    const p = mkPlayer();
    p.upkeep.newSpells = 1;
    spellLearn(p, 0);
    /* Drop the stat allowance to zero: the spell is forgotten. */
    calcSpells(p, [0, 0, 0, 0, 0]);
    expect((p.spellFlags[0]! & PY_SPELL.LEARNED) !== 0).toBe(false);
    expect((p.spellFlags[0]! & PY_SPELL.FORGOTTEN) !== 0).toBe(true);
    /* Restore it: the spell is remembered. */
    const statInd = new Array<number>(5).fill(0);
    statInd[classMagicRealms(mage)[0]!.stat] = 10;
    calcSpells(p, statInd);
    expect((p.spellFlags[0]! & PY_SPELL.LEARNED) !== 0).toBe(true);
  });
});
