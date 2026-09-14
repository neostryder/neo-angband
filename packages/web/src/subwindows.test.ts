import { describe, expect, it, vi } from "vitest";
import { COLOUR_RED, colorToCss } from "@rpgm-tools/neo-angband-core";
import { MessageLog } from "./messages";
import {
  MessageSubwindowPainter,
  canonicalSubwindowTree,
  dumpSubwindowLayoutPrefText,
  paintOverviewSubwindow,
  paintSubwindowLines,
  parseSubwindowStateJson,
  playerCompactLines,
  playerTopbarLines,
  readSubwindowSettings,
  readSubwindowState,
  readSubwindowDefault,
  scrollSubwindow,
  setSubwindowEnabled,
  statusSubwindowLines,
  SUBWINDOW_PREF_DIRECTIVE,
  SUBWINDOW_STORAGE_KEY,
  SUBWINDOW_DEFAULT_STORAGE_KEY,
  treeForSettings,
  writeSubwindowState,
  writeSubwindowDefault,
  type SubwindowSettings,
  type SubwindowState,
} from "./subwindows";
import { computeLayout, containsLeaf, leafIds, MAIN_TILE_ID } from "./subwindow-layout";
import type { GridSurface } from "./term";
import type { Overview } from "./mapview";
import { buildOverview } from "./mapview";

function recordingTerm(cols: number, rows: number): GridSurface & {
  text(): string[];
  colors(): (string | undefined)[][];
} {
  const chars = Array.from({ length: rows }, () => new Array(cols).fill(" "));
  const colors = Array.from({ length: rows }, () => new Array<string | undefined>(cols));
  return {
    size: () => ({ cols, rows }),
    invalidate: () => undefined,
    flush: () => undefined,
    clear: () => {
      for (const row of chars) row.fill(" ");
      for (const row of colors) row.fill(undefined);
    },
    setCursor: () => undefined,
    hideCursor: () => undefined,
    put: (x, y, glyph) => {
      if (y < 0 || y >= rows || x < 0 || x >= cols) return;
      chars[y]![x] = glyph.ch;
      colors[y]![x] = glyph.fg;
    },
    print: (x, y, text, color) => {
      for (let i = 0; i < text.length && x + i < cols; i++) {
        chars[y]![x + i] = text[i]!;
        colors[y]![x + i] = color;
      }
    },
    eraseToEol: () => undefined,
    prt: () => undefined,
    text: () => chars.map((row) => row.join("").replace(/\s+$/u, "")),
    colors: () => colors,
  };
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

const allOff: SubwindowSettings = {
  inventory: false,
  equipment: false,
  "player-basic": false,
  "player-extra": false,
  "player-compact": false,
  map: false,
  messages: false,
  overhead: false,
  "monster-recall": false,
  "object-recall": false,
  monsters: false,
  status: false,
  items: false,
  "player-topbar": false,
};

describe("subwindow settings", () => {
  it("keeps the map pack through toggles, reloads, and pref-file save/restore with all panels closed", () => {
    const storage = memoryStorage();
    let state: SubwindowState = { ...readSubwindowState(storage), mapTileMode: 3 };
    state = setSubwindowEnabled(state, "map", true);
    const closed = setSubwindowEnabled(state, "map", false);
    writeSubwindowState(storage, closed);
    expect(readSubwindowState(storage).mapTileMode).toBe(3);
    const pref = dumpSubwindowLayoutPrefText(closed);
    const restored = parseSubwindowStateJson(pref.slice(SUBWINDOW_PREF_DIRECTIVE.length + 1));
    expect(restored?.mapTileMode).toBe(3);
    expect(restored?.enabled.map).toBe(false);
  });

  it.each([undefined, null, "3", -1, 1.5, {}, 1e30])("defaults malformed or missing map modes to ASCII: %j", (value) => {
    const storage = memoryStorage();
    const data = { v: 2, enabled: { ...allOff, map: true }, tree: treeForSettings(allOff), mapTileMode: value };
    storage.setItem(SUBWINDOW_STORAGE_KEY, JSON.stringify(data));
    expect(readSubwindowState(storage).mapTileMode).toBe(0);
    expect(parseSubwindowStateJson(JSON.stringify(data))?.mapTileMode).toBe(0);
  });

  it("defaults to the unchanged single-window layout and survives storage", () => {
    const storage = memoryStorage();
    expect(readSubwindowSettings(storage)).toEqual(allOff);
    const enabled = { ...allOff, messages: true, inventory: true, items: true };
    writeSubwindowState(storage, { enabled, tree: treeForSettings(enabled) });
    expect(readSubwindowSettings(storage)).toEqual(enabled);
    const roundTrip = readSubwindowState(storage);
    expect(leafIds(roundTrip.tree).sort()).toEqual(["inventory", "items", "messages", MAIN_TILE_ID].sort());
    writeSubwindowState(storage, { enabled: allOff, tree: { kind: "leaf", id: MAIN_TILE_ID } });
    expect(storage.values.has(SUBWINDOW_STORAGE_KEY)).toBe(false);
  });

  it("migrates the previous four-boolean store into a tiled tree", () => {
    const storage = memoryStorage();
    storage.setItem(
      SUBWINDOW_STORAGE_KEY,
      JSON.stringify({ messages: true, inventory: true, monsters: false, items: true }),
    );
    const state = readSubwindowState(storage);
    expect(state.enabled.messages).toBe(true);
    expect(state.enabled.inventory).toBe(true);
    expect(state.enabled.items).toBe(true);
    expect(state.enabled.monsters).toBe(false);
    expect(state.enabled.overhead).toBe(false);
    expect(containsLeaf(state.tree, "messages")).toBe(true);
    expect(containsLeaf(state.tree, "inventory")).toBe(true);
    expect(containsLeaf(state.tree, MAIN_TILE_ID)).toBe(true);
    const { tiles, splitters } = computeLayout(state.tree, { x: 0, y: 0, w: 1200, h: 800 });
    const covered = tiles.reduce((sum, tile) => sum + tile.rect.w * tile.rect.h, 0)
      + splitters.reduce((sum, splitter) => sum + splitter.rect.w * splitter.rect.h, 0);
    expect(covered).toBe(1200 * 800);
  });

  it("inserts a newly enabled panel into the tree and removes it again", () => {
    let state = readSubwindowState(memoryStorage());
    state = setSubwindowEnabled(state, "messages", true);
    expect(state.enabled.messages).toBe(true);
    expect(containsLeaf(state.tree, "messages")).toBe(true);
    state = setSubwindowEnabled(state, "messages", false);
    expect(state.enabled.messages).toBe(false);
    expect(containsLeaf(state.tree, "messages")).toBe(false);
    expect(leafIds(state.tree)).toEqual([MAIN_TILE_ID]);
  });
});

describe("personal subwindow default (#236)", () => {
  it("snapshots the current tree independently of subsequent live layout changes", () => {
    const storage = memoryStorage();
    const live = setSubwindowEnabled(readSubwindowState(storage), "messages", true);
    if (live.tree.kind !== "split") throw new Error("Expected a split layout");
    live.tree.ratio = 0.43;
    writeSubwindowState(storage, live);
    const originalLive = storage.getItem(SUBWINDOW_STORAGE_KEY);
    // A round trip through the v2 JSON shape always normalises mapTileMode to
    // a concrete number (see readSubwindowState), so the values compared
    // against a saved-then-reloaded default carry it even though the
    // in-memory `live` object, never itself serialised, does not.
    const expected = { ...structuredClone(live), mapTileMode: 0 };
    expect(writeSubwindowDefault(storage, live)).toBe(true);
    expect(storage.getItem(SUBWINDOW_STORAGE_KEY)).toBe(originalLive);
    live.tree.ratio = 0.61;
    const disturbed = setSubwindowEnabled(live, "inventory", true);
    writeSubwindowState(storage, disturbed);
    const saved = readSubwindowDefault(storage);
    expect(saved).toEqual(expected);
    expect(saved).not.toBe(live);
    writeSubwindowState(storage, saved!);
    expect(readSubwindowState(storage)).toEqual(expected);
    if (saved!.tree.kind === "split") saved!.tree.ratio = 0.7;
    expect(readSubwindowDefault(storage)).toEqual(expected);
    expect(writeSubwindowDefault(storage, disturbed)).toBe(true);
    expect(readSubwindowDefault(storage)).toEqual({ ...disturbed, mapTileMode: 0 });
  });

  it("preserves and restores a default with every panel disabled", () => {
    const storage = memoryStorage();
    const empty = readSubwindowState(storage);
    expect(writeSubwindowDefault(storage, empty)).toBe(true);
    writeSubwindowState(storage, setSubwindowEnabled(empty, "messages", true));
    const saved = readSubwindowDefault(storage);
    expect(saved).toEqual({ ...empty, mapTileMode: 0 });
    writeSubwindowState(storage, saved!);
    expect(storage.getItem(SUBWINDOW_STORAGE_KEY)).toBeNull();
    expect(readSubwindowDefault(storage)).toEqual({ ...empty, mapTileMode: 0 });
  });

  it.each([null, "{not json", "null", "{}", '{"tree":{"kind":"leaf","id":"messages"}}'])(
    "leaves live storage untouched when the saved default is absent or malformed (%s)",
    (raw) => {
      const storage = memoryStorage();
      const live = setSubwindowEnabled(readSubwindowState(storage), "inventory", true);
      writeSubwindowState(storage, live);
      if (raw !== null) storage.setItem(SUBWINDOW_DEFAULT_STORAGE_KEY, raw);
      const before = new Map(storage.values);
      expect(readSubwindowDefault(storage)).toBeNull();
      expect(storage.values).toEqual(before);
    },
  );

  it("reports unavailable storage without throwing", () => {
    const storage = {
      getItem: () => { throw new Error("Storage unavailable"); },
      setItem: () => { throw new Error("Quota exceeded"); },
    };
    expect(readSubwindowDefault(storage)).toBeNull();
    expect(writeSubwindowDefault(storage, readSubwindowState(memoryStorage()))).toBe(false);
  });
});

describe("neo-subwindows pref-file serialisation (#238)", () => {
  it("dumps and re-parses the same enabled set and tree", () => {
    const enabled = { ...allOff, messages: true, inventory: true, items: true };
    const state = { enabled, tree: treeForSettings(enabled) };
    const line = dumpSubwindowLayoutPrefText(state);
    expect(line.startsWith(`${SUBWINDOW_PREF_DIRECTIVE}:`)).toBe(true);
    expect(line.endsWith("\n")).toBe(true);
    const json = line.slice(`${SUBWINDOW_PREF_DIRECTIVE}:`.length, -1);
    const roundTrip = parseSubwindowStateJson(json);
    expect(roundTrip).not.toBeNull();
    expect(roundTrip!.enabled).toEqual(enabled);
    expect(leafIds(roundTrip!.tree).sort()).toEqual(leafIds(state.tree).sort());
  });

  it("returns null for malformed JSON rather than throwing", () => {
    expect(parseSubwindowStateJson("{not json")).toBeNull();
  });

  it("returns null when the tree is missing the main tile", () => {
    expect(
      parseSubwindowStateJson(JSON.stringify({ enabled: allOff, tree: { kind: "leaf", id: "messages" } })),
    ).toBeNull();
  });

  it("ignores unknown ids and defaults missing ones to false when reading enabled", () => {
    const json = JSON.stringify({
      enabled: { messages: true, "not-a-real-id": true },
      tree: { kind: "leaf", id: MAIN_TILE_ID },
    });
    const state = parseSubwindowStateJson(json);
    expect(state).not.toBeNull();
    expect(state!.enabled.messages).toBe(true);
    expect(state!.enabled.inventory).toBe(false);
    expect(containsLeaf(state!.tree, "messages")).toBe(true);
  });
});

describe("canonical default tree (#236)", () => {
  it("places a full multi-panel layout around a still-substantial main view", () => {
    const tree = canonicalSubwindowTree();
    expect(leafIds(tree).sort()).toEqual(
      [
        MAIN_TILE_ID,
        "player-basic",
        "player-extra",
        "equipment",
        "inventory",
        "map",
        "messages",
        "monsters",
        "items",
        "monster-recall",
        "object-recall",
      ].sort(),
    );
    const { tiles } = computeLayout(tree, { x: 0, y: 0, w: 1600, h: 900 });
    const main = tiles.find((tile) => tile.id === MAIN_TILE_ID)!.rect;
    expect(main.w * main.h).toBeGreaterThan(1600 * 900 * 0.25);
  });

  it("leaves every panel this tree does not place to DEFAULT_DOCK's own fallback", () => {
    const tree = canonicalSubwindowTree();
    for (const id of ["overhead", "player-compact", "status", "player-topbar"] as const) {
      expect(containsLeaf(tree, id)).toBe(false);
    }
  });
});

describe("subwindow terminal painting", () => {
  it("preserves cave coordinates, foreground tiles and terrain beneath a map panel's player", () => {
    const terrain = { kind: "canvas-tile", key: "floor", data: {} };
    const monster = { kind: "canvas-tile", key: "monster", data: {}, tall: true };
    const player = { kind: "canvas-tile", key: "player", data: {} };
    const featureGlyph = vi.fn(() => ({ ch: ".", css: "#444", priority: 1, tile: terrain }));
    const overview = buildOverview({
      width: 4, height: 2, mapW: 2, mapH: 1,
      knownFeatAt: () => 1,
      featureGlyph,
      monsterGlyphAt: (x, y) => x === 2 && y === 0 ? { ch: "M", css: "#fff", tile: monster } : null,
      playerGrid: { x: 0, y: 0 },
      playerGlyph: { ch: "@", css: "#fff", tile: player },
    }, true);
    expect(featureGlyph).toHaveBeenCalledWith(1, 2, 0);
    const term = recordingTerm(2, 1);
    const put = vi.spyOn(term, "put");
    paintOverviewSubwindow(term, overview, true);
    expect(put).toHaveBeenCalledWith(1, 0, { ch: "M", fg: "#fff", tile: monster, bgTile: terrain });
    expect(put).toHaveBeenLastCalledWith(0, 0, { ch: "@", fg: "#fff", tile: player, bgTile: terrain });
    put.mockClear();
    paintOverviewSubwindow(term, overview);
    expect(put).toHaveBeenCalledWith(1, 0, { ch: "M", fg: "#fff" });
    expect(put).toHaveBeenLastCalledWith(0, 0, { ch: "@", fg: "#fff" });
  });

  it("bottom-aligns the newest message rows", () => {
    const term = recordingTerm(20, 4);
    paintSubwindowLines(term, [{ text: "older" }, { text: "newest" }], true);
    expect(term.text()).toEqual(["", "", "older", "newest"]);
  });

  it("marks only messages since the previous refresh red", () => {
    const term = recordingTerm(30, 4);
    const log = new MessageLog();
    const painter = new MessageSubwindowPainter();
    log.push("older", "#00ff00");
    painter.paint(term, log);
    log.push("newest", "#00ffff");
    painter.paint(term, log);
    expect(term.text()).toEqual(["", "", "older", "newest"]);
    expect(term.colors()[2]![0]).toBe("#00ff00");
    expect(term.colors()[3]![0]).toBe(colorToCss(COLOUR_RED));
  });

  it("re-wraps unchanged messages to each panel's own size", () => {
    const first = recordingTerm(30, 4);
    const resized = recordingTerm(12, 2);
    const log = new MessageLog();
    const painter = new MessageSubwindowPainter();
    log.push("a message long enough to clip", "#00ff00");
    painter.paint(first, log);
    painter.paint(resized, log);
    // Word-wrapped at 12 columns this message is three physical rows ("a
    // message" / "long enough" / "to clip"); a 2-row bottom-anchored panel
    // shows only the tail of its own independent wrap, not a truncation of
    // the wider panel's.
    expect(resized.text()).toEqual(["long enough", "to clip"]);
  });

  it("lays compact player fields in upstream's compact-subwindow order", () => {
    const lines = playerCompactLines([
      { key: "race", runs: [{ text: "Human", color: 1 }] },
      { key: "title", runs: [{ text: "Warrior", color: 1 }] },
      { key: "class", runs: [{ text: "Ranger", color: 1 }] },
      { key: "hp", runs: [{ text: "HP  20/  20", color: 1 }] },
    ]);
    expect(lines[0]!.text).toBe("Human");
    expect(lines[1]!.text).toBe("Ranger");
    expect(lines[2]!.text).toBe("Warrior");
    expect(lines[14]!.text).toBe("HP  20/  20");
  });

  it("wraps the status line across the panel width", () => {
    const lines = statusSubwindowLines(
      [
        { key: "hunger", runs: [{ text: "Fed ", color: 1 }] },
        { key: "state", runs: [{ text: "Resting ", color: 2 }] },
      ],
      8,
    );
    expect(lines.map((line) => line.text).join("")).toBe("Fed Resting ");
    expect(lines[0]!.text.length).toBeLessThanOrEqual(8);
  });

  it("puts topbar vitals on the first two rows and status beneath", () => {
    const lines = playerTopbarLines(
      [
        { key: "level", runs: [{ text: "LEVEL 1", color: 1 }] },
        { key: "hp", runs: [{ text: "HP 10/10", color: 1 }] },
      ],
      [{ key: "hunger", runs: [{ text: "Fed ", color: 1 }] }],
      40,
    );
    expect(lines[0]!.text).toContain("LEVEL 1");
    expect(lines[1]!.text).toContain("HP 10/10");
    expect(lines[2]!.text).toContain("Fed");
  });

  it("wraps a line across physical rows on word boundaries", () => {
    const term = recordingTerm(10, 5);
    paintSubwindowLines(term, [{ text: "one two three four" }]);
    expect(term.text()).toEqual(["one two", "three four", "", "", ""]);
  });

  it("hard-splits a single token longer than the panel width", () => {
    const term = recordingTerm(5, 3);
    paintSubwindowLines(term, [{ text: "abcdefgh" }]);
    expect(term.text()).toEqual(["abcde", "fgh", ""]);
  });

  it("preserves each wrapped row's own colour when a multi-colour line splits on a word boundary", () => {
    const term = recordingTerm(4, 2);
    paintSubwindowLines(term, [
      { text: "red blue", runs: [{ text: "red ", color: "red" }, { text: "blue", color: "blue" }] },
    ]);
    expect(term.text()).toEqual(["red", "blue"]);
    expect(term.colors()[0]![0]).toBe("red");
    expect(term.colors()[1]![0]).toBe("blue");
  });

  it("paints an overhead miniature onto the term, including the player", () => {
    const term = recordingTerm(8, 6);
    const overview: Overview = {
      cells: [
        [{ ch: "#", css: "#888" }, { ch: ".", css: "#444" }],
        [{ ch: ".", css: "#444" }, { ch: ".", css: "#444" }],
      ],
      mapW: 2,
      mapH: 2,
      playerRow: 1,
      playerCol: 1,
      playerGlyph: { ch: "@", css: "#fff" },
    };
    paintOverviewSubwindow(term, overview);
    const rows = term.text();
    expect(rows.some((row) => row.includes("#"))).toBe(true);
    expect(rows.some((row) => row.includes("@"))).toBe(true);
  });
});

describe("tiled panel scroll (#258)", () => {
  it("scrolls a top-anchored panel toward later content and clamps at the end", () => {
    const term = recordingTerm(10, 2);
    const lines = ["row0", "row1", "row2", "row3", "row4"].map((text) => ({ text }));
    scrollSubwindow(term, 100);
    paintSubwindowLines(term, lines);
    expect(term.text()).toEqual(["row3", "row4"]);
    scrollSubwindow(term, 100);
    paintSubwindowLines(term, lines);
    expect(term.text()).toEqual(["row3", "row4"]);
  });

  it("scrolls a bottom-anchored panel toward earlier content and clamps at the start", () => {
    const term = recordingTerm(10, 2);
    const lines = ["row0", "row1", "row2", "row3", "row4"].map((text) => ({ text }));
    paintSubwindowLines(term, lines, true);
    expect(term.text()).toEqual(["row3", "row4"]);
    scrollSubwindow(term, -2);
    paintSubwindowLines(term, lines, true);
    expect(term.text()).toEqual(["row1", "row2"]);
    scrollSubwindow(term, -100);
    paintSubwindowLines(term, lines, true);
    expect(term.text()).toEqual(["row0", "row1"]);
  });

  it("self-corrects a scroll position that overshoots after the content shrinks", () => {
    const term = recordingTerm(10, 2);
    const long = ["row0", "row1", "row2", "row3", "row4"].map((text) => ({ text }));
    scrollSubwindow(term, -100);
    paintSubwindowLines(term, long, true);
    expect(term.text()).toEqual(["row0", "row1"]);
    const short = ["row0", "row1"].map((text) => ({ text }));
    paintSubwindowLines(term, short, true);
    expect(term.text()).toEqual(["row0", "row1"]);
  });

  it("forces MessageSubwindowPainter to repaint on a scroll change alone, with no log change", () => {
    const term = recordingTerm(30, 2);
    const log = new MessageLog();
    const painter = new MessageSubwindowPainter();
    log.push("a", "#00ff00");
    log.push("b", "#00ff00");
    log.push("c", "#00ff00");
    painter.paint(term, log);
    expect(term.text()).toEqual(["b", "c"]);
    scrollSubwindow(term, -1);
    painter.paint(term, log);
    expect(term.text()).toEqual(["a", "b"]);
  });
});
