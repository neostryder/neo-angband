/**
 * Locks gap 2.11: spell_chance's fear penalty reads player_of_has(p,
 * OF_AFRAID) (player-spell.c:424), i.e. fear from ANY source - the timed
 * effect or equipment-borne OF_AFRAID - not just timed[TMD_AFRAID]. The
 * SpellChanceEnv.afraid seam carries the full player_of_has answer; the
 * fallback covers the timed synonym.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TMD } from "../generated";
import { bindPlayer } from "./bind";
import type { PlayerPackRecords } from "./bind";
import { blankPlayer } from "./player";
import type { Player } from "./player";
import { spellChance } from "./spell";

function loadRecords<T>(name: string): T[] {
  return (
    JSON.parse(
      readFileSync(
        new URL(`../../../content/pack/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as { records: T[] }
  ).records;
}

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

const mage = players.classByName("Mage")!;

function mkPlayer(): Player {
  const race = players.races[0]!;
  const p = blankPlayer(race, mage, players.bodies[race.body]!);
  p.lev = 1;
  p.csp = 10;
  return p;
}

function statInd(): number[] {
  const spellStat = mage.magic.books[0]!.realm.stat;
  const arr = new Array<number>(5).fill(0);
  arr[spellStat] = 15; /* adj_mag_stat 5, adj_mag_fail 6 */
  return arr;
}

describe("spell_chance fear penalty (player-spell.c:424, gap 2.11)", () => {
  it("env.afraid (player_of_has OF_AFRAID) adds 20 even with no timed fear", () => {
    const p = mkPlayer();
    expect(p.timed[TMD.AFRAID]).toBe(0);
    /* Magic Missile: 22 - 3*(1-1) - 5 = 17 baseline. */
    expect(spellChance(p, statInd(), 0)).toBe(17);
    /* Equipment-borne OF_AFRAID: the env seam reports fear. */
    expect(spellChance(p, statInd(), 0, { afraid: () => true })).toBe(37);
  });

  it("the default fallback still covers the timed synonym", () => {
    const p = mkPlayer();
    p.timed[TMD.AFRAID] = 5;
    expect(spellChance(p, statInd(), 0)).toBe(37);
  });
});
