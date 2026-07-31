/**
 * Version constants, in their own module so any core file can cite them without
 * importing the package index (which would make a cycle).
 *
 * buildid (buildid.c:37) is VERSION_NAME " " VERSION_STRING upstream; the port
 * stamps `Angband <PARITY_BASELINE>` into content dumps whose header names the
 * release the data tracks, and its own name elsewhere.
 */

/** Upstream release this port is verified against. */
export const PARITY_BASELINE = "4.2.6";

/**
 * Port version, tracked independently of the baseline.
 *
 * 0.9.0 is the pre-release line: everything shipped goes through the crucible at
 * 0.9.x, and 1.0.0 is reserved for the public release. The bundled mods use the
 * same scheme and turn 1.0.0 with the game, not before it.
 */
export const ENGINE_VERSION = "0.9.0";
