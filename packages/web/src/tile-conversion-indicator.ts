/**
 * Terminal-HUD feedback for an on-demand Linoleum conversion (#124).
 *
 * This stays independent of the converter and of the canvas: the cache tells
 * the shell exactly when it has a real cache miss, and the shell paints this
 * glyph in its normal render pass.  Keeping the state here lets the display
 * timer animate it without manufacturing a DOM overlay over the terminal.
 */

const SPINNER_FRAMES = ["|", "/", "-", "\\"] as const;

const activeConversions = new Set<string>();

/** Start showing conversion feedback for this cache miss. */
export function beginTileConversion(id: string): void {
  activeConversions.add(id);
}

/** Stop showing feedback for this cache miss. Safe after a cancelled selection. */
export function finishTileConversion(id: string): void {
  activeConversions.delete(id);
}

/** Whether at least one source atlas is still being converted. */
export function tileConversionInProgress(): boolean {
  return activeConversions.size > 0;
}

/** The one-cell rotating terminal glyph, or null when there is no conversion. */
export function tileConversionSpinner(frame: number): string | null {
  if (!tileConversionInProgress()) return null;
  return SPINNER_FRAMES[frame % SPINNER_FRAMES.length]!;
}

/** Paint the spinner in the terminal's lower-right reserved HUD cell. */
export function paintTileConversionIndicator(
  surface: { print(x: number, y: number, text: string, fg: string): void },
  cols: number,
  rows: number,
  frame: number,
  color: string,
): void {
  const spinner = tileConversionSpinner(frame);
  if (spinner !== null && cols > 1) surface.print(cols - 2, rows - 1, spinner, color);
}

export function tileConversionStartedNotice(packName: string): string {
  return `Converting ${packName} tiles...`;
}

export function tileConversionFinishedNotice(packName: string): string {
  return `${packName} tiles are ready.`;
}
