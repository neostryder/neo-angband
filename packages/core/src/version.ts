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
 * Semver, and 0.x is the pre-release line: a feature release bumps the MINOR
 * number, so 0.9.0 is followed by 0.10.0 rather than by 1.0.0. That is worth
 * stating because the first reading of "0.9.0" is "nearly 1.0", and it is not -
 * 1.0.0 is reserved for the public release and the line can run as far as it needs
 * to before then.
 *
 * Each mod carries its own version and moves on its own schedule; a mod whose
 * released tag is iterated takes a MINOR bump, because a published tag is pinned
 * by digest in a catalogue and must never be moved.
 */
export const ENGINE_VERSION = "0.22.0";
