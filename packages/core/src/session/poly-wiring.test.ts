/**
 * obj/../game/poly.ts: polymorph reaches the shipped game.
 *
 * ProjectMonsterHooks declared `polymorph` and project_m called it, and NOTHING
 * supplied it - so a Wand of Polymorph rolled its saving throw, spent the
 * charge, and reported "maintains its shape" every single time. Two shipped
 * objects carry a MON_POLY effect, plus every CHAOS source.
 *
 * The unit tests in game/poly.test.ts run polyRace and polymorphMonster
 * directly; nothing they do can tell whether wireGame passes them on. So this
 * boots a real game and drives project_m with the LIVE hooks off
 * wizardBundles.effect.cast - the same object every cast, device and monster
 * spell reaches project_m through.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";
import { MFLAG, PROJ, RF } from "../generated/index.js";
import { PROJECT } from "../world/project.js";
import { projectMonster } from "../game/project-monster.js";
import type { ProjectMonsterCtx } from "../game/project-monster.js";

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

describe("polymorph is supplied on a real game (project-mon.c:1216)", () => {
  /**
   * A monster whose level always clears the saving throw. With dam 200 the
   * throw is randint1(190) + 10, so anything at level 11 or below passes on
   * every possible roll - the test cannot flake on the RNG, and it is not
   * secretly asserting the saving throw either way.
   */
  function lowLevelMonster(game: ReturnType<typeof startGame>) {
    const mon = game.state.monsters.find(
      (m) => m !== null && m.race.level <= 11 && !m.race.flags.has(RF.UNIQUE),
    );
    return mon ?? null;
  }

  function liveCtx(game: ReturnType<typeof startGame>): ProjectMonsterCtx {
    const cast = game.wizardBundles.effect?.cast;
    expect(cast, "wireGame built a cast context").toBeDefined();
    return {
      state: game.state,
      projections: cast?.projections ?? [],
      origin: {
        isPlayer: true,
        monster: 0,
        grid: game.state.actor.grid,
        charm: false,
      },
      hooks: cast?.hooks?.monster ?? {},
    };
  }

  it("wireGame supplies BOTH halves of the swap", () => {
    const game = startGame(pack, { seed: 31, depth: 3 });
    const hooks = game.wizardBundles.effect?.cast?.hooks?.monster;
    /* The whole defect was "declared, called, never supplied", so the presence
     * check IS the regression test. The behavioural one follows. */
    expect(typeof hooks?.polyRace).toBe("function");
    expect(typeof hooks?.replaceMonster).toBe("function");
  });

  it("actually replaces the monster on the grid", () => {
    /* Several seeds, because a level is not guaranteed to hold a low-level
     * non-unique - and a test that silently found nothing to polymorph would
     * pass while proving nothing. */
    let checked = 0;
    for (const seed of [31, 77, 108, 512, 991]) {
      const game = startGame(pack, { seed, depth: 3 });
      const mon = lowLevelMonster(game);
      if (!mon) continue;

      const state = game.state;
      const grid = mon.grid;
      const before = mon.race;
      mon.mflag.on(MFLAG.VISIBLE);

      projectMonster(liveCtx(game), 0, grid, 200, PROJ.MON_POLY, PROJECT.KILL);

      const now = state.monsters[state.chunk.mon(grid)] ?? null;
      /* poly_race can legitimately fail to find a race in its level band and
       * return the original (project-mon.c:79), which leaves the monster alone
       * - that is a real outcome, not a broken wire. What must NOT happen is
       * the old no-op: the monster still standing there as its old self with
       * the hook never having run. */
      expect(now, "the grid is not left empty by a successful poly").not.toBeNull();
      if (now && now.race !== before) {
        expect(now.race.flags.has(RF.UNIQUE)).toBe(false);
        expect(now.grid).toEqual(grid);
        checked++;
      }
    }
    expect(checked, "at least one seed polymorphed for real").toBeGreaterThan(0);
  });
});
