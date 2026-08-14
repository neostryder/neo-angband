/**
 * Gap row 21, measured through the REAL host path rather than the registry.
 *
 * The trap this file exists to avoid is the one #159 already cost once: "the
 * registry holds the entry" is not "the engine plays the sample". Core's
 * `sound-registry.test.ts` proves the first by calling `engine.loadPrefs`
 * itself; nothing proved the second, because the expression that decides it -
 * `allSoundPrefEntries()` plus the `onAdd` subscription - lives in
 * `installWebSound` and had no test at all. So every assertion here starts at
 * `installWebSound(events)` and ends at the URL an `<audio>` element was asked
 * to play, with the game event bus in between.
 *
 * `Audio` IS THE INSTRUMENT. packages/web runs its tests in node (no DOM
 * environment is configured - see vitest.config.mts and vite.config.ts), so
 * `createWebSoundHooks` would catch a `ReferenceError` on `new Audio()` and
 * mark every sample ERROR. Stubbing `globalThis.Audio` with a recorder is
 * therefore not a convenience - it is the only way this path is observable
 * without a browser, and it records the exact string the platform half built,
 * which is one concatenation away from the sample name `loadPrefs` resolved.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameEvents, MSG, soundPrefRegistry } from "@rpgm-tools/neo-angband-core";
import { installWebSound } from "./sound.js";

/** Every `src` an element was told to play, in order. */
let playedSrc: string[] = [];
/** Every `src` an element was CONSTRUCTED for, in order. */
let loadedSrc: string[] = [];

/** Minimal HTMLAudioElement stand-in: records construction and play. */
class RecordingAudio {
  preload = "";
  #src = "";
  currentTime = 0;
  get src(): string {
    return this.#src;
  }
  set src(value: string) {
    this.#src = value;
    /* `unloadSound` clears the src; only a real assignment is a load. */
    if (value !== "") loadedSrc.push(value);
  }
  addEventListener(): void {
    /* the error path is not what these tests measure */
  }
  pause(): void {
    /* unloadSound calls this */
  }
  play(): Promise<void> {
    playedSrc.push(this.#src);
    return Promise.resolve();
  }
}

type AudioCtor = typeof globalThis.Audio;
const realAudio: AudioCtor | undefined = globalThis.Audio;

beforeEach(() => {
  playedSrc = [];
  loadedSrc = [];
  globalThis.Audio = RecordingAudio as unknown as AudioCtor;
});

afterEach(() => {
  soundPrefRegistry.clear();
  if (realAudio === undefined) {
    delete (globalThis as { Audio?: AudioCtor }).Audio;
  } else {
    globalThis.Audio = realAudio;
  }
});

/** Install the real web sound stack over a fresh bus, deterministic RNG. */
function install(preload = false): { events: GameEvents; close: () => void } {
  const events = new GameEvents();
  const engine = installWebSound(events, {
    baseUrl: "/snd/",
    randint0: () => 0,
    preload,
  });
  return { events, close: () => engine.close(events) };
}

describe("row 21 through installWebSound: a mod's sample actually plays", () => {
  it("CONTROL: with nothing registered, a core message plays CORE's sample", () => {
    /* The negative control is built by REMOVING the mod, not by supplying an
     * inert one. If it played nothing the positive test below would prove only
     * that some sample exists, not that the mod's replaced core's. */
    const { events, close } = install();
    events.emit("sound", { type: MSG.HIT, msg: null });
    expect(playedSrc).toEqual(["/snd/plc_hit_hay.mp3"]);
    close();
  });

  it("registered BEFORE install, a mod re-points a core message", () => {
    soundPrefRegistry.add([{ type: "HIT", sounds: "modpack_thud" }], "sound-pack");
    const { events, close } = install();
    events.emit("sound", { type: MSG.HIT, msg: null });
    expect(playedSrc).toEqual(["/snd/modpack_thud.mp3"]);
    close();
  });

  it("registered AFTER install, the live engine still picks it up", () => {
    /* installWebSound runs at module scope in main.ts (:8821); a plugin's
     * register() runs ~2,100 lines later (:10985). A registry read only at
     * install would be read before every mod that can write to it. Remove the
     * `soundPrefRegistry.onAdd(...)` line from sound.ts and this test alone
     * goes red - which is what makes it a test of the subscription rather than
     * of the registry. */
    const { events, close } = install();
    events.emit("sound", { type: MSG.HIT, msg: null });
    soundPrefRegistry.add([{ type: "HIT", sounds: "late_thud" }], "sound-pack");
    events.emit("sound", { type: MSG.HIT, msg: null });
    expect(playedSrc).toEqual(["/snd/plc_hit_hay.mp3", "/snd/late_thud.mp3"]);
    close();
  });

  it("a name no MSG_ resolves is dropped without disturbing its neighbours", () => {
    /* loadPrefs skips an unknown name SILENTLY, so a test that supplies a bad
     * name and merely sees no crash has measured nothing. The second entry is
     * the measurement: the good one must still land. */
    const { events, close } = install();
    soundPrefRegistry.add([
      { type: "NO_SUCH_MESSAGE_AT_ALL", sounds: "never_played" },
      { type: "MISS", sounds: "modpack_whiff" },
    ]);
    events.emit("sound", { type: MSG.MISS, msg: null });
    expect(playedSrc).toEqual(["/snd/modpack_whiff.mp3"]);
    close();
  });
});

describe("row 21 teardown: a closed engine stops listening", () => {
  /*
   * `SoundPrefRegistry.onAdd` returns an unsubscribe, and its doc comment says
   * outright that it is "the unsubscribe, which `SoundEngine`'s owner calls on
   * teardown". The owner - `installWebSound` - discarded the return value, so
   * every engine it ever built stayed subscribed to a MODULE-LEVEL registry for
   * the life of the process. `close()` unloads the pool and detaches the event
   * handler; it could not detach this, because nothing kept the handle.
   *
   * MEASURING IT TOOK A SECOND ATTEMPT, and the first attempt is the lesson.
   * Asserting "the closed engine plays nothing" PASSES either way: `close()`
   * does remove the bus handler, so a dead engine has no route to `playSound`
   * even while its `loadPrefs` is still being called. That control proved
   * nothing at all. The observable effect is one layer down - a leaked
   * `loadPrefs` on a `preload: true` engine calls the LOAD hook, which builds an
   * <audio> element and points it at a URL. That is a real fetch issued by an
   * engine the host has torn down, and it is what `loadedSrc` counts.
   */
  it("a registration after close() no longer makes the dead engine fetch", () => {
    const { close } = install(true);
    close();
    loadedSrc = [];

    soundPrefRegistry.add([{ type: "HIT", sounds: "orphan_thud" }]);

    /* Before the fix this read ["/snd/orphan_thud.mp3"]: a closed engine
     * loading a sample for a message nobody can signal any more. */
    expect(loadedSrc).toEqual([]);
  });

  it("a second install does not leave the first engine loading too", () => {
    /* The same leak in the form that costs twice: two engines, both subscribed,
     * so one registration issues two fetches for every sample. */
    const first = install(true);
    first.close();
    const second = install(true);
    loadedSrc = [];

    soundPrefRegistry.add([{ type: "HIT", sounds: "shared_thud" }]);

    expect(loadedSrc).toEqual(["/snd/shared_thud.mp3"]);
    second.close();
  });

  it("CONTROL: while the engine is OPEN the same registration does fetch", () => {
    /* The negative control for both assertions above, built by removing the
     * teardown rather than by changing the input. Without it, an unsubscribe
     * that fired at INSTALL time - or a `preload` flag that never reached the
     * hook - would satisfy the two tests above for entirely the wrong reason. */
    const { close } = install(true);
    loadedSrc = [];
    soundPrefRegistry.add([{ type: "HIT", sounds: "live_thud" }]);
    expect(loadedSrc).toEqual(["/snd/live_thud.mp3"]);
    close();
  });
});
