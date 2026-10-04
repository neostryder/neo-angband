/**
 * The known world as API 2 hands it to a mod: plain, serializable data built
 * from what the player knows and nothing else.
 *
 * Core builds it (packages/core/src/agent/known-world.ts, `buildKnownWorld`)
 * and this file is the contract that build is held to. Core cannot be imported
 * from here, because core depends on this package, so the shapes are written
 * out again. packages/core/src/mod/api2-agreement.test.ts checks at compile
 * time that core's KnownWorld fits these types and that neither side has a
 * field the other lacks, so the two copies cannot drift apart quietly.
 *
 * Every type is read-only and holds only data: no functions, no class
 * instances, no live engine objects. A Worker receives the same value through
 * structured clone that an in-process mod receives directly.
 */

/** Identifies one input wait of one game. Two equal tokens name the same moment. */
export interface KnownToken {
  readonly epoch: number;
  readonly revision: number;
}

/** A grid position on the level. */
export interface KnownGrid {
  readonly x: number;
  readonly y: number;
}

/** The player's timed effects, in turns remaining (0 means clear). */
export interface KnownPlayerStatus {
  readonly blind: number;
  readonly confused: number;
  readonly afraid: number;
  readonly poisoned: number;
  readonly cut: number;
  readonly stun: number;
  readonly paralyzed: number;
  readonly food: number;
  readonly fast: number;
  readonly sprint: number;
  readonly protEvil: number;
  readonly hero: number;
  readonly shero: number;
  readonly shield: number;
  readonly stoneskin: number;
  readonly blessed: number;
  readonly fastcast: number;
  readonly resAcid: number;
  readonly resElec: number;
  readonly resFire: number;
  readonly resCold: number;
  readonly resPois: number;
  /** Afraid from any source the player knows about, which is what refuses a melee blow. */
  readonly fearful?: boolean;
  readonly terror?: number;
  readonly amnesia?: number;
  readonly image?: number;
}

/**
 * The player as the character sheet shows them. Every number worn gear can
 * change through a rune is the known value: a rune the player has not learned
 * moves none of them.
 */
export interface KnownPlayer {
  readonly race: string;
  readonly cls: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly exp: number;
  readonly maxExp: number;
  readonly gold: number;
  readonly learnableSpells: number;
  readonly depth: number;
  readonly maxDepth: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly sp: number;
  readonly maxSp: number;
  /** Net speed (110 is normal). */
  readonly speed: number;
  readonly ac: number;
  readonly toHit: number;
  readonly toDam: number;
  readonly stats: readonly number[];
  readonly light: number;
  readonly grid: KnownGrid;
  readonly status: KnownPlayerStatus;
  readonly dead: boolean;
  readonly winner: boolean;
  /** The low hit point warning threshold in hit points; 0 means the warning is off. */
  readonly hpWarning: number;
  readonly recall: number;
  readonly descent: number;
  readonly playerRaceId?: string;
  readonly playerClassId?: string;
  readonly skills: readonly number[];
  readonly shape: string | null;
  readonly objectFlags: readonly string[];
  readonly classFlags: readonly string[];
  readonly seeInfra: number;
  readonly blows: number;
  readonly shots: number;
}

/**
 * An item as the player knows it. An unidentified flavour is named by its
 * flavour (`aware` is false, `kindKey` is `flavor:<index>`, `sval` is negative
 * and there is no `kindId`), and bonuses, flags and curses count only what the
 * player has learned.
 */
export interface KnownItem {
  readonly handle: number;
  readonly kindKey: string;
  readonly itemKey?: string;
  readonly nameColor: string;
  readonly label: string;
  readonly aware: boolean;
  readonly tval: number;
  readonly sval: number;
  readonly pval: number;
  readonly number: number;
  readonly weight: number;
  readonly ac: number;
  readonly toA: number;
  readonly toH: number;
  readonly toD: number;
  readonly dd: number;
  readonly ds: number;
  readonly ego: boolean;
  readonly artifact: boolean;
  readonly flags: readonly string[];
  readonly modifiers: readonly { readonly code: string; readonly value: number }[];
  readonly brands: readonly string[];
  readonly slays: readonly string[];
  readonly resists: readonly { readonly element: string; readonly level: number }[];
  readonly curses: readonly string[];
  readonly egoName: string | null;
  readonly artifactName: string | null;
  readonly activation: boolean;
  readonly timeout: number;
  readonly inscription: string | null;
  readonly floorIndex?: number;
  readonly name?: string;
  readonly ignored?: boolean;
  readonly kindId?: string;
  readonly value?: number;
}

/** One ware in a shop, or one item in the home. */
export interface KnownStoreItem extends KnownItem {
  readonly index: number;
  readonly price?: number;
}

/** A shop or the home, as its screen lists it. */
export interface KnownStore {
  readonly feat: number;
  readonly featName: string;
  readonly isHome: boolean;
  readonly owner: { readonly name: string; readonly purse: number };
  readonly stock: readonly KnownStoreItem[];
}

/** One spell in a book the player can read. */
export interface KnownSpell {
  readonly name: string;
  readonly sidx: number;
  readonly bidx: number;
  readonly level: number;
  readonly mana: number;
  readonly fail: number;
  readonly chance?: number;
  readonly learned: boolean;
  readonly worked: boolean;
  readonly forgotten: boolean;
  readonly studyEligible: boolean;
  readonly infoLine: string;
}

/** A spellbook and its spells. */
export interface KnownSpellbook {
  readonly tval: number;
  readonly name: string;
  readonly realm: string;
  readonly spells: readonly KnownSpell[];
}

/** The current target: a monster id, or 0 for a bare location. */
export interface KnownTarget {
  readonly midx: number;
  readonly grid: KnownGrid;
}

/** The look command's health bands, from unhurt to almost dead. */
export type KnownMonsterHealth = "unhurt" | "somewhat" | "wounded" | "badly" | "almost";

/** The statuses the look command names. */
export type KnownMonsterStatus =
  | "asleep"
  | "held"
  | "disenchanted"
  | "confused"
  | "afraid"
  | "stunned"
  | "slowed"
  | "hasted";

/**
 * A monster the player perceives, as the look command and monster recall
 * describe it. There are no exact hit points, no current speed, and no flag or
 * spell the player's lore has not learned.
 */
export interface KnownMonster {
  readonly id: number;
  readonly race: string;
  readonly raceIndex: number;
  readonly raceId?: string;
  readonly grid: KnownGrid;
  /** Seen with the eyes, rather than only detected or sensed. */
  readonly visible: boolean;
  readonly health: KnownMonsterHealth;
  readonly living: boolean;
  readonly status: readonly KnownMonsterStatus[];
  /** The look command's line for it ("wounded, asleep"). */
  readonly look: string;
  readonly raceLevel: number;
  readonly raceSpeed: number;
  readonly knownFlags: readonly string[];
  readonly knownSpells: readonly string[];
  readonly unique: boolean;
  readonly questGuardian: boolean;
  readonly finalGuardian: boolean;
  readonly glyph?: string;
}

/** A trap the player remembers on a grid. */
export interface KnownTrap {
  readonly index: number;
  readonly name: string;
}

/** What the player can read on a remembered object's name. */
export type KnownObjectAura = "cursed" | "artifact" | "rune";

/**
 * One remembered object. A sensed one reveals only money or not; an
 * unidentified flavour reveals its flavour and item class, never its kind.
 */
export type KnownRememberedObject =
  | { readonly sensed: true; readonly money: boolean }
  | {
      readonly sensed: false;
      readonly aware: true;
      readonly kindIndex: number;
      readonly kindId?: string;
      readonly aura?: KnownObjectAura;
    }
  | {
      readonly sensed: false;
      readonly aware: false;
      readonly tval: number;
      readonly flavorIndex: number;
      readonly flavorText: string;
      readonly aura?: KnownObjectAura;
    };

/** One grid as the player remembers it. */
export interface KnownRememberedCell {
  readonly feat: number;
  readonly featCode?: string;
  readonly traps: readonly KnownTrap[];
  readonly objects: readonly KnownRememberedObject[];
}

/** One grid of the remembered level. There is no field for the real grid. */
export interface KnownLevelCell {
  readonly x: number;
  readonly y: number;
  readonly remembered: KnownRememberedCell;
  /** In view right now. */
  readonly visible: boolean;
}

/** The level as the player remembers it, never the real map. */
export interface KnownLevel {
  readonly token: KnownToken;
  readonly levelId: number;
  readonly depth: number;
  readonly width: number;
  readonly height: number;
  readonly cells: readonly KnownLevelCell[];
}

/** The known-world format version this API reads. */
export const KNOWN_WORLD_FORMAT = 1;

/**
 * The game at one input wait, as the player knows it. A part the mod has no
 * read permission for is null.
 */
export interface KnownWorldData {
  readonly version: typeof KNOWN_WORLD_FORMAT;
  readonly token: KnownToken;
  readonly turn: number | null;
  readonly player: KnownPlayer | null;
  readonly inventory: readonly KnownItem[] | null;
  readonly equipment: readonly (KnownItem | null)[] | null;
  readonly quiver: readonly KnownItem[] | null;
  readonly floorHere: readonly KnownItem[] | null;
  readonly monsters: readonly KnownMonster[] | null;
  readonly target: KnownTarget | null;
  /** False when the target part was not readable, so a null target means nothing. */
  readonly targetReadable: boolean;
  readonly stores: readonly KnownStore[] | null;
  readonly spellbooks: readonly KnownSpellbook[] | null;
  readonly level: KnownLevel | null;
}
