/**
 * Object domain data model, ported from reference/src/object.h (struct
 * object_base, object_kind, ego_item, artifact, curse, brand, slay,
 * activation, flavor), obj-properties.h (struct obj_property and the
 * OFT_/OBJ_PROPERTY_/OFID_ enums), and the related constants
 * (Angband 4.2.6).
 *
 * Registries bind from the compiled pack JSON (packages/content/pack);
 * see bind.ts. Live object instances are in object.ts; generation is in
 * make.ts.
 *
 * Effect chains (kind/curse/activation `effect:` directives) are kept as
 * raw compiled records (EffectRecordJson) rather than being converted to
 * the effects domain's runtime Effect type here; the effects interpreter
 * owns that conversion at integration time. Dice strings inside effect
 * records therefore stay raw as well.
 */

import { flagSize, FlagSet } from "../bitflag";
import { ELEM, ELEMENT_ENTRIES, KF, OBJ_MOD, OF, TVAL_ENTRIES } from "../generated";
import type { RandomValue } from "../rng";

/** TV_MAX: number of tvals (list-tvals.h). */
export const TV_MAX = TVAL_ENTRIES.length;

/** Byte size of an object flag set (OF_SIZE = FLAG_SIZE(OF_MAX)). */
export const OF_SIZE = flagSize(OF.MAX);

/** Byte size of a kind flag set (KF_SIZE = FLAG_SIZE(KF_MAX)). */
export const KF_SIZE = flagSize(KF.MAX);

/** OBJ_MOD_MAX: five stats plus the list-object-modifiers.h entries. */
export const OBJ_MOD_MAX = Object.keys(OBJ_MOD).length;

/** ELEM_MAX from list-elements.h. */
export const ELEM_MAX = ELEMENT_ENTRIES.length;

/* Element ranges (object.h). */
export const ELEM_BASE_MIN = ELEM.ACID;
export const ELEM_BASE_MAX = ELEM.COLD + 1;
export const ELEM_HIGH_MIN = ELEM.POIS;
export const ELEM_HIGH_MAX = ELEM.DISEN + 1;

/* struct element_info flags (object.h). */
export const EL_INFO_HATES = 0x01;
export const EL_INFO_IGNORE = 0x02;
export const EL_INFO_RANDOM = 0x04;

/** obj-util.h MAX_PVAL. */
export const MAX_PVAL = 32767;

/** obj-make.h NO_MINIMUM (ego minima sentinel). */
export const NO_MINIMUM = 255;

/** obj-tval.h SV_UNKNOWN. */
export const SV_UNKNOWN = 0;

/** obj-properties.h enum object_flag_type. */
export const OFT = {
  NONE: 0,
  SUST: 1,
  PROT: 2,
  MISC: 3,
  LIGHT: 4,
  MELEE: 5,
  BAD: 6,
  DIG: 7,
  THROW: 8,
  CURSE_ONLY: 9,
  MAX: 10,
} as const;

/** obj-properties.h enum object_flag_id. */
export const OFID = {
  NONE: 0,
  NORMAL: 1,
  TIMED: 2,
  WIELD: 3,
} as const;

/** obj-properties.h enum obj_property_type. */
export const OBJ_PROPERTY = {
  NONE: 0,
  STAT: 1,
  MOD: 2,
  FLAG: 3,
  IGNORE: 4,
  RESIST: 5,
  VULN: 6,
  IMM: 7,
  MAX: 8,
} as const;

/** struct element_info. */
export interface ElementInfo {
  resLevel: number;
  /** EL_INFO_* bit flags. */
  flags: number;
}

/** A zeroed element info array of ELEM_MAX entries. */
export function newElemInfo(): ElementInfo[] {
  const out: ElementInfo[] = [];
  for (let i = 0; i < ELEM_MAX; i++) out.push({ resLevel: 0, flags: 0 });
  return out;
}

/** A zeroed RandomValue. */
export function zeroRv(): RandomValue {
  return { base: 0, dice: 0, sides: 0, mBonus: 0 };
}

/** A zeroed RandomValue array of OBJ_MOD_MAX entries. */
export function newModifiersRv(): RandomValue[] {
  const out: RandomValue[] = [];
  for (let i = 0; i < OBJ_MOD_MAX; i++) out.push(zeroRv());
  return out;
}

/** A new object flag set. */
export function newOfFlags(): FlagSet {
  return new FlagSet(OF_SIZE);
}

/** A new kind flag set. */
export function newKfFlags(): FlagSet {
  return new FlagSet(KF_SIZE);
}

/* ------------------------------------------------------------------ */
/* Compiled pack record shapes (field names mirror gamedata directives) */
/* ------------------------------------------------------------------ */

/** One expr: sub-directive of an effect. */
export interface EffectExprJson {
  name: string;
  base: string;
  expr: string;
}

/**
 * One effect: entry as compiled. Dice and expressions stay raw; the
 * effects domain binds them.
 */
export interface EffectRecordJson {
  eff: string;
  type?: string;
  radius?: number;
  other?: number;
  dice?: string;
  expr?: EffectExprJson[];
  "effect-yx"?: { y: number; x: number };
}

export interface ObjectBaseRecordJson {
  name: { tval: string; name?: string };
  graphics?: string;
  break?: number;
  "max-stack"?: number;
  flags?: string[];
}

export interface ObjectBaseHeaderJson {
  default?: Array<{ label: string; value: number }>;
}

export interface ObjectKindRecordJson {
  name: string;
  type: string;
  graphics?: { glyph: string; color: string };
  level?: number;
  weight?: number;
  cost?: number;
  alloc?: { common: number; minmax: string };
  attack?: { hd: string; "to-h": string | number; "to-d": string | number };
  armor?: { ac: number; "to-a": string | number };
  charges?: string;
  pile?: Array<{ prob: number; stack: string }>;
  flags?: string[];
  power?: number;
  effect?: EffectRecordJson[];
  msg?: string[];
  "vis-msg"?: string[];
  time?: string;
  pval?: string;
  values?: string[];
  desc?: string[];
  slay?: string[];
  brand?: string[];
  curse?: Array<{ name: string; power: number }>;
}

export interface EgoRecordJson {
  name: string;
  info?: { cost: number; rating: number };
  alloc?: { common: number; minmax: string };
  type?: string[];
  item?: Array<{ tval: string; sval: string }>;
  combat?: { th: string | number; td: string | number; ta: string | number };
  "min-combat"?: { th: number; td: number; ta: number };
  act?: string;
  time?: string;
  flags?: string[];
  "flags-off"?: string[];
  values?: string[];
  "min-values"?: string[];
  desc?: string[];
  slay?: string[];
  brand?: string[];
  curse?: Array<{ name: string; power: number }>;
}

export interface ArtifactRecordJson {
  name: string;
  "base-object": { tval: string; sval: string };
  graphics?: { glyph: string; color: string };
  level?: number;
  weight?: number;
  cost?: number;
  alloc?: { common: number; minmax: string };
  attack?: { hd: string; "to-h": number; "to-d": number };
  armor?: { ac: number; "to-a": number };
  flags?: string[];
  act?: string;
  time?: string;
  msg?: string[];
  values?: string[];
  desc?: string[];
  slay?: string[];
  brand?: string[];
  curse?: Array<{ name: string; power: number }>;
}

export interface CurseRecordJson {
  name: string;
  type?: string[];
  weight?: number;
  combat?: { "to-h": number; "to-d": number; "to-a": number };
  effect?: EffectRecordJson[];
  msg?: string[];
  time?: string;
  flags?: string[];
  values?: string[];
  desc?: string[];
  conflict?: string[];
  "conflict-flags"?: string[];
}

export interface BrandRecordJson {
  code: string;
  name?: string;
  verb?: string;
  multiplier?: number;
  "o-multiplier"?: number;
  power?: number;
  "resist-flag"?: string;
  "vuln-flag"?: string;
}

export interface SlayRecordJson {
  code: string;
  name?: string;
  "race-flag"?: string;
  base?: string;
  multiplier?: number;
  "o-multiplier"?: number;
  power?: number;
  "melee-verb"?: string;
  "range-verb"?: string;
}

export interface ActivationRecordJson {
  name: string;
  aim?: number;
  level?: number;
  power?: number;
  effect?: EffectRecordJson[];
  msg?: string[];
  desc?: string[];
}

export interface ObjectPropertyRecordJson {
  name: string;
  code?: string;
  type?: string;
  subtype?: string;
  "id-type"?: string;
  power?: number;
  mult?: number;
  "type-mult"?: Array<{ type: string; mult: number }>;
  adjective?: string;
  "neg-adjective"?: string;
  msg?: string;
  desc?: string;
  bindui?: unknown;
}

export interface FlavorEntryJson {
  index: number;
  sval?: string;
  attr: string;
  desc?: string;
}

export interface FlavorRecordJson {
  kind: { tval: string; glyph: string };
  flavor?: FlavorEntryJson[];
  fixed?: FlavorEntryJson[];
}

/** The full bundle of pack JSON record arrays the registry binds from. */
export interface ObjPackJson {
  objectBase: {
    header?: ObjectBaseHeaderJson;
    records: ObjectBaseRecordJson[];
  };
  object: { records: ObjectKindRecordJson[] };
  egoItem: { records: EgoRecordJson[] };
  artifact: { records: ArtifactRecordJson[] };
  curse: { records: CurseRecordJson[] };
  brand: { records: BrandRecordJson[] };
  slay: { records: SlayRecordJson[] };
  activation: { records: ActivationRecordJson[] };
  objectProperty: { records: ObjectPropertyRecordJson[] };
  flavor: { records: FlavorRecordJson[] };
}

/* ------------------------------------------------------------------ */
/* Bound registry types                                                 */
/* ------------------------------------------------------------------ */

/** struct object_base. */
export interface ObjectBase {
  name: string;
  tval: number;
  /** Color name/char as compiled (upstream converts to an attr byte). */
  attr: string;
  flags: FlagSet;
  kindFlags: FlagSet;
  elInfo: ElementInfo[];
  breakPerc: number;
  maxStack: number;
  numSvals: number;
}

/** struct object_kind. */
export interface ObjectKind {
  name: string;
  text: string;
  base: ObjectBase;
  kidx: number;
  tval: number;
  sval: number;
  pval: RandomValue;
  toH: RandomValue;
  toD: RandomValue;
  toA: RandomValue;
  ac: number;
  dd: number;
  ds: number;
  weight: number;
  cost: number;
  flags: FlagSet;
  kindFlags: FlagSet;
  modifiers: RandomValue[];
  elInfo: ElementInfo[];
  /** Indexed by brand index (1-based); null when the kind has none. */
  brands: boolean[] | null;
  /** Indexed by slay index (1-based); null when the kind has none. */
  slays: boolean[] | null;
  /** Curse powers indexed by curse index (1-based); null when none. */
  curses: number[] | null;
  dAttr: string;
  dChar: string;
  allocProb: number;
  allocMin: number;
  allocMax: number;
  level: number;
  activation: Activation | null;
  effect: EffectRecordJson[] | null;
  power: number;
  effectMsg: string;
  visMsg: string;
  time: RandomValue;
  charge: RandomValue;
  genMultProb: number;
  stackSize: RandomValue;
}

/** struct ego_item. */
export interface EgoItem {
  name: string;
  text: string;
  eidx: number;
  cost: number;
  flags: FlagSet;
  flagsOff: FlagSet;
  kindFlags: FlagSet;
  modifiers: RandomValue[];
  minModifiers: number[];
  elInfo: ElementInfo[];
  brands: boolean[] | null;
  slays: boolean[] | null;
  curses: number[] | null;
  rating: number;
  allocProb: number;
  allocMin: number;
  allocMax: number;
  /** kidx values this ego can be applied to (upstream poss_items list). */
  possItems: Set<number>;
  toH: RandomValue;
  toD: RandomValue;
  toA: RandomValue;
  minToH: number;
  minToD: number;
  minToA: number;
  activation: Activation | null;
  time: RandomValue;
}

/** struct artifact. */
export interface Artifact {
  name: string;
  text: string;
  aidx: number;
  tval: number;
  sval: number;
  toH: number;
  toD: number;
  toA: number;
  ac: number;
  dd: number;
  ds: number;
  weight: number;
  cost: number;
  flags: FlagSet;
  modifiers: number[];
  elInfo: ElementInfo[];
  brands: boolean[] | null;
  slays: boolean[] | null;
  curses: number[] | null;
  level: number;
  allocProb: number;
  allocMin: number;
  allocMax: number;
  activation: Activation | null;
  altMsg: string;
  time: RandomValue;
}

/**
 * The curse template object (upstream stores a full struct object; the
 * fields the parser can fill are kept, the rest of struct object is not
 * meaningful for a template).
 */
export interface CurseObject {
  /** Weight adjustment (weight: adj). */
  weight: number;
  toH: number;
  toD: number;
  toA: number;
  flags: FlagSet;
  /** Integer modifiers (curse values are plain ints upstream). */
  modifiers: number[];
  elInfo: ElementInfo[];
  effect: EffectRecordJson[] | null;
  effectMsg: string;
  time: RandomValue;
}

/** struct curse. */
export interface Curse {
  /** 1-based index in the curses array (matches upstream ordering). */
  index: number;
  name: string;
  /** Possible tvals, indexed by tval. */
  poss: boolean[];
  obj: CurseObject;
  /** "|name|name|" conflict string, or null. */
  conflict: string | null;
  conflictFlags: FlagSet;
  desc: string;
}

/** struct brand. */
export interface Brand {
  index: number;
  code: string;
  name: string;
  verb: string;
  /** RF_* monster race flag index, or 0. */
  resistFlag: number;
  vulnFlag: number;
  multiplier: number;
  oMultiplier: number;
  power: number;
}

/** struct slay. */
export interface Slay {
  index: number;
  code: string;
  name: string;
  /** Monster base name, or null. */
  base: string | null;
  meleeVerb: string;
  rangeVerb: string;
  /** RF_* monster race flag index, or 0. */
  raceFlag: number;
  multiplier: number;
  oMultiplier: number;
  power: number;
}

/** struct activation. */
export interface Activation {
  index: number;
  name: string;
  aim: boolean;
  level: number;
  power: number;
  effect: EffectRecordJson[] | null;
  message: string;
  desc: string;
}

/** struct obj_property. */
export interface ObjectProperty {
  /** 1-based position in the obj_properties array (file order). */
  index: number;
  /** OBJ_PROPERTY_* type. */
  type: number;
  /** OFT_* subtype (flags only). */
  subtype: number;
  /** OFID_* id type (flags only). */
  idType: number;
  /** Index of the property for its type (OF_/OBJ_MOD_/ELEM_ value). */
  propIndex: number;
  power: number;
  mult: number;
  /** Relative weight rating per tval. */
  typeMult: number[];
  name: string;
  adjective: string;
  negAdj: string;
  msg: string;
  desc: string;
}

/** struct flavor. */
export interface Flavor {
  fidx: number;
  tval: number;
  /** SV_UNKNOWN (0) for unassigned flavors. */
  sval: number;
  dAttr: string;
  dChar: string;
  text: string;
}
