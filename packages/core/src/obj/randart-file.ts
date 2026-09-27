/**
 * randart.txt (obj-randart.c:3061-3167, PORT_TODO 5.5) - the optional data
 * file do_randart writes alongside randart.log when its `create_file` argument
 * is true.
 *
 * WHAT IT IS FOR. randart.txt is a real artifact.txt: a player who rolls a set
 * they like can read exactly what they got, and the file is in the grammar the
 * parser already reads, so it can be diffed against the standard set or handed
 * to a mod. That is why it is a separate file from randart.log rather than
 * another section of it.
 *
 * WHAT DIFFERS FROM THE C, and why:
 *
 * - Upstream reuses the `log_file` global as the handle, having just closed
 *   randart.log with it. Nothing is shared but the variable, so the port keeps
 *   the two files properly apart and this module never touches the log sink.
 * - The C writes line by line through file_putf. HostIo.write is a whole-file
 *   call, so this returns the document as a string and do_randart writes once.
 * - `graphics:` needs the kind's display char and attr. Upstream converts a
 *   wide char with text_wctomb and an attr index with attr_to_text; the port
 *   already stores both as strings on ObjectKind, so the conversion has no
 *   counterpart and the values go out directly.
 */
import { parseDocument, randartFormat, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";
import type { Infer } from "@rpgm-tools/neo-angband-mod-sdk";
import { ELEMENT_ENTRIES, OBJECT_FLAG_ENTRIES, OBJECT_MODIFIER_ENTRIES, STAT_ENTRIES } from "../generated/index.js";
import { HostDir } from "../host/io.js";
import type { HostIo } from "../host/io.js";
import type { ObjRegistry } from "./bind.js";
import { objectShortName, tvalFindName } from "./bind.js";
import { OF_SIZE } from "./types.js";
import type { Artifact } from "./types.js";

/** randart.json, in ANGBAND_DIR_USER. */
export const RANDART_JSON = "randart.json";
/** The text export an older build wrote. Read once, then removed. */
export const RANDART_TXT = "randart.txt";

type RandartData = Infer<(typeof randartFormat)["validator"]>;
type RandartRecord = RandartData["artifacts"][number];

const MOD_NAMES: readonly string[] = [
  ...STAT_ENTRIES.map((entry) => entry.name),
  ...OBJECT_MODIFIER_ENTRIES.map((entry) => entry.name),
];

/**
 * The obj_flags[] table write_randart_entry builds inline: "NONE" at index 0,
 * then list-object-flags.h in order. Index 0 is the sentinel OF_NONE, which is
 * never set, so its name is only ever a placeholder that keeps the rest aligned.
 */
const OBJ_FLAG_NAMES: readonly string[] = [
  "NONE",
  ...OBJECT_FLAG_ENTRIES.map((e) => e.name),
];

/**
 * do_randart's `create_file` block (obj-randart.c:3195-3215): the seed header
 * followed by every artifact's entry, from index 1.
 *
 * The seed is written as C's `%08lx` - lower-case hex, zero-padded to eight
 * digits - so the file names the seed that produced it and a player can
 * reproduce the set.
 */
function flagNames(art: Artifact): string[] {
  const out: string[] = [];
  for (let flag = art.flags.next(1); flag > 0 && flag < OF_SIZE * 8; flag = art.flags.next(flag + 1)) {
    const name = OBJ_FLAG_NAMES[flag];
    if (name === undefined || name.length === 0) break;
    out.push(name);
  }
  return out;
}

function randartRecord(reg: ObjRegistry, art: Artifact): RandartRecord | null {
  if (!art.name) return null;
  const kind = reg.lookupKind(art.tval, art.sval);
  const modifiers: NonNullable<RandartRecord["modifiers"]> = [];
  for (let i = 0; i < MOD_NAMES.length; i++) {
    const value = art.modifiers[i] ?? 0;
    const name = MOD_NAMES[i];
    if (value !== 0 && name !== undefined && name.length > 0) modifiers.push({ name, value });
  }
  const elements: NonNullable<RandartRecord["elements"]> = [];
  for (let i = 0; i < ELEMENT_ENTRIES.length; i++) {
    const level = art.elInfo[i]?.resLevel ?? 0;
    const name = ELEMENT_ENTRIES[i]?.name;
    if (level !== 0 && name !== undefined && name.length > 0) elements.push({ name, level });
  }
  const slays: string[] = [];
  if (art.slays) {
    for (let j = 1; j < reg.slays.length; j++) {
      if (art.slays[j]) slays.push(reg.slays[j]!.code);
    }
  }
  const brands: string[] = [];
  if (art.brands) {
    for (let j = 1; j < reg.brands.length; j++) {
      if (art.brands[j]) brands.push(reg.brands[j]!.code);
    }
  }
  const curses: NonNullable<RandartRecord["curses"]> = [];
  if (art.curses) {
    for (let j = 1; j < reg.curses.length; j++) {
      const power = art.curses[j] ?? 0;
      const name = reg.curses[j]?.name;
      if (power !== 0 && name !== undefined && name.length > 0) curses.push({ name, power });
    }
  }
  const act = art.activation ?? kind?.activation ?? null;
  const time = art.activation ? art.time : kind?.time;
  const flags = flagNames(art);
  const graphics = kind && kind.kidx >= reg.ordinaryKindCount && kind.dChar.length > 0 && kind.dAttr.length > 0
    ? { character: kind.dChar, attr: kind.dAttr }
    : undefined;
  return {
    name: art.name,
    text: art.text,
    baseTval: tvalFindName(art.tval),
    baseName: objectShortName(kind ? kind.name : ""),
    ...(graphics === undefined ? {} : { graphics }),
    level: art.level,
    weight: art.weight,
    cost: art.cost,
    allocProb: art.allocProb,
    allocMin: art.allocMin,
    allocMax: art.allocMax,
    attackDice: art.dd,
    attackSides: art.ds,
    toHit: art.toH,
    toDamage: art.toD,
    ac: art.ac,
    toArmor: art.toA,
    ...(flags.length === 0 ? {} : { flags }),
    ...(modifiers.length === 0 ? {} : { modifiers }),
    ...(elements.length === 0 ? {} : { elements }),
    ...(slays.length === 0 ? {} : { slays }),
    ...(brands.length === 0 ? {} : { brands }),
    ...(curses.length === 0 ? {} : { curses }),
    ...(act && time ? { activation: { name: act.name, base: time.base, dice: time.dice, sides: time.sides } } : {}),
  };
}

export function randartDocument(
  reg: ObjRegistry,
  arts: readonly (Artifact | null)[],
  randartSeed: number,
): RandartData {
  const artifacts: RandartRecord[] = [];
  for (let i = 1; i < arts.length; i++) {
    const art = arts[i];
    if (!art) continue;
    const record = randartRecord(reg, art);
    if (record !== null) artifacts.push(record);
  }
  return { seed: randartSeed >>> 0, artifacts };
}

/**
 * do_randart's create_file block: the seed and every named artifact, as JSON.
 */
export function writeRandartFile(
  reg: ObjRegistry,
  arts: readonly (Artifact | null)[],
  randartSeed: number,
): string {
  return serializeDocument(randartFormat, randartDocument(reg, arts, randartSeed));
}

/**
 * The old randart.txt grammar, kept so a file from an older build can be read
 * once. Returns null when the seed header is missing: that file is not an
 * export this converter understands, and it is left in place.
 */
export function parseLegacyRandart(text: string): RandartData | null {
  const header = /# Artifact file for random artifacts with seed ([0-9a-fA-F]{8})/u.exec(text);
  if (header?.[1] === undefined) return null;
  const artifacts: RandartRecord[] = [];
  let current: {
    name?: string;
    text: string;
    baseTval?: string;
    baseName?: string;
    graphics?: { character: string; attr: string };
    level?: number;
    weight?: number;
    cost?: number;
    allocProb?: number;
    allocMin?: number;
    allocMax?: number;
    attackDice?: number;
    attackSides?: number;
    toHit?: number;
    toDamage?: number;
    ac?: number;
    toArmor?: number;
    flags: string[];
    modifiers: { name: string; value: number }[];
    elements: { name: string; level: number }[];
    slays: string[];
    brands: string[];
    curses: { name: string; power: number }[];
    activation?: { name: string; base: number; dice: number; sides: number };
    act?: string;
  } | null = null;

  const finish = (): void => {
    if (current?.name === undefined) {
      current = null;
      return;
    }
    const row = current;
    if (
      row.baseTval === undefined || row.level === undefined || row.weight === undefined ||
      row.cost === undefined || row.allocProb === undefined || row.allocMin === undefined ||
      row.allocMax === undefined || row.attackDice === undefined || row.attackSides === undefined ||
      row.toHit === undefined || row.toDamage === undefined || row.ac === undefined ||
      row.toArmor === undefined
    ) {
      current = null;
      return;
    }
    const name = row.name;
    if (name === undefined) {
      current = null;
      return;
    }
    artifacts.push({
      name,
      text: row.text,
      baseTval: row.baseTval,
      baseName: row.baseName ?? "",
      ...(row.graphics === undefined ? {} : { graphics: row.graphics }),
      level: row.level,
      weight: row.weight,
      cost: row.cost,
      allocProb: row.allocProb,
      allocMin: row.allocMin,
      allocMax: row.allocMax,
      attackDice: row.attackDice,
      attackSides: row.attackSides,
      toHit: row.toHit,
      toDamage: row.toDamage,
      ac: row.ac,
      toArmor: row.toArmor,
      ...(row.flags.length === 0 ? {} : { flags: row.flags }),
      ...(row.modifiers.length === 0 ? {} : { modifiers: row.modifiers }),
      ...(row.elements.length === 0 ? {} : { elements: row.elements }),
      ...(row.slays.length === 0 ? {} : { slays: row.slays }),
      ...(row.brands.length === 0 ? {} : { brands: row.brands }),
      ...(row.curses.length === 0 ? {} : { curses: row.curses }),
      ...(row.activation === undefined ? {} : { activation: row.activation }),
    });
    current = null;
  };

  const blank = (): NonNullable<typeof current> => ({
    text: "",
    flags: [],
    modifiers: [],
    elements: [],
    slays: [],
    brands: [],
    curses: [],
  });

  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const directive = line.slice(0, colon);
    const rest = line.slice(colon + 1);
    if (directive === "name") {
      finish();
      current = blank();
      current.name = rest;
      continue;
    }
    if (current === null) continue;
    if (directive === "base-object") {
      const split = rest.indexOf(":");
      current.baseTval = split < 0 ? rest : rest.slice(0, split);
      current.baseName = split < 0 ? "" : rest.slice(split + 1);
    } else if (directive === "graphics") {
      const split = rest.indexOf(":");
      if (split > 0) {
        current.graphics = { character: rest.slice(0, split), attr: rest.slice(split + 1) };
      }
    } else if (directive === "level") current.level = Number.parseInt(rest, 10);
    else if (directive === "weight") current.weight = Number.parseInt(rest, 10);
    else if (directive === "cost") current.cost = Number.parseInt(rest, 10);
    else if (directive === "alloc") {
      const match = /^(-?\d+):(-?\d+) to (-?\d+)$/u.exec(rest);
      if (match) {
        current.allocProb = Number.parseInt(match[1]!, 10);
        current.allocMin = Number.parseInt(match[2]!, 10);
        current.allocMax = Number.parseInt(match[3]!, 10);
      }
    } else if (directive === "attack") {
      const match = /^(-?\d+)d(-?\d+):(-?\d+):(-?\d+)$/u.exec(rest);
      if (match) {
        current.attackDice = Number.parseInt(match[1]!, 10);
        current.attackSides = Number.parseInt(match[2]!, 10);
        current.toHit = Number.parseInt(match[3]!, 10);
        current.toDamage = Number.parseInt(match[4]!, 10);
      }
    } else if (directive === "armor") {
      const match = /^(-?\d+):(-?\d+)$/u.exec(rest);
      if (match) {
        current.ac = Number.parseInt(match[1]!, 10);
        current.toArmor = Number.parseInt(match[2]!, 10);
      }
    } else if (directive === "flags") {
      for (const token of rest.split(/[\s|]+/u)) {
        if (token.length > 0) current.flags.push(token);
      }
    } else if (directive === "values") {
      for (const token of rest.split("|")) {
        const match = /^(.+)\[(-?\d+)\]$/u.exec(token.trim());
        if (match?.[1] === undefined || match[2] === undefined) continue;
        const value = Number.parseInt(match[2], 10);
        if (match[1].startsWith("RES_")) {
          current.elements.push({ name: match[1].slice(4), level: value });
        } else {
          current.modifiers.push({ name: match[1], value });
        }
      }
    } else if (directive === "slay") current.slays.push(rest);
    else if (directive === "brand") current.brands.push(rest);
    else if (directive === "curse") {
      const split = rest.lastIndexOf(":");
      if (split > 0) {
        current.curses.push({
          name: rest.slice(0, split),
          power: Number.parseInt(rest.slice(split + 1), 10),
        });
      }
    } else if (directive === "act") current.act = rest;
    else if (directive === "time") {
      const match = /^(-?\d+)\+(-?\d+)d(-?\d+)$/u.exec(rest);
      if (match && current.act !== undefined) {
        current.activation = {
          name: current.act,
          base: Number.parseInt(match[1]!, 10),
          dice: Number.parseInt(match[2]!, 10),
          sides: Number.parseInt(match[3]!, 10),
        };
      }
    } else if (directive === "desc") current.text = rest;
  }
  finish();
  return { seed: Number.parseInt(header[1], 16), artifacts };
}

/**
 * Read the export. A randart.json that fails to parse is left in place and
 * this returns null. A randart.txt is converted once, and removed only after
 * the new document reads back.
 */
export function readRandartExport(io: HostIo): RandartData | null {
  if (io.exists(HostDir.USER, RANDART_JSON)) {
    const text = io.read(HostDir.USER, RANDART_JSON);
    if (text === null) return null;
    const parsed = parseDocument(text, randartFormat);
    return parsed.ok ? parsed.data : null;
  }
  if (!io.exists(HostDir.USER, RANDART_TXT)) return null;
  const legacy = io.read(HostDir.USER, RANDART_TXT);
  if (legacy === null) return null;
  const data = parseLegacyRandart(legacy);
  if (data === null) return null;
  let text: string;
  try {
    text = serializeDocument(randartFormat, data);
  } catch {
    return null;
  }
  if (io.write(HostDir.USER, RANDART_JSON, text) !== "ok") return null;
  const back = io.read(HostDir.USER, RANDART_JSON);
  const parsed = back === null ? null : parseDocument(back, randartFormat);
  if (!parsed?.ok) return null;
  io.remove(HostDir.USER, RANDART_TXT);
  return parsed.data;
}
