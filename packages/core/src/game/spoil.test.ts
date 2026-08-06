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
});
