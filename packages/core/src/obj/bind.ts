/**
 * Object registries: binding the compiled pack JSON into typed data,
 * ported from reference/src/obj-init.c (all the object-domain parsers and
 * their finish steps), datafile.c (grab_flag, grab_rand_value,
 * grab_int_value, grab_index_and_int, grab_int_range, grab_element_flag),
 * obj-tval.c (tval_find_idx), obj-util.c (lookup_kind, lookup_sval), and
 * obj-desc.c (obj_desc_name_format, used for sval name matching).
 *
 * Ordering follows upstream init_arrays: bases, slays, brands, curses,
 * objects, activations, egos, artifacts, properties, flavors. Faithful
 * index quirks are kept: kinds/egos are 0-based in file order
 * (kidx/eidx), artifacts and object properties are 1-based in file
 * order, while slays, brands, curses, and activations are 1-based in
 * REVERSE file order (upstream walks the prepended parse list from its
 * head while counting up).
 *
 * Sval assignment mirrors parse_object_type: each kind bumps its base's
 * num_svals as its type: line is bound, in file order, and takes that
 * count as its sval. Special artifacts whose base-object sval does not
 * exist get a dummy kind appended (write_dummy_object_record) with
 * KF_INSTA_ART, inheriting the base's flags; its level is 0 at creation
 * time because upstream reads art->level before the level: line has been
 * parsed.
 *
 * MODDABILITY (ratified pillar): every bind step is driven purely by the
 * record arrays passed in; appending extra records in the same compiled
 * shape (new kinds, egos, artifacts, curses, ...) binds them exactly like
 * pack data.
 */

import { FlagSet } from "../bitflag";
import { Dice } from "../dice";
import {
  ELEMENT_ENTRIES,
  KF,
  OBJECT_MODIFIER_ENTRIES,
  OF,
  RF,
  STAT_ENTRIES,
  TV,
  TVAL_ENTRIES,
} from "../generated";
import type { RandomValue } from "../rng";
import type {
  Activation,
  ActivationRecordJson,
  Artifact,
  ArtifactRecordJson,
  Brand,
  BrandRecordJson,
  Curse,
  CurseRecordJson,
  EffectRecordJson,
  EgoItem,
  EgoRecordJson,
  ElementInfo,
  Flavor,
  FlavorRecordJson,
  ObjectBase,
  ObjectBaseRecordJson,
  ObjectKind,
  ObjectKindRecordJson,
  ObjectProperty,
  ObjectPropertyRecordJson,
  ObjPackJson,
  Slay,
} from "./types";
import {
  EL_INFO_HATES,
  EL_INFO_IGNORE,
  ELEM_BASE_MIN,
  ELEM_HIGH_MIN,
  newElemInfo,
  newKfFlags,
  newModifiersRv,
  newOfFlags,
  NO_MINIMUM,
  OBJ_MOD_MAX,
  OBJ_PROPERTY,
  OFID,
  OFT,
  SV_UNKNOWN,
  TV_MAX,
  zeroRv,
} from "./types";

/* ------------------------------------------------------------------ */
/* Name tables (the C string arrays built from the list headers)        */
/* ------------------------------------------------------------------ */

/** obj_mods[]: the five stats then the object modifiers, index = value. */
export const OBJ_MOD_NAMES: readonly string[] = [
  ...STAT_ENTRIES.map((e) => e.name),
  ...OBJECT_MODIFIER_ENTRIES.map((e) => e.name),
];

/** element_names[]: index = ELEM value. */
export const ELEMENT_NAMES: readonly string[] = ELEMENT_ENTRIES.map(
  (e) => e.name,
);

/* ------------------------------------------------------------------ */
/* datafile.c helpers                                                   */
/* ------------------------------------------------------------------ */

/** dice string or plain number -> RandomValue (parser_getrand). */
export function parseRand(value: string | number | undefined): RandomValue {
  if (value === undefined) return zeroRv();
  if (typeof value === "number") {
    return { base: value, dice: 0, sides: 0, mBonus: 0 };
  }
  const dice = new Dice();
  if (!dice.parseString(value)) {
    throw new Error(`obj: invalid dice string "${value}"`);
  }
  return dice.randomValue();
}

/** grab_int_range with sep "to": "10 to 100" -> [10, 100]. */
export function grabIntRange(range: string): [number, number] {
  const m = /^\s*(-?\d+)\s+to\s+(-?\d+)\s*$/.exec(range);
  if (!m) throw new Error(`obj: invalid allocation range "${range}"`);
  return [Number(m[1]), Number(m[2])];
}

/**
 * find_value_arg for the "NAME[...]" syntax: returns the name and the
 * raw bracket text, or null when there is no bracket.
 */
function findValueArg(token: string): { name: string; arg: string } | null {
  const open = token.indexOf("[");
  if (open < 0) return null;
  const close = token.indexOf("]", open + 1);
  if (close < 0) return null;
  return { name: token.slice(0, open), arg: token.slice(open + 1, close) };
}

/**
 * grab_rand_value: "STR[1d2]" -> parse the bracket as dice and store its
 * random value at the name's index. Returns true when the name matched.
 */
export function grabRandValue(
  values: RandomValue[],
  names: readonly string[],
  token: string,
): boolean {
  const parsed = findValueArg(token);
  if (!parsed) throw new Error(`obj: invalid value "${token}"`);
  const i = names.indexOf(parsed.name);
  if (i < 0) return false;
  const dice = new Dice();
  if (!dice.parseString(parsed.arg)) {
    throw new Error(`obj: value "${token}" is not random`);
  }
  values[i] = dice.randomValue();
  return true;
}

/**
 * grab_int_value: "SPEED[10]" -> store the int at the name's index.
 * Returns true when the name matched.
 */
export function grabIntValue(
  values: number[],
  names: readonly string[],
  token: string,
): boolean {
  const parsed = findValueArg(token);
  if (!parsed) throw new Error(`obj: invalid value "${token}"`);
  const i = names.indexOf(parsed.name);
  if (i < 0) return false;
  const m = /^\s*([-+]?\d+)\s*$/.exec(parsed.arg);
  if (!m) throw new Error(`obj: invalid int value "${token}"`);
  values[i] = Number(m[1]);
  return true;
}

/**
 * grab_index_and_int with a prefix: "RES_ACID[1]" against element names
 * and prefix "RES_" -> { index, value }, or null when no name matches.
 */
export function grabIndexAndInt(
  names: readonly string[],
  prefix: string,
  token: string,
): { index: number; value: number } | null {
  const parsed = findValueArg(token);
  if (!parsed) return null;
  const m = /^\s*([-+]?\d+)\s*$/.exec(parsed.arg);
  if (!m) return null;
  for (let i = 0; i < names.length; i++) {
    if (prefix + (names[i] as string) === parsed.name) {
      return { index: i, value: Number(m[1]) };
    }
  }
  return null;
}

/**
 * grab_element_flag: "IGNORE_ACID" / "HATES_FIRE" -> set the EL_INFO
 * bit on the named element. Returns true when handled.
 */
export function grabElementFlag(
  elInfo: ElementInfo[],
  flagName: string,
): boolean {
  const under = flagName.indexOf("_");
  if (under < 0) return false;
  const prefix = flagName.slice(0, under);
  const suffix = flagName.slice(under + 1);
  const i = ELEMENT_NAMES.indexOf(suffix);
  if (i < 0) return false;
  const info = elInfo[i] as ElementInfo;
  if (prefix === "IGNORE") {
    info.flags |= EL_INFO_IGNORE;
    return true;
  }
  if (prefix === "HATES") {
    info.flags |= EL_INFO_HATES;
    return true;
  }
  return false;
}

/** grab_flag against a NAME -> value map; returns true when matched. */
function grabFlag(
  flags: FlagSet,
  table: Record<string, number>,
  name: string,
): boolean {
  const value = table[name];
  if (value === undefined || value === 0) return false;
  flags.on(value);
  return true;
}

/** Tokenize a flags/values line the way strtok(s, " |") does. */
function tokens(lines: string[] | undefined): string[] {
  if (!lines) return [];
  const out: string[] = [];
  for (const line of lines) {
    for (const tok of line.split(/[ |]+/)) {
      if (tok.length > 0) out.push(tok);
    }
  }
  return out;
}

/** string_append semantics: multi-line text concatenates directly. */
function joinLines(lines: string[] | undefined): string {
  return lines ? lines.join("") : "";
}

/* ------------------------------------------------------------------ */
/* obj-tval.c                                                           */
/* ------------------------------------------------------------------ */

/** de_armour: "armour" -> "armor", truncating anything after it. */
function deArmour(name: string): string {
  const at = name.indexOf("armour");
  if (at < 0) return name;
  return name.slice(0, at + 4) + "r";
}

/**
 * tval_find_idx: the numeric tval of a textual tval name (or a numeric
 * string), -1 when unknown.
 */
export function tvalFindIdx(name: string): number {
  const num = /^\s*(\d+)\s*$/.exec(name);
  if (num) {
    const r = Number(num[1]);
    return r < TV_MAX ? r : -1;
  }
  const mod = deArmour(name).toLowerCase();
  for (let i = 0; i < TVAL_ENTRIES.length; i++) {
    if ((TVAL_ENTRIES[i] as { textName: string }).textName === mod) return i;
  }
  return -1;
}

/** tval_find_name: textual name for a numeric tval. */
export function tvalFindName(tval: number): string {
  const e = TVAL_ENTRIES[tval];
  return e ? e.textName : "unknown";
}

/* ------------------------------------------------------------------ */
/* obj-desc.c name formatting (for lookup_sval)                         */
/* ------------------------------------------------------------------ */

/**
 * obj_desc_name_format with a null modstr: strips '&' (and spaces after
 * it), drops '~' (singular), picks the singular side of "|sing|plur|".
 */
export function objDescNameFormat(fmt: string): string {
  let out = "";
  let i = 0;
  while (i < fmt.length) {
    const c = fmt[i] as string;
    if (c === "&") {
      while (fmt[i] === " " || fmt[i] === "&") i++;
      continue;
    } else if (c === "~") {
      i++;
      continue;
    } else if (c === "|") {
      const plural = fmt.indexOf("|", i + 1);
      const endmark = plural >= 0 ? fmt.indexOf("|", plural + 1) : -1;
      if (plural < 0 || endmark < 0) return out;
      out += fmt.slice(i + 1, plural);
      i = endmark + 1;
      continue;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The registry                                                         */
/* ------------------------------------------------------------------ */

function bindEffects(
  records: EffectRecordJson[] | undefined,
): EffectRecordJson[] | null {
  return records && records.length > 0 ? records : null;
}

/**
 * All object-domain registries, bound from the compiled pack JSON.
 *
 * Arrays with 1-based upstream indexing (slays, brands, curses,
 * activations, artifacts, properties) keep a null at index 0.
 */
export class ObjRegistry {
  /** kb_info: bases indexed by tval (missing tvals get a default base). */
  readonly bases: ObjectBase[] = [];
  /** k_info in kidx order; ordinary kinds then INSTA_ART dummies. */
  readonly kinds: ObjectKind[] = [];
  /** Count of ordinary kinds (before artifact dummy kinds). */
  ordinaryKindCount = 0;
  /** e_info in eidx order. */
  readonly egos: EgoItem[] = [];
  /** a_info, 1-based (index 0 is null). */
  readonly artifacts: (Artifact | null)[] = [null];
  /** curses, 1-based, reverse file order (upstream quirk). */
  readonly curses: (Curse | null)[] = [null];
  /** brands, 1-based, reverse file order (upstream quirk). */
  readonly brands: (Brand | null)[] = [null];
  /** slays, 1-based, reverse file order (upstream quirk). */
  readonly slays: (Slay | null)[] = [null];
  /** activations, 1-based, reverse file order (upstream quirk). */
  readonly activations: (Activation | null)[] = [null];
  /** obj_properties, 1-based, file order. */
  readonly properties: (ObjectProperty | null)[] = [null];
  /** Flat flavor list in file order. */
  readonly flavors: Flavor[] = [];

  /* The generic object kinds resolved by finish_parse_artifact. */
  unknownItemKind: ObjectKind | null = null;
  unknownGoldKind: ObjectKind | null = null;
  pileKind: ObjectKind | null = null;
  curseObjectKind: ObjectKind | null = null;

  /** z_info->brand_max (array length including the null slot). */
  get brandMax(): number {
    return this.brands.length;
  }

  /** z_info->slay_max. */
  get slayMax(): number {
    return this.slays.length;
  }

  /** z_info->curse_max. */
  get curseMax(): number {
    return this.curses.length;
  }

  constructor(pack: ObjPackJson) {
    /* Upstream init_arrays order: bases, slays, brands, curses,
     * objects, activations, egos, artifacts, properties, flavors. */
    this.bindBases(pack.objectBase.records, pack.objectBase.header);
    this.bindSlays(pack.slay.records);
    this.bindBrands(pack.brand.records);
    this.bindCurses(pack.curse.records);
    this.bindKinds(pack.object.records);
    this.bindActivations(pack.activation.records);
    this.bindEgos(pack.egoItem.records);
    this.bindArtifacts(pack.artifact.records);
    this.bindProperties(pack.objectProperty.records);
    this.bindFlavors(pack.flavor.records);
    this.finish();
  }

  /* -------------------------------------------------------------- */

  /** lookup_kind: kind by tval and sval, or null. */
  lookupKind(tval: number, sval: number): ObjectKind | null {
    for (const kind of this.kinds) {
      if (kind.tval === tval && kind.sval === sval) return kind;
    }
    return null;
  }

  /** objkind_byid. */
  kindByIdx(kidx: number): ObjectKind | null {
    return this.kinds[kidx] ?? null;
  }

  /**
   * lookup_sval: sval of the kind whose formatted name matches (case
   * insensitively), or a numeric string passed through; -1 when unknown.
   */
  lookupSval(tval: number, name: string): number {
    const num = /^\s*(\d+)\s*$/.exec(name);
    if (num) return Number(num[1]);
    const wanted = name.toLowerCase();
    for (const kind of this.kinds) {
      if (kind.tval !== tval || !kind.name) continue;
      if (objDescNameFormat(kind.name).toLowerCase() === wanted) {
        return kind.sval;
      }
    }
    return -1;
  }

  /** lookup_curse: 1-based curse index by name, or 0. */
  lookupCurse(name: string): number {
    for (let i = 1; i < this.curses.length; i++) {
      if ((this.curses[i] as Curse).name === name) return i;
    }
    return 0;
  }

  /** Brand index by code, or 0. */
  lookupBrand(code: string): number {
    for (let i = 1; i < this.brands.length; i++) {
      if ((this.brands[i] as Brand).code === code) return i;
    }
    return 0;
  }

  /** Slay index by code, or 0. */
  lookupSlay(code: string): number {
    for (let i = 1; i < this.slays.length; i++) {
      if ((this.slays[i] as Slay).code === code) return i;
    }
    return 0;
  }

  /** findact: activation by name, or null. */
  findActivation(name: string): Activation | null {
    for (let i = 1; i < this.activations.length; i++) {
      const act = this.activations[i] as Activation;
      if (act.name === name) return act;
    }
    return null;
  }

  /** Ego by exact name, or null (test/mod convenience). */
  findEgo(name: string): EgoItem | null {
    for (const ego of this.egos) {
      if (ego.name === name) return ego;
    }
    return null;
  }

  /** Artifact by exact name, or null (test/mod convenience). */
  findArtifact(name: string): Artifact | null {
    for (let i = 1; i < this.artifacts.length; i++) {
      const art = this.artifacts[i] as Artifact;
      if (art.name === name) return art;
    }
    return null;
  }

  /* -------------------------------------------------------------- */
  /* Binding                                                          */
  /* -------------------------------------------------------------- */

  private bindBases(
    records: ObjectBaseRecordJson[],
    header: { default?: Array<{ label: string; value: number }> } | undefined,
  ): void {
    let defBreak = 0;
    let defMaxStack = 0;
    for (const { label, value } of header?.default ?? []) {
      if (label === "break-chance") defBreak = value;
      else if (label === "max-stack") defMaxStack = value;
      else throw new Error(`object_base: unknown default ${label}`);
    }
    /* kb_info is mem_zalloc'd for every tval; unlisted tvals stay
     * zeroed (name "", flags empty, max_stack 0). */
    for (let tval = 0; tval < TV_MAX; tval++) {
      this.bases.push({
        name: "",
        tval,
        attr: "",
        flags: newOfFlags(),
        kindFlags: newKfFlags(),
        elInfo: newElemInfo(),
        breakPerc: 0,
        maxStack: 0,
        numSvals: 0,
      });
    }
    for (const rec of records) {
      const tval = tvalFindIdx(rec.name.tval);
      if (tval < 0) {
        throw new Error(`object_base: unknown tval ${rec.name.tval}`);
      }
      const base = this.bases[tval] as ObjectBase;
      base.name = rec.name.name ?? "";
      base.attr = rec.graphics ?? "";
      base.breakPerc = rec.break ?? defBreak;
      base.maxStack = rec["max-stack"] ?? defMaxStack;
      for (const tok of tokens(rec.flags)) {
        const found =
          grabFlag(base.flags, OF, tok) ||
          grabFlag(base.kindFlags, KF, tok) ||
          grabElementFlag(base.elInfo, tok);
        if (!found) throw new Error(`object_base: invalid flag ${tok}`);
      }
    }
  }

  private bindSlays(records: SlayRecordJsonArray): void {
    /* finish_parse_slay walks the prepended list: index 1 is the LAST
     * record in the file. */
    for (let r = records.length - 1; r >= 0; r--) {
      const rec = records[r] as (typeof records)[number];
      const raceFlag = rec["race-flag"]
        ? ((RF as Record<string, number>)[rec["race-flag"]] ?? -1)
        : 0;
      if (raceFlag < 0) {
        throw new Error(`slay: invalid race flag ${rec["race-flag"]}`);
      }
      this.slays.push({
        index: this.slays.length,
        code: rec.code,
        name: rec.name ?? "",
        base: rec.base ?? null,
        meleeVerb: rec["melee-verb"] ?? "",
        rangeVerb: rec["range-verb"] ?? "",
        raceFlag,
        multiplier: rec.multiplier ?? 0,
        oMultiplier: rec["o-multiplier"] ?? 0,
        power: rec.power ?? 0,
      });
    }
  }

  private bindBrands(records: BrandRecordJson[]): void {
    for (let r = records.length - 1; r >= 0; r--) {
      const rec = records[r] as BrandRecordJson;
      const resolve = (name: string | undefined): number => {
        if (!name) return 0;
        const value = (RF as Record<string, number>)[name];
        if (value === undefined) {
          throw new Error(`brand: invalid race flag ${name}`);
        }
        return value;
      };
      this.brands.push({
        index: this.brands.length,
        code: rec.code,
        name: rec.name ?? "",
        verb: rec.verb ?? "",
        resistFlag: resolve(rec["resist-flag"]),
        vulnFlag: resolve(rec["vuln-flag"]),
        multiplier: rec.multiplier ?? 0,
        oMultiplier: rec["o-multiplier"] ?? 0,
        power: rec.power ?? 0,
      });
    }
  }

  private bindCurses(records: CurseRecordJson[]): void {
    for (let r = records.length - 1; r >= 0; r--) {
      const rec = records[r] as CurseRecordJson;
      const poss: boolean[] = new Array<boolean>(TV_MAX).fill(false);
      for (const tvalName of rec.type ?? []) {
        const tval = tvalFindIdx(tvalName);
        if (tval < 0 || tval >= TV_MAX) {
          throw new Error(`curse: unknown tval ${tvalName}`);
        }
        poss[tval] = true;
      }
      const objFlags = newOfFlags();
      const elInfo = newElemInfo();
      for (const tok of tokens(rec.flags)) {
        const found =
          grabFlag(objFlags, OF, tok) || grabElementFlag(elInfo, tok);
        if (!found) throw new Error(`curse: invalid flag ${tok}`);
      }
      const modifiers = new Array<number>(OBJ_MOD_MAX).fill(0);
      for (const tok of tokens(rec.values)) {
        let found = false;
        const mod = grabIndexAndInt(OBJ_MOD_NAMES, "", tok);
        if (mod) {
          modifiers[mod.index] = mod.value;
          found = true;
        }
        const res = grabIndexAndInt(ELEMENT_NAMES, "RES_", tok);
        if (res) {
          (elInfo[res.index] as ElementInfo).resLevel = res.value;
          found = true;
        }
        if (!found) throw new Error(`curse: invalid value ${tok}`);
      }
      const conflictFlags = newOfFlags();
      for (const tok of tokens(rec["conflict-flags"])) {
        if (!grabFlag(conflictFlags, OF, tok)) {
          throw new Error(`curse: invalid conflict flag ${tok}`);
        }
      }
      /* parse_curse_conflict wraps every name in pipes. */
      let conflict: string | null = null;
      for (const name of rec.conflict ?? []) {
        conflict = (conflict ?? "") + "|" + name + "|";
      }
      this.curses.push({
        index: this.curses.length,
        name: rec.name,
        poss,
        obj: {
          weight: rec.weight ?? 0,
          toH: rec.combat?.["to-h"] ?? 0,
          toD: rec.combat?.["to-d"] ?? 0,
          toA: rec.combat?.["to-a"] ?? 0,
          flags: objFlags,
          modifiers,
          elInfo,
          effect: bindEffects(rec.effect),
          effectMsg: joinLines(rec.msg),
          time: parseRand(rec.time),
        },
        conflict,
        conflictFlags,
        desc: joinLines(rec.desc),
      });
    }
  }

  private bindKinds(records: ObjectKindRecordJson[]): void {
    for (const rec of records) {
      const tval = tvalFindIdx(rec.type);
      if (tval < 0) throw new Error(`object: unknown tval ${rec.type}`);
      const base = this.bases[tval] as ObjectBase;
      base.numSvals++;
      const flags = newOfFlags();
      const kindFlags = newKfFlags();
      const elInfo = newElemInfo();
      for (const tok of tokens(rec.flags)) {
        const found =
          grabFlag(flags, OF, tok) ||
          grabFlag(kindFlags, KF, tok) ||
          grabElementFlag(elInfo, tok);
        if (!found) throw new Error(`object: invalid flag ${tok}`);
      }
      const modifiers = newModifiersRv();
      for (const tok of tokens(rec.values)) {
        let found = false;
        if (grabRandValue(modifiers, OBJ_MOD_NAMES, tok)) found = true;
        const res = grabIndexAndInt(ELEMENT_NAMES, "RES_", tok);
        if (res) {
          (elInfo[res.index] as ElementInfo).resLevel = res.value;
          found = true;
        }
        if (!found) throw new Error(`object: invalid value ${tok}`);
      }
      const hd = parseRand(rec.attack?.hd);
      const pile = rec.pile?.[0];
      const kind: ObjectKind = {
        name: rec.name,
        text: joinLines(rec.desc),
        base,
        kidx: this.kinds.length,
        tval,
        sval: base.numSvals,
        pval: parseRand(rec.pval),
        toH: parseRand(rec.attack?.["to-h"]),
        toD: parseRand(rec.attack?.["to-d"]),
        toA: parseRand(rec.armor?.["to-a"]),
        ac: rec.armor?.ac ?? 0,
        dd: hd.dice,
        ds: hd.sides,
        weight: rec.weight ?? 0,
        cost: rec.cost ?? 0,
        flags,
        kindFlags,
        modifiers,
        elInfo,
        brands: this.bindBrandList(rec.brand, "object"),
        slays: this.bindSlayList(rec.slay, "object"),
        curses: this.bindCurseList(rec.curse, "object"),
        dAttr: rec.graphics?.color ?? "",
        dChar: rec.graphics?.glyph ?? "",
        allocProb: rec.alloc?.common ?? 0,
        allocMin: 0,
        allocMax: 0,
        level: rec.level ?? 0,
        activation: null,
        effect: bindEffects(rec.effect),
        power: rec.power ?? 0,
        effectMsg: joinLines(rec.msg),
        visMsg: joinLines(rec["vis-msg"]),
        time: parseRand(rec.time),
        charge: parseRand(rec.charges),
        genMultProb: pile?.prob ?? 0,
        stackSize: parseRand(pile?.stack),
      };
      if (rec.alloc) {
        const [amin, amax] = grabIntRange(rec.alloc.minmax);
        kind.allocMin = amin;
        kind.allocMax = amax;
      }
      this.kinds.push(kind);
    }
    this.ordinaryKindCount = this.kinds.length;
  }

  private bindBrandList(
    codes: string[] | undefined,
    what: string,
  ): boolean[] | null {
    if (!codes || codes.length === 0) return null;
    const out = new Array<boolean>(this.brands.length).fill(false);
    for (const code of codes) {
      const i = this.lookupBrand(code);
      if (i === 0) throw new Error(`${what}: unrecognised brand ${code}`);
      out[i] = true;
    }
    return out;
  }

  private bindSlayList(
    codes: string[] | undefined,
    what: string,
  ): boolean[] | null {
    if (!codes || codes.length === 0) return null;
    const out = new Array<boolean>(this.slays.length).fill(false);
    for (const code of codes) {
      const i = this.lookupSlay(code);
      if (i === 0) throw new Error(`${what}: unrecognised slay ${code}`);
      out[i] = true;
    }
    return out;
  }

  private bindCurseList(
    entries: Array<{ name: string; power: number }> | undefined,
    what: string,
  ): number[] | null {
    if (!entries || entries.length === 0) return null;
    let out: number[] | null = null;
    for (const { name, power } of entries) {
      const i = this.lookupCurse(name);
      if (i === 0) throw new Error(`${what}: unrecognised curse ${name}`);
      /* Only add if it has power (upstream). */
      if (power > 0) {
        if (!out) out = new Array<number>(this.curses.length).fill(0);
        out[i] = power;
      }
    }
    return out;
  }

  private bindActivations(records: ActivationRecordJson[]): void {
    /* Reverse file order, as finish_parse_act. */
    for (let r = records.length - 1; r >= 0; r--) {
      const rec = records[r] as ActivationRecordJson;
      this.activations.push({
        index: this.activations.length,
        name: rec.name,
        aim: (rec.aim ?? 0) !== 0,
        level: rec.level ?? 0,
        power: rec.power ?? 0,
        effect: bindEffects(rec.effect),
        message: joinLines(rec.msg),
        desc: joinLines(rec.desc),
      });
    }
  }

  private bindEgos(records: EgoRecordJson[]): void {
    for (const rec of records) {
      const flags = newOfFlags();
      const flagsOff = newOfFlags();
      const kindFlags = newKfFlags();
      const elInfo = newElemInfo();
      for (const tok of tokens(rec.flags)) {
        const found =
          grabFlag(flags, OF, tok) ||
          grabFlag(kindFlags, KF, tok) ||
          grabElementFlag(elInfo, tok);
        if (!found) throw new Error(`ego: invalid flag ${tok}`);
      }
      for (const tok of tokens(rec["flags-off"])) {
        if (!grabFlag(flagsOff, OF, tok)) {
          throw new Error(`ego: invalid flag-off ${tok}`);
        }
      }
      const modifiers = newModifiersRv();
      for (const tok of tokens(rec.values)) {
        let found = false;
        if (grabRandValue(modifiers, OBJ_MOD_NAMES, tok)) found = true;
        const res = grabIndexAndInt(ELEMENT_NAMES, "RES_", tok);
        if (res) {
          (elInfo[res.index] as ElementInfo).resLevel = res.value;
          found = true;
        }
        if (!found) throw new Error(`ego: invalid value ${tok}`);
      }
      const minModifiers = new Array<number>(OBJ_MOD_MAX).fill(0);
      for (const tok of tokens(rec["min-values"])) {
        if (!grabIntValue(minModifiers, OBJ_MOD_NAMES, tok)) {
          throw new Error(`ego: invalid min-value ${tok}`);
        }
      }
      const possItems = new Set<number>();
      for (const tvalName of rec.type ?? []) {
        const tval = tvalFindIdx(tvalName);
        if (tval < 0) throw new Error(`ego: unknown tval ${tvalName}`);
        let foundOne = false;
        for (const kind of this.kinds) {
          if (kind.tval === tval) {
            possItems.add(kind.kidx);
            foundOne = true;
          }
        }
        if (!foundOne) {
          throw new Error(`ego: no kind for ego type ${tvalName}`);
        }
      }
      for (const item of rec.item ?? []) {
        const tval = tvalFindIdx(item.tval);
        if (tval < 0) throw new Error(`ego: unknown tval ${item.tval}`);
        const sval = this.lookupSval(tval, item.sval);
        if (sval < 0) throw new Error(`ego: unknown sval ${item.sval}`);
        const kind = this.lookupKind(tval, sval);
        if (!kind || kind.kidx <= 0) {
          throw new Error(`ego: invalid item ${item.tval}:${item.sval}`);
        }
        possItems.add(kind.kidx);
      }
      const ego: EgoItem = {
        name: rec.name,
        text: joinLines(rec.desc),
        eidx: this.egos.length,
        cost: rec.info?.cost ?? 0,
        flags,
        flagsOff,
        kindFlags,
        modifiers,
        minModifiers,
        elInfo,
        brands: this.bindBrandList(rec.brand, "ego"),
        slays: this.bindSlayList(rec.slay, "ego"),
        curses: this.bindCurseList(rec.curse, "ego"),
        rating: rec.info?.rating ?? 0,
        allocProb: rec.alloc?.common ?? 0,
        allocMin: 0,
        allocMax: 0,
        possItems,
        toH: parseRand(rec.combat?.th),
        toD: parseRand(rec.combat?.td),
        toA: parseRand(rec.combat?.ta),
        minToH: rec["min-combat"]?.th ?? NO_MINIMUM,
        minToD: rec["min-combat"]?.td ?? NO_MINIMUM,
        minToA: rec["min-combat"]?.ta ?? NO_MINIMUM,
        activation: rec.act ? this.findActivation(rec.act) : null,
        time: parseRand(rec.time),
      };
      if (rec.alloc) {
        const [amin, amax] = grabIntRange(rec.alloc.minmax);
        if (amin > 255 || amax > 255 || amin < 0 || amax < 0) {
          throw new Error(`ego: allocation out of bounds ${rec.alloc.minmax}`);
        }
        ego.allocMin = amin;
        ego.allocMax = amax;
      }
      this.egos.push(ego);
    }
  }

  /**
   * write_dummy_object_record: append an INSTA_ART kind for a special
   * artifact base object that has no ordinary kind.
   */
  private writeDummyObjectRecord(tval: number, svalName: string): ObjectKind {
    const base = this.bases[tval] as ObjectBase;
    base.numSvals++;
    const dummy: ObjectKind = {
      name: `& ${svalName}~`,
      text: "",
      base,
      kidx: this.kinds.length,
      tval,
      sval: base.numSvals,
      pval: zeroRv(),
      toH: zeroRv(),
      toD: zeroRv(),
      toA: zeroRv(),
      ac: 0,
      dd: 0,
      ds: 0,
      weight: 0,
      cost: 0,
      /* Inherit the flags and element info of the tval. */
      flags: base.flags.clone(),
      kindFlags: base.kindFlags.clone(),
      modifiers: newModifiersRv(),
      elInfo: base.elInfo.map((e) => ({ resLevel: e.resLevel, flags: e.flags })),
      brands: null,
      slays: null,
      curses: null,
      /* Default colours, meant to be overwritten by graphics:. */
      dAttr: "Red",
      dChar: "*",
      allocProb: 0,
      allocMin: 0,
      allocMax: 0,
      /* Upstream copies art->level before level: is parsed, so 0. */
      level: 0,
      activation: null,
      effect: null,
      power: 0,
      effectMsg: "",
      visMsg: "",
      time: zeroRv(),
      charge: zeroRv(),
      genMultProb: 0,
      stackSize: zeroRv(),
    };
    dummy.kindFlags.on(KF.INSTA_ART);
    this.kinds.push(dummy);
    return dummy;
  }

  private bindArtifacts(records: ArtifactRecordJson[]): void {
    for (const rec of records) {
      const elInfo = newElemInfo();
      /* parse_artifact_name: ignore all base elements. */
      for (let i = ELEM_BASE_MIN; i < ELEM_HIGH_MIN; i++) {
        (elInfo[i] as ElementInfo).flags |= EL_INFO_IGNORE;
      }
      const tval = tvalFindIdx(rec["base-object"].tval);
      if (tval < 0) {
        throw new Error(`artifact: unknown tval ${rec["base-object"].tval}`);
      }
      let sval = this.lookupSval(tval, rec["base-object"].sval);
      if (sval < 0) {
        sval = this.writeDummyObjectRecord(tval, rec["base-object"].sval).sval;
      }
      const kind = this.lookupKind(tval, sval);
      if (!kind) {
        throw new Error(
          `artifact: no kind ${rec["base-object"].tval}:${sval}`,
        );
      }
      const flags = newOfFlags();
      for (const tok of tokens(rec.flags)) {
        const found = grabFlag(flags, OF, tok) || grabElementFlag(elInfo, tok);
        if (!found) throw new Error(`artifact: invalid flag ${tok}`);
      }
      const modifiers = new Array<number>(OBJ_MOD_MAX).fill(0);
      for (const tok of tokens(rec.values)) {
        let found = false;
        if (grabIntValue(modifiers, OBJ_MOD_NAMES, tok)) found = true;
        const res = grabIndexAndInt(ELEMENT_NAMES, "RES_", tok);
        if (res) {
          (elInfo[res.index] as ElementInfo).resLevel = res.value;
          found = true;
        }
        if (!found) throw new Error(`artifact: invalid value ${tok}`);
      }
      const special = kind.kidx >= this.ordinaryKindCount;
      if (rec.graphics) {
        /* Only special (INSTA_ART) artifacts may set kind graphics. */
        if (!kind.kindFlags.has(KF.INSTA_ART)) {
          throw new Error(`artifact: ${rec.name} is not a special artifact`);
        }
        kind.dChar = rec.graphics.glyph;
        kind.dAttr = rec.graphics.color;
      }
      const weight = rec.weight ?? 0;
      const cost = rec.cost ?? 0;
      if (special) {
        kind.weight = weight;
        kind.cost = cost;
      }
      const hd = parseRand(rec.attack?.hd);
      let activation: Activation | null = null;
      let time = zeroRv();
      if (rec.act) {
        const act = this.findActivation(rec.act);
        /* Special light activations belong to the base object. */
        if (tval === TV.LIGHT && special) {
          kind.activation = act;
          kind.time = parseRand(rec.time);
        } else {
          activation = act;
          time = parseRand(rec.time);
        }
      }
      const art: Artifact = {
        name: rec.name,
        text: joinLines(rec.desc),
        aidx: this.artifacts.length,
        tval,
        sval,
        toH: rec.attack?.["to-h"] ?? 0,
        toD: rec.attack?.["to-d"] ?? 0,
        toA: rec.armor?.["to-a"] ?? 0,
        ac: rec.armor?.ac ?? 0,
        dd: hd.dice,
        ds: hd.sides,
        weight,
        cost,
        flags,
        modifiers,
        elInfo,
        brands: this.bindBrandList(rec.brand, "artifact"),
        slays: this.bindSlayList(rec.slay, "artifact"),
        curses: this.bindCurseList(rec.curse, "artifact"),
        level: rec.level ?? 0,
        allocProb: rec.alloc?.common ?? 0,
        allocMin: 0,
        allocMax: 0,
        activation,
        altMsg: joinLines(rec.msg),
        time,
      };
      if (rec.alloc) {
        const [amin, amax] = grabIntRange(rec.alloc.minmax);
        if (amin > 255 || amax > 255 || amin < 0 || amax < 0) {
          throw new Error(
            `artifact: allocation out of bounds ${rec.alloc.minmax}`,
          );
        }
        art.allocMin = amin;
        art.allocMax = amax;
      }
      this.artifacts.push(art);
    }
  }

  private bindProperties(records: ObjectPropertyRecordJson[]): void {
    const TYPE_NAMES: Record<string, number> = {
      stat: OBJ_PROPERTY.STAT,
      mod: OBJ_PROPERTY.MOD,
      flag: OBJ_PROPERTY.FLAG,
      ignore: OBJ_PROPERTY.IGNORE,
      resistance: OBJ_PROPERTY.RESIST,
      vulnerability: OBJ_PROPERTY.VULN,
      immunity: OBJ_PROPERTY.IMM,
    };
    const SUBTYPE_NAMES: Record<string, number> = {
      sustain: OFT.SUST,
      protection: OFT.PROT,
      "misc ability": OFT.MISC,
      light: OFT.LIGHT,
      melee: OFT.MELEE,
      bad: OFT.BAD,
      dig: OFT.DIG,
      throw: OFT.THROW,
      "curse-only": OFT.CURSE_ONLY,
    };
    const ID_NAMES: Record<string, number> = {
      "on effect": OFID.NORMAL,
      timed: OFID.TIMED,
      "on wield": OFID.WIELD,
    };
    /* finish_parse_object_property: 1-based, file order. */
    for (const rec of records) {
      const type = rec.type !== undefined ? TYPE_NAMES[rec.type] : undefined;
      if (rec.type !== undefined && type === undefined) {
        throw new Error(`object_property: invalid type ${rec.type}`);
      }
      const subtype =
        rec.subtype !== undefined ? SUBTYPE_NAMES[rec.subtype] : undefined;
      if (rec.subtype !== undefined && subtype === undefined) {
        throw new Error(`object_property: invalid subtype ${rec.subtype}`);
      }
      const idType =
        rec["id-type"] !== undefined ? ID_NAMES[rec["id-type"]] : undefined;
      if (rec["id-type"] !== undefined && idType === undefined) {
        throw new Error(`object_property: invalid id-type ${rec["id-type"]}`);
      }
      let propIndex = 0;
      if (rec.code !== undefined) {
        const t = type ?? OBJ_PROPERTY.NONE;
        let idx = -1;
        if (t === OBJ_PROPERTY.STAT || t === OBJ_PROPERTY.MOD) {
          idx = OBJ_MOD_NAMES.indexOf(rec.code);
        } else if (t === OBJ_PROPERTY.FLAG) {
          const v = (OF as Record<string, number>)[rec.code];
          idx = v === undefined ? -1 : v;
        } else if (
          t === OBJ_PROPERTY.IGNORE ||
          t === OBJ_PROPERTY.RESIST ||
          t === OBJ_PROPERTY.VULN ||
          t === OBJ_PROPERTY.IMM
        ) {
          idx = ELEMENT_NAMES.indexOf(rec.code);
        }
        if (idx < 0) {
          throw new Error(`object_property: invalid code ${rec.code}`);
        }
        propIndex = idx;
      }
      const typeMult = new Array<number>(TV_MAX).fill(1);
      for (const { type: tvalName, mult } of rec["type-mult"] ?? []) {
        const tval = tvalFindIdx(tvalName);
        if (tval < 0) {
          throw new Error(`object_property: unknown tval ${tvalName}`);
        }
        typeMult[tval] = mult;
      }
      this.properties.push({
        index: this.properties.length,
        type: type ?? OBJ_PROPERTY.NONE,
        subtype: subtype ?? OFT.NONE,
        idType: idType ?? OFID.NONE,
        propIndex,
        power: rec.power ?? 0,
        mult: rec.mult ?? 0,
        typeMult,
        name: rec.name,
        adjective: rec.adjective ?? "",
        negAdj: rec["neg-adjective"] ?? "",
        msg: rec.msg ?? "",
        desc: rec.desc ?? "",
      });
    }
  }

  private bindFlavors(records: FlavorRecordJson[]): void {
    for (const rec of records) {
      const tval = tvalFindIdx(rec.kind.tval);
      if (tval <= 0) throw new Error(`flavor: unknown tval ${rec.kind.tval}`);
      const bindEntry = (entry: {
        index: number;
        sval?: string;
        attr: string;
        desc?: string;
      }): void => {
        let sval = SV_UNKNOWN;
        if (entry.sval !== undefined) {
          sval = this.lookupSval(tval, entry.sval);
        }
        this.flavors.push({
          fidx: entry.index,
          tval,
          sval,
          dAttr: entry.attr,
          dChar: rec.kind.glyph,
          text: entry.desc ?? "",
        });
      };
      for (const entry of rec.flavor ?? []) bindEntry(entry);
      for (const entry of rec.fixed ?? []) bindEntry(entry);
    }
  }

  private finish(): void {
    /* finish_parse_object: add base kind flags to kind kind flags.
     * (Dummy artifact kinds already copied the base's kind flags.) */
    for (const kind of this.kinds) {
      kind.kindFlags.union(kind.base.kindFlags);
    }
    /* finish_parse_artifact: resolve the object-like kinds. */
    const none = tvalFindIdx("none");
    const kindOrNull = (name: string): ObjectKind | null => {
      const sval = this.lookupSval(none, name);
      return sval < 0 ? null : this.lookupKind(none, sval);
    };
    this.unknownItemKind = kindOrNull("<unknown item>");
    this.unknownGoldKind = kindOrNull("<unknown treasure>");
    this.pileKind = kindOrNull("<pile>");
    this.curseObjectKind = kindOrNull("<curse object>");
    /* write_curse_kinds: curse template objects reference the curse
     * object kind; the known-object side is part of the deferred
     * knowledge system. */
  }
}

type SlayRecordJsonArray = ObjPackJson["slay"]["records"];

/** Assemble the ObjPackJson bundle from individually parsed pack files. */
export function objPackFromJson(parts: {
  objectBase: unknown;
  object: unknown;
  egoItem: unknown;
  artifact: unknown;
  curse: unknown;
  brand: unknown;
  slay: unknown;
  activation: unknown;
  objectProperty: unknown;
  flavor: unknown;
}): ObjPackJson {
  return parts as unknown as ObjPackJson;
}
