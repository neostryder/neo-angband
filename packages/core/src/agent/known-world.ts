/**
 * Everything a mod may read about the game, built from what the player knows
 * and nothing else. Menus, panels, network payloads and autoplayers can all
 * read the same builder, so a leak gets fixed in one place.
 *
 * known-world.test.ts holds it to one rule: two games that differ only in
 * something the player cannot know build the same KnownWorld. Its pairs cover
 * an unseen monster, a seen monster's exact hit points and speed, the flags
 * and spells of a race the player has not studied, an unlearned rune or curse,
 * an unaware flavour, and floor memory that has gone stale.
 *
 * Most of it comes from the AgentView accessors, which already describe items,
 * the player, stores, spellbooks, the target and the remembered level the way
 * the player sees them (#304, #328, #368). The real map never gets in, whatever
 * the caller holds, because the view this builds on is never given
 * `state:map-actual.read`. Monsters are the exception. AgentView.monsters() is
 * frozen at API 1 and hands the Borg hit points, speed and every race flag and
 * spell, so a KnownMonster is built here from what the look command and
 * monster recall would show: a health band, the look statuses, the race's
 * level and speed, and the flags and spells in the player's lore.
 *
 * Building one is read-only. It touches no game state, creates no lore record
 * and draws nothing from the RNG.
 */

import { createMonFlagMask } from "../mon/lore.js";
import { monsterIsDestroyed, monsterIsObvious, monsterIsVisible } from "../mon/predicate.js";
import type { Monster } from "../mon/monster.js";
import type { MonsterRace } from "../mon/types.js";
import type { GameState } from "../game/context.js";
import { lookMonDesc } from "../game/target.js";
import { MON_RACE_FLAG_ENTRIES, MON_SPELL_ENTRIES, MON_TMD } from "../generated/index.js";
import type { FlagSet } from "../bitflag.js";
import { captureCoreSnapshot } from "./boundary.js";
import type { InputToken } from "./boundary.js";
import type { KnownLevelView } from "./known-level.js";
import { createAgentView } from "./perceive.js";
import { AGENT_STATE_DOMAINS, AgentCapabilityError } from "./types.js";
import type {
  AgentCapabilities,
  AgentViewDeps,
  ItemView,
  PlayerView,
  SpellbookView,
  StoreView,
  TargetView,
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
  /** The monster's index, the one targeting and commands take. */
  readonly id: number;
  readonly race: string;
  readonly raceIndex: number;
  /** Namespaced race id; present when the builder has a resolver. */
  readonly raceId?: string;
  readonly grid: { readonly x: number; readonly y: number };
  /** Seen with the eyes, rather than only detected or sensed. */
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
  /** Race flags the player's lore has learned, by code. */
  readonly knownFlags: readonly string[];
  /** Spells the player's lore has learned, by code. */
  readonly knownSpells: readonly string[];
  readonly unique: boolean;
  readonly questGuardian: boolean;
  readonly finalGuardian: boolean;
  readonly glyph?: string;
}

/**
 * The game at one input wait, as the player knows it. Plain deep-frozen data;
 * a part the caller has no read capability for is null.
 */
export interface KnownWorld {
  readonly version: typeof KNOWN_WORLD_VERSION;
  readonly token: InputToken;
  readonly turn: number | null;
  readonly player: PlayerView | null;
  readonly inventory: readonly ItemView[] | null;
  readonly equipment: readonly (ItemView | null)[] | null;
  readonly quiver: readonly ItemView[] | null;
  /** The objects under the player that the player remembers exactly. */
  readonly floorHere: readonly ItemView[] | null;
  readonly monsters: readonly KnownMonster[] | null;
  readonly target: TargetView | null;
  /** False when the target part was not readable, so null above is ambiguous. */
  readonly targetReadable: boolean;
  readonly stores: readonly StoreView[] | null;
  readonly spellbooks: readonly SpellbookView[] | null;
  /** The level as the player remembers it, never the real map. */
  readonly level: KnownLevelView | null;
}

/* lore_update's "obvious" flags: the player knows them on sight. Built on
 * first use, because game/known.ts reaches this module for its sighting hook
 * and a mask built at import time would run in the middle of that cycle. */
let obviousRaceFlags: FlagSet | undefined;

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
  const learned = obviousRaceFlags.clone();
  if (lore) learned.union(lore.flags);
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

/**
 * One monster as the player knows it. The caller decides whether the player
 * perceives it; `knownMonsters` lists only those that are.
 */
export function knownMonster(state: GameState, mon: Monster, deps: AgentViewDeps = {}): KnownMonster {
  const quests = state.actor.player.quests;
  const finalRace = quests.length > 0 ? quests[quests.length - 1]!.race : -1;
  const flags = codes(knownRaceFlags(state, mon.race), MON_RACE_FLAG_ENTRIES);
  const view: {
    -readonly [K in keyof KnownMonster]: KnownMonster[K];
  } = {
    id: mon.midx,
    race: mon.race.name,
    raceIndex: mon.race.ridx,
    grid: { x: mon.grid.x, y: mon.grid.y },
    visible: monsterIsVisible(mon),
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

/** Every monster the player perceives, as the monster list shows them. */
export function knownMonsters(state: GameState, deps: AgentViewDeps = {}): KnownMonster[] {
  const out: KnownMonster[] = [];
  for (let i = 1; i < state.monsters.length; i++) {
    const mon = state.monsters[i];
    if (mon && monsterIsObvious(mon)) out.push(knownMonster(state, mon, deps));
  }
  return out;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
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
  const world: KnownWorld = {
    version: KNOWN_WORLD_VERSION,
    token: snap.token,
    turn: snap.turn,
    player: snap.player,
    inventory: snap.inventory,
    equipment: snap.equipment,
    quiver: snap.quiver,
    floorHere: snap.floorHere,
    monsters: readable(AGENT_STATE_DOMAINS.monsters) ? knownMonsters(state, deps) : null,
    target: snap.target,
    targetReadable: snap.targetReadable,
    stores: snap.stores,
    spellbooks: snap.spellbooks,
    level,
  };
  return deepFreeze(structuredClone(world));
}
