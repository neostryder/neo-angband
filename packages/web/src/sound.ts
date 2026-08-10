/**
 * Web sound playback: the platform half of the sound subsystem.
 *
 * The core SoundEngine (packages/core/src/sound) owns the message->sound
 * map, dedup, load-status tracking, and random selection; this module only
 * implements the SoundHooks - loading and playing actual audio - using
 * HTMLAudioElement.
 *
 * LICENSING / ASSETS: no audio ships in this file's default path. The Dubtrain
 * sound pack the mapping was derived from is Creative Commons Attribution 4.0
 * (reference/docs/copying.rst) - commercial-safe WITH attribution, so it may be
 * bundled or a user may supply their own pack and point the engine at it with a
 * base URL (the `?sounds=` query param or the `baseUrl` option). With no base
 * URL configured, the hooks no-op and the game runs silently. Missing or
 * undecodable files never crash the game.
 */

import {
  SoundEngine,
  SoundStatus,
  SOUND_PREF_ENTRIES,
} from "@rpgm-tools/neo-angband-core";
import type {
  GameEvents,
  SoundData,
  SoundFileType,
  SoundHooks,
  Randint0,
} from "@rpgm-tools/neo-angband-core";

/** Per-sample platform data: the prepared HTMLAudioElement, if any. */
interface WebPlatData {
  audio: HTMLAudioElement;
}

/** Audio formats to try, in order. The user's pack decides what exists. */
const DEFAULT_FORMATS: SoundFileType[] = [
  { extension: ".mp3", type: 1 },
  { extension: ".ogg", type: 2 },
];

/**
 * Where the samples are - either a fixed base, or a function asked for one each
 * time a sample loads.
 *
 * THE FUNCTION FORM IS WHAT A MOD NEEDS. The engine is installed at module scope
 * in main.ts, synchronously, and a mod's sound pack is not known until the
 * resource seam has finished verifying it, which is a fetch away. A fixed string
 * therefore cannot express "the pack the enabled mods supply" - the only base
 * available at that instant is the bundled one. Read per load rather than once,
 * so the answer is whatever boot has settled on by the time a sample is first
 * wanted; with `preload: false` (the default) that is long after.
 */
export type SoundBase = string | (() => string);

/** Resolve a SoundBase, normalising so name concatenation gives one separator. */
function baseOf(base: SoundBase): string {
  const raw = typeof base === "function" ? base() : base;
  return raw.endsWith("/") || raw === "" ? raw : `${raw}/`;
}

export interface WebSoundOptions {
  /**
   * Base URL/path the user's sound pack lives under (e.g. "/sounds/" or
   * "https://my-cdn.example/angband-sounds/"), or a function answering with one.
   * Sample files are expected at `${baseUrl}${name}${ext}`. When omitted or
   * empty, sound is disabled.
   */
  baseUrl?: SoundBase;
  /** RNG seam so selection is deterministic (pass the game RNG's randint0). */
  randint0?: Randint0;
  /** Audio extensions to try (defaults to .mp3 then .ogg). */
  formats?: readonly SoundFileType[];
  /** Preload every sample up front instead of lazily on first play. */
  preload?: boolean;
}

/**
 * Build SoundHooks backed by HTMLAudioElement. The load hook creates an
 * element pointing at the user's pack and marks the sample LOADED
 * optimistically; a load/decoding error flips it to ERROR so it is skipped
 * thereafter. All playback failures are swallowed - audio must never break
 * the game.
 */
export function createWebSoundHooks(
  baseUrl: SoundBase,
  formats: readonly SoundFileType[] = DEFAULT_FORMATS,
): SoundHooks {
  return {
    supportedFiles: () => formats,

    loadSound: (filename: string, _fileType: number, data: SoundData): boolean => {
      /* Asked HERE rather than captured at install: see SoundBase. */
      const base = baseOf(baseUrl);
      if (!base) return false; // no pack configured -> stay unloaded
      // `filename` is the sample base-name (the core passes data.name); the
      // core tries each supported extension in turn, but HTMLAudioElement
      // already probes formats, so resolve the first format's URL and let the
      // element fall back internally is not possible - instead build from the
      // extension the core is currently offering.
      const ext = formats.find((f) => f.type === _fileType)?.extension ?? "";
      const url = `${base}${filename}${ext}`;
      try {
        const audio = new Audio();
        audio.preload = "auto";
        audio.src = url;
        // A failed network/decoding load marks the sample ERROR so the core
        // stops trying to play it.
        audio.addEventListener("error", () => {
          data.status = SoundStatus.ERROR;
        });
        data.platData = { audio } satisfies WebPlatData;
        data.status = SoundStatus.LOADED;
        return true;
      } catch {
        data.status = SoundStatus.ERROR;
        return false;
      }
    },

    playSound: (data: SoundData): boolean => {
      const plat = data.platData as WebPlatData | null;
      if (!plat) return false;
      try {
        // Restart from the top so rapid repeats retrigger, and swallow the
        // autoplay/format rejection promise.
        plat.audio.currentTime = 0;
        void plat.audio.play().catch(() => {
          /* autoplay blocked or file missing - stay silent */
        });
        return true;
      } catch {
        return false;
      }
    },

    unloadSound: (data: SoundData): boolean => {
      const plat = data.platData as WebPlatData | null;
      if (plat) {
        plat.audio.pause();
        plat.audio.src = "";
      }
      data.platData = null;
      return true;
    },
  };
}

/**
 * Construct a SoundEngine wired to the web audio hooks, load the bundled
 * message->sound map, and subscribe it to the game event bus so an
 * EVENT_SOUND (Messages.sound / msgt) plays a sample.
 *
 * Returns the engine (call `.close(events)` to tear down). With no base URL
 * the engine is still created and subscribed but every hook no-ops, so the
 * game is silent yet the wiring stays identical.
 */
export function installWebSound(
  events: GameEvents,
  options: WebSoundOptions = {},
): SoundEngine {
  const formats = options.formats ?? DEFAULT_FORMATS;
  const hooks = createWebSoundHooks(options.baseUrl ?? "", formats);
  const engine = new SoundEngine({
    hooks,
    ...(options.randint0 ? { randint0: options.randint0 } : {}),
    preload: options.preload ?? false,
  });
  engine.loadPrefs(SOUND_PREF_ENTRIES);
  engine.init(events);
  return engine;
}
