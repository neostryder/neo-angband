import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, RF } from "../generated";
import { bindMonsters } from "./bind";
import type { MonsterPackRecords } from "./bind";
import { blankMonster } from "./monster";
import {
  monsterBreathes,
  monsterHasSpells,
  monsterIsEspDetectable,
  monsterIsInvisible,
  monsterIsLiving,
  monsterIsNonliving,
  monsterIsObvious,
  monsterIsUndead,
  monsterIsUnique,
  monsterPassesWalls,
} from "./predicate";
import type { MonsterRace } from "./types";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: T[] };
  return parsed.records;
}

const reg = bindMonsters({
  pain: packJson("pain"),
  blowMethods: packJson("blow_methods"),
  blowEffects: packJson("blow_effects"),
  monsterSpells: packJson("monster_spell"),
  monsterBases: packJson("monster_base"),
  monsters: packJson("monster"),
  summons: packJson("summon"),
  pits: packJson("pit"),
} as MonsterPackRecords);

/** First positive-rarity race whose flags satisfy `pred`. */
function raceWhere(pred: (r: MonsterRace) => boolean): MonsterRace {
  const r = reg.races.find((rr) => rr.rarity > 0 && pred(rr));
  if (!r) throw new Error("no race matched predicate");
  return r;
}

describe("monster predicates (mon-predicate.c permanent properties)", () => {
  it("undead monsters are nonliving and not living", () => {
    const mon = blankMonster(raceWhere((r) => r.flags.has(RF.UNDEAD)));
    expect(monsterIsUndead(mon)).toBe(true);
    expect(monsterIsNonliving(mon)).toBe(true);
    expect(monsterIsLiving(mon)).toBe(false);
  });

  it("a plain living monster is living and not undead", () => {
    const mon = blankMonster(
      raceWhere(
        (r) => !r.flags.has(RF.UNDEAD) && !r.flags.has(RF.NONLIVING),
      ),
    );
    expect(monsterIsUndead(mon)).toBe(false);
    expect(monsterIsLiving(mon)).toBe(true);
  });

  it("recognises unique, invisible, and wall-passing races", () => {
    expect(monsterIsUnique(blankMonster(raceWhere((r) => r.flags.has(RF.UNIQUE))))).toBe(true);
    expect(monsterIsUnique(blankMonster(raceWhere((r) => !r.flags.has(RF.UNIQUE))))).toBe(false);
    expect(monsterIsInvisible(blankMonster(raceWhere((r) => r.flags.has(RF.INVISIBLE))))).toBe(true);
    expect(
      monsterPassesWalls(
        blankMonster(
          raceWhere(
            (r) =>
              r.flags.has(RF.PASS_WALL) ||
              r.flags.has(RF.KILL_WALL) ||
              r.flags.has(RF.SMASH_WALL),
          ),
        ),
      ),
    ).toBe(true);
  });

  it("EMPTY_MIND blocks telepathy; an ordinary mind is detectable", () => {
    const empty = blankMonster(raceWhere((r) => r.flags.has(RF.EMPTY_MIND)));
    expect(monsterIsEspDetectable(empty)).toBe(false);
    const normal = blankMonster(
      raceWhere(
        (r) => !r.flags.has(RF.EMPTY_MIND) && !r.flags.has(RF.WEIRD_MIND),
      ),
    );
    expect(monsterIsEspDetectable(normal)).toBe(true);
  });

  it("detects spellcasters and breathers", () => {
    const breather = blankMonster(raceWhere((r) => !r.spellFlags.isEmpty()));
    expect(monsterHasSpells(breather)).toBe(true);
    // A dragon-ish race that breathes exists in the data.
    const anyBreather = reg.races.find(
      (r) => r.rarity > 0 && monsterBreathes(blankMonster(r)),
    );
    expect(anyBreather).toBeTruthy();
  });
});

describe("monster predicates (temporary mflag properties)", () => {
  it("monster_is_obvious tracks VISIBLE minus CAMOUFLAGE", () => {
    const mon = blankMonster(raceWhere((r) => r.level >= 0));
    expect(monsterIsObvious(mon)).toBe(false); // not visible yet
    mon.mflag.on(MFLAG.VISIBLE);
    expect(monsterIsObvious(mon)).toBe(true);
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    expect(monsterIsObvious(mon)).toBe(false);
  });
});
