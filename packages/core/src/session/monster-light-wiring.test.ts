/**
 * PORT_TODO 7.4: calc_lighting's monster scan reaches the map.
 *
 * A WIRING test, because the defect was never in the kernel. world/view.ts's
 * calcLighting ports cave-view.c L696-719 correctly and has done all along -
 * it takes a `sources` list, honours the sign, and applies the max_sight gate.
 * Nothing ever built the list. `LightSource` had two consumers and no producer,
 * session/game.ts passed a literal `[]`, and updateView's own parameter
 * defaulted to `[]`, so there was no host configuration under which a monster
 * lit a single grid. 107 of the 624 shipped races carry a non-zero light.
 *
 * So a unit test of monsterLightSources would have proved nothing: the seam
 * being SUPPLIED is not the call site READING it. This boots a real game and
 * looks at the light map.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG } from "../generated/index.js";
import { monsterLightSources } from "../game/known.js";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";
import type { GameState } from "../game/context.js";
import type { Monster } from "../mon/monster.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
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
  } as GamePack["obj"],
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
};

/*
 * Seed and depth chosen by measurement, not taste. Three things had to be true
 * at once and finding them took a sweep of 60 seeds:
 *
 *  - the level must carry light-bearing monsters at all (several depth-1 seeds
 *    carry none, and a level with none passes every assertion below for free);
 *  - at least one must be within max_sight of the player, because calcLighting
 *    applies upstream's `distance - radius > max_sight` gate. The first draft
 *    used depth 5, where the nearest bearer stood 38 grids away: the light maps
 *    came back byte-identical and the test failed against a CORRECT fix;
 *  - and one must stand on a grid nothing else lights, so the proof is 0 -> lit
 *    rather than 1 -> 2. That rules out the town, which is SQUARE_GLOW by day.
 *
 * seed 2 / depth 4 satisfies all three: six bearers in sight on unlit grids,
 * the nearest a tamer at distance 8. Which is the real case this fixes - a
 * lantern-carrying monster coming down a dark corridor.
 */
const SEED = 2;
const DEPTH = 4;

function lightMap(state: GameState): number[] {
  const c = state.chunk;
  const out: number[] = [];
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) out.push(c.light({ x, y }));
  }
  return out;
}

function bearersOf(state: GameState): Monster[] {
  const out: Monster[] = [];
  for (let i = 1; i < state.monsters.length; i++) {
    const m = state.monsters[i];
    if (m?.race.light) out.push(m);
  }
  return out;
}

describe("a monster's own light reaches the map (PORT_TODO 7.4)", () => {
  it("the level really does carry light-bearing monsters", () => {
    /* The fixture guard. Everything below compares a lit world against an
     * unlit one; with no bearers the two worlds are identical and every
     * assertion becomes free. */
    const { state } = startGame(pack, { seed: SEED, depth: DEPTH });
    expect(bearersOf(state).length).toBeGreaterThanOrEqual(3);
  });

  it("camouflaging every bearer changes the light map", () => {
    const { state } = startGame(pack, { seed: SEED, depth: DEPTH });
    state.updateFov?.(state);
    const lit = lightMap(state);

    /* Upstream's own skip (cave-view.c L705) is the switch: an unrevealed
     * mimic must not give itself away by glowing. Turning it on for every
     * bearer is therefore the "monsters emit nothing" world - the world the
     * port was permanently in. */
    for (const m of bearersOf(state)) m.mflag.on(MFLAG.CAMOUFLAGE);
    state.updateFov?.(state);
    const dark = lightMap(state);

    expect(
      dark,
      "with the monster scan wired, hiding the bearers must darken something",
    ).not.toEqual(lit);
  });

  it("lights a grid nothing else lights, and to the race's own radius", () => {
    const { state } = startGame(pack, { seed: SEED, depth: DEPTH });

    /* The two worlds, in the same order as above. */
    state.updateFov?.(state);
    const lit = lightMap(state);
    const bearers = bearersOf(state);
    for (const m of bearers) m.mflag.on(MFLAG.CAMOUFLAGE);
    state.updateFov?.(state);
    const dark = lightMap(state);
    for (const m of bearers) m.mflag.off(MFLAG.CAMOUFLAGE);

    const w = state.chunk.width;
    const at = (g: { x: number; y: number }): number => g.y * w + g.x;

    /*
     * A bearer standing somewhere that is otherwise unlit: its own grid is
     * lit in one world and dark in the other, so the monster is the only
     * possible cause. Naming it in the failure message means a generation
     * change reads as "the fixture moved", not as "the feature broke".
     */
    const proof = bearers.find(
      (m) => m.race.light > 0 && lit[at(m.grid)]! > 0 && dark[at(m.grid)] === 0,
    );
    expect(
      proof,
      "a light-bearing monster standing on an otherwise unlit grid",
    ).toBeDefined();

    /*
     * And to the right RADIUS. add_light uses ABS(light) - 1, so a light=2
     * monster lights its neighbours too. Without this, `light: 1` passes -
     * the monster's own grid is lit at radius 0 as well.
     */
    const wide = bearers.find((m) => Math.abs(m.race.light) >= 2);
    expect(wide, "fixture: a bearer with light magnitude >= 2").toBeDefined();
    const neighbours = [
      { x: wide!.grid.x + 1, y: wide!.grid.y },
      { x: wide!.grid.x - 1, y: wide!.grid.y },
      { x: wide!.grid.x, y: wide!.grid.y + 1 },
      { x: wide!.grid.x, y: wide!.grid.y - 1 },
    ];
    expect(
      neighbours.some((g) => lit[at(g)]! > dark[at(g)]!),
      `${wide!.race.name} (light ${wide!.race.light}) lights past its own grid`,
    ).toBe(true);
  });

  it("a darkness-emitting monster SUBTRACTS light", () => {
    /*
     * The sign, on its own fixture. 12 of the 107 bearers emit darkness
     * (dark hound at depth 15 up to Ungoliant at 75) and add_light has a
     * separate arm for them - `light + inten + dist`, with no clamp at zero.
     * A `Math.abs()` slip in the producer is entirely plausible and the
     * positive fixture above cannot see it.
     *
     * Its own seed because the case is rare: it needs a darkness-emitter
     * standing within max_sight on a grid something ELSE lights, or there is
     * nothing to subtract from. A sweep of 80 seeds x 7 depths found it once.
     */
    const { state } = startGame(pack, { seed: 11, depth: 36 });
    state.updateFov?.(state);
    const lit = lightMap(state);

    const emitters = bearersOf(state).filter((m) => m.race.light < 0);
    expect(
      emitters.length,
      "fixture: seed 11 / depth 36 carries a darkness-emitter in sight",
    ).toBeGreaterThan(0);

    for (const m of emitters) m.mflag.on(MFLAG.CAMOUFLAGE);
    state.updateFov?.(state);
    const without = lightMap(state);

    const w = state.chunk.width;
    const at = (g: { x: number; y: number }): number => g.y * w + g.x;
    const proof = emitters.find((m) => lit[at(m.grid)]! < without[at(m.grid)]!);
    expect(
      proof,
      "hiding a darkness-emitter must leave its grid BRIGHTER than before",
    ).toBeDefined();
  });

  it("monsterLightSources applies upstream's skips", () => {
    /*
     * The producer's own contract, documented rather than load-bearing: the
     * wiring tests above are what fail if it stops being called. Note the
     * `light === 0` skip is NOT asserted as observable - calcLighting drops
     * falsy sources itself (view.ts L351), so removing it from either place
     * changes nothing. It is kept because upstream keeps it, and a mutation
     * of it is unkillable by construction rather than untested.
     */
    const { state } = startGame(pack, { seed: SEED, depth: DEPTH });
    const bearers = bearersOf(state);

    const before = monsterLightSources(state);
    expect(before.length).toBe(bearers.length);
    expect(before.every((s) => s.light !== 0)).toBe(true);

    bearers[0]!.mflag.on(MFLAG.CAMOUFLAGE);
    expect(monsterLightSources(state).length).toBe(bearers.length - 1);
    bearers[0]!.mflag.off(MFLAG.CAMOUFLAGE);

    /* Every non-bearer is excluded, so the list is not just "all monsters". */
    let total = 0;
    for (let i = 1; i < state.monsters.length; i++) if (state.monsters[i]) total++;
    expect(total, "fixture: the level has non-bearers too").toBeGreaterThan(
      bearers.length,
    );
  });
});
