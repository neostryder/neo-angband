/**
 * #266: a mod could not declare a message type in time for its own records to
 * bind to it.
 *
 * THE ORDER WAS MEASURED, NOT READ, because the identical defect one row over
 * (row 21, `installWebSound` at `main.ts:8821` against a plugin's `register()`
 * at `:10985`) was invisible to inspection. Wrapping `messageTypes.lookup` and
 * booting a real game with a monster spell carrying `msgt: PROBE_FLARE` put the
 * resolution at `mon/bind.ts:609`, under `bindCore` (`session/boot.ts:159`),
 * under `startGame` (`session/game.ts:3042`) - and `startGame` threw rather than
 * returning. Parsing `main.ts` puts `const game = bootGame()` (:1094) at
 * top-level statement 182 and the earliest `register()` at 561 / 566
 * (:10870 -> :10828 and :11015 -> :11039), all direct children of the module.
 * The bind is statement 182; the earliest declaration is statement 561.
 *
 * So the suite below never asserts that a declaration was ACCEPTED - that was
 * already true and already tested (`sound/message-types.test.ts`), and it is
 * exactly the test that let #266 ship. Every positive test here binds a REAL
 * pack through `bindCore` and looks at what the bound record ended up carrying.
 *
 * The controls are built by REMOVING the mechanism, never by feeding it input
 * assumed to be inert:
 *   - "no declaration pass" - the same pack, the same bind, the function never
 *     called. The bind dies. This is what makes every positive assertion above
 *     it a statement that had a way to be false.
 *   - "declared after the bind" - the same pack, the same bind, the function
 *     called in the order the shipped host runs it. The bind dies the same way,
 *     which is #266 reproduced rather than described.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { bindCore } from "../session/boot.js";
import type { CorePack } from "../session/boot.js";
import { messageLookupByName } from "../sound/engine.js";
import { messageTypes } from "../sound/message-types.js";
import { MessageTypeRegistry } from "../sound/message-types.js";
import { SoundPrefRegistry, soundPrefRegistry } from "../sound/sound-registry.js";
import { createModRegistryHost } from "./registry-host.js";
import { declareModMessageTypes, resetModSoundBindings } from "./message-declarations.js";
import type { MessageTypeRecordJson } from "./message-declarations.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

/** The MSG_ name only the mod knows, and the sample it plays. */
const MOD_MSG = "SOULFIRE";
/** The pack that ships it, as the composer would have stamped it. */
const OWNER = "soulfire-pack";

/** The `message_type.json` a mod ships, carrying the composer's `$from` stamp. */
function declarationRecords(): unknown[] {
  return [
    {
      name: MOD_MSG,
      sound: "soulfire",
      sounds: "sf_one sf_two",
      $from: { owner: OWNER },
    },
  ];
}

/**
 * A real pack whose records name the mod's message type in all four places a
 * `msgt:` can appear - the four upstream handlers `checkMsgt` and the projection
 * binder stand in for. Every one of them throws PARSE_ERROR_INVALID_MESSAGE for
 * a name that does not resolve, so a single unbound type takes the whole boot
 * down; asserting on one of the four would leave three untested paths that a
 * player would find.
 */
function moddedPack(msgt: string = MOD_MSG): CorePack {
  const mon = {
    pain: loadRecords("pain"),
    blowMethods: loadRecords<{ name: string; msg?: string }>("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords<{ name: string; msgt?: string }>("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords<{ name: string; msgt?: string }>("summon"),
    pits: loadRecords("pit"),
  };
  const projection = loadRecords<{ code: string; msgt?: string }>("projection");
  mon.blowMethods.find((r) => r.name === "HIT")!.msg = msgt;
  mon.monsterSpells[0]!.msgt = msgt;
  mon.summons.find((r) => r.name === "ANY")!.msgt = msgt;
  projection.find((r) => r.code === "ACID")!.msgt = msgt;
  return {
    constants: loadJson("constants"),
    terrain: loadRecords("terrain"),
    roomTemplates: loadRecords("room_template"),
    vaults: loadRecords("vault"),
    dungeonProfiles: loadRecords("dungeon_profile"),
    projection,
    trap: loadRecords("trap"),
    names: loadRecords("names"),
    quest: loadRecords("quest"),
    store: loadRecords("store"),
    obj: {
      objectBase: loadJson("object_base"),
      object: loadJson("object"),
      egoItem: loadJson("ego_item"),
      artifact: loadJson("artifact"),
      curse: loadJson("curse"),
      brand: loadJson("brand"),
      slay: loadJson("slay"),
      activation: loadJson("activation"),
      objectProperty: loadJson("object_property"),
      flavor: loadJson("flavor"),
    },
    mon,
  } as unknown as CorePack;
}

/** What the four bound records ended up carrying. */
function boundMsgts(pack: CorePack): {
  spell: string;
  summon: string;
  method: string;
  projection: string | null;
} {
  const reg = bindCore(pack);
  const spells = [...reg.monsters.spells.values()];
  return {
    spell: spells.find((s) => s.name === pack.mon.monsterSpells[0]!.name)!.msgt,
    summon: reg.monsters.summons.find((s) => s.name === "ANY")!.msgt,
    method: reg.monsters.blowMethods.get("HIT")!.msgt,
    projection: reg.projections!.find((p) => p!.code === "ACID")!.msgt,
  };
}

afterEach(() => {
  messageTypes.clear();
  soundPrefRegistry.clear();
  /* The (owner, type) guard is module-scope, matching the registry it guards.
   * Clearing one without the other leaves the guard outliving its subject, and
   * the next test sees a silent skip rather than a registration. */
  resetModSoundBindings();
});

describe("#266 THE ORDERING PROOF: a declared type binds the pack's own records", () => {
  it("all four msgt: sites carry the mod's own type after a real bind", () => {
    const pack = moddedPack();
    const result = declareModMessageTypes(declarationRecords());
    expect(result.declared).toEqual([{ name: MOD_MSG, at: 154, owner: OWNER }]);
    /* The bind runs AFTER the declaration and completes, which is the whole
     * ticket: not "the declaration was accepted" but "the record bound". */
    expect(boundMsgts(pack)).toEqual({
      spell: MOD_MSG,
      summon: MOD_MSG,
      method: MOD_MSG,
      projection: MOD_MSG,
    });
  });

  it("the type resolves at 154 and no compiled MSG_ moved", () => {
    declareModMessageTypes(declarationRecords());
    bindCore(moddedPack());
    expect(messageLookupByName(MOD_MSG)).toBe(154);
    /* my_stricmp: a pack spelling its own msgt in lower case must still hit. */
    expect(messageLookupByName("soulfire")).toBe(154);
    expect(messageLookupByName("HIT")).toBe(2);
    expect(messageLookupByName("GENERIC")).toBe(0);
  });

  it("needs no plugin, no capability and no live game", () => {
    /* The reachability half. A pack with no `plugin.js` has no register(), so
     * before this the capability was not late for a content mod - it was
     * absent. Nothing here constructs a ModRegistryHost or a GameState. */
    const result = declareModMessageTypes(declarationRecords());
    expect({ declared: result.declared.length, at: messageLookupByName(MOD_MSG) }).toEqual({
      declared: 1,
      at: 154,
    });
  });
});

describe("#266 NEGATIVE CONTROL: remove the mechanism and the bind dies", () => {
  it("without the declaration pass, the same pack throws PARSE_ERROR_INVALID_MESSAGE", () => {
    /* Built by REMOVING the declaration, not by supplying an input assumed to
     * be inert: identical pack, identical bind, the one call missing. */
    const pack = moddedPack();
    expect(() => bindCore(pack)).toThrow(/invalid msgt SOULFIRE/);
    expect(messageLookupByName(MOD_MSG)).toBe(-1);
  });

  it("declared AFTER the bind - the order the shipped host runs - still dies", () => {
    /* #266 reproduced. main.ts binds at top-level statement 182 and calls the
     * earliest register() at 561; this is those two statements in that order. */
    const pack = moddedPack();
    let threw: string | null = null;
    try {
      bindCore(pack);
    } catch (err) {
      threw = err instanceof Error ? err.message : String(err);
    }
    /* And the late declaration succeeds, which is exactly why the defect was
     * invisible: every existing test of registry:message asserts this line. */
    expect(declareModMessageTypes(declarationRecords()).declared).toHaveLength(1);
    expect(threw).toMatch(/invalid msgt SOULFIRE/);
  });

  it("a type the pack never declared is still refused, so the check is widened not disabled", () => {
    declareModMessageTypes(declarationRecords());
    expect(() => bindCore(moddedPack("SOULFROST"))).toThrow(/invalid msgt SOULFROST/);
  });
});

describe("#266 bindCore declares the pack's message types before it binds them", () => {
  /**
   * This WAS a tripwire asserting the opposite - that a pack carrying
   * message_type records still failed to bind them - planted deliberately
   * because the wire lived in a file its author did not own.
   *
   * The wire landed 2026-08-14: `CorePack` gained `messageTypes?`, and
   * `declareModMessageTypes(pack.messageTypes)` is now the FIRST statement of
   * `bindCore`, ahead of `bindMonsters` and `bindProjections`. The tripwire
   * went red exactly as designed, and this is its positive form.
   *
   * Deliberately end-to-end through the REAL `bindCore` rather than through
   * `declareModMessageTypes` alone: #266 was an ORDERING defect, and a test
   * that invokes only one of the two calls cannot see an ordering defect at
   * all. Move the declaration below `bindMonsters` and this goes red on the
   * throw - which is the only thing that keeps the order honest.
   */
  it("binds a record that names a type the same pack coined", () => {
    const pack = moddedPack() as CorePack & { messageTypes: unknown[] };
    pack.messageTypes = declarationRecords();
    expect(() => bindCore(pack)).not.toThrow();
    expect(messageLookupByName(MOD_MSG)).toBeGreaterThanOrEqual(0);
  });
});

describe("#266 the sound half rides the same record", () => {
  it("registers the samples under the type it just coined", () => {
    declareModMessageTypes(declarationRecords());
    expect(soundPrefRegistry.added()).toEqual([{ type: MOD_MSG, sounds: "sf_one sf_two" }]);
    expect(soundPrefRegistry.contributions()).toEqual([
      { owner: OWNER, entries: [{ type: MOD_MSG, sounds: "sf_one sf_two" }] },
    ]);
  });

  it("a record with no samples registers the type and nothing else", () => {
    const result = declareModMessageTypes([{ name: MOD_MSG, sound: "soulfire" }]);
    expect({ declared: result.declared.length, prefs: soundPrefRegistry.added().length }).toEqual({
      declared: 1,
      prefs: 0,
    });
  });
});

describe("#266 idempotence: bindCore runs on the new-game AND the load path", () => {
  it("a second pass re-declares nothing and re-points no samples", () => {
    const first = declareModMessageTypes(declarationRecords());
    const second = declareModMessageTypes(declarationRecords());
    expect(first.declared).toHaveLength(1);
    expect(second).toEqual({
      declared: [],
      already: [{ name: MOD_MSG, at: 154 }],
      refused: [],
    });
    /* Samples registered twice would be harmless only by luck:
     * message_sound_define CLEARS a message's list before assigning, so the
     * second batch replaces the first rather than adding to it. */
    expect(soundPrefRegistry.added()).toHaveLength(1);
    expect(messageTypes.size).toBe(1);
  });

  it("and the records still bind on the second pass", () => {
    declareModMessageTypes(declarationRecords());
    declareModMessageTypes(declarationRecords());
    expect(boundMsgts(moddedPack()).spell).toBe(MOD_MSG);
  });
});

describe("#266 a refusal loses one declaration and never the boot", () => {
  it("reports rather than throws for every refusal MessageTypeRegistry makes", () => {
    const result = declareModMessageTypes([
      { name: "HIT", sound: "x", $from: { owner: OWNER } },
      { name: "5", $from: { owner: OWNER } },
      { name: "", $from: { owner: OWNER } },
      { name: 7 },
      "not a record",
      { name: MOD_MSG, sound: "soulfire", $from: { owner: OWNER } },
    ] as unknown[]);
    expect(result.declared).toEqual([{ name: MOD_MSG, at: 154, owner: OWNER }]);
    expect(result.refused.map((r) => r.name)).toEqual([
      "HIT",
      "5",
      "<unnamed>",
      "<unnamed>",
      "<record>",
    ]);
    expect(result.refused[0]!.why).toMatch(/already a compiled-in MSG_/);
    expect(result.refused[1]!.why).toMatch(/parses as a decimal number/);
    expect(result.refused[0]!.owner).toBe(OWNER);
    /* The good record after five bad ones still landed, and still binds. */
    expect(boundMsgts(moddedPack()).projection).toBe(MOD_MSG);
  });

  it("two packs coining the same name: the second is `already`, not a crash", () => {
    declareModMessageTypes(declarationRecords());
    const second = declareModMessageTypes([
      { name: MOD_MSG, sound: "other", $from: { owner: "second-pack" } },
    ]);
    expect(second.already).toEqual([{ name: MOD_MSG, at: 154 }]);
    expect(messageTypes.size).toBe(1);
  });

  it("a missing or non-array file is not an error a boot can die of", () => {
    expect(declareModMessageTypes(undefined)).toEqual({
      declared: [],
      already: [],
      refused: [],
    });
    const bad = declareModMessageTypes({ nope: true } as unknown as unknown[]);
    expect(bad.refused).toHaveLength(1);
    expect(bad.refused[0]!.why).toMatch(/must be an array/);
  });
});

describe("#266 the two doors write the same table", () => {
  it("a data declaration and a plugin's define() append to one list, in order", () => {
    declareModMessageTypes(declarationRecords());
    const host = createModRegistryHost({});
    expect(host.messages.define("SOULFROST", "soulfrost")).toBe(155);
    expect(messageTypes.added()).toEqual([
      { name: MOD_MSG, sound: "soulfire", owner: OWNER },
      { name: "SOULFROST", sound: "soulfrost", owner: null },
    ]);
    /* And the late one is late for exactly the reason #266 says: a record
     * naming SOULFROST would already have failed to bind. */
    expect(() => bindCore(moddedPack("SOULFROST"))).not.toThrow();
  });
});

describe("#266 injected targets: nothing here has to touch the singletons", () => {
  it("declares into a caller-supplied registry pair", () => {
    const messages = new MessageTypeRegistry();
    const sounds = new SoundPrefRegistry();
    const result = declareModMessageTypes(declarationRecords(), { messages, sounds });
    expect(result.declared).toEqual([{ name: MOD_MSG, at: 154, owner: OWNER }]);
    expect(sounds.added()).toEqual([{ type: MOD_MSG, sounds: "sf_one sf_two" }]);
    /* The module singletons are untouched, so a host can bind a second pack in
     * isolation - and so this test cannot leak into the next one. */
    expect(messageTypes.size).toBe(0);
    expect(soundPrefRegistry.added()).toHaveLength(0);
  });
});

/** Type-only: the record shape a pack file must produce. */
const _shape: MessageTypeRecordJson = { name: MOD_MSG, sound: "soulfire", sounds: "sf_one" };
void _shape;
