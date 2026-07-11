import { describe, expect, it } from "vitest";
import { GameEvents } from "../events";
import { MSG } from "../generated/message";
import {
  SoundEngine,
  djb2Hash,
  messageLookupByName,
} from "./engine";
import { SOUND_PREF_ENTRIES } from "./sound-prefs-data";
import { SoundStatus } from "./types";
import type { SoundData, SoundFileType, SoundHooks } from "./types";

/** A deterministic RNG seam that returns a fixed index. */
function fixedRandint0(value: number) {
  return () => value;
}

/** A spy hook set that marks any load as LOADED and records plays. */
function recordingHooks(overrides: Partial<SoundHooks> = {}): {
  hooks: SoundHooks;
  played: string[];
  loaded: string[];
} {
  const played: string[] = [];
  const loaded: string[] = [];
  const files: SoundFileType[] = [{ extension: ".mp3", type: 1 }];
  const hooks: SoundHooks = {
    supportedFiles: () => files,
    loadSound: (_filename, _type, data: SoundData) => {
      loaded.push(data.name);
      data.status = SoundStatus.LOADED;
      return true;
    },
    playSound: (data: SoundData) => {
      played.push(data.name);
      return true;
    },
    ...overrides,
  };
  return { hooks, played, loaded };
}

describe("djb2Hash", () => {
  it("matches the C seed and step (hash*33 + c from 5381)", () => {
    // "" -> 5381; single char folds one step.
    expect(djb2Hash("")).toBe(5381);
    expect(djb2Hash("a")).toBe(((5381 * 33 + 97) >>> 0));
    // Stable, unsigned 32-bit.
    expect(djb2Hash("hit")).toBe(djb2Hash("hit"));
    expect(djb2Hash("hit") >>> 0).toBe(djb2Hash("hit"));
  });
});

describe("messageLookupByName", () => {
  it("resolves MSG_ names to indices and -1 for unknown", () => {
    expect(messageLookupByName("HIT")).toBe(MSG.HIT);
    expect(messageLookupByName("AMBIENT_DAY")).toBe(MSG.AMBIENT_DAY);
    expect(messageLookupByName("NOT_A_MESSAGE")).toBe(-1);
  });
});

describe("messageSoundDefine", () => {
  it("dedups repeated sample names into one shared sound id", () => {
    const eng = new SoundEngine();
    // Two messages share sample "hit"; the pool must hold it once.
    eng.messageSoundDefine(MSG.HIT, "hit hit1");
    eng.messageSoundDefine(MSG.MISS, "hit miss1");
    expect(eng.soundCount()).toBe(3); // hit, hit1, miss1
    expect(eng.messageSampleNames(MSG.HIT)).toEqual(["hit", "hit1"]);
    expect(eng.messageSampleNames(MSG.MISS)).toEqual(["hit", "miss1"]);
  });

  it("redefining a message clears its previous mapping", () => {
    const eng = new SoundEngine();
    eng.messageSoundDefine(MSG.HIT, "a b c");
    expect(eng.messageSoundCount(MSG.HIT)).toBe(3);
    eng.messageSoundDefine(MSG.HIT, "d");
    expect(eng.messageSampleNames(MSG.HIT)).toEqual(["d"]);
  });

  it("caps a message at MAX_SOUNDS_PER_MESSAGE - 1 (15), faithful to the C", () => {
    const eng = new SoundEngine();
    const names = Array.from({ length: 20 }, (_, i) => `s${i}`).join(" ");
    eng.messageSoundDefine(MSG.HIT, names);
    // The C uses `< (MAX_SOUNDS_PER_MESSAGE - 1)`, so 15 are kept.
    expect(eng.messageSoundCount(MSG.HIT)).toBe(15);
    // But every distinct name still joins the shared pool.
    expect(eng.soundCount()).toBe(20);
  });

  it("collapses runs of spaces like the C tokenizer", () => {
    const eng = new SoundEngine();
    eng.messageSoundDefine(MSG.HIT, "a  b");
    expect(eng.messageSampleNames(MSG.HIT)).toEqual(["a", "b"]);
  });
});

describe("play selection via the RNG seam", () => {
  it("picks the sample at randint0(num_sounds) deterministically", () => {
    const { hooks, played } = recordingHooks();
    const eng = new SoundEngine({ hooks, randint0: fixedRandint0(1) });
    eng.messageSoundDefine(MSG.HIT, "hit0 hit1 hit2");
    eng.playSound(MSG.HIT);
    expect(played).toEqual(["hit1"]); // index 1
  });

  it("index 0 selects the first sample", () => {
    const { hooks, played } = recordingHooks();
    const eng = new SoundEngine({ hooks, randint0: fixedRandint0(0) });
    eng.messageSoundDefine(MSG.HIT, "hit0 hit1 hit2");
    eng.playSound(MSG.HIT);
    expect(played).toEqual(["hit0"]);
  });

  it("is a no-op for a message with no sounds", () => {
    const { hooks, played } = recordingHooks();
    const eng = new SoundEngine({ hooks, randint0: fixedRandint0(0) });
    // DRAIN_STAT is defined in the pack, but we never map anything here.
    eng.playSound(MSG.RECOVER);
    expect(played).toEqual([]);
  });

  it("does nothing when no play hook is installed", () => {
    const eng = new SoundEngine({ randint0: fixedRandint0(0) });
    eng.messageSoundDefine(MSG.HIT, "hit0");
    expect(() => eng.playSound(MSG.HIT)).not.toThrow();
  });
});

describe("lazy vs preload load-status transitions", () => {
  it("lazy: a sample stays UNKNOWN until first played, then LOADED", () => {
    const { hooks, loaded } = recordingHooks();
    const eng = new SoundEngine({ hooks, randint0: fixedRandint0(0) });
    eng.messageSoundDefine(MSG.HIT, "hit0");
    expect(eng.findSound("hit0")!.status).toBe(SoundStatus.UNKNOWN);
    expect(loaded).toEqual([]);
    eng.playSound(MSG.HIT);
    expect(loaded).toEqual(["hit0"]);
    expect(eng.findSound("hit0")!.status).toBe(SoundStatus.LOADED);
  });

  it("does not reload a sample already LOADED", () => {
    const { hooks, loaded } = recordingHooks();
    const eng = new SoundEngine({ hooks, randint0: fixedRandint0(0) });
    eng.messageSoundDefine(MSG.HIT, "hit0");
    eng.playSound(MSG.HIT);
    eng.playSound(MSG.HIT);
    expect(loaded).toEqual(["hit0"]); // loaded exactly once
  });

  it("preload: samples load as soon as they are defined", () => {
    const { hooks, loaded } = recordingHooks();
    const eng = new SoundEngine({ hooks, preload: true });
    eng.messageSoundDefine(MSG.HIT, "hit0 hit1");
    expect(loaded).toEqual(["hit0", "hit1"]);
    expect(eng.findSound("hit0")!.status).toBe(SoundStatus.LOADED);
  });

  it("setPreloadedSounds returns the previous setting", () => {
    const eng = new SoundEngine({ preload: false });
    expect(eng.setPreloadedSounds(true)).toBe(false);
    expect(eng.setPreloadedSounds(false)).toBe(true);
  });

  it("a LOADED sound whose status the hook leaves ERROR is not played", () => {
    const played: string[] = [];
    const hooks: SoundHooks = {
      supportedFiles: () => [{ extension: ".mp3", type: 1 }],
      loadSound: (_f, _t, data) => {
        data.status = SoundStatus.ERROR; // file missing / undecodable
        return false;
      },
      playSound: (data) => {
        played.push(data.name);
        return true;
      },
    };
    const eng = new SoundEngine({ hooks, randint0: fixedRandint0(0) });
    eng.messageSoundDefine(MSG.HIT, "hit0");
    eng.playSound(MSG.HIT);
    expect(played).toEqual([]);
  });
});

describe("loadPrefs from the bundled sound.prf map", () => {
  it("has the expected MSG->samples entries for known messages", () => {
    const eng = new SoundEngine();
    eng.loadPrefs(SOUND_PREF_ENTRIES);
    expect(eng.messageSampleNames(MSG.AMBIENT_DAY)).toEqual(["amb_thunder_rain"]);
    expect(eng.messageSampleNames(MSG.AMBIENT_NITE)).toEqual([
      "amb_guitar_chord",
      "amb_thunder_roll",
    ]);
    // HIT maps to multiple samples in the Dubtrain config.
    expect(eng.messageSoundCount(MSG.HIT)).toBe(2);
    expect(eng.messageSampleNames(MSG.HIT)).toEqual([
      "plc_hit_hay",
      "plc_hit_body",
    ]);
  });

  it("parses every sound: directive (149 in 4.2.6)", () => {
    expect(SOUND_PREF_ENTRIES).toHaveLength(149);
  });

  it("skips entries whose message name is unknown", () => {
    const eng = new SoundEngine();
    eng.loadPrefs([
      { type: "HIT", sounds: "hit0" },
      { type: "BOGUS_MESSAGE", sounds: "nope" },
    ]);
    expect(eng.messageSampleNames(MSG.HIT)).toEqual(["hit0"]);
    expect(eng.findSound("nope")).toBeUndefined();
  });
});

describe("init/close and the EVENT_SOUND subscription", () => {
  it("plays the mapped sample when a sound event fires", () => {
    const { hooks, played } = recordingHooks();
    const events = new GameEvents();
    const eng = new SoundEngine({ hooks, randint0: fixedRandint0(0) });
    eng.messageSoundDefine(MSG.HIT, "hit0 hit1");
    expect(eng.init(events)).toBe(true);
    events.emit("sound", { msg: "", type: MSG.HIT });
    expect(played).toEqual(["hit0"]);
  });

  it("close detaches the handler and clears the pool", () => {
    const { hooks, played } = recordingHooks();
    const events = new GameEvents();
    const eng = new SoundEngine({ hooks, randint0: fixedRandint0(0) });
    eng.messageSoundDefine(MSG.HIT, "hit0");
    eng.init(events);
    expect(eng.isSoundInited()).toBe(true);
    eng.close(events);
    expect(eng.isSoundInited()).toBe(false);
    events.emit("sound", { msg: "", type: MSG.HIT });
    expect(played).toEqual([]); // handler gone, pool cleared
  });

  it("openAudio returning false fails init", () => {
    const { hooks } = recordingHooks({ openAudio: () => false });
    const events = new GameEvents();
    const eng = new SoundEngine({ hooks });
    expect(eng.init(events)).toBe(false);
  });
});
