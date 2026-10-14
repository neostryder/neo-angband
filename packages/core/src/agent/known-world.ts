/**
 * Everything a mod may read about the game, built from what the player knows
 * and nothing else. Menus, panels, network payloads and autoplayers can all
 * read the same builder, so a leak gets fixed in one place.
 *
 * known-world.test.ts holds it to one rule: two games that differ only in
 * something the player cannot know build the same KnownWorld. Its pairs cover
 * an unseen monster, a seen monster's exact hit points and speed, the flags
 * and spells of a race the player has not studied, an unlearned rune or curse,
 * an unaware flavour, floor memory that has gone stale, a mimic, hallucination,
 * the order monsters were created in, exact timed-effect counters, and a
 * remembered trap removed out of view.
 *
 * Most of it comes from the AgentView accessors, which already describe items,
 * the player, stores, spellbooks and the remembered level the way the player
 * sees them (#304, #328, #368). The real map never gets in, whatever the
 * caller holds, because the view this builds on is never given
 * `state:map-actual.read`. Some parts are rebuilt here because the API 1
 * shapes, frozen at API 1.0.0 and read by the Borg, carry more than the
 * player can see:
 *
 * - Monsters. AgentView.monsters() hands the Borg hit points, speed and every
 *   race flag and spell, so a KnownMonster is built from what the look command
 *   and monster recall would show: a health band, the look statuses, the
 *   race's level and speed, and the flags and spells in the player's lore. Its
 *   `id` is a handle given out in the order the player first perceives each
 *   monster on the level, not the monster's index, which counts every monster
 *   created, seen or not. While the player hallucinates no monster is listed,
 *   as the monster list refuses to show them (ui-mon-list.c:211).
 * - The player. Timed effects are the grade names the status line prints
 *   (prt_tmd, ui-display.c:1251) rather than turns remaining, food is the
 *   percentage it prints, and recall and deep descent are the bare "Recall"
 *   and "Descent" markers (ui-display.c:925-945).
 * - Items. Recharge time is what the name says ("(charging)", or "(2
 *   charging)" for a stack of rods, obj-desc.c:500-505) rather than the turns
 *   left, and `unknownRunes` is the "{??}" marker (obj-desc.c:541, :570).
 * - The target. A monster target the player cannot target now (target_able,
 *   target.c:110) reads as no target, as target_okay answers.
 *
 * Building one is read-only as far as the game goes. It touches no game
 * state, creates no lore record and draws nothing from the RNG; its handle and store observation books live outside game state and are not saved.
 */

import { createMonFlagMask } from "../mon/lore.js";
import { monsterIsDestroyed, monsterIsInvisible, monsterIsObvious } from "../mon/predicate.js";
import type { Monster } from "../mon/monster.js";
import type { MonsterRace } from "../mon/types.js";
import type { GameState } from "../game/context.js";
import { lookMonDesc, targetAble } from "../game/target.js";
import { gearGet } from "../game/gear.js";
import { numberCharging } from "../game/obj-cmd.js";
import { knownDescOf } from "../game/describe.js";
import { MON_RACE_FLAG_ENTRIES, MON_SPELL_ENTRIES, MON_TMD, OF, PLAYER_TIMED_ENTRIES, RF, TMD } from "../generated/index.js";
import { squareIsSeen, squareIsView } from "../world/view.js";
import type { Store } from "../store/store.js";
import type { FlagSet } from "../bitflag.js";
import { distance } from "../loc.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import { objectKnownShadow, objectRunesKnownUpstream } from "../obj/known-object.js";
import type { GameObject } from "../obj/object.js";
import { tvalCanHaveCharges, tvalCanHaveFlavor, tvalIsRod } from "../obj/object.js";
import { playerTimedGrade } from "../player/timed.js";
import { captureCoreSnapshot } from "./boundary.js";
import type { InputToken } from "./boundary.js";
import type { KnownLevelView } from "./known-level.js";
import { createAgentView } from "./perceive.js";
import { AGENT_STATE_DOMAINS, AgentCapabilityError } from "./types.js";
import type {
  AgentCapabilities,
  AgentViewDeps,
  ItemView,
  LoadoutSimulation,
  PlayerView,
  SpellbookView,
  StoreItemView,
  StoreView,
} from "./types.js";

/** Bumped when a field changes meaning; adding a field does not bump it. */
export const KNOWN_WORLD_VERSION = 1;

/** The health bands of the look command, from unhurt to almost dead. */
export type KnownMonsterHealth = "unhurt" | "somewhat" | "wounded" | "badly" | "almost";

/** The statuses the look command names, in its order. */
export type KnownMonsterStatus =
  | "asleep"
  | "held"
  | "disenchanted"
  | "confused"
  | "afraid"
  | "stunned"
  | "slowed"
  | "hasted";

/** One monster the player perceives, described as the player can know it. */
export interface KnownMonster {
  /**
   * A handle for this monster on this level: 1 for the first monster the
   * player perceived here, 2 for the next, and so on. It stays with the
   * monster while it lives on the level and starts again on a new level. It is
   * not the monster's index, and a command or target that names a monster
   * takes this handle.
   */
  readonly id: number;
  readonly race: string;
  readonly raceIndex: number;
  /** Namespaced race id; present when the builder has a resolver. */
  readonly raceId?: string;
  readonly grid: { readonly x: number; readonly y: number };
  /** In the player's line of sight and seen with the eyes, rather than only detected or sensed. */
  readonly visible: boolean;
  /** The look command's health band. Exact hit points are not known. */
  readonly health: KnownMonsterHealth;
  /** False for a monster the look command calls damaged rather than wounded. */
  readonly living: boolean;
  readonly status: readonly KnownMonsterStatus[];
  /** The look command's line for it, as the game prints it ("wounded, asleep"). */
  readonly look: string;
  /** The race's native depth, which monster recall always shows. */
  readonly raceLevel: number;
  /** The race's speed, which monster recall always shows (110 is normal). */
  readonly raceSpeed: number;
  /** Race flags the player's lore has learned or recall always shows, by code. */
  readonly knownFlags: readonly string[];
  /** Spells the player's lore has learned, by code. */
  readonly knownSpells: readonly string[];
  readonly unique: boolean;
  readonly questGuardian: boolean;
  readonly finalGuardian: boolean;
  readonly glyph?: string;
}

/** Why the monster list is withheld: the player is hallucinating. */
export type KnownMonstersHidden = "hallucinating";

/**
 * The player's timed effects as the status line shows them: the name of the
 * grade each active effect is in ("Graze", "Heavy Stun", "Haste"), or null
 * when the effect is clear or its grade has no name on the status line.
 */
export interface KnownPlayerStatus {
  readonly timed: Readonly<Record<string, string | null>>;
  readonly blind: string | null;
  readonly confused: string | null;
  readonly afraid: string | null;
  readonly poisoned: string | null;
  readonly cut: string | null;
  readonly stun: string | null;
  readonly paralyzed: string | null;
  /** The food meter's percentage, as the status line prints it. */
  readonly food: number;
  /** The food grade ("Hungry", "Fed", "Full"). */
  readonly foodGrade: string | null;
  readonly fast: string | null;
  readonly sprint: string | null;
  readonly protEvil: string | null;
  readonly hero: string | null;
  readonly shero: string | null;
  readonly shield: string | null;
  readonly stoneskin: string | null;
  readonly blessed: string | null;
  readonly fastcast: string | null;
  readonly resAcid: string | null;
  readonly resElec: string | null;
  readonly resFire: string | null;
  readonly resCold: string | null;
  readonly resPois: string | null;
  /** Afraid from any source the player knows about, which is what refuses a melee blow. */
  readonly fearful: boolean;
  readonly terror: string | null;
  readonly amnesia: string | null;
  readonly image: string | null;
}

/** The player as the character sheet and status line show them. */
export type KnownPlayer = Omit<PlayerView, "status" | "recall" | "descent"> & {
  readonly status: KnownPlayerStatus;
  /** An active Word of Recall: the status line says "Recall", not when it fires. */
  readonly recall: boolean;
  /** An active Deep Descent: the status line says "Descent", not when it fires. */
  readonly descent: boolean;
};

/** An item as its name and the inspect screen describe it. */
export type KnownItem = Omit<ItemView, "timeout"> & {
  /**
   * How many of the stack the name says are recharging: the count of
   * "(2 charging)" on a stack of rods, 1 for "(charging)", 0 when the name
   * says neither. The turns left are not shown, so they are not here.
   */
  readonly charging: number;
  /** The name carries "{??}": the item has runes the player has not learned. */
  readonly unknownRunes: boolean;
};

/** One ware in a shop, or one item in the home. */
export type KnownStoreItem = KnownItem & Pick<StoreItemView, "index" | "price">;

/** A shop or the home, as its screen lists it. */
export type KnownStore = Omit<StoreView, "stock"> & { readonly stock: readonly KnownStoreItem[] };

/** The current target, when the game would accept it as one. */
export interface KnownTarget {
  /** The KnownMonster id of a targeted monster, or null for a bare location. */
  readonly monster: number | null;
  readonly grid: { readonly x: number; readonly y: number };
}

/**
 * The game at one input wait, as the player knows it. Plain deep-frozen data;
 * a part the caller has no read capability for is null.
 */
export interface KnownWorld {
  readonly version: typeof KNOWN_WORLD_VERSION;
  readonly token: InputToken;
  readonly turn: number | null;
  readonly player: KnownPlayer | null;
  readonly inventory: readonly KnownItem[] | null;
  readonly equipment: readonly (KnownItem | null)[] | null;
  readonly quiver: readonly KnownItem[] | null;
  /** The objects under the player that the player remembers exactly. */
  readonly floorHere: readonly KnownItem[] | null;
  /** Nearest first, then by grid (row, then column). Empty while `monstersHidden` is set. */
  readonly monsters: readonly KnownMonster[] | null;
  /** Set when the monster list cannot be shown; null otherwise. */
  readonly monstersHidden: KnownMonstersHidden | null;
  readonly target: KnownTarget | null;
  /** False when the target part was not readable, so null above is ambiguous. */
  readonly targetReadable: boolean;
  readonly stores: readonly KnownStore[] | null;
  readonly spellbooks: readonly SpellbookView[] | null;
  /** The level as the player remembers it, never the real map. */
  readonly level: KnownLevelView | null;
}

/* lore_update's "obvious" flags: the player knows them on sight. Built on
 * first use, because game/known.ts reaches this module for its sighting hook
 * and a mask built at import time would run in the middle of that cycle. */
let obviousRaceFlags: FlagSet | undefined;
/* lore_append_movement's adjectives and nouns (mon-lore.c:973-987). */
let raceAdjectives: FlagSet | undefined;
let raceNouns: FlagSet | undefined;

function codes(flags: FlagSet, names: readonly ({ readonly name: string } | undefined)[]): string[] {
  const out: string[] = [];
  for (const f of flags) {
    const name = names[f]?.name;
    if (name) out.push(name);
  }
  return out;
}

/* Read-only: state.lore.get, never getLore, which would create a record. */
function knownRaceFlags(state: GameState, race: MonsterRace): FlagSet {
  const flags = race.flags.clone();
  const lore = state.lore.get(race.ridx);
  if (lore?.allKnown) return flags;
  obviousRaceFlags ??= createMonFlagMask("RFT_OBV");
  raceAdjectives ??= createMonFlagMask("RFT_RACE_A");
  raceNouns ??= createMonFlagMask("RFT_RACE_N");
  const learned = obviousRaceFlags.clone();
  if (lore) learned.union(lore.flags);
  /* Recall opens with "This evil undead dragon...": every adjective the race
   * has and the first noun, read from the race itself, before any kill. */
  learned.union(raceAdjectives);
  const nouns = raceNouns.clone();
  nouns.inter(race.flags);
  for (const f of nouns) {
    learned.on(f);
    break;
  }
  flags.inter(learned);
  return flags;
}

function knownRaceSpells(state: GameState, race: MonsterRace): FlagSet {
  const spells = race.spellFlags.clone();
  const lore = state.lore.get(race.ridx);
  if (lore?.allKnown) return spells;
  if (!lore) {
    spells.wipe();
    return spells;
  }
  spells.inter(lore.spellFlags);
  return spells;
}

function healthOf(mon: Monster): KnownMonsterHealth {
  /* The bands of look_mon_desc. */
  if (mon.hp >= mon.maxhp) return "unhurt";
  const perc = Math.trunc((100 * mon.hp) / mon.maxhp);
  if (perc >= 60) return "somewhat";
  if (perc >= 25) return "wounded";
  if (perc >= 10) return "badly";
  return "almost";
}

const LOOK_STATUSES: ReadonlyArray<readonly [number, KnownMonsterStatus]> = [
  [MON_TMD.SLEEP, "asleep"],
  [MON_TMD.HOLD, "held"],
  [MON_TMD.DISEN, "disenchanted"],
  [MON_TMD.CONF, "confused"],
  [MON_TMD.FEAR, "afraid"],
  [MON_TMD.STUN, "stunned"],
  [MON_TMD.SLOW, "slowed"],
  [MON_TMD.FAST, "hasted"],
];

/* ------------------------------------------------------------------ *
 * Monster handles.
 * ------------------------------------------------------------------ */

interface HandleBook {
  readonly chunk: unknown;
  readonly serial: number;
  next: number;
  readonly byMonster: WeakMap<Monster, number>;
  readonly byHandle: Map<number, Monster>;
}

/* Kept beside the game, not in it: nothing here is saved, and a reloaded game
 * starts a fresh book. Keyed by the Monster record, which keeps its identity
 * when compaction moves it to another index and is replaced when the index is
 * reused, so a handle never passes from one monster to another. */
const handleBooks = new WeakMap<GameState, HandleBook>();

function handleBook(state: GameState): HandleBook {
  const serial = state.levelSerial ?? 0;
  let book = handleBooks.get(state);
  if (!book || book.chunk !== state.chunk || book.serial !== serial) {
    book = { chunk: state.chunk, serial, next: 1, byMonster: new WeakMap(), byHandle: new Map() };
    handleBooks.set(state, book);
  }
  return book;
}

/** Whether the player hallucinates (TMD_IMAGE), which hides every monster's identity. */
export function playerHallucinates(state: GameState): boolean {
  return (state.actor.player.timed[TMD.IMAGE] ?? 0) > 0;
}

/**
 * Whether the player perceives this monster as itself: monster_is_obvious
 * (seen, detected or sensed, and not mistaken for an object or the floor),
 * and the player is not hallucinating.
 */
export function monsterIsKnown(state: GameState, mon: Monster): boolean {
  return monsterIsObvious(mon) && !playerHallucinates(state);
}

/**
 * A new identity first assigns handles to every currently perceived monster in nearest-first order, so the event sender's order cannot determine them. A deleted monster can retain its observed identity.
 */
export function knownMonsterId(state: GameState, mon: Monster): number {
  const book = handleBook(state);
  let id = book.byMonster.get(mon);
  if (id === undefined) {
    const perceived = state.monsters.filter((m): m is Monster => !!m && monsterIsKnown(state, m));
    perceived.sort((a, b) => knownMonsterOrder(state, a, b));
    for (const m of perceived) {
      if (book.byMonster.has(m)) continue;
      const handle = book.next++;
      book.byMonster.set(m, handle);
      book.byHandle.set(handle, m);
    }
    id = book.byMonster.get(mon);
  }
  if (id === undefined) {
    id = book.next++;
    book.byMonster.set(mon, id);
    book.byHandle.set(id, mon);
  }
  return id;
}

/** A suppressed event can reuse an observed identity without allocating one. */
export function assignedMonsterId(state: GameState, mon: Monster): number | undefined {
  return handleBook(state).byMonster.get(mon);
}

function seenWithEyes(state: GameState, mon: Monster): boolean {
  const p = state.actor.player;
  if (p.timed[TMD.BLIND] || !squareIsView(state.chunk, mon.grid)) return false;
  const d = distance(state.actor.grid, mon.grid);
  if (d > state.z.maxSight) return false;
  const ps = state.playerState;
  if (d <= (ps?.seeInfra ?? p.race.infravision) && !mon.race.flags.has(RF.COLD_BLOOD)) return true;
  return squareIsSeen(state.chunk, mon.grid) && (!monsterIsInvisible(mon) || (ps?.flags.has(OF.SEE_INVIS) ?? false));
}

/**
 * The monster index behind a KnownMonster id, for a command or target that
 * names a monster. Null when the id names no monster the player perceives
 * right now, whether it died, left the level, went out of sight, or never
 * existed, so the answer says nothing about a monster the player cannot see.
 */
export function knownMonsterMidx(state: GameState, id: number): number | null {
  const mon = handleBook(state).byHandle.get(id);
  if (!mon || state.monsters[mon.midx] !== mon || !monsterIsKnown(state, mon)) return null;
  return mon.midx;
}

/**
 * The order the player sees monsters in: nearest first, then by row, then by
 * column. Two monsters never share a grid, so the order is total, and nothing
 * in it depends on when a monster was created.
 */
export function knownMonsterOrder(state: GameState, a: Monster, b: Monster): number {
  const p = state.actor.grid;
  return distance(p, a.grid) - distance(p, b.grid) || a.grid.y - b.grid.y || a.grid.x - b.grid.x;
}

/**
 * One monster as the player knows it. The caller decides whether the player
 * perceives it; `knownMonsters` lists only those that are. Asking gives the
 * monster its handle if it has none yet.
 */
export function knownMonster(state: GameState, mon: Monster, deps: AgentViewDeps = {}): KnownMonster {
  const quests = state.actor.player.quests;
  const finalRace = quests.length > 0 ? quests[quests.length - 1]!.race : -1;
  const flags = codes(knownRaceFlags(state, mon.race), MON_RACE_FLAG_ENTRIES);
  const view: {
    -readonly [K in keyof KnownMonster]: KnownMonster[K];
  } = {
    id: knownMonsterId(state, mon),
    race: mon.race.name,
    raceIndex: mon.race.ridx,
    grid: { x: mon.grid.x, y: mon.grid.y },
    visible: seenWithEyes(state, mon),
    health: healthOf(mon),
    living: !monsterIsDestroyed(mon),
    status: LOOK_STATUSES.filter(([t]) => (mon.mTimed[t] ?? 0) > 0).map(([, s]) => s),
    look: lookMonDesc(mon),
    raceLevel: mon.race.level,
    raceSpeed: mon.race.speed,
    knownFlags: flags,
    knownSpells: codes(knownRaceSpells(state, mon.race), MON_SPELL_ENTRIES),
    unique: flags.includes("UNIQUE"),
    questGuardian: quests.some((q) => q.race === mon.race.ridx),
    finalGuardian: mon.race.ridx === finalRace,
  };
  if (deps.resolver) {
    const raceId = deps.resolver.raceIdOrNull(mon.race.ridx);
    if (raceId !== null) view.raceId = raceId;
  }
  if (deps.glyphs) view.glyph = deps.glyphs.monsterChar(mon.race.ridx) ?? mon.race.dChar;
  return view;
}

/**
 * Every monster the player perceives, nearest first. Empty while the player
 * hallucinates: the monster list then says the hallucinations are too wild to
 * show anything (ui-mon-list.c:211).
 */
export function knownMonsters(state: GameState, deps: AgentViewDeps = {}): KnownMonster[] {
  if (playerHallucinates(state)) return [];
  const seen: Monster[] = [];
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (mon && monsterIsObvious(mon)) seen.push(mon);
  }
  seen.sort((a, b) => knownMonsterOrder(state, a, b));
  return seen.map((mon) => knownMonster(state, mon, deps));
}

/* ------------------------------------------------------------------ *
 * The player, items and the target.
 * ------------------------------------------------------------------ */

const STATUS_EFFECTS: ReadonlyArray<readonly [Exclude<keyof KnownPlayerStatus, "food" | "foodGrade" | "fearful" | "timed">, number]> = [
  ["blind", TMD.BLIND],
  ["confused", TMD.CONFUSED],
  ["afraid", TMD.AFRAID],
  ["poisoned", TMD.POISONED],
  ["cut", TMD.CUT],
  ["stun", TMD.STUN],
  ["paralyzed", TMD.PARALYZED],
  ["fast", TMD.FAST],
  ["sprint", TMD.SPRINT],
  ["protEvil", TMD.PROTEVIL],
  ["hero", TMD.HERO],
  ["shero", TMD.SHERO],
  ["shield", TMD.SHIELD],
  ["stoneskin", TMD.STONESKIN],
  ["blessed", TMD.BLESSED],
  ["fastcast", TMD.FASTCAST],
  ["resAcid", TMD.OPP_ACID],
  ["resElec", TMD.OPP_ELEC],
  ["resFire", TMD.OPP_FIRE],
  ["resCold", TMD.OPP_COLD],
  ["resPois", TMD.OPP_POIS],
  ["terror", TMD.TERROR],
  ["amnesia", TMD.AMNESIA],
  ["image", TMD.IMAGE],
];

/* prt_tmd's walk: the grade whose maximum covers the duration, and its name. */
function gradeName(state: GameState, tmd: number): string | null {
  const v = state.actor.player.timed[tmd] ?? 0;
  if (v <= 0) return null;
  const effect = state.world?.timedTable[tmd];
  /* The worldless harness has no table; it still says the effect is on. */
  if (!effect) return "active";
  return effect.grades.length > 0 ? (playerTimedGrade(effect, v).name || null) : null;
}

function knownPlayer(state: GameState, player: PlayerView): KnownPlayer {
  const { status, recall, descent, ...rest } = player;
  const named = {} as Record<(typeof STATUS_EFFECTS)[number][0], string | null>;
  for (const [key, tmd] of STATUS_EFFECTS) named[key] = gradeName(state, tmd);
  return {
    ...rest,
    status: {
      ...named,
      timed: Object.fromEntries(PLAYER_TIMED_ENTRIES.map((effect, index) => [effect.name,
        (state.actor.player.timed[index] ?? 0) > 0 ? gradeName(state, index) ?? "active" : null])),
      food: Math.trunc((state.actor.player.timed[TMD.FOOD] ?? 0) / 100),
      foodGrade: gradeName(state, TMD.FOOD),
      fearful: status.fearful ?? false,
    },
    recall: recall > 0,
    descent: descent > 0,
  };
}

/* object_flavor_is_aware: a kind with no flavour is known on sight. */
function flavorAware(state: GameState, deps: AgentViewDeps, obj: GameObject): boolean {
  const isAware = deps.aware ?? state.isAware ?? ((): boolean => true);
  return isAware(obj.kind) || !(state.hasFlavor?.(obj.kind) ?? tvalCanHaveFlavor(obj.tval));
}

/* obj_desc_charges (obj-desc.c:491-506). */
function chargingShown(state: GameState, deps: AgentViewDeps, obj: GameObject, shopWare: boolean): number {
  const aware = flavorAware(state, deps, obj) || shopWare;
  if (aware && tvalCanHaveCharges(obj.tval)) return 0;
  if (obj.timeout <= 0) return 0;
  if (tvalIsRod(obj.tval) && obj.number > 1) return numberCharging(obj);
  if (tvalIsRod(obj.tval) || obj.activation || obj.effect) return 1;
  return 0;
}

/* The "{??}" marker: obj_desc_inscrip for carried and floor items (an assessed
 * item with a rune the player has not learned, obj-desc.c:541), obj_desc_aware
 * for a shop's ware (an aware kind whose runes are not all known, :570). */
function unknownRunes(state: GameState, deps: AgentViewDeps, obj: GameObject, shopWare: boolean): boolean {
  const p = state.actor.player;
  const shadow = objectKnownShadow(obj, p, state.runeEnv, knownDescOf(state, true));
  if (objectRunesKnownUpstream(obj, shadow, p, state.runeEnv)) return false;
  if (shopWare) return flavorAware(state, deps, obj);
  return (shadow.notice & OBJ_NOTICE.ASSESSED) !== 0;
}

function knownItem(state: GameState, deps: AgentViewDeps, item: ItemView, obj: GameObject | null, shopWare = false): KnownItem {
  const { timeout: _timeout, ...rest } = item;
  return {
    ...rest,
    charging: obj ? chargingShown(state, deps, obj, shopWare) : 0,
    unknownRunes: obj ? unknownRunes(state, deps, obj, shopWare) : false,
  };
}

function carried(state: GameState, deps: AgentViewDeps, item: ItemView): KnownItem {
  return knownItem(state, deps, item, gearGet(state.gear, item.handle));
}

export function knownLoadoutSimulation(state: GameState, simulation: LoadoutSimulation) {
  const item = (value: ItemView): KnownItem => {
    const { timeout: _timeout, ...rest } = value;
    const charging = /\((?:(\d+) )?charging\)/u.exec(value.name ?? "");
    return { ...rest, charging: charging ? Number(charging[1] ?? 1) : 0,
      unknownRunes: (value.name ?? "").includes("{??}") };
  };
  const loadout = (value: LoadoutSimulation["before"]) => ({
    ...value,
    player: knownPlayer(state, value.player),
    equipment: value.equipment.map((entry) => entry ? item(entry) : null),
    inventory: value.inventory.map(item),
  });
  return deepFreeze({
    ...simulation,
    before: loadout(simulation.before),
    after: loadout(simulation.after),
    placements: simulation.placements.map((placement) => ({ ...placement,
      worn: item(placement.worn), displaced: placement.displaced ? item(placement.displaced) : null })),
  });
}

function knownTarget(state: GameState): KnownTarget | null {
  /* target_okay (target.c:124), without moving the stored grid: a monster
   * target counts while target_able holds, a bare grid while it is set. */
  const t = state.target;
  if (!t.set) return null;
  if (t.midx > 0) {
    const mon = state.monsters[t.midx] ?? null;
    if (!mon || !targetAble(state, mon)) return null;
    return { monster: knownMonsterId(state, mon), grid: { x: mon.grid.x, y: mon.grid.y } };
  }
  if (t.grid.x && t.grid.y) return { monster: null, grid: { x: t.grid.x, y: t.grid.y } };
  return null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** A deep-frozen KnownMonster, the form a hook payload takes. */
export function frozenKnownMonster(state: GameState, mon: Monster, deps: AgentViewDeps = {}): KnownMonster {
  return deepFreeze(knownMonster(state, mon, deps));
}

const storeObservations = new WeakMap<GameState, Map<Store, KnownStore>>();

function storeBook(state: GameState): Map<Store, KnownStore> {
  let observations = storeObservations.get(state);
  if (!observations) {
    observations = new Map();
    storeObservations.set(state, observations);
  }
  return observations;
}

function rememberStore(state: GameState, deps: AgentViewDeps, live: Store, store: StoreView): void {
  storeBook(state).set(live, deepFreeze(structuredClone({
    ...store,
    stock: store.stock.map((ware) => ({
      ...knownItem(state, deps, ware, live.stock[ware.index] ?? null, !store.isHome),
      index: ware.index,
      ...(ware.price !== undefined ? { price: ware.price } : {}),
    })),
  })));
}

/** A shop screen can show stock remotely, so observation cannot require standing in the shop. */
export function observeKnownStore(state: GameState, store: Store, deps: AgentViewDeps = state.knownWorldDeps ?? {}): void {
  const index = state.stores?.indexOf(store) ?? -1;
  if (index < 0) return;
  const observed = createAgentView(state, undefined, deps).stores()[index];
  if (observed) rememberStore(state, deps, store, observed);
}

/**
 * Build the known world. With no `caps` every known part is readable; with
 * caps, each part needs its `state:<domain>.read` grant, as the AgentView
 * accessor of the same name does. The real map is withheld either way.
 */
export function buildKnownWorld(
  state: GameState,
  deps: AgentViewDeps = {},
  caps?: AgentCapabilities,
): KnownWorld {
  const knownOnly: AgentCapabilities = {
    has: (cap) => cap !== "state:map-actual.read" && (caps ? caps.has(cap) : true),
  };
  const view = createAgentView(state, undefined, deps, knownOnly);
  const snap = captureCoreSnapshot(state, view);
  const readable = (domain: string): boolean =>
    knownOnly.has(`state:${domain}.read`) || knownOnly.has("state:*.read");
  let level: KnownLevelView | null = null;
  try {
    level = view.knownLevel?.() ?? null;
  } catch (e) {
    if (!(e instanceof AgentCapabilityError)) throw e;
  }
  const monstersReadable = readable(AGENT_STATE_DOMAINS.monsters);
  const pile = state.floor.get(state.actor.grid.y * state.chunk.width + state.actor.grid.x) ?? [];
  const stores = state.stores ?? [];
  const observations = storeBook(state);
  const world: KnownWorld = {
    version: KNOWN_WORLD_VERSION,
    token: snap.token,
    turn: snap.turn,
    player: snap.player ? knownPlayer(state, snap.player) : null,
    inventory: snap.inventory?.map((item) => carried(state, deps, item)) ?? null,
    equipment: snap.equipment?.map((item) => (item ? carried(state, deps, item) : null)) ?? null,
    quiver: snap.quiver?.map((item) => carried(state, deps, item)) ?? null,
    floorHere: snap.floorHere?.map((item) => knownItem(state, deps, item, pile[item.floorIndex ?? -1] ?? null)) ?? null,
    monsters: monstersReadable ? knownMonsters(state, deps) : null,
    monstersHidden: monstersReadable && playerHallucinates(state) ? "hallucinating" : null,
    target: snap.targetReadable ? knownTarget(state) : null,
    targetReadable: snap.targetReadable,
    stores: snap.stores?.map((store, s) => {
      const live = stores[s]!;
      if (state.chunk.feat(state.actor.grid) === store.feat) {
        rememberStore(state, deps, live, store);
      }
      return observations.get(live) ?? { ...store, owner: { name: "", purse: 0 }, stock: [] };
    }) ?? null,
    spellbooks: snap.spellbooks,
    level,
  };
  return deepFreeze(structuredClone(world));
}
