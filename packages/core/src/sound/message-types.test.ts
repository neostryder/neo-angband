/**
 * Gap row 20: MESSAGE_ENTRIES / MSG (154 slots), and the four binders that
 * threw PARSE_ERROR_INVALID_MESSAGE for anything outside them.
 *
 * What is being proved, in order:
 *  1. THE CONTROL. With nothing registered, every consumer answers exactly as
 *     it did before - including the whole compiled table, name by name.
 *  2. The widening. A registered name binds through checkMsgt (blow method and
 *     summon), through the projection binder, and through loadPrefs.
 *  3. THE NEGATIVE CONTROL, which is the point of the exercise: a mod-supplied
 *     name that was NOT registered still throws. Widening the table and
 *     disabling the check look identical from a passing positive test, and only
 *     this assertion tells them apart.
 *  4. The three refusals, each of which is a registration that could not be
 *     reached rather than a preference.
 *  5. NO SAVE IMPACT: the bound value is the NAME, a string, resolved at
 *     message time. Nothing renumbers.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { MESSAGE_ENTRIES, MSG } from "../generated/message.js";
import { bindMonsters } from "../mon/bind.js";
import type { MonsterPackRecords } from "../mon/bind.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import {
  SoundEngine,
  messageLookupByName,
  messageSoundName,
} from "./engine.js";
import { SoundStatus } from "./types.js";
import { FIRST_MOD_MESSAGE_INDEX, messageTypes } from "./message-types.js";

function packJson<T>(name: string): T[] {
  const parsed = JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as { records: T[] };
  return parsed.records;
}

function loadPack(): MonsterPackRecords {
  return {
    pain: packJson("pain"),
    blowMethods: packJson("blow_methods"),
    blowEffects: packJson("blow_effects"),
    monsterSpells: packJson("monster_spell"),
    monsterBases: packJson("monster_base"),
    monsters: packJson("monster"),
    summons: packJson("summon"),
    pits: packJson("pit"),
  };
}

/** Plant `msg:<v>` on blow method HIT and bind - checkMsgt caller #2. */
function methMsgt(v: string): string {
  const pack = loadPack();
  const hit = pack.blowMethods.find((r) => r.name === "HIT")!;
  hit.msg = v;
  return bindMonsters(pack).blowMethods.get("HIT")!.msgt;
}

/** Plant `msgt:<v>` on summon ANY and bind - checkMsgt caller #3. */
function summonMsgt(v: string): string {
  const pack = loadPack();
  const any = pack.summons.find((r) => r.name === "ANY")!;
  any.msgt = v;
  return bindMonsters(pack).summons.find((s) => s.name === "ANY")!.msgt;
}

/** Plant `msgt:<v>` on a monster spell and bind - checkMsgt caller #1. */
function spellMsgt(v: string): string {
  const pack = loadPack();
  const first = pack.monsterSpells[0]!;
  first.msgt = v;
  const idx = bindMonsters(pack).spells;
  return [...idx.values()][0]!.msgt;
}

/** The whole projection pack, with `msgt:<v>` planted on ACID - caller #4. */
function projectionMsgt(v: string): string | null {
  const recs = packJson<ProjectionRecordJson>("projection");
  const acid = recs.find((r) => r.code === "ACID")!;
  acid.msgt = v;
  return bindProjections(recs)[0]!.msgt;
}

afterEach(() => {
  messageTypes.clear();
});

describe("row 20 CONTROL: nothing registered changes nothing", () => {
  it("resolves every compiled MSG_ name to its own index, and MAX to 153", () => {
    const resolved = MESSAGE_ENTRIES.map((e, i) => ({
      name: e.name,
      at: messageLookupByName(e.name),
      expected: i,
    }));
    expect(resolved.filter((r) => r.at !== r.expected)).toEqual([]);
    expect(messageLookupByName("MAX")).toBe(MSG.MAX);
  });

  it("still returns -1 for everything message.c returns -1 for", () => {
    for (const bad of ["", "XYZZY", "kskl8bktk2b", "-3", "154", "999999999999"]) {
      expect({ bad, at: messageLookupByName(bad) }).toEqual({ bad, at: -1 });
    }
  });

  it("the compiled table is 154 long and the first mod index is 154", () => {
    expect({
      entries: MESSAGE_ENTRIES.length,
      max: MSG.MAX,
      firstMod: FIRST_MOD_MESSAGE_INDEX,
      registered: messageTypes.size,
    }).toEqual({ entries: 154, max: 153, firstMod: 154, registered: 0 });
  });
});

describe("row 20: a registered message type binds through all four callers", () => {
  it("appends after the compiled slots, in registration order", () => {
    expect(messageTypes.add("SOULFIRE", "soulfire")).toBe(154);
    expect(messageTypes.add("SOULFROST", "soulfrost")).toBe(155);
    expect(messageLookupByName("SOULFIRE")).toBe(154);
    /* my_stricmp: the name search upstream does is case-insensitive, and the
     * widening has to be too or a mod's own `msgt:soulfire` would miss. */
    expect(messageLookupByName("soulFIRE")).toBe(154);
    expect(messageTypes.added()).toEqual([
      { name: "SOULFIRE", sound: "soulfire", owner: null },
      { name: "SOULFROST", sound: "soulfrost", owner: null },
    ]);
  });

  it("blow method msg: (mon-init.c parse_meth_message_type)", () => {
    messageTypes.add("SOULFIRE", "soulfire");
    expect(methMsgt("SOULFIRE")).toBe("SOULFIRE");
  });

  it("summon msgt: (mon-summon.c parse_summon_message_type)", () => {
    messageTypes.add("SOULFIRE", "soulfire");
    expect(summonMsgt("SOULFIRE")).toBe("SOULFIRE");
  });

  it("monster spell msgt: (mon-init.c parse_mon_spell_message_type)", () => {
    messageTypes.add("SOULFIRE", "soulfire");
    expect(spellMsgt("SOULFIRE")).toBe("SOULFIRE");
  });

  it("projection msgt: (obj-init.c, world/projection.ts:182)", () => {
    messageTypes.add("SOULFIRE", "soulfire");
    expect(projectionMsgt("SOULFIRE")).toBe("SOULFIRE");
  });
});

describe("row 20 NEGATIVE CONTROL: the check is widened, not disabled", () => {
  /* Every assertion here passes BOTH before the change (nothing is registered,
   * so everything throws) and after it. What it rules out is the version of
   * the fix that deletes the guard: with SOULFIRE registered the four callers
   * accept SOULFIRE and still refuse SOULFROST, which a disabled check could
   * not do. Removing the `messageTypes.lookup` fall-through in engine.ts turns
   * the four positive tests above red and leaves these four green; deleting
   * the `messageLookupByName(msgt) < 0` guard instead turns these four red and
   * leaves those green. Only both together pin the actual behaviour. */
  it("an UNregistered name still throws PARSE_ERROR_INVALID_MESSAGE", () => {
    messageTypes.add("SOULFIRE", "soulfire");
    expect(() => methMsgt("SOULFROST")).toThrow(/invalid msgt SOULFROST/);
    expect(() => summonMsgt("SOULFROST")).toThrow(/invalid msgt SOULFROST/);
    expect(() => spellMsgt("SOULFROST")).toThrow(/invalid msgt SOULFROST/);
    expect(() => projectionMsgt("SOULFROST")).toThrow(/invalid msgt SOULFROST/);
  });

  it("a registration does not survive teardown (a disabled mod's do not exist)", () => {
    messageTypes.add("SOULFIRE", "soulfire");
    messageTypes.clear();
    expect(messageLookupByName("SOULFIRE")).toBe(-1);
    expect(() => methMsgt("SOULFIRE")).toThrow(/invalid msgt SOULFIRE/);
  });

  it("upstream's own rejected forms are still rejected with a mod loaded", () => {
    messageTypes.add("SOULFIRE", "soulfire");
    for (const bad of ["", "XYZZY", "kskl8bktk2b", "-3", "154"]) {
      expect({ bad, at: messageLookupByName(bad) }).toEqual({ bad, at: -1 });
    }
  });
});

describe("row 20 refusals: registrations that could never be reached", () => {
  it("refuses a name already compiled in, case-insensitively", () => {
    /* The compiled scan runs first, so this registration would be silently
     * dead - never an override. bindProjections refuses the same class of
     * thing rather than binding it somewhere surprising. */
    expect(() => messageTypes.add("HIT")).toThrow(/already a compiled-in MSG_/);
    expect(() => messageTypes.add("hit")).toThrow(/already a compiled-in MSG_/);
    expect(() => messageTypes.add("MAX")).toThrow(/already a compiled-in MSG_/);
    expect(messageTypes.size).toBe(0);
  });

  it("refuses a name strtoul consumes, because the numeric path wins", () => {
    for (const n of ["5", " -3 ", "+12", "154", "0zzz"]) {
      expect(() => messageTypes.add(n)).toThrow(/parses as a decimal number/);
    }
    /* The refusal predicate and message_lookup_by_name's own parser must agree:
     * anything refused above is a name the lookup resolves numerically (or to
     * -1), NEVER by name - which is exactly why registering it is pointless. */
    for (const n of ["5", " -3 ", "+12", "154", "0zzz"]) {
      const at = messageLookupByName(n);
      expect({ n, byName: at === -1 || at < MSG.MAX }).toEqual({ n, byName: true });
    }
  });

  it("refuses a duplicate mod-supplied name and an empty one", () => {
    messageTypes.add("SOULFIRE", "soulfire");
    expect(() => messageTypes.add("SOULFIRE")).toThrow(/duplicate name/);
    expect(() => messageTypes.add("soulfire")).toThrow(/duplicate name/);
    expect(() => messageTypes.add("")).toThrow(/non-empty string/);
    expect(messageTypes.size).toBe(1);
  });
});

describe("row 20 NO SAVE IMPACT: the bound value is a name, not a number", () => {
  it("checkMsgt stores the string it was given, verbatim", () => {
    messageTypes.add("SOULFIRE", "soulfire");
    const bound = methMsgt("SOULFIRE");
    expect({ value: bound, type: typeof bound }).toEqual({
      value: "SOULFIRE",
      type: "string",
    });
    /* And the case is carried verbatim too - the binder never normalises to an
     * index, so there is no number for a later boot to disagree about. */
    expect(methMsgt("soulfire")).toBe("soulfire");
  });

  it("no compiled MSG_ number moves when a mod registers one", () => {
    const before = MESSAGE_ENTRIES.map((e) => messageLookupByName(e.name));
    messageTypes.add("SOULFIRE", "soulfire");
    messageTypes.add("SOULFROST", "soulfrost");
    expect(MESSAGE_ENTRIES.map((e) => messageLookupByName(e.name))).toEqual(before);
  });
});

describe("row 20 + 21: a mod message type can carry a sound", () => {
  it("messageSoundName answers for a mod index and null past the end", () => {
    const idx = messageTypes.add("SOULFIRE", "soulfire");
    expect({
      mod: messageSoundName(idx),
      past: messageSoundName(idx + 5),
      core: messageSoundName(MSG.HIT),
      belowZero: messageSoundName(-1),
    }).toEqual({ mod: "soulfire", past: null, core: "hit", belowZero: null });
  });

  it("loadPrefs maps samples onto a mod message type and plays one", () => {
    const played: string[] = [];
    const idx = messageTypes.add("SOULFIRE", "soulfire");
    const engine = new SoundEngine({
      randint0: () => 0,
      hooks: {
        supportedFiles: () => [{ extension: ".mp3", type: 1 }],
        loadSound: (_n, _t, data) => {
          data.status = SoundStatus.LOADED;
          return true;
        },
        playSound: (data) => {
          played.push(data.name);
          return true;
        },
      },
    });
    engine.loadPrefs([{ type: "SOULFIRE", sounds: "sf_one sf_two" }]);
    engine.playSound(idx);
    expect(played).toEqual(["sf_one"]);
  });

  it("an id past every registered message type is still a no-op", () => {
    const played: string[] = [];
    const engine = new SoundEngine({
      hooks: { playSound: (d) => (played.push(d.name), true) },
    });
    engine.loadPrefs([{ type: "SOULFIRE", sounds: "sf_one" }]);
    engine.playSound(FIRST_MOD_MESSAGE_INDEX);
    expect(played).toEqual([]);
  });
});
