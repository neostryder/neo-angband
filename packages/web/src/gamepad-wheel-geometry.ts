/**
 * Geometry for the command wheel's DOM overlay.
 *
 * The wheel is positioned in CSS pixel space, as are pointer coordinates and
 * the canvas's bounding rectangle. Its backing-store dimensions are device
 * pixels and must not be used here: doing so would make a high-density display
 * grow the wheel beyond the surface it covers.
 */
export interface WheelSurfaceSize {
  readonly width: number;
  readonly height: number;
}

const DESKTOP_SHARE = 0.72;
const TOUCH_SHARE = 0.8;
const MAX_DIAMETER = 520;

/**
 * The diameter that fits the current canvas, in CSS pixels.
 *
 * Touch retains the larger share that gives a 44px-or-larger wedge on ordinary
 * phone widths. The desktop limit is larger because the icon-led wheel needs
 * more than its former 360px cap for its labels to remain comfortably readable.
 */
export function commandWheelDiameter(
  surface: WheelSurfaceSize,
  coarsePointer: boolean,
): number {
  const width = Number.isFinite(surface.width) ? Math.max(0, surface.width) : 0;
  const height = Number.isFinite(surface.height) ? Math.max(0, surface.height) : 0;
  const share = coarsePointer ? TOUCH_SHARE : DESKTOP_SHARE;
  return Math.round(Math.min(Math.min(width, height) * share, MAX_DIAMETER));
}
