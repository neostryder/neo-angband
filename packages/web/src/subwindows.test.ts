import { describe, expect, it } from "vitest";
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
  setSubwindowEnabled,
  statusSubwindowLines,
  SUBWINDOW_PREF_DIRECTIVE,
  SUBWINDOW_STORAGE_KEY,
  SUBWINDOW_DEFAULT_STORAGE_KEY,
  treeForSettings,
  writeSubwindowState,
  writeSubwindowDefault,
  type SubwindowSettings,
} from "./subwindows";
import { computeLayout, containsLeaf, leafIds, MAIN_TILE_ID } from "./subwindow-layout";
import type { GridSurface } from "./term";
import type { Overview } from "./mapview";

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
    const expected = structuredClone(live);
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
    expect(readSubwindowDefault(storage)).toEqual(disturbed);
  });

  it("preserves and restores a default with every panel disabled", () => {
    const storage = memoryStorage();
    const empty = readSubwindowState(storage);
    expect(writeSubwindowDefault(storage, empty)).toBe(true);
    writeSubwindowState(storage, setSubwindowEnabled(empty, "messages", true));
    const saved = readSubwindowDefault(storage);
    expect(saved).toEqual(empty);
    writeSubwindowState(storage, saved!);
    expect(storage.getItem(SUBWINDOW_STORAGE_KEY)).toBeNull();
    expect(readSubwindowDefault(storage)).toEqual(empty);
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

  it("repaints unchanged messages after the panel grid changes size", () => {
    const first = recordingTerm(30, 4);
    const resized = recordingTerm(12, 2);
    const log = new MessageLog();
    const painter = new MessageSubwindowPainter();
    log.push("a message long enough to clip", "#00ff00");
    painter.paint(first, log);
    painter.paint(resized, log);
    expect(resized.text()).toEqual(["", "a message lo"]);
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
