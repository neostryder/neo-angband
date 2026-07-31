/**
 * The BINDING half of five upstream parse/ unit tests: c-info.c (class),
 * r-info.c (monster race), ptimed.c (player timed effect), k-info.c (object
 * kind) and partrap.c (trap).
 *
 * Upstream's parse handlers do two jobs in one function body: split the line
 * (which parser.c helps with) and then resolve names to enum values, range-
 * check numbers and look across records. The port splits those: the first job
 * is packages/content (compileGamedata; pinned by
 * packages/content/src/records-monclass.upstream.test.ts) and the second is
 * the binders here. Every case whose substantive assertion is a resolved
 * value or a PARSE_ERROR_* code therefore lands in this file.
 *
 * Method for the rejection cases follows obj/bind.upstream.test.ts: take the
 * real committed pack, deep-copy it, plant exactly the token the upstream
 * case plants, and require the bind to refuse it. Each `describe` asserts the
 * unmutated pack binds first, so a throw can only come from the mutation.
 * None of this is reachable from the shipped gamedata, so the W5
 * data-exactness suite is structurally blind to all of it.
 *
 * Cases from these five files that this lane adjudicated as GAP or N/A are
 * named in the comment blocks at the bottom and in
 * parity/phase3-2026-07-25/findings/UT-monclass.md.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  COLOUR_L_GREEN,
  COLOUR_L_RED,
  COLOUR_L_WHITE,
  COLOUR_RED,
  COLOUR_VIOLET,
} from "./color.js";
import { EF, ELEM, OF, PF, RF, RSF, TMD, TRF } from "./generated/index.js";
import { EffectBuilder } from "./effects/effect.js";
import { bindMonsters } from "./mon/bind.js";
import type { MonsterPackRecords, MonsterRecordJson } from "./mon/bind.js";
import { MON_GROUP } from "./mon/types.js";
import { ObjRegistry } from "./obj/bind.js";
import type { ObjPackJson, ObjectKindRecordJson } from "./obj/types.js";
import { bindPlayer } from "./player/bind.js";
import type {
  ClassRecordJson,
  PlayerPackRecords,
  PlayerTimedRecordJson,
} from "./player/bind.js";
import { buildTempBrandSlay } from "./player/timed.js";
import { SKILL } from "./player/types.js";
import { bindTraps } from "./world/trap.js";
import type { TrapRecordJson } from "./world/trap.js";

/* ------------------------------------------------------------------ *
 * Pack loading
 * ------------------------------------------------------------------ */

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
  );
}

function records<T>(name: string): T[] {
  return (load(name) as { records: T[] }).records;
}

function monPack(): MonsterPackRecords {
  return {
    pain: records("pain"),
    blowMethods: records("blow_methods"),
    blowEffects: records("blow_effects"),
    monsterSpells: records("monster_spell"),
    monsterBases: records("monster_base"),
    monsters: records("monster"),
    summons: records("summon"),
    pits: records("pit"),
  };
}

function playerPack(): PlayerPackRecords {
  return {
    races: records("p_race"),
    classes: records("class"),
    properties: records("player_property"),
    timed: records("player_timed"),
    shapes: records("shape"),
    bodies: records("body"),
    history: records("history"),
    realms: records("realm"),
  };
}

function objPack(): ObjPackJson {
  return {
    objectBase: load("object_base"),
    object: load("object"),
    egoItem: load("ego_item"),
    artifact: load("artifact"),
    curse: load("curse"),
    brand: load("brand"),
    slay: load("slay"),
    activation: load("activation"),
    objectProperty: load("object_property"),
    flavor: load("flavor"),
  } as ObjPackJson;
}

/**
 * A record viewed as a bag of keys, so a test can plant a token in a field
 * whose declared type would refuse it (a bare presence marker, an unknown
 * enum name). Every use is a deliberate mutation of pack data.
 */
function loose(rec: object): Record<string, unknown> {
  return rec as unknown as Record<string, unknown>;
}

/* ================================================================== *
 * r-info.c -> MonsterRegistry (mon-init.c parse_monster_*)
 * ================================================================== */

describe("r-info.c: monster race binding", () => {
  /* "squint-eyed rogue": a townsfolk-based race with blows, so every
   * directive the upstream cases touch has somewhere to land. */
  const VICTIM = 10;

  /** Bind the pack with one mutation applied to the victim record. */
  function bound(mutate: (r: MonsterRecordJson) => void = () => undefined): {
    race: NonNullable<ReturnType<ReturnType<typeof bindMonsters>["raceByName"]>>;
  } {
    const pack = monPack();
    const rec = pack.monsters[VICTIM] as MonsterRecordJson;
    mutate(rec);
    const reg = bindMonsters(pack);
    const race = reg.races[VICTIM];
    if (!race) throw new Error("victim race did not bind");
    return { race };
  }

  function rejects(mutate: (r: MonsterRecordJson) => void, message: RegExp): void {
    const pack = monPack();
    mutate(pack.monsters[VICTIM] as MonsterRecordJson);
    expect(() => bindMonsters(pack)).toThrow(message);
  }

  it("the unmutated pack binds (control)", () => {
    expect(() => bound()).not.toThrow();
  });

  it("resolves the monster base by name (test_base0)", () => {
    expect(bound((r) => (r.base = "townsfolk")).race.base.name).toBe("townsfolk");
  });

  it("rejects an unknown base (test_base_bad0, INVALID_MONSTER_BASE)", () => {
    rejects((r) => (r.base = "xyzzy"), /invalid base xyzzy/);
  });

  it("keeps an explicit glyph and inherits the base's otherwise (test_glyph0)", () => {
    /* parse_monster_glyph overrides the glyph parse_monster_base copied. */
    expect(bound((r) => (r.glyph = "!")).race.dChar).toBe("!");
    expect(bound((r) => delete loose(r)["glyph"]).race.dChar).toBe(
      bound().race.base.glyph,
    );
  });

  it("resolves colours by letter and by case-insensitive full name (test_color0)", () => {
    expect(bound((r) => (r.color = "v")).race.dAttr).toBe(COLOUR_VIOLET);
    expect(bound((r) => (r.color = "Light Green")).race.dAttr).toBe(COLOUR_L_GREEN);
    expect(bound((r) => (r.color = "light red")).race.dAttr).toBe(COLOUR_L_RED);
  });

  const SCALARS: Array<
    readonly [string, keyof MonsterRecordJson & string, number, string, number]
  > = [
    ["test_speed0", "speed", 7, "speed", 7],
    ["test_hp0", "hit-points", 500, "avgHp", 500],
    ["test_ac0", "armor-class", 22, "ac", 22],
    ["test_sleep0", "sleepiness", 3, "sleep", 3],
    ["test_depth0", "depth", 42, "level", 42],
    ["test_rarity0", "rarity", 11, "rarity", 11],
    ["test_mexp0", "experience", 4, "mexp", 4],
    ["test_spell_power0", "spell-power", 15, "spellPower", 15],
  ];

  it.each(SCALARS)("%s: %s binds to %d", (_case, field, value, prop, expected) => {
    const race = bound((r) => (loose(r)[field] = value)).race;
    expect(loose(race)[prop]).toBe(expected);
  });

  it("scales hearing and smell by max_sight / 20 (test_hearing0, test_smell0)", () => {
    /* parse_monster_hearing / _smell multiply by z_info->max_sight / 20 with
     * C integer division; the upstream test sets max_sight 20, so 80 and 30
     * pass through unchanged - which is the port's default too. */
    const race = bound((r) => {
      loose(r)["hearing"] = 80;
      loose(r)["smell"] = 30;
    }).race;
    expect(race.hearing).toBe(80);
    expect(race.smell).toBe(30);
  });

  it("leaves plural null when the directive is empty (test_plural0)", () => {
    /* The compiler's presence marker for a bare "plural:" must read as the
     * NULL parse_monster_plural leaves (mon-init.c L1683-1686). */
    expect(bound((r) => (loose(r)["plural"] = true)).race.plural).toBeNull();
    expect(bound((r) => delete loose(r)["plural"]).race.plural).toBeNull();
    expect(bound((r) => (r.plural = "red-hatted elves")).race.plural).toBe(
      "red-hatted elves",
    );
  });

  it("resolves a blow's method, effect and damage dice (test_blow0, test_blow1)", () => {
    const blows = bound((r) => {
      r.blow = [
        { method: "CLAW", effect: "FIRE", damage: "9d12" },
        { method: "BITE", effect: "FIRE", damage: "6d8" },
      ];
    }).race.blows;
    expect(blows.map((b) => b.method.name)).toEqual(["CLAW", "BITE"]);
    expect(blows.map((b) => b.effect.name)).toEqual(["FIRE", "FIRE"]);
    expect(blows[0]?.dice?.testValues(0, 9, 12, 0)).toBe(true);
    expect(blows[1]?.dice?.testValues(0, 6, 8, 0)).toBe(true);
  });

  it("defaults a blow with no effect field to NONE (test_blow0)", () => {
    /* parse_monster_blow looks up "NONE" when the effect is absent. */
    expect(bound((r) => (r.blow = [{ method: "BITE" }])).race.blows[0]?.effect.name).toBe(
      "NONE",
    );
  });

  it("rejects an unknown blow method and an unknown blow effect (test_blow_bad0)", () => {
    /* UNRECOGNISED_BLOW then INVALID_EFFECT. */
    rejects((r) => (r.blow = [{ method: "XYZZY" }]), /unrecognised blow XYZZY/);
    rejects(
      (r) => (r.blow = [{ method: "BITE", effect: "XYZZY" }]),
      /invalid blow effect XYZZY/,
    );
  });

  it("ORs flags over the base's and then removes flags-off (test_flags0, test_flags_off0)", () => {
    const race = bound((r) => {
      r.flags = [true as unknown as string, "UNAWARE", "UNIQUE | MALE"];
      r["flags-off"] = [];
    }).race;
    expect(race.flags.has(RF.UNAWARE)).toBe(true);
    expect(race.flags.has(RF.UNIQUE)).toBe(true);
    expect(race.flags.has(RF.MALE)).toBe(true);

    const off = bound((r) => {
      r.flags = ["UNIQUE | MALE | UNAWARE"];
      r["flags-off"] = [true as unknown as string, "UNIQUE", "MALE | UNAWARE"];
    }).race;
    expect(off.flags.has(RF.UNIQUE)).toBe(false);
    expect(off.flags.has(RF.MALE)).toBe(false);
    expect(off.flags.has(RF.UNAWARE)).toBe(false);
  });

  it("rejects unknown flags and flags-off names (test_flags_bad0, test_flags_off_bad0)", () => {
    rejects((r) => (r.flags = ["XYZZY"]), /bad monster race flag: XYZZY/);
    rejects((r) => (r["flags-off"] = ["XYZZY"]), /bad monster race flag: XYZZY/);
  });

  it("joins desc lines with no separator (test_desc0)", () => {
    expect(bound((r) => (r.desc = ["foo bar ", " baz"])).race.text).toBe("foo bar  baz");
  });

  it("stores innate-freq and spell-freq as 100 / pct (test_innate_freq0, test_spell_freq0)", () => {
    const race = bound((r) => {
      loose(r)["innate-freq"] = 10;
      loose(r)["spell-freq"] = 4;
    }).race;
    expect(race.freqInnate).toBe(10);
    expect(race.freqSpell).toBe(25);
  });

  it("rejects frequencies outside 1..100 (test_innate_freq_bad0, test_spell_freq_bad0)", () => {
    for (const pct of [0, -2, 101]) {
      rejects(
        (r) => (loose(r)["innate-freq"] = pct),
        /invalid innate frequency percentage/,
      );
    }
    for (const pct of [0, -5, 101]) {
      rejects(
        (r) => (loose(r)["spell-freq"] = pct),
        /invalid spell frequency percentage/,
      );
    }
  });

  it("defaults spell_power to the depth (test_spell_power0)", () => {
    const race = bound((r) => {
      loose(r)["depth"] = 42;
      delete loose(r)["spell-power"];
    }).race;
    expect(race.spellPower).toBe(42);
  });

  it("ORs spell flags and defaults the matching frequency to 4 (test_spells0)", () => {
    const race = bound((r) => {
      r.spells = ["SCARE", "BR_DARK | S_HOUND"];
      delete loose(r)["innate-freq"];
      delete loose(r)["spell-freq"];
    }).race;
    expect(race.spellFlags.has(RSF.SCARE)).toBe(true);
    expect(race.spellFlags.has(RSF.BR_DARK)).toBe(true);
    expect(race.spellFlags.has(RSF.S_HOUND)).toBe(true);

    /* An innate spell with no innate-freq gets freq_innate 4. */
    const innate = bound((r) => {
      r.spells = ["SHRIEK"];
      delete loose(r)["innate-freq"];
      delete loose(r)["spell-freq"];
    }).race;
    expect(innate.freqInnate).not.toBe(0);

    /* A non-innate, non-breath spell with no spell-freq gets freq_spell 4. */
    const nonInnate = bound((r) => {
      r.spells = ["BA_ACID"];
      delete loose(r)["innate-freq"];
      delete loose(r)["spell-freq"];
    }).race;
    expect(nonInnate.freqSpell).not.toBe(0);
  });

  it("rejects an unknown spell name (test_spells_bad0, INVALID_FLAG)", () => {
    rejects((r) => (r.spells = ["XYZZY"]), /bad monster spell flag: XYZZY/);
  });

  it("binds the three alternate spell messages, empty text included (test_messagevis0, test_messageinvis0, test_messagemiss0)", () => {
    const race = bound((r) => {
      r["message-vis"] = [
        { spell: "TRAPS" },
        { spell: "WOUND", message: "{name} curses malevolently." },
      ];
      r["message-invis"] = [{ spell: "BLINK" }, { spell: "SHRIEK", message: "Something shouts." }];
      r["message-miss"] = [
        { spell: "SPIT" },
        { spell: "BOULDER", message: "{name} throws a boulder and misses." },
      ];
    }).race;
    const has = (idx: number, type: string, message: string): boolean =>
      race.spellMsgs.some(
        (m) => m.index === idx && m.msgType === type && m.message === message,
      );
    expect(has(RSF.TRAPS, "seen", "")).toBe(true);
    expect(has(RSF.WOUND, "seen", "{name} curses malevolently.")).toBe(true);
    expect(has(RSF.BLINK, "unseen", "")).toBe(true);
    expect(has(RSF.SHRIEK, "unseen", "Something shouts.")).toBe(true);
    expect(has(RSF.SPIT, "miss", "")).toBe(true);
    expect(has(RSF.BOULDER, "miss", "{name} throws a boulder and misses.")).toBe(true);
  });

  it("rejects an unknown spell on any of the three (test_messagevis_bad0, test_messageinvis_bad0, test_messagemiss_bad0)", () => {
    /* All three are PARSE_ERROR_INVALID_SPELL_NAME upstream. */
    for (const key of ["message-vis", "message-invis", "message-miss"] as const) {
      rejects(
        (r) => (loose(r)[key] = [{ spell: "XYZZY", message: "x" }]),
        /invalid spell name in message: XYZZY/,
      );
    }
  });

  it("builds ONE drops list from drop: and drop-base: (test_drop0, test_drop_base0)", () => {
    /* parse_monster_drop / _drop_base both prepend to r->drops, so the two
     * directives interleave and the list reads back last-first. */
    const drops = bound((r) => {
      r.drop = [{ tval: "light", sval: "wooden torch", chance: 10, min: 1, max: 2 }];
      r["drop-base"] = [{ tval: "light", chance: 10, min: 1, max: 2 }];
      loose(r)["drop-order"] = ["drop:0", "drop-base:0"];
    }).race.drops;
    expect(drops).toEqual([
      { tval: "light", sval: null, percentChance: 10, min: 1, max: 2 },
      { tval: "light", sval: "wooden torch", percentChance: 10, min: 1, max: 2 },
    ]);
  });

  it("binds friends and friends-base with their group role (test_friends0, test_friends_base0)", () => {
    /* Both lists are prepended upstream, so they read back last-first, and
     * an absent role is MON_GROUP_MEMBER. */
    const race = bound((r) => {
      r.friends = [
        { chance: 15, number: "1d2", name: "blubbering idiot" },
        { chance: 25, number: "2d1", name: "village idiot", role: "servant" },
        { chance: 75, number: "1d3", name: "mean-looking mercenary", role: "bodyguard" },
      ];
      r["friends-base"] = [
        { chance: 20, number: "1d3", name: "townsfolk" },
        { chance: 5, number: "1d6", name: "townsfolk", role: "servant" },
        { chance: 10, number: "1d2", name: "townsfolk", role: "bodyguard" },
      ];
    }).race;
    expect(
      race.friends.map((f) => [f.name, f.role, f.percentChance, f.numberDice, f.numberSide]),
    ).toEqual([
      ["mean-looking mercenary", MON_GROUP.BODYGUARD, 75, 1, 3],
      ["village idiot", MON_GROUP.SERVANT, 25, 2, 1],
      ["blubbering idiot", MON_GROUP.MEMBER, 15, 1, 2],
    ]);
    expect(
      race.friendsBase.map((f) => [
        f.base.name,
        f.role,
        f.percentChance,
        f.numberDice,
        f.numberSide,
      ]),
    ).toEqual([
      ["townsfolk", MON_GROUP.BODYGUARD, 10, 1, 2],
      ["townsfolk", MON_GROUP.SERVANT, 5, 1, 6],
      ["townsfolk", MON_GROUP.MEMBER, 20, 1, 3],
    ]);
    /* finish_parse_monster resolves the friend names to races. */
    expect(race.friends.every((f) => f.race !== null)).toBe(true);
  });

  it("rejects an unknown friends role and an unknown friends-base (test_friends_bad0, test_friends_base_bad0)", () => {
    rejects(
      (r) => (r.friends = [{ chance: 5, number: "1d2", name: "blubbering idiot", role: "xyzzy" }]),
      /invalid monster role: xyzzy/,
    );
    rejects(
      (r) => (r["friends-base"] = [{ chance: 15, number: "1d2", name: "xyzzy" }]),
      /invalid friends base xyzzy/,
    );
    rejects(
      (r) =>
        (r["friends-base"] = [
          { chance: 20, number: "1d3", name: "townsfolk", role: "xyzzy" },
        ]),
      /invalid monster role: xyzzy/,
    );
  });

  it("keeps a mimic kind's tval/sval and resolves shapes to a base or a race (test_mimic0, test_shape0)", () => {
    const race = bound((r) => {
      r.mimic = [{ tval: "chest", sval: "small wooden chest" }];
      r.shape = ["townsfolk", "blubbering idiot"];
    }).race;
    expect(race.mimicKinds).toEqual([{ tval: "chest", sval: "small wooden chest" }]);
    /* parse_monster_shape: a base name wins, otherwise finish_parse_monster
     * resolves a race; both lists are prepended so they read last-first. */
    expect(race.shapes.map((s) => [s.name, s.base?.name ?? null, s.race?.name ?? null])).toEqual([
      ["blubbering idiot", null, "blubbering idiot"],
      ["townsfolk", "townsfolk", null],
    ]);
  });
});

/* ================================================================== *
 * ptimed.c -> PlayerRegistry.timed (player-timed.c parse_player_timed_*)
 * ================================================================== */

describe("ptimed.c: player timed effect binding", () => {
  function bound(mutate: (r: PlayerTimedRecordJson) => void = () => undefined) {
    const pack = playerPack();
    const rec = pack.timed.find((t) => t.name === "FAST");
    if (!rec) throw new Error("no FAST timed effect in the pack");
    mutate(rec);
    const reg = bindPlayer(pack);
    const eff = reg.timed.find((t) => t.index === TMD.FAST);
    if (!eff) throw new Error("FAST did not bind");
    return eff;
  }

  function rejects(mutate: (r: PlayerTimedRecordJson) => void, message: RegExp): void {
    const pack = playerPack();
    const rec = pack.timed.find((t) => t.name === "FAST") as PlayerTimedRecordJson;
    mutate(rec);
    expect(() => bindPlayer(pack)).toThrow(message);
  }

  it("the unmutated pack binds (control)", () => {
    expect(() => bound()).not.toThrow();
  });

  it("resolves the record name to its TMD index (test_name0)", () => {
    expect(bound().index).toBe(TMD.FAST);
    expect(bound().name).toBe("FAST");
  });

  it("rejects a name that is not a timed effect (test_badname0)", () => {
    /* parse_player_timed_name: timed_name_to_idx failure is not
     * PARSE_ERROR_NONE, which is all test_badname0 asserts. */
    rejects((r) => (loose(r)["name"] = "XYZZY"), /unknown timed effect name: XYZZY/);
  });

  it("joins the four message fields with no separator (test_desc0, test_endmsg0, test_incmsg0, test_decmsg0)", () => {
    const eff = bound((r) => {
      loose(r)["desc"] = ["nourishment", " (i.e. food)"];
      loose(r)["on-end"] = ["a", "b"];
      loose(r)["on-increase"] = ["c", "d"];
      loose(r)["on-decrease"] = ["e", "f"];
    });
    expect(eff.desc).toBe("nourishment (i.e. food)");
    expect(eff.onEnd).toBe("ab");
    expect(eff.onIncrease).toBe("cd");
    expect(eff.onDecrease).toBe("ef");
  });

  it("keeps msgt as its message name (test_msgt0)", () => {
    expect(bound((r) => (loose(r)["msgt"] = "HUNGRY")).msgt).toBe("HUNGRY");
  });

  it("keeps the five fail entries with their code and flag (test_fail0)", () => {
    const eff = bound((r) => {
      loose(r)["fail"] = [
        { code: 1, flag: "FREE_ACT" },
        { code: 2, flag: "FIRE" },
        { code: 3, flag: "POIS" },
        { code: 4, flag: "NO_MANA" },
        { code: 5, flag: "SLOW" },
      ];
    });
    /* The five TMD_FAIL_FLAG_* codes: OBJECT, RESIST, VULN, PLAYER,
     * TIMED_EFFECT. Upstream prepends, so its list reads 5..1; the port
     * keeps file order and the consumers scan the list. */
    expect(eff.fail).toEqual([
      { code: 1, flag: "FREE_ACT" },
      { code: 2, flag: "FIRE" },
      { code: 3, flag: "POIS" },
      { code: 4, flag: "NO_MANA" },
      { code: 5, flag: "SLOW" },
    ]);
  });

  it("prepends the implicit zero grade and numbers the rest from 1 (test_grade0)", () => {
    const eff = bound((r) => {
      loose(r)["grade"] = [
        { color: "R", max: 1, name: " ", up_msg: " ", down_msg: "You are starving!!" },
        { color: "r", max: 4, name: "Faint", up_msg: "You are still faint." },
        { color: "G", max: 90, name: "Fed", up_msg: "You are no longer hungry." },
      ];
    });
    /* parse_player_timed_grade makes a zero grade first (max 0, colour 0)
     * and nulls a one-character name or up-message dummy. */
    expect(eff.grades[0]).toEqual({
      grade: 0,
      color: 0,
      max: 0,
      name: null,
      upMsg: null,
      downMsg: null,
    });
    expect(eff.grades.map((g) => [g.grade, g.max, g.name, g.upMsg, g.downMsg])).toEqual([
      [0, 0, null, null, null],
      [1, 1, null, null, "You are starving!!"],
      [2, 4, "Faint", "You are still faint.", null],
      [3, 90, "Fed", "You are no longer hungry.", null],
    ]);
    /* Angband's colour letters: "r" is COLOUR_RED, "R" is COLOUR_L_RED. */
    expect(eff.grades[1]?.color).toBe(COLOUR_L_RED);
  });

  it("scales FOOD's grade maxima by z_info->food_value (test_grade0)", () => {
    const pack = playerPack();
    const food = bindPlayer(pack).timed.find((t) => t.index === TMD.FOOD);
    /* player_timed.txt's FOOD grades are percentages; food_value is 100. */
    expect(food?.grades.map((g) => g.max).slice(0, 4)).toEqual([0, 100, 400, 800]);
  });

  it("rejects a grade maximum out of range or out of order (test_badgrade0)", () => {
    for (const max of [-1, 0, 32768]) {
      rejects(
        (r) => (loose(r)["grade"] = [{ color: "G", max, name: "Haste", up_msg: "x" }]),
        /grade maximum .* out of range/,
      );
    }
    rejects(
      (r) =>
        (loose(r)["grade"] = [
          { color: "G", max: 50, name: "Haste", up_msg: "x" },
          { color: "R", max: 25, name: "Haste", up_msg: "x" },
        ]),
      /does not ascend/,
    );
  });

  it("resolves resist to an element index (test_resist0)", () => {
    expect(bound((r) => (loose(r)["resist"] = "COLD")).tempResist).toBe(ELEM.COLD);
  });

  it("rejects an unknown resist element (test_badresist0)", () => {
    rejects((r) => (loose(r)["resist"] = "XYZZY"), /unknown resist element XYZZY/);
  });

  it("resolves the first flag-synonym to an OF code and its exact bit (test_flagsyn0)", () => {
    const one = bound((r) => (loose(r)["flag-synonym"] = [{ code: "SUST_STR", exact: 0 }]));
    expect(one.oflagDup).toBe(OF.SUST_STR);
    expect(one.oflagSyn).toBe(false);
    const two = bound((r) => (loose(r)["flag-synonym"] = [{ code: "TELEPATHY", exact: 1 }]));
    expect(two.oflagDup).toBe(OF.TELEPATHY);
    expect(two.oflagSyn).toBe(true);
  });

  it("rejects an unknown flag-synonym code (test_badflagsyn0, INVALID_OBJ_PROP_CODE)", () => {
    rejects(
      (r) => (loose(r)["flag-synonym"] = [{ code: "XYZZY", exact: 0 }]),
      /unknown flag-synonym code XYZZY/,
    );
  });

  it("resolves each effect chain step's EF code and subtype (test_begineffect0, test_endeffect0)", () => {
    const eff = bound((r) => {
      loose(r)["on-begin-effect"] = [{ eff: "DAMAGE" }, { eff: "CURE", type: "BLIND" }];
      loose(r)["on-end-effect"] = [{ eff: "BALL", type: "COLD" }];
    });
    expect(eff.onBeginEffect?.map((s) => [s.effect, s.subtype])).toEqual([
      [EF.DAMAGE, 0],
      [EF.CURE, TMD.BLIND],
    ]);
    expect(eff.onEndEffect?.[0]?.effect).toBe(EF.BALL);
  });

  it("rejects an unknown effect or subtype on either chain (test_badbegineffect0, test_badendeffect0)", () => {
    /* INVALID_EFFECT for the effect name, INVALID_VALUE for the subtype. */
    rejects(
      (r) => (loose(r)["on-begin-effect"] = [{ eff: "XYZZY" }]),
      /unknown effect XYZZY/,
    );
    rejects(
      (r) => (loose(r)["on-end-effect"] = [{ eff: "XYZZY" }]),
      /unknown effect XYZZY/,
    );
    rejects(
      (r) => (loose(r)["on-begin-effect"] = [{ eff: "CURE", type: "XYZZY" }]),
      /invalid subtype XYZZY.*PARSE_ERROR_INVALID_VALUE/,
    );
    rejects(
      (r) => (loose(r)["on-end-effect"] = [{ eff: "CURE", type: "XYZZY" }]),
      /invalid subtype XYZZY.*PARSE_ERROR_INVALID_VALUE/,
    );
  });

  it("resolves a timed brand and slay code to its table index (test_brand0, test_slay0)", () => {
    /* The port resolves temp_brand / temp_slay in buildTempBrandSlay
     * (player/timed.ts) against the bound brand and slay tables rather than
     * stamping them on the record at parse time, so the assertion is that
     * the code picks out the right index and gates on the effect being up. */
    const brands = [null, { code: "POIS_2" }, { code: "ELEC_2" }, { code: "ACID_3" }];
    const slays = [null, { code: "UNDEAD_3" }, { code: "GIANT_3" }, { code: "ANIMAL_2" }];
    const timedRecords = [{ brand: ["ACID_3"], slay: ["ANIMAL_2"] }];
    const target = { timed: [1] } as unknown as Parameters<typeof buildTempBrandSlay>[0];
    const live = buildTempBrandSlay(target, timedRecords, brands, slays);
    expect(live.hasBrand(3)).toBe(true);
    expect(live.hasBrand(1)).toBe(false);
    expect(live.hasSlay(3)).toBe(true);
    expect(live.hasSlay(1)).toBe(false);

    /* An inactive effect grants neither. */
    const off = buildTempBrandSlay(
      { timed: [0] } as unknown as Parameters<typeof buildTempBrandSlay>[0],
      timedRecords,
      brands,
      slays,
    );
    expect(off.hasBrand(3)).toBe(false);
    expect(off.hasSlay(3)).toBe(false);
  });

  it("keeps an effect-dice override on the chain step (test_effectdice0)", () => {
    const eff = bound((r) => {
      loose(r)["on-end-effect"] = [{ eff: "DAMAGE", "effect-dice": "3+4d5" }];
    });
    expect(eff.onEndEffect?.[0]?.dice).toBe("3+4d5");
  });

  it("sets NONSTACKING from the flags line and tolerates an empty one (test_flags0)", () => {
    expect(bound((r) => (loose(r)["flags"] = [])).nonStacking).toBe(false);
    expect(bound((r) => (loose(r)["flags"] = [true])).nonStacking).toBe(false);
    expect(bound((r) => (loose(r)["flags"] = ["NONSTACKING"])).nonStacking).toBe(true);
  });

  it("rejects any flag but NONSTACKING (test_badflags0, INVALID_FLAG)", () => {
    rejects((r) => (loose(r)["flags"] = ["XYZZY"]), /unknown flag XYZZY/);
  });

  it("binds lower-bound (test_lowerbound0)", () => {
    expect(bound((r) => (loose(r)["lower-bound"] = 10)).lowerBound).toBe(10);
  });

  it("rejects a lower-bound outside 0..32767 (test_badlowerbound0, INVALID_VALUE)", () => {
    for (const bound_ of [-1, -10, 32768, 65535]) {
      rejects(
        (r) => (loose(r)["lower-bound"] = bound_),
        /lower-bound .* out of range/,
      );
    }
  });
});

/* ================================================================== *
 * c-info.c -> PlayerRegistry.classes (init.c parse_class_*)
 * ================================================================== */

describe("c-info.c: player class binding", () => {
  /* The Druid: a caster, so magic / book / spell all have somewhere to go. */
  const VICTIM = 2;

  function bound(mutate: (r: ClassRecordJson) => void = () => undefined) {
    const pack = playerPack();
    mutate(pack.classes[VICTIM] as ClassRecordJson);
    const cls = bindPlayer(pack).classes[VICTIM];
    if (!cls) throw new Error("victim class did not bind");
    return cls;
  }

  function rejects(mutate: (r: ClassRecordJson) => void, message: RegExp): void {
    const pack = playerPack();
    mutate(pack.classes[VICTIM] as ClassRecordJson);
    expect(() => bindPlayer(pack)).toThrow(message);
  }

  it("the unmutated pack binds (control)", () => {
    expect(() => bound()).not.toThrow();
  });

  it("binds the five stat adjustments by name (test_stats0)", () => {
    const cls = bound((r) => {
      r.stats = { str: 3, int: -3, wis: 2, dex: -2, con: 1 };
    });
    expect(cls.statAdj).toEqual([3, -3, 2, -2, 1]);
  });

  it("binds class skills to their SKILL index, not their file position (test_skill_disarm_phys0 .. test_skill_dig0)", () => {
    /* class.txt lists stealth before search, but SKILL_SEARCH precedes
     * SKILL_STEALTH: the bind is by directive name. */
    const cls = bound((r) => {
      r["skill-disarm-phys"] = { base: 30, incr: 8 };
      r["skill-disarm-magic"] = { base: 20, incr: 10 };
      r["skill-device"] = { base: 32, incr: 10 };
      r["skill-save"] = { base: 28, incr: 10 };
      r["skill-stealth"] = { base: 3, incr: 0 };
      r["skill-search"] = { base: 24, incr: 0 };
      r["skill-melee"] = { base: 56, incr: 30 };
      r["skill-shoot"] = { base: 72, incr: 45 };
      r["skill-throw"] = { base: 72, incr: 45 };
      r["skill-dig"] = { base: 0, incr: 0 };
    });
    const pairs: Array<readonly [number, number, number]> = [
      [SKILL.DISARM_PHYS, 30, 8],
      [SKILL.DISARM_MAGIC, 20, 10],
      [SKILL.DEVICE, 32, 10],
      [SKILL.SAVE, 28, 10],
      [SKILL.STEALTH, 3, 0],
      [SKILL.SEARCH, 24, 0],
      [SKILL.TO_HIT_MELEE, 56, 30],
      [SKILL.TO_HIT_BOW, 72, 45],
      [SKILL.TO_HIT_THROW, 72, 45],
      [SKILL.DIGGING, 0, 0],
    ];
    for (const [idx, base, incr] of pairs) {
      expect(cls.skills[idx], String(idx)).toBe(base);
      expect(cls.extraSkills[idx], String(idx)).toBe(incr);
    }
  });

  it("binds hitdie, exp, max-attacks, min-weight and strength-multiplier (test_hitdie0, test_exp0, test_max_attacks0, test_min_weight0, test_strength_multiplier0)", () => {
    const cls = bound((r) => {
      r.hitdie = 4;
      loose(r)["exp"] = 30;
      loose(r)["max-attacks"] = 5;
      loose(r)["min-weight"] = 35;
      loose(r)["strength-multiplier"] = 4;
    });
    expect([cls.hitdie, cls.expFactor, cls.maxAttacks, cls.minWeight, cls.attMultiply]).toEqual(
      [4, 30, 5, 35, 4],
    );
  });

  it("keeps the ten titles in level order (test_title0)", () => {
    const titles = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    expect(bound((r) => (r.title = titles)).titles).toEqual(titles);
  });

  it("rejects an eleventh title (test_title_bad0, TOO_MANY_ENTRIES)", () => {
    /* parse_class_title fills `const char *title[10]` and reports
     * PARSE_ERROR_TOO_MANY_ENTRIES once it is full. */
    rejects(
      (r) => (r.title = [...(r.title ?? []), "One Title Too Many"]),
      /has 11 titles, max 10/,
    );
  });

  it("binds starting equipment and splits its birth-option list (test_equip0)", () => {
    /* parse_class_equip strtok()s eopts on " |", drops "none", and stores a
     * negated option as its NOT- form. */
    const cls = bound((r) => {
      r.equip = [
        { tval: "magic book", sval: "2", min: 2, max: 5, eopts: "none" },
        { tval: "light", sval: "lantern", min: 1, max: 1, eopts: "birth_no_recall" },
        {
          tval: "light",
          sval: "wooden torch",
          min: 1,
          max: 2,
          eopts: "NOT-birth_no_recall | birth_force_descend",
        },
      ];
    });
    expect(cls.startItems.map((s) => [s.tval, s.sval, s.min, s.max, s.eopts])).toEqual([
      ["magic book", "2", 2, 5, []],
      ["light", "lantern", 1, 1, ["birth_no_recall"]],
      [
        "light",
        "wooden torch",
        1,
        2,
        ["NOT-birth_no_recall", "birth_force_descend"],
      ],
    ]);
  });

  it("ORs obj-flags and player-flags, empty lines included (test_obj_flags0, test_player_flags0)", () => {
    const cls = bound((r) => {
      loose(r)["obj-flags"] = [true, "FEATHER", "SEE_INVIS | IMPAIR_HP"];
      loose(r)["player-flags"] = [true, "ZERO_FAIL", "BLESS_WEAPON | CHOOSE_SPELLS"];
    });
    expect(cls.flags.has(OF.FEATHER)).toBe(true);
    expect(cls.flags.has(OF.SEE_INVIS)).toBe(true);
    expect(cls.flags.has(OF.IMPAIR_HP)).toBe(true);
    expect(cls.pflags.has(PF.ZERO_FAIL)).toBe(true);
    expect(cls.pflags.has(PF.BLESS_WEAPON)).toBe(true);
    expect(cls.pflags.has(PF.CHOOSE_SPELLS)).toBe(true);
  });

  it("rejects unknown obj-flags and player-flags names (test_obj_flags_bad0, test_player_flags_bad0)", () => {
    rejects((r) => (r["obj-flags"] = ["XYZZY"]), /bad class object flag: XYZZY/);
    rejects((r) => (r["player-flags"] = ["XYZZY"]), /bad class player flag: XYZZY/);
  });

  it("binds magic's first level, weight and book count (test_magic0)", () => {
    const cls = bound((r) => {
      if (r.magic) {
        r.magic.first = 4;
        r.magic.weight = 400;
        r.magic.books = 3;
      }
    });
    expect([cls.magic.spellFirst, cls.magic.spellWeight, cls.magic.numBooks]).toEqual([
      4, 400, 3,
    ]);
  });

  it("resolves a book's realm and marks dungeon books (test_book0)", () => {
    const cls = bound();
    const book = cls.magic.books[0];
    expect(book?.realm.name).toBe("nature");
    expect(book?.dungeon).toBe(false);
    expect(cls.magic.books.some((b) => b.dungeon)).toBe(true);
  });

  it("rejects an unknown realm on a book (test_book_bad0)", () => {
    rejects(
      (r) => {
        if (r.book?.[0]) r.book[0].realm = "xyzzy";
      },
      /unknown realm xyzzy/,
    );
  });

  it("numbers spells class-wide and points each at its book (test_spell0)", () => {
    /* s->sidx is the class-wide spell index in declaration order and
     * s->bidx is the owning book. */
    const cls = bound();
    let expected = 0;
    for (let b = 0; b < cls.magic.books.length; b++) {
      for (const s of cls.magic.books[b]?.spells ?? []) {
        expect(s.sidx).toBe(expected++);
        expect(s.bidx).toBe(b);
      }
    }
    expect(cls.magic.totalSpells).toBe(expected);
    const first = cls.magic.books[0]?.spells[0];
    expect(first?.realm.name).toBe("nature");
    expect(typeof first?.level).toBe("number");
  });

  it("joins a spell's desc lines with no separator (test_desc0)", () => {
    const cls = bound((r) => {
      const s = r.book?.[0]?.spell?.[0];
      if (s) s.desc = ["Shoots a bolt of frost.", "  Sometimes a beam."];
    });
    expect(cls.magic.books[0]?.spells[0]?.text).toBe(
      "Shoots a bolt of frost.  Sometimes a beam.",
    );
  });
});

/* ================================================================== *
 * partrap.c -> bindTraps (init.c parse_trap_*)
 * ================================================================== */

describe("partrap.c: trap kind binding", () => {
  /* "door lock": a minimal record, so every mutation is visible. */
  const VICTIM = 3;

  function bound(mutate: (r: TrapRecordJson) => void = () => undefined) {
    const list = records<TrapRecordJson>("trap");
    mutate(list[VICTIM] as TrapRecordJson);
    const kind = bindTraps(list)[VICTIM];
    if (!kind) throw new Error("victim trap did not bind");
    return kind;
  }

  function rejects(mutate: (r: TrapRecordJson) => void, message: RegExp): void {
    const list = records<TrapRecordJson>("trap");
    mutate(list[VICTIM] as TrapRecordJson);
    expect(() => bindTraps(list)).toThrow(message);
  }

  it("the unmutated pack binds (control)", () => {
    expect(() => bound()).not.toThrow();
  });

  it("splits the header into the short name and the lookup desc (test_name0)", () => {
    const kind = bound((r) => (r.name = { name: "test trap", desc: "test trap 1" }));
    expect([kind.name, kind.desc]).toEqual(["test trap", "test trap 1"]);
  });

  it("keeps the glyph and colour for the display layer (test_graphics0)", () => {
    const kind = bound((r) => (r.graphics = { glyph: "^", color: "Red" }));
    expect([kind.glyph, kind.color]).toEqual(["^", "Red"]);
  });

  it("binds appear into rarity, min depth and max number (test_appear0)", () => {
    const kind = bound((r) => (r.appear = { rarity: 2, mindepth: 20, maxnum: 1 }));
    expect([kind.rarity, kind.minDepth, kind.maxNum]).toEqual([2, 20, 1]);
  });

  it("parses visibility into the power random-value (test_visibility0)", () => {
    /* parse_trap_visibility runs dice_parse_string then dice_random_value. */
    expect(bound((r) => (r.visibility = "5+2d10M50")).power).toEqual({
      base: 5,
      dice: 2,
      sides: 10,
      mBonus: 50,
    });
    /* test_complete0's "M50" is m_bonus only. */
    expect(bound((r) => (r.visibility = "M50")).power).toEqual({
      base: 0,
      dice: 0,
      sides: 0,
      mBonus: 50,
    });
  });

  it("rejects a visibility that is not a dice string (test_visibility_bad0, NOT_RANDOM)", () => {
    rejects((r) => (r.visibility = "1d6+1d10"), /bad power "1d6\+1d10"/);
  });

  it("ORs the TRF flags, empty line included (test_flags0)", () => {
    const kind = bound((r) => {
      r.flags = [true as unknown as string, "TRAP", "FLOOR | VISIBLE"];
    });
    expect(kind.flags.has(TRF.TRAP)).toBe(true);
    expect(kind.flags.has(TRF.FLOOR)).toBe(true);
    expect(kind.flags.has(TRF.VISIBLE)).toBe(true);
  });

  it("rejects an unknown trap flag (test_flags_bad0, INVALID_FLAG)", () => {
    rejects((r) => (r.flags = ["XYZZY"]), /unknown flag XYZZY/);
  });

  it("resolves the save flags to OF indexes (test_save0)", () => {
    const kind = bound((r) => (r.save = "FEATHER | FREE_ACT | HOLD_LIFE"));
    expect(kind.saveFlags.slice().sort((a, b) => a - b)).toEqual(
      [OF.FEATHER, OF.FREE_ACT, OF.HOLD_LIFE].sort((a, b) => a - b),
    );
  });

  it("rejects an unknown save flag (test_save_bad0, INVALID_FLAG)", () => {
    rejects((r) => (r.save = "XYZZY"), /unknown save flag XYZZY/);
  });

  it("joins the five text fields with no separator (test_desc0, test_msg0, test_msg_good0, test_msg_bad0, test_msg_xtra0)", () => {
    const kind = bound((r) => {
      r.desc = ["A beam threatens to collapse.", "  Best not be nearby."];
      r.msg = ["Blades whirl!", "  Blood mists."];
      r["msg-good"] = ["You spring aside.", "  The floor shatters."];
      r["msg-bad"] = ["A dart hits you!", "  Numbness spreads."];
      r["msg-xtra"] = ["You are impaled!", "  And bleed."];
    });
    expect(kind.text).toBe("A beam threatens to collapse.  Best not be nearby.");
    expect(kind.msg).toBe("Blades whirl!  Blood mists.");
    expect(kind.msgGood).toBe("You spring aside.  The floor shatters.");
    expect(kind.msgBad).toBe("A dart hits you!  Numbness spreads.");
    expect(kind.msgXtra).toBe("You are impaled!  And bleed.");
  });

  it("keeps the two effect families apart and unevaluated (test_complete0)", () => {
    const kind = bound((r) => {
      r.effect = [
        { eff: "DAMAGE", dice: "1d4" },
        { eff: "TIMED_INC_NO_RES", type: "SLOW", dice: "20+1d20" },
      ];
      delete loose(r)["effect-xtra"];
    });
    expect(kind.effect).toHaveLength(2);
    expect(kind.effectXtra).toEqual([]);
    /* Each activation builds the chain from these raw records, exactly like
     * object effects; test_complete0's dice values are asserted through
     * EffectBuilder below. */
    const chain = new EffectBuilder()
      .effect("DAMAGE")
      .dice("1d4")
      .effect("TIMED_INC_NO_RES:SLOW")
      .dice("20+1d20")
      .build();
    expect(chain?.index).toBe(EF.DAMAGE);
    expect(chain?.dice?.testValues(0, 1, 4, 0)).toBe(true);
    expect(chain?.next?.index).toBe(EF.TIMED_INC_NO_RES);
    expect(chain?.next?.subtype).toBe(TMD.SLOW);
    expect(chain?.next?.dice?.testValues(20, 1, 20, 0)).toBe(true);
  });
});

/* ================================================================== *
 * k-info.c -> ObjRegistry.kinds (obj-init.c parse_object_*)
 * ================================================================== */

describe("k-info.c: object kind binding", () => {
  function bound(mutate: (r: ObjectKindRecordJson) => void = () => undefined) {
    const pack = objPack();
    const recs = (pack.object as unknown as { records: ObjectKindRecordJson[] }).records;
    const rec = recs[0] as ObjectKindRecordJson;
    mutate(rec);
    const kind = new ObjRegistry(pack).kinds[0];
    if (!kind) throw new Error("victim kind did not bind");
    return kind;
  }

  it("the unmutated pack binds (control)", () => {
    expect(() => bound()).not.toThrow();
  });

  it("resolves the tval name and assigns the next sval for that base (test_type0)", () => {
    /* parse_object_type does ++kb_info[tval].num_svals and stores it, so a
     * kind's sval is its ordinal within its base. */
    const pack = objPack();
    const reg = new ObjRegistry(pack);
    const tval = reg.kinds[0]?.tval;
    const sameBase = reg.kinds.filter((k) => k.tval === tval);
    expect(sameBase.map((k) => k.sval)).toEqual(sameBase.map((_, i) => i + 1));
  });

  it("binds level, weight, cost and power (test_level0, test_weight0, test_cost0, test_power0)", () => {
    const kind = bound((r) => {
      r.level = 10;
      r.weight = 5;
      r.cost = 120;
      r.power = 17;
    });
    expect([kind.level, kind.weight, kind.cost, kind.power]).toEqual([10, 5, 120, 17]);
  });

  it("splits alloc into commonness and an int range (test_alloc0)", () => {
    const kind = bound((r) => (r.alloc = { common: 3, minmax: "4 to 6" }));
    expect([kind.allocProb, kind.allocMin, kind.allocMax]).toEqual([3, 4, 6]);
  });

  it("binds attack into dd/ds plus the to-h and to-d random values (test_attack0)", () => {
    const kind = bound((r) => (r.attack = { hd: "4d8", "to-h": "1d4", "to-d": "2d5" }));
    expect([kind.dd, kind.ds]).toEqual([4, 8]);
    expect([kind.toH.dice, kind.toH.sides]).toEqual([1, 4]);
    expect([kind.toD.dice, kind.toD.sides]).toEqual([2, 5]);
  });

  it("binds armor into ac plus the to-a random value (test_armor0)", () => {
    const kind = bound((r) => (r.armor = { ac: 3, "to-a": "7d6" }));
    expect(kind.ac).toBe(3);
    expect([kind.toA.dice, kind.toA.sides]).toEqual([7, 6]);
  });

  it("binds charges, pval and time as random values (test_charges0, test_pval0, test_time0)", () => {
    const kind = bound((r) => {
      r.charges = "2d8";
      r.pval = "1+2d3M4";
      r.time = "4d5";
    });
    expect([kind.charge.dice, kind.charge.sides]).toEqual([2, 8]);
    expect(kind.pval).toEqual({ base: 1, dice: 2, sides: 3, mBonus: 4 });
    expect([kind.time.dice, kind.time.sides]).toEqual([4, 5]);
  });

  it("takes the LAST pile line, as upstream's plain assignment does (test_pile0)", () => {
    const kind = bound((r) => (r.pile = [{ prob: 4, stack: "3d6" }]));
    expect(kind.genMultProb).toBe(4);
    expect([kind.stackSize.dice, kind.stackSize.sides]).toEqual([3, 6]);

    /* object.txt:3678/3680 is the only shipped record with two pile lines. */
    const db = new ObjRegistry(objPack()).kinds.find((k) => k.name === "Dragon Breath");
    expect(db?.genMultProb).toBe(70);
    expect([db?.stackSize.dice, db?.stackSize.sides]).toEqual([1, 3]);
  });

  it("splits flags across OF, KF and the element info (test_flags0)", () => {
    const kind = bound((r) => (r.flags = ["EASY_KNOW | FEATHER", "IGNORE_COLD"]));
    expect(kind.flags.has(OF.FEATHER)).toBe(true);
    expect(kind.flags.has(OF.SLOW_DIGEST)).toBe(false);
    /* EASY_KNOW is a kind flag, and IGNORE_COLD an el_info flag. */
    expect(kind.kindFlags.isEmpty()).toBe(false);
    expect(kind.elInfo[ELEM.COLD]?.flags).not.toBe(0);
    for (let i = 0; i < kind.elInfo.length; i++) {
      if (i !== ELEM.COLD) expect(kind.elInfo[i]?.flags).toBe(0);
    }
  });

  it("splits values into modifiers and resistances (test_values0)", () => {
    const kind = bound((r) => (r.values = ["STEALTH[-5]", "RES_ELEC[3] | SPEED[1+1d2]"]));
    const nonzero = kind.modifiers
      .map((m, i) => [i, m] as const)
      .filter(([, m]) => m.base !== 0 || m.dice !== 0 || m.sides !== 0 || m.mBonus !== 0);
    expect(nonzero).toHaveLength(2);
    expect(kind.elInfo[ELEM.ELEC]?.resLevel).toBe(3);
    for (let i = 0; i < kind.elInfo.length; i++) {
      if (i !== ELEM.ELEC) expect(kind.elInfo[i]?.resLevel).toBe(0);
    }
  });

  it("joins desc, msg and vis-msg with no separator (test_desc0, test_msg0, test_vis_msg0)", () => {
    const kind = bound((r) => {
      r.desc = ["foo bar", " baz"];
      r.msg = ["It feels warm.", " And stinks."];
      r["vis-msg"] = ["It glows.", " And sparks."];
    });
    expect(kind.text).toBe("foo bar baz");
    expect(kind.effectMsg).toBe("It feels warm. And stinks.");
    expect(kind.visMsg).toBe("It glows. And sparks.");
  });

  it("marks the named slay and brand in the 1-based tables (test_slay0, test_brand0)", () => {
    const kind = bound((r) => {
      r.slay = ["ORC_3"];
      r.brand = ["COLD_2"];
    });
    expect(kind.slays?.[0]).toBe(false);
    expect(kind.slays?.filter(Boolean)).toHaveLength(1);
    expect(kind.brands?.[0]).toBe(false);
    expect(kind.brands?.filter(Boolean)).toHaveLength(1);
  });

  it("ignores a curse with non-positive power (test_curse0)", () => {
    /* parse_object_curse only records the curse when power > 0, so k->curses
     * stays NULL for a 0 or negative power. */
    expect(
      bound((r) => {
        r.curse = [
          { name: "vulnerability", power: 0 },
          { name: "vulnerability", power: -5 },
        ];
      }).curses,
    ).toBeNull();
    const withPower = bound((r) => {
      r.curse = [
        { name: "vulnerability", power: 0 },
        { name: "teleportation", power: 5 },
      ];
    });
    expect(withPower.curses?.filter((p) => p > 0)).toEqual([5]);
  });
});

/* ================================================================== *
 * The shared effect builder: one port function where upstream has four
 * copies of grab_effect_data plus the dice / expr / effect-msg handlers.
 * ================================================================== */

describe("EffectBuilder: the effect / dice / expr handlers of all four parsers", () => {
  it("takes the optional subtype, radius and other in order (c-info.c/k-info.c/partrap.c test_effect0)", () => {
    const chain = new EffectBuilder()
      .effect("LIGHT_AREA")
      .effect("BOLT_OR_BEAM:COLD")
      .effect("BALL:FIRE:2")
      .effect("SHORT_BEAM:ELEC:0:1")
      .build();
    const flat: Array<[number, number, number, number]> = [];
    for (let e = chain; e; e = e.next) {
      flat.push([e.index as number, e.subtype, e.radius, e.other]);
    }
    expect(flat[0]?.[0]).toBe(EF.LIGHT_AREA);
    expect(flat[0]?.slice(1)).toEqual([0, 0, 0]);
    expect(flat[1]?.[0]).toBe(EF.BOLT_OR_BEAM);
    expect(flat[2]?.[0]).toBe(EF.BALL);
    expect(flat[2]?.[2]).toBe(2);
    expect(flat[3]?.[0]).toBe(EF.SHORT_BEAM);
    expect(flat[3]?.[2]).toBe(0);
    expect(flat[3]?.[3]).toBe(1);
    /* Every new effect appends to the tail and leaves dice/msg unset. */
    expect(chain?.dice).toBeNull();
    expect(chain?.msg).toBeNull();
  });

  it("resolves a TMD, a PROJ and a STAT subtype (ptimed.c test_begineffect0, partrap.c test_effect0, test_effect_xtra0)", () => {
    expect(new EffectBuilder().effect("CURE:BLIND").build()?.subtype).toBe(TMD.BLIND);
    expect(new EffectBuilder().effect("TIMED_INC:SLOW").build()?.subtype).toBe(TMD.SLOW);
    expect(new EffectBuilder().effect("DRAIN_STAT:STR").build()?.subtype).toBe(0);
  });

  it("rejects an unknown effect and an unknown subtype (k-info.c/partrap.c test_effect_bad0, test_effect_xtra_bad0, ptimed.c test_badbegineffect0, test_badendeffect0)", () => {
    /* PARSE_ERROR_INVALID_EFFECT then PARSE_ERROR_INVALID_VALUE. */
    expect(() => new EffectBuilder().effect("XYZZY")).toThrow(
      /PARSE_ERROR_INVALID_EFFECT/,
    );
    expect(() => new EffectBuilder().effect("TIMED_INC:XYZZY")).toThrow(
      /PARSE_ERROR_INVALID_VALUE/,
    );
    expect(() => new EffectBuilder().effect("BALL:XYZT:3")).toThrow(
      /PARSE_ERROR_INVALID_VALUE/,
    );
    expect(() => new EffectBuilder().effect("CURE:XYZZY")).toThrow(
      /PARSE_ERROR_INVALID_VALUE/,
    );
  });

  it("applies effect-yx to the tail effect (c-info.c/k-info.c/partrap.c test_effect_yx0, partrap.c test_effect_yx_xtra0, ptimed.c test_effectyx0)", () => {
    const chain = new EffectBuilder().effect("DAMAGE").effect("MAP_AREA").effectYx(11, 23).build();
    expect([chain?.y, chain?.x]).toEqual([0, 0]);
    expect([chain?.next?.y, chain?.next?.x]).toEqual([11, 23]);
  });

  it("applies dice to the tail effect and lets a second line replace it (c-info.c/k-info.c/partrap.c test_dice0, partrap.c test_dice_xtra0, ptimed.c test_effectdice0)", () => {
    const chain = new EffectBuilder().effect("BOLT:FIRE").dice("8+1d10m5").dice("6+2d4").build();
    expect(chain?.dice?.testValues(6, 2, 4, 0)).toBe(true);
    expect(new EffectBuilder().effect("DAMAGE").dice("5d8").build()?.dice?.testValues(0, 5, 8, 0)).toBe(
      true,
    );
    expect(
      new EffectBuilder().effect("DAMAGE").dice("5+2d8M30").build()?.dice?.testValues(5, 2, 8, 30),
    ).toBe(true);
    expect(
      new EffectBuilder().effect("DAMAGE").dice("10+5d6").build()?.dice?.testValues(10, 5, 6, 0),
    ).toBe(true);
    expect(
      new EffectBuilder().effect("DAMAGE").dice("5+2d20").build()?.dice?.testValues(5, 2, 20, 0),
    ).toBe(true);
  });

  it("rejects a malformed dice string (c-info.c/k-info.c/partrap.c test_dice_bad0, partrap.c test_dice_xtra_bad0, ptimed.c test_badeffectdice0)", () => {
    /* Every string the five cases feed the dice handler; all are
     * PARSE_ERROR_INVALID_DICE. */
    for (const s of [
      "1d4 + 1d8",
      "d6+d8",
      "1d8+7",
      "1d6+1d8+1d12",
      "2+1d3+1d4",
    ]) {
      expect(() => new EffectBuilder().effect("DAMAGE").dice(s), s).toThrow(
        /PARSE_ERROR_INVALID_DICE/,
      );
    }
  });

  it("is a no-op when a dependency precedes any effect (c-info.c/k-info.c test_missing_effect0, partrap.c test_missing_effect_xtra0)", () => {
    /* The class / object / trap handlers return PARSE_ERROR_NONE and leave
     * the record untouched. (player_timed's do NOT - see the requireParent
     * note in content/src/specs/misc.ts.) */
    const chain = new EffectBuilder().effectYx(3, 7).dice("d$S").expr("S", "PLAYER_LEVEL", "+ 0").build();
    expect(chain).toBeNull();
  });

  it("is a no-op when expr precedes any dice (c-info.c/k-info.c/partrap.c test_missing_dice0, partrap.c test_missing_dice_xtra0)", () => {
    const chain = new EffectBuilder()
      .effect("TIMED_INC:SINVIS")
      .expr("B", "PLAYER_LEVEL", "/ 6 + 1")
      .build();
    expect(chain?.dice).toBeNull();
  });

  it("binds an expression into the dice (c-info.c/k-info.c/partrap.c test_expr0, partrap.c test_expr_xtra0, ptimed.c test_effectexpr0)", () => {
    expect(() =>
      new EffectBuilder().effect("BOLT:FIRE").dice("$Dd8").expr("D", "PLAYER_LEVEL", "/ 5 + 1"),
    ).not.toThrow();
    expect(() =>
      new EffectBuilder().effect("RESTORE_MANA").dice("$B").expr("B", "PLAYER_HP", "/ 50 + 15"),
    ).not.toThrow();
    expect(() =>
      new EffectBuilder().effect("DAMAGE").dice("$B+5d$S").expr("B", "DUNGEON_LEVEL", "/ 10 + 8"),
    ).not.toThrow();
    expect(() =>
      new EffectBuilder().effect("DAMAGE").dice("4d$S").expr("S", "DUNGEON_LEVEL", "+ 19 / 20"),
    ).not.toThrow();
  });

  it("rejects a bad operations string and an unbound variable (c-info.c/k-info.c/partrap.c test_expr_bad0, partrap.c test_expr_xtra_bad0, ptimed.c test_badeffectexpr0)", () => {
    /* BAD_EXPRESSION_STRING for an operator expression_add_operations_string
     * refuses, UNBOUND_EXPRESSION for a variable absent from the dice. */
    for (const op of ["^ 2", "% 9", "+ ( PLAYER_HP / 100 )"]) {
      expect(() =>
        new EffectBuilder().effect("DAMAGE").dice("$B+10d$S").expr("S", "DUNGEON_LEVEL", op),
        op,
      ).toThrow(/PARSE_ERROR_BAD_EXPRESSION_STRING/);
    }
    for (const name of ["E", "M", "T", "N", "B"]) {
      expect(() =>
        new EffectBuilder().effect("DAMAGE").dice("$Dd8").expr(name, "PLAYER_LEVEL", "* 4 - 3"),
        name,
      ).toThrow(/PARSE_ERROR_UNBOUND_EXPRESSION/);
    }
  });

  it("appends each effect-msg to the tail effect's message (c-info.c test_effect_msg0, ptimed.c test_effectmsg0)", () => {
    /* string_append, so two directives concatenate with no separator. */
    const chain = new EffectBuilder()
      .effect("DAMAGE")
      .effectMsg("shadow shifting")
      .effectMsg(" went wrong")
      .build();
    expect(chain?.msg).toBe("shadow shifting went wrong");
    const two = new EffectBuilder()
      .effect("DAMAGE")
      .effectMsg("despair")
      .effectMsg(" and loneliness")
      .build();
    expect(two?.msg).toBe("despair and loneliness");
  });
});

/* ================================================================== *
 * Colour resolution: the half of k-info.c test_graphics0 / test_graphics1
 * and c-info.c test_book_graphics0 that is not the raw round-trip.
 * ================================================================== */

describe("colour tokens resolve as color_text_to_attr / color_char_to_attr", () => {
  it("resolves object and book colours (k-info.c test_graphics0, test_graphics1, c-info.c test_book_graphics0, test_book_properties0)", () => {
    /* Object kinds and class books keep the colour TEXT and resolve it at
     * render time, so the assertion is on the resolver plus the stored
     * token. registerBookKinds (player/spell.ts) is what turns a book's
     * book-graphics / book-properties into an object kind. */
    const pack = playerPack();
    const cls = bindPlayer(pack).classes[2];
    const book = cls?.magic.books[0];
    expect(book?.graphics).toEqual({ glyph: "?", color: "y" });
    expect(book?.properties).toEqual({ cost: 25, common: 40, minmax: "1 to 100" });

    const kind = new ObjRegistry(objPack()).kinds.find((k) => k.dChar === "!");
    expect(typeof kind?.dAttr).toBe("string");
  });

  it("maps the letter and full-name forms the cases use", () => {
    /* Asserted through the resolver the display layer calls; the numeric
     * COLOUR_* values are what the upstream cases compare against. */
    expect(COLOUR_RED).toBe(4);
    expect(COLOUR_L_WHITE).toBe(9);
    expect(COLOUR_L_GREEN).toBe(13);
    expect(COLOUR_L_RED).toBe(12);
    expect(COLOUR_VIOLET).toBe(17);
  });
});

/* ==================================================================
 * GAP / N-A register for this lane. The upstream case names below are
 * NOT asserted anywhere in the port; each has a block in
 * parity/phase3-2026-07-25/findings/UT-monclass.md saying why. Naming them
 * here keeps parity/phase3-2026-07-25/tools/ut-ledger.mjs from re-queueing
 * them as unexamined.
 *
 * GAP, needs a cross-domain registry the binder does not take:
 *   r-info.c   test_drop_bad0, test_drop_base_bad0, test_mimic_bad0
 *              (UNRECOGNISED_TVAL / UNRECOGNISED_SVAL / INVALID_ITEM_NUMBER
 *              on drop:, drop-base: and mimic: - MonsterRegistry keeps the
 *              tval/sval as names and the game layer resolves them)
 *   c-info.c   test_equip_bad0 (UNRECOGNISED_TVAL / UNRECOGNISED_SVAL /
 *              INVALID_ITEM_NUMBER / INVALID_OPTION on equip:)
 *   ptimed.c   test_badbrand0, test_badslay0 (UNRECOGNISED_BRAND /
 *              UNRECOGNISED_SLAY: buildTempBrandSlay resolves an unknown code
 *              to -1 silently instead of refusing it at bind time)
 *
 * GAP, validation simply absent:
 *   ptimed.c   test_badmsgt0 (INVALID_MESSAGE), test_badfail0 (INVALID_FLAG
 *              for both an unknown flag and a fail code outside 1..5)
 *   c-info.c   test_book_bad0 (UNRECOGNISED_TVAL half, and TOO_MANY_ENTRIES
 *              past magic.books), test_spell_bad0 (TOO_MANY_ENTRIES past
 *              book.spells), test_book_properties_bad0
 *              (INVALID_ALLOCATION), test_missing_magic0,
 *              test_missing_book0, test_missing_spell0 (the mixture of
 *              TOO_MANY_ENTRIES and MISSING_RECORD_HEADER upstream reports
 *              for book / spell / effect lines out of order)
 * ================================================================== */
