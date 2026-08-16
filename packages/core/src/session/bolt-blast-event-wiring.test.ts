/**
 * cast.hooks.onBolt / onBlast have a producer, and it emits.
 *
 * WHAT THIS EXISTS TO CATCH. world/project.ts declares ProjectHooks.onBolt /
 * onBlast (the display_bolt / display_explosion seam, event_signal_bolt /
 * event_signal_blast in project.c:724,915) and project-cast.ts threads them
 * straight through CastHooks - but nothing in wireGame ever supplied them, so
 * a host that installs a "bolt"/"explosion" listener on state.events (the
 * web's traveling-spell animation, or a mod) never received one. Every other
 * cast.hooks member (monster/player/onTrackMonster) had a producer; these two
 * did not, which is why the game has never drawn a moving bolt in its life.
 *
 * Following teleport-env-wiring.test.ts's model: call the LIVE hooks wireGame
 * built directly, rather than re-driving a whole projection through dungeon
 * generation to get a monster into view. squareIsView/squareIsBelievedWall of
 * the player's OWN grid is always true, so using the player's grid as the
 * bolt's landing/blast grid gives a deterministic "seen" without needing a
 * real line of sight setup.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJ, TMD } from "../generated/index.js";
import { GameEvents } from "../events.js";
import type { BoltEventData, ExplosionEventData } from "../events.js";
import { loc } from "../loc.js";
import { PROJECT } from "../world/project.js";
import type { Projection } from "../world/project.js";
import { startGame } from "./game.js";
import type { GamePack, StartedGame } from "./game.js";

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
  quest: loadRecords("quest"),
  store: loadRecords("store"),
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

function started(seed: number, depth = 6): StartedGame {
  return startGame(pack, { seed, depth, className: "Warrior" });
}

describe("wireGame supplies cast.hooks.onBolt / onBlast", () => {
  it("onBolt emits a seen bolt event for a grid the player occupies", () => {
    const game = started(6101);
    const cast = game.wizardBundles.effect!.cast!;
    expect(cast.hooks?.onBolt, "wireGame must supply onBolt").toBeDefined();

    const events = new GameEvents();
    game.state.events = events;
    const seen: BoltEventData[] = [];
    events.on("bolt", (_type, data) => seen.push(data));

    const grid = game.state.actor.grid;
    const from = loc(grid.x - 1, grid.y);
    cast.hooks!.onBolt!({ from, to: grid }, PROJ.FIRE, false);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      projType: PROJ.FIRE,
      drawing: false,
      seen: true,
      beam: false,
      oy: from.y,
      ox: from.x,
      y: grid.y,
      x: grid.x,
    });
  });

  it("onBlast emits playerSeesGrid=true for a grid the player occupies", () => {
    const game = started(6102);
    const cast = game.wizardBundles.effect!.cast!;
    expect(cast.hooks?.onBlast, "wireGame must supply onBlast").toBeDefined();

    const events = new GameEvents();
    game.state.events = events;
    const seen: ExplosionEventData[] = [];
    events.on("explosion", (_type, data) => seen.push(data));

    const grid = game.state.actor.grid;
    const proj: Projection = {
      flg: PROJECT.PLAY,
      centre: grid,
      pathGrids: [],
      bolts: [],
      grids: [grid],
      distanceToGrid: [0],
      damAtDist: [],
    };
    cast.hooks!.onBlast!(proj, PROJ.FIRE);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.playerSeesGrid).toEqual([true]);
    expect(seen[0]!.blastGrid).toEqual([grid]);
    expect(seen[0]!.projType).toBe(PROJ.FIRE);
    expect(seen[0]!.drawing).toBe(false);
  });

  it("onBlast reads blind live, off the player's own timed state", () => {
    const game = started(6103);
    const cast = game.wizardBundles.effect!.cast!;
    const events = new GameEvents();
    game.state.events = events;
    const seen: ExplosionEventData[] = [];
    events.on("explosion", (_type, data) => seen.push(data));

    const grid = game.state.actor.grid;
    const proj: Projection = {
      flg: PROJECT.PLAY,
      centre: grid,
      pathGrids: [],
      bolts: [],
      grids: [grid],
      distanceToGrid: [0],
      damAtDist: [],
    };
    game.state.actor.player.timed[TMD.BLIND] = 5;
    cast.hooks!.onBlast!(proj, PROJ.FIRE);
    expect(seen[0]!.playerSeesGrid).toEqual([false]);
  });
});
