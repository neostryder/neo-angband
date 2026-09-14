import { GRAPHICS_NONE } from "@rpgm-tools/neo-angband-core";
import type { TileMap } from "@rpgm-tools/neo-angband-core";
import type { TileBlitter } from "./tiles";

/** One view's graphics resources, with stale asynchronous loads discarded. */
export class TileModeState {
  grafID = GRAPHICS_NONE;
  tileset: TileBlitter | null = null;
  tileMap: TileMap | null = null;
  private generation = 0;

  constructor(private readonly repaint: () => void) {}

  begin(grafID: number) {
    const generation = ++this.generation;
    this.grafID = grafID;
    this.tileset = null;
    this.tileMap = null;
    this.repaint();
    const isCurrent = (): boolean => generation === this.generation;
    return {
      isCurrent,
      repaint: (): void => { if (isCurrent()) this.repaint(); },
      publish: (tileset: TileBlitter | null, tileMap: TileMap | null): void => {
        if (!isCurrent()) return;
        this.tileset = tileset;
        this.tileMap = tileMap;
        this.repaint();
      },
    };
  }
}
