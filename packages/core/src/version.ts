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
 * Standard Semantic Versioning as of 1.0.0, the public release: a breaking
 * change to the API, save format, or mod interfaces is a MAJOR bump, a
 * backward-compatible feature is MINOR, and a fix is PATCH. Before this,
 * `0.x` was the pre-release line, where every feature release bumped the
 * MINOR number instead (0.9.0 was followed by 0.10.0 rather than 1.0.0).
 *
 * Each mod carries its own version and moves on its own schedule; a mod whose
 * released tag needs to be superseded takes whatever bump its actual change
 * warrants, because a published tag is pinned by digest in a catalogue and
 * must never be moved.
 */
export const ENGINE_VERSION = "1.2.0";
