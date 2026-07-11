/**
 * Sound subsystem types, ported from reference/src/sound.h (Angband 4.2.6).
 *
 * These are the platform-agnostic data structures and the platform hook
 * seam. The core engine (engine.ts) owns the message->sound map, the sound
 * pool, load-status tracking, and random selection; a front end supplies
 * the hooks that actually load and play audio. Nothing here touches the DOM
 * or any browser audio API.
 */

/** MAX_SOUNDS_PER_MESSAGE (sound-core.c): cap on samples mapped per message. */
export const MAX_SOUNDS_PER_MESSAGE = 16;

/**
 * enum sound_status (sound.h). UNKNOWN: nothing done yet. ERROR: the file
 * exists but the platform could not make it playable. LOADED: playable.
 * The core checks for LOADED before asking the platform to play.
 */
export enum SoundStatus {
  UNKNOWN = 0,
  ERROR = 1,
  LOADED = 2,
}

/**
 * struct sound_data (sound.h): one sound sample.
 *  name:      base name (no path, no extension)
 *  hash:      djb2 hash of name, to speed up dedup searches
 *  status:    SoundStatus (see above)
 *  platData:  platform-specific handle (the C void *plat_data); the core
 *             never inspects it, it only hands it back to the hooks.
 */
export interface SoundData {
  name: string;
  hash: number;
  status: SoundStatus;
  platData: unknown;
}

/**
 * struct sound_file_type (sound.h): a file extension the platform can load
 * and the platform-defined numeric type it maps to. `type` 0 terminates the
 * upstream array; here the list is simply finite.
 */
export interface SoundFileType {
  readonly extension: string;
  readonly type: number;
}

/**
 * struct sound_hooks (sound.h): the platform sound module. A front end
 * implements these; the core calls them. Every hook is optional so the core
 * degrades gracefully (silent) when a platform provides none.
 *
 * loadSound mirrors load_sound_hook: given a resolved filename and file
 * type it should set data.platData / data.status and return true on
 * success. supportedFiles mirrors supported_files_hook: the extensions to
 * try, in order. playSound mirrors play_sound_hook. unloadSound and the
 * open/close audio hooks round out the C struct.
 */
export interface SoundHooks {
  openAudio?: () => boolean;
  closeAudio?: () => void;
  loadSound?: (filename: string, fileType: number, data: SoundData) => boolean;
  unloadSound?: (data: SoundData) => boolean;
  playSound?: (data: SoundData) => boolean;
  supportedFiles?: () => readonly SoundFileType[];
}
