/**
 * W1 lane C — the save round-trip FIELD-COVERAGE guard.
 *
 * `save.test.ts` proves that named features survive a reload (stores, quests,
 * messages, options, …). What it cannot catch is a field that quietly stops
 * being written, or a field upstream grows that the port never learns about:
 * every assertion there is hand-written per feature, so silence is passing.
 *
 * This file closes that hole from the C side. `reference/src/save.c` is the
 * oracle. Three guards, all driven off one table:
 *
 *  1. C-SIDE COUNT. save.c is re-read and the `wr_byte` / `wr_u16b` / … call
 *     sites inside each `wr_*` function are counted. The table below declares
 *     the expected count per function. A field added to (or removed from)
 *     upstream changes a count and this fails, naming the function. (It counts
 *     write CALL SITES, not runtime fields: a field added inside an existing
 *     loop body would still be caught - that is a new call site - but a wider
 *     loop bound would not. Stated so the guard is not over-claimed.)
 *
 *  2. PORT-SIDE PRESENCE. Every table row with `port` set names a JSON path
 *     into a real mid-game `saveGame()` document. A field dropped from the
 *     serializer stops resolving and this fails, naming the C block. Rows with
 *     `na` carry the scope rule instead; rows with `gap` carry the C citation
 *     for a field the port genuinely does not save.
 *
 *  3. LOADER ROUND-TRIP. save -> load -> save must be byte-identical, and each
 *     scalar leaf named in the table must survive a *mutated* reload. This is
 *     the half that bites when the writer keeps a field but the reader ignores
 *     it: presence alone would pass, mutation survival would not.
 *
 * Oracle: Angband 4.2.6 under `reference/` (read-only).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEAT, TV } from "../generated";
import { objectNew } from "../obj/object";
import type { ObjectKind } from "../obj/types";
import { getLore } from "../mon/lore";
import { installTrap } from "../game/trap";
import { runGameLoop } from "../game/loop";
import type { PlayerCommand } from "../game/context";
import { loadGame, saveGame, startGame } from "./game";
import type { GamePack, StartedGame } from "./game";
import type { SavedGame } from "./save";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const saveC = readFileSync(
  path.join(repoRoot, "reference", "src", "save.c"),
  "utf8",
);

/* ------------------------------------------------------------------ *
 * Guard 1 machinery: count wr_* call sites per wr_* function in save.c.
 * ------------------------------------------------------------------ */

/** Every primitive writer savefile.h exposes (savefile.c wr_* family). */
const WRITERS = ["wr_byte", "wr_u16b", "wr_s16b", "wr_u32b", "wr_s32b", "wr_string"];

/**
 * Split save.c into its `wr_*` function bodies and count the primitive write
 * call sites in each. Brace-matched from the opening `{` so a nested block or
 * a helper call cannot leak into the next function's tally.
 */
function countWritesPerFunction(src: string): Map<string, number> {
  const out = new Map<string, number>();
  const header = /^(?:static\s+)?void\s+(wr_[a-z_]+)\s*\([^)]*\)\s*$/gm;
  for (let m = header.exec(src); m !== null; m = header.exec(src)) {
    const name = m[1] as string;
    const open = src.indexOf("{", m.index + m[0].length);
    expect(open, `no body found for ${name}`).toBeGreaterThan(-1);
    let depth = 0;
    let end = open;
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = src.slice(open, end);
    let n = 0;
    for (const w of WRITERS) {
      /* \b so wr_u16b does not also match inside a longer identifier. */
      const re = new RegExp(`\\b${w}\\s*\\(`, "g");
      n += (body.match(re) ?? []).length;
    }
    out.set(name, n);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The table: one row per save.c block.
 * ------------------------------------------------------------------ */

interface Block {
  /** The C function name, exactly as it appears in save.c. */
  c: string;
  /** Its definition line in reference/src/save.c. */
  line: number;
  /** Expected number of primitive write call sites in its body (guard 1). */
  writes: number;
  /**
   * JSON paths into a saveGame() document that carry this block's fields
   * (guard 2). Every listed path must resolve to a defined value.
   */
  port?: string[];
  /**
   * Scalar leaf paths that must survive a mutated reload (guard 3). Each is
   * given a replacement value that the loader must carry back out.
   */
  mutate?: Array<[string, number | string | boolean]>;
  /**
   * Paths this block writes only under a condition the shared fixture does not
   * meet (dead save, birth_randarts). Documented here so the block stays fully
   * mapped; each has its own dedicated test naming the covering condition.
   */
  portConditional?: Array<[string, string]>;
  /** Scope rule for fields with no counterpart by design. */
  na?: string;
  /** A field the port genuinely fails to save (reported, not fixed). */
  gap?: string;
}

const BLOCKS: Block[] = [
  {
    c: "wr_description",
    line: 49,
    writes: 1,
    na: "a display string (full_name, L<lev> <race> <class>, at DL<depth>) rebuilt on demand from fields the save already carries",
  },
  {
    c: "wr_item",
    line: 72,
    writes: 52,
    port: [
      "gear.store[0][1].kindId",
      "gear.store[0][1].tval",
      "gear.store[0][1].sval",
      "gear.store[0][1].pval",
      "gear.store[0][1].number",
      "gear.store[0][1].weight",
      "gear.store[0][1].artifactId",
      "gear.store[0][1].egoId",
      "gear.store[0][1].effectPresent",
      "gear.store[0][1].timeout",
      "gear.store[0][1].toH",
      "gear.store[0][1].toD",
      "gear.store[0][1].toA",
      "gear.store[0][1].ac",
      "gear.store[0][1].dd",
      "gear.store[0][1].ds",
      "gear.store[0][1].origin",
      "gear.store[0][1].originDepth",
      "gear.store[0][1].originRaceId",
      "gear.store[0][1].notice",
      "gear.store[0][1].flags",
      "gear.store[0][1].modifiers",
      "gear.store[0][1].brands",
      "gear.store[0][1].slays",
      "gear.store[0][1].curses",
      "gear.store[0][1].elInfo",
      "gear.store[0][1].heldMIdx",
      "gear.store[0][1].mimickingMIdx",
      "gear.store[0][1].activationIndex",
      "gear.store[0][1].time",
      "gear.store[0][1].note",
    ],
    mutate: [
      ["gear.store[0][1].toH", 13],
      ["gear.store[0][1].timeout", 77],
      ["gear.store[0][1].originDepth", 41],
      ["gear.store[0][1].notice", 6],
      ["gear.store[0][1].note", "@w1"],
    ],
    na: "obj->oidx: the port has no c->objects[] index (game/floor.ts documents the pile map as the object list). tval/sval names are the kindId.",
  },
  {
    c: "wr_monster",
    line: 204,
    writes: 21,
    port: [
      "monsters[1].raceId",
      "monsters[1].originalRaceId",
      "monsters[1].grid",
      "monsters[1].hp",
      "monsters[1].maxhp",
      "monsters[1].mspeed",
      "monsters[1].energy",
      "monsters[1].mTimed",
      "monsters[1].mflag",
      "monsters[1].knownPstateFlags",
      "monsters[1].knownPstateElInfo",
      "monsters[1].mimickedObj",
      "monsters[1].heldObj",
      "monsters[1].groupInfo",
      "monsters[1].midx",
    ],
    mutate: [
      ["monsters[1].hp", 3],
      ["monsters[1].maxhp", 44],
      ["monsters[1].mspeed", 121],
      ["monsters[1].energy", 55],
    ],
  },
  {
    c: "wr_trap",
    line: 261,
    writes: 7,
    port: [
      "traps[0].traps[0].trapId",
      "traps[0].traps[0].grid",
      "traps[0].traps[0].power",
      "traps[0].traps[0].timeout",
      "traps[0].traps[0].flags",
    ],
    mutate: [
      ["traps[0].traps[0].power", 5],
      ["traps[0].traps[0].timeout", 9],
    ],
  },
  {
    c: "wr_randomizer",
    line: 286,
    writes: 7,
    port: ["rng"],
    na: "Rand_value / state_i / STATE[] are the xoshiro-free upstream RNG; the port persists its own RngState, and save.test.ts asserts the stream resumes identically.",
  },
  {
    c: "wr_options",
    line: 314,
    writes: 7,
    port: [
      "options.values",
      "options.birth",
      "options.hitpointWarn",
      "options.delayFactor",
      "options.lazymoveDelay",
    ],
    mutate: [
      ["options.hitpointWarn", 7],
      ["options.delayFactor", 21],
      ["options.lazymoveDelay", 33],
    ],
    na: "SIDEBAR_MODE (save.c:320) is a ui-term.h global, not game state.",
  },
  {
    c: "wr_messages",
    line: 339,
    writes: 3,
    port: ["messages[0].str", "messages[0].type"],
    mutate: [["messages[0].type", 4]],
  },
  {
    c: "wr_monster_memory",
    line: 356,
    writes: 5,
    port: ["lore[0][0]", "lore[0][1].pkills", "lore[0][1].thefts"],
    mutate: [
      ["lore[0][1].pkills", 12],
      ["lore[0][1].thefts", 3],
    ],
  },
  {
    c: "wr_object_memory",
    line: 377,
    writes: 8,
    port: [
      "flavor.aware",
      "flavor.tried",
      "everseen.kinds",
      "ignore.kindAware",
      "ignore.kindUnaware",
    ],
    na: "the OF_SIZE / OBJ_MOD_MAX / ELEM_MAX / brand_max / slay_max / curse_max header bytes (save.c:381-387) are array-size checks for the binary reader; the JSON arrays are self-describing.",
  },
  {
    c: "wr_quests",
    line: 405,
    writes: 3,
    port: ["player.quests[0].level", "player.quests[0].curNum"],
    mutate: [["player.quests[0].level", 66]],
  },
  {
    c: "wr_player",
    line: 418,
    writes: 54,
    port: [
      "player.fullName",
      "player.diedFrom",
      "player.history",
      "player.raceName",
      "player.shapeName",
      "player.clsName",
      "nameSuffix",
      "player.hitdie",
      "player.expFactor",
      "player.age",
      "player.ht",
      "player.wt",
      "player.statMax",
      "player.statCur",
      "player.statMap",
      "player.statBirth",
      "player.htBirth",
      "player.wtBirth",
      "player.auBirth",
      "player.au",
      "player.maxExp",
      "player.exp",
      "player.expFrac",
      "player.lev",
      "player.mhp",
      "player.chp",
      "player.chpFrac",
      "player.msp",
      "player.csp",
      "player.cspFrac",
      "player.maxLev",
      "player.maxDepth",
      "player.recallDepth",
      "arena.oldGrid",
      "skipCmdCoercion",
      "unignoring",
      "player.deepDescent",
      "actor.energy",
      "player.wordRecall",
      "player.timed",
      "actor.totalEnergy",
      "restingTurn",
    ],
    mutate: [
      ["player.au", 98765],
      ["player.maxExp", 4321],
      ["player.expFrac", 99],
      ["player.chpFrac", 7],
      ["player.cspFrac", 11],
      ["player.age", 39],
      ["player.ht", 71],
      ["player.wt", 152],
      ["player.htBirth", 70],
      ["player.wtBirth", 150],
      ["player.auBirth", 321],
      ["player.hitdie", 12],
      ["player.expFactor", 133],
      ["player.maxDepth", 17],
      ["player.recallDepth", 9],
      ["player.wordRecall", 15],
      ["player.deepDescent", 4],
      ["player.fullName", "W1 Tester"],
      ["player.history", "Rewritten by the field guard."],
      ["restingTurn", 4242],
      ["skipCmdCoercion", 2],
      ["unignoring", 1],
      ["nameSuffix", 3],
      ["actor.totalEnergy", 987],
    ],
    na: "player->body (name/count/slot types+names, save.c:456-461) is always bodies[race->body] (player-birth.c:376 is the only assignment), so deriving it from the restored race is exact. The three padding writes (save.c:453 wr_s16b(0), :463 wr_u32b(0), :486-487 the two 'oops' zeroes) and the 8-word future-use tail (save.c:509) carry nothing.",
  },
  {
    c: "wr_ignore",
    line: 514,
    writes: 17,
    port: [
      "ignore.level",
      "ignore.ego",
      "everseen.egos",
      "autoinscriptions[0].kindId",
      /* The rune auto-inscription block, save.c:586-605 / load.c:937-945:
       * rune_note(k) per rune carrying a note. Keyed by runeKey rather than the
       * raw rune index wr_s16b writes - see obj/knowledge.ts runeKey. */
      "runeNotes[0][1]",
    ],
    mutate: [
      ["autoinscriptions[0].aware", "{squelch}"],
      ["runeNotes[0][1]", "{rune}"],
    ],
  },
  {
    c: "wr_misc",
    line: 610,
    writes: 19,
    portConditional: [
      [
        "randartSeed",
        "omitted unless birth_randarts is on (save.ts:1220); covered by save.test.ts \"swaps the artifact set and persists the seed reproducibly\"",
      ],
    ],
    port: [
      "seedFlavor",
      "player.totalWinner",
      "player.noscore",
      "isDead",
      "turn",
      "player.objKnown.flags",
      "player.objKnown.modifiers",
      "player.objKnown.elInfo",
      "player.objKnown.brands",
      "player.objKnown.slays",
      "player.objKnown.curses",
      "player.objKnown.ac",
      "player.objKnown.toA",
      "player.objKnown.toH",
      "player.objKnown.toD",
      "player.objKnown.dd",
      "player.objKnown.ds",
    ],
    mutate: [
      ["turn", 31337],
      ["seedFlavor", 24680],
      ["player.noscore", 8],
      ["player.objKnown.toH", 5],
      ["player.objKnown.dd", 3],
    ],
  },
  {
    c: "wr_artifacts",
    line: 674,
    writes: 5,
    port: ["artifactsCreated", "artifactsSeen", "artifactsEverseen"],
    na: "the fourth per-artifact byte (save.c:686) is written as a literal 0 and read back into nothing.",
  },
  {
    c: "wr_player_hp",
    line: 692,
    writes: 2,
    port: ["player.playerHp"],
  },
  {
    c: "wr_player_spells",
    line: 702,
    writes: 3,
    port: ["player.spellFlags", "player.spellOrder"],
  },
  {
    c: "wr_gear_aux",
    line: 715,
    writes: 2,
    port: ["gear.pack", "gear.next", "player.equipment"],
    mutate: [["gear.next", 99]],
  },
  {
    c: "wr_gear",
    line: 737,
    writes: 0,
    port: ["gear.store"],
    na: "player->gear_k, the parallel known-gear list, is the obj->known twin the port does not keep (obj/knowledge.ts:22-27 ledgers it).",
  },
  {
    c: "wr_stores",
    line: 744,
    writes: 3,
    port: ["stores[0].ownerIndex", "stores[0].stock"],
    mutate: [["stores[0].ownerIndex", 1]],
    na: "wr_stores writes wr_item(obj->known) beside each wr_item(obj) (save.c:762-763): the known twin again.",
  },
  {
    c: "wr_dungeon_aux",
    line: 774,
    writes: 19,
    port: [
      "chunk.name",
      "chunk.height",
      "chunk.width",
      "chunk.infos",
      "chunk.feats",
      "chunk.feeling",
      "chunk.feelingSquares",
      "chunk.turn",
      "featLegend",
    ],
    mutate: [
      ["chunk.feeling", 7],
      ["chunk.feelingSquares", 3],
      ["chunk.name", "Guarded Level"],
    ],
    na: "the run-length encoding of info/feat (save.c:783-841) is a byte-stream compression; the JSON stores the arrays directly. c->join and its 0xff sentinel (save.c:846-865) ride SavedGame.currentJoins / SavedStoredLevel.join. The C comment at save.c:770-772 confirms cost/when (noise/scent) are deliberately NOT saved - the port matches, and only carries them under the opt-in bugfix.noiseScentSave mod.",
  },
  {
    c: "wr_objects_aux",
    line: 873,
    writes: 1,
    port: ["floor[0].x", "floor[0].y", "floor[0].objs"],
    na: "c->obj_max and the dummy 0xffff terminator record are binary-stream framing.",
  },
  {
    c: "wr_monsters_aux",
    line: 915,
    writes: 1,
    port: ["monsters", "groups"],
    na: "cave_monster_max is the array length, implicit in JSON.",
  },
  {
    c: "wr_traps_aux",
    line: 933,
    writes: 1,
    port: ["traps"],
    na: "the TRF_SIZE header byte and the dummy terminator trap are binary framing.",
  },
  {
    c: "wr_dungeon",
    line: 959,
    writes: 5,
    port: ["daycount", "actor.grid"],
    portConditional: [
      [
        "dungeonDepth",
        "written only for a dead save, where save.c:965-971 returns before wr_dungeon_aux and the live blocks are omitted; see the dedicated dead-save test below",
      ],
    ],
    mutate: [["daycount", 6]],
    na: "SQUARE_SIZE (save.c:966) is an array-size header for the binary reader.",
  },
  { c: "wr_objects", line: 980, writes: 0, port: ["floor"] },
  { c: "wr_monsters", line: 986, writes: 0, port: ["monsters"] },
  { c: "wr_traps", line: 992, writes: 0, port: ["traps"] },
  {
    c: "wr_chunks",
    line: 1001,
    writes: 12,
    port: ["townChunk", "townFeatLegend"],
    na: "the birth_levels_persist per-chunk tail (name/turn/depth/feeling/obj_rating/mon_rating/good_item/height/width/feeling_squares/feat_count, save.c:1029-1043) rides SavedStoredLevel + ChunkSquaresData; persist-levels.test.ts drives that path. With the option OFF, upstream still stores the Town entry - SavedGame.townChunk.",
  },
  {
    c: "wr_history",
    line: 1048,
    writes: 9,
    port: [
      "player.hist[0].type",
      "player.hist[0].turn",
      "player.hist[0].dlev",
      "player.hist[0].clev",
      "player.hist[0].artifactName",
      "player.hist[0].event",
    ],
    mutate: [
      ["player.hist[0].dlev", 23],
      ["player.hist[0].clev", 4],
      ["player.hist[0].event", "Guarded history line."],
    ],
  },
];

/* ------------------------------------------------------------------ *
 * Path helpers.
 * ------------------------------------------------------------------ */

type Json = unknown;

/** Resolve "a.b[0].c" against a JSON document; undefined when any hop misses. */
function getPath(root: Json, spec: string): Json {
  let cur: Json = root;
  for (const hop of spec.split(".")) {
    const m = /^([A-Za-z0-9_]+)((?:\[\d+\])*)$/.exec(hop);
    if (!m) throw new Error(`bad path segment: ${hop} (in ${spec})`);
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, Json>)[m[1] as string];
    for (const idx of (m[2] as string).match(/\d+/g) ?? []) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(idx)];
    }
  }
  return cur;
}

/** Write "a.b[0].c"; throws when the parent hop does not exist. */
function setPath(root: Json, spec: string, value: Json): void {
  const hops = spec.split(".");
  const last = hops.pop() as string;
  let cur: Json = root;
  for (const hop of hops) cur = getPath(cur, hop);
  const m = /^([A-Za-z0-9_]+)((?:\[\d+\])*)$/.exec(last);
  if (!m) throw new Error(`bad path segment: ${last} (in ${spec})`);
  const idxs = ((m[2] as string).match(/\d+/g) ?? []).map(Number);
  if (cur === null || typeof cur !== "object") {
    throw new Error(`cannot set ${spec}: parent missing`);
  }
  if (idxs.length === 0) {
    (cur as Record<string, Json>)[m[1] as string] = value;
    return;
  }
  let arr = (cur as Record<string, Json>)[m[1] as string];
  for (const i of idxs.slice(0, -1)) {
    if (!Array.isArray(arr)) throw new Error(`cannot set ${spec}: not an array`);
    arr = arr[i];
  }
  if (!Array.isArray(arr)) throw new Error(`cannot set ${spec}: not an array`);
  arr[idxs[idxs.length - 1] as number] = value;
}

/* ------------------------------------------------------------------ *
 * The fixture: one mid-game save with every block populated.
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

/**
 * A mid-game state that exercises every save.c block: town first (so the
 * stores + Town chunk exist), then a dungeon level with monsters, a floor
 * pile, a trap, an autoinscription, lore, a history entry and messages.
 */
function fixture(): StartedGame {
  const game = startGame(pack, { seed: 91117, depth: 0, className: "Mage" });
  const state = game.state;

  /* Stores + townChunk: born in town, then descend (non-persist stashes Town). */
  expect(state.stores?.length ?? 0).toBeGreaterThan(0);
  game.changeLevel(2);
  expect(state.townChunk).toBeTruthy();

  /* A few real turns so energy/turn/actor advance through the live loop. */
  const commands: PlayerCommand[] = [];
  for (let i = 0; i < 6; i++) {
    commands.push({ code: "walk", dir: [6, 2, 4, 8][i % 4] as number });
    commands.push({ code: "hold" });
  }
  state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;
  runGameLoop(state, game.registry);

  /* A floor pile next to the player (wr_objects_aux). */
  const kinds = game.booted.registries.objects.kinds;
  const dagger = kinds.find(
    (k) => k?.tval === TV.SWORD && k.name === "& Dagger~",
  ) as ObjectKind;
  const drop = objectNew(dagger);
  drop.tval = dagger.tval;
  drop.sval = dagger.sval;
  drop.number = 1;
  drop.note = "seed";
  const pileGrid = { x: state.actor.grid.x, y: state.actor.grid.y };
  drop.grid = pileGrid;
  state.floor.set(pileGrid.y * state.chunk.width + pileGrid.x, [drop]);

  /* A trap (wr_traps_aux): planted through the real installTrap so the
   * fixture never depends on where generation happened to put one. */
  const trapDeps = game.wizardBundles.trapDeps;
  expect(trapDeps, "the pack must bind trap kinds").toBeTruthy();
  const trapKind = trapDeps!.kinds.find((k) => k?.name);
  expect(trapKind, "pack must bind at least one named trap kind").toBeTruthy();
  installTrap(state, state.actor.grid, trapKind!.tidx, 3, trapDeps!);

  /* At least one live monster (wr_monsters_aux). */
  expect(state.monsters.filter(Boolean).length).toBeGreaterThan(0);
  const firstMon = state.monsters.findIndex((m) => m !== null);
  expect(firstMon).toBe(1);

  /* Lore (wr_monster_memory), history (wr_history), messages (wr_messages),
   * an autoinscription (wr_ignore) and the minor wr_player fields. */
  const lore = getLore(state.lore, state.monsters[1]!.race);
  lore.pkills = 4;
  lore.thefts = 2;
  state.actor.player.hist.push({
    type: 1,
    dlev: 2,
    clev: 1,
    aIdx: 0,
    turn: state.turn,
    event: "Reached the field guard.",
  });
  state.messages?.add("field guard message", 0);
  expect(state.autoinscribe, "the session must own an autoinscription registry")
    .toBeTruthy();
  state.autoinscribe!.set(dagger.kidx, "{guard}", true);
  /* A rune auto-inscription (wr_ignore's rune block, save.c:586-605). Upstream
   * writes every rune whose note is set, with no player_knows_rune gate, so
   * rune 0 (the +AC combat rune) is enough to populate the block. */
  expect(state.runeNotes, "the session must own a rune-note registry").toBeTruthy();
  state.runeNotes!.set(0, "{ac}");
  state.actor.player.fullName = "Fieldguard";
  state.actor.player.noscore = 2;
  state.actor.player.wordRecall = 3;
  state.actor.player.deepDescent = 2;
  state.actor.player.recallDepth = 2;
  state.restingTurn = 11;
  state.skipCmdCoercion = 1;
  state.unignoring = 1;
  state.nameSuffix = 2;
  state.daycount = 3;
  /* player->old_grid + upkeep->arena_level (save.c:485-486, single combat). */
  state.arenaLevel = true;
  state.oldGrid = { x: 3, y: 4 };
  state.actor.player.quests[0]!.level = 99;

  return game;
}

function saveOf(game: StartedGame): SavedGame {
  return JSON.parse(JSON.stringify(saveGame(game))) as SavedGame;
}

/* ------------------------------------------------------------------ *
 * Guard 1 — the C side.
 * ------------------------------------------------------------------ */

describe("save.c field-coverage guard: the C side", () => {
  const counted = countWritesPerFunction(saveC);

  it("finds every wr_* block save.c defines and no others", () => {
    expect([...counted.keys()].sort()).toEqual(
      BLOCKS.map((b) => b.c).sort(),
    );
  });

  it("each block still writes exactly the declared number of fields", () => {
    const actual: Record<string, number> = {};
    const expected: Record<string, number> = {};
    for (const b of BLOCKS) {
      actual[b.c] = counted.get(b.c) as number;
      expected[b.c] = b.writes;
    }
    /* A field added to, or dropped from, any upstream block lands here. Update
     * the row AND the port-side coverage together - never the row alone. */
    expect(actual).toEqual(expected);
  });

  it("declares each block at its real save.c definition line", () => {
    const lines = saveC.split("\n");
    for (const b of BLOCKS) {
      const line = lines[b.line - 1] ?? "";
      expect(line, `${b.c} is not defined at save.c:${b.line}`).toContain(
        `${b.c}(`,
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 * Guard 2 — the port side.
 * ------------------------------------------------------------------ */

describe("save.c field-coverage guard: the port side", () => {
  it("every declared field path resolves in a real mid-game save", () => {
    const saved = saveOf(fixture());
    const missing: string[] = [];
    for (const b of BLOCKS) {
      for (const p of b.port ?? []) {
        if (getPath(saved, p) === undefined) missing.push(`${b.c} -> ${p}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every block is adjudicated: a port mapping, a scope rule, or a GAP", () => {
    const unjudged = BLOCKS.filter(
      (b) =>
        (b.port?.length ?? 0) === 0 &&
        (b.portConditional?.length ?? 0) === 0 &&
        !b.na &&
        !b.gap,
    ).map((b) => b.c);
    expect(unjudged).toEqual([]);
  });

  it("every conditional path names the condition that covers it", () => {
    for (const b of BLOCKS) {
      for (const [p, why] of b.portConditional ?? []) {
        expect(why.length, `${b.c} -> ${p} has no stated condition`).toBeGreaterThan(30);
      }
    }
  });

  it("declares no known GAP: every save.c block is fully covered", () => {
    /* wr_ignore's rune auto-inscription block was the last outstanding GAP
     * (W1-CAVE-SAVE-002); it is now saved and mutation-probed above. A row
     * regaining a `gap` must land here, not be quietly tolerated. */
    expect(BLOCKS.filter((b) => b.gap).map((b) => b.c)).toEqual([]);
  });

  it("a dead save carries wr_dungeon's header and omits the live blocks", () => {
    /* save.c:965-971: wr_dungeon writes depth/daycount/player grid, then
     * RETURNS when player->is_dead, so wr_dungeon_aux / wr_objects_aux /
     * wr_monsters_aux / wr_traps_aux / wr_chunks all write nothing. */
    const game = fixture();
    const depth = game.state.chunk.depth;
    game.state.isDead = true;
    const saved = saveOf(game);
    expect(getPath(saved, "dungeonDepth")).toBe(depth);
    for (const p of ["chunk", "monsters", "floor", "traps", "featLegend"]) {
      expect(getPath(saved, p), `${p} must be absent for a dead save`).toBeUndefined();
    }
  });
});

/* ------------------------------------------------------------------ *
 * Guard 3 — the loader.
 * ------------------------------------------------------------------ */

describe("save.c field-coverage guard: the loader round-trips every field", () => {
  it("save -> load -> save is identical (no field is dropped on read)", () => {
    const first = saveOf(fixture());
    const second = saveOf(loadGame(pack, first));

    /* One documented non-idempotence, and it is upstream's: load.c:791-793
     * resets died_from to "(alive and well)" whenever chp >= 0, so a living
     * character's cause-of-death string is rewritten on every read. Assert the
     * exact transform rather than skipping the field, then normalise and
     * require byte equality on everything else. */
    expect(first.player.diedFrom).toBe("");
    expect(second.player.diedFrom).toBe("(alive and well)");
    expect(first.player.chp).toBeGreaterThanOrEqual(0);
    second.player.diedFrom = first.player.diedFrom ?? "";

    expect(second).toEqual(first);
  });

  it("every declared scalar leaf survives a mutated reload", () => {
    const base = saveOf(fixture());
    const failures: string[] = [];
    for (const b of BLOCKS) {
      for (const [p, value] of b.mutate ?? []) {
        const doc = JSON.parse(JSON.stringify(base)) as SavedGame;
        expect(
          getPath(doc, p),
          `${b.c} -> ${p} is absent from the fixture save`,
        ).not.toBeUndefined();
        setPath(doc, p, value);
        const out = saveOf(loadGame(pack, doc));
        const got = getPath(out, p);
        if (got !== value) {
          failures.push(`${b.c} -> ${p}: wrote ${String(value)}, read back ${String(got)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 15_000);
});
