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
import { ArtifactState, ObjAllocState } from "../obj/make";
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
import { bindProjections } from "../world/projection";
import type { ProjectionInfo, ProjectionRecordJson } from "../world/projection";
import { bindTraps } from "../world/trap";
import type { TrapKind, TrapRecordJson } from "../world/trap";
import { StoreRegistry } from "../store/bind";
import type { StoreRecordJson } from "../store/types";
import { bindQuests } from "../game/quest";
import type { Quest, QuestRecordJson } from "../game/quest";
import { iToGrid } from "../gen/util";
import { resolvePits } from "../gen/gen-monster";

/** The base content pack as parsed JSON (pack zero, or a merged pack). */
export interface CorePack {
  constants: ConstantsJson;
  terrain: TerrainRecordJson[];
  roomTemplates: RoomTemplateRecordJson[];
  vaults: VaultRecordJson[];
  dungeonProfiles: DunProfileRecordJson[];
  obj: ObjPackJson;
  mon: MonsterPackRecords;
  /**
   * projection.json (PROJ_ element/damage table). Optional so old callers
   * keep working; without it startGame skips the effect-stack wiring
   * (monster spells, item use).
   */
  projection?: ProjectionRecordJson[];
  /** trap.json (trap kinds). Optional; without it levels have no traps. */
  trap?: TrapRecordJson[];
  /**
   * names.json (random-name corpus sections). Optional; without it flavor_init
   * has no scroll-title words, so unaware scrolls fall back to the plain
   * "& Scroll~" base form.
   */
  names?: NameSectionJson[];
  /** store.json (the 8 town stores). Optional; without it the town has no shops. */
  store?: StoreRecordJson[];
  /**
   * quest.json (the Sauron/Morgoth guardian quests). Optional; without it the
   * game has no quests and thus no win condition (headless tests / partial
   * packs), so is_quest is always false and quest_check a no-op.
   */
  quest?: QuestRecordJson[];
}

/** One names.txt section: a list of lowercase words under a section index. */
export interface NameSectionJson {
  section: number;
  word: string[];
}

/** Runtime registries bound from a pack. */
export interface CoreRegistries {
  constants: Constants;
  features: FeatureRegistry;
  objects: ObjRegistry;
  monsters: ReturnType<typeof bindMonsters>;
  rooms: RoomRegistry;
  profiles: DungeonProfiles;
  /** Bound projections (PROJ_-indexed), or null when the pack has none. */
  projections: ProjectionInfo[] | null;
  /** Bound trap kinds (t_idx-indexed), or null when the pack has none. */
  traps: TrapKind[] | null;
  /**
   * Random-name corpus, keyed by section index (RANDNAME_SCROLL = 2 for scroll
   * titles). Empty when the pack ships no names.json.
   */
  nameSections: Map<number, string[]>;
  /** Bound town stores (indexable by entrance feature), or null when none. */
  stores: StoreRegistry | null;
  /**
   * The standard quest table (player-quest.c quests[]), each guardian race
   * resolved. Empty when the pack ships no quest.json.
   */
  quests: Quest[];
}

/** Bind a parsed pack into the full set of runtime registries. */
export function bindCore(pack: CorePack): CoreRegistries {
  const constants = bindConstants(pack.constants);
  const features = new FeatureRegistry(pack.terrain);
  const objects = new ObjRegistry(pack.obj);
  const monsters = bindMonsters(pack.mon, { maxSight: constants.maxSight });
  const rooms = createRoomRegistry({
    templates: loadRoomTemplates(pack.roomTemplates),
    vaults: loadVaults(pack.vaults, constants.maxDepth),
  });
  const profiles = createDungeonProfiles(pack.dungeonProfiles);
  const projections = pack.projection ? bindProjections(pack.projection) : null;
  const traps = pack.trap ? bindTraps(pack.trap) : null;
  const nameSections = new Map<number, string[]>();
  for (const rec of pack.names ?? []) {
    nameSections.set(rec.section, rec.word);
  }
  const stores = pack.store ? new StoreRegistry(pack.store, objects) : null;
  const quests = pack.quest ? bindQuests(pack.quest, monsters) : [];
  return {
    constants,
    features,
    objects,
    monsters,
    rooms,
    profiles,
    projections,
    traps,
    nameSections,
    stores,
    quests,
  };
}

/**
 * Build the generator dependency bundle from bound registries.
 *
 * `artifacts` is the game's shared ArtifactState (aup_info[]); pass the
 * single per-game instance so every regenerated level marks the same
 * created flags. When omitted (standalone bootLevel / tests) a fresh
 * all-false instance is created. `noArtifacts` mirrors
 * OPT(player, birth_no_artifacts).
 */
export function genDeps(
  reg: CoreRegistries,
  placeContent: boolean,
  artifacts?: ArtifactState,
  noArtifacts = false,
): GenDeps {
  let objDeps: MakeDeps | null = null;
  let monDeps: MonPlaceDeps | null = null;
  if (placeContent) {
    objDeps = {
      reg: reg.objects,
      alloc: new ObjAllocState(reg.objects, reg.constants),
      constants: reg.constants,
      artifacts: artifacts ?? new ArtifactState(reg.objects.artifacts.length),
      noArtifacts,
    };
    monDeps = {
      table: new MonAllocTable(reg.monsters.races, {
        maxDepth: reg.constants.maxDepth,
        oodChance: reg.constants.oodMonsterChance,
        oodAmount: reg.constants.oodMonsterAmount,
      }),
      pits: resolvePits(reg.monsters),
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
  /**
   * The game's shared ArtifactState (aup_info[]). Pass it so the starting
   * level marks the same created flags the rest of the game references;
   * omitted, a fresh all-false instance is used (standalone boots/tests).
   */
  artifacts?: ArtifactState;
  /** OPT(player, birth_no_artifacts). */
  noArtifacts?: boolean;
}

/** A generated, populated level ready to hand to a renderer or game loop. */
export interface BootedLevel {
  chunk: Chunk;
  depth: number;
  playerSpot: Loc | null;
  monsters: readonly PlacedMonster[];
  objects: readonly PlacedObject[];
  /** Grids generation marked for player traps (instantiated at start). */
  trapGrids: readonly Loc[];
  /** Doors generation rolled locked (grid + lock power). */
  lockedDoors: readonly { grid: Loc; power: number }[];
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
  const deps = genDeps(
    registries,
    opts.placeContent ?? true,
    opts.artifacts,
    opts.noArtifacts ?? false,
  );
  const g = generateLevel(rng, depth, deps, opts.generate ?? {});
  return {
    chunk: g.c,
    depth,
    playerSpot: g.playerSpot,
    monsters: g.monsters,
    objects: g.objects,
    trapGrids: [...g.trapGrids].map((i) => iToGrid(i, g.c.width)),
    lockedDoors: g.lockedDoors,
    rng,
    registries,
  };
}
