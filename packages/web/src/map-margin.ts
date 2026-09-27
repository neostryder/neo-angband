/** Whole-cell strip kept outside the host's main map rectangle. */
export interface MapMargin {
  readonly edge: "top" | "right" | "bottom" | "left";
  readonly cells: number;
}

export interface MapRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Keep at least four map cells on the reserved axis, up to four strip cells. */
export function applyMapMargin(rect: MapRectangle, margin: MapMargin | null): MapRectangle {
  if (!margin) return rect;
  const horizontal = margin.edge === "left" || margin.edge === "right";
  const extent = horizontal ? rect.width : rect.height;
  const requested = Number.isFinite(margin.cells) ? Math.floor(margin.cells) : 0;
  const cells = Math.max(0, Math.min(4, extent - 4, requested));
  return {
    x: rect.x + (margin.edge === "left" ? cells : 0),
    y: rect.y + (margin.edge === "top" ? cells : 0),
    width: rect.width - (horizontal ? cells : 0),
    height: rect.height - (horizontal ? 0 : cells),
  };
}
