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

import { bindConstants } from "../constants.js";
import type { Constants, ConstantsJson } from "../constants.js";
import { Rng } from "../rng.js";
import type { RngState } from "../rng.js";
import type { Loc } from "../loc.js";
import type { Chunk } from "../world/chunk.js";
import { FeatureRegistry } from "../world/feature.js";
import type { TerrainRecordJson } from "../world/feature.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { bindChestTraps } from "../obj/chest.js";
import type { ChestTrapEntry, ChestTrapRecordJson } from "../obj/chest.js";
import { declareModMessageTypes } from "../mod/message-declarations.js";
import { ArtifactState, ObjAllocState } from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import { bindMonsters } from "../mon/bind.js";
import type { MonsterPackRecords } from "../mon/bind.js";
import { bindMonsterCategories } from "../mon/knowledge-groups.js";
import type { MonsterCategory, UiKnowledgeRecordJson } from "../mon/knowledge-groups.js";
import { MonAllocTable } from "../mon/make.js";
import type { LoreStore } from "../mon/lore.js";
import { declareModMonsterSpells } from "../mon/spell-declarations.js";
import { monSpells } from "../mon/spell-registry.js";
import {
  createRoomRegistry,
  loadRoomTemplates,
  loadVaults,
} from "../gen/room.js";
import type {
  RoomRegistry,
  RoomTemplateRecordJson,
  VaultRecordJson,
} from "../gen/room.js";
import { createDungeonProfiles } from "../gen/cave.js";
import type { DungeonProfiles, DunProfileRecordJson } from "../gen/cave.js";
import { generateLevel } from "../gen/generate.js";
import type { GenDeps, GenerateOptions } from "../gen/generate.js";
import type {
  Connector,
  GenTrap,
  MonPlaceDeps,
  PlacedMonster,
  PlacedObject,
} from "../gen/util.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionInfo, ProjectionRecordJson } from "../world/projection.js";
import { bindTraps } from "../world/trap.js";
import type { TrapKind, TrapRecordJson } from "../world/trap.js";
import { bindWorld } from "../world/topology.js";
import type { WorldRecordJson, WorldTopology } from "../world/topology.js";
import { StoreRegistry } from "../store/bind.js";
import type { StoreRecordJson } from "../store/types.js";
import { bindQuests } from "../game/quest.js";
import type { Quest, QuestRecordJson } from "../game/quest.js";
import { iToGrid } from "../gen/util.js";
import { resolvePits } from "../gen/gen-monster.js";

/** The base content pack as parsed JSON (pack zero, or a merged pack). */
export interface CorePack {
  constants: ConstantsJson;
  terrain: TerrainRecordJson[];
  roomTemplates: RoomTemplateRecordJson[];
  vaults: VaultRecordJson[];
  dungeonProfiles: DunProfileRecordJson[];
  /** chest_trap.json, optional for older partial CorePack callers. */
  chestTraps?: ChestTrapRecordJson[];
  /** world.json's named town/level graph, optional for older partial callers. */
  world?: WorldRecordJson[];
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
  /*
   * message_type.json (message types a pack coins, plus their sound samples).
   * Optional; without it a pack can only name the types compiled from
   * upstream's list-message.h. Arrives through composition rather than a
   * plugin call, exactly as projection.json does, because a plugin's
   * register() runs hundreds of statements AFTER bindCore - see #266.
   *
   * Typed as unknown[] rather than as the record shape ON PURPOSE: nothing has
   * validated this yet. declareModMessageTypes is the validator, it takes
   * unknown[] for that reason, and it reports refusals rather than throwing.
   * Declaring the validated shape here would be a type asserting a check that
   * has not happened, and would push a cast onto every caller.
   */
  messageTypes?: readonly unknown[];
  /*
   * Monster-spell names a pack coins (the declaration half of row 22 / #281).
   * Optional; without it a pack can only name the spells compiled from
   * upstream's list-mon-spells.h. Arrives through composition rather than a
   * plugin call, because a plugin's register() runs hundreds of statements
   * AFTER bindCore - the same ordering trap #266 fixed for message types.
   *
   * Typed as unknown[] rather than as the record shape ON PURPOSE: nothing has
   * validated this yet. declareModMonsterSpells is the validator, it takes
   * unknown[] for that reason, and it reports refusals rather than throwing.
   * Declaring the validated shape here would be a type asserting a check that
   * has not happened, and would push a cast onto every caller.
   */
  monsterSpells?: readonly unknown[];
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
  /**
   * ui_knowledge.json (thematic monster-knowledge categories for the '~' ->
   * Monsters browser). Optional; without it the browser has no categories and
   * every known monster falls into the "***Unclassified***" catch-all.
   */
  uiKnowledge?: UiKnowledgeRecordJson[];
  /**
   * hints.json (shopkeeper tip strings, ui-store.c hints). Optional; without
   * it prt_welcome skips the one_in_(3) hint branch and its main-stream draws.
   * Records use the compiled "H" field (or "text" after some compose paths).
   */
  hints?: Array<{ H?: string; text?: string }>;
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
  /** The composed chest-trap table used for creation, opening and disarming. */
  chestTraps: readonly ChestTrapEntry[];
  /** The composed named level graph; distinct from GameState.world hooks. */
  topology: WorldTopology;
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
  /**
   * Thematic monster-knowledge categories (ui_knowledge.txt), in file order.
   * Empty when the pack ships no ui_knowledge.json.
   */
  monsterCategories: MonsterCategory[];
  /**
   * Shopkeeper tip strings (hints.txt / hints.json), in upstream's list order -
   * REVERSE file order, because parse_hint prepends. Empty when
   * the pack ships no hints.json. ui-store.c prt_welcome draws against this
   * list when non-empty.
   */
  hints: readonly string[];
}

/** Bind a parsed pack into the full set of runtime registries. */
export function bindCore(pack: CorePack): CoreRegistries {
  /* A pack's own message types must resolve BEFORE anything binds a record that
   * names one. bindMonsters resolves msgt on spells (mon/bind.ts:609) and on
   * blow methods (:382), and bindProjections does the same; each REFUSES an
   * unknown name, so a late declaration is not merely late, it is fatal to the
   * record. declareModMessageTypes never throws - refusals are collected and
   * reported, because a throw here would take the whole boot with it.
   *
   * MEASURED, not assumed: moving this one call below bindMonsters turns
   * message-declarations.test.ts red on "blow method HIT: invalid msgt". The
   * call being PRESENT is not the property that matters - its POSITION is. #266
   */
  declareModMessageTypes(pack.messageTypes);
  /* Same ordering for monster spells (#281 / row 22). monSpells is module-level
   * so one character's mods cannot leak into the next: clear first, then declare
   * from the pack. bindMonsters resolves spell names through spellIndexOf; an
   * undeclared name throws mon: invalid spell name and takes the boot down.
   * declareModMonsterSpells never throws - refusals are collected. */
  monSpells.clear();
  declareModMonsterSpells(pack.monsterSpells);
  const constants = bindConstants(pack.constants);
  const chestTraps = bindChestTraps(pack.chestTraps);
  const topology = bindWorld(pack.world, constants.maxDepth);
  const features = new FeatureRegistry(pack.terrain);
  const objects = new ObjRegistry(pack.obj);
  const monsters = bindMonsters(pack.mon, { maxSight: constants.maxSight });
  const rooms = createRoomRegistry({
    templates: loadRoomTemplates(pack.roomTemplates),
    vaults: loadVaults(pack.vaults, constants.maxDepth),
  });
  const profiles = createDungeonProfiles(pack.dungeonProfiles);
  const projections = pack.projection ? bindProjections(pack.projection) : null;
  /* Upstream reads projections[] as a global, and obj-randart.c does so from
   * inside the object domain (add_brand L1951, add_resist / add_immunity's log
   * lines). Attach the bound table to the object registry so those sites read
   * the pack's real names rather than a mirror of them. */
  objects.projections = projections;
  const traps = pack.trap ? bindTraps(pack.trap) : null;
  /* names.txt words are prepended in C (init.c:1476); reverse each section so
   * index 0 is the last word in file order (matches name_sections lookup). */
  const nameSections = new Map<number, string[]>();
  for (const rec of pack.names ?? []) {
    nameSections.set(rec.section, [...rec.word].reverse());
  }
  const stores = pack.store ? new StoreRegistry(pack.store, objects) : null;
  const quests = pack.quest ? bindQuests(pack.quest, monsters) : [];
  const monsterCategories = bindMonsterCategories(pack.uiKnowledge ?? []);
  /* hints.txt: each H: line becomes a tip string (init.c parse_hint). Reversed
   * for the same reason names.txt is: the C handler prepends onto the list
   * (init.c:4297) and finish_parse_hints publishes the head, so `hints` is in
   * REVERSE file order. random_hint (ui-store.c:121-129) reservoir-samples over
   * that list, so file order picks a different tip from the same draws. */
  const hints: string[] = [];
  for (const rec of pack.hints ?? []) {
    const text = rec.H ?? rec.text;
    if (text) hints.push(text);
  }
  hints.reverse();
  return {
    constants,
    features,
    objects,
    monsters,
    rooms,
    profiles,
    chestTraps,
    topology,
    projections,
    traps,
    nameSections,
    stores,
    quests,
    monsterCategories,
    hints,
  };
}

/**
 * The three make_object / make_gold foils that depend on the PLAYER, not on the
 * content pack: obj_kind_can_browse's book rejection (obj-make.c L1185-1195,
 * which needs the class's book list), append_object_curse's TIMED_INC foil
 * (obj-curse.c L159-188, which needs the player timed table) and make_gold's
 * birth_no_selling inflation (obj-make.c L1310-1312).
 *
 * `"no-player"` is a real answer, not a default: a standalone level boot or a
 * stats run has no character, so none of the three can be evaluated. It is a
 * REQUIRED argument for exactly that reason - all three were absent from the
 * level-generation objDeps while being supplied to the store paths, and because
 * they were optional properties nothing anywhere said so. Two of them are RNG
 * draws (a rejected book re-rolls get_obj_num; a foiled curse is not appended),
 * so their absence moved the generation stream off upstream's.
 */
export type GenObjectFoils =
  | Pick<MakeDeps, "canBrowseBook" | "timedFoil" | "noSelling">
  | "no-player";

/**
 * Build the generator dependency bundle from bound registries.
 *
 * `artifacts` is the game's shared ArtifactState (aup_info[]); pass the
 * single per-game instance so every regenerated level marks the same
 * created flags. When omitted (standalone bootLevel / tests) a fresh
 * all-false instance is created. `noArtifacts` mirrors
 * OPT(player, birth_no_artifacts).
 *
 * `foils` is required; see GenObjectFoils for why.
 */
export function genDeps(
  reg: CoreRegistries,
  placeContent: boolean,
  foils: GenObjectFoils,
  artifacts?: ArtifactState,
  noArtifacts = false,
  lore?: LoreStore,
): GenDeps {
  let objDeps: MakeDeps | null = null;
  let monDeps: MonPlaceDeps | null = null;
  if (placeContent) {
    objDeps = {
      reg: reg.objects,
      alloc: new ObjAllocState(reg.objects, reg.constants),
      constants: reg.constants,
      chestTraps: reg.chestTraps,
      artifacts: artifacts ?? new ArtifactState(reg.objects.artifacts.length),
      noArtifacts,
      ...(foils === "no-player" ? {} : foils),
    };
    monDeps = {
      table: new MonAllocTable(reg.monsters.races, {
        maxDepth: reg.constants.maxDepth,
        oodChance: reg.constants.oodMonsterChance,
        oodAmount: reg.constants.oodMonsterAmount,
      }),
      pits: resolvePits(reg.monsters),
      /* mon_create_drop's unique theft reduction reads this; absent for
       * standalone boots => thefts 0 (never-stolen-from). */
      ...(lore ? { lore } : {}),
    };
  }
  return {
    reg: reg.features,
    constants: reg.constants,
    rooms: reg.rooms,
    profiles: reg.profiles,
    objDeps,
    monDeps,
    /* place_trap draws pick_trap + power into the gen stream (trap.c:356-394). */
    trapKinds: reg.traps,
  };
}

/** Options for booting a single level. */
export interface BootLevelOptions {
  /** RNG seed. Provide a real one; defaults to 1 for reproducible tests. */
  seed?: number;
  /**
   * An already-advanced main-game RNG instance (Decision 6.2). When present,
   * bootLevel continues from this stream instead of `new Rng(seed)`. Used so
   * birth UI draws and seed_randart share the same stream level gen continues.
   */
  rng?: Rng;
  /**
   * Snapshot to install on a fresh Rng(seed) before any draws (post-birth
   * reload: continue the stream the birth UI advanced). Ignored when `rng` is
   * supplied.
   */
  rngState?: RngState;
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
  /**
   * The composed behaviour of every enabled mod (mod/hooks.ts), passed through to
   * GenDeps so a mod can inspect, repair or reject a generated level. The only
   * hook cave_generate consults is `levelGenerated`. Omitted (the default, and
   * the only possibility with no mod enabled) = faithful 4.2.6.
   */
  modHooks?: import("../mod/hooks.js").ModHooks | undefined;
}

/** A generated, populated level ready to hand to a renderer or game loop. */
export interface BootedLevel {
  chunk: Chunk;
  depth: number;
  /**
   * chunk->join: the level's stair connectors (generate.c L1203-1214). Always
   * produced; only the persistent-level path has a use for it.
   */
  joins: readonly Connector[];
  playerSpot: Loc | null;
  monsters: readonly PlacedMonster[];
  objects: readonly PlacedObject[];
  /** Grids generation marked for player traps (instantiated at start). */
  trapGrids: readonly Loc[];
  /**
   * Traps whose kind and power were chosen at generation (place_trap). When
   * present, populate materializes these without a second pick/power draw.
   */
  traps: readonly GenTrap[];
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
  const rng = opts.rng ?? new Rng(opts.seed ?? 1);
  if (!opts.rng && opts.rngState) rng.setState(opts.rngState);
  const deps: GenDeps = {
    ...genDeps(
      registries,
      opts.placeContent ?? true,
      /* bootLevel produces a world, not a character - there is no class book
       * list and no player timed table to foil against. */
      "no-player",
      opts.artifacts,
      opts.noArtifacts ?? false,
    ),
    /* The mod behaviour seam; absent => faithful cave_generate. */
    ...(opts.modHooks ? { hooks: opts.modHooks } : {}),
  };
  const g = generateLevel(rng, depth, deps, opts.generate ?? {});
  g.c.name = registries.topology.nameAtDepth(depth);
  return {
    chunk: g.c,
    depth,
    /* chunk->join (generate.c L1203-1214). cave_generate populates it for EVERY
     * level including the first, and this used to be dropped on the floor here:
     * under birth_levels_persist the level the character starts on was frozen
     * with an empty connector list, so the first neighbour generated could not
     * line its stairs up with it. Returned unconditionally; startGame only
     * records it when the option is on, so a non-persistent savefile is
     * unchanged. */
    joins: g.joins,
    playerSpot: g.playerSpot,
    monsters: g.monsters,
    objects: g.objects,
    trapGrids: [...g.trapGrids].map((i) => iToGrid(i, g.c.width)),
    traps: g.traps,
    lockedDoors: g.lockedDoors,
    rng,
    registries,
  };
}
