import type { Api2DisplayHit, Api2DisplaySnapshot } from "@rpgm-tools/neo-angband-mod-sdk";

export interface DisplayMapLayer {
  readonly canvas: HTMLCanvasElement;
  readonly origin: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
}

export function displayCellAt(
  cell: { col: number; row: number } | null,
  snapshot: Api2DisplaySnapshot,
  clientX: number,
  clientY: number,
  map?: DisplayMapLayer,
): Api2DisplayHit | null {
  if (!cell || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  if (snapshot.mode === "store" || snapshot.mode === "modal") return { cell, grid: null };
  if (map) {
    const rect = map.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return { cell, grid: x >= 0 && x < 1 && y >= 0 && y < 1
      ? { x: map.origin.x + Math.floor(x * map.width), y: map.origin.y + Math.floor(y * map.height) }
      : null };
  }
  const view = snapshot.viewport;
  const x = cell.col - view.screenOrigin.x;
  const y = cell.row - view.screenOrigin.y;
  const width = snapshot.mode === "map" ? Math.min(snapshot.grid.cols - 2, view.size.width) : view.size.width;
  const height = snapshot.mode === "map" ? Math.min(snapshot.grid.rows - 2, view.size.height) : view.size.height;
  if (x < 0 || y < 0 || x >= width || y >= height) return { cell, grid: null };
  const grid = snapshot.mode === "map"
    ? { x: view.origin.x + Math.floor((x + 0.5) * view.size.width / width), y: view.origin.y + Math.floor((y + 0.5) * view.size.height / height) }
    : { x: view.origin.x + x, y: view.origin.y + y };
  return { cell, grid: grid.x < snapshot.level.width && grid.y < snapshot.level.height ? grid : null };
}

export function displayFrame(canvas: HTMLCanvasElement, map?: DisplayMapLayer): ImageData | null {
  const copy = canvas.ownerDocument.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const context = copy.getContext("2d");
  if (!context) return null;
  context.drawImage(canvas, 0, 0);
  if (map) {
    const base = canvas.getBoundingClientRect();
    const rect = map.canvas.getBoundingClientRect();
    if (base.width > 0 && base.height > 0) {
      const sx = canvas.width / base.width;
      const sy = canvas.height / base.height;
      context.drawImage(map.canvas, (rect.left - base.left) * sx, (rect.top - base.top) * sy, rect.width * sx, rect.height * sy);
    }
  }
  return context.getImageData(0, 0, copy.width, copy.height);
}
