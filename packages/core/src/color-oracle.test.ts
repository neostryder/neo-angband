/**
 * The palette proof: the port's colours ARE upstream's, parsed from the C.
 *
 * Every glyph the game draws takes its colour from here, so one wrong byte is a
 * permanent, global visual divergence that no gameplay test would ever notice.
 * `color.test.ts` next door pins values by hand, which cannot catch a
 * transcription slip shared between the table and its own expectations. This
 * reads `reference/src/z-color.c` at test time instead.
 *
 * Upstream keeps two tables in parallel, and they do not cover the same range:
 *
 *   - `angband_color_table[MAX_COLORS][4]` (L30) initialises **29** rows, 0
 *     through `COLOUR_SHADE`, each behind an unused leading byte;
 *   - `color_table[MAX_COLORS]` (L66) initialises only **28**, 0 through
 *     `COLOUR_DEEP_L_BLUE`, and its `translate` rows are written as symbolic
 *     `COLOUR_*` names rather than numbers. The comment says the rest are
 *     "filled in when the game loads", so `COLOUR_SHADE` has an RGB but no name
 *     or index character, and `MAX_COLORS` is 32 with the tail zeroed.
 *
 * The port mirrors that split: `COLOR_TABLE` carries 32 entries with 28-31
 * blank, and `COLOUR_SHADE`'s RGB lives in the live `angbandColorTable` behind
 * `colorChannel()` rather than in `COLOR_TABLE[28].rgb`. So the RGB comparison
 * below goes through `colorChannel` -- the function the renderer actually calls
 * -- and not the raw table, because what matters is the colour the game draws.
 *
 * Parsing C from a test is unusual. The alternative is trusting a hand copy of
 * 29 colours x 12 numbers, and hand copies of the reference are precisely what
 * this phase keeps finding to be wrong.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLOR_TABLE, colorChannel } from "./color";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const zColor = readFileSync(join(repoRoot, "reference", "src", "z-color.c"), "utf8");

/**
 * Slice one brace-initialised table body out of the C source. The marker is
 * matched as a whole declaration, because "color_table[MAX_COLORS]" is also a
 * substring of "angband_color_table[MAX_COLORS]" and a plain indexOf silently
 * returns the wrong table.
 */
function tableBody(marker: RegExp): string {
  const found = marker.exec(zColor);
  expect(found, `${String(marker)} not found in z-color.c`).not.toBeNull();
  const start = (found as RegExpExecArray).index;
  const open = zColor.indexOf("{", start);
  const end = zColor.indexOf("\n};", open);
  expect(end, `end of ${marker} not found`).toBeGreaterThan(open);
  return zColor.slice(open + 1, end);
}

/**
 * `{0x00, 0xff, 0x80, 0x00}, /* 3 COLOUR_ORANGE *\/` -> rgb plus the symbolic
 * name from the trailing comment, which is how `COLOUR_*` references in the
 * other table get resolved to indices.
 */
function parseRgbTable(): { rgb: [number, number, number]; symbol: string }[] {
  const body = tableBody(/^uint8_t\s+angband_color_table\[/m);
  const rows: { rgb: [number, number, number]; symbol: string }[] = [];
  const re =
    /\{\s*0x[0-9a-fA-F]+\s*,\s*(0x[0-9a-fA-F]+)\s*,\s*(0x[0-9a-fA-F]+)\s*,\s*(0x[0-9a-fA-F]+)\s*\}\s*,?\s*(?:\/\*\s*\d+\s*(COLOUR_[A-Z_]+)\s*\*\/)?/g;
  for (const m of body.matchAll(re)) {
    rows.push({
      rgb: [Number(m[1]), Number(m[2]), Number(m[3])],
      symbol: m[4] ?? "",
    });
  }
  return rows;
}

interface CColorEntry {
  char: string;
  name: string;
  translate: number[];
}

/**
 * `{'d', "Dark", {0, 0, 0, COLOUR_DARK, ...}}` -> char, name and the translate
 * row with symbols resolved through `symbolIndex`.
 */
function parseColorTable(symbolIndex: Map<string, number>): CColorEntry[] {
  const body = tableBody(/^color_type\s+color_table\[/m)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const entries: CColorEntry[] = [];
  for (const m of body.matchAll(/\{\s*'(\\?.)'\s*,\s*"([^"]*)"\s*,\s*\{([^}]*)\}/g)) {
    const translate = m[3]!
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((tok) => {
        if (/^\d+$/.test(tok)) return Number(tok);
        const idx = symbolIndex.get(tok);
        expect(idx, `unresolved colour symbol ${tok}`).not.toBeUndefined();
        return idx as number;
      });
    entries.push({ char: m[1]!.replace(/^\\/, ""), name: m[2]!, translate });
  }
  return entries;
}

describe("colour palette vs reference/src/z-color.c", () => {
  const cRgb = parseRgbTable();
  const symbolIndex = new Map<string, number>();
  cRgb.forEach((r, i) => {
    if (r.symbol) symbolIndex.set(r.symbol, i);
  });
  const cTable = parseColorTable(symbolIndex);

  it("parsed the C tables at all", () => {
    /* Guard the guard: a regex that silently matched nothing would make every
     * comparison below vacuously pass. */
    expect(cRgb.length, "angband_color_table rows").toBe(29);
    expect(cTable.length, "color_table entries").toBe(28);
    expect(symbolIndex.get("COLOUR_DARK")).toBe(0);
    expect(symbolIndex.get("COLOUR_SHADE")).toBe(28);
    expect(cTable[0]!.translate.length, "translate row width").toBe(9);
  });

  it("keeps MAX_COLORS entries with the uninitialised tail blank, as upstream does", () => {
    /* z-color.h:77 -- MAX_COLORS 32; color_table's comment says the rest are
     * "filled in when the game loads". */
    expect(COLOR_TABLE.length).toBe(32);
    for (let i = cTable.length; i < COLOR_TABLE.length; i++) {
      expect(COLOR_TABLE[i]!.name, `[${i}] name`).toBe("");
      expect(COLOR_TABLE[i]!.char, `[${i}] char`).toBe("");
    }
  });

  it("draws every RGB triple upstream draws", () => {
    const diffs: string[] = [];
    for (let i = 0; i < cRgb.length; i++) {
      const c = cRgb[i]!.rgb;
      /* colorChannel is what the renderer reads: 0=K, 1=R, 2=G, 3=B. */
      const port: [number, number, number] = [
        colorChannel(i, 1),
        colorChannel(i, 2),
        colorChannel(i, 3),
      ];
      if (port[0] !== c[0] || port[1] !== c[1] || port[2] !== c[2]) {
        const hex = (v: readonly number[]): string =>
          v.map((x) => x.toString(16).padStart(2, "0")).join(",");
        diffs.push(`[${i}] ${cRgb[i]!.symbol}: C ${hex(c)} port ${hex(port)}`);
      }
    }
    expect(diffs, diffs.join("\n")).toEqual([]);
  });

  it("matches every colour name and index character", () => {
    const diffs: string[] = [];
    for (let i = 0; i < cTable.length; i++) {
      const port = COLOR_TABLE[i]!;
      const c = cTable[i]!;
      if (port.name !== c.name) diffs.push(`[${i}] name: C "${c.name}" port "${port.name}"`);
      if (port.char !== c.char) diffs.push(`[${i}] char: C '${c.char}' port '${port.char}'`);
    }
    expect(diffs, diffs.join("\n")).toEqual([]);
  });

  it("matches every color_translate row", () => {
    const diffs: string[] = [];
    for (let i = 0; i < cTable.length; i++) {
      const port = COLOR_TABLE[i]!;
      const c = cTable[i]!;
      if (port.translate.length !== c.translate.length) {
        diffs.push(
          `[${i}] ${c.name}: translate width C ${c.translate.length} port ${port.translate.length}`,
        );
        continue;
      }
      for (let j = 0; j < c.translate.length; j++) {
        if (port.translate[j] !== c.translate[j]) {
          diffs.push(
            `[${i}] ${c.name} translate[${j}]: C ${c.translate[j]} port ${port.translate[j]}`,
          );
        }
      }
    }
    expect(diffs, diffs.join("\n")).toEqual([]);
  });
});
