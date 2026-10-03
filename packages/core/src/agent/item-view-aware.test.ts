/**
 * An ItemView for a kind the player is not aware of names it by its flavour,
 * as object_desc does: no kind name, kind key, real sval or content id. Once
 * the kind is learned, the real fields appear.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEAT, TV } from "../generated/index.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import type { ObjectKind } from "../obj/types.js";
import { objectValueBase } from "../obj/value.js";
import { ContentIdResolver } from "../mod/ids.js";
import { Rng } from "../rng.js";
import { startGame } from "../session/game.js";
import type { GamePack, StartedGame } from "../session/game.js";
import type { Store } from "../store/store.js";
import { invenCarry } from "../game/gear.js";
import { createAgentView } from "./perceive.js";
import type { ItemView } from "./types.js";

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

interface Fixture {
  game: StartedGame;
  potion: ObjectKind;
  scroll: ObjectKind;
  view: ReturnType<typeof createAgentView>;
  make(kind: ObjectKind): GameObject;
  /** The carried item of `kind`, by the handle it was carried under. */
  of(items: ItemView[], kind: ObjectKind): ItemView;
}

function fixture(): Fixture {
  const game = startGame(pack, { seed: 777, depth: 1 });
  const reg = game.booted.registries;
  const find = (tval: number, name: string): ObjectKind => {
    const kind = reg.objects.kinds.find((k) => k.tval === tval && k.name === name);
    if (!kind) throw new Error(`no kind ${name}`);
    return kind;
  };
  const potion = find(TV.POTION, "Speed");
  const scroll = find(TV.SCROLL, "Deep Descent");
  const make = (kind: ObjectKind): GameObject => {
    const obj = objectPrep(new Rng(1), reg.objects, reg.constants, kind, 1, "minimise");
    obj.notice |= OBJ_NOTICE.ASSESSED;
    obj.number = 1;
    return obj;
  };
  const handles = new Map<ObjectKind, number>();
  for (const kind of [potion, scroll]) {
    handles.set(kind, invenCarry(game.state.gear, game.state.actor.player, make(kind), {
      quiverSlotSize: reg.constants.quiverSlotSize,
      thrownQuiverMult: reg.constants.thrownQuiverMult,
    }));
  }
  const resolver = new ContentIdResolver({ objects: reg.objects });
  const view = createAgentView(game.state, undefined, { resolver, reg: reg.objects });
  const of = (items: ItemView[], kind: ObjectKind): ItemView => {
    const item = items.find((i) => i.handle === handles.get(kind));
    if (!item) throw new Error(`no ${kind.name} in view`);
    return item;
  };
  return { game, potion, scroll, view, make, of };
}

describe("ItemView names an unaware kind by its flavour", () => {
  it("shows no real name, key, sval or id for an unaware potion and scroll", () => {
    const { game, potion, scroll, view, make, of } = fixture();
    const items = view.inventory();
    for (const kind of [potion, scroll]) {
      expect(game.flavor.isAware(kind)).toBe(false);
      const flavor = game.state.flavorGlyph!(kind)!;
      const item = of(items, kind);
      expect(item).toMatchObject({
        aware: false,
        label: game.state.flavorText!(kind),
        kindKey: `flavor:${flavor.fidx}`,
        sval: -flavor.fidx,
        tval: kind.tval,
      });
      expect(item.kindId).toBeUndefined();
      expect(item.value).toBe(objectValueBase(make(kind), false));
      const text = JSON.stringify(item);
      expect(text).not.toContain(kind.name);
      expect(text).not.toContain(`kind:${kind.kidx}`);
      expect(text).not.toMatch(new RegExp(`"sval":${kind.sval}[,}]`));
    }
  });

  it("reveals the real fields once the kind is learned", () => {
    const { game, potion, scroll, view, of } = fixture();
    for (const kind of [potion, scroll]) game.flavor.setAware(kind);
    const items = view.inventory();
    for (const kind of [potion, scroll]) {
      const item = of(items, kind);
      expect(item).toMatchObject({
        aware: true,
        label: kind.name,
        kindKey: `kind:${kind.kidx}`,
        sval: kind.sval,
      });
      expect(item.kindId).toBeDefined();
      expect(item.value).toBe(kind.cost);
    }
  });

  it("names a shop's ware by its kind and the home's by its flavour", () => {
    const { game, potion, view, make } = fixture();
    const base = {
      owners: [{ index: 0, name: "Bilbo", maxCost: 500 }],
      owner: { index: 0, name: "Bilbo", maxCost: 500 },
      alwaysTable: [],
      normalTable: [],
      buy: null,
      turnover: 0,
      normalStockMin: 0,
      normalStockMax: 0,
      stockSize: 10,
    };
    game.state.stores = [
      { ...base, feat: FEAT.STORE_ALCHEMY, featName: "STORE_ALCHEMY", stock: [make(potion)] },
      { ...base, feat: FEAT.HOME, featName: "HOME", stock: [make(potion)] },
    ] as Store[];
    const [shop, home] = view.stores();
    expect(shop?.stock[0]).toMatchObject({ aware: true, label: potion.name, kindKey: `kind:${potion.kidx}` });
    expect(home?.stock[0]).toMatchObject({ aware: false, label: game.state.flavorText!(potion) });
    expect(JSON.stringify(home?.stock[0])).not.toContain(potion.name);
  });
});
