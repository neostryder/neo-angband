/**
 * Gap #58: the faithful wide character sheet (display_player mode 0/1,
 * ui-player.c) and the narrow characterSheetLines list. Verifies against the
 * upstream column contract: stat table at col 42 with "  Self" (WIDTH 6, the
 * classic 5-wide header misalignment fixed) / RB / CB / EB / "  Best"
 * headers, "STR!" (colon REPLACED by the natural-max flag, L480-481),
 * per-column colours (Self/Best L_GREEN, RB/CB/EB L_BLUE, drained YELLOW,
 * L469-507), misc panel at x=21 (panels[] L852), history from row 19
 * (display_player_xtra_info), do_cmd_change_name key cycling (L1280-1289),
 * and RNG invariance (a pure display: zero draws).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import {
  loc,
  Rng,
  Chunk,
  FeatureRegistry,
  bindPlayer,
  blankPlayer,
  newGear,
  newKnownMap,
  newTargetState,
  IgnoreSettings,
  makeRuneEnv,
  DEFAULT_GAME_CONSTANTS,
  placePlayer,
  colorToCss,
  COLOUR_L_GREEN,
  COLOUR_L_BLUE,
  COLOUR_YELLOW,
} from "@neo-angband/core";
import type {
  GameState,
  Loc,
  PlayerPackRecords,
  TerrainRecordJson,
} from "@neo-angband/core";
import { showCharacterSheet } from "./charsheet";
import {
  characterSheetLines,
  historyBlockLines,
  statHeaderLine,
  statRowLine,
} from "./screens";
import type { GlyphTerm } from "./term";

/* ------------------------------------------------------------------ */
/* Fixtures: a real GameState from the shipped pack (screens.test.ts   */
/* pattern), plus a colour-recording fake term and a fake window.      */
/* ------------------------------------------------------------------ */

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const featureReg = new FeatureRegistry(loadRecords<TerrainRecordJson>("terrain"));
const FLOOR = featureReg.byCodeName("FLOOR").fidx;
const GRANITE = featureReg.byCodeName("GRANITE").fidx;

const players = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
} as PlayerPackRecords);

function makeTestState(playerGrid: Loc): GameState {
  const w = 10;
  const h = 10;
  const chunk = new Chunk(featureReg, h, w);
  chunk.fill(GRANITE);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) chunk.setFeat(loc(x, y), FLOOR);
  }
  const player = blankPlayer(players.races[0]!, players.classes[0]!, players.bodies[0]!);
  const gear = newGear();
  const rng = new Rng(1);
  const actor = {
    player,
    grid: playerGrid,
    energy: 0,
    speed: 110,
    totalEnergy: 0,
    combat: {
      toH: 0, toD: 0, ac: 0, toA: 0, skills: [],
      numBlows: 100, ammoMult: 1, numShots: 0, ammoTval: 0, blessWield: false,
    },
    defense: { ac: 0, toA: 0 },
    weapon: null,
    stealth: 0,
    light: 0,
    unlight: false,
  };
  const state = {
    rng,
    chunk,
    actor,
    gear,
    monsters: [null],
    groups: [null],
    floor: new Map(),
    traps: new Map(),
    known: newKnownMap(w, h),
    target: newTargetState(),
    ignore: new IgnoreSettings(),
    lore: new Map(),
    turn: 0,
    z: { ...DEFAULT_GAME_CONSTANTS },
    brands: [null],
    slays: [null],
    runeEnv: makeRuneEnv(
      (slot: number) => gear.store.get(player.equipment[slot] ?? 0) ?? null,
      (v) => rng.randcalcVaries(v),
    ),
    playing: true,
    isDead: false,
    generateLevel: false,
    nextCommand: () => null,
  } as unknown as GameState;
  placePlayer(state, playerGrid);
  return state;
}

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: Array<{ type: string; fn: (ev: Event) => void; capture: boolean }> = [];
  return {
    addEventListener(type, fn, capture = false) {
      listeners.push({ type, fn, capture });
    },
    removeEventListener(type, fn, capture = false) {
      const i = listeners.findIndex(
        (l) => l.type === type && l.fn === fn && l.capture === capture,
      );
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const l of [...listeners].filter((x) => x.type === ev.type)) l.fn(ev);
    },
  };
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

interface SheetTerm extends GlyphTerm {
  snapshot(): string[];
  colorAt(x: number, y: number): string | undefined;
  fireTap(col: number, row: number): void;
  hasTapHandler(): boolean;
}

function makeSheetTerm(cols = 100, rows = 30): SheetTerm {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  const colors: (string | undefined)[][] = Array.from({ length: rows }, () =>
    new Array<string | undefined>(cols).fill(undefined),
  );
  let tapCb: ((cell: { col: number; row: number }) => void) | null = null;
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
      for (const row of colors) row.fill(undefined);
    },
    print: (x: number, y: number, text: string, fg: string) => {
      for (let i = 0; i < text.length && x + i < cols; i++) {
        if (y < 0 || y >= rows || x + i < 0) continue;
        grid[y]![x + i] = text[i] ?? " ";
        colors[y]![x + i] = fg;
      }
    },
    onResize: null,
    onCellTap: (cb: ((cell: { col: number; row: number }) => void) | null) => {
      tapCb = cb;
    },
    snapshot: () => grid.map((row) => row.join("").replace(/\s+$/u, "")),
    colorAt: (x: number, y: number) => colors[y]?.[x],
    fireTap: (col: number, row: number) => {
      tapCb?.({ col, row });
    },
    hasTapHandler: () => tapCb !== null,
  } as unknown as SheetTerm;
}

/** A row snapshot padded back out so column slices are stable. */
function slice(snap: string[], row: number, from: number, len: number): string {
  return (snap[row] ?? "").padEnd(from + len).slice(0, from + len).slice(from);
}

const STAT_COL = 42;

function setup(history = ""): { state: GameState; win: FakeWindow; term: SheetTerm } {
  const state = makeTestState(loc(2, 2));
  const p = state.actor.player;
  // An 18/100 STR (natural maximum -> the "!" flag and a 6-char cnv_stat).
  p.statMax[0] = 18 + 100;
  p.statCur[0] = 18 + 100;
  // A drained CON (stat_cur < stat_max -> lowercase name + yellow current).
  p.statMax[4] = 17;
  p.statCur[4] = 15;
  p.history = history;
  const win = makeFakeWindow();
  (globalThis as { window?: unknown }).window = win;
  return { state, win, term: makeSheetTerm() };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/* ------------------------------------------------------------------ */
/* Wide layout (display_player mode 0)                                 */
/* ------------------------------------------------------------------ */

describe("showCharacterSheet wide: faithful stat-table columns and colours", () => {
  it("aligns width-6 Self/Best headers with 18/100 data (the header-width fix)", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    const snap = term.snapshot();
    // Headers (row 1) at the upstream stops: col+5 / +12 / +16 / +20 / +24.
    expect(slice(snap, 1, STAT_COL + 5, 6)).toBe("  Self");
    expect(slice(snap, 1, STAT_COL + 12, 3)).toBe(" RB");
    expect(slice(snap, 1, STAT_COL + 16, 3)).toBe(" CB");
    expect(slice(snap, 1, STAT_COL + 20, 3)).toBe(" EB");
    expect(slice(snap, 1, STAT_COL + 24, 6)).toBe("  Best");
    // STR data row (row 2): the 6-char cnv_stat sits exactly under "  Self".
    expect(slice(snap, 2, STAT_COL + 5, 6)).toBe("18/100");
    // Best is a 6-char cnv_stat field exactly under "  Best".
    expect(slice(snap, 2, STAT_COL + 24, 6)).toMatch(/^(18\/\d{3}| 18\/\d{2}|\s+\d{1,2})$/);
    press(win, "Escape");
  });

  it("renders 'STR!' for a natural-max stat: the '!' REPLACES the colon", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    const snap = term.snapshot();
    expect(slice(snap, 2, STAT_COL, 4)).toBe("STR!");
    expect(snap.join("\n")).not.toContain("STR!:");
    // A non-max stat keeps its colon (INT row).
    expect(slice(snap, 3, STAT_COL, 4)).toBe("INT:");
    press(win, "Escape");
  });

  it("colours Self/Best L_GREEN, RB/CB/EB L_BLUE (ui-player.c L485-501)", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    expect(term.colorAt(STAT_COL + 6, 2)).toBe(colorToCss(COLOUR_L_GREEN)); // Self
    expect(term.colorAt(STAT_COL + 25, 2)).toBe(colorToCss(COLOUR_L_GREEN)); // Best
    expect(term.colorAt(STAT_COL + 13, 2)).toBe(colorToCss(COLOUR_L_BLUE)); // RB
    expect(term.colorAt(STAT_COL + 17, 2)).toBe(colorToCss(COLOUR_L_BLUE)); // CB
    expect(term.colorAt(STAT_COL + 21, 2)).toBe(colorToCss(COLOUR_L_BLUE)); // EB
    press(win, "Escape");
  });

  it("shows the drained value in YELLOW at col+31, blank when not drained", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    const snap = term.snapshot();
    // CON (row 6) is drained: lowercase name, a value in the trailing column.
    expect(slice(snap, 6, STAT_COL, 4)).toBe("Con:");
    const drainedCell = slice(snap, 6, STAT_COL + 31, 6);
    expect(drainedCell.trim()).not.toBe("");
    const xNonSpace = STAT_COL + 31 + drainedCell.search(/\S/u);
    expect(term.colorAt(xNonSpace, 6)).toBe(colorToCss(COLOUR_YELLOW));
    // STR (row 2) is NOT drained: the column stays blank (no echoed Best).
    expect(slice(snap, 2, STAT_COL + 30, 8).trim()).toBe("");
    press(win, "Escape");
  });

  it("places topleft at x=1 and the misc panel at x=21 (panels[] L851-852)", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    const snap = term.snapshot();
    expect(slice(snap, 1, 1, 4)).toBe("Name");
    expect(slice(snap, 1, 21, 3)).toBe("Age");
    // Row-9 blocks: midleft x=1, combat x=29, skills x=52 (L853-855).
    expect(slice(snap, 9, 1, 5)).toBe("Level");
    expect(slice(snap, 9, 29, 5)).toBe("Armor");
    expect(slice(snap, 9, 52, 6)).toBe("Saving");
    press(win, "Escape");
  });

  it("renders player.history wrapped from row 19 and degrades to nothing when empty", () => {
    const history =
      "You are the only child of a Serf. You are a credit to the family. " +
      "You have blue eyes, straight brown hair, and an average complexion.";
    const withHist = setup(history);
    void showCharacterSheet(withHist.term, withHist.state, "Fred");
    const snap = withHist.term.snapshot();
    expect(snap[19]).toContain("You are the only child of a Serf.");
    expect(snap[19]!.startsWith(" ")).toBe(true); // text_out_indent = 1
    press(withHist.win, "Escape");

    const noHist = setup("");
    void showCharacterSheet(noHist.term, noHist.state, "Fred");
    const empty = noHist.term.snapshot();
    for (let r = 19; r < 29; r++) expect(empty[r] ?? "").toBe("");
    press(noHist.win, "Escape");
  });
});

/* ------------------------------------------------------------------ */
/* Mode cycling + keys (do_cmd_change_name)                            */
/* ------------------------------------------------------------------ */

describe("showCharacterSheet: do_cmd_change_name keys", () => {
  it("h/Space/ArrowLeft cycle forward, l/ArrowRight backward (L1280-1289)", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    const placeholder = "Resistances & Abilities - not yet available";
    expect(term.snapshot().join("\n")).not.toContain(placeholder);
    press(win, "h"); // mode 0 -> 1
    expect(term.snapshot().join("\n")).toContain(placeholder);
    press(win, "h"); // 1 -> 0
    expect(term.snapshot().join("\n")).not.toContain(placeholder);
    press(win, " "); // Space: forward again
    expect(term.snapshot().join("\n")).toContain(placeholder);
    press(win, "l"); // backward: 1 -> 0
    expect(term.snapshot().join("\n")).not.toContain(placeholder);
    press(win, "ArrowLeft"); // forward
    expect(term.snapshot().join("\n")).toContain(placeholder);
    press(win, "ArrowRight"); // backward
    expect(term.snapshot().join("\n")).not.toContain(placeholder);
    press(win, "Escape");
  });

  it("the mode-1 page is a labelled placeholder, not a faked resist grid", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    press(win, "h");
    const text = term.snapshot().join("\n");
    expect(text).toContain("Resistances & Abilities - not yet available");
    expect(text).toContain("ui-entry");
    press(win, "Escape");
  });

  it("'c' renames through promptText and reports via onRename", async () => {
    const { state, win, term } = setup();
    const renames: string[] = [];
    const done = showCharacterSheet(term, state, "Fred", {
      onRename: (n) => renames.push(n),
    });
    press(win, "c");
    await Promise.resolve(); // promptText is now the key owner
    for (let i = 0; i < "Fred".length; i++) press(win, "Backspace"); // clear the prefill
    for (const ch of "Bob") press(win, ch);
    press(win, "Enter");
    await Promise.resolve();
    await Promise.resolve();
    expect(renames).toEqual(["Bob"]);
    expect(term.snapshot()[0]).toContain("Bob the");
    press(win, "Escape");
    await done;
  });

  it("ESC and Enter both close; the tap handler is torn down", async () => {
    const a = setup();
    const doneA = showCharacterSheet(a.term, a.state, "Fred");
    expect(a.term.hasTapHandler()).toBe(true);
    press(a.win, "Escape");
    await doneA;
    expect(a.term.hasTapHandler()).toBe(false);

    const b = setup();
    const doneB = showCharacterSheet(b.term, b.state, "Fred");
    press(b.win, "Enter");
    await doneB;
    expect(b.term.hasTapHandler()).toBe(false);
  });

  it("a body tap flips the page (upstream mouse button 1); a footer tap closes", async () => {
    const { state, win, term } = setup();
    const done = showCharacterSheet(term, state, "Fred");
    term.fireTap(10, 5);
    expect(term.snapshot().join("\n")).toContain("Resistances & Abilities");
    term.fireTap(0, term.size().rows - 1);
    await done;
    expect(term.hasTapHandler()).toBe(false);
    void win;
  });
});

/* ------------------------------------------------------------------ */
/* Narrow list (characterSheetLines) + RNG invariance                  */
/* ------------------------------------------------------------------ */

describe("characterSheetLines narrow: same 6-wide fields, blank-unless-drained Cur", () => {
  it("header and data share the exact column stops", () => {
    const { state } = setup();
    const lines = characterSheetLines(state, "Fred");
    const header = lines[0]!.text;
    const str = lines[1]!.text;
    expect(header.slice(5, 11)).toBe("  Self");
    expect(header.slice(24, 30)).toBe("  Best");
    expect(str.slice(0, 5)).toBe("STR! ");
    expect(str.slice(5, 11)).toBe("18/100");
    // No Cur header, and no echoed Best after col 30 on a non-drained row.
    expect(header.slice(30)).toBe("");
    expect(str.slice(30).trim()).toBe("");
    // The drained CON row carries the trailing yellow value at col 31.
    const con = lines[5]!;
    expect(con.text.slice(0, 4)).toBe("Con:");
    expect(con.text.slice(31).trim()).not.toBe("");
    const lastRun = con.runs![con.runs!.length - 1]!;
    expect(lastRun.color).toBe(colorToCss(COLOUR_YELLOW));
  });

  it("stat rows carry per-column runs (L_GREEN / L_BLUE)", () => {
    const { state } = setup();
    const str = characterSheetLines(state, "Fred")[1]!;
    expect(str.runs).toBeDefined();
    const colors = str.runs!.map((r) => r.color);
    expect(colors).toContain(colorToCss(COLOUR_L_GREEN));
    expect(colors).toContain(colorToCss(COLOUR_L_BLUE));
  });

  it("appends the wrapped history block and degrades cleanly when empty", () => {
    const history = "You are the only child of a Serf. You have blue eyes.";
    const { state } = setup(history);
    const lines = characterSheetLines(state, "Fred", 40);
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("only child of a Serf");
    for (const l of historyBlockLines(state, 40)) {
      expect(l.text.length).toBeLessThanOrEqual(40);
    }
    const { state: emptyState } = setup("");
    expect(historyBlockLines(emptyState, 40)).toEqual([]);
  });

  it("statHeaderLine/statRowLine agree on width for every cnv_stat shape", () => {
    const shapes = ["    16", " 18/72", "18/100", "18/***"];
    for (const natural of shapes) {
      const line = statRowLine({
        label: "STR: ",
        natural,
        raceBonus: " +1",
        classBonus: " -1",
        equipBonus: " +0",
        best: natural,
        reduced: null,
        naturalMax: false,
        drained: false,
      });
      expect(line.text.length).toBe(statHeaderLine().text.length);
    }
  });
});

describe("showCharacterSheet: RNG invariance (pure display)", () => {
  it("draws zero RNG across open, mode flips, scroll, and close", async () => {
    const { state, win, term } = setup("Some history text for the block.");
    const before = JSON.stringify(state.rng.getState());
    const done = showCharacterSheet(term, state, "Fred");
    press(win, "h");
    press(win, "l");
    press(win, "ArrowDown");
    press(win, "PageDown");
    press(win, "PageUp");
    term.fireTap(10, 5);
    press(win, "Escape");
    await done;
    expect(JSON.stringify(state.rng.getState())).toBe(before);
    // The narrow list builder is equally pure.
    characterSheetLines(state, "Fred", 40);
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });
});
