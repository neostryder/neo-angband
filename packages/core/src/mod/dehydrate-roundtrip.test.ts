/**
 * D1: an END-TO-END proof of the mod dehydrate/rehydrate (quarantine/rehydrate)
 * save path on a REALISTIC save (PORT_PLAN decision 19, MOD_LIFECYCLE section 6).
 *
 * The unit tests in save-blocks.test.ts prove the pure transforms over a
 * hand-built minimal fixture. This file instead starts a REAL game, serializes
 * it with the real serializeGame, injects mod-namespaced ("frost") content into
 * every id-bearing collection of the SavedGame (as if the run had been played
 * with a "frost" pack), and then exercises the full lifecycle against the real
 * serializers:
 *
 *   a. VANILLA-CLEAN + LOADABLE - quarantine with core-only present leaves NO
 *      reachable "frost:" id outside the orphans store, and the pruned save
 *      really LOADS via the real loadGame (deserializeGame) with only core
 *      registries: uninstalling the mod drops the save to a working vanilla
 *      state, no missing-mod id reaching a deserializer.
 *   b. BLOB PRESERVED VERBATIM - every injected entity sits in the orphan store
 *      with its payload deep-equal to the exact entity that was removed.
 *   c. orphanCount equals the number of injected entities.
 *   d. FULL RESTORE - rehydrate with the mod present again empties the store and
 *      returns every entity to its collection.
 *   e. ROUND-TRIP FIDELITY - the rehydrated save deep-equals the original
 *      pre-quarantine save EXCEPT the two ratified degradations (a rehydrated
 *      monster does not rebuild group cohesion; a rehydrated equipped item
 *      returns to the pack, not the slot) - and nothing else.
 *
 * Determinism: startGame takes a fixed seed; no wall-clock, no Math.random.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runGameLoop } from "../game/loop";
import type { PlayerCommand } from "../game/context";
import { loadGame, saveGame, startGame } from "../session/game";
import type { GamePack, StartedGame } from "../session/game";
import type {
  SavedGame,
  SavedLore,
  SavedMonster,
  SavedObject,
  SavedStoredLevel,
  SavedTrap,
} from "../session/save";
import { orphanCount, quarantineSave, rehydrateSave } from "./save-blocks";
import type { OrphanEntry, SaveManifest } from "./save-blocks";

/* ------------------------------------------------------------------ *
 * The standard headless pack fixture (mirrors session/save.test.ts).
 * ------------------------------------------------------------------ */

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
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

/** Play a few real turns so the save captures a mid-game state. */
function playTurns(game: StartedGame, count: number): void {
  const dirs = [6, 2, 4, 8, 6, 6, 2, 4];
  const commands: PlayerCommand[] = [];
  for (let i = 0; i < count; i++) {
    commands.push({ code: "walk", dir: dirs[i % dirs.length]! });
    commands.push({ code: "hold" });
  }
  game.state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;
  runGameLoop(game.state, game.registry);
}

/* ------------------------------------------------------------------ *
 * Helpers.
 * ------------------------------------------------------------------ */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A minimal mod SavedObject: only kindId matters to quarantine (it is pruned
 * before any deserializer sees it), so the rest is intentionally omitted. */
const frostObj = (kindId: string): SavedObject =>
  ({ kindId }) as unknown as SavedObject;

/** Find a grid coordinate no floor pile / trap cell already occupies. */
function freeCoord(
  used: Set<string>,
  w: number,
  h: number,
): { x: number; y: number } {
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (!used.has(`${x},${y}`)) return { x, y };
    }
  }
  throw new Error("no free coordinate in the test chunk");
}

/** Walk a value and assert no string carries a mod ("frost:") id. */
function assertNoFrostId(value: unknown, path: string): void {
  if (typeof value === "string") {
    expect(
      value.startsWith("frost:"),
      `leaked mod id at ${path}: ${value}`,
    ).toBe(false);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoFrostId(v, `${path}[${i}]`));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assertNoFrostId(v, `${path}.${k}`);
    }
  }
}

/* The pack set the save was written with: core + a "frost" mod at 1.2.0. The
 * determinism mode is "nondeterministic" to also prove the one-way ratchet
 * survives a mod uninstall (step 4, MOD_LIFECYCLE section 4). */
const manifest: SaveManifest = {
  packs: [
    { id: "core", version: "0.1.0" },
    { id: "frost", version: "1.2.0" },
  ],
  loadOrder: ["core", "frost"],
  determinism: "nondeterministic",
};

const coreOnly = (ns: string): boolean => ns === "core";
const bothPresent = (): boolean => true;

/**
 * Build a realistic "played with a mod" save: a real serialized game with one
 * frost entity injected into every id-bearing collection (live level AND the
 * frozen-level cache). Returns the original save plus the exact injected
 * payloads and the loci needed to model the two documented degradations.
 */
function buildModdedSave(): {
  original: SavedGame;
  injected: Array<{ kind: OrphanEntry["kind"]; ref: string; data: unknown }>;
  hostMidx: number;
  frostGroupIndex: number;
  frostLiveMidx: number;
  emptySlot: number;
  equippedHandle: number;
} {
  const game = startGame(pack, { seed: 20260716, depth: 5, className: "Mage" });
  playTurns(game, 6);
  const base = clone(saveGame(game));

  const original = clone(base);
  const injected: Array<{ kind: OrphanEntry["kind"]; ref: string; data: unknown }> = [];

  /* A surviving CORE monster to host a mod held object + lead a mod group. */
  const hostIdx = original.monsters.findIndex((m) => m !== null);
  expect(hostIdx).toBeGreaterThan(0);
  const hostMon = original.monsters[hostIdx]!;
  const hostMidx = hostMon.midx;

  const cw = base.chunk.width;
  const ch = base.chunk.height;
  const used = new Set(original.floor.map((p) => `${p.x},${p.y}`));

  /* --- 1. A whole mod monster on the level (in a mixed group). --- */
  const frostLiveMidx = original.monsters.length;
  const frostLiveMon = {
    raceId: "frost:frost-wyrm",
    originalRaceId: null,
    midx: frostLiveMidx,
    heldObj: [],
  } as unknown as SavedMonster;
  original.monsters.push(frostLiveMon);
  injected.push({ kind: "monster", ref: "frost:frost-wyrm", data: frostLiveMon });

  const frostGroupIndex = 999;
  original.groups.push({
    index: frostGroupIndex,
    leader: hostMidx,
    members: [hostMidx, frostLiveMidx],
  });

  /* --- 2. A mod object held by a surviving CORE monster (appended last). --- */
  const frostHeld = frostObj("frost:snowball");
  hostMon.heldObj.push(frostHeld);
  injected.push({ kind: "heldObject", ref: "frost:snowball", data: frostHeld });

  /* --- 3. Mod gear: one in the pack, one equipped (fresh handles). --- */
  const packHandle = base.gear.next;
  const equippedHandle = base.gear.next + 1;
  const frostPack = frostObj("frost:ice-brand");
  const frostEquip = frostObj("frost:frost-plate");
  original.gear.store.push([packHandle, frostPack]);
  original.gear.store.push([equippedHandle, frostEquip]);
  original.gear.pack.push(packHandle);
  original.gear.next = base.gear.next + 2;
  const emptySlot = original.player.equipment.findIndex((h) => h === 0);
  expect(emptySlot).toBeGreaterThanOrEqual(0);
  original.player.equipment[emptySlot] = equippedHandle;
  injected.push({ kind: "gearObject", ref: "frost:ice-brand", data: frostPack });
  injected.push({ kind: "gearObject", ref: "frost:frost-plate", data: frostEquip });

  /* --- 4. A mod object on a floor pile (its own pile, appended last). --- */
  const ff = freeCoord(used, cw, ch);
  used.add(`${ff.x},${ff.y}`);
  const frostFloor = frostObj("frost:ice-shard");
  original.floor.push({ x: ff.x, y: ff.y, objs: [frostFloor] });
  injected.push({ kind: "floorObject", ref: "frost:ice-shard", data: frostFloor });

  /* --- 5. A mod trap (its own cell, appended last). --- */
  const ft = freeCoord(used, cw, ch);
  used.add(`${ft.x},${ft.y}`);
  const frostTrap = { trapId: "frost:ice-spikes" } as unknown as SavedTrap;
  original.traps.push({ x: ft.x, y: ft.y, traps: [frostTrap] });
  injected.push({ kind: "trap", ref: "frost:ice-spikes", data: frostTrap });

  /* --- 6. A mod lore record (keyed by the mod race). --- */
  const frostLore = { sights: 1 } as unknown as SavedLore;
  (original.lore ??= []).push(["frost:frost-wyrm", frostLore]);
  injected.push({ kind: "lore", ref: "frost:frost-wyrm", data: frostLore });

  /* --- 7. A created mod artifact id. --- */
  (original.artifactsCreated ??= []).push("frost:icicle-of-doom");
  injected.push({
    kind: "artifactCreated",
    ref: "frost:icicle-of-doom",
    data: "frost:icicle-of-doom",
  });

  /* --- 8. The frozen-level cache (birth_levels_persist): a valid stored level
   * built from the live level's chunk/known, carrying a core monster (holding a
   * mod object), a whole mod monster, a mod floor pile and a mod trap. This is
   * the field D1 found uncovered - without the levelCache quarantine pass a mod
   * entity here reaches deserializeLevelCache on load and throws. --- */
  const cacheDepth = 3;
  const coreCacheMon = clone(hostMon);
  coreCacheMon.midx = 1;
  coreCacheMon.groupInfo = [];
  const frostCacheHeld = frostObj("frost:cache-charm");
  coreCacheMon.heldObj = [frostCacheHeld];
  const frostCacheMon = {
    raceId: "frost:frost-wyrm",
    originalRaceId: null,
    midx: 2,
    heldObj: [],
  } as unknown as SavedMonster;
  const frostCacheFloor = frostObj("frost:cache-shard");
  const frostCacheTrap = { trapId: "frost:cache-spikes" } as unknown as SavedTrap;
  const cachedLevel: SavedStoredLevel = {
    depth: cacheDepth,
    turn: base.turn,
    chunk: clone(base.chunk),
    ...(base.featLegend ? { featLegend: clone(base.featLegend) } : {}),
    monsters: [null, coreCacheMon, frostCacheMon],
    groups: [null],
    floor: [{ x: 2, y: 2, objs: [frostCacheFloor] }],
    traps: [{ x: 3, y: 3, traps: [frostCacheTrap] }],
    known: clone(base.known!),
    decoy: null,
  };
  original.levelCache = [cachedLevel];
  injected.push({ kind: "cacheMonster", ref: "frost:frost-wyrm", data: frostCacheMon });
  injected.push({
    kind: "cacheHeldObject",
    ref: "frost:cache-charm",
    data: frostCacheHeld,
  });
  injected.push({
    kind: "cacheFloorObject",
    ref: "frost:cache-shard",
    data: frostCacheFloor,
  });
  injected.push({ kind: "cacheTrap", ref: "frost:cache-spikes", data: frostCacheTrap });

  /* The manifest fingerprint + a per-mod private bag (opaque; must survive). */
  original.manifest = manifest;
  original.mods = { frost: { schema: 3, data: { seenWyrms: 2, note: "cold" } } };

  return {
    original,
    injected,
    hostMidx,
    frostGroupIndex,
    frostLiveMidx,
    emptySlot,
    equippedHandle,
  };
}

/* ------------------------------------------------------------------ *
 * The end-to-end lifecycle.
 * ------------------------------------------------------------------ */

describe("mod dehydrate/rehydrate end-to-end (D1, decision 19)", () => {
  it("quarantine leaves a vanilla-clean, loadable save (claim a)", () => {
    const { original } = buildModdedSave();
    const { save: quarantined } = quarantineSave(original, manifest, coreOnly);

    /* VANILLA-CLEAN: no reachable "frost:" id outside the orphans store. */
    const outsideOrphans = clone(quarantined);
    delete outsideOrphans.orphans;
    assertNoFrostId(outsideOrphans, "save");

    /* LOADABLE: the real deserialize path (loadGame) with only the core pack
     * present succeeds and yields a coherent vanilla game. This is the exact
     * assertion the levelCache fix exists for: an unhandled mod entity frozen in
     * save.levelCache would make deserializeLevelCache throw here. */
    const restored = loadGame(pack, quarantined, new Set(["core"]));
    expect(restored.state.actor.player).toBeTruthy();
    expect(restored.state.actor.player.cls.name).toBe("Mage");
    expect(restored.state.monsters.length).toBeGreaterThan(0);
    /* No mod race survived into the live monster list. */
    for (const m of restored.state.monsters) {
      if (m) expect(m.race.name.toLowerCase()).not.toContain("frost");
    }
    /* The frozen-level cache deserialized (1 cached level), core content intact. */
    expect(restored.state.levelCache?.size).toBe(1);
    const cached = restored.state.levelCache?.get(3);
    expect(cached).toBeDefined();
    for (const m of cached!.monsters) {
      if (m) expect(m.race.name.toLowerCase()).not.toContain("frost");
    }
  });

  it("quarantine preserves every entity's blob verbatim (claim b) and counts them (claim c)", () => {
    const { original, injected } = buildModdedSave();
    const { save: quarantined, quarantined: count } = quarantineSave(
      original,
      manifest,
      coreOnly,
    );

    /* orphanCount == the number of injected entities (claim c). */
    expect(count).toBe(injected.length);
    expect(orphanCount(quarantined.orphans)).toBe(injected.length);

    /* All frost orphans live under one <namespace>@<version> key. */
    const entries = quarantined.orphans?.["frost@1.2.0"];
    expect(entries).toBeDefined();
    expect(entries!.length).toBe(injected.length);

    /* Each injected entity is present with its payload deep-equal to the exact
     * entity that was removed (byte-verbatim dehydration - claim b). */
    for (const inj of injected) {
      const entry = entries!.find(
        (e) => e.kind === inj.kind && e.ref === inj.ref,
      );
      expect(entry, `missing orphan ${inj.kind}/${inj.ref}`).toBeDefined();
      expect(entry!.data).toEqual(inj.data);
    }
  });

  it("rehydrate fully restores the save except the two documented degradations (claims d, e)", () => {
    const {
      original,
      hostMidx,
      frostGroupIndex,
      frostLiveMidx,
      emptySlot,
      equippedHandle,
    } = buildModdedSave();

    const { save: quarantined } = quarantineSave(original, manifest, coreOnly);
    const rehydrated = rehydrateSave(quarantined, bothPresent);

    /* (d) The orphan store is gone and content is back where it belongs. */
    expect(rehydrated.orphans).toBeUndefined();
    expect(rehydrated.monsters[frostLiveMidx]?.raceId).toBe("frost:frost-wyrm");
    expect(
      rehydrated.monsters
        .find((m) => m?.midx === hostMidx)
        ?.heldObj.some((o) => o.kindId === "frost:snowball"),
    ).toBe(true);
    expect(rehydrated.gear.store.some(([, o]) => o.kindId === "frost:ice-brand")).toBe(
      true,
    );
    expect(rehydrated.gear.store.some(([, o]) => o.kindId === "frost:frost-plate")).toBe(
      true,
    );
    expect(rehydrated.floor.some((p) => p.objs.some((o) => o.kindId === "frost:ice-shard"))).toBe(
      true,
    );
    expect(rehydrated.traps.some((c) => c.traps.some((t) => t.trapId === "frost:ice-spikes"))).toBe(
      true,
    );
    expect(rehydrated.lore?.some(([id]) => id === "frost:frost-wyrm")).toBe(true);
    expect(rehydrated.artifactsCreated).toContain("frost:icicle-of-doom");
    /* The frozen-level cache is restored too. */
    const cache = rehydrated.levelCache?.[0];
    expect(cache?.monsters.some((m) => m?.raceId === "frost:frost-wyrm")).toBe(true);
    expect(
      cache?.monsters.find((m) => m?.midx === 1)?.heldObj.some((o) => o.kindId === "frost:cache-charm"),
    ).toBe(true);
    expect(cache?.floor.some((p) => p.objs.some((o) => o.kindId === "frost:cache-shard"))).toBe(
      true,
    );
    expect(cache?.traps.some((c) => c.traps.some((t) => t.trapId === "frost:cache-spikes"))).toBe(
      true,
    );

    /* (e) The rehydrated save deep-equals the original EXCEPT exactly the two
     * ratified degradations, modeled here on a clone of the original:
     *   1. group cohesion: the frost member is not re-added to its group;
     *   2. an equipped mod item returns to the pack, not the equipment slot.
     * If any OTHER field differs, this toEqual surfaces it as a bug. */
    const expected = clone(original);
    const grp = expected.groups.find((g) => g && g.index === frostGroupIndex)!;
    grp.members = [hostMidx];
    expected.player.equipment[emptySlot] = 0;
    expected.gear.pack.push(equippedHandle);

    expect(rehydrated).toEqual(expected);
  });

  it("the determinism ratchet and mod bag survive a mod uninstall (step 4)", () => {
    const { original } = buildModdedSave();
    const { save: quarantined } = quarantineSave(original, manifest, coreOnly);

    /* The mod bag is opaque and keyed - it is preserved verbatim even while the
     * mod is absent, so reinstalling restores the plugin's private state. */
    expect(quarantined.mods).toEqual(original.mods);

    /* Loading with the mod uninstalled keeps the one-way ratchet flipped: a
     * nondeterministic save never returns to deterministic (decision 22). */
    const restored = loadGame(pack, quarantined, new Set(["core"]));
    expect(restored.manifest.determinism).toBe("nondeterministic");
    expect(restored.mods).toEqual({
      frost: { schema: 3, data: { seenWyrms: 2, note: "cold" } },
    });
  });
});
