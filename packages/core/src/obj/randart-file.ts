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
import { writeElements, writeFlags, writeMods } from "../datafile.js";
import { OBJECT_FLAG_ENTRIES } from "../generated/index.js";
import type { ObjRegistry } from "./bind.js";
import { objectShortName, tvalFindName } from "./bind.js";
import { OF_SIZE } from "./types.js";
import type { Artifact } from "./types.js";

/** randart.txt, in ANGBAND_DIR_USER. */
export const RANDART_TXT = "randart.txt";

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
 * write_randart_entry (obj-randart.c:3061-3167): one artifact.txt record.
 *
 * Returns "" for an artifact with no name - upstream's "Ignore non-existent
 * artifacts" guard, which is how the unused slots in a_info are skipped.
 */
export function writeRandartEntry(reg: ObjRegistry, art: Artifact): string {
  if (!art.name) return "";
  const kind = reg.lookupKind(art.tval, art.sval);

  let out = "";
  out += `# ${art.text}\n`;
  out += `name:${art.name}\n`;
  out += `base-object:${tvalFindName(art.tval)}:${objectShortName(kind ? kind.name : "")}\n`;

  /* Graphics only for kinds past the ordinary ones - i.e. the artifact has a
   * base item invented for it, so nothing else defines its glyph. */
  if (kind && kind.kidx >= reg.ordinaryKindCount) {
    out += `graphics:${kind.dChar}:${kind.dAttr}\n`;
  }

  out += `level:${String(art.level)}\n`;
  out += `weight:${String(art.weight)}\n`;
  out += `cost:${String(art.cost)}\n`;
  out += `alloc:${String(art.allocProb)}:${String(art.allocMin)} to ${String(art.allocMax)}\n`;
  out += `attack:${String(art.dd)}d${String(art.ds)}:${String(art.toH)}:${String(art.toD)}\n`;
  out += `armor:${String(art.ac)}:${String(art.toA)}\n`;

  out += writeFlags("flags:", art.flags, OF_SIZE, OBJ_FLAG_NAMES);
  out += writeMods(art.modifiers);
  out += writeElements(art.elInfo);

  if (art.slays) {
    for (let j = 1; j < reg.slays.length; j++) {
      if (art.slays[j]) out += `slay:${reg.slays[j]!.code}\n`;
    }
  }
  if (art.brands) {
    for (let j = 1; j < reg.brands.length; j++) {
      if (art.brands[j]) out += `brand:${reg.brands[j]!.code}\n`;
    }
  }
  if (art.curses) {
    for (let j = 1; j < reg.curses.length; j++) {
      const power = art.curses[j] ?? 0;
      if (power !== 0) out += `curse:${reg.curses[j]!.name}:${String(power)}\n`;
    }
  }

  /* The artifact's own activation wins; otherwise the base item's, if it has
   * one. An artifact with neither writes no act:/time: pair at all. */
  const act = art.activation ?? kind?.activation ?? null;
  const time = art.activation ? art.time : kind?.time;
  if (act && time) {
    out += `act:${act.name}\n`;
    out += `time:${String(time.base)}+${String(time.dice)}d${String(time.sides)}\n`;
  }

  /* Upstream writes the description twice - once as a leading comment and once
   * as the record's own desc: line. Both are kept. */
  out += `desc:${art.text}\n`;
  out += "\n";
  return out;
}

/**
 * do_randart's `create_file` block (obj-randart.c:3195-3215): the seed header
 * followed by every artifact's entry, from index 1.
 *
 * The seed is written as C's `%08lx` - lower-case hex, zero-padded to eight
 * digits - so the file names the seed that produced it and a player can
 * reproduce the set.
 */
export function writeRandartFile(
  reg: ObjRegistry,
  arts: readonly (Artifact | null)[],
  randartSeed: number,
): string {
  let out = `# Artifact file for random artifacts with seed ${(randartSeed >>> 0)
    .toString(16)
    .padStart(8, "0")}\n\n\n`;
  for (let i = 1; i < arts.length; i++) {
    const art = arts[i];
    if (art) out += writeRandartEntry(reg, art);
  }
  return out;
}
