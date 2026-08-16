/**
 * The visuals subsystem: a platform-agnostic color-cycle + legacy flicker
 * animation engine (engine.ts) and the graphics-mode catalog (grafmode.ts),
 * ported from reference/src/ui-visuals.c and reference/src/grafmode.c
 * (Angband 4.2.6).
 *
 * A front end owns the frame timer and the glyph/tile draw; the core returns
 * the COLOUR_* attr to draw for a given animation frame. The tile IMAGE assets
 * for all six graphics modes ship with the web build (packages/web/public/tiles);
 * ASCII stays the default.
 */

export * from "./engine.js";
export * from "./glyph-table.js";
export * from "./grafmode.js";
export * from "./hallucination.js";
export * from "./map-text.js";
export * from "./object-glyph.js";
export * from "./pref-expr.js";
export * from "./prefs.js";
export * from "./tile-prefs.js";
