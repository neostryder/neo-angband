/**
 * Game constants (z_info), ported from reference/src/init.h
 * struct angband_constants and the constants.txt parser mappings in
 * reference/src/init.c (Angband 4.2.6).
 *
 * bindConstants() turns the compiled constants.json record into a typed
 * Constants value. Field names camel-case the z_info member names. The
 * array-bound members upstream fills while parsing other edit files
 * (store_max, k_max, r_max, ...) are not here; registries derive them
 * from their own data.
 */

/** melee-critical-level / ranged-critical-level rows. */
export interface CriticalLevel {
  cutoff: number;
  mult: number;
  add: number;
  msg: string;
}

/** o-melee-critical-level / o-ranged-critical-level rows. */
export interface OCriticalLevel {
  chance: number;
  dice: number;
  msg: string;
}

export interface MeleeCritical {
  debuffToh: number;
  chanceWeightScale: number;
  chanceTohScale: number;
  chanceLevelScale: number;
  chanceTohSkillScale: number;
  chanceOffset: number;
  chanceRange: number;
  powerWeightScale: number;
  powerRandom: number;
  levels: CriticalLevel[];
}

export interface RangedCritical {
  debuffToh: number;
  chanceWeightScale: number;
  chanceTohScale: number;
  chanceLevelScale: number;
  chanceLaunchedTohSkillScale: number;
  chanceThrownTohSkillScale: number;
  chanceOffset: number;
  chanceRange: number;
  powerWeightScale: number;
  powerRandom: number;
  levels: CriticalLevel[];
}

export interface OMeleeCritical {
  debuffToh: number;
  powerTohScaleNumerator: number;
  powerTohScaleDenominator: number;
  chancePowerScaleNumerator: number;
  chancePowerScaleDenominator: number;
  chanceAddDenominator: number;
  levels: OCriticalLevel[];
}

export interface ORangedCritical {
  debuffToh: number;
  powerLaunchedTohScaleNumerator: number;
  powerLaunchedTohScaleDenominator: number;
  powerThrownTohScaleNumerator: number;
  powerThrownTohScaleDenominator: number;
  chancePowerScaleNumerator: number;
  chancePowerScaleDenominator: number;
  chanceAddDenominator: number;
  levels: OCriticalLevel[];
}

export interface Constants {
  /* level-max */
  levelMonsterMax: number;
  /* mon-gen */
  allocMonsterChance: number;
  levelMonsterMin: number;
  townMonstersDay: number;
  townMonstersNight: number;
  reproMonsterMax: number;
  oodMonsterChance: number;
  oodMonsterAmount: number;
  monsterGroupMax: number;
  monsterGroupDist: number;
  /* mon-play */
  glyphHardness: number;
  reproMonsterRate: number;
  lifeDrainPercent: number;
  fleeRange: number;
  turnRange: number;
  /* dun-gen */
  levelRoomMax: number;
  levelDoorMax: number;
  wallPierceMax: number;
  tunnGridMax: number;
  roomItemAv: number;
  bothItemAv: number;
  bothGoldAv: number;
  levelPitMax: number;
  /* world */
  maxDepth: number;
  dayLength: number;
  dungeonHgt: number;
  dungeonWid: number;
  townHgt: number;
  townWid: number;
  feelingTotal: number;
  feelingNeed: number;
  stairSkip: number;
  moveEnergy: number;
  /* carry-cap */
  packSize: number;
  quiverSize: number;
  quiverSlotSize: number;
  thrownQuiverMult: number;
  floorSize: number;
  /* store */
  storeInvenMax: number;
  storeTurns: number;
  storeShuffle: number;
  storeMagicLevel: number;
  /* obj-make */
  maxObjDepth: number;
  greatObj: number;
  greatEgo: number;
  fuelTorch: number;
  fuelLamp: number;
  defaultLamp: number;
  /* player */
  maxSight: number;
  maxRange: number;
  startGold: number;
  foodValue: number;
  /* criticals */
  meleeCritical: MeleeCritical;
  rangedCritical: RangedCritical;
  oMeleeCritical: OMeleeCritical;
  oRangedCritical: ORangedCritical;
}

/** section -> label -> Constants field, mirroring init.c parse_constants_*. */
const SCALAR_MAP: Record<string, Record<string, string>> = {
  "level-max": { monsters: "levelMonsterMax" },
  "mon-gen": {
    chance: "allocMonsterChance",
    "level-min": "levelMonsterMin",
    "town-day": "townMonstersDay",
    "town-night": "townMonstersNight",
    "repro-max": "reproMonsterMax",
    "ood-chance": "oodMonsterChance",
    "ood-amount": "oodMonsterAmount",
    "group-max": "monsterGroupMax",
    "group-dist": "monsterGroupDist",
  },
  "mon-play": {
    "break-glyph": "glyphHardness",
    "mult-rate": "reproMonsterRate",
    "life-drain": "lifeDrainPercent",
    "flee-range": "fleeRange",
    "turn-range": "turnRange",
  },
  "dun-gen": {
    "cent-max": "levelRoomMax",
    "door-max": "levelDoorMax",
    "wall-max": "wallPierceMax",
    "tunn-max": "tunnGridMax",
    "amt-room": "roomItemAv",
    "amt-item": "bothItemAv",
    "amt-gold": "bothGoldAv",
    "pit-max": "levelPitMax",
  },
  world: {
    "max-depth": "maxDepth",
    "day-length": "dayLength",
    "dungeon-hgt": "dungeonHgt",
    "dungeon-wid": "dungeonWid",
    "town-hgt": "townHgt",
    "town-wid": "townWid",
    "feeling-total": "feelingTotal",
    "feeling-need": "feelingNeed",
    "stair-skip": "stairSkip",
    "move-energy": "moveEnergy",
  },
  "carry-cap": {
    "pack-size": "packSize",
    "quiver-size": "quiverSize",
    "quiver-slot-size": "quiverSlotSize",
    "thrown-quiver-mult": "thrownQuiverMult",
    "floor-size": "floorSize",
  },
  store: {
    "inven-max": "storeInvenMax",
    turns: "storeTurns",
    shuffle: "storeShuffle",
    "magic-level": "storeMagicLevel",
  },
  "obj-make": {
    "max-depth": "maxObjDepth",
    "great-obj": "greatObj",
    "great-ego": "greatEgo",
    "fuel-torch": "fuelTorch",
    "fuel-lamp": "fuelLamp",
    "default-lamp": "defaultLamp",
  },
  player: {
    "max-sight": "maxSight",
    "max-range": "maxRange",
    "start-gold": "startGold",
    "food-value": "foodValue",
  },
};

/** section -> label -> field of the critical sub-object. */
const CRITICAL_MAP: Record<string, Record<string, string>> = {
  "melee-critical": {
    "debuff-toh": "debuffToh",
    "chance-weight-scale": "chanceWeightScale",
    "chance-toh-scale": "chanceTohScale",
    "chance-level-scale": "chanceLevelScale",
    "chance-toh-skill-scale": "chanceTohSkillScale",
    "chance-offset": "chanceOffset",
    "chance-range": "chanceRange",
    "power-weight-scale": "powerWeightScale",
    "power-random": "powerRandom",
  },
  "ranged-critical": {
    "debuff-toh": "debuffToh",
    "chance-weight-scale": "chanceWeightScale",
    "chance-toh-scale": "chanceTohScale",
    "chance-level-scale": "chanceLevelScale",
    "chance-launched-toh-skill-scale": "chanceLaunchedTohSkillScale",
    "chance-thrown-toh-skill-scale": "chanceThrownTohSkillScale",
    "chance-offset": "chanceOffset",
    "chance-range": "chanceRange",
    "power-weight-scale": "powerWeightScale",
    "power-random": "powerRandom",
  },
  "o-melee-critical": {
    "debuff-toh": "debuffToh",
    "power-toh-scale-numerator": "powerTohScaleNumerator",
    "power-toh-scale-denominator": "powerTohScaleDenominator",
    "chance-power-scale-numerator": "chancePowerScaleNumerator",
    "chance-power-scale-denominator": "chancePowerScaleDenominator",
    "chance-add-denominator": "chanceAddDenominator",
  },
  "o-ranged-critical": {
    "debuff-toh": "debuffToh",
    "power-launched-toh-scale-numerator": "powerLaunchedTohScaleNumerator",
    "power-launched-toh-scale-denominator": "powerLaunchedTohScaleDenominator",
    "power-thrown-toh-scale-numerator": "powerThrownTohScaleNumerator",
    "power-thrown-toh-scale-denominator": "powerThrownTohScaleDenominator",
    "chance-power-scale-numerator": "chancePowerScaleNumerator",
    "chance-power-scale-denominator": "chancePowerScaleDenominator",
    "chance-add-denominator": "chanceAddDenominator",
  },
};

interface LabeledValue {
  label: string;
  value: number;
}

/** The compiled constants.json record shape (one singleton record). */
export interface ConstantsJson {
  records: Array<Record<string, unknown>>;
}

function bindSection(
  target: Record<string, unknown>,
  map: Record<string, string>,
  entries: LabeledValue[],
  section: string,
  rejectNegative: boolean,
): void {
  for (const { label, value } of entries) {
    const field = map[label];
    if (field === undefined) {
      // Upstream: PARSE_ERROR_UNDEFINED_DIRECTIVE.
      throw new Error(`constants: unknown label ${section}:${label}`);
    }
    if (rejectNegative && value < 0) {
      // The basic scalar parsers reject negatives (INVALID_VALUE); the
      // critical parsers accept them (chance-offset is negative in the
      // shipped constants.txt).
      throw new Error(`constants: negative value ${section}:${label}`);
    }
    target[field] = value;
  }
}

/** Bind the compiled constants.json into a typed Constants. */
export function bindConstants(json: ConstantsJson): Constants {
  const rec = json.records[0];
  if (!rec) throw new Error("constants: no record");
  const out: Record<string, unknown> = {};

  for (const [section, map] of Object.entries(SCALAR_MAP)) {
    const entries = rec[section] as LabeledValue[] | undefined;
    if (!entries) throw new Error(`constants: missing section ${section}`);
    bindSection(out, map, entries, section, true);
  }

  const crit = (section: string): Record<string, unknown> => {
    const map = CRITICAL_MAP[section] as Record<string, string>;
    const entries = rec[section] as LabeledValue[] | undefined;
    if (!entries) throw new Error(`constants: missing section ${section}`);
    const sub: Record<string, unknown> = {};
    bindSection(sub, map, entries, section, false);
    sub["levels"] = rec[`${section}-level`] ?? [];
    return sub;
  };

  out["meleeCritical"] = crit("melee-critical");
  out["rangedCritical"] = crit("ranged-critical");
  out["oMeleeCritical"] = crit("o-melee-critical");
  out["oRangedCritical"] = crit("o-ranged-critical");

  return out as unknown as Constants;
}
