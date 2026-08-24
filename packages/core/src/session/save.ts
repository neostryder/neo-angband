/**
 * JSON save/load (PORT_PLAN.md decision 9): the entity serializers that
 * turn a live GameState into plain JSON and back. The format is the port's
 * own (the C binary blocks of save.c/load.c are replaced by design); WHAT
 * is saved follows upstream savefile semantics - notably the RNG state is
 * persisted (save.c wr_randomizer), which is what the no-save-scum posture
 * rides on (decisions 16/22): reloading resumes the same stream.
 *
 * References into bound registries (races, kinds, egos, artifacts, trap
 * kinds, classes) are saved as stable indices/names and re-resolved against
 * the pack on load, so a save is data + pack, never code. Raw effect chains
 * and kind-owned text re-point at the kind on load rather than being
 * copied into the save.
 *
 * Integrity: serializeGame produces the JSON payload; callers stamp/verify
 * bytes with save/integrity.ts (stampSavefile / verifyStampedSavefile),
 * the decision-16b tamper deterrent.
 *
 * BLOCK MAP (save.c wr_* / load.c rd_* -> the field this file writes). There is
 * deliberately no per-block function pair: the C block table is replaced by one
 * JSON document, so W1's question is field coverage, not symbol presence. Each
 * row is proved by save-fields.test.ts, the C-derived coverage guard.
 *
 *   wr_description   (save.c:49)   -> not a FIELD: the exact string is ported in
 *                                    save/description.ts and derived from
 *                                    fullName / lev / race / class / depth,
 *                                    which this document already carries. In a
 *                                    JSON save it need not be stored at all, and
 *                                    storing it would create the second source
 *                                    of truth upstream's own readers avoid by
 *                                    scanning a directory and asking each file.
 *   wr_randomizer    (save.c:286)  -> SavedGame.rng
 *   wr_options       (save.c:314)  -> SavedGame.options (SIDEBAR_MODE is UI)
 *   wr_messages      (save.c:339)  -> SavedGame.messages
 *   wr_monster_memory(save.c:356)  -> SavedGame.lore (whole record, where
 *                                    upstream writes only pkills/thefts and
 *                                    leaves the rest to lore.txt. The file IS
 *                                    ported - mon/lore-file.ts - and is laid
 *                                    over this on load, exactly as upstream's
 *                                    startup order does. The save keeps carrying
 *                                    the whole record; narrowing it would be a
 *                                    SAVE_VERSION change with nothing to gain.
 *                                    The observed SPELL set is written by NAME
 *                                    as of version 5 (SavedLore.spellsKnown) and
 *                                    the known race FLAGS as of version 6
 *                                    (SavedLore.flagsKnown).)
 *   wr_object_memory (save.c:377)  -> flavor.aware / .tried, everseen.kinds,
 *                                    ignore.kindAware / .kindUnaware
 *   wr_quests        (save.c:405)  -> player.quests
 *   wr_player        (save.c:418)  -> SavedPlayer + SavedGame.actor / arena /
 *                                    nameSuffix / skipCmdCoercion / unignoring /
 *                                    restingTurn
 *   wr_ignore        (save.c:514)  -> SavedGame.ignore, .autoinscriptions,
 *                                    everseen.egos. GAP: the rune-note block
 *                                    (save.c:589-605) has no counterpart -
 *                                    rune_note is a ledgered deferral.
 *   wr_misc          (save.c:610)  -> randartSeed, seedFlavor, player.totalWinner,
 *                                    player.noscore, isDead, turn, player.objKnown
 *   wr_artifacts     (save.c:674)  -> artifactsCreated / Seen / Everseen
 *   wr_player_hp     (save.c:692)  -> player.playerHp
 *   wr_player_spells (save.c:702)  -> player.spellFlags / .spellOrder
 *   wr_gear_aux      (save.c:715)  -> gear (+ player.equipment slot map)
 *   wr_gear          (save.c:737)  -> ditto; the gear_k known twin is N/A
 *   wr_stores        (save.c:744)  -> SavedGame.stores
 *   wr_dungeon_aux   (save.c:774)  -> ChunkSquaresData (+ currentJoins)
 *   wr_objects_aux   (save.c:873)  -> SavedGame.floor
 *   wr_monsters_aux  (save.c:915)  -> SavedGame.monsters / .groups
 *   wr_traps_aux     (save.c:933)  -> SavedGame.traps
 *   wr_dungeon       (save.c:959)  -> dungeonDepth, daycount, actor.grid
 *   wr_objects       (save.c:980)  -> floor      (player->cave twin N/A)
 *   wr_monsters      (save.c:986)  -> monsters   (player->cave twin N/A)
 *   wr_traps         (save.c:992)  -> traps      (player->cave twin N/A)
 *   wr_chunks        (save.c:1001) -> levelCache + townChunk
 *   wr_history       (save.c:1048) -> player.hist
 *   wr_item          (save.c:69)   -> SavedObject      (obj->oidx N/A)
 *   wr_monster       (save.c:201)  -> SavedMonster
 *   wr_trap          (save.c:261)  -> SavedTrap
 */

import type { Loc } from "../loc.js";
import { loc } from "../loc.js";
import type { RngState } from "../rng.js";
import type { RandomValue } from "../rng.js";
import { FlagSet } from "../bitflag.js";
import { Chunk, SQUARE_SIZE } from "../world/chunk.js";
import type { ChunkSquaresData } from "../world/chunk.js";
import type { GameObject } from "../obj/object.js";
import { objectNew, tvalIsMoney } from "../obj/object.js";
import type { ObjRegistry } from "../obj/bind.js";
import { ELEMENT_NAMES, OBJ_MOD_NAMES } from "../obj/bind.js";
import type { ElementInfo } from "../obj/types.js";
import { ELEM_MAX, OBJ_MOD_MAX, OF_SIZE, newElemInfo } from "../obj/types.js";
import type { AutoinscriptionRegistry, Rune } from "../obj/knowledge.js";
import { buildRuneList, runeKey } from "../obj/knowledge.js";
import type { IgnoreSettingsData } from "../obj/ignore.js";
import { blankMonster, GROUP_MAX } from "../mon/monster.js";
import type { Monster, MonsterGroupInfo } from "../mon/monster.js";
import type { MonsterLore } from "../mon/lore.js";
import { RF_FLAG_NAMES } from "../mon/lore-file.js";
import {
  MFLAG,
  MON_TMD,
  OF,
  SQUARE_FLAG_ENTRIES,
  STAT,
  TMD,
  TRF,
} from "../generated/index.js";
import { MFLAG_SIZE, RF_SIZE } from "../mon/types.js";
import {
  rsfMax,
  rsfSize,
  spellIndexOf,
  spellNameAt,
} from "../mon/spell-registry.js";
import type { MonsterRegistry } from "../mon/bind.js";
import { blankPlayer } from "../player/player.js";
import type { Player, PlayerQuest } from "../player/player.js";
import { playerQuestsReset } from "../game/quest.js";
import type { Quest } from "../game/quest.js";
import type { PlayerRegistry } from "../player/bind.js";
import type { TrapKind } from "../world/trap.js";
import { TRF_SIZE } from "../world/trap.js";
import type { GameState, MonsterGroup, StoredLevel } from "../game/context.js";
import { MessageLog } from "../msg.js";
import type { Trap } from "../game/trap.js";
import type { Gear } from "../game/gear.js";
import type { Store } from "../store/store.js";
import type { BoundStore } from "../store/types.js";
import { newKnownMap } from "../game/known.js";
import type { KnownMap, KnownObject } from "../game/known.js";
import {
  fnv1aIntegrity,
  stampSavefile,
  verifyStampedSavefile,
} from "../save/integrity.js";
import type { SaveIntegrity } from "../save/integrity.js";
import { applyCodec, findCodec, stripCodec } from "../save/compress.js";
import type { SaveCodec } from "../save/compress.js";
import type { ContentIdResolver } from "../mod/ids.js";
import {
  PY_MAX_LEVEL,
  SKILL,
  SKILL_MAX,
  STAT_MAX,
  TMD_MAX,
} from "../player/types.js";
import type {
  ModBag,
  OrphanStore,
  SaveManifest,
} from "../mod/save-blocks.js";

/**
 * The save format version this build writes. Version 2 replaced every numeric
 * content index (kidx/eidx/aidx/ridx/tidx/feat, and the positional curse/
 * brand/slay arrays) with the namespaced string ids of mod/ids.ts, the
 * load-bearing rule of the mod substrate (MOD_LIFECYCLE decision 1). Version 3
 * finished that job: `flavor`, `everseen` and `ignore` were the last blocks
 * still keyed by raw kidx/eidx, and the rune-autoinscription block of wr_ignore
 * (save.c:586-605) arrived with them. Version 5 started on the POSITIONS a save
 * held: monster lore recorded which spells the player had seen as RSF bit
 * positions, so `MON_SPELL_ENTRIES` could never grow without renumbering an
 * existing character's memory. It is written by name now
 * (`SavedLore.spellsKnown`).
 *
 * Version 5's own comment claimed that was the LAST position a save held. It was
 * not, and version 6 (#273) finished the count: race lore still wrote RF bit
 * positions, and every object-property carrier in the document - `SavedObject`,
 * `SavedPlayer.objKnown`, `SavedMonster.knownPstate` - wrote OF bit positions,
 * OBJ_MOD indices and ELEM indices. All four tables are persisted by NAME now;
 * see "Position-free persistence" below.
 *
 * VERSION 6'S COMMENT MADE THE SAME CLAIM, and version 7 (#274) is the count
 * actually finishing. Seven more tables were still persisted by position, and
 * V5_TO_V6's own discriminator comment named two of them as "out of scope":
 *
 *   MFLAG   `SavedMonster.mflag`        -> `mflagNames`         (bit positions)
 *   TRF     `SavedTrap.flags`           -> `trapFlagNames`      (bit positions)
 *   SQUARE  every chunk's per-grid info -> `squareInfoLegend`   (bit positions)
 *   MON_TMD `SavedMonster.mTimed`       -> `monsterTimed`       (dense indices)
 *   TMD     `SavedPlayer.timed`         -> `timedValues`        (dense indices)
 *   SKILL   `SavedPlayer.skills`        -> `skillValues`        (dense indices)
 *   STAT    `SavedPlayer.stat*`         -> `stat*Values` / `statMapNames`
 *
 * plus `SavedPlayer.objKnownModifiers`, the version-1 legacy rune block, which
 * every migration since has carried forward untouched as a dense OBJ_MOD array
 * (`objKnownModifierValues` now). Version 6 converted the modern spelling of
 * that field and left the legacy one behind, which is precisely the shape of
 * defect this ticket exists to end.
 *
 * SQUARE IS THE ONE THAT IS NOT A LIST OF NAMES. See `SQUARE_INFO_LEGEND`.
 *
 * OLDER SAVES ARE MIGRATED, NOT REJECTED. Every version below this one has a
 * conversion step in session/save-migrate.ts, and `saveMigrationsAreComplete()`
 * (enforced by save-migrate.test.ts) fails the build if this constant is bumped
 * without one. That test is the reason this comment can promise anything: for
 * three versions the promise was the opposite - a bump turned every existing
 * character into "Could not read the save; starting a new game", which in a
 * permadeath game reads as "your character is gone".
 */
export const SAVE_VERSION = 7;

/* ------------------------------------------------------------------ *
 * Position-free persistence for the generated tables.
 *
 * A save that stores a flag as its BIT POSITION - or a value at its enum's
 * INDEX - can only be read by a build whose table has the identical length and
 * order. Remove or reorder one entry and every existing character's data
 * silently re-points at a different flag; that is why `MON_SPELL_ENTRIES` could
 * not be opened to mods until #269 (MOD_REACH row 22), and it was equally true
 * of `MON_RACE_FLAG_ENTRIES`, `OBJECT_FLAG_ENTRIES`, `OBJECT_MODIFIER_ENTRIES`
 * and `ELEMENT_ENTRIES` until #273 - and of `MON_TEMP_FLAG_ENTRIES`,
 * `TRAP_FLAG_ENTRIES`, `SQUARE_FLAG_ENTRIES`, `MON_TIMED_ENTRIES`,
 * `PLAYER_TIMED_ENTRIES`, `SKILL` and `STAT_ENTRIES` until #274.
 *
 * Names have no position. A build whose table is larger, smaller or reordered
 * reads back exactly what was written, and a name it no longer has is DROPPED
 * rather than mis-resolved - the same rule `deserializeLore` already applies to
 * a race whose mod is gone. session/save-flag-names.test.ts is the control:
 * it renumbers each table and reads the same data under both schemes.
 *
 * TWO ENCODINGS, AND THE RULE FOR PICKING ONE.
 *
 *   A FLAG SET writes `string[]` - the set flags, ascending, so an unchanged
 *   entity writes identical bytes. Absence is the whole meaning of an unset
 *   flag, so there is nothing to write for one.
 *
 *   A DENSE VALUE ARRAY writes `Record<name, value>`. Where zero genuinely
 *   means "no such effect" (`timed`, `mTimed`, the object modifiers) the zeroes
 *   are omitted and the block stays proportional to what the entity HAS rather
 *   than to the table's length. Where the vector is small and always fully
 *   populated (`skills`, the four stat arrays) every entry is written, because
 *   zero there is a value and not an absence; omitting it would round-trip
 *   correctly today and read as a lie the first time someone inspects a save.
 *
 * AND ONE THAT IS NEITHER: see `SQUARE_INFO_LEGEND`, where a name per grid was
 * measured and rejected.
 * ------------------------------------------------------------------ */

/**
 * A flag/enum value -> name table, INVERTED FROM THE ENUM rather than read off
 * the generated entry tuple.
 *
 * THE THREE ENTRY TUPLES DO NOT SHARE A BASE, and every call site that reaches
 * for one has to know which it is holding:
 * `MON_RACE_FLAG_ENTRIES[flag]` (RF_NONE kept at [0]), `OBJECT_FLAG_ENTRIES
 * [flag - 1]` (OF_NONE dropped), `OBJECT_MODIFIER_ENTRIES[value - 5]` (the five
 * list-stats.h entries come first). The enum is generated from the same header
 * as the values themselves, so inverting it cannot be off by one in any
 * direction - and save-flag-names.test.ts pins each inverted table against its
 * own ENTRIES tuple AT ITS OWN BASE, because a comment claiming a base is
 * exactly the kind of thing that has been wrong here before.
 */
function nameTable(
  en: Readonly<Record<string, number>>,
): readonly (string | undefined)[] {
  const out: (string | undefined)[] = [];
  for (const [name, value] of Object.entries(en)) out[value] = name;
  return out;
}

/**
 * OF_ names by flag number. [0] is the OF_NONE sentinel, [OF.MAX] is the "MAX"
 * one. Nothing in the tree exported this before; RF_FLAG_NAMES and
 * RSF_FLAG_NAMES (mon/lore-file.ts) are its siblings and are built the same way.
 */
export const OF_FLAG_NAMES = nameTable(OF);

/*
 * OBJ_MOD and ELEM already have exported name tables - `OBJ_MOD_NAMES` and
 * `ELEMENT_NAMES` in obj/bind.ts, the port of the C `obj_mods[]` and
 * `element_names[]` string arrays, both indexed by the enum VALUE. A second
 * copy here would be a second thing to keep right, so this file uses those; the
 * inverted enum is applied to them AS A CHECK in save-flag-names.test.ts
 * instead, which is the only place the two derivations can be compared.
 */

/**
 * The set object flags as OF_ names, ascending by flag number so the save is
 * byte-stable for an unchanged object.
 *
 * The bound is OF.MAX for the reason serializeLoreSpells bounds on RSF.MAX:
 * OF_SIZE rounds 39 flags up to 5 bytes, so a set has 40 addressable bits and
 * index 39 reads back as the enum's own `"MAX"` sentinel. Writing that would
 * put a non-flag in the save and, on the way back, set a bit no property owns.
 */
export function serializeObjectFlags(flags: FlagSet): string[] {
  const out: string[] = [];
  for (const flag of flags) {
    if (flag >= OF.MAX) break;
    const name = OF_FLAG_NAMES[flag];
    if (name !== undefined) out.push(name);
  }
  return out;
}

/**
 * The inverse: an OF_SIZE FlagSet with exactly the named flags on. A name this
 * build does not have (a mod's property, uninstalled - or the `"MAX"` sentinel)
 * is dropped, which is how the whole scheme stays safe: an unknown NAME cannot
 * land on some other flag's bit the way an out-of-range index would.
 */
export function deserializeObjectFlags(
  names: readonly string[] | undefined,
): FlagSet {
  const set = new FlagSet(OF_SIZE);
  for (const name of names ?? []) {
    const flag = OF_FLAG_NAMES.indexOf(name);
    if (flag > 0 && flag < OF.MAX) set.on(flag);
  }
  return set;
}

/**
 * The known race flags as RF_ names, ascending.
 *
 * RF has NO `MAX` member - the enum stops at NO_SLOW and `RF_SIZE` is
 * `flagSize(MON_RACE_FLAG_ENTRIES.length)`, so a set has a few unnamed padding
 * bits above the last flag and nothing else. `RF_FLAG_NAMES[flag] === undefined`
 * is therefore the entire bound, and it is derived from the table rather than
 * from a hand-written constant that could part company with it.
 */
export function serializeLoreFlags(flags: FlagSet): string[] {
  const out: string[] = [];
  for (const flag of flags) {
    const name = RF_FLAG_NAMES[flag];
    if (name !== undefined) out.push(name);
  }
  return out;
}

/**
 * The inverse: an RF_SIZE FlagSet with exactly the named flags on. Index 0 is
 * upstream's RF_NONE, which is never set, so `flag > 0` excludes it; every
 * other named flag fits by construction, because RF_SIZE is sized from the very
 * table the name was looked up in.
 */
export function deserializeLoreFlags(
  names: readonly string[] | undefined,
): FlagSet {
  const set = new FlagSet(RF_SIZE);
  for (const name of names ?? []) {
    const flag = RF_FLAG_NAMES.indexOf(name);
    if (flag > 0) set.on(flag);
  }
  return set;
}

/**
 * The non-zero modifiers as an OBJ_MOD_ name -> value map, in ascending index
 * order so an unchanged object writes identical bytes.
 *
 * NOT A FLAG SET: index 0 is OBJ_MOD_STR, a real modifier, so there is no
 * sentinel to skip at either end and the `flag > 0` guard the flag helpers use
 * would silently drop every strength bonus in the game. A zero IS the absence
 * of a modifier everywhere it is read (`obj.modifiers[k] ?? 0`), so omitting
 * zeroes loses nothing and keeps the block proportional to what the object
 * actually has rather than to the table's length.
 */
export function serializeObjectModifiers(
  mods: readonly number[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < mods.length; i++) {
    const value = mods[i] ?? 0;
    if (value === 0) continue;
    const name = OBJ_MOD_NAMES[i];
    if (name !== undefined) out[name] = value;
  }
  return out;
}

/**
 * The inverse: a full-length OBJ_MOD array, zero wherever the save said
 * nothing. The length comes from THIS build's table, never from the document -
 * a save written against a longer table hands back an array the engine's own
 * loops would run off the end of.
 */
export function deserializeObjectModifiers(
  saved: Readonly<Record<string, number>> | undefined,
): number[] {
  const out = new Array<number>(OBJ_MOD_MAX).fill(0);
  for (const [name, value] of Object.entries(saved ?? {})) {
    const i = OBJ_MOD_NAMES.indexOf(name);
    if (i >= 0 && i < out.length && typeof value === "number") out[i] = value;
  }
  return out;
}

/**
 * The element info as an ELEM_ name -> {resLevel, flags} map, ascending, with
 * the untouched elements omitted. `flags` stays a raw number: EL_INFO_HATES /
 * EL_INFO_IGNORE are hand-written constants in obj/types.ts, not a generated
 * list, so nothing a mod can do renumbers them.
 */
export function serializeObjectElements(
  elInfo: readonly ElementInfo[],
): Record<string, ElementInfo> {
  const out: Record<string, ElementInfo> = {};
  for (let i = 0; i < elInfo.length; i++) {
    const e = elInfo[i];
    if (e === undefined || (e.resLevel === 0 && e.flags === 0)) continue;
    const name = ELEMENT_NAMES[i];
    if (name !== undefined) out[name] = { resLevel: e.resLevel, flags: e.flags };
  }
  return out;
}

/** The inverse: a zeroed ELEM_MAX array with the named elements filled in. */
export function deserializeObjectElements(
  saved: Readonly<Record<string, ElementInfo>> | undefined,
): ElementInfo[] {
  const out = newElemInfo();
  for (const [name, e] of Object.entries(saved ?? {})) {
    const i = ELEMENT_NAMES.indexOf(name);
    if (i < 0 || i >= out.length || e === null || typeof e !== "object") continue;
    out[i] = { resLevel: e.resLevel ?? 0, flags: e.flags ?? 0 };
  }
  return out;
}

/**
 * The el_info[].res_level half on its own, for the one carrier that stores
 * resistance levels without the EL_INFO_ flags beside them: a monster's
 * `knownPstate.elInfo`, which is an Int16Array (mon/monster.ts).
 */
export function serializeElementLevels(
  levels: ArrayLike<number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < levels.length; i++) {
    const value = levels[i] ?? 0;
    if (value === 0) continue;
    const name = ELEMENT_NAMES[i];
    if (name !== undefined) out[name] = value;
  }
  return out;
}

/** The inverse: a zeroed ELEM_MAX array of resistance levels. */
export function deserializeElementLevels(
  saved: Readonly<Record<string, number>> | undefined,
): number[] {
  const out = new Array<number>(ELEM_MAX).fill(0);
  for (const [name, value] of Object.entries(saved ?? {})) {
    const i = ELEMENT_NAMES.indexOf(name);
    if (i >= 0 && i < out.length && typeof value === "number") out[i] = value;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * #274: the seven remaining position-persisted tables.
 * ------------------------------------------------------------------ */

/**
 * MFLAG_ names by flag number. [0] is upstream's MFLAG_NONE; there is no MAX
 * member, so "has a name" is the whole bound, exactly as for RF.
 */
export const MFLAG_NAMES = nameTable(MFLAG);

/** TRF_ names by flag number. [0] is TRF_NONE; no MAX member, as for MFLAG. */
export const TRF_NAMES = nameTable(TRF);

/**
 * MON_TMD_ names by index. Unlike TMD, this enum DOES carry its own `MAX`
 * member (mon-timed.h ends with MON_TMD_MAX), and `mon.mTimed` is exactly
 * `MON_TMD.MAX` long - so index `MON_TMD.MAX` is the sentinel and never a slot.
 */
export const MON_TMD_NAMES = nameTable(MON_TMD);

/**
 * TMD_ names by index. The player-timed enum has NO sentinel at either end:
 * `TMD_MAX` is `PLAYER_TIMED_ENTRIES.length` rather than an enum member, so
 * every index in the table names a real effect.
 */
export const TMD_NAMES = nameTable(TMD);

/** SKILL_ names by index. No sentinels; `SKILL_MAX` is a hand-written 10. */
export const SKILL_NAMES = nameTable(SKILL);

/** STAT_ names by index. No sentinels; five entries, from list-stats.h. */
export const STAT_NAMES = nameTable(STAT);

/**
 * A FlagSet -> ascending names, bounded by "this build has a name for it".
 * Index 0 is the NONE sentinel in every table that has one and is never set,
 * so it costs nothing to let the name table decide.
 */
function flagNames(
  flags: FlagSet,
  names: readonly (string | undefined)[],
): string[] {
  const out: string[] = [];
  for (const flag of flags) {
    if (flag === 0) continue;
    const name = names[flag];
    if (name !== undefined) out.push(name);
  }
  return out;
}

/** The inverse. An unknown name is dropped, never landed on another bit. */
function flagsFromNames(
  saved: readonly string[] | undefined,
  names: readonly (string | undefined)[],
  size: number,
): FlagSet {
  const set = new FlagSet(size);
  for (const name of saved ?? []) {
    const flag = names.indexOf(name);
    if (flag > 0 && flag < size * 8) set.on(flag);
  }
  return set;
}

/**
 * A dense value array -> a name -> value map, ascending by index, omitting
 * zeroes. `all` writes every named slot instead, for the vectors where zero is
 * a value rather than an absence (see the encoding rule above).
 */
function valuesByName(
  values: ArrayLike<number>,
  names: readonly (string | undefined)[],
  all = false,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? 0;
    if (!all && value === 0) continue;
    const name = names[i];
    if (name !== undefined) out[name] = value;
  }
  return out;
}

/**
 * The inverse: a full-length array, zero where the document said nothing. The
 * LENGTH IS THIS BUILD'S, never the document's - a save written against a
 * longer table would otherwise hand back an array the engine's own loops run
 * off the end of.
 */
function valuesFromNames(
  saved: Readonly<Record<string, number>> | undefined,
  names: readonly (string | undefined)[],
  length: number,
): number[] {
  const out = new Array<number>(length).fill(0);
  for (const [name, value] of Object.entries(saved ?? {})) {
    const i = names.indexOf(name);
    if (i >= 0 && i < length && typeof value === "number") out[i] = value;
  }
  return out;
}

/**
 * MFLAG: a monster's transient flags (save.c:228-229, one byte per MFLAG_SIZE).
 *
 * Upstream reads exactly `mflag_size` bytes - THIS build's size, off a stream
 * that was written with the writing build's - so a table that grew by one flag
 * desynchronises the whole rest of the monster block rather than merely
 * mis-naming a flag. There is no discard rule to preserve here because upstream
 * has no notion of a flag it does not recognise; the name form gives it one.
 */
export function serializeMonsterFlags(flags: FlagSet): string[] {
  return flagNames(flags, MFLAG_NAMES);
}

/** The inverse: an MFLAG_SIZE FlagSet with exactly the named flags on. */
export function deserializeMonsterFlags(
  names: readonly string[] | undefined,
): FlagSet {
  return flagsFromNames(names, MFLAG_NAMES, MFLAG_SIZE);
}

/** TRF: a trap instance's flags (save.c:275-276, rd_trap at load.c:376-377). */
export function serializeTrapFlags(flags: FlagSet): string[] {
  return flagNames(flags, TRF_NAMES);
}

/** The inverse: a TRF_SIZE FlagSet with exactly the named flags on. */
export function deserializeTrapFlags(
  names: readonly string[] | undefined,
): FlagSet {
  return flagsFromNames(names, TRF_NAMES, TRF_SIZE);
}

/**
 * MON_TMD: a monster's timed effects (save.c:223-226).
 *
 * Zero means "not affected" everywhere `m_timed` is read, so zeroes are
 * omitted. UPSTREAM HAS NO DISCARD RULE HERE AND THAT IS A BUG, not a
 * behaviour to reproduce: save.c:223 writes `MON_TMD_MAX` and load.c:290-292
 * reads that count straight into `mon->m_timed[j]`, which is `MON_TMD_MAX`
 * long in the READING build - a longer table overruns the array. Names cannot
 * overrun anything, so the port's reader simply drops an effect it does not
 * have, which is what upstream's rd_player does two blocks later for the
 * player's own timed effects and evidently meant to do here.
 */
export function serializeMonsterTimed(
  timed: ArrayLike<number>,
): Record<string, number> {
  return valuesByName(timed, MON_TMD_NAMES);
}

/** The inverse: a MON_TMD.MAX-long array, zero where the save said nothing. */
export function deserializeMonsterTimed(
  saved: Readonly<Record<string, number>> | undefined,
): number[] {
  return valuesFromNames(saved, MON_TMD_NAMES, MON_TMD.MAX);
}

/**
 * TMD: the player's timed effects (save.c:508-511).
 *
 * THE ONE FIELD WITH AN EXPLICIT UPSTREAM DISCARD RULE. load.c:811-829 reads
 * the saved count and, when it exceeds TMD_MAX, keeps the ones it supports,
 * strips the rest and notes "Discarded unsupported timed effects" - an extra
 * timed effect is not an error. `valuesFromNames` drops an unrecognised name
 * for exactly that reason, and the pre-#274 reader's `slice(0, TMD_MAX)` said
 * the same thing positionally.
 */
export function serializePlayerTimed(
  timed: ArrayLike<number>,
): Record<string, number> {
  return valuesByName(timed, TMD_NAMES);
}

/** The inverse: a TMD_MAX-long array, zero where the save said nothing. */
export function deserializePlayerTimed(
  saved: Readonly<Record<string, number>> | undefined,
): number[] {
  return valuesFromNames(saved, TMD_NAMES, TMD_MAX);
}

/**
 * SKILL: the derived level-based skills.
 *
 * NOT AN UPSTREAM FIELD AT ALL - `grep -i skill save.c load.c` is empty, and
 * player->state.skills is rebuilt by calc_bonuses on every load. The port
 * persists them anyway (player/player.ts `skills`), so the same position
 * defect applied; there is no upstream discard rule to match because there is
 * no upstream block. Every slot is written: a skill of 0 is a value, and the
 * whole vector is ten entries.
 */
export function serializePlayerSkills(
  skills: ArrayLike<number>,
): Record<string, number> {
  return valuesByName(skills, SKILL_NAMES, true);
}

/** The inverse: a SKILL_MAX-long array. */
export function deserializePlayerSkills(
  saved: Readonly<Record<string, number>> | undefined,
): number[] {
  return valuesFromNames(saved, SKILL_NAMES, SKILL_MAX);
}

/**
 * STAT: one of stat_max / stat_cur / stat_birth (save.c:443-446).
 *
 * Upstream's rule is NOT the timed one: load.c:723-727 reads the saved count
 * and FAILS THE LOAD when it exceeds STAT_MAX ("Too many stats (%d)."), while
 * a shorter count is read as far as it goes and the rest left at their blank
 * values. So "extra" is an error there and "missing" is not. By name that
 * becomes: a stat this build does not have contributes nothing (it has no slot
 * to corrupt), and a stat the document does not mention keeps its blank value.
 * Refusing the load over a name would be strictly worse than upstream, which
 * only refuses because a longer array would overrun a fixed C buffer.
 */
export function serializeStatValues(
  stats: ArrayLike<number>,
): Record<string, number> {
  return valuesByName(stats, STAT_NAMES, true);
}

/** The inverse: a STAT_MAX-long array. */
export function deserializeStatValues(
  saved: Readonly<Record<string, number>> | undefined,
): number[] {
  return valuesFromNames(saved, STAT_NAMES, STAT_MAX);
}

/**
 * STAT, THE PERMUTATION. `player->stat_map` (save.c:445) is the trap in this
 * set: it is the only one of the four stat arrays whose VALUES are themselves
 * stat indices rather than magnitudes.
 *
 * player-util.c player_scramble_stats/player_fix_scramble is the authority -
 * `new_cur[stat_map[i]] = stat_cur[i]`, so slot `i` currently holds the value
 * that belongs to stat `stat_map[i]`, and at birth the map is the identity.
 * Naming only the KEYS would have left every value a raw STAT index, so a
 * reordered stat table would still have re-pointed a scrambled character's
 * strength at their intelligence. Both halves are names: `{ STR: "INT" }` reads
 * "the value in the STR slot really belongs to INT".
 *
 * A name this build does not have leaves that slot at the identity, which is
 * what player_fix_scramble resets it to anyway.
 */
export function serializeStatMap(map: ArrayLike<number>): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < map.length; i++) {
    const from = STAT_NAMES[i];
    const to = STAT_NAMES[map[i] ?? i];
    if (from !== undefined && to !== undefined) out[from] = to;
  }
  return out;
}

/**
 * The inverse, with a permutation check.
 *
 * A HALF-APPLIED MAP IS WORSE THAN NO MAP. Dropping one unresolvable name from
 * a permutation leaves two slots pointing at the same stat and one at none, and
 * player_fix_scramble would then duplicate one stat's value and lose another's
 * - a silent, permanent stat loss. So the result is validated as a permutation
 * of 0..STAT_MAX-1 and falls back WHOLE to the identity if it is not, which is
 * the value the map legitimately holds for every unscrambled character.
 */
export function deserializeStatMap(
  saved: Readonly<Record<string, string>> | undefined,
): number[] {
  const out = Array.from({ length: STAT_MAX }, (_, i) => i);
  if (saved === undefined) return out;
  for (const [from, to] of Object.entries(saved)) {
    const i = STAT_NAMES.indexOf(from);
    const j = STAT_NAMES.indexOf(to);
    if (i >= 0 && i < STAT_MAX && j >= 0 && j < STAT_MAX) out[i] = j;
  }
  const seen = new Set(out);
  if (seen.size !== STAT_MAX) return Array.from({ length: STAT_MAX }, (_, i) => i);
  return out;
}

/* ------------------------------------------------------------------ *
 * SQUARE: the one table a per-entity name list could not carry.
 * ------------------------------------------------------------------ */

/**
 * THE MEASUREMENT, AND WHY THIS ONE IS A LEGEND.
 *
 * Every other table in #273/#274 belongs to an entity there are tens or
 * hundreds of. `square.info` belongs to a GRID, and a 63x188 level is 11,844 of
 * them - written once for the level in play, once for the Town, and once more
 * for every level in the birth_levels_persist cache.
 *
 * Measured on a real generated level (seed 4242, depth 3, 11,844 grids):
 *
 *   numeric, 3 bytes/grid, as written today          97,731 bytes
 *   one name list per grid, freshly generated        76,624 bytes
 *   one name list per grid, EXPLORED                462,289 bytes  (4.7x)
 *   one name list per grid, every flag set        2,463,553 bytes  (25x)
 *   this build's whole ordered name list, ONCE          214 bytes
 *
 * The freshly-generated figure is the trap: an unexplored level averages 0.49
 * set flags per grid, so `[]` beats `[0,0,0]` and the name form looks FREE. It
 * is not. The instant a character walks the level, MARK / GLOW / ROOM / SEEN /
 * VIEW land on most grids and the same encoding costs 4.7x - a third of a
 * megabyte per level, on a web build whose storage risk is already the reason
 * saves are compressed at all.
 *
 * So the per-grid payload stays numeric and the DOCUMENT carries the legend:
 * the ordered SQUARE_ names, once, alongside the bits that index into them. The
 * legend travels with the save, so it describes the WRITING build's numbering
 * no matter which build reads it - which is the whole property names were
 * bought for, at 0.2% of one level's cost instead of 470%.
 *
 * Upstream reached the same shape by accident and stopped one step short:
 * save.c:967 writes `SQUARE_SIZE` into the file and load.c:1512 reads it back
 * into a file-scope `square_size` that rd_dungeon_aux then uses as its loop
 * bound (load.c:1306). The file already describes its own square encoding
 * there; it just describes the LENGTH and not the ORDER, so a reordered table
 * still lands every flag somewhere else.
 */
export const SQUARE_INFO_LEGEND: readonly string[] = SQUARE_FLAG_ENTRIES.map(
  (e) => e.name,
);

/**
 * A saved legend -> this build's bit numbering, or `null` when the two agree
 * and every byte can be taken as-is (the overwhelmingly common case: the same
 * build, or any build whose SQUARE table has not moved).
 *
 * An absent legend also reads as `null`. That is deliberate and it is safe for
 * one reason only: `V6_TO_V7` stamps the legend onto every document it
 * converts, and no build that could have reordered SQUARE can have written a
 * document at version 6 or below - the same argument `savedFlagSet` rests on in
 * save-migrate.ts.
 */
export function buildSquareInfoRemap(
  legend: readonly string[] | undefined,
): (number | undefined)[] | null {
  if (legend === undefined) return null;
  let moved = false;
  const remap: (number | undefined)[] = [];
  for (let bit = 0; bit < legend.length; bit++) {
    const name = legend[bit];
    const now = name === undefined ? -1 : SQUARE_INFO_LEGEND.indexOf(name);
    remap[bit] = now < 0 ? undefined : now;
    if (now !== bit) moved = true;
  }
  if (!moved && legend.length === SQUARE_INFO_LEGEND.length) return null;
  return remap;
}

/**
 * One grid's info bytes, re-expressed in this build's bit numbering. A bit
 * whose name this build no longer has is dropped, exactly as an unknown flag
 * NAME is dropped everywhere else in this file.
 */
export function remapSquareInfo(
  bytes: readonly number[],
  remap: readonly (number | undefined)[],
): number[] {
  const out = new Array<number>(SQUARE_SIZE).fill(0);
  for (let b = 0; b < bytes.length; b++) {
    const byte = bytes[b] ?? 0;
    if (byte === 0) continue;
    for (let k = 0; k < 8; k++) {
      if ((byte & (1 << k)) === 0) continue;
      const now = remap[b * 8 + k];
      if (now === undefined) continue;
      const target = now >> 3;
      if (target < SQUARE_SIZE) out[target] = (out[target] ?? 0) | (1 << (now & 7));
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Objects.
 * ------------------------------------------------------------------ */

export interface SavedObject {
  /** Namespaced kind id (mod/ids.ts), e.g. "core:sword:dagger". */
  kindId: string;
  /** Ego id, or null when the object has no ego. */
  egoId: string | null;
  /** Artifact id, or null when the object is not an artifact. */
  artifactId: string | null;
  grid: { x: number; y: number } | null;
  tval: number;
  sval: number;
  pval: number;
  knownPval?: number;
  weight: number;
  dd: number;
  ds: number;
  ac: number;
  toA: number;
  toH: number;
  toD: number;
  /**
   * OF_ NAMES of the flags set on the object, not the FlagSet bytes.
   *
   * Version 5 and below wrote `flags: number[]` - the raw bytes, i.e. OF BIT
   * POSITIONS - which is the defect #269 removed one table over. See
   * serializeObjectFlags.
   */
  flagNames: string[];
  /**
   * OBJ_MOD_ name -> value, non-zero entries only. Version 5 and below wrote
   * `modifiers: number[]`, dense and indexed by the OBJ_MOD enum.
   */
  modifierValues: Record<string, number>;
  /**
   * ELEM_ name -> element info, non-default entries only. Version 5 and below
   * wrote `elInfo: ElementInfo[]`, dense and indexed by the ELEM enum.
   */
  elementInfo: Record<string, ElementInfo>;
  /** Brand ids present on the object (the sparse form of the boolean array). */
  brands: string[] | null;
  /** Slay ids present on the object. */
  slays: string[] | null;
  /** Curse ids with their rolled power/timeout (sparse form). */
  curses: Array<{ id: string; power: number; timeout: number }> | null;
  time: RandomValue;
  timeout: number;
  number: number;
  notice: number;
  heldMIdx: number;
  mimickingMIdx: number;
  origin: number;
  originDepth: number;
  /** Origin monster race id, or null when there is no origin race. */
  originRaceId: string | null;
  note: string | null;
  /** C wr_item's effect-present byte (save.c:113-118). */
  effectPresent?: boolean;
  /** C wr_item's saved activation index (save.c:184-188). */
  activationIndex?: number;
  /**
   * obj->known->effect, which upstream only ever holds as NULL or the object's
   * own effect pointer - so one bit says it all. Absent in a save written
   * before the per-object knowledge fields existed, which loads as "whatever
   * the awareness rule gives", i.e. exactly the old behaviour: no
   * SAVE_VERSION bump, and an existing character reads as itself.
   */
  knownEffectPresent?: boolean;
  /** obj->known->activation, same NULL-or-own-pointer encoding. */
  knownActivationPresent?: boolean;
}

export function serializeObject(
  obj: GameObject,
  ids: ContentIdResolver,
): SavedObject {
  return {
    kindId: ids.kindId(obj.kind.kidx),
    egoId: obj.ego ? ids.egoId(obj.ego.eidx) : null,
    artifactId: obj.artifact ? ids.artifactId(obj.artifact.aidx) : null,
    grid: obj.grid ? { x: obj.grid.x, y: obj.grid.y } : null,
    tval: obj.tval,
    sval: obj.sval,
    pval: obj.pval,
    ...(obj.knownPval !== undefined ? { knownPval: obj.knownPval } : {}),
    weight: obj.weight,
    dd: obj.dd,
    ds: obj.ds,
    ac: obj.ac,
    toA: obj.toA,
    toH: obj.toH,
    toD: obj.toD,
    flagNames: serializeObjectFlags(obj.flags),
    modifierValues: serializeObjectModifiers(obj.modifiers),
    elementInfo: serializeObjectElements(obj.elInfo),
    brands: serializeBrandList(obj.brands, ids),
    slays: serializeSlayList(obj.slays, ids),
    curses: serializeCurseList(obj.curses, ids),
    time: { ...obj.time },
    timeout: obj.timeout,
    number: obj.number,
    notice: obj.notice,
    heldMIdx: obj.heldMIdx,
    mimickingMIdx: obj.mimickingMIdx,
    origin: obj.origin,
    originDepth: obj.originDepth,
    originRaceId: obj.originRace ? ids.raceId(obj.originRace) : null,
    note: obj.note,
    effectPresent: obj.effect !== null,
    activationIndex: obj.activation?.index ?? 0,
    ...(obj.knownEffect !== undefined
      ? { knownEffectPresent: obj.knownEffect !== null }
      : {}),
    ...(obj.knownActivation !== undefined
      ? { knownActivationPresent: obj.knownActivation !== null }
      : {}),
  };
}

/** Brand booleans -> the ids of the set brands (drops the dense zeroes). */
function serializeBrandList(
  brands: boolean[] | null,
  ids: ContentIdResolver,
): string[] | null {
  if (!brands) return null;
  const out: string[] = [];
  for (let i = 1; i < brands.length; i++) if (brands[i]) out.push(ids.brandId(i));
  return out;
}

/** Slay booleans -> the ids of the set slays. */
function serializeSlayList(
  slays: boolean[] | null,
  ids: ContentIdResolver,
): string[] | null {
  if (!slays) return null;
  const out: string[] = [];
  for (let i = 1; i < slays.length; i++) if (slays[i]) out.push(ids.slayId(i));
  return out;
}

/** Curse data array -> {id,power,timeout} for the powered curses only. */
function serializeCurseList(
  curses: Array<{ power: number; timeout: number }> | null,
  ids: ContentIdResolver,
): Array<{ id: string; power: number; timeout: number }> | null {
  if (!curses) return null;
  const out: Array<{ id: string; power: number; timeout: number }> = [];
  for (let i = 1; i < curses.length; i++) {
    const c = curses[i];
    if (c && c.power > 0) {
      out.push({ id: ids.curseId(i), power: c.power, timeout: c.timeout });
    }
  }
  return out.length > 0 ? out : null;
}

/** obj_k->curses (power 1 = rune known) -> the ids of the known curses. */
function serializeKnownCurseList(
  curses: number[],
  ids: ContentIdResolver,
): string[] {
  const out: string[] = [];
  for (let i = 1; i < curses.length; i++) if (curses[i]) out.push(ids.curseId(i));
  return out;
}

export function deserializeObject(
  data: SavedObject,
  reg: ObjRegistry,
  ids: ContentIdResolver,
): GameObject {
  const kidx = ids.kindIndex(data.kindId);
  const kind = kidx !== undefined ? reg.kinds[kidx] : undefined;
  if (!kind) throw new Error(`save: unknown object kind ${data.kindId}`);
  const aIdx =
    data.artifactId !== null ? ids.artifactIndex(data.artifactId) : undefined;
  const artifact = aIdx !== undefined ? (reg.artifacts[aIdx] ?? null) : null;
  const eIdx = data.egoId !== null ? ids.egoIndex(data.egoId) : undefined;
  const ego = eIdx !== undefined ? (reg.egos[eIdx] ?? null) : null;
  const originIdx =
    data.originRaceId !== null ? ids.raceIndex(data.originRaceId) : undefined;
  const effectPresent = data.effectPresent ?? true;
  /* load.c:223-232 resolves the saved activation index, not kind defaults. */
  const activation =
    data.activationIndex !== undefined
      ? data.activationIndex > 0
        ? (reg.activations[data.activationIndex] ?? null)
        : null
      : (artifact?.activation ?? kind.activation);
  return {
    kind,
    ego,
    artifact,
    grid: data.grid ? loc(data.grid.x, data.grid.y) : null,
    tval: data.tval,
    sval: data.sval,
    pval: data.pval,
    ...(data.knownPval !== undefined ? { knownPval: data.knownPval } : {}),
    weight: data.weight,
    dd: data.dd,
    ds: data.ds,
    ac: data.ac,
    toA: data.toA,
    toH: data.toH,
    toD: data.toD,
    flags: deserializeObjectFlags(data.flagNames),
    modifiers: deserializeObjectModifiers(data.modifierValues),
    elInfo: deserializeObjectElements(data.elementInfo),
    brands: deserializeBrandList(data.brands, reg, ids),
    slays: deserializeSlayList(data.slays, reg, ids),
    curses: deserializeCurseList(data.curses, reg, ids),
    /* Kind-owned data re-points at the bound kind. */
    effect: effectPresent ? kind.effect : null,
    effectMsg: effectPresent ? kind.effectMsg : "",
    activation,
    /* Re-point at the SAME references the two lines above just restored, so
     * objectEffectIsKnown's identity test still holds after a round trip. */
    ...(data.knownEffectPresent !== undefined
      ? {
          knownEffect:
            data.knownEffectPresent && effectPresent ? kind.effect : null,
        }
      : {}),
    ...(data.knownActivationPresent !== undefined
      ? { knownActivation: data.knownActivationPresent ? activation : null }
      : {}),
    time: { ...data.time },
    timeout: data.timeout,
    number: data.number,
    notice: data.notice,
    heldMIdx: data.heldMIdx,
    mimickingMIdx: data.mimickingMIdx,
    origin: data.origin,
    originDepth: data.originDepth,
    originRace: originIdx ?? 0,
    note: data.note,
  };
}

/** Brand ids -> the dense boolean array (length brandMax), or null. */
function deserializeBrandList(
  saved: string[] | null,
  reg: ObjRegistry,
  ids: ContentIdResolver,
): boolean[] | null {
  if (!saved) return null;
  const out = new Array<boolean>(reg.brandMax).fill(false);
  for (const id of saved) {
    const i = ids.brandIndex(id);
    if (i !== undefined) out[i] = true;
  }
  return out;
}

/** Slay ids -> the dense boolean array (length slayMax), or null. */
function deserializeSlayList(
  saved: string[] | null,
  reg: ObjRegistry,
  ids: ContentIdResolver,
): boolean[] | null {
  if (!saved) return null;
  const out = new Array<boolean>(reg.slayMax).fill(false);
  for (const id of saved) {
    const i = ids.slayIndex(id);
    if (i !== undefined) out[i] = true;
  }
  return out;
}

/** Curse id list -> the dense CurseData array (length curseMax), or null. */
function deserializeCurseList(
  saved: Array<{ id: string; power: number; timeout: number }> | null,
  reg: ObjRegistry,
  ids: ContentIdResolver,
): Array<{ power: number; timeout: number }> | null {
  if (!saved) return null;
  const out: Array<{ power: number; timeout: number }> = [];
  for (let i = 0; i < reg.curseMax; i++) out.push({ power: 0, timeout: 0 });
  for (const c of saved) {
    const i = ids.curseIndex(c.id);
    if (i !== undefined) out[i] = { power: c.power, timeout: c.timeout };
  }
  return out;
}

/** Known-curse ids -> the dense obj_k->curses array (power 1 = known). */
function deserializeKnownCurseList(
  saved: string[],
  reg: ObjRegistry,
  ids: ContentIdResolver,
): number[] {
  const out = new Array<number>(reg.curseMax).fill(0);
  for (const id of saved) {
    const i = ids.curseIndex(id);
    if (i !== undefined) out[i] = 1;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Monsters and groups.
 * ------------------------------------------------------------------ */

export interface SavedMonster {
  /** Namespaced monster race id, e.g. "core:kobold". */
  raceId: string;
  /** Original race id (for a polymorphed/shaped monster), or null. */
  originalRaceId: string | null;
  midx: number;
  grid: { x: number; y: number };
  hp: number;
  maxhp: number;
  /**
   * m_timed (save.c:223-226), as a MON_TMD_ name -> turns map. Version 6 and
   * below wrote `mTimed: number[]`, dense and indexed by the MON_TMD enum.
   */
  monsterTimed: Record<string, number>;
  mspeed: number;
  energy: number;
  cdis: number;
  /**
   * mflag (save.c:228-229), as MFLAG_ NAMES. Version 6 and below wrote
   * `mflag: number[]`, the raw FlagSet bytes.
   */
  mflagNames: string[];
  mimickedObj: number;
  heldObj: SavedObject[];
  attr: number;
  target: { grid: { x: number; y: number }; midx: number };
  groupInfo: MonsterGroupInfo[];
  minRange: number;
  bestRange: number;
  /**
   * C wr_monster's known_pstate.flags (save.c:231-232), as OF_ NAMES. Version 5
   * and below wrote `knownPstateFlags: number[]`, the raw FlagSet bytes.
   */
  knownPstateFlagNames?: string[];
  /**
   * C wr_monster's known_pstate.el_info[].res_level (save.c:234-235), as an
   * ELEM_ name -> level map. Version 5 and below wrote `knownPstateElInfo:
   * number[]`, dense and indexed by the ELEM enum.
   */
  knownPstateElementRes?: Record<string, number>;
}

export function serializeMonster(
  mon: Monster,
  ids: ContentIdResolver,
): SavedMonster {
  return {
    raceId: ids.raceId(mon.race.ridx),
    originalRaceId: mon.originalRace ? ids.raceId(mon.originalRace.ridx) : null,
    midx: mon.midx,
    grid: { x: mon.grid.x, y: mon.grid.y },
    hp: mon.hp,
    maxhp: mon.maxhp,
    monsterTimed: serializeMonsterTimed(mon.mTimed),
    mspeed: mon.mspeed,
    energy: mon.energy,
    cdis: mon.cdis,
    mflagNames: serializeMonsterFlags(mon.mflag),
    mimickedObj: mon.mimickedObj,
    heldObj: mon.heldObj.map((o) => serializeObject(o, ids)),
    attr: mon.attr,
    target: {
      grid: { x: mon.target.grid.x, y: mon.target.grid.y },
      midx: mon.target.midx,
    },
    groupInfo: mon.groupInfo.map((g) => ({ ...g })),
    minRange: mon.minRange,
    bestRange: mon.bestRange,
    knownPstateFlagNames: serializeObjectFlags(mon.knownPstate.flags),
    knownPstateElementRes: serializeElementLevels(mon.knownPstate.elInfo),
  };
}

/** rd_monster (load.c:259), over JSON instead of the binary block. */
export function deserializeMonster(
  data: SavedMonster,
  monsters: MonsterRegistry,
  objects: ObjRegistry,
  ids: ContentIdResolver,
): Monster {
  const ridx = ids.raceIndex(data.raceId);
  const race = ridx !== undefined ? monsters.races[ridx] : undefined;
  if (!race) throw new Error(`save: unknown race ${data.raceId}`);
  const mon = blankMonster(race);
  const origRidx =
    data.originalRaceId !== null
      ? ids.raceIndex(data.originalRaceId)
      : undefined;
  mon.originalRace = origRidx !== undefined ? (monsters.races[origRidx] ?? null) : null;
  mon.midx = data.midx;
  mon.grid = loc(data.grid.x, data.grid.y);
  mon.hp = data.hp;
  mon.maxhp = data.maxhp;
  mon.mTimed.set(deserializeMonsterTimed(data.monsterTimed));
  mon.mspeed = data.mspeed;
  mon.energy = data.energy;
  mon.cdis = data.cdis;
  mon.mflag.copy(deserializeMonsterFlags(data.mflagNames));
  if (data.knownPstateFlagNames) {
    /* load.c:302 restores known_pstate.flags before the monster goes live. */
    mon.knownPstate.flags.copy(deserializeObjectFlags(data.knownPstateFlagNames));
  }
  if (data.knownPstateElementRes) {
    /* load.c:305 restores known_pstate.el_info[].res_level before live use. */
    mon.knownPstate.elInfo.set(
      deserializeElementLevels(data.knownPstateElementRes),
    );
  }
  mon.mimickedObj = data.mimickedObj;
  mon.heldObj = data.heldObj.map((o) => deserializeObject(o, objects, ids));
  mon.attr = data.attr;
  mon.target = {
    grid: loc(data.target.grid.x, data.target.grid.y),
    midx: data.target.midx,
  };
  for (let i = 0; i < GROUP_MAX; i++) {
    const g = data.groupInfo[i];
    if (g) mon.groupInfo[i] = { ...g };
  }
  mon.minRange = data.minRange;
  mon.bestRange = data.bestRange;
  return mon;
}

/* ------------------------------------------------------------------ *
 * Player.
 * ------------------------------------------------------------------ */

export interface SavedPlayer {
  raceName: string;
  clsName: string;
  hitdie: number;
  expFactor: number;
  age: number;
  ht: number;
  wt: number;
  au: number;
  maxLev: number;
  lev: number;
  maxExp: number;
  exp: number;
  expFrac: number;
  /** Recall / descent state (absent in older saves; default 0). */
  maxDepth?: number;
  recallDepth?: number;
  wordRecall?: number;
  deepDescent?: number;
  mhp: number;
  chp: number;
  chpFrac: number;
  msp: number;
  csp: number;
  cspFrac: number;
  /**
   * stat_max / stat_cur / stat_birth (save.c:443-446), as STAT_ name -> value
   * maps. Version 6 and below wrote `statMax` / `statCur` / `statBirth`, dense
   * arrays indexed by the STAT enum.
   */
  statMaxValues: Record<string, number>;
  statCurValues: Record<string, number>;
  statBirthValues: Record<string, number>;
  /**
   * stat_map (save.c:445): a PERMUTATION, so both halves are names - see
   * `serializeStatMap`. Version 6 and below wrote `statMap: number[]`, whose
   * values were raw STAT indices.
   */
  statMapNames: Record<string, string>;
  /**
   * timed (save.c:508-511), as a TMD_ name -> turns map, zeroes omitted.
   * Version 6 and below wrote `timed: number[]`, dense and indexed by TMD.
   */
  timedValues: Record<string, number>;
  spellFlags: number[];
  spellOrder: number[];
  playerHp: number[];
  auBirth: number;
  htBirth: number;
  wtBirth: number;
  /**
   * full_name (save.c:422): the character's name. Optional: absent in saves
   * written before the field, which load with an empty name (buildScore falls
   * back to the empty string exactly as before this field existed).
   */
  fullName?: string;
  /**
   * died_from (save.c:424): the cause-of-death string. Optional: absent saves
   * load with an empty string.
   */
  diedFrom?: string;
  /**
   * noscore (save.c:623, wr_u16b): the cheater bit mask. Optional: absent saves
   * load as 0 (a clean, scored character).
   */
  noscore?: number;
  history: string;
  /**
   * hist (player-history.h struct player_history): the runtime auto-history
   * event log - absent in saves predating this field, which load as an
   * empty log (SAVEFILE_IMPORT-tolerant posture, matching load.c's
   * best-effort read of older savefiles).
   */
  hist?: SavedHistoryInfo[];
  equipment: number[];
  /**
   * obj_k, every rune variety (wr_player's object knowledge). Older saves
   * (pre rune learn-by-use) carried only objKnownModifiers; the reader
   * accepts both.
   */
  objKnown?: {
    /** OBJ_MOD_ name -> value; was `modifiers: number[]` before version 6. */
    modifierValues: Record<string, number>;
    toA: number;
    toH: number;
    toD: number;
    /**
     * obj_k->dd / ds / ac (the "know dice"/"know ac" runes). Optional: saves
     * written before these fields existed omit them; the reader defaults each
     * to 1 (obvious birth knowledge, always correct - see player_outfit).
     */
    dd?: number;
    ds?: number;
    ac?: number;
    /** ELEM_ name -> element info; was `elInfo: ElementInfo[]`. */
    elementInfo: Record<string, ElementInfo>;
    /** OF_ names of the known flag runes; was `flags: number[]` (the bytes). */
    flagNames: string[];
    /** Ids of the brand runes the player has learned. */
    brands: string[];
    /** Ids of the slay runes the player has learned. */
    slays: string[];
    /** Ids of the curse runes the player has learned. */
    curses: string[];
  };
  /**
   * Legacy (save version 1 pre-#13): modifier runes only, and by NAME as of
   * version 7. Version 6 and below kept this as `objKnownModifiers: number[]`,
   * a dense OBJ_MOD array - #273 converted the modern `objKnown.modifiers` and
   * left its legacy twin on positions, where four migrations had already
   * carried it untouched.
   */
  objKnownModifierValues?: Record<string, number>;
  shapeName: string | null;
  /**
   * The derived level-based skills, as a SKILL_ name -> value map (every slot,
   * see `serializePlayerSkills`). Version 6 and below wrote `skills: number[]`.
   */
  skillValues: Record<string, number>;
  upkeep: { playing: boolean; newSpells: number; totalWeight: number };
  /**
   * quests (player-quest.h): the per-character quest history. Optional: absent
   * in saves written before the quest system, which reload with no quests (and
   * hence no win condition until re-birthed) - the SAVEFILE_IMPORT-tolerant
   * posture matching the other late-added fields.
   */
  quests?: PlayerQuest[];
  /** total_winner: the victory flag. Optional; absent saves load as false. */
  totalWinner?: boolean;
}

/** Serialized history entry; C save.c:1063-1067 writes the artifact NAME. */
export interface SavedHistoryInfo {
  type: number;
  dlev: number;
  clev: number;
  artifactName: string;
  turn: number;
  event: string;
  /** A mod saved `event` as raw user input for display-time expansion. */
  expandUserInput?: true;
  /** Legacy JSON saves used a numeric aIdx; never written by this version. */
  aIdx?: number;
}

export function serializePlayer(
  p: Player,
  ids: ContentIdResolver,
): SavedPlayer {
  return {
    raceName: p.race.name,
    clsName: p.cls.name,
    hitdie: p.hitdie,
    expFactor: p.expFactor,
    age: p.age,
    ht: p.ht,
    wt: p.wt,
    au: p.au,
    maxLev: p.maxLev,
    lev: p.lev,
    maxExp: p.maxExp,
    exp: p.exp,
    expFrac: p.expFrac,
    maxDepth: p.maxDepth,
    recallDepth: p.recallDepth,
    wordRecall: p.wordRecall,
    deepDescent: p.deepDescent,
    mhp: p.mhp,
    chp: p.chp,
    chpFrac: p.chpFrac,
    msp: p.msp,
    csp: p.csp,
    cspFrac: p.cspFrac,
    statMaxValues: serializeStatValues(p.statMax),
    statCurValues: serializeStatValues(p.statCur),
    statMapNames: serializeStatMap(p.statMap),
    statBirthValues: serializeStatValues(p.statBirth),
    timedValues: serializePlayerTimed(p.timed),
    spellFlags: [...p.spellFlags],
    spellOrder: [...p.spellOrder],
    playerHp: [...p.playerHp],
    auBirth: p.auBirth,
    htBirth: p.htBirth,
    wtBirth: p.wtBirth,
    fullName: p.fullName,
    diedFrom: p.diedFrom,
    noscore: p.noscore,
    history: p.history,
    hist: p.hist.map((e) => ({
      type: e.type,
      dlev: e.dlev,
      clev: e.clev,
      artifactName: ids.artifactName(e.aIdx) ?? "",
      turn: e.turn,
      event: e.event,
      ...(e.expandUserInput === true ? { expandUserInput: true } : {}),
    })),
    equipment: [...p.equipment],
    objKnown: {
      modifierValues: serializeObjectModifiers(p.objKnown.modifiers),
      toA: p.objKnown.toA,
      toH: p.objKnown.toH,
      toD: p.objKnown.toD,
      dd: p.objKnown.dd,
      ds: p.objKnown.ds,
      ac: p.objKnown.ac,
      elementInfo: serializeObjectElements(p.objKnown.elInfo),
      flagNames: serializeObjectFlags(p.objKnown.flags),
      /* The learned runes save as the ids of the known brands/slays/curses. */
      brands: serializeBrandList(p.objKnown.brands, ids) ?? [],
      slays: serializeSlayList(p.objKnown.slays, ids) ?? [],
      curses: serializeKnownCurseList(p.objKnown.curses, ids),
    },
    shapeName: p.shape ? p.shape.name : null,
    skillValues: serializePlayerSkills(p.skills),
    /* THE THREE DECLARED FIELDS, NAMED. `{ ...p.upkeep }` wrote whatever the live
     * object happened to hold, which is not what the type above says: `notice`,
     * `dropping`, `repeatPrevAllowed` and `lastCmdUsedFloorItem` are transients
     * that exist only within a turn, and every one of them was leaking into the
     * savefile as soon as it was added - the declared type never objected,
     * because a spread satisfies a narrower type by supplying MORE. Upstream's
     * wr_player writes no part of upkeep at all. Named fields make the type the
     * authority, and adding a fifth transient can no longer widen the save
     * format by accident. */
    upkeep: {
      playing: p.upkeep.playing,
      newSpells: p.upkeep.newSpells,
      totalWeight: p.upkeep.totalWeight,
    },
    quests: p.quests.map((q) => ({ ...q })),
    totalWinner: p.totalWinner,
  };
}

export function deserializePlayer(
  data: SavedPlayer,
  players: PlayerRegistry,
  objReg: ObjRegistry,
  ids: ContentIdResolver,
  /* The bound standard quest table (registries.quests), for rd_quests below.
   * Required rather than defaulted: a caller that forgets it would silently
   * load a character with no quests and no win condition, which is precisely
   * the failure this parameter exists to prevent. Pass [] to mean "this game
   * has no quest table". */
  quests: readonly Quest[],
): Player {
  const race = players.raceByName(data.raceName);
  const cls = players.classByName(data.clsName);
  if (!race || !cls) {
    throw new Error(`save: unknown race/class ${data.raceName}/${data.clsName}`);
  }
  const body = players.bodies[race.body] ?? players.bodies[0]!;
  const p = blankPlayer(race, cls, body);
  p.hitdie = data.hitdie;
  p.expFactor = data.expFactor;
  p.age = data.age;
  p.ht = data.ht;
  p.wt = data.wt;
  p.au = data.au;
  /* load.c:767-780 rejects levels outside 1..PY_MAX_LEVEL. */
  if (data.lev < 1 || data.lev > PY_MAX_LEVEL) {
    throw new Error(`save: invalid player level ${data.lev}`);
  }
  /* load.c:785-789 repairs max_lev, max_depth and recall_depth. */
  p.maxLev = data.maxLev < data.lev ? data.lev : data.maxLev;
  p.lev = data.lev;
  p.maxExp = data.maxExp;
  p.exp = data.exp;
  p.expFrac = data.expFrac;
  p.maxDepth = data.maxDepth ?? 0;
  if (p.maxDepth < 0) p.maxDepth = 1;
  p.recallDepth = data.recallDepth ?? 0;
  if (p.recallDepth <= 0) p.recallDepth = p.maxDepth;
  p.wordRecall = data.wordRecall ?? 0;
  p.deepDescent = data.deepDescent ?? 0;
  p.mhp = data.mhp;
  p.chp = data.chp;
  p.chpFrac = data.chpFrac;
  p.msp = data.msp;
  p.csp = data.csp;
  p.cspFrac = data.cspFrac;
  /* load.c:723-732: a saved stat this build does not have contributes nothing,
   * and one the save omits keeps its blank value - see serializeStatValues. */
  p.statMax = deserializeStatValues(data.statMaxValues);
  p.statCur = deserializeStatValues(data.statCurValues);
  p.statMap = deserializeStatMap(data.statMapNames);
  p.statBirth = deserializeStatValues(data.statBirthValues);
  /* load.c:811-829 reads only supported timed entries and discards extras. By
   * name that is a name this build does not have, dropped without complaint. */
  p.timed.set(deserializePlayerTimed(data.timedValues));
  p.spellFlags = [...data.spellFlags];
  p.spellOrder = [...data.spellOrder];
  p.playerHp = [...data.playerHp];
  p.auBirth = data.auBirth;
  p.htBirth = data.htBirth;
  p.wtBirth = data.wtBirth;
  /* full_name / died_from / noscore (load.c:661, load.c:966): absent in saves
   * predating the fields, which restore the blankPlayer defaults ("" / "" / 0). */
  p.fullName = data.fullName ?? "";
  /* load.c:791-793 resets died_from whenever HP is non-negative. */
  p.diedFrom = p.chp >= 0 ? "(alive and well)" : (data.diedFrom ?? "");
  p.noscore = data.noscore ?? 0;
  p.history = data.history;
  p.hist = [];
  for (const e of data.hist ?? []) {
    let aIdx = 0;
    const artifactName = e.artifactName ?? "";
    if (artifactName) {
      const artifact = objReg.artifacts.find((a) => a?.name === artifactName);
      if (!artifact) continue;
      aIdx = artifact.aidx;
    } else if (e.aIdx !== undefined) {
      /* Tolerate the pre-fix JSON shape, while all new saves use names. */
      aIdx = e.aIdx;
    }
    p.hist.push({
      type: e.type,
      dlev: e.dlev,
      clev: e.clev,
      aIdx,
      turn: e.turn,
      event: e.event,
      ...(e.expandUserInput === true ? { expandUserInput: true } : {}),
    });
  }
  p.equipment = [...data.equipment];
  if (data.objKnown) {
    p.objKnown = {
      modifiers: deserializeObjectModifiers(data.objKnown.modifierValues),
      toA: data.objKnown.toA,
      toH: data.objKnown.toH,
      toD: data.objKnown.toD,
      /* Default to 1 for pre-field saves: dd/ds/ac are obvious birth knowledge
       * (player_outfit), always 1, so an absent value restores exactly. */
      dd: data.objKnown.dd ?? 1,
      ds: data.objKnown.ds ?? 1,
      ac: data.objKnown.ac ?? 1,
      elInfo: deserializeObjectElements(data.objKnown.elementInfo),
      flags: deserializeObjectFlags(data.objKnown.flagNames),
      brands: deserializeBrandList(data.objKnown.brands, objReg, ids) ?? [],
      slays: deserializeSlayList(data.objKnown.slays, objReg, ids) ?? [],
      curses: deserializeKnownCurseList(data.objKnown.curses, objReg, ids),
    };
  } else if (data.objKnownModifierValues) {
    /* Legacy pre-#13 save: only the modifier runes were tracked. By name as of
     * version 7, through the same helper the modern field uses. */
    p.objKnown.modifiers = deserializeObjectModifiers(
      data.objKnownModifierValues,
    );
  }
  p.shape =
    data.shapeName !== null
      ? (players.shapes.find((s) => s.name === data.shapeName) ?? null)
      : null;
  p.skills = deserializePlayerSkills(data.skillValues);
  /* notice is NOT in the savefile, exactly as upstream's is not: it is a queue
   * of work owed within a turn, and a save can only happen with the queue
   * drained. A loaded character therefore starts it at 0 rather than at
   * whatever a spread of the serialized subset would leave undefined. */
  p.upkeep = {
    ...data.upkeep,
    notice: 0,
    dropping: false,
    /* cmd-core.c:260's static initialiser: a loaded game starts with the repeat
     * key inert, because there is no remembered command to repeat. */
    repeatPrevAllowed: false,
    lastCmdUsedFloorItem: false,
  };
  /* rd_quests (load.c:623-645). Upstream does NOT restore the quest list from
   * the savefile: it calls player_quests_reset to rebuild the whole history
   * from the CURRENT quest table, then overlays only the two mutable fields,
   * `level` and `cur_num`. Name, race and max_num therefore always come from
   * the game's own data, never from the save - which is what keeps a character
   * loading correctly after the monster table has shifted underneath their
   * stored race index, and what re-arms the win condition for a save written
   * before this system existed.
   *
   * The over-count rejection is upstream's too (load.c:630-633: "Too many (%u)
   * quests!" and a failed load) - a save claiming more quests than the game
   * defines is not something to silently truncate. */
  playerQuestsReset(p, quests);
  if (data.quests) {
    if (data.quests.length > quests.length) {
      throw new Error(`save: too many (${data.quests.length}) quests`);
    }
    data.quests.forEach((saved, i) => {
      const q = p.quests[i];
      if (!q) return;
      q.level = saved.level;
      q.curNum = saved.curNum;
    });
  }
  p.totalWinner = data.totalWinner ?? false;
  return p;
}

/* ------------------------------------------------------------------ *
 * The whole game.
 * ------------------------------------------------------------------ */

export interface SavedTrap {
  /** Namespaced trap-kind id, e.g. "core:trap-door". */
  trapId: string;
  grid: { x: number; y: number };
  power: number;
  timeout: number;
  /**
   * TRF_ NAMES of the trap's flags. Version 6 and below wrote `flags:
   * number[]`, the raw FlagSet bytes. Spelled `trapFlagNames` rather than
   * `flagNames` on purpose: `SavedObject.flagNames` is an OF list, and the one
   * thing V5_TO_V6's discriminator comment proves is that a `flags`-shaped
   * field naming four different tables is how data gets rewritten as the wrong
   * thing.
   */
  trapFlagNames: string[];
}

export interface SavedGame {
  version: number;
  player: SavedPlayer;
  actor: {
    grid: { x: number; y: number };
    energy: number;
    totalEnergy: number;
  };
  gear: { next: number; pack: number[]; store: Array<[number, SavedObject]> };
  /** Omitted for dead saves, matching save.c:873-1045. */
  chunk?: ChunkSquaresData;
  /**
   * Feature legend: every terrain index that appears in chunk.feats or
   * known.feat, paired with its namespaced feature id. The grid stays a
   * compact numeric array (one small legend, not a string per cell); on load
   * the numeric feats are remapped through the legend to the current pack's
   * indices, so terrain references survive pack changes exactly like every
   * other content reference (MOD_LIFECYCLE decision 1). Optional only for the
   * degenerate empty-level case.
   */
  featLegend?: Array<[number, string]>;
  /**
   * Square-info legend (#274): the writing build's ordered SQUARE_ flag names,
   * ONCE for the whole document. Every per-grid `info` byte array in the
   * document - `chunk`, `townChunk`, every `levelCache[].chunk`, and the
   * connector `info` blocks beside them - is indexed into THIS list, not into
   * the reading build's table. See `SQUARE_INFO_LEGEND` for the measurement
   * that chose a legend over a name list per grid.
   *
   * Absent means "this build's numbering", which is true of every document at
   * version 6 or below and is what V6_TO_V7 stamps.
   */
  squareInfoLegend?: string[];
  monsters?: Array<SavedMonster | null>;
  groups?: Array<MonsterGroup | null>;
  /** Floor piles in pile order (head first), keyed by grid. */
  floor?: Array<{ x: number; y: number; objs: SavedObject[] }>;
  traps?: Array<{ x: number; y: number; traps: SavedTrap[] }>;
  /** The dungeon header retained by C even when the player is dead. */
  dungeonDepth?: number;
  rng: RngState;
  turn: number;
  playing: boolean;
  isDead: boolean;
  /**
   * kind->aware / kind->tried (wr_object_memory, save.c:399-401), by namespaced
   * kind id. Upstream writes these positionally by kidx and rd_object_memory
   * reads them back positionally (load.c:602-620), so a data change that
   * re-orders k_info silently re-targets them; the port's format keys every
   * content reference by id instead (SAVE_VERSION 3).
   */
  flavor: { aware: string[]; tried: string[] };
  /**
   * kind->everseen / ego->everseen (save.c L397, L533): the per-game "ever
   * seen" flags for object kinds and egos, by namespaced id (see `flavor`).
   * Optional: absent in saves written before everseen tracking, which reload
   * with an empty set (the object browser then falls back to flavour-aware
   * membership only).
   */
  everseen?: { kinds: string[]; egos: string[] };
  /**
   * seed_flavor (game-world.c): the seed flavor_init used to assign object
   * colours/titles. Optional: absent in saves written before flavour
   * assignment, which reload with a stable seed-0 assignment.
   */
  seedFlavor?: number;
  /**
   * The player's map knowledge (game/known.ts). Optional: absent in
   * version-1 saves written before the knowledge layer, which load with
   * an all-unknown map.
   */
  known?: SavedKnown;
  /**
   * Monster memory (mon/lore.ts), keyed by monster race id. Optional: absent
   * in saves written before lore, which load with no memory. Upstream splits
   * this between the savefile (pkills/thefts) and the user lore file; the
   * JSON save carries the whole record.
   */
  lore?: Array<[string, SavedLore]>;
  /**
   * Single combat in progress (upkeep->arena_level + player->old_grid), plus
   * the level the player left to get here and the midx of the opponent's
   * ORIGINAL on it. Upstream keeps that level in the chunk_list, which the
   * savefile carries, so a reload resumes the fight AND still knows where to
   * put the player back; `stash` is that level. Absent in saves written before
   * it was persisted (and in a save taken with the pre-arena level already
   * lost), which reload with the old behaviour: winning exits to a fresh level
   * of the same depth.
   */
  arena?: {
    oldGrid: { x: number; y: number };
    stash?: SavedStoredLevel;
    monMidx?: number;
  };
  /**
   * The town stores (store.c wr_stores, save.c:744-765): every shop's current
   * proprietor and full stock, in registry order - including FEAT_HOME, whose
   * stock is the player's home stash (gap 12.1: the home stash must survive
   * save/load). Optional: absent in saves written before store persistence and
   * in saves taken before the player ever reached town, which reload and
   * re-stock fresh (the pre-fix behaviour). See serializeStores.
   */
  stores?: SavedStore[];
  /**
   * daycount (game-world.c / save.c:963): store turnovers accrued while in the
   * dungeon, consumed by store_update on the return to town (gap 12.3). Optional
   * / 0 when no days have elapsed.
   */
  daycount?: number;
  /**
   * player->resting_turn (save.c:507; wr_player): the cumulative count of player
   * turns spent resting. Gap 12.6. Optional / omitted when 0 (a character that
   * has never rested), which loads back as 0. See GameState.restingTurn.
   */
  restingTurn?: number;
  /**
   * player->skip_cmd_coercion (save.c:490; wr_player): the bloodlust command
   * -coercion skip state (0/1/2). Gap 12.6. Optional / omitted when 0.
   */
  skipCmdCoercion?: number;
  /**
   * player->unignoring (save.c:491; wr_player): the temporary "show ignored
   * items" toggle. Gap 12.6. Optional / omitted when 0 (ignoring active).
   */
  unignoring?: number;
  /**
   * player->opts.name_suffix (save.c:432; wr_player): the numeric name suffix
   * for the high-score table. Gap 12.6. Optional / omitted when 0.
   */
  nameSuffix?: number;
  /**
   * The rolling message log (wr_messages/rd_messages, save.c:339-353 /
   * load.c:471-495). Gap 12.8. Each entry is text + MSG_* type, in the savefile's
   * oldest-first order and capped at the 80 newest messages (save.c:345). The
   * per-entry repeat count is NOT persisted - upstream wr_messages writes only
   * message_str/message_type, so a reload collapses through message_add and every
   * count resets to 1 (the quirk is preserved). Optional / omitted for an empty
   * log and in saves written before message persistence, which load empty.
   */
  messages?: SavedMessage[];
  /**
   * The player's ignore settings (obj-ignore.c). Optional: absent in saves
   * written before ignoring, which load with everything shown.
   */
  ignore?: SavedIgnoreSettings;
  /**
   * The player option store (option.c): every option value, hitpoint_warn /
   * delay_factor, and the immutable birth-option snapshot. Optional: absent in
   * saves written before the option store, which load with the table defaults.
   */
  options?: import("../player/options.js").OptionStateData;
  /**
   * randart_seed (obj-randart.c): the seed do_randart used when birth_randarts
   * is on. Optional / 0 when the standard artifact set is in use. Persisted so
   * a reload rebuilds the identical random artifact set.
   */
  randartSeed?: number;
  /**
   * aup_info[] (obj-make.c): the ids of the artifacts already created. Stored
   * as an id list (not a by-aidx boolean array) so the created set survives
   * pack changes. Optional / absent in saves written before artifact
   * generation landed, which load with an all-false set.
   */
  artifactsCreated?: string[];
  /** aup_info[].seen (save.c:684-685). */
  artifactsSeen?: string[];
  /** aup_info[].everseen (save.c:685-686). */
  artifactsEverseen?: string[];
  /**
   * The manifest block (mod/save-blocks.ts, P7.2): the pack set + resolved load
   * order + core-owned determinism mode that produced this save - its profile
   * fingerprint. Optional: absent in saves written before the mod substrate,
   * which load as core-only + deterministic (coreOnlyManifest).
   */
  manifest?: SaveManifest;
  /**
   * Per-mod private bags (mod:<id>), keyed by pack id: opaque JSON the engine
   * never interprets, versioned by each mod's saveSchema. Absent when no mod
   * persisted state. Round-tripped verbatim; migrated only by the owning mod.
   */
  mods?: Record<string, ModBag>;
  /**
   * The orphans store (orphans:<id>@<version>): entities quarantined because
   * their defining pack is missing or shadowed (mod/save-blocks.ts). Frozen and
   * inert, restored by rehydrateSave when the pack returns. Absent when nothing
   * is quarantined.
   */
  orphans?: OrphanStore;
  /**
   * decision-8 seam: whether the one-time keep/purge orphan prompt has already
   * been shown for this save. Core computes the orphan count; the UI shows the
   * prompt once and sets this so it never nags again. Absent = not yet shown.
   */
  orphansAcknowledged?: boolean;
  /**
   * birth_levels_persist (#30) frozen-level cache (game/context.ts StoredLevel),
   * one entry per cached depth, reusing the same chunk / monster / floor / trap /
   * known serializers as the current level. Optional / absent when the option is
   * off (the default) or no level has been frozen: older and default saves load
   * with an empty cache (back-compat, like every other optional field here).
   */
  levelCache?: SavedStoredLevel[];
  /**
   * GameState.currentJoins: the in-play level's stair connectors (chunk->join,
   * generate.c L1203-1214), so a first-visit persistent level can align stairs
   * with the level just left. Absent when the option is off / no joins recorded.
   */
  currentJoins?: Array<{ x: number; y: number; feat: number; info?: number[] }>;
  /**
   * The per-kind autoinscription registry (obj-ignore.c note_aware/note_unaware,
   * obj/knowledge.ts AutoinscriptionRegistry). Keyed by the namespaced kind id
   * (like every other content reference, MOD_LIFECYCLE decision 1) so notes
   * survive pack reordering. Optional / absent when nothing is registered:
   * older saves and the default (no autoinscriptions) load with an empty
   * registry, back-compat like every other optional field here.
   */
  autoinscriptions?: SavedAutoinscription[];
  /**
   * The per-RUNE autoinscriptions (rune_list[i].note; wr_ignore save.c:586-605,
   * rd_ignore load.c:937-945). Keyed by runeKey (obj/knowledge.ts), the
   * pack-stable form of the raw index upstream writes (`wr_s16b(k)`,
   * save.c:600); the runtime registry is still index-keyed like rune_list.
   * Absent when no rune carries a note.
   */
  runeNotes?: Array<[string, string]>;
  /**
   * Terrain-only Town chunk (wr_chunks always saves the Town entry even when
   * birth_levels_persist is OFF; generate.c:1371-1373 / save.c:1001-1044).
   * Present after leaving depth 0 without persist; consumed on town re-entry.
   * Optional / absent in older saves and before the player has left town.
   */
  townChunk?: ChunkSquaresData;
  /** Feature legend for townChunk feats (same remap contract as levelCache). */
  townFeatLegend?: Array<[number, string]>;
}

/** One serialized per-kind autoinscription entry (namespaced kind id + notes). */
export interface SavedAutoinscription {
  kindId: string;
  aware?: string;
  unaware?: string;
}

/**
 * One serialized message-log entry (wr_messages, save.c:350-351): the message
 * text and its MSG_* type. The repeat count is intentionally NOT stored -
 * upstream persists only message_str/message_type, so counts do not survive a
 * reload (see SavedGame.messages).
 */
export interface SavedMessage {
  str: string;
  type: number;
}

/**
 * Serialize the rolling message log (wr_messages, save.c:339-353): the newest
 * `cap` messages (default 80, the upstream limit) written oldest-first, each as
 * text + type. Returns undefined for an empty / absent log so a clean save omits
 * the block. Faithful to the C: the per-entry repeat count is dropped, so a
 * reload recollapses through MessageLog.add and every count resets to 1.
 */
export function serializeMessages(
  log: MessageLog | undefined,
  cap = 80,
): SavedMessage[] | undefined {
  if (!log || log.num() === 0) return undefined;
  const num = Math.min(log.num(), cap);
  const out: SavedMessage[] = [];
  /* save.c:349 dumps oldest-of-the-kept first (i = num - 1 down to 0). */
  for (let age = num - 1; age >= 0; age--) {
    out.push({ str: log.str(age), type: log.type(age) });
  }
  return out;
}

/**
 * Rebuild a message log from its saved form (rd_messages, load.c:471-495):
 * re-add each entry oldest-first via MessageLog.add, exactly as upstream calls
 * message_add in a forward loop. An absent block (older save / empty log) yields
 * a fresh empty log.
 */
export function deserializeMessages(
  data: SavedMessage[] | undefined,
): MessageLog {
  const log = new MessageLog();
  if (!data) return log;
  for (const m of data) log.add(m.str, m.type);
  return log;
}

/** Serialized map knowledge (remembered terrain and floor objects). */
export interface SavedKnown {
  feat: number[];
  /**
   * The remembered PILE per grid, in the order map_info walks it. SAVE_VERSION
   * 4; version 3 stored a single memory per grid, which migrate3to4 widens to
   * a one-element list.
   */
  objects: Array<[number, SavedKnownObject[]]>;
}

/**
 * One remembered floor object (game/known.ts KnownObject).
 *
 * A remembered object IS a live object - the port's twin link is a reference
 * (see game/known.ts) - so the saved form is a LOCATOR into the saved floor
 * rather than a copy: `at` is `[grid index of the pile, position within it]`,
 * and the floor is written pile-by-pile in order, so the pair round-trips
 * reference identity exactly. Identity is what forget_remembered_objects
 * compares, so a copy here would quietly drop every memory on the next
 * know/sense.
 *
 * `sensed` is object_sense's fake kind: something is here, but not what.
 *
 * `kindId` / `money` are the fallback for a memory whose original is no longer
 * on any floor pile - upstream keeps such a shadow until the grid is re-seen,
 * and it is rebuilt here as a detached object that the next know/sense of that
 * grid excises, which is precisely what upstream's forget_remembered_objects
 * does with it.
 *
 * `ch` / `attr` are the PRE-0.18 shape, when the memory was a glyph resolved at
 * memorize time rather than a kind. A glyph cannot be turned back into a kind,
 * so such an entry degrades to the sensed marker - "something is here" - and
 * heals to an exact memory the next time the player sees the grid. Written
 * alongside `kindId` so that an OLDER build reading a NEWER save degrades the
 * same benign way instead of drawing `undefined`.
 */
export interface SavedKnownObject {
  at?: [number, number];
  sensed?: boolean;
  kindId?: string;
  money?: boolean;
  ch?: string | null;
  attr?: string;
}

/** Where each live floor object sits: object -> [grid index, pile position]. */
function floorLocators(
  floor: ReadonlyMap<number, GameObject[]>,
): Map<GameObject, [number, number]> {
  const at = new Map<GameObject, [number, number]>();
  for (const [idx, pile] of floor) {
    for (let i = 0; i < pile.length; i++) at.set(pile[i]!, [idx, i]);
  }
  return at;
}

/** KnownObject -> its saved form. */
function serializeKnownObject(
  entry: KnownObject,
  at: ReadonlyMap<GameObject, [number, number]>,
  ids: ContentIdResolver,
): SavedKnownObject {
  const legacy = { ch: null, attr: "" };
  const sensed = entry.sensed ? { sensed: true } : {};
  const where = at.get(entry.obj);
  if (where) return { ...legacy, ...sensed, at: where };
  /* Detached: the original has left every floor pile (picked up, destroyed).
   * Keep the kind so the glyph survives one more load. A kind unbound in this
   * pack (a mod that supplied it is gone) still means SOMETHING was here,
   * which is exactly what the sensed marker says. */
  const kindId = ids.kindIdOrNull(entry.obj.kind.kidx);
  return kindId === null
    ? { ...legacy, sensed: true }
    : { ...legacy, ...sensed, kindId, ...(tvalIsMoney(entry.obj.tval) ? { money: true } : {}) };
}

/**
 * The saved form -> a KnownObject, or null when the memory cannot be rebuilt.
 *
 * A locator resolves against the floor that was rebuilt from the same save, so
 * the entry points at the very object the pile holds. A detached memory is
 * rebuilt as a fresh object from its kind. A memory with neither - the
 * pre-0.18 glyph shape, or a kind this pack no longer binds - is DROPPED: with
 * nothing to draw and nothing to compare identity against it would be a
 * memory of nothing, and the grid heals to an exact memory the moment the
 * player next sees it.
 *
 * `money` is written but not read: it is derived from the rebuilt object's
 * tval, and is kept in the file so an older build still reads the split.
 */
function deserializeKnownObject(
  m: SavedKnownObject,
  floor: ReadonlyMap<number, GameObject[]>,
  reg: ObjRegistry,
  ids: ContentIdResolver,
): KnownObject | null {
  if (m.at) {
    const obj = floor.get(m.at[0])?.[m.at[1]];
    if (obj) return { obj, sensed: m.sensed === true };
    return null;
  }
  const kidx = m.kindId !== undefined ? ids.kindIndex(m.kindId) : undefined;
  const kind = kidx !== undefined ? reg.kinds[kidx] : undefined;
  if (!kind) return null;
  const obj = objectNew(kind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.grid = null;
  return { obj, sensed: m.sensed === true };
}

/** One serialized race-lore record. */
export interface SavedLore {
  sights: number;
  deaths: number;
  pkills: number;
  thefts: number;
  tkills: number;
  wake: number;
  ignore: number;
  dropGold: number;
  dropItem: number;
  castInnate: number;
  castSpell: number;
  blowTimesSeen: number[];
  blowKnown: boolean[];
  /**
   * RF_ NAMES of the race flags the player has learned, not the bit vector.
   *
   * Version 5 and below wrote `flags: number[]`, the raw bytes of the lore
   * FlagSet - i.e. RF BIT POSITIONS, the same defect the field below removed
   * for RSF one version earlier and the reason `MON_RACE_FLAG_ENTRIES` could
   * not be reordered. lore.txt has always written this line by name
   * (`writeLoreEntries`, mon/lore-file.ts); this is the savefile half catching
   * up, exactly as #269 was for the spells.
   */
  flagsKnown: string[];
  /**
   * RSF_ NAMES of the spells the player has observed, not the bit vector.
   *
   * Version 4 and below wrote `spellFlags: number[]`, the raw bytes of the
   * lore FlagSet - i.e. the save recorded RSF BIT POSITIONS. That made
   * `MON_SPELL_ENTRIES` the one generated table that could never be opened by
   * appending (MOD_REACH row 22): a new RSF slot shifts nothing by itself, but
   * a mod removed or reordered renumbers what an existing save already holds,
   * and the player's monster memory silently becomes memory of other spells.
   * `PROJ` and `MSG` could be opened precisely because nothing persisted
   * indexes them by position.
   *
   * Names have no position. A build whose RSF table is larger, smaller or in a
   * different order reads exactly the spells that were written, and a name it
   * no longer has is dropped rather than mis-resolved - the same rule
   * `deserializeLore` already applies to a race whose mod is gone. lore.txt has
   * always written this line by name (`writeLoreEntries`, mon/lore-file.ts);
   * this is the savefile half catching up.
   */
  spellsKnown: string[];
  allKnown: boolean;
  armourKnown: boolean;
  dropKnown: boolean;
  sleepKnown: boolean;
  spellFreqKnown: boolean;
  innateFreqKnown: boolean;
}

/**
 * The observed spell set as RSF_ names, ascending by flag number so the save is
 * byte-stable for an unchanged record.
 *
 * The bound is rsfMax() (live, including a mod's spells), not the module-load
 * RSF.MAX. spellNameAt returns null for an unknown index the same way the old
 * RSF_FLAG_NAMES array returned undefined - including the MAX sentinel when no
 * mod occupies that slot - so a non-spell never reaches the save.
 */
export function serializeLoreSpells(spellFlags: FlagSet): string[] {
  const out: string[] = [];
  for (const flag of spellFlags) {
    if (flag >= rsfMax()) break;
    const name = spellNameAt(flag);
    if (name !== null) out.push(name);
  }
  return out;
}

/**
 * The inverse: a lore-sized FlagSet with exactly the named spells on. A name
 * this build does not have (a mod's spell, uninstalled - or the `"MAX"`
 * sentinel) is dropped, which is how the whole scheme stays safe: an unknown
 * NAME cannot land on some other spell's bit the way an out-of-range index
 * would. spellIndexOf returns -1 for unknown, matching the existing flag > 0
 * guard's intent.
 */
export function deserializeLoreSpells(
  names: readonly string[] | undefined,
): FlagSet {
  const set = new FlagSet(rsfSize());
  for (const name of names ?? []) {
    const flag = spellIndexOf(name);
    if (flag > 0 && flag < rsfMax()) set.on(flag);
  }
  return set;
}

/** Build the feature legend for every fidx appearing in the terrain grids. */
function buildFeatLegend(
  feats: readonly number[],
  known: readonly number[],
  ids: ContentIdResolver,
): Array<[number, string]> {
  const present = new Set<number>();
  for (const f of feats) present.add(f);
  for (const f of known) present.add(f);
  const legend: Array<[number, string]> = [];
  for (const f of present) {
    /* Skip sentinels (an unset cell is -1): they carry no feature id and are
     * pack-independent, so remapFeats leaves them untouched. */
    const id = ids.featIdOrNull(f);
    if (id !== null) legend.push([f, id]);
  }
  return legend;
}

/** aup_info boolean[] (by aidx) -> the ids of the created artifacts. */
function serializeArtifactsCreated(
  created: readonly boolean[],
  ids: ContentIdResolver,
): string[] {
  const out: string[] = [];
  for (let i = 1; i < created.length; i++) {
    if (created[i]) out.push(ids.artifactId(i));
  }
  return out;
}

/** Serialize one aup_info boolean field as stable artifact names. */
function serializeArtifactFlags(
  flags: readonly boolean[],
  ids: ContentIdResolver,
): string[] {
  const out: string[] = [];
  for (let i = 1; i < flags.length; i++) {
    if (flags[i]) out.push(ids.artifactId(i));
  }
  return out;
}

/** Serialize a live game (state + flavor knowledge) into plain JSON data. */
export function serializeGame(
  state: GameState,
  flavor: { snapshot(): { aware: number[]; tried: number[] } },
  seedFlavor: number,
  ids: ContentIdResolver,
  randartSeed = 0,
  everseen?: { snapshot(): { kinds: number[]; egos: number[] } },
): SavedGame {
  const floor: NonNullable<SavedGame["floor"]> = [];
  for (const pile of state.floor.values()) {
    const head = pile[0];
    if (!head || !head.grid) continue;
    floor.push({
      x: head.grid.x,
      y: head.grid.y,
      objs: pile.map((o) => serializeObject(o, ids)),
    });
  }
  /* Remembered objects are saved as locators into these piles, not as copies. */
  const liveFloorAt = floorLocators(state.floor);
  const traps: NonNullable<SavedGame["traps"]> = [];
  for (const list of state.traps.values()) {
    const head = list[0];
    if (!head) continue;
    traps.push({
      x: head.grid.x,
      y: head.grid.y,
      traps: list.map((t) => ({
        trapId: ids.trapId(t.tidx),
        grid: { x: t.grid.x, y: t.grid.y },
        power: t.power,
        timeout: t.timeout,
        trapFlagNames: serializeTrapFlags(t.flags),
      })),
    });
  }
  /* The noise/scent seam (mod/hooks.ts saveNoiseScent). Faithful 4.2.6 omits the
   * heatmaps from the save - that is upstream's behaviour and upstream's bug - so
   * with no hook installed the `?? false` below IS the faithful answer. */
  const chunk = state.chunk.snapshotSquares(
    state.modHooks?.saveNoiseScent?.() ?? false,
  );
  const knownFeat = Array.from(state.known.feat);
  const savedLevelCache = serializeLevelCache(state.levelCache, ids);
  const autoinscriptions = state.autoinscribe
    ? serializeAutoinscriptions(state.autoinscribe, ids)
    : undefined;
  /* wr_ignore's rune-autoinscription block (save.c:586-605): the count of runes
   * carrying a note, then `wr_s16b(k)` + the note string for each. The index is
   * converted to its pack-stable runeKey (see obj/knowledge.ts runeKey); a rune
   * the running pack no longer builds is dropped. */
  const runeNoteEntries: Array<[string, string]> = [];
  const liveRuneNotes = state.runeNotes?.entries() ?? [];
  if (liveRuneNotes.length > 0) {
    const runes: readonly Rune[] = buildRuneList(state.runeEnv);
    for (const [i, note] of liveRuneNotes) {
      const rune = runes[i];
      if (!rune) continue;
      runeNoteEntries.push([runeKey(rune), note]);
    }
  }
  const runeNotes = runeNoteEntries.length > 0 ? runeNoteEntries : undefined;
  return {
    version: SAVE_VERSION,
    /* Written unconditionally, including for a dead save that carries no
     * chunk: a legend costs 214 bytes and a document that describes its own
     * square encoding in only some cases is a document with two rules. */
    squareInfoLegend: [...SQUARE_INFO_LEGEND],
    player: serializePlayer(state.actor.player, ids),
    actor: {
      grid: { x: state.actor.grid.x, y: state.actor.grid.y },
      energy: state.actor.energy,
      totalEnergy: state.actor.totalEnergy,
    },
    gear: {
      next: state.gear.next,
      pack: [...state.gear.pack],
      store: Array.from(state.gear.store.entries()).map(([h, obj]) => [
        h,
        serializeObject(obj, ids),
      ]),
    },
    /* C save.c:873-1045 omits the live dungeon objects, monsters, traps and
     * chunk-list data for a dead player. */
    ...(state.isDead
      ? { dungeonDepth: state.chunk.depth }
      : {
          chunk,
          featLegend: buildFeatLegend(chunk.feats, knownFeat, ids),
          monsters: state.monsters.map((m) =>
            m ? serializeMonster(m, ids) : null,
          ),
          groups: state.groups.map((g) =>
            g ? { index: g.index, leader: g.leader, members: [...g.members] } : null,
          ),
          floor,
          traps,
        }),
    rng: state.rng.getState(),
    turn: state.turn,
    playing: state.playing,
    isDead: state.isDead,
    flavor: ((): { aware: string[]; tried: string[] } => {
      const raw = flavor.snapshot();
      return {
        aware: kidxSetToIds(raw.aware, ids),
        tried: kidxSetToIds(raw.tried, ids),
      };
    })(),
    ...(everseen
      ? {
          everseen: ((): { kinds: string[]; egos: string[] } => {
            const raw = everseen.snapshot();
            const egos: string[] = [];
            for (const eidx of raw.egos) {
              const id = ids.egoIdOrNull(eidx);
              if (id !== null) egos.push(id);
            }
            return { kinds: kidxSetToIds(raw.kinds, ids), egos };
          })(),
        }
      : {}),
    seedFlavor,
    ...(state.options ? { options: state.options.snapshot() } : {}),
    ...(randartSeed ? { randartSeed } : {}),
    ...(state.artifacts
      ? {
          artifactsCreated: serializeArtifactsCreated(
            state.artifacts.snapshot(),
            ids,
          ),
          artifactsSeen: serializeArtifactFlags(
            state.artifacts.snapshotState().seen,
            ids,
          ),
          artifactsEverseen: serializeArtifactFlags(
            state.artifacts.snapshotState().everseen,
            ids,
          ),
        }
      : {}),
    ...(!state.isDead && savedLevelCache ? { levelCache: savedLevelCache } : {}),
    /* chunk->join of the level in play (gap 9.4/9.6): persisted so a first-visit
     * persistent level aligns its stairs after a reload. Omitted when empty. */
    ...(!state.isDead && state.currentJoins && state.currentJoins.length > 0
      ? {
          currentJoins: state.currentJoins.map((j) => ({
            x: j.grid.x,
            y: j.grid.y,
            feat: j.feat,
            /* save.c:850-866 writes x, y, feature and every SQUARE_SIZE byte. */
            info: Array.from({ length: SQUARE_SIZE }, (_, i) => j.info?.[i] ?? 0),
          })),
        }
      : {}),
    ...(autoinscriptions ? { autoinscriptions } : {}),
    ...(runeNotes ? { runeNotes } : {}),
    /*
     * Terrain-only Town cache (wr_chunks, save.c:1001-1044): C always writes
     * the Town chunk even when birth_levels_persist is off, so a dungeon save
     * after leaving town reloads the same shops/stairs without redrawing.
     */
    ...(() => {
      if (state.isDead || !state.townChunk) return {};
      const tc = state.townChunk.snapshotSquares();
      return {
        townChunk: tc,
        townFeatLegend: buildFeatLegend(tc.feats, [], ids),
      };
    })(),
    /* Town stores + accrued daycount (wr_stores / save.c:963). Persisted so the
     * home stash and shop stock survive save/load (gaps 12.1/12.2/12.3). */
    ...(() => {
      const stores = serializeStores(state.stores, ids);
      return stores ? { stores } : {};
    })(),
    ...(state.daycount ? { daycount: state.daycount } : {}),
    /* Minor persisted player fields (gap 12.6, wr_player). Omitted when at their
     * defaults so a clean save stays clean and old saves load with 0. */
    ...(state.restingTurn ? { restingTurn: state.restingTurn } : {}),
    ...(state.skipCmdCoercion ? { skipCmdCoercion: state.skipCmdCoercion } : {}),
    ...(state.unignoring ? { unignoring: state.unignoring } : {}),
    ...(state.nameSuffix ? { nameSuffix: state.nameSuffix } : {}),
    /* Running message log (gap 12.8, wr_messages): the 80 newest messages,
     * oldest-first. Omitted for an empty log. */
    ...(() => {
      const messages = serializeMessages(state.messages);
      return messages ? { messages } : {};
    })(),
    ...(!state.isDead
      ? {
          known: {
            feat: knownFeat,
            objects: Array.from(state.known.objects.entries()).map(([i, pile]) => [
              i,
              pile.map((e) => serializeKnownObject(e, liveFloorAt, ids)),
            ]),
          },
        }
      : {}),
    ...(state.arenaLevel
      ? {
          arena: {
            oldGrid: {
              x: state.oldGrid?.x ?? state.actor.grid.x,
              y: state.oldGrid?.y ?? state.actor.grid.y,
            },
            /* The pre-arena level, through the same serializer the frozen-level
             * cache uses. Its depth key is the arena's own depth: the arena
             * chunk carries the depth it was entered from. */
            ...(state.arenaStash
              ? {
                  stash: serializeStoredLevel(
                    state.chunk.depth,
                    state.arenaStash,
                    ids,
                  ),
                  monMidx: state.arenaStash.monMidx,
                }
              : {}),
          },
        }
      : {}),
    ignore: serializeIgnore(state.ignore.snapshot(), ids),
    lore: Array.from(state.lore.entries()).map(([ridx, l]) => [
      ids.raceId(ridx),
      {
        sights: l.sights,
        deaths: l.deaths,
        pkills: l.pkills,
        thefts: l.thefts,
        tkills: l.tkills,
        wake: l.wake,
        ignore: l.ignore,
        dropGold: l.dropGold,
        dropItem: l.dropItem,
        castInnate: l.castInnate,
        castSpell: l.castSpell,
        blowTimesSeen: [...l.blowTimesSeen],
        blowKnown: [...l.blowKnown],
        flagsKnown: serializeLoreFlags(l.flags),
        spellsKnown: serializeLoreSpells(l.spellFlags),
        allKnown: l.allKnown,
        armourKnown: l.armourKnown,
        dropKnown: l.dropKnown,
        sleepKnown: l.sleepKnown,
        spellFreqKnown: l.spellFreqKnown,
        innateFreqKnown: l.innateFreqKnown,
      },
    ]),
  };
}

/** Rebuild the monster memory (absent in older saves: none). */
export function deserializeLore(
  data: SavedGame["lore"],
  ids: ContentIdResolver,
): Map<number, MonsterLore> {
  const store = new Map<number, MonsterLore>();
  if (!data) return store;
  for (const [raceId, l] of data) {
    const ridx = ids.raceIndex(raceId);
    if (ridx === undefined) continue; // race gone (mod removed): drop its lore
    store.set(ridx, {
      sights: l.sights,
      deaths: l.deaths,
      pkills: l.pkills,
      thefts: l.thefts,
      tkills: l.tkills,
      wake: l.wake,
      ignore: l.ignore,
      dropGold: l.dropGold,
      dropItem: l.dropItem,
      castInnate: l.castInnate,
      castSpell: l.castSpell,
      blowTimesSeen: [...l.blowTimesSeen],
      blowKnown: [...l.blowKnown],
      flags: deserializeLoreFlags(l.flagsKnown),
      spellFlags: deserializeLoreSpells(l.spellsKnown),
      allKnown: l.allKnown,
      armourKnown: l.armourKnown,
      dropKnown: l.dropKnown,
      sleepKnown: l.sleepKnown,
      spellFreqKnown: l.spellFreqKnown,
      innateFreqKnown: l.innateFreqKnown,
    });
  }
  return store;
}

/**
 * Serialize the per-kind autoinscription registry (obj/knowledge.ts): every
 * kind with a registered note, keyed by its namespaced kind id (mod-stable,
 * like serializeObject). Returns undefined when nothing is registered, so a
 * clean game omits the block entirely. A kind whose id no longer resolves
 * (unbound in this pack) is dropped.
 */
export function serializeAutoinscriptions(
  registry: AutoinscriptionRegistry,
  ids: ContentIdResolver,
): SavedAutoinscription[] | undefined {
  const out: SavedAutoinscription[] = [];
  for (const [kidx, note] of registry.entries()) {
    const kindId = ids.kindIdOrNull(kidx);
    if (kindId === null) continue; // kind unbound in this pack: drop
    const entry: SavedAutoinscription = { kindId };
    if (note.aware !== undefined) entry.aware = note.aware;
    if (note.unaware !== undefined) entry.unaware = note.unaware;
    out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Restore serialized autoinscriptions into a registry (absent in older saves:
 * nothing to restore). A kind whose id is gone (its defining pack was removed)
 * is dropped, exactly like deserializeLore drops a removed race's memory.
 */
export function deserializeAutoinscriptions(
  data: SavedAutoinscription[],
  registry: AutoinscriptionRegistry,
  ids: ContentIdResolver,
): void {
  for (const entry of data) {
    const kidx = ids.kindIndex(entry.kindId);
    if (kidx === undefined) continue; // kind gone (mod removed): drop its notes
    if (entry.aware !== undefined) registry.set(kidx, entry.aware, true);
    if (entry.unaware !== undefined) registry.set(kidx, entry.unaware, false);
  }
}

/**
 * The player's ignore settings as they appear in the savefile: the wr_ignore /
 * wr_object_memory choices with every content reference converted to its
 * namespaced id.
 *
 * Upstream stores all three of these positionally - ignore_level[] by itype,
 * ego_ignore_types[] by eidx (save.c:530-541 / load.c:872-892), and the per-kind
 * ignore bits by kidx (save.c:399-407 / load.c:602-620) - so a data change that
 * re-orders e_info or k_info silently re-targets the player's choices onto
 * different items. `ignore_level` is genuinely keyed by the ITYPE_* enum, which
 * is compiled-in in both trees, so it stays an array; the ego and kind keys
 * become ids, matching every other content reference in the document
 * (MOD_LIFECYCLE decision 1).
 */
export interface SavedIgnoreSettings {
  /** ignore_level[itype] (save.c:522-523), keyed by the compiled ITYPE_* enum. */
  level: number[];
  /** ego_ignore_types: one [namespaced ego id, itype] pair per set bit. */
  ego: Array<[string, number]>;
  /** kind_is_ignored_aware, by namespaced kind id. */
  kindAware: string[];
  /** kind_is_ignored_unaware, by namespaced kind id. */
  kindUnaware: string[];
  /** player->unignoring (save.c L491). Optional: absent in older saves. */
  unignoring?: boolean;
}

/**
 * Convert an IgnoreSettings.snapshot() (raw kidx/eidx, the runtime keying
 * upstream also uses) into the id-keyed savefile form. A kind or ego the
 * running pack no longer binds is dropped, like deserializeAutoinscriptions.
 */
export function serializeIgnore(
  data: IgnoreSettingsData,
  ids: ContentIdResolver,
): SavedIgnoreSettings {
  const ego: Array<[string, number]> = [];
  for (const key of data.ego) {
    const sep = key.indexOf(":");
    const eidx = Number(key.slice(0, sep));
    const itype = Number(key.slice(sep + 1));
    const egoId = ids.egoIdOrNull(eidx);
    if (egoId === null) continue;
    ego.push([egoId, itype]);
  }
  const kindIds = (kidxs: readonly number[]): string[] => {
    const out: string[] = [];
    for (const kidx of kidxs) {
      const id = ids.kindIdOrNull(kidx);
      if (id !== null) out.push(id);
    }
    return out;
  };
  return {
    level: [...data.level],
    ego,
    kindAware: kindIds(data.kindAware),
    kindUnaware: kindIds(data.kindUnaware),
    unignoring: data.unignoring ?? false,
  };
}

/** The inverse of serializeIgnore; an id the pack no longer binds is dropped. */
export function deserializeIgnore(
  data: SavedIgnoreSettings,
  ids: ContentIdResolver,
): IgnoreSettingsData {
  const ego: string[] = [];
  for (const [egoId, itype] of data.ego) {
    const eidx = ids.egoIndex(egoId);
    if (eidx === undefined) continue;
    ego.push(`${eidx}:${itype}`);
  }
  const kidxs = (idList: readonly string[]): number[] => {
    const out: number[] = [];
    for (const id of idList) {
      const kidx = ids.kindIndex(id);
      if (kidx !== undefined) out.push(kidx);
    }
    return out;
  };
  return {
    level: [...data.level],
    ego,
    kindAware: kidxs(data.kindAware),
    kindUnaware: kidxs(data.kindUnaware),
    unignoring: data.unignoring ?? false,
  };
}

/**
 * kind->aware / kind->tried (wr_object_memory) and kind/ego ->everseen, by id.
 * Same reasoning as serializeIgnore: upstream writes them positionally, the
 * port's document keys them by namespaced id.
 */
function kidxSetToIds(kidxs: readonly number[], ids: ContentIdResolver): string[] {
  const out: string[] = [];
  for (const kidx of kidxs) {
    const id = ids.kindIdOrNull(kidx);
    if (id !== null) out.push(id);
  }
  return out;
}

function idsToKidxSet(idList: readonly string[], ids: ContentIdResolver): number[] {
  const out: number[] = [];
  for (const id of idList) {
    const kidx = ids.kindIndex(id);
    if (kidx !== undefined) out.push(kidx);
  }
  return out;
}

/** Restore the id-keyed flavor block into the raw-kidx form FlavorKnowledge takes. */
export function deserializeFlavor(
  data: { aware: string[]; tried: string[] },
  ids: ContentIdResolver,
): { aware: number[]; tried: number[] } {
  return {
    aware: idsToKidxSet(data.aware, ids),
    tried: idsToKidxSet(data.tried, ids),
  };
}

/** Restore the id-keyed everseen block into the raw-index form it takes. */
export function deserializeEverseen(
  data: { kinds: string[]; egos: string[] },
  ids: ContentIdResolver,
): { kinds: number[]; egos: number[] } {
  const egos: number[] = [];
  for (const id of data.egos) {
    const eidx = ids.egoIndex(id);
    if (eidx !== undefined) egos.push(eidx);
  }
  return { kinds: idsToKidxSet(data.kinds, ids), egos };
}

/**
 * Build the feature index remap from a save's legend: each saved fidx maps to
 * the current pack's index for the same feature id. When the save and the
 * running pack agree (the common case), every entry is the identity; the map
 * is still applied so a re-ordered or extended terrain set loads correctly.
 * Throws on a legend id the current pack cannot resolve (a removed terrain -
 * graceful degradation is a Phase 2 quarantine concern).
 */
export function buildFeatRemap(
  legend: Array<[number, string]> | undefined,
  ids: ContentIdResolver,
): Map<number, number> {
  const remap = new Map<number, number>();
  if (!legend) return remap;
  for (const [oldFidx, id] of legend) {
    const newFidx = ids.featIndex(id);
    if (newFidx === undefined) {
      throw new Error(`save: unknown terrain feature ${id}`);
    }
    remap.set(oldFidx, newFidx);
  }
  return remap;
}

/** Apply a feature remap to a terrain index array in place (identity-safe). */
function remapFeats(
  feats: readonly number[],
  remap: Map<number, number>,
): number[] {
  if (remap.size === 0) return [...feats];
  return feats.map((feat) => remap.get(feat) ?? feat);
}

/** Rebuild the map knowledge (absent in older saves: all unknown). */
export function deserializeKnown(
  data: SavedKnown | undefined,
  width: number,
  height: number,
  featRemap: Map<number, number>,
  ids: ContentIdResolver,
  /* The floor rebuilt from the SAME save: remembered objects are locators into
   * it, so this must be the live map the game will run on, not a copy. */
  floor: ReadonlyMap<number, GameObject[]>,
  reg: ObjRegistry,
): KnownMap {
  const known = newKnownMap(width, height);
  if (!data) return known;
  const feat = remapFeats(
    data.feat.slice(0, known.feat.length),
    featRemap,
  );
  known.feat.set(feat);
  for (const [i, pile] of data.objects) {
    const entries = pile
      .map((m) => deserializeKnownObject(m, floor, reg, ids))
      .filter((e): e is KnownObject => e !== null);
    /* An empty remembered pile is not a memory - known.ts never stores one. */
    if (entries.length > 0) known.objects.set(i, entries);
  }
  return known;
}

/** Rebuild a Gear store from its saved form. */
export function deserializeGear(
  data: SavedGame["gear"],
  reg: ObjRegistry,
  ids: ContentIdResolver,
): Gear {
  const store = new Map<number, GameObject>();
  for (const [h, saved] of data.store) {
    store.set(h, deserializeObject(saved, reg, ids));
  }
  /* Bind the curse table so the gear can weigh itself (see Gear.curses). */
  return { store, next: data.next, pack: [...data.pack], curses: reg.curses };
}

/** Rebuild the floor pile map (grid-keyed, pile order preserved). */
export function deserializeFloor(
  data: SavedGame["floor"],
  reg: ObjRegistry,
  width: number,
  ids: ContentIdResolver,
): Map<number, GameObject[]> {
  const floor = new Map<number, GameObject[]>();
  for (const entry of data ?? []) {
    floor.set(
      entry.y * width + entry.x,
      entry.objs.map((o) => deserializeObject(o, reg, ids)),
    );
  }
  return floor;
}

/**
 * Rebuild the trap map from saved instances against the bound kinds. This is
 * rd_trap (load.c:359) plus its caller rd_traps_aux (L1473): the per-trap read
 * is not a separate function here because the port stores traps per grid rather
 * than as a linked list off the square.
 */
export function deserializeTraps(
  data: SavedGame["traps"],
  kinds: readonly TrapKind[],
  width: number,
  ids: ContentIdResolver,
  onDecoy?: (grid: Loc) => void,
): Map<number, Trap[]> {
  const traps = new Map<number, Trap[]>();
  for (const entry of data ?? []) {
    traps.set(
      entry.y * width + entry.x,
      entry.traps.map((t) => {
        const tidx = ids.trapIndex(t.trapId);
        const kind = tidx !== undefined ? kinds[tidx] : undefined;
        if (kind === undefined || tidx === undefined) {
          throw new Error(`save: unknown trap kind ${t.trapId}`);
        }
        const grid = loc(t.grid.x, t.grid.y);
        if (kind.name === "decoy" || kind.desc === "decoy") onDecoy?.(grid);
        return {
          tidx,
          kind,
          grid,
          power: t.power,
          timeout: t.timeout,
          flags: deserializeTrapFlags(t.trapFlagNames),
        };
      }),
    );
  }
  return traps;
}

/* ------------------------------------------------------------------ *
 * Town stores (store.c wr_stores / rd_stores, save.c:744-765).
 * ------------------------------------------------------------------ */

/** One serialized store: its proprietor index and its full stock, in order. */
export interface SavedStore {
  /** store->owner->oidx (save.c:754): the current proprietor's index. */
  ownerIndex: number;
  /** store->stock (save.c:761), head-first; the home stash for FEAT_HOME. */
  stock: SavedObject[];
}

/**
 * Serialize the live town stores (wr_stores): each shop's proprietor and stock,
 * in registry order. Returns undefined when the game has no stores yet (never
 * reached town), so a fresh dungeon-start save omits the block entirely.
 */
export function serializeStores(
  stores: readonly Store[] | undefined,
  ids: ContentIdResolver,
): SavedStore[] | undefined {
  if (!stores || stores.length === 0) return undefined;
  return stores.map((store) => ({
    ownerIndex: store.owner.index,
    stock: store.stock.map((o) => serializeObject(o, ids)),
  }));
}

/**
 * Rebuild the live town stores (rd_stores): re-bind each store's immutable
 * tables from the pack (owners, stocking tables, buy list, bounds) and overlay
 * the saved proprietor + stock. Matches upstream's positional keying (store i
 * <-> saved i). Draws NO RNG - the caller has already restored the exact
 * stream, so store restore must not perturb it (decision 22). A saved store
 * beyond the current registry length is dropped; a registry store with no saved
 * counterpart keeps an empty, default-owner shell (re-stocked on town entry).
 */
export function deserializeStores(
  bound: readonly BoundStore[],
  saved: SavedStore[] | undefined,
  reg: ObjRegistry,
  ids: ContentIdResolver,
  storeInvenMax: number,
): Store[] {
  return bound.map((b, i): Store => {
    const s = saved?.[i];
    const owner =
      (s ? b.owners.find((o) => o.index === s.ownerIndex) : undefined) ??
      b.owners[0];
    if (!owner) throw new Error(`save: store ${b.featName} has no owners`);
    return {
      feat: b.feat,
      featName: b.featName,
      owners: b.owners,
      owner,
      alwaysTable: b.alwaysTable,
      normalTable: b.normalTable,
      buy: b.buy,
      turnover: b.turnover,
      normalStockMin: b.normalStockMin,
      normalStockMax: b.normalStockMax,
      stock: s ? s.stock.map((o) => deserializeObject(o, reg, ids)) : [],
      stockSize: storeInvenMax,
    };
  });
}

/** aup_info id list -> the boolean[] by aidx that ArtifactState.restore wants. */
export function deserializeArtifactsCreated(
  saved: string[] | undefined,
  length: number,
  ids: ContentIdResolver,
): boolean[] {
  const out = new Array<boolean>(length).fill(false);
  if (!saved) return out;
  for (const id of saved) {
    const i = ids.artifactIndex(id);
    if (i !== undefined && i < length) out[i] = true;
  }
  return out;
}

/** Restore one aup_info boolean field from stable artifact ids. */
export function deserializeArtifactFlags(
  saved: string[] | undefined,
  length: number,
  ids: ContentIdResolver,
): boolean[] {
  const out = new Array<boolean>(length).fill(false);
  for (const id of saved ?? []) {
    const i = ids.artifactIndex(id);
    if (i !== undefined && i < length) out[i] = true;
  }
  return out;
}

/**
 * Rebuild a chunk of the saved dimensions and restore its squares, remapping
 * the terrain grid through the save's feature legend so feature references
 * survive a pack change.
 */
export function deserializeChunk(
  data: ChunkSquaresData,
  features: Chunk["features"],
  featRemap: Map<number, number>,
): Chunk {
  const chunk = new Chunk(features, data.height, data.width);
  /* load.c:1307-1355 decodes into a fresh cave. Keep the JSON source intact
   * while applying the equivalent feature remap to fresh data. */
  const remapped =
    featRemap.size > 0
      ? { ...data, feats: remapFeats(data.feats, featRemap) }
      : data;
  chunk.restoreSquares(remapped);
  return chunk;
}

/* ------------------------------------------------------------------ *
 * birth_levels_persist frozen-level cache (game/context.ts StoredLevel).
 * ------------------------------------------------------------------ */

/** One serialized frozen level: the same field-set as the current level. */
export interface SavedStoredLevel {
  depth: number;
  /** Game turn the level was frozen at (restore_monsters recovery baseline). */
  turn: number;
  chunk: ChunkSquaresData;
  featLegend?: Array<[number, string]>;
  monsters: Array<SavedMonster | null>;
  groups: Array<MonsterGroup | null>;
  floor: Array<{ x: number; y: number; objs: SavedObject[] }>;
  traps: Array<{ x: number; y: number; traps: SavedTrap[] }>;
  known: SavedKnown;
  decoy?: { x: number; y: number } | null;
  /** chunk->join stair connectors (generate.c L1203-1214); absent in old saves. */
  join?: Array<{ x: number; y: number; feat: number; info?: number[] }>;
}

/** Serialize one frozen level, reusing the current-level serializers. */
export function serializeStoredLevel(
  depth: number,
  level: StoredLevel,
  ids: ContentIdResolver,
): SavedStoredLevel {
  const floor: SavedStoredLevel["floor"] = [];
  for (const pile of level.floor.values()) {
    const head = pile[0];
    if (!head || !head.grid) continue;
    floor.push({
      x: head.grid.x,
      y: head.grid.y,
      objs: pile.map((o) => serializeObject(o, ids)),
    });
  }
  /* Remembered objects are saved as locators into these piles, not as copies. */
  const cachedFloorAt = floorLocators(level.floor);
  const traps: SavedStoredLevel["traps"] = [];
  for (const list of level.traps.values()) {
    const head = list[0];
    if (!head) continue;
    traps.push({
      x: head.grid.x,
      y: head.grid.y,
      traps: list.map((t) => ({
        trapId: ids.trapId(t.tidx),
        grid: { x: t.grid.x, y: t.grid.y },
        power: t.power,
        timeout: t.timeout,
        trapFlagNames: serializeTrapFlags(t.flags),
      })),
    });
  }
  const chunk = level.chunk.snapshotSquares();
  const knownFeat = Array.from(level.known.feat);
  return {
    depth,
    turn: level.turn,
    chunk,
    featLegend: buildFeatLegend(chunk.feats, knownFeat, ids),
    monsters: level.monsters.map((m) => (m ? serializeMonster(m, ids) : null)),
    groups: level.groups.map((g) =>
      g ? { index: g.index, leader: g.leader, members: [...g.members] } : null,
    ),
    floor,
    traps,
    known: {
      feat: knownFeat,
      objects: Array.from(level.known.objects.entries()).map(([i, pile]) => [
        i,
        pile.map((e) => serializeKnownObject(e, cachedFloorAt, ids)),
      ]),
    },
    decoy: level.decoy ? { x: level.decoy.x, y: level.decoy.y } : null,
    join: level.join.map((j) => ({
      x: j.grid.x,
      y: j.grid.y,
      feat: j.feat,
      info: Array.from({ length: SQUARE_SIZE }, (_, i) => j.info?.[i] ?? 0),
    })),
  };
}

/** Serialize the whole frozen-level cache (empty / absent => omitted). */
export function serializeLevelCache(
  cache: Map<number, StoredLevel> | undefined,
  ids: ContentIdResolver,
): SavedStoredLevel[] | undefined {
  if (!cache || cache.size === 0) return undefined;
  return Array.from(cache.entries()).map(([depth, level]) =>
    serializeStoredLevel(depth, level, ids),
  );
}

/**
 * Rebuild the frozen-level cache (absent in older / default saves: empty).
 * Reuses the current-level deserializers so a cached level round-trips exactly
 * like the live one, including per-level feature-legend remapping.
 */
export function deserializeLevelCache(
  data: SavedStoredLevel[] | undefined,
  features: Chunk["features"],
  monsters: MonsterRegistry,
  objects: ObjRegistry,
  traps: readonly TrapKind[] | null | undefined,
  ids: ContentIdResolver,
): Map<number, StoredLevel> {
  const cache = new Map<number, StoredLevel>();
  if (!data) return cache;
  for (const entry of data) {
    const featRemap = buildFeatRemap(entry.featLegend, ids);
    const chunk = deserializeChunk(entry.chunk, features, featRemap);
    chunk.turn = entry.turn;
    const cachedFloor = deserializeFloor(entry.floor, objects, chunk.width, ids);
    cache.set(entry.depth, {
      chunk,
      monsters: entry.monsters.map((m) =>
        m ? deserializeMonster(m, monsters, objects, ids) : null,
      ),
      groups: entry.groups.map((g) =>
        g
          ? { index: g.index, leader: g.leader, members: [...g.members] }
          : null,
      ),
      floor: cachedFloor,
      traps: traps
        ? deserializeTraps(entry.traps, traps, chunk.width, ids)
        : new Map(),
      known: deserializeKnown(
        entry.known,
        chunk.width,
        chunk.height,
        featRemap,
        ids,
        cachedFloor,
        objects,
      ),
      decoy: entry.decoy ? loc(entry.decoy.x, entry.decoy.y) : null,
      turn: entry.turn,
      /* chunk->join stair connectors; tolerate absence for pre-field saves. */
      /* load.c:1366-1383 restores connector info; load.c:1653-1678 remaps
       * the saved feature through the current feature table. */
      join: (entry.join ?? []).map((j) => ({
        grid: loc(j.x, j.y),
        feat: featRemap.get(j.feat) ?? j.feat,
        ...(j.info ? { info: [...j.info] } : {}),
      })),
    });
  }
  return cache;
}

/* ------------------------------------------------------------------ *
 * Stamped bytes (the file/localStorage form).
 * ------------------------------------------------------------------ */

/**
 * JSON-encode a save, optionally compress it, and stamp it with the integrity
 * trailer (16b).
 *
 * ORDER: JSON -> codec -> stamp. The digest therefore covers the bytes that are
 * actually stored, and the trailer stays findable without running a decompressor
 * first - which matters because an unknown codec must still be diagnosable.
 * Passing no codec writes the bare JSON every earlier build wrote.
 */
export function encodeSavedGame(
  save: SavedGame,
  provider: SaveIntegrity = fnv1aIntegrity,
  codec?: SaveCodec,
): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(save));
  return stampSavefile(codec ? applyCodec(json, codec) : json, provider);
}

/** The decoded form of a stamped save. */
export interface DecodedSave {
  save: SavedGame | null;
  /** The integrity digest matched. */
  verified: boolean;
  /** No trailer was present at all. */
  unstamped: boolean;
  /** The codec that wrote it, or null for an uncompressed save. */
  codecId?: string | null;
  /**
   * Set when the save names a codec this build does not have - a save from a
   * NEWER build, which is a different thing from a corrupt one and must be
   * reported differently: nothing is wrong with the file, and telling the player
   * it is damaged would invite them to delete a perfectly good character.
   */
  unknownCodec?: string;
  /** The save payload did not decompress, parse, or meet the minimum save shape. */
  malformed?: boolean;
}

/**
 * Verify and parse stamped save bytes. A failed digest still parses (the
 * warn-and-label posture of decision 16b - the deterrent is honest, not a
 * lock), with verified=false for the caller to surface.
 *
 * `codecs` are the compressors this build can run. An uncompressed save needs
 * none, so a caller that never compresses can keep ignoring this argument.
 */
export function decodeSavedGame(
  bytes: Uint8Array,
  provider: SaveIntegrity = fnv1aIntegrity,
  codecs: readonly SaveCodec[] = [],
  maxOutputLength?: number,
): DecodedSave {
  const result = verifyStampedSavefile(bytes, provider);
  const { codecId, body } = stripCodec(result.payload);
  const base = {
    verified: result.verified,
    unstamped: result.unstamped ?? false,
    codecId,
  };
  let payload = body;
  if (codecId !== null) {
    const codec = findCodec(codecId, codecs);
    if (!codec) return { ...base, save: null, unknownCodec: codecId };
    try {
      payload = codec.decompress(body, maxOutputLength);
    } catch {
      /* An installed codec that cannot read these bytes is genuine damage. */
      return { ...base, save: null, malformed: true };
    }
  }
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(payload));
  } catch {
    return { ...base, save: null, malformed: true };
  }
  if (!hasSaveHeader(raw)) return { ...base, save: null, malformed: true };
  return { ...base, save: raw };
}

/**
 * Reject a document that cannot be a save before migration or deserialization
 * reaches into it. This is deliberately the stable top-level header shared by
 * old saves too; detailed field compatibility belongs to the migration path.
 */
function hasSaveHeader(value: unknown): value is SavedGame {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const save = value as Record<string, unknown>;
  return (
    typeof save["version"] === "number" &&
    Number.isInteger(save["version"]) &&
    isRecord(save["player"]) &&
    isRecord(save["actor"]) &&
    isRecord(save["gear"]) &&
    isRecord(save["rng"]) &&
    typeof save["turn"] === "number" &&
    Number.isFinite(save["turn"]) &&
    typeof save["playing"] === "boolean" &&
    typeof save["isDead"] === "boolean" &&
    isRecord(save["flavor"])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
