/**
 * Core sound engine, ported from reference/src/sound-core.c (Angband 4.2.6).
 *
 * This is the front-end-agnostic half of the sound subsystem: it owns the
 * message->sound map (message_sounds[]), the deduplicated sound pool
 * (sounds[] / next_sound_id), load-status tracking, and the random sample
 * selection in play_sound. A platform supplies the SoundHooks that actually
 * load and play audio; the core has no DOM or audio-API dependency.
 *
 * Faithful details preserved from the C:
 *  - djb2_hash + name compare dedup so a sample used by many messages gets
 *    one shared sound id (message_sound_define, L179).
 *  - The MAX_SOUNDS_PER_MESSAGE - 1 cap (the C uses `< (MAX - 1)`, so a
 *    message keeps at most 15 samples, not 16 - replicated exactly).
 *  - Selection via randint0(num_sounds) over the message's sample ids
 *    (play_sound, L320), through an injected RNG seam for determinism.
 *  - Lazy load: an UNKNOWN sound is loaded just before its first play;
 *    preload loads it as soon as it is assigned to a message.
 */

import type { GameEvents, MessageEventData } from "../events";
import { MESSAGE_ENTRIES } from "../generated/message";
import { SoundStatus, MAX_SOUNDS_PER_MESSAGE } from "./types";
import type { SoundData, SoundHooks } from "./types";

/** djb2_hash (z-util.c): hash * 33 + c, seeded at 5381, in uint32. */
export function djb2Hash(str: string): number {
  let hash = 5381 >>> 0;
  for (let i = 0; i < str.length; i++) {
    // ((hash << 5) + hash) + c, kept in uint32 with Math.imul(hash, 33).
    hash = (Math.imul(hash, 33) + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** message_lookup_by_name: MSG_ index for a name, or -1 (message.c). */
export function messageLookupByName(name: string): number {
  for (let i = 0; i < MESSAGE_ENTRIES.length; i++) {
    if (MESSAGE_ENTRIES[i]!.name === name) return i;
  }
  return -1;
}

/** struct msg_snd_data (sound-core.c): a message's mapped sample ids. */
interface MsgSndData {
  numSounds: number;
  soundIds: number[];
}

/** The RNG seam: randint0(n) yields 0..n-1. Inject the game's RNG. */
export type Randint0 = (n: number) => number;

export interface SoundEngineOptions {
  /** Platform hooks; omit for a fully silent (no-op) engine. */
  hooks?: SoundHooks;
  /** randint0 seam (defaults to a non-deterministic Math.random helper). */
  randint0?: Randint0;
  /** If true, load each sound as soon as it is assigned to a message. */
  preload?: boolean;
}

function defaultRandint0(n: number): number {
  return Math.floor(Math.random() * n);
}

/**
 * The sound engine: mirrors the file-scope state of sound-core.c
 * (message_sounds[], sounds[], next_sound_id, preload_sounds, hooks) as an
 * instantiable object.
 */
export class SoundEngine {
  /** message_sounds[MSG_MAX]: sample ids mapped to each message type. */
  private messageSounds: MsgSndData[] = MESSAGE_ENTRIES.map(() => ({
    numSounds: 0,
    soundIds: [],
  }));

  /** sounds[]: the deduplicated sample pool (index == sound id). */
  private sounds: SoundData[] = [];

  /** next_sound_id: number of pool entries assigned so far. */
  private nextSoundId = 0;

  private hooks: SoundHooks;
  private randint0: Randint0;
  private preloadSounds: boolean;

  /** The bound "sound" handler, kept so it can be removed on close. */
  private soundHandler: ((type: "sound", data: MessageEventData) => void) | null =
    null;

  constructor(opts: SoundEngineOptions = {}) {
    this.hooks = opts.hooks ?? {};
    this.randint0 = opts.randint0 ?? defaultRandint0;
    this.preloadSounds = opts.preload ?? false;
  }

  /**
   * set_preloaded_sounds: switch immediate-vs-lazy loading. Returns the
   * previous setting, exactly like the C.
   */
  setPreloadedSounds(newSetting: boolean): boolean {
    const old = this.preloadSounds;
    this.preloadSounds = newSetting;
    return old;
  }

  /** Install platform hooks after construction (mirrors init_sound wiring). */
  setHooks(hooks: SoundHooks): void {
    this.hooks = hooks;
  }

  /**
   * load_sound (sound-core.c, L127): try each platform-supported file type
   * until the platform reports it can play the sound. The C builds a path
   * under ANGBAND_DIR_SOUNDS and checks file_exists before each attempt; the
   * platform-agnostic core delegates path resolution and existence to the
   * loadSound hook, which sets data.status (LOADED on success).
   */
  private loadSound(data: SoundData): void {
    if (!this.hooks.loadSound || !this.hooks.supportedFiles) return;
    const supported = this.hooks.supportedFiles();
    let loaded = false;
    for (const sf of supported) {
      if (loaded) break;
      loaded = this.hooks.loadSound(data.name, sf.type, data);
    }
    // On total failure the C logs and leaves status ERROR/UNKNOWN as the
    // hook set it; nothing else to do here.
  }

  /**
   * message_sound_define (sound-core.c, L179): assign a space-separated list
   * of sample names to a message type. New names join the shared pool (with
   * djb2 dedup); each name is appended to the message's id list up to the
   * MAX_SOUNDS_PER_MESSAGE - 1 cap.
   */
  messageSoundDefine(messageId: number, soundsStr: string): void {
    const msg = this.messageSounds[messageId];
    if (!msg) return;

    // Delete any existing mapping of message id to sound ids.
    msg.numSounds = 0;
    msg.soundIds = [];

    // sounds_str is a space separated list of sound names. The C tokenizer
    // splits on single spaces; replicate by splitting on " " and dropping
    // the empty tokens that runs of spaces would produce (strchr-based walk).
    const tokens = soundsStr.split(" ").filter((t) => t.length > 0);

    for (const token of tokens) {
      const hash = djb2Hash(token);

      // Have we already processed this sound name?
      let found = false;
      let soundId = 0;
      for (let i = 0; i < this.nextSoundId && !found; i++) {
        if (this.sounds[i]!.hash === hash && this.sounds[i]!.name === token) {
          found = true;
          soundId = i;
        }
      }

      if (!found) {
        soundId = this.nextSoundId;
        // Add the new sound to the pool (grow_sound_list is implicit here).
        const entry: SoundData = {
          name: token,
          hash,
          status: SoundStatus.UNKNOWN,
          platData: null,
        };
        this.sounds[soundId] = entry;
        if (this.preloadSounds) this.loadSound(entry);
        this.nextSoundId++;
      }

      // Add this sound (by id) to the message->sounds map. The C caps at
      // MAX_SOUNDS_PER_MESSAGE - 1 (an off-by-one that keeps at most 15).
      if (msg.numSounds < MAX_SOUNDS_PER_MESSAGE - 1) {
        msg.soundIds[msg.numSounds] = soundId;
        msg.numSounds++;
      }
    }
  }

  /**
   * play_sound (sound-core.c, L309): pick one of the message's samples at
   * random, lazily load it if still UNKNOWN, and play it only if LOADED.
   * A no-op when the message has no sounds or no play hook is installed.
   */
  playSound(messageType: number): void {
    if (!this.hooks.playSound) return;

    const msg = this.messageSounds[messageType];
    if (!msg || msg.numSounds === 0) return; // No sounds for this message.

    const s = this.randint0(msg.numSounds);
    const soundId = msg.soundIds[s]!;
    const sound = this.sounds[soundId];
    if (!sound) return;

    // Ensure the sound is loaded before we play it.
    if (sound.status === SoundStatus.UNKNOWN) this.loadSound(sound);

    // Only bother playing it if the platform can.
    if (sound.status === SoundStatus.LOADED) this.hooks.playSound(sound);
  }

  /**
   * Load the message->sound map from parsed sound.prf entries. Faithful to
   * register_sound_pref_parser + parse_prefs_sound: each entry's type name
   * is resolved via message_lookup_by_name, then message_sound_define is
   * applied. Entries with an unknown message name are skipped (upstream
   * returns PARSE_ERROR_INVALID_MESSAGE for that line).
   */
  loadPrefs(entries: readonly { type: string; sounds: string }[]): void {
    for (const e of entries) {
      const idx = messageLookupByName(e.type);
      if (idx < 0) continue;
      this.messageSoundDefine(idx, e.sounds);
    }
  }

  /**
   * init_sound (sound-core.c, L356): open the platform audio and subscribe
   * to the EVENT_SOUND stream. Returns true on success. The core-agnostic
   * form takes the game event bus to subscribe on.
   */
  init(events: GameEvents): boolean {
    if (this.hooks.openAudio && !this.hooks.openAudio()) return false;
    this.soundHandler = (_type, data): void => this.playSound(data.type);
    events.on("sound", this.soundHandler);
    // Mark as inited even with no open hook, matching a module that just
    // installs a play hook; is_sound_inited keys off the pool below.
    return true;
  }

  /**
   * close_sound (sound-core.c, L392): unload every pooled sound, free the
   * pool, and close platform audio. Detaches the event handler too.
   */
  close(events?: GameEvents): void {
    if (events && this.soundHandler) {
      events.off("sound", this.soundHandler);
    }
    this.soundHandler = null;

    if (this.nextSoundId !== 0 && this.hooks.unloadSound) {
      for (let i = 0; i < this.nextSoundId; i++) {
        this.hooks.unloadSound(this.sounds[i]!);
      }
    }
    this.sounds = [];
    this.nextSoundId = 0;
    for (const m of this.messageSounds) {
      m.numSounds = 0;
      m.soundIds = [];
    }
    if (this.hooks.closeAudio) this.hooks.closeAudio();
  }

  /** is_sound_inited (sound-core.c, L423): a pool means it was opened. */
  isSoundInited(): boolean {
    return this.nextSoundId !== 0;
  }

  // ---- Introspection helpers (not upstream; for wiring and tests) ----

  /** Number of pooled samples (== next_sound_id). */
  soundCount(): number {
    return this.nextSoundId;
  }

  /** Number of samples mapped to a message type. */
  messageSoundCount(messageType: number): number {
    return this.messageSounds[messageType]?.numSounds ?? 0;
  }

  /** The sample base-names mapped to a message type, in order. */
  messageSampleNames(messageType: number): string[] {
    const msg = this.messageSounds[messageType];
    if (!msg) return [];
    return msg.soundIds
      .slice(0, msg.numSounds)
      .map((id) => this.sounds[id]!.name);
  }

  /** The pooled SoundData for a sample name, or undefined. */
  findSound(name: string): SoundData | undefined {
    const hash = djb2Hash(name);
    for (let i = 0; i < this.nextSoundId; i++) {
      if (this.sounds[i]!.hash === hash && this.sounds[i]!.name === name) {
        return this.sounds[i];
      }
    }
    return undefined;
  }
}
