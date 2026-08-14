/**
 * Gap row 21: SOUND_PREF_ENTRIES (149 entries), the pure producer problem.
 *
 * `loadPrefs` was always open and always skipped an unknown name; the only
 * caller handed it the compiled constant and nothing else. So what has to be
 * proved is not that the consumer works - it always did - but that a mod's
 * entries REACH it, that core's 149 are untouched when they do, and that the
 * ORDER of install and registration does not decide whether it works.
 */

import { afterEach, describe, expect, it } from "vitest";
import { MSG } from "../generated/message.js";
import { SoundEngine } from "./engine.js";
import { messageTypes } from "./message-types.js";
import { SOUND_PREF_ENTRIES } from "./sound-prefs-data.js";
import {
  SoundPrefRegistry,
  allSoundPrefEntries,
  soundPrefRegistry,
} from "./sound-registry.js";
import { SoundStatus } from "./types.js";

/** An engine that records the sample name it would have played. */
function recordingEngine(): { engine: SoundEngine; played: string[] } {
  const played: string[] = [];
  const engine = new SoundEngine({
    randint0: () => 0,
    hooks: {
      supportedFiles: () => [{ extension: ".mp3", type: 1 }],
      loadSound: (_name, _type, data) => {
        data.status = SoundStatus.LOADED;
        return true;
      },
      playSound: (data) => {
        played.push(data.name);
        return true;
      },
    },
  });
  return { engine, played };
}

afterEach(() => {
  soundPrefRegistry.clear();
  messageTypes.clear();
});

describe("row 21 CONTROL: nothing registered changes nothing", () => {
  it("allSoundPrefEntries IS the compiled table, by identity", () => {
    /* Not just equal - the same object, so an empty registry cannot even
     * reorder or re-copy the 149. */
    expect(allSoundPrefEntries()).toBe(SOUND_PREF_ENTRIES);
    expect(SOUND_PREF_ENTRIES.length).toBe(149);
  });

  it("the compiled prefix is byte-identical with a mod loaded", () => {
    soundPrefRegistry.add([{ type: "HIT", sounds: "mod_hit" }]);
    const all = allSoundPrefEntries();
    expect(all.slice(0, SOUND_PREF_ENTRIES.length)).toEqual([...SOUND_PREF_ENTRIES]);
    expect(all.length).toBe(SOUND_PREF_ENTRIES.length + 1);
  });
});

describe("row 21: a mod's entries reach loadPrefs", () => {
  it("appends after every compiled entry, in registration order", () => {
    const r = new SoundPrefRegistry();
    r.add([{ type: "HIT", sounds: "a_one" }], "mod-a");
    r.add([{ type: "MISS", sounds: "b_one" }], "mod-b");
    expect(allSoundPrefEntries(r).slice(SOUND_PREF_ENTRIES.length)).toEqual([
      { type: "HIT", sounds: "a_one" },
      { type: "MISS", sounds: "b_one" },
    ]);
    expect(r.contributions().map((c) => c.owner)).toEqual(["mod-a", "mod-b"]);
  });

  it("a mod's sample plays for a CORE message, replacing core's", () => {
    /* message_sound_define clears the message's list before assigning
     * (sound-core.c:179), so the later entry WINS - which is how a sound-pack
     * mod re-points MSG_HIT, and is upstream's own behaviour for a second
     * `sound:HIT:` line. */
    const { engine, played } = recordingEngine();
    soundPrefRegistry.add([{ type: "HIT", sounds: "mod_hit" }]);
    engine.loadPrefs(allSoundPrefEntries());
    engine.playSound(MSG.HIT);
    expect(played).toEqual(["mod_hit"]);
  });

  it("WITHOUT the mod entry the same message plays core's sample", () => {
    /* The negative control for the assertion above: identical setup minus the
     * registration. If loadPrefs were being handed the compiled constant (the
     * pre-change call site) the previous test would produce THIS result, so
     * the pair is what distinguishes "the mod reached it" from "it played
     * something". */
    const { engine, played } = recordingEngine();
    engine.loadPrefs(allSoundPrefEntries());
    engine.playSound(MSG.HIT);
    expect(played).toEqual(["plc_hit_hay"]);
  });

  it("an entry naming no MSG_ at all is dropped, not thrown", () => {
    const { engine, played } = recordingEngine();
    soundPrefRegistry.add([
      { type: "NO_SUCH_MESSAGE", sounds: "never" },
      { type: "MISS", sounds: "mod_miss" },
    ]);
    expect(() => engine.loadPrefs(allSoundPrefEntries())).not.toThrow();
    engine.playSound(MSG.MISS);
    expect(played).toEqual(["mod_miss"]);
  });

  it("rejects a malformed entry at REGISTRATION, where the mod can be named", () => {
    const r = new SoundPrefRegistry();
    expect(() => r.add([{ type: "", sounds: "x" }])).toThrow(/non-empty MSG_ name/);
    expect(() =>
      r.add([{ type: "HIT" } as unknown as { type: string; sounds: string }]),
    ).toThrow(/space-separated string/);
    expect(r.added()).toEqual([]);
  });

  it("a registration does not survive teardown", () => {
    soundPrefRegistry.add([{ type: "HIT", sounds: "mod_hit" }]);
    soundPrefRegistry.clear();
    expect(allSoundPrefEntries()).toBe(SOUND_PREF_ENTRIES);
  });
});

describe("row 21 ORDERING: registering AFTER install still works", () => {
  /* The failure this rules out is the second #159 mode - installed but never
   * consulted. installWebSound runs at main.ts:8821 and a plugin's register()
   * at :10985, so a registry read only at install time would be read before
   * every mod that can write to it. Remove the onAdd subscription from
   * installWebSound (or the listener fan-out from SoundPrefRegistry.add) and
   * this test fails while every test above still passes. */
  it("a batch added after loadPrefs is applied to the live engine", () => {
    const { engine, played } = recordingEngine();
    const r = new SoundPrefRegistry();
    engine.loadPrefs(allSoundPrefEntries(r));
    const off = r.onAdd((added) => engine.loadPrefs(added));

    engine.playSound(MSG.HIT);
    expect(played).toEqual(["plc_hit_hay"]);

    r.add([{ type: "HIT", sounds: "late_hit" }]);
    engine.playSound(MSG.HIT);
    expect(played).toEqual(["plc_hit_hay", "late_hit"]);

    off();
    r.add([{ type: "HIT", sounds: "after_unsubscribe" }]);
    engine.playSound(MSG.HIT);
    expect(played).toEqual(["plc_hit_hay", "late_hit", "late_hit"]);
  });

  it("the listener sees only the new batch, never core's 149 again", () => {
    const r = new SoundPrefRegistry();
    const seen: unknown[] = [];
    r.onAdd((added) => seen.push([...added]));
    r.add([{ type: "HIT", sounds: "one" }]);
    r.add([{ type: "MISS", sounds: "two" }]);
    expect(seen).toEqual([
      [{ type: "HIT", sounds: "one" }],
      [{ type: "MISS", sounds: "two" }],
    ]);
  });
});
