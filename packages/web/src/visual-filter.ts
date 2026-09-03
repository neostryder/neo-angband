/** The explicit consent a mod needs before it changes final canvas pixels. */
export const VISUAL_FILTER_CAPABILITY = "display:filter";

/**
 * Apply a CSS post-processing filter to the game's one terminal canvas.
 * CSS filters are evaluated after the canvas has rendered, so this is uniform
 * across ASCII, every tile mode, the dungeon, maps, and terminal-grid menus.
 */
export function setCanvasVisualFilter(canvas: HTMLCanvasElement, filter: string | null): void {
  canvas.style.filter = filter ?? "";
}
