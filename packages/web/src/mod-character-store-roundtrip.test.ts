/**
 * neo-angband#171: `ctx.characterStore` proven against a REAL save and load,
 * not just an in-memory StartedGame.
 *
 * The reconciliation math for mod-owned save data (namespaced blocks, orphan
 * quarantine, bag migration) is proven end-to-end in
 * core/src/mod/dehydrate-roundtrip.test.ts and core/src/session/save.test.ts's
 * own "a mod's private bag" case - both already show that `StartedGame.mods`
 * survives `saveGame`/`loadGame`. This file pins the WEB WIRING on top of that:
 * a plugin's `ctx.characterStore.set()` call, going through `main.ts`'s own
 * `setModCharacterStoreControl` shape (read/write `game.mods` fresh, keyed by
 * mod id), across a save that is round-tripped through a plain JSON string -
 * the same representation the save actually takes on disk - and back through
 * `loadGame`, read back by a freshly built `ctx.characterStore.get()`.
 *
 * The pack fixture mirrors dehydrate-roundtrip.test.ts's own (raw JSON content
 * files, not the web layer's `loadGamePack()` composition), because this test
 * needs a real playable game to hand `saveGame`/`loadGame`, not a real INSTALL -
 * paying for disk-pack composition here would buy nothing this test checks.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadGame, saveGame, startGame } from "@rpgm-tools/neo-angband-core";
import type { GamePack, ModBag, StartedGame } from "@rpgm-tools/neo-angband-core";
import { modPluginContext, setModCharacterStoreControl } from "./mod-context";
import type { ModCharacterStoreControl } from "./mod-context";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
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

/** The same shape main.ts's own boot path latches: read/write `game.mods` fresh. */
function controlFor(game: StartedGame): ModCharacterStoreControl {
  return {
    getBag: (id) => game.mods[id],
    setBag: (id, bag) => {
      const next = { ...game.mods };
      if (bag) next[id] = bag;
      else delete next[id];
      game.mods = next;
    },
    saveSchemaOf: (id) => (id === "frost" ? 3 : undefined),
  };
}

/** A plain JSON string round trip: the representation the save actually takes
 * on disk, so a bug hiding behind a live object reference cannot survive it. */
function throughDisk<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("ctx.characterStore survives a real save and load (#171)", () => {
  it("writes through ctx.characterStore, and a freshly loaded game reads the same value back", () => {
    const game = startGame(pack, { seed: 20260921, depth: 1, className: "Warrior" });
    setModCharacterStoreControl(controlFor(game));
    try {
      const ctx = modPluginContext("frost", {}, game.state);
      expect(ctx.characterStore?.get()).toBeNull();
      ctx.characterStore?.set({ seenWyrms: 2, note: "cold" });

      const onDisk = throughDisk(saveGame(game));
      const reloaded = loadGame(pack, onDisk);

      expect(reloaded.mods["frost"]).toEqual({
        schema: 3,
        data: { seenWyrms: 2, note: "cold" },
      });

      setModCharacterStoreControl(controlFor(reloaded));
      const reloadedCtx = modPluginContext("frost", {}, reloaded.state);
      expect(reloadedCtx.characterStore?.get()).toEqual({ seenWyrms: 2, note: "cold" });
    } finally {
      setModCharacterStoreControl(undefined);
    }
  });

  it("keeps two mods' bags apart across the same real save and load", () => {
    const game = startGame(pack, { seed: 20260921, depth: 1, className: "Warrior" });
    setModCharacterStoreControl(controlFor(game));
    try {
      modPluginContext("frost", {}, game.state).characterStore?.set({ mine: "frost" });
      modPluginContext("qol", {}, game.state).characterStore?.set({ mine: "qol" });

      const onDisk = throughDisk(saveGame(game));
      const reloaded = loadGame(pack, onDisk);
      setModCharacterStoreControl(controlFor(reloaded));

      expect(modPluginContext("frost", {}, reloaded.state).characterStore?.get()).toEqual({
        mine: "frost",
      });
      expect(modPluginContext("qol", {}, reloaded.state).characterStore?.get()).toEqual({
        mine: "qol",
      });
      const bags = reloaded.mods as Record<string, ModBag>;
      expect(bags["frost"]?.data).toEqual({ mine: "frost" });
      expect(bags["qol"]?.data).toEqual({ mine: "qol" });
    } finally {
      setModCharacterStoreControl(undefined);
    }
  });
});
