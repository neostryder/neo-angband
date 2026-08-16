/**
 * CAN A MOD SHIP A SOUND PACK? Both doors a pack with no `plugin.js` has, from
 * the record and the pref line a player would actually download.
 *
 * This file was written on 2026-08-14 to PIN A GAP and is kept as the proof it
 * closed. What it recorded: `sound-registry.ts`'s header claims "LAST WRITER
 * WINS, PER MESSAGE ... it is what lets a sound-pack mod re-point a core
 * message at its own samples", and that was true of the REGISTRY and of no door
 * into it. There are exactly three:
 *
 *   1. `soundPrefRegistry.add(...)` through `ctx.core`  - trusted plugin CODE.
 *   2. `messages.addSounds(...)` (registry:message)     - trusted plugin CODE.
 *   3. a pack's `message_type.json` -> declareModMessageTypes -> bindCore.
 *
 * Doors 1 and 2 need a `plugin.js` and, for 2, a granted capability. Door 3
 * registered the `sounds` half ONLY inside the branch that COINED a type, so a
 * content pack could bind samples to a message it had invented and to none of
 * upstream's 153. A sound pack that cannot re-point MSG_HIT is not a sound
 * pack. The refusal's own text was the sharpest evidence it was unintended - it
 * ended "to re-point its sound, register a sound pref", advice a pack with no
 * plugin.js had no way to take, because the record that had just been refused
 * WAS its sound-pref door.
 *
 * There is now a FOURTH door, and it is the one upstream ships: `sound:` is a
 * pref-file directive (`register_sound_pref_parser`, ui-prefs.c:1157) that this
 * port dropped on the floor. A mod's `prefs` resource goes through the same
 * grammar, so a `.prf` is now a sound pack's other half.
 */

import { afterEach, describe, expect, it } from "vitest";
import { MSG } from "../generated/message.js";
import {
  declareModMessageTypes,
  resetModSoundBindings,
} from "../mod/message-declarations.js";
import { GlyphTable } from "../visuals/glyph-table.js";
import { glyphTableSink, processPrefText, soundPrefSink } from "../visuals/prefs.js";
import type { PrefDeps } from "../visuals/prefs.js";
import { PARSE_ERROR } from "../generated/index.js";
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

/** What the engine plays for one message, with every registration applied. */
function playedFor(message: number): string[] {
  const { engine, played } = recordingEngine();
  engine.loadPrefs(allSoundPrefEntries());
  engine.playSound(message);
  return played;
}

/** A `message_type.json` record as the composer stamps it. */
function record(
  rec: { name: string; sound?: string; sounds?: string },
  owner = "sound-pack",
): Record<string, unknown> {
  return { ...rec, $from: { owner } };
}

/**
 * A pref file's worth of `sound:` lines, applied the way a mod's `prefs`
 * resource is - the real grammar, the real sink. `PrefDeps` is unused by
 * `sound:` and the glyph directives are not exercised here, so the registries
 * are stubs; the `sound:` path resolves through `messageLookupByName` alone.
 */
function applySoundPrf(text: string, owner?: string): number[] {
  const deps = {
    features: {},
    objects: {},
    monsters: { raceByName: () => null },
    traps: null,
  } as unknown as PrefDeps;
  const table = new GlyphTable({
    features: [],
    kinds: [],
    races: [],
    traps: null,
    flavors: [],
  });
  const sink =
    owner === undefined
      ? glyphTableSink(table)
      : glyphTableSink(table, soundPrefSink(owner));
  return processPrefText(text, deps, sink).map((e) => e.error);
}

afterEach(() => {
  soundPrefRegistry.clear();
  messageTypes.clear();
  resetModSoundBindings();
});

describe("door 3: a pack's OWN message type gets its samples", () => {
  it("a coined type plays the samples its record named", () => {
    /* The half that always worked, kept because it is the control for the
     * two below: for a name nothing resolves yet, declareModMessageTypes takes
     * the coin branch and registers both halves. */
    const result = declareModMessageTypes([
      record({ name: "SOULFIRE", sound: "soulfire", sounds: "sf_one sf_two" }),
    ]);
    expect(result.declared.map((d) => d.name)).toEqual(["SOULFIRE"]);
    expect(playedFor(messageTypes.lookup("SOULFIRE"))).toEqual(["sf_one"]);
  });
});

describe("door 3 CLOSED: a pack re-points a CORE message from a record", () => {
  it("a record naming a compiled MSG_ still refuses the TYPE, and keeps the samples", () => {
    /* Not the `already` path, which was the obvious guess and is wrong:
     * `messages.lookup` is the MOD registry and answers -1 for "HIT", so the
     * record reaches `messages.add`, which throws on a compiled name.
     *
     * The refusal is deliberately UNCHANGED. What a pack cannot do is change
     * MSG_HIT's `sound.prf` key; what it can now do is bind samples to it. Two
     * different things riding one record, and only one of them was refusable. */
    const result = declareModMessageTypes([record({ name: "HIT", sounds: "pack_thud" })]);
    expect(result.declared).toEqual([]);
    expect(result.already).toEqual([]);
    expect(result.refused.map((r) => r.name)).toEqual(["HIT"]);
    expect(soundPrefRegistry.added()).toEqual([{ type: "HIT", sounds: "pack_thud" }]);
  });

  it("and the ENGINE plays the pack's sample, not core's", () => {
    /* Driven to playback rather than stopped at the registry, because "the
     * registry has an entry" and "the engine plays it" are two claims and only
     * the second is what a player hears. Core's own sample for MSG_HIT is
     * `plc_hit_hay`, which is what this returned before the fix. */
    declareModMessageTypes([record({ name: "HIT", sounds: "pack_thud" })]);
    expect(playedFor(MSG.HIT)).toEqual(["pack_thud"]);
  });

  it("a record naming an EARLIER pack's type binds too, and the later pack wins", () => {
    /* The second branch that used to drop the samples, reached the way a
     * two-pack load order reaches it: pack A coins SOULFIRE, pack B ships its
     * own samples for it. Upstream's answer for a second `sound:` line on one
     * message is that the second wins (message_sound_define CLEARS the list
     * before assigning, sound-core.c:190), so B's must be the one that plays. */
    declareModMessageTypes([
      record({ name: "SOULFIRE", sound: "soulfire", sounds: "a_one" }, "pack-a"),
    ]);
    const second = declareModMessageTypes([
      record({ name: "SOULFIRE", sounds: "b_one" }, "pack-b"),
    ]);
    expect(second.already.map((a) => a.name)).toEqual(["SOULFIRE"]);
    expect(second.refused).toEqual([]);
    expect(soundPrefRegistry.added()).toEqual([
      { type: "SOULFIRE", sounds: "a_one" },
      { type: "SOULFIRE", sounds: "b_one" },
    ]);
    expect(playedFor(messageTypes.lookup("SOULFIRE"))).toEqual(["b_one"]);
  });

  it("the owner rides the entry, so a conflict report can name both packs", () => {
    declareModMessageTypes([record({ name: "HIT", sounds: "a_thud" }, "pack-a")]);
    declareModMessageTypes([record({ name: "HIT", sounds: "b_thud" }, "pack-b")]);
    expect(soundPrefRegistry.contributions()).toEqual([
      { owner: "pack-a", entries: [{ type: "HIT", sounds: "a_thud" }] },
      { owner: "pack-b", entries: [{ type: "HIT", sounds: "b_thud" }] },
    ]);
  });

  it("IDEMPOTENT: bindCore on the load path does not re-point the message", () => {
    /* The trap the (owner, type) guard exists for. bindCore runs on BOTH the
     * new-game and the load path, so without a guard a second pass re-registers
     * every pack in order - which is harmless only when the order is unchanged,
     * and is a silent re-point the moment one pack's records are absent. */
    declareModMessageTypes([record({ name: "HIT", sounds: "a_thud" }, "pack-a")]);
    declareModMessageTypes([record({ name: "HIT", sounds: "b_thud" }, "pack-b")]);
    declareModMessageTypes([record({ name: "HIT", sounds: "a_thud" }, "pack-a")]);
    expect(soundPrefRegistry.added()).toHaveLength(2);
    expect(playedFor(MSG.HIT)).toEqual(["b_thud"]);
  });

  it("CONTROL BY REMOVAL: no record, and core's own sample is what plays", () => {
    /* Built by REMOVING the mechanism - the pack's record - and nothing else.
     * Same engine, same message, same `allSoundPrefEntries()` call. Without this
     * every assertion above could be reading a default that happened to match. */
    expect(playedFor(MSG.HIT)).toEqual(["plc_hit_hay"]);
  });

  it("a name that resolves NOWHERE is still dropped, so the widening is not a hole", () => {
    /* `loadPrefs` would drop it anyway; carrying it would be dead weight in
     * every allSoundPrefEntries() call. The type refusal is what makes the name
     * unresolvable, so this is the one branch where the samples go with it. */
    const result = declareModMessageTypes([
      record({ name: "SOULFROST", sound: 7 as unknown as string, sounds: "sf" }),
    ]);
    expect(result.refused.map((r) => r.name)).toEqual(["SOULFROST"]);
    expect(soundPrefRegistry.added()).toEqual([]);
  });
});

describe("door 4: a mod's PREF FILE binds samples, as upstream's does", () => {
  it("`sound:HIT:` re-points a core message end to end", () => {
    expect(applySoundPrf("sound:HIT:pack_thud")).toEqual([]);
    expect(soundPrefRegistry.added()).toEqual([{ type: "HIT", sounds: "pack_thud" }]);
    expect(playedFor(MSG.HIT)).toEqual(["pack_thud"]);
  });

  it("the samples field is the REST of the line, space separated", () => {
    /* SOUND_PRF_FORMAT is "sound sym type str sounds" (sound.h:52): `str` takes
     * everything left, colons included, so a sample name may contain one. */
    applySoundPrf("sound:HIT:one two three");
    expect(soundPrefRegistry.added()).toEqual([
      { type: "HIT", sounds: "one two three" },
    ]);
    /* randint0 is stubbed to 0, so the FIRST of the three is the one played;
     * that it is one of them at all is what says the list was split. */
    expect(playedFor(MSG.HIT)).toEqual(["one"]);
  });

  it("a second line wins, which is upstream's own last-writer-wins", () => {
    applySoundPrf("sound:HIT:first\nsound:HIT:second");
    expect(playedFor(MSG.HIT)).toEqual(["second"]);
  });

  it("it reaches a type a MOD coined, not only the compiled 153", () => {
    declareModMessageTypes([record({ name: "SOULFIRE", sound: "soulfire" })]);
    expect(applySoundPrf("sound:SOULFIRE:sf_one")).toEqual([]);
    expect(playedFor(messageTypes.lookup("SOULFIRE"))).toEqual(["sf_one"]);
  });

  it("an unknown message is PARSE_ERROR_INVALID_MESSAGE, on the mod's own row", () => {
    /* Upstream returns exactly this (sound-core.c:288-289), and a mod pref file
     * has somewhere to put it: applyPrefText RETURNS its errors so they land on
     * the contributing mod's row rather than in the player's message history.
     * Silently dropping it - which is what an unhandled directive got - leaves
     * the author believing the line was applied. */
    expect(applySoundPrf("sound:NO_SUCH_MESSAGE:x")).toEqual([
      PARSE_ERROR.INVALID_MESSAGE,
    ]);
    expect(soundPrefRegistry.added()).toEqual([]);
  });

  it("a line with no samples at all is MISSING_FIELD", () => {
    expect(applySoundPrf("sound:HIT")).toEqual([PARSE_ERROR.MISSING_FIELD]);
    expect(applySoundPrf("sound")).toEqual([PARSE_ERROR.MISSING_FIELD]);
  });

  it("a `?` bypassed block skips it like every other directive", () => {
    /* The bypass is checked before HANDLERS, so this needs no code of its own -
     * but a directive that is exempt from `?` would be a real defect and the
     * assertion costs one line. */
    applySoundPrf("?:[EQU $RACE Elf]\nsound:HIT:pack_thud\n?:1");
    expect(soundPrefRegistry.added()).toEqual([]);
  });

  it("a host that supplies an owner gets attribution; the default does not", () => {
    applySoundPrf("sound:HIT:pack_thud", "tuned-mod");
    applySoundPrf("sound:MISS:pack_whiff");
    expect(soundPrefRegistry.contributions()).toEqual([
      { owner: "tuned-mod", entries: [{ type: "HIT", sounds: "pack_thud" }] },
      { owner: null, entries: [{ type: "MISS", sounds: "pack_whiff" }] },
    ]);
  });

  it("CONTROL: the compiled prefix is untouched, so nothing was replaced", () => {
    /* `allSoundPrefEntries` appends; a mod that re-points one message must not
     * cost the player the other 148. */
    applySoundPrf("sound:HIT:pack_thud");
    expect(allSoundPrefEntries()).toHaveLength(150);
    expect(playedFor(MSG.MISS)).not.toEqual([]);
  });
});

describe("the registry itself never had this limit - only the doors did", () => {
  it("a direct add re-points a core message, as its header always claimed", () => {
    soundPrefRegistry.add([{ type: "HIT", sounds: "pack_thud" }], "sound-pack");
    expect(playedFor(MSG.HIT)).toEqual(["pack_thud"]);
  });
});
