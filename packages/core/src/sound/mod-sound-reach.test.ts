/**
 * Gap row 21, the half the producer did NOT close: a pack re-pointing one of
 * upstream's OWN messages.
 *
 * `sound-registry.ts` documents the capability in its own header - "LAST WRITER
 * WINS, PER MESSAGE ... it is what lets a sound-pack mod re-point a core
 * message at its own samples" - and `MessageFacade.addSounds` repeats it. Both
 * are true of the REGISTRY. Neither is true of the only door a content pack
 * has.
 *
 * There are exactly three ways into `soundPrefRegistry`:
 *
 *   1. `soundPrefRegistry.add(...)` through `ctx.core`  - trusted plugin CODE.
 *   2. `messages.addSounds(...)` (registry:message)     - trusted plugin CODE.
 *   3. a pack's `message_type.json` -> declareModMessageTypes -> bindCore.
 *
 * Doors 1 and 2 need a `plugin.js` and, for 2, a granted capability. Door 3 is
 * the one `message-declarations.ts:38-42` exists for and says so out loud: "a
 * pack with no `plugin.js` has no `register()` at all ... that is why the sound
 * samples ride the same record". And door 3 registers the `sounds` half ONLY
 * inside the branch that COINED the type. EVERY other outcome `continue`s
 * before the `sounds` block at :196, and there are two of them:
 *
 *   - the name is one of upstream's 153. `messages.lookup` is the MOD registry
 *     and does not know compiled names, so this does NOT take the `already`
 *     path - it reaches `messages.add`, which THROWS on a compiled name, and
 *     lands in `refused` (message-declarations.ts:180-189).
 *   - the name was coined by an earlier pack, or by an earlier `bindCore` in
 *     the same process. That is the `already` path at :174-178.
 *
 * So a content-only sound pack can bind samples to a message type it invented,
 * and cannot bind samples to MSG_HIT. That is the whole point of a sound pack.
 * The refusal's own text is the sharpest evidence that this is unintended - it
 * ends "to re-point its sound, register a sound pref" (message-types.ts:99-104),
 * which is advice a pack with no plugin.js has no way to take, because the
 * record that just got refused WAS its sound-pref door.
 *
 * THESE TESTS DO NOT ASSERT THE FIX - both `continue`s are in `mod/`, outside
 * this stream's files. They pin the CURRENT behaviour so the gap is a failing
 * expectation the day someone changes it, and so the report has a name.
 */

import { afterEach, describe, expect, it } from "vitest";
import { MSG } from "../generated/message.js";
import { declareModMessageTypes } from "../mod/message-declarations.js";
import { SoundEngine } from "./engine.js";
import { messageTypes } from "./message-types.js";
import { allSoundPrefEntries, soundPrefRegistry } from "./sound-registry.js";
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

/** A `message_type.json` record as the composer stamps it. */
function record(rec: {
  name: string;
  sound?: string;
  sounds?: string;
}): Record<string, unknown> {
  return { ...rec, $from: { owner: "sound-pack" } };
}

afterEach(() => {
  soundPrefRegistry.clear();
  messageTypes.clear();
});

describe("row 21 door 3: a pack's OWN message type gets its samples", () => {
  it("a coined type plays the samples its record named", () => {
    /* The positive half, and the reason this door is not simply broken: for a
     * name nothing resolves yet, declareModMessageTypes takes the coin branch
     * and registers both halves. */
    const result = declareModMessageTypes([
      record({ name: "SOULFIRE", sound: "soulfire", sounds: "sf_one sf_two" }),
    ]);
    expect(result.declared.map((d) => d.name)).toEqual(["SOULFIRE"]);

    const { engine, played } = recordingEngine();
    engine.loadPrefs(allSoundPrefEntries());
    engine.playSound(messageTypes.lookup("SOULFIRE"));
    expect(played).toEqual(["sf_one"]);
  });
});

describe("row 21 door 3 GAP: a pack cannot re-point a CORE message", () => {
  it("a record naming a compiled MSG_ is REFUSED, and its samples go with it", () => {
    /* Not the `already` path, which was the obvious guess and is wrong:
     * `messages.lookup` is the MOD registry and answers -1 for "HIT", so the
     * record reaches `messages.add`, which throws on a compiled name. */
    const result = declareModMessageTypes([record({ name: "HIT", sounds: "pack_thud" })]);
    expect(result.declared).toEqual([]);
    expect(result.already).toEqual([]);
    expect(result.refused.map((r) => r.name)).toEqual(["HIT"]);
    /* The advice a content pack cannot take, quoted from the refusal itself. */
    expect(result.refused[0]?.why).toContain("to re-point its sound, register a sound pref");

    /* CURRENT behaviour. When the refusal path learns to register the sounds
     * half, this becomes `[{ type: "HIT", sounds: "pack_thud" }]`. */
    expect(soundPrefRegistry.added()).toEqual([]);
  });

  it("a record naming an EARLIER pack's type takes `already`, and drops them too", () => {
    /* The second `continue`, reached the way a two-pack load order reaches it:
     * pack A coins SOULFIRE, pack B ships samples for it. B's are dropped. This
     * is also the shape a second `bindCore` in one process takes, which is why
     * a fix has to stay idempotent rather than simply moving the `sounds` call
     * above the branch. */
    declareModMessageTypes([
      { ...record({ name: "SOULFIRE", sound: "soulfire", sounds: "a_one" }) },
    ]);
    const second = declareModMessageTypes([
      { ...record({ name: "SOULFIRE", sounds: "b_one" }), $from: { owner: "pack-b" } },
    ]);
    expect(second.already.map((a) => a.name)).toEqual(["SOULFIRE"]);
    expect(second.refused).toEqual([]);
    expect(soundPrefRegistry.added()).toEqual([{ type: "SOULFIRE", sounds: "a_one" }]);
  });

  it("so the engine still plays CORE's sample for that message", () => {
    /* Driven to playback rather than stopped at the registry, because "the
     * registry has no entry" and "the engine plays the wrong thing" are two
     * claims and only the second is the defect. */
    declareModMessageTypes([record({ name: "HIT", sounds: "pack_thud" })]);
    const { engine, played } = recordingEngine();
    engine.loadPrefs(allSoundPrefEntries());
    engine.playSound(MSG.HIT);
    /* WANTED: ["pack_thud"]. */
    expect(played).toEqual(["plc_hit_hay"]);
  });

  it("CONTROL BY REMOVAL: the same samples DO land when the name is unknown", () => {
    /* Built by removing the mechanism under test - the name's prior existence -
     * and nothing else. Same record shape, same `sounds` string, same engine;
     * only the name changes from one core owns to one nobody does. It lands.
     * That isolates the pre-existing name as the cause, rather than the record
     * shape, the composer stamp, or the engine. */
    declareModMessageTypes([
      record({ name: "HIT_BUT_MINE", sound: "hit_but_mine", sounds: "pack_thud" }),
    ]);
    expect(soundPrefRegistry.added()).toEqual([
      { type: "HIT_BUT_MINE", sounds: "pack_thud" },
    ]);

    const { engine, played } = recordingEngine();
    engine.loadPrefs(allSoundPrefEntries());
    engine.playSound(messageTypes.lookup("HIT_BUT_MINE"));
    expect(played).toEqual(["pack_thud"]);
  });

  it("the registry itself has no such limit - only the door does", () => {
    /* The capability sound-registry.ts's header claims, exercised directly.
     * It works. So the gap is located at the caller, not here, and no change
     * to this package can close it. */
    soundPrefRegistry.add([{ type: "HIT", sounds: "pack_thud" }], "sound-pack");
    const { engine, played } = recordingEngine();
    engine.loadPrefs(allSoundPrefEntries());
    engine.playSound(MSG.HIT);
    expect(played).toEqual(["pack_thud"]);
  });
});
