/**
 * The visuals subsystem: a platform-agnostic color-cycle + legacy flicker
 * animation engine (engine.ts) and the graphics-mode catalog (grafmode.ts),
 * ported from reference/src/ui-visuals.c and reference/src/grafmode.c
 * (Angband 4.2.6).
 *
 * A front end owns the frame timer and the glyph/tile draw; the core returns
 * the COLOUR_* attr to draw for a given animation frame. No tile IMAGE assets
 * are bundled - the web front end loads a user-supplied tile pack, and ASCII
 * stays the default.
 */

export * from "./engine";
export * from "./grafmode";
export * from "./tile-prefs";
