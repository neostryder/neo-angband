import { describe, expect, it, vi } from "vitest";
import { TileMap } from "@rpgm-tools/neo-angband-core";
import { TileModeState } from "./tile-mode-state";
import type { TileBlitter } from "./tiles";

const pack = (menuname: string): TileBlitter => ({
  menuname, ready: true, onReady: null,
  drawTile: () => true, isTall: () => false,
});

describe("independent view graphics", () => {
  it("loads different packs concurrently and clears either view to ASCII independently", () => {
    const main = new TileModeState(vi.fn());
    const panel = new TileModeState(vi.fn());
    const mainLoad = main.begin(1);
    const panelLoad = panel.begin(2);
    const first = pack("first");
    const second = pack("second");
    panelLoad.publish(second, new TileMap());
    expect(main.tileset).toBeNull();
    mainLoad.publish(first, new TileMap());
    expect(panel.tileset).toBe(second);
    expect(main.tileset).toBe(first);
    main.begin(0);
    expect(main.tileMap).toBeNull();
    expect(panel.tileset).toBe(second);
    main.begin(1).publish(first, new TileMap());
    panel.begin(0);
    expect(panel.tileset).toBeNull();
    expect(panel.tileMap).toBeNull();
    expect(main.tileset).toBe(first);
  });

  it("discards old completions and image callbacks even after selecting the same pack again", () => {
    const repaint = vi.fn();
    const view = new TileModeState(repaint);
    const old = view.begin(1);
    view.begin(0);
    const current = view.begin(1);
    const loaded = pack("current");
    current.publish(loaded, new TileMap());
    repaint.mockClear();
    old.publish(pack("stale"), new TileMap());
    old.repaint();
    expect(view.tileset).toBe(loaded);
    expect(repaint).not.toHaveBeenCalled();
    current.repaint();
    expect(repaint).toHaveBeenCalledOnce();
  });
});
