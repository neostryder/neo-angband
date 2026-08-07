/**
 * datafile.c's WRITERS - the half of the data-file layer that emits a record
 * rather than parsing one (parser.c covers the reading side).
 *
 * These exist because two very different features need to round-trip game data
 * back out through the same grammar the .txt files use: mon-lore.c's "dump
 * monster knowledge" and obj-randart.c's optional randart.txt. Upstream shares
 * one implementation between them, so the port does too - writeFlags used to
 * live in mon/lore-file.ts, which made obj/ reach into mon/ for it.
 *
 * Each writer returns a string instead of taking a file handle: HostIo.write is
 * a whole-file call, so the callers assemble their document and write once.
 *
 * All three reproduce the same two upstream warts, and a parser reading these
 * files has to cope with them:
 *
 *   - the " | " separator is appended BEFORE the next name is known, so a run
 *     that stops early leaves a trailing separator in the buffer, and that
 *     buffer is still written;
 *   - `pointer` is compared against 60 AFTER the name is appended, so a line
 *     can overshoot by the length of its last entry.
 */
import type { FlagSet } from "./bitflag.js";
import {
  ELEMENT_ENTRIES,
  OBJECT_MODIFIER_ENTRIES,
  STAT_ENTRIES,
} from "./generated/index.js";

/** OBJ_MOD_MAX: the stats come first, then list-object-modifiers.h. */
const OBJ_MOD_NAMES: readonly string[] = [
  ...STAT_ENTRIES.map((e) => e.name),
  ...OBJECT_MODIFIER_ENTRIES.map((e) => e.name),
];

/**
 * write_flags (datafile.c:482-514): `intro` followed by the set flags' names,
 * " | "-separated, wrapped at ~60 characters.
 */
export function writeFlags(
  intro: string,
  flags: FlagSet,
  size: number,
  names: readonly (string | undefined)[],
): string {
  const lines: string[] = [];
  let buf = "";
  let pointer = 0;

  for (
    let flag = flags.next(1);
    flag > 0 && flag < size * 8;
    flag = flags.next(flag + 1)
  ) {
    if (buf.length > 0) {
      buf += " | ";
      pointer += 3;
    }
    /* "If no name, we're past the real flags" - and the trailing " | " stays. */
    const name = names[flag];
    if (name === undefined) break;
    buf += name;
    pointer += name.length;

    if (pointer >= 60) {
      lines.push(`${intro}${buf}\n`);
      buf = "";
      pointer = 0;
    }
  }

  /* "Print remaining flags if any", gated on pointer rather than on buf. */
  if (pointer) lines.push(`${intro}${buf}\n`);
  return lines.join("");
}

/**
 * write_mods (datafile.c:520-563): `values:` lines for every non-zero modifier,
 * as NAME[value].
 *
 * `pointer += 5` for the "[%d]" regardless of how many digits the value has -
 * upstream's own approximation, kept because it is what decides where the line
 * breaks.
 */
export function writeMods(values: readonly number[]): string {
  const lines: string[] = [];
  let buf = "";
  let pointer = 0;

  for (let i = 0; i < OBJ_MOD_NAMES.length; i++) {
    const v = values[i] ?? 0;
    if (v === 0) continue;

    if (buf.length > 0) {
      buf += " | ";
      pointer += 3;
    }
    const name = OBJ_MOD_NAMES[i]!;
    buf += `${name}[${String(v)}]`;
    pointer += name.length + 5;

    if (pointer >= 60) {
      lines.push(`values:${buf}\n`);
      buf = "";
      pointer = 0;
    }
  }

  if (pointer) lines.push(`values:${buf}\n`);
  return lines.join("");
}

/**
 * write_elements (datafile.c:569-610): `values:` lines for every element with a
 * non-zero resistance level, as RES_NAME[level].
 *
 * `pointer += strlen(name) + 4` counts "RES_" but the value still only counts
 * as 5 - the same approximation as write_mods.
 */
export function writeElements(
  elInfo: readonly { readonly resLevel: number }[],
): string {
  const lines: string[] = [];
  let buf = "";
  let pointer = 0;

  for (let i = 0; i < ELEMENT_ENTRIES.length; i++) {
    const level = elInfo[i]?.resLevel ?? 0;
    if (level === 0) continue;

    if (buf.length > 0) {
      buf += " | ";
      pointer += 3;
    }
    const name = ELEMENT_ENTRIES[i]!.name;
    buf += `RES_${name}[${String(level)}]`;
    pointer += name.length + 4 + 5;

    if (pointer >= 60) {
      lines.push(`values:${buf}\n`);
      buf = "";
      pointer = 0;
    }
  }

  if (pointer) lines.push(`values:${buf}\n`);
  return lines.join("");
}
