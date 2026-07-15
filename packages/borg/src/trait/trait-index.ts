/**
 * The BI_* trait index space - a complete, in-order port of the enum in
 * reference/src/borg/borg-trait.h:62-335. It is the index space for the Borg's
 * derived-stat array borg.trait[] (ctx.world.self.trait). borg_notice fills it;
 * borg_power and borg_prepared read it.
 *
 * The ordering is load-bearing: several traits are addressed by offset from a
 * base (e.g. `BI_STR + i`, `BI_ASTR + i`, `BI_STR_INDEX + i`, `BI_CSTR + i`
 * across the five stats; borg-trait.c:1807, 1829-1833). It MUST match the C enum
 * exactly, which is why it is transcribed verbatim rather than regenerated.
 */

/* eslint-disable @typescript-eslint/prefer-enum-initializers */

/**
 * borg.trait[BI_*] indices. Transcribed 1:1 from borg-trait.h:62-335; the
 * trailing BI_MAX is the array length. Do not reorder.
 */
export enum BI {
  STR = 0,
  INT,
  WIS,
  DEX,
  CON,
  ASTR,
  AINT,
  AWIS,
  ADEX,
  ACON,
  CSTR,
  CINT,
  CWIS,
  CDEX,
  CCON,
  STR_INDEX,
  INT_INDEX,
  WIS_INDEX,
  DEX_INDEX,
  CON_INDEX,
  SSTR,
  SINT,
  SWIS,
  SDEX,
  SCON,
  CLASS,
  LIGHT,
  CURHP,
  MAXHP,
  HP_ADJ,
  CURSP,
  MAXSP,
  SP_ADJ,
  FAIL1,
  FAIL2,
  CLEVEL,
  MAXCLEVEL,
  ESP,
  RECALL,
  FOOD,
  FOOD_HI,
  FOOD_LO,
  FOOD_CURE_CONF,
  FOOD_CURE_BLIND,
  SPEED,
  GOLD,
  MOD_MOVES,
  DAM_RED,
  SDIG,
  FEATH,
  REG,
  SINV,
  INFRA,
  FAST_SHOTS,
  DISP,
  DISM,
  DEV,
  SAV,
  STL,
  SRCH,
  THN,
  THB,
  THT,
  DIG,
  IFIRE,
  IACID,
  ICOLD,
  IELEC,
  IPOIS,
  RFIRE,
  RCOLD,
  RELEC,
  RACID,
  RPOIS,
  RFEAR,
  RLITE,
  RDARK,
  RBLIND,
  RCONF,
  RSND,
  RSHRD,
  RNXUS,
  RNTHR,
  RKAOS,
  RDIS,
  HLIFE,
  FRACT,
  SRFIRE,
  SRCOLD,
  SRELEC,
  SRACID,
  SRPOIS,
  SRFEAR,
  SRLITE,
  SRDARK,
  SRBLIND,
  SRCONF,
  SRSND,
  SRSHRD,
  SRNXUS,
  SRNTHR,
  SRKAOS,
  SRDIS,
  SHLIFE,
  SFRACT,

  CDEPTH,
  MAXDEPTH,
  KING,

  ISWEAK,
  ISHUNGRY,
  ISFULL,
  ISGORGED,
  ISBLIND,
  ISAFRAID,
  ISCONFUSED,
  ISPOISONED,
  ISCUT,
  ISSTUN,
  ISHEAVYSTUN,
  ISPARALYZED,
  ISIMAGE,
  ISFORGET,
  ISENCUMB,
  ISSTUDY,
  ISFIXLEV,
  ISFIXEXP,
  HASFIXEXP,
  ISFIXSTR,
  ISFIXINT,
  ISFIXWIS,
  ISFIXDEX,
  ISFIXCON,
  ISFIXALL,

  ARMOR,
  TOHIT,
  TODAM,
  WTOHIT,
  WTODAM,
  WID,
  WDD,
  WDS,
  BID,
  BTOHIT,
  BTODAM,
  SLING,
  BART,
  BLOWS,
  EXTRA_BLOWS,
  SHOTS,
  HEAVYWEPON,
  HEAVYBOW,
  AMMO_COUNT,
  AMMO_TVAL,
  AMMO_SIDES,
  AMMO_POWER,
  AMISSILES,
  AMISSILES_SPECIAL,
  AMISSILES_CURSED,
  QUIVER_SLOTS,
  FIRST_CURSED,
  WHERE_CURSED,

  CRSENVELOPING,
  CRSIRRITATION,
  CRSTELE,
  CRSPOIS,
  CRSSIREN,
  CRSHALU,
  CRSPARA,
  CRSSDEM,
  CRSSDRA,
  CRSSUND,
  CRSSTONE,
  CRSNOTEL,
  CRSTWEP,
  CRSAGRV,
  CRSVULN,
  CRSDULL,
  CRSSICK,
  CRSWEAK,
  CRSCLUM,
  CRSSLOW,
  CRSANNOY,
  CRSHPIMP,
  CRSMPIMP,
  CRSSTEELSKIN,
  CRSAIRSWING,
  CRSFEAR,
  CRSDRAIN_XP,
  CRSFVULN,
  CRSEVULN,
  CRSCVULN,
  CRSAVULN,
  CRSUNKNO,

  WS_ANIMAL,
  WS_EVIL,
  WS_UNDEAD,
  WS_DEMON,
  WS_ORC,
  WS_TROLL,
  WS_GIANT,
  WS_DRAGON,
  WK_UNDEAD,
  WK_DEMON,
  WK_DRAGON,
  W_IMPACT,
  WB_ACID,
  WB_ELEC,
  WB_FIRE,
  WB_COLD,
  WB_POIS,
  APHASE,
  ATELEPORT,
  AESCAPE,
  AFUEL,
  AHEAL,
  AEZHEAL,
  ALIFE,
  AID,
  ASPEED,
  ASTFMAGI,
  ASTFDEST,
  ATPORTOTHER,
  ACUREPOIS,
  ADETTRAP,
  ADETDOOR,
  ADETEVIL,
  AMAGICMAP,
  ARECHARGE,
  ALITE,
  APFE,
  AGLYPH,
  ACCW,
  ACSW,
  ACLW,
  AENCH_TOH,
  AENCH_TOD,
  AENCH_SWEP,
  AENCH_ARM,
  AENCH_SARM,
  ABRAND,
  NEED_ENCHANT_TO_A,
  NEED_ENCHANT_TO_H,
  NEED_ENCHANT_TO_D,
  NEED_BRAND_WEAPON,
  ARESHEAT,
  ARESCOLD,
  ARESPOIS,
  ATELEPORTLVL,
  AHWORD,
  AMASSBAN,
  ASHROOM,
  AROD1,
  AROD2,
  WORN_NEED_ID,
  ALL_NEED_ID,
  ADIGGER,
  GOOD_S_CHG,
  GOOD_W_CHG,
  MULTIPLE_BONUSES,
  DINV,
  WEIGHT,
  CARRY,
  EMPTY,
  SAURON_DEAD,
  PREP_BIG_FIGHT,

  MAX,
}

/** Array length of borg.trait[] (borg-trait.h: BI_MAX). */
export const BI_MAX = BI.MAX;

/**
 * The human-readable label per BI_* value (prefix_pref[], borg-trait.c:745).
 * Kept 1:1 with the enum for debug/HUD parity; index with the BI value.
 */
export const PREFIX_PREF: readonly string[] = [
  "str", "int", "wis", "dex", "con",
  "str adj", "int adj", "wis adj", "dex adj", "con adj",
  "cur str", "cur int", "cur wis", "cur dex", "cur con",
  "str index", "int index", "wis index", "dex index", "con index",
  "sust str", "sust int", "sust wis", "sust dex", "sust con",
  "class", "light", "cur hp", "max hp", "hp adj",
  "cur sp", "max sp", "sp adj", "SFAIL1", "SFAIL2",
  "clevel", "max clevel", "esp", "recall", "food",
  "food high", "food low", "food cure conf", "food cure blind", "speed",
  "gold", "extra moves", "damage reduction", "slow dig", "feather fall",
  "regen", "see inv", "infravision", "fast shots", "disarm ph",
  "disarm mag", "use device", "save", "stealth", "search",
  "to hit normal", "to hit bow", "to hit throw", "dig", "immune fire",
  "immune acid", "immune cold", "immune elec", "immune poison", "resist fire",
  "resist cold", "resist elec", "resist acid", "resist poison", "resist fear",
  "resist lite", "resist dark", "resist blind", "resist conf", "resist sound",
  "resist shards", "resist nexus", "resist nether", "resist chaos", "resist dis",
  "hold life", "free action",
  "resist fire with swap", "resist cold with swap", "resist elec with swap",
  "resist acid with swap", "resist poison with swap", "resist fear with swap",
  "resist lite with swap", "resist dark with swap", "resist blind with swap",
  "resist conf with swap", "resist sound with swap", "resist shards with swap",
  "resist nexus with swap", "resist nether with swap", "resist chaos with swap",
  "resist dis with swap", "hold life with swap", "free action with swap",
  "depth", "max depth", "king",
  "is weak", "is hungry", "is full", "is gorged", "is blind",
  "is afraid", "is confused", "is poisoned", "is cut", "is stun",
  "is heavystun", "is paralyzed", "is image", "is forget", "is encumb",
  "is study", "is fixlev", "is fixexp", "has fixexp", "is fixstr",
  "is fixint", "is fixwis", "is fixdex", "is fixcon", "is fixall",
  "armor", "to hit", "to damage", "wep to hit", "wep to damage",
  "wep id", "wep damage dice", "wep damage sides", "bow id", "bow to hit",
  "bow to damage", "bow is sling", "bow artifact", "blows", "EXTRA_BLOWS",
  "shots", "heavy weapon", "heavy bow", "ammo count", "ammo tval",
  "ammo sides", "ammo power", "amt missiles", "amt ego missiles",
  "amt cursed missiles", "quiver slots", "first cursed", "where cursed",
  "enveloping", "irritation", "teleport", "curse poison", "siren",
  "hallucinate", "paralysis", "summon demon", "summon dragon", "summon undead",
  "curse stone", "no teleport", "treach wep", "aggravate", "vulnerable",
  "dullness", "sickness", "weakness", "clumsiness", "slowness",
  "annoyance", "impair hp", "CRSMPIMP", "curse steel", "air swing",
  "fear", "drain xp", "vuln fire", "vuln elec", "vuln cold",
  "vuln acid", "unknown curse",
  "wep slay animal", "wep slay evil", "wep slay undead", "wep slay demon",
  "wep slay orc", "wep slay troll", "wep slay giant", "wep slay dragon",
  "wep kill undead", "wep kill demon", "wep kill dragon", "wep impact",
  "wep brand acid", "wep brand elec", "wep brand fire", "wep brand cold",
  "wep brand poison",
  "amt phase", "amt teleport", "amt escape", "fuel", "amt heal",
  "amt ezheal", "amt life", "amt id", "amt speed", "amt staff magi",
  "amt staff destruction", "amt teleport other", "amt cure poison",
  "amt detect traps", "amt detect door", "amt detect evil", "amt magic map",
  "amt recharge", "amt call lite", "amt prot evil", "amt glyph",
  "amt potion ccw", "amt potion csw", "amt potion clw", "amt ench to hit",
  "amt ench to dam", "amt *ench to wep*", "amt ench to armor",
  "amt *ench to armor*", "amt brand", "need ench to armor", "need ench to hit",
  "need ench to dam", "need brand", "amt resist heat", "amt resist cold",
  "amt resist poison", "amt teleport level", "holy word", "mass banishment",
  "amt cool shroom", "amt attack rods1", "amt attack rods2", "worn need id",
  "amt need id", "amt diggers", "amt good staff chg", "amt good wand chg",
  "multi bonus", "detect inv", "weight", "carry", "empty slots",
  "sauron dead", "prep big fight",
];

/* --- Player class / race / stat identity (borg-trait.h:46-57, 496-506). --- */

export const CLASS_WARRIOR = 0;
export const CLASS_MAGE = 1;
export const CLASS_DRUID = 2;
export const CLASS_PRIEST = 3;
export const CLASS_NECROMANCER = 4;
export const CLASS_PALADIN = 5;
export const CLASS_ROGUE = 6;
export const CLASS_RANGER = 7;
export const CLASS_BLACKGUARD = 8;
export const MAX_CLASSES = 9;

export const STAT_STR = 0;
export const STAT_INT = 1;
export const STAT_WIS = 2;
export const STAT_DEX = 3;
export const STAT_CON = 4;
export const STAT_MAX = 5;

/** where-cursed bit flags (borg-trait.h:59). */
export const BORG_INVEN = 1;
export const BORG_EQUIP = 2;
export const BORG_QUILL = 4;

/** Map a PlayerView.cls name to the borg CLASS_* index. */
export function classIndexFromName(name: string): number {
  switch (name.toLowerCase()) {
    case "warrior": return CLASS_WARRIOR;
    case "mage": return CLASS_MAGE;
    case "druid": return CLASS_DRUID;
    case "priest": return CLASS_PRIEST;
    case "necromancer": return CLASS_NECROMANCER;
    case "paladin": return CLASS_PALADIN;
    case "rogue": return CLASS_ROGUE;
    case "ranger": return CLASS_RANGER;
    case "blackguard": return CLASS_BLACKGUARD;
    default: return CLASS_WARRIOR;
  }
}

/**
 * The primary spellcasting stat index for a class, or -1 for non-casters
 * (borg_spell_stat, borg-magic.c: realm->stat of the class's first book).
 * Derived from realm.txt: arcane/shadow -> INT, divine/nature -> WIS.
 */
export function spellStatForClass(cls: number): number {
  switch (cls) {
    case CLASS_MAGE: return STAT_INT; /* arcane */
    case CLASS_ROGUE: return STAT_INT; /* arcane */
    case CLASS_NECROMANCER: return STAT_INT; /* shadow */
    case CLASS_BLACKGUARD: return STAT_INT; /* shadow */
    case CLASS_PRIEST: return STAT_WIS; /* divine */
    case CLASS_PALADIN: return STAT_WIS; /* divine */
    case CLASS_DRUID: return STAT_WIS; /* nature */
    case CLASS_RANGER: return STAT_WIS; /* nature */
    default: return -1; /* warrior: no spells */
  }
}
