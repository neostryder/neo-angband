/**
 * Game boot / assembly seam.
 *
 * This is the join between the individual ported domains and a running
 * game. `bindCore` turns a parsed content pack into the full set of
 * runtime registries; `bootLevel` uses them to generate a populated
 * starting level with a player spot. It is deliberately headless and
 * takes already-parsed pack JSON (no filesystem, no fetch), so the same
 * function serves tests, the web front end, and any future host.
 *
 * Everything here composes public domain APIs only; it adds no game
 * rules of its own. It is also the natural place a mod-aware loader will
 * later assemble registries from more than one pack in load order.
 */

import { bindConstants } from "../constants";
import type { Constants, ConstantsJson } from "../constants";
import { Rng } from "../rng";
import type { Loc } from "../loc";
import type { Chunk } from "../world/chunk";
import { FeatureRegistry } from "../world/feature";
import type { TerrainRecordJson } from "../world/feature";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { ObjAllocState } from "../obj/make";
import type { MakeDeps } from "../obj/make";
import { bindMonsters } from "../mon/bind";
import type { MonsterPackRecords } from "../mon/bind";
import { MonAllocTable } from "../mon/make";
import {
  createRoomRegistry,
  loadRoomTemplates,
  loadVaults,
} from "../gen/room";
import type {
  RoomRegistry,
  RoomTemplateRecordJson,
  VaultRecordJson,
} from "../gen/room";
import { createDungeonProfiles } from "../gen/cave";
import type { DungeonProfiles, DunProfileRecordJson } from "../gen/cave";
import { generateLevel } from "../gen/generate";
import type { GenDeps, GenerateOptions } from "../gen/generate";
import type { MonPlaceDeps, PlacedMonster, PlacedObject } from "../gen/util";

/** The base content pack as parsed JSON (pack zero, or a merged pack). */
export interface CorePack {
  constants: ConstantsJson;
  terrain: TerrainRecordJson[];
  roomTemplates: RoomTemplateRecordJson[];
  vaults: VaultRecordJson[];
  dungeonProfiles: DunProfileRecordJson[];
  obj: ObjPackJson;
  mon: MonsterPackRecords;
}

/** Runtime registries bound from a pack. */
export interface CoreRegistries {
  constants: Constants;
  features: FeatureRegistry;
  objects: ObjRegistry;
  monsters: ReturnType<typeof bindMonsters>;
  rooms: RoomRegistry;
  profiles: DungeonProfiles;
}

/** Bind a parsed pack into the full set of runtime registries. */
export function bindCore(pack: CorePack): CoreRegistries {
  const constants = bindConstants(pack.constants);
  const features = new FeatureRegistry(pack.terrain);
  const objects = new ObjRegistry(pack.obj);
  const monsters = bindMonsters(pack.mon, { maxSight: constants.maxSight });
  const rooms = createRoomRegistry({
    templates: loadRoomTemplates(pack.roomTemplates),
    vaults: loadVaults(pack.vaults),
  });
  const profiles = createDungeonProfiles(pack.dungeonProfiles);
  return { constants, features, objects, monsters, rooms, profiles };
}

/** Build the generator dependency bundle from bound registries. */
export function genDeps(
  reg: CoreRegistries,
  placeContent: boolean,
): GenDeps {
  let objDeps: MakeDeps | null = null;
  let monDeps: MonPlaceDeps | null = null;
  if (placeContent) {
    objDeps = {
      reg: reg.objects,
      alloc: new ObjAllocState(reg.objects, reg.constants),
      constants: reg.constants,
    };
    monDeps = {
      table: new MonAllocTable(reg.monsters.races, {
        maxDepth: reg.constants.maxDepth,
        oodChance: reg.constants.oodMonsterChance,
        oodAmount: reg.constants.oodMonsterAmount,
      }),
    };
  }
  return {
    reg: reg.features,
    constants: reg.constants,
    rooms: reg.rooms,
    profiles: reg.profiles,
    objDeps,
    monDeps,
  };
}

/** Options for booting a single level. */
export interface BootLevelOptions {
  /** RNG seed. Provide a real one; defaults to 1 for reproducible tests. */
  seed?: number;
  /** Dungeon depth (0 = town). Default 1. */
  depth?: number;
  /** Place monsters and objects. Default true. */
  placeContent?: boolean;
  /** Pass-through generation options (quest, min dimensions, tries). */
  generate?: GenerateOptions;
  /** Reuse already-bound registries instead of rebinding the pack. */
  registries?: CoreRegistries;
}

/** A generated, populated level ready to hand to a renderer or game loop. */
export interface BootedLevel {
  chunk: Chunk;
  depth: number;
  playerSpot: Loc | null;
  monsters: readonly PlacedMonster[];
  objects: readonly PlacedObject[];
  rng: Rng;
  registries: CoreRegistries;
}

/**
 * Assemble registries (unless provided) and generate one level. This is
 * the smallest "boot a real game world" entry point: pack in, playable
 * level out. It does not yet birth a player character or start a turn
 * loop - it produces the world and the spot the player would occupy.
 */
export function bootLevel(pack: CorePack, opts: BootLevelOptions = {}): BootedLevel {
  const registries = opts.registries ?? bindCore(pack);
  const depth = opts.depth ?? 1;
  const rng = new Rng(opts.seed ?? 1);
  const deps = genDeps(registries, opts.placeContent ?? true);
  const g = generateLevel(rng, depth, deps, opts.generate ?? {});
  return {
    chunk: g.c,
    depth,
    playerSpot: g.playerSpot,
    monsters: g.monsters,
    objects: g.objects,
    rng,
    registries,
  };
}
