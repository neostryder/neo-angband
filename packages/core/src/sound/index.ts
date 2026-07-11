/**
 * The sound subsystem: a platform-agnostic engine (engine.ts) plus the
 * message->sound name mapping data (sound-prefs-data.ts), ported from
 * reference/src/sound-core.c, sound.h, and reference/lib/customize/sound.prf.
 *
 * A front end supplies SoundHooks (load/play audio) and an RNG seam; the
 * core selects samples faithfully to play_sound. No audio assets are
 * bundled - the web front end loads a user-supplied pack.
 */

export * from "./types";
export * from "./engine";
export * from "./sound-prefs-data";
