/**
 * The monster-lore spoiler dump (wiz-spoil.c spoil_mon_info, L695), PORT_TODO
 * 5.6.
 *
 * The generators had no test of their own. This one exists because the fix it
 * guards is invisible from mon/lore-describe.test.ts: that file proves
 * `loreDescription(..., spoilers = true)` drops four sections, and would stay
 * green if game/spoil.ts stopped passing the flag.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { spoilMonInfo } from "./spoil.js";
import { getHitChance } from "../combat/hit.js";
import { startGame } from "../session/game.js";
import type { GamePack } from "../session/game.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  obj: {
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
  },
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
} as unknown as GamePack;

describe("spoil_mon_info passes lore_description's spoilers flag (5.6)", () => {
  const out = spoilMonInfo(pack);

  it("dumps every placeable race", () => {
    /* The fixture guard: if this ever produced a handful of races the
     * absence assertions below would be nearly free. */
    expect(out.length).toBeGreaterThan(50_000);
    expect(out).toContain("=== Num:");
  });

  it("emits no recall title, since the header already names the monster", () => {
    /* lore_title's shape is "The <name> ('<glyph>')"; the spoiler's own header
     * is "<name>  (<colour> '<glyph>')", so this pattern is specific to the
     * recall title the flag suppresses. */
    expect(out).not.toMatch(/The [a-z].*\('.'\)/u);
  });

  it("emits no kill counts, toughness or experience reward", () => {
    /* All three are statements about a player. wiz-spoil.c's dump has none,
     * and the port's used to have all three - the caller sliced one line off
     * the front, which removed only the title. */
    expect(out).not.toMatch(/killed at least/u);
    expect(out).not.toMatch(/armor rating/u);
    expect(out).not.toMatch(/chance to hit such a creature/u);
    expect(out).not.toMatch(/points for a/u);
  });

  it("still carries the objective lore", () => {
    /* The control: suppressing too much would empty the file. Flavour text,
     * the movement clause and the attack summary all survive. */
    expect(out).toMatch(/moves/u);
    expect(out).toMatch(/averaging \d+ damage/u);
  });

  it("prints a real per-blow hit chance, not 0%", () => {
    /*
     * lore_append_attack's "(NdM, X%)" runs in BOTH views (mon-lore.c:1710-1715),
     * so it needs monsterHitPercent even though the toughness block that used
     * meleeHitPercent is now suppressed. Without it every blow in the dump read
     * 0% - and the centidamage total that multiplies by it read zero too, which
     * is the "averaging 0 damage" the control above would have accepted.
     */
    const percents = [...out.matchAll(/, (\d+)%\)/gu)].map((m) => Number(m[1]));
    expect(percents.length, "the dump prints per-blow hit chances").toBeGreaterThan(
      200,
    );
    expect(
      percents.some((p) => p > 0),
      "at least one blow can land on the spoiler character",
    ).toBe(true);
    /* And the damage average it feeds is non-zero somewhere, which it cannot
     * be while every percentage is 0. */
    const damages = [...out.matchAll(/averaging (\d+) damage/gu)].map((m) =>
      Number(m[1]),
    );
    expect(damages.some((d) => d > 0)).toBe(true);
  });

  it("uses upstream's formula, derived rather than eyeballed", () => {
    /*
     * "some percentage is non-zero" passes against a formula that drops the
     * blow's power or measures against no armour at all - both of those
     * mutations survived the assertion above. So DERIVE the numbers: boot the
     * same headless game the spoiler boots (same call, same seed), read the
     * defence it would see, and recompute
     * hit_chance(MAX(level,1) * 3 + power, ac + to_a) per blow.
     */
    const game = startGame(pack, { seed: 1, depth: 1 });
    const ac = game.state.actor.defense.ac + game.state.actor.defense.toA;
    const races = game.booted.registries.monsters.races;

    let checked = 0;
    for (const race of races) {
      if (!race || race.rarity <= 0 || race.blows.length === 0) continue;
      /* The race's own block: from its "=== Num:<ridx>" header to the next. */
      const start = out.indexOf(`=== Num:${race.ridx}  `);
      if (start < 0) continue;
      const nextAt = out.indexOf("=== Num:", start + 1);
      const block = out.slice(start, nextAt < 0 ? undefined : nextAt);

      const seen = [...block.matchAll(/, (\d+)%\)/gu)].map((m) => Number(m[1]));
      const want = race.blows
        .filter((b) => b.effect && b.dice)
        .map((b) => getHitChance(Math.max(race.level, 1) * 3 + b.effect.power, ac));
      if (seen.length === 0 || seen.length !== want.length) continue;

      expect(seen, `${race.name} hit chances`).toEqual(want);
      checked++;
      if (checked >= 25) break;
    }
    /* The fixture guard: an empty loop would pass every assertion in it. */
    expect(checked, "blocks actually compared").toBeGreaterThanOrEqual(25);
  });
});
