/**
 * Regression guard for audit 03 KN-01 CRITICAL / KN-02 HIGH: the progressive
 * object-knowledge layer was UNWIRED. object_touch (obj-knowledge.c L960-972),
 * which marks a floor object OBJ_NOTICE_ASSESSED - the bit that reveals its
 * combat bonus bracket and, for an artifact, its name - was never called from
 * the live paths. Upstream touches every object on the player's OWN grid via
 * square_know_pile (cave-square.c L1177-1181), and touches a picked-up object
 * via cmd-pickup.c. Before the fix ASSESSED was set ONLY by the identify-rune
 * effect, so stepping onto / picking up an item never revealed it.
 *
 * These tests drive the REAL wired game (startGame), placing an object on the
 * floor and exercising the two live entry points (game/known.ts squareKnowPile
 * and game/pickup.ts playerPickupItem), not the objectTouch primitive in
 * isolation - the finding was precisely that the primitive worked but was not
 * connected.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "../session/game";
import type { GamePack, StartedGame } from "../session/game";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson, ObjectKind, Artifact } from "../obj/types";
import { objectNew } from "../obj/object";
import { bindConstants } from "../constants";
import type { ConstantsJson } from "../constants";
import { OBJ_NOTICE } from "../obj/knowledge";
import { liveObjectIsKnownArtifact } from "../obj/artifact-known";
import { KF } from "../generated";
import { floorCarry } from "./floor";
import { squareKnowPile } from "./known";
import { playerPickupItem } from "./pickup";
import { describeObject } from "./describe";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const objPack = {
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
  obj: objPack as GamePack["obj"],
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

const reg = new ObjRegistry(objPack);

/** A weapon kind that shows its dice, for a real-object touch test. */
function weaponKind(): ObjectKind {
  const k = reg.kinds.find(
    (kk) =>
      kk.kidx < reg.ordinaryKindCount &&
      kk.kindFlags.has(KF.SHOW_DICE) &&
      kk.dd > 0 &&
      kk.ds > 0,
  );
  if (!k) throw new Error("no SHOW_DICE weapon kind in pack");
  return k;
}

/** Build a fresh, unidentified floor object of `kind`. */
function mkObj(kind: ObjectKind, art: Artifact | null = null) {
  const obj = objectNew(kind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.dd = kind.dd;
  obj.ds = kind.ds;
  obj.ac = kind.ac;
  obj.weight = kind.weight;
  obj.number = 1;
  obj.notice = 0; // NOT assessed
  obj.artifact = art;
  return obj;
}

function start(seed: number, depth: number): StartedGame {
  return startGame(pack, { seed, depth, className: "Warrior" });
}

describe("object knowledge is wired into the live game (audit 03 KN-01/KN-02)", () => {
  it("squareKnowPile touches (ASSESSES) an object on the player's own grid", () => {
    const game = start(5252, 2);
    const grid = game.state.actor.grid;
    const obj = mkObj(weaponKind());
    floorCarry(game.state, grid, obj);

    /* Before: the base dice bracket already shows (dd/ds runes are innate),
     * but the item is NOT assessed, so no combat-bonus bracket. */
    const before = describeObject(game.state, obj);
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(0);
    expect(before).toContain(`(${obj.dd}d${obj.ds})`);
    expect(before).not.toContain("(+0,+0)");

    squareKnowPile(game.state, grid);

    /* After: object_touch set ASSESSED, so the weapon's combat bracket shows. */
    expect(obj.notice & OBJ_NOTICE.ASSESSED).not.toBe(0);
    expect(describeObject(game.state, obj)).toContain("(+0,+0)");
  });

  it("squareKnowPile does NOT touch an object on a DIFFERENT grid (see, not touch)", () => {
    const game = start(5253, 2);
    const grid = game.state.actor.grid;
    /* Find a real object-holding neighbour so a placement failure can't make
     * this pass for the wrong reason (object_see records it, object_touch does
     * not - the player-grid gate in square_know_pile). */
    let other: { x: number; y: number } | null = null;
    const obj = mkObj(weaponKind());
    for (let dy = -1; dy <= 1 && !other; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const g = { x: grid.x + dx, y: grid.y + dy };
        if (game.state.chunk.isObjectHolding(g) && floorCarry(game.state, g, obj)) {
          other = g;
          break;
        }
      }
    }
    expect(other, "a holding neighbour grid should exist").not.toBeNull();

    squareKnowPile(game.state, other!);
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(0);
  });

  it("touching an artifact reveals it as a known artifact and logs the find", () => {
    const game = start(5254, 2);
    const grid = game.state.actor.grid;
    const art = { aidx: 1, name: "of Testing", tval: 1, sval: 1 } as unknown as Artifact;
    const obj = mkObj(weaponKind(), art);
    floorCarry(game.state, grid, obj);

    const found: Artifact[] = [];
    game.state.onArtifactFound = (a: Artifact): void => {
      found.push(a);
    };

    /* Before: not assessed, so the artifact is not yet a known artifact. */
    expect(liveObjectIsKnownArtifact(obj)).toBe(false);

    squareKnowPile(game.state, grid);

    expect(liveObjectIsKnownArtifact(obj)).toBe(true);
    expect(found).toContain(art);
  });

  it("picking an object up ASSESSES it on entry to the pack", () => {
    const game = start(5255, 2);
    const grid = game.state.actor.grid;
    const obj = mkObj(weaponKind());
    floorCarry(game.state, grid, obj);
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(0);

    playerPickupItem(game.state, obj, {
      constants: bindConstants(pack.constants as unknown as ConstantsJson),
    });

    expect(obj.notice & OBJ_NOTICE.ASSESSED).not.toBe(0);
  });
});
