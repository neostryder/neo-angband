import { describe, expect, it } from "vitest";
import {
  COMFORTABLE_MIN_PX,
  MAIN_TILE_ID,
  computeLayout,
  dockBesideMain,
  leafIds,
  sameLayout,
  type LayoutNode,
} from "./subwindow-layout";
import {
  SUBWINDOW_CHOICES,
  autoSubwindowTree,
  firstLaunchSubwindowState,
  isAutoLayout,
  setSubwindowEnabled,
  type LayoutExtras,
  type SubwindowId,
  type SubwindowState,
} from "./subwindows";

const IDS = SUBWINDOW_CHOICES.map((choice) => choice.id);
/* Panels meant to be one or two lines tall. */
const THIN = new Set<string>(["player-topbar", "status"]);
const VIEWPORTS = [[1920, 1080], [1600, 1000], [1366, 768], [1024, 768]] as const;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function shuffled<T>(items: readonly T[], next: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function openAll(order: readonly SubwindowId[], extras?: LayoutExtras, start = firstLaunchSubwindowState()): SubwindowState {
  let state = start;
  for (const id of order) state = setSubwindowEnabled(state, id, true, extras);
  return state;
}

/** 200 panel sets of one to six panels, the same every run. */
function panelSets(): SubwindowId[][] {
  const next = rng(317);
  return Array.from({ length: 200 }, () => shuffled(IDS, next).slice(0, 1 + Math.floor(next() * 6)));
}

describe("the automatic panel layout (#317)", () => {
  it("gives the same arrangement for the same panels, whatever order they were opened in", () => {
    const next = rng(9);
    for (const set of panelSets()) {
      const first = openAll(set).tree;
      for (let i = 0; i < 5; i++) expect(sameLayout(openAll(shuffled(set, next)).tree, first)).toBe(true);
    }
  });

  it("stays automatic while panels open and close, and closing one returns the layout of the rest", () => {
    for (const set of panelSets().slice(0, 50)) {
      let state = openAll(set);
      expect(isAutoLayout(state)).toBe(true);
      const [closed, ...rest] = set;
      state = setSubwindowEnabled(state, closed!, false);
      expect(isAutoLayout(state)).toBe(true);
      expect(sameLayout(state.tree, openAll(rest).tree)).toBe(true);
    }
  });

  it("keeps every panel usable and the dungeon view large at common window sizes", () => {
    for (const set of panelSets()) {
      const tree = openAll(set).tree;
      for (const [w, h] of VIEWPORTS) {
        const tiles = computeLayout(tree, { x: 0, y: 0, w, h }).tiles;
        const main = tiles.find((tile) => tile.id === MAIN_TILE_ID)!;
        expect((main.rect.w * main.rect.h) / (w * h)).toBeGreaterThan(0.28);
        for (const tile of tiles) {
          if (tile.id === MAIN_TILE_ID || THIN.has(tile.id)) continue;
          expect(Math.min(tile.rect.w, tile.rect.h)).toBeGreaterThanOrEqual(COMFORTABLE_MIN_PX);
        }
      }
    }
  });

  it("leaves a hand-arranged layout alone and docks a new panel beside the dungeon view", () => {
    const auto = openAll(["inventory", "messages"]);
    const tree = auto.tree;
    if (tree.kind !== "split") throw new Error("expected a split");
    const resized: SubwindowState = { ...auto, tree: { ...tree, ratio: tree.ratio + 0.05 } };
    expect(isAutoLayout(resized)).toBe(false);
    const next = setSubwindowEnabled(resized, "monsters", true);
    expect(isAutoLayout(next)).toBe(false);
    expect(leafIds(next.tree)).toEqual(expect.arrayContaining(["inventory", "messages", "monsters", MAIN_TILE_ID]));
    expect(sameLayout(next.tree, openAll(["inventory", "messages", "monsters"]).tree)).toBe(false);
  });

  it("is not automatic once a panel floats", () => {
    const state = openAll(["inventory"]);
    expect(isAutoLayout({ ...state, floats: [{ id: "messages", x: 0, y: 0, width: 200, height: 100 }] })).toBe(false);
  });

  it("places mods' panels in their fixed order after the core panels", () => {
    const extras: LayoutExtras = {
      order: ["alpha:cards", "beta:bar"],
      place: (tree: LayoutNode, id: string) => dockBesideMain(tree, id, id === "beta:bar" ? "bottom" : "right"),
    };
    const base = openAll(["inventory", "messages"], extras);
    const a = autoSubwindowTree(base.enabled, ["beta:bar", "alpha:cards"], extras);
    const b = autoSubwindowTree(base.enabled, ["alpha:cards", "beta:bar"], extras);
    expect(sameLayout(a, b)).toBe(true);
    const withMods: SubwindowState = { ...base, tree: a };
    expect(isAutoLayout(withMods, extras)).toBe(true);
    const more = setSubwindowEnabled(withMods, "monsters", true, extras);
    expect(leafIds(more.tree)).toEqual(expect.arrayContaining(["alpha:cards", "beta:bar", "monsters"]));
    expect(isAutoLayout(more, extras)).toBe(true);
    expect(isAutoLayout(withMods)).toBe(false);
  });
});
