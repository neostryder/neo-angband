/**
 * The two wrap rules of Angband 4.2.6, pinned against the renderer.
 *
 * This file exists because the renderer cited the WRONG one for months and
 * nothing caught it. `textBlockLines` implemented `textblock_calculate_lines`
 * at `cols - 1` while its comment named `text_out_to_screen`; the two agree on
 * every line that contains a space, so the miscitation was invisible in the
 * output and only showed up when someone tried to reason from the comment.
 *
 * The defence is a differential one. Both C functions are transcribed here,
 * independently of the renderer, and the renderer is required to match the one
 * it claims - on the shipped pack, and on random input that reaches the corners
 * the pack does not.
 *
 * A transcription used as an oracle has to be worth trusting, so neither is
 * paraphrased: `algoTextblock` counts characters and tracks a breaking offset
 * exactly as z-textblock.c L238 does, and `algoTextOut` writes onto a cell grid
 * and reads it back, exactly as ui-output.c L279 does.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { screenBlockLines, type ScreenTextBlock } from "./screen-view";

/* ------------------------------------------------------------------ *
 * The two upstream algorithms, transcribed from the C.
 * ------------------------------------------------------------------ */

/** textblock_calculate_lines (z-textblock.c L238), at `width`. */
function algoTextblock(text: string, width: number): string[] {
  if (text === "" || width === 0) return [];
  const starts = [0];
  const lens = [0];
  let cur = 0;
  let len = 0;
  let brk = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\n") {
      lens[cur] = len;
      starts.push(i + 1);
      lens.push(0);
      cur++;
      len = 0;
      i++;
      continue;
    }
    if (text[i] === " ") brk = i;
    len++;
    if (len === width) {
      const lineStart = starts[cur]!;
      let nextStart: number;
      let adjusted: number;
      if (brk > lineStart) {
        adjusted = brk - lineStart;
        nextStart = brk + 1;
        i = brk + 1;
      } else {
        adjusted = width;
        nextStart = i + 1;
        i++;
      }
      lens[cur] = adjusted;
      starts.push(nextStart);
      lens.push(0);
      cur++;
      len = 0;
    } else {
      lens[cur] = len;
      i++;
    }
  }
  let total = starts.length;
  if (lens[total - 1] === 0) total--;
  return Array.from({ length: total }, (_, k) =>
    text.slice(starts[k]!, starts[k]! + lens[k]!),
  );
}

/** text_out_to_screen (ui-output.c L279), on a simulated Term. */
function algoTextOut(text: string, wrap: number, indent = 0): string[] {
  const grid: (string | undefined)[][] = [[]];
  let x = indent;
  let y = 0;
  const at = (col: number): string => grid[y]![col] ?? " ";
  for (const ch of text) {
    if (ch === "\n") {
      x = indent;
      grid[++y] = [];
      continue;
    }
    if (x >= wrap - 1 && ch !== " ") {
      let n = 0;
      if (x < wrap) {
        for (let i = wrap - 2; i >= 0; i--) {
          if (at(i) === " ") break;
          n = i;
        }
      }
      if (n === 0) n = wrap;
      const carried = grid[y]!.slice(n, wrap - 1);
      grid[y]!.length = Math.min(grid[y]!.length, n);
      x = indent;
      grid[++y] = [];
      for (const c of carried) {
        grid[y]![x] = c;
        if (++x > wrap) x = wrap;
      }
    }
    grid[y]![x] = ch;
    if (++x > wrap) x = wrap;
  }
  return grid.map((row) =>
    Array.from(row, (c) => c ?? " ")
      .join("")
      .replace(/\s+$/u, ""),
  );
}

/* ------------------------------------------------------------------ *
 * The renderer, addressed the way a screen addresses it.
 * ------------------------------------------------------------------ */

const rendered = (block: ScreenTextBlock, cols: number): string[] =>
  screenBlockLines(block, cols).map((l) => l.text.replace(/\s+$/u, ""));

const prose = (text: string, extra: Partial<ScreenTextBlock> = {}): ScreenTextBlock => ({
  kind: "text",
  /* One paragraph per '\n', which is what proseBlock/textParagraphs produce and
   * what the C's '\n' arm does. */
  paragraphs: text.split("\n").map((p) => [{ text: p }]),
  ...extra,
});

/* ------------------------------------------------------------------ *
 * The corpus: every description string the shipped pack carries.
 * ------------------------------------------------------------------ */

function packRecords(name: string): Record<string, unknown>[] {
  const raw = JSON.parse(
    readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as { records?: Record<string, unknown>[] };
  return raw.records ?? [];
}

/** string_append semantics: `desc:` lines concatenate with no separator. */
function descOf(rec: Record<string, unknown>): string {
  const d = rec["desc"];
  return Array.isArray(d) ? d.join("") : typeof d === "string" ? d : "";
}

const CORPUS: { file: string; name: string; text: string }[] = [];
for (const file of [
  "monster",
  "object",
  "terrain",
  "trap",
  "artifact",
  "ego_item",
  "curse",
  "player_property",
]) {
  for (const rec of packRecords(file)) {
    const text = descOf(rec);
    if (text.trim() !== "") CORPUS.push({ file, name: String(rec["name"] ?? "?"), text });
  }
}

/* A deterministic PRNG, so a failure names an input that can be replayed. */
function makeRng(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

function randomProse(rnd: () => number, maxWord: number): string {
  const parts: string[] = [];
  const words = 3 + Math.floor(rnd() * 60);
  for (let i = 0; i < words; i++) {
    parts.push("x".repeat(1 + Math.floor(rnd() * maxWord)));
    const r = rnd();
    /* Double spaces and hard breaks at roughly the rate real Angband prose has
     * them - they are where the two rules disagree, so a generator without them
     * would test the easy half of the input space. */
    parts.push(r < 0.08 ? "\n" : r < 0.25 ? "  " : " ");
  }
  return parts.join("").trim();
}

describe("prose wraps the way 4.2.6 wraps it", () => {
  it("has a corpus worth calling one", () => {
    expect(CORPUS.length).toBeGreaterThan(1000);
  });

  it("matches textblock_calculate_lines on every description the pack ships", () => {
    const wrong: string[] = [];
    for (const { file, name, text } of CORPUS) {
      const mine = rendered(prose(text), 80);
      const theirs = algoTextblock(text, 80).map((l) => l.replace(/\s+$/u, ""));
      if (JSON.stringify(mine) !== JSON.stringify(theirs)) wrong.push(`${file}: ${name}`);
    }
    expect(wrong).toEqual([]);
  });

  it("matches it at every width a mod might re-render at, not just 80", () => {
    /* The renderer is reached with `term.size().cols`, and a mod that lays a
     * view out in a narrow panel reaches it with whatever it likes. The old
     * `cols - 1` width was invisible at 80 and wrong at 16. */
    const wrong: string[] = [];
    for (const cols of [12, 16, 20, 40, 60, 80, 120]) {
      for (const { file, name, text } of CORPUS.slice(0, 200)) {
        const mine = rendered(prose(text), cols);
        const theirs = algoTextblock(text, cols).map((l) => l.replace(/\s+$/u, ""));
        if (JSON.stringify(mine) !== JSON.stringify(theirs))
          wrong.push(`${cols}c ${file}: ${name}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("matches it on random prose, including the corners the pack has none of", () => {
    const rnd = makeRng(20260813);
    const wrong: { width: number; text: string }[] = [];
    for (const width of [20, 40, 72, 80]) {
      /* maxWord >= width is the ONLY class where the rules can differ, and the
       * pack's longest token is 18 characters - so a fuzz that never generates
       * one tests nothing the corpus did not. */
      for (const maxWord of [6, 12, width - 1, width, width * 2]) {
        for (let i = 0; i < 300; i++) {
          const text = randomProse(rnd, maxWord);
          const mine = rendered(prose(text), width);
          const theirs = algoTextblock(text, width).map((l) => l.replace(/\s+$/u, ""));
          if (JSON.stringify(mine) !== JSON.stringify(theirs)) wrong.push({ width, text });
        }
      }
    }
    expect(wrong.slice(0, 1)).toEqual([]);
  });

  it("packs a full width into a line with no space in it, as the C does", () => {
    /* The regression the width-1 wrap actually had: with no breaking character
     * on the line, upstream takes `width` characters and the old rule took one
     * fewer. Reachable only by a token as long as the line - hence the fuzz
     * above generates them and the corpus never could. */
    expect(rendered(prose("x".repeat(20)), 10)).toEqual(["xxxxxxxxxx", "xxxxxxxxxx"]);
    expect(algoTextblock("x".repeat(20), 10)).toEqual(["xxxxxxxxxx", "xxxxxxxxxx"]);
  });

  it("keeps the leading space of a sentence break, because the textblock rule does", () => {
    /* Five of the pack's descriptions land a line break between the two spaces
     * after a full stop, and the textblock rule carries the second one down.
     * text_out_to_screen never does - which is the whole reason `flow` exists. */
    const text = `${"w".repeat(74)} end.  Or is it?`;
    const tb = algoTextblock(text, 80);
    expect(tb[1]).toBe(" Or is it?");
    expect(rendered(prose(text), 80)).toEqual(tb.map((l) => l.replace(/\s+$/u, "")));
    expect(algoTextOut(text, 80)[1]).toBe("Or is it?");
  });
});

describe("the character sheet's history is the one page on the other rule", () => {
  const history =
    "You are the illegitimate and unacknowledged child of a Serf.  " +
    "You are one of several children of a Yeoman.  " +
    "Your mother was of the Noldor.  You have dark brown eyes, straight black hair, " +
    "and a very fair complexion.";

  const block = (): ScreenTextBlock =>
    prose(history, { indent: 1, wrap: 72, flow: "text-out" });

  it("matches text_out_to_screen at wrap 72, indent 1", () => {
    expect(rendered(block(), 80)).toEqual(algoTextOut(history, 72, 1));
  });

  it("stops two columns short of the declared wrap, as `x < wrap - 1` requires", () => {
    /* ui-player.c L866 says 72; the rightmost glyph upstream can place is at
     * column 70, because a non-space is only written while x < wrap - 1. A rule
     * that just wrapped AT 72 put glyphs in columns 71 and 72. */
    const lines = rendered(block(), 80);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(71);
    expect(Math.max(...lines.map((l) => l.length))).toBeGreaterThan(60);
  });

  it("differs from the textblock rule, which is why the discriminator is not decoration", () => {
    /* Short words, so a line fills to the boundary rather than breaking early:
     * the textblock rule reaches column 71 and `text_out_to_screen` stops at 70.
     * The real history is data, and a given roll may or may not land on the
     * boundary - which is exactly why the fixture is built to. */
    const dense = "ab ".repeat(60).trim();
    const asTextOut = rendered(prose(dense, { indent: 1, wrap: 72, flow: "text-out" }), 80);
    const asTextblock = rendered(prose(dense, { indent: 1, wrap: 72 }), 80);
    expect(asTextOut).not.toEqual(asTextblock);
    expect(asTextOut).toEqual(algoTextOut(dense, 72, 1));
    expect(Math.max(...asTextblock.map((l) => l.length))).toBe(72);
    expect(Math.max(...asTextOut.map((l) => l.length))).toBeLessThan(72);
  });

  it("indents every row by one column, cursor parked at column 1", () => {
    for (const l of rendered(block(), 80)) expect(l.startsWith(" ")).toBe(true);
  });
});
