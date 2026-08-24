import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RF, RSF } from "../generated/index.js";
import { PROVENANCE_KEY } from "../mod/extension.js";
import { Rng } from "../rng.js";
import { bindMonsters } from "./bind.js";
import type {
  MonsterBaseRecordJson,
  MonsterPackRecords,
  MonsterRecordJson,
} from "./bind.js";

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

const reg = bindMonsters(loadPack());

describe("MonsterRegistry counts", () => {
  it("uses C truthiness for blow-method and summon boolean directives", () => {
    const pack = loadPack();
    const method = pack.blowMethods.find((r) => r.name === "HIT")!;
    Object.assign(method, { cut: 2, stun: 2, miss: 2, phys: 2 });
    pack.summons[0]!.uniques = 2;

    const bound = bindMonsters(pack);
    const hit = bound.blowMethods.get("HIT")!;
    expect(hit).toMatchObject({ cut: true, stun: true, miss: true, phys: true });
    expect(bound.summons[0]!.uniquesAllowed).toBe(true);
  });

  it("binds every pack record", () => {
    expect(reg.races.length).toBe(624);
    expect(reg.bases.size).toBe(56);
    expect(reg.spells.size).toBe(91);
    expect(reg.blowMethods.size).toBe(19);
    expect(reg.blowEffects.size).toBe(30);
    expect(reg.pains.size).toBe(12);
    expect(reg.summons.length).toBe(17);
    expect(reg.pits.length).toBe(40);
  });

  it("keeps monster.txt record order as ridx", () => {
    expect(reg.races[0]?.name).toBe("<player>");
    expect(reg.races[623]?.name).toBe("Morgoth, Lord of Darkness");
    for (let i = 0; i < reg.races.length; i++) {
      expect(reg.races[i]?.ridx).toBe(i);
    }
  });
});

describe("Morgoth spot check", () => {
  const morgoth = reg.raceByName("Morgoth, Lord of Darkness");

  it("binds the record exactly as monster.txt declares it", () => {
    expect(morgoth).not.toBeNull();
    if (!morgoth) return;
    expect(morgoth.flags.has(RF.UNIQUE)).toBe(true);
    expect(morgoth.flags.has(RF.QUESTOR)).toBe(true);
    expect(morgoth.flags.has(RF.FORCE_DEPTH)).toBe(true);
    expect(morgoth.level).toBe(100);
    expect(morgoth.avgHp).toBe(20000);
    expect(morgoth.speed).toBe(140);
    expect(morgoth.mexp).toBe(60000);
    expect(morgoth.rarity).toBe(1);
    expect(morgoth.ac).toBe(180);
    expect(morgoth.maxNum).toBe(1);
  });

  it("binds spell flags and frequency (spell-freq 3 -> 33)", () => {
    if (!morgoth) return;
    expect(morgoth.freqSpell).toBe(33);
    expect(morgoth.freqInnate).toBe(0);
    /* Default spell power is the level; Morgoth has no spell-power. */
    expect(morgoth.spellPower).toBe(100);
    for (const name of [
      "BRAIN_SMASH",
      "BA_MANA",
      "BA_NETH",
      "BO_MANA",
      "S_HI_DEMON",
      "S_UNIQUE",
    ] as const) {
      expect(morgoth.spellFlags.has(RSF[name])).toBe(true);
    }
    expect(morgoth.spellFlags.has(RSF.BR_FIRE)).toBe(false);
  });

  it("binds blows with method, effect, and dice", () => {
    if (!morgoth) return;
    expect(morgoth.blows.length).toBe(4);
    const first = morgoth.blows[0];
    expect(first?.method.name).toBe("HIT");
    expect(first?.effect.name).toBe("SHATTER");
    expect(first?.diceRaw).toBe("20d10");
    const last = morgoth.blows[3];
    expect(last?.method.name).toBe("TOUCH");
    expect(last?.effect.name).toBe("DRAIN_CHARGES");
    expect(last?.dice).toBeNull();
  });
});

describe("base inheritance (parse_monster_base semantics)", () => {
  it("kobold carries base kobold flags plus its own", () => {
    const kobold = reg.raceByName("kobold");
    expect(kobold).not.toBeNull();
    if (!kobold) return;
    /* Inherited from base kobold. */
    for (const name of [
      "EVIL",
      "OPEN_DOOR",
      "BASH_DOOR",
      "SPIRIT",
      "CLEAR_WEB",
      "IM_POIS",
    ] as const) {
      expect(kobold.flags.has(RF[name])).toBe(true);
    }
    /* Its own line. */
    expect(kobold.flags.has(RF.DROP_60)).toBe(true);
    /* Glyph comes from the base template. */
    expect(kobold.dChar).toBe("k");
    expect(kobold.base.name).toBe("kobold");
    expect(kobold.maxNum).toBe(100);
  });

  it("flags-off removes inherited base flags (green glutton ghost)", () => {
    const ghost = reg.raceByName("green glutton ghost");
    expect(ghost).not.toBeNull();
    if (!ghost) return;
    expect(ghost.base.flags.has(RF.IM_COLD)).toBe(true);
    expect(ghost.flags.has(RF.IM_COLD)).toBe(false);
    /* The rest of the base flags survive. */
    expect(ghost.flags.has(RF.PASS_WALL)).toBe(true);
    expect(ghost.flags.has(RF.UNDEAD)).toBe(true);
  });

  it("hearing scales by max_sight / 20 (identity at the default)", () => {
    const kobold = reg.raceByName("kobold");
    expect(kobold?.hearing).toBe(20);
    expect(kobold?.smell).toBe(20);
  });
});

/*
 * The MSG_-name guard that message.c message_lookup_by_name puts in front of
 * every `msgt:`/`msg:` parse handler, for the two handlers bound here:
 * mon-init.c parse_meth_message_type (upstream blowm.c test_msg0 /
 * test_msg_bad0, the latter uncited by the ut-ledger until now) and
 * mon-summon.c parse_summon_message_type.
 *
 * The summon half has NO upstream parse/ test file -- there is no
 * reference/src/tests/parse/summon.c and the ledger lists no summon cases --
 * so its handler is transcribed straight from mon-summon.c:73-86 instead.
 * The two handlers differ only in the `parser_hasval` guard (below); the
 * lookup and the PARSE_ERROR_INVALID_MESSAGE return are identical.
 *
 * Method as in ../parse-objterrain.upstream.test.ts: plant exactly the token
 * upstream plants into a fresh copy of the real committed pack, and require
 * the binder to refuse it. loadPack() re-reads from disk, so each call is a
 * fresh copy and mutation cannot leak between cases.
 */
describe("msg:/msgt: must name a MSG_ type (message.c message_lookup_by_name)", () => {
  /* Plant `msg:<v>` on blow method HIT; undefined means no msg: line at all. */
  function methMsgt(v: string | undefined): string {
    const pack = loadPack();
    const hit = pack.blowMethods.find((r) => r.name === "HIT");
    expect(hit).not.toBeUndefined();
    if (v === undefined) delete hit!.msg;
    else hit!.msg = v;
    return bindMonsters(pack).blowMethods.get("HIT")!.msgt;
  }

  /* The same on summon ANY. */
  function summonMsgt(v: string | undefined): string {
    const pack = loadPack();
    const any = pack.summons.find((r) => r.name === "ANY");
    expect(any).not.toBeUndefined();
    if (v === undefined) delete any!.msgt;
    else any!.msgt = v;
    return bindMonsters(pack).summons.find((s) => s.name === "ANY")!.msgt;
  }

  it("the unmutated pack binds, msgt carried verbatim (control)", () => {
    expect(reg.blowMethods.get("HIT")!.msgt).toBe("MON_HIT");
    expect(reg.summons.find((s) => s.name === "ANY")!.msgt).toBe("SUM_MONSTER");
  });

  it("blowm.c test_msg0: msg:MON_HIT resolves", () => {
    expect(methMsgt("MON_HIT")).toBe("MON_HIT");
  });

  it("blowm.c test_msg_bad0: msg:XYZZY is PARSE_ERROR_INVALID_MESSAGE", () => {
    /* mon-init.c:164-167: message_lookup_by_name < 0 -> INVALID_MESSAGE. */
    expect(() => methMsgt("XYZZY")).toThrow(/invalid msgt XYZZY/);
  });

  it("mon-summon.c parse_summon_message_type: msgt:XYZZY is INVALID_MESSAGE", () => {
    /* mon-summon.c:79-82, the same two lines. */
    expect(() => summonMsgt("XYZZY")).toThrow(/invalid msgt XYZZY/);
  });

  it("summon msgt: accepts any real MSG_ name", () => {
    expect(summonMsgt("SUM_HI_UNDEAD")).toBe("SUM_HI_UNDEAD");
  });

  it("a bare msg: is not an error (blowm.c line 55: msgt stays 0)", () => {
    /* parse_meth_message_type validates only under
     * `parser_hasval(p, "msg")`, and `msg` is registered `?str`
     * (mon-init.c:206), so a value-less msg: leaves meth->msgt at the
     * mem_zalloc 0 == MSG_GENERIC. The content parser omits the key for
     * an unfilled optional str, which is the same state. */
    expect(methMsgt(undefined)).toBe("GENERIC");
  });

  it("a summon with no msgt: line defaults to GENERIC", () => {
    /* mem_zalloc in parse_summon_name; unlike the blow method there is no
     * hasval guard, because `msgt sym type` is mandatory once present. */
    expect(summonMsgt(undefined)).toBe("GENERIC");
  });

  it("accepts the decimal-index and case-folded forms message.c accepts", () => {
    /* message.c:303-310: the numeric path runs first and wins for anything
     * strtoul consumes; the name search is my_stricmp, so case-insensitive.
     * MSG_MON_HIT is 44 in list-message.h. */
    expect(methMsgt("44")).toBe("44");
    expect(methMsgt(" 44 ")).toBe(" 44 ");
    expect(methMsgt("mon_hit")).toBe("mon_hit");
    expect(summonMsgt("Sum_Monster")).toBe("Sum_Monster");
  });

  it('accepts "MAX" by name, as upstream does', () => {
    /* Upstream wart, kept: message_names[] is built from list-message.h
     * including MSG(MAX, NULL), so message_lookup_by_name("MAX") returns
     * MSG_MAX (tests/message/message.c:517) -- not negative, so the guard
     * lets it through even though it is out of range as an index. The
     * decimal 153 for the same value IS rejected (number < MSG_MAX). */
    expect(methMsgt("MAX")).toBe("MAX");
    expect(() => methMsgt("153")).toThrow(/invalid msgt 153/);
  });

  it("rejects the failed lookups message.c pins", () => {
    /* tests/message/message.c:529-542 -- each of these is -1 there. A
     * value-less msg: cannot reach the binder as "" through the shipped
     * parser, but a mod handing records straight to bindMonsters can. */
    expect(() => methMsgt("")).toThrow(/invalid msgt/);
    expect(() => methMsgt("kskl8bktk2b")).toThrow(/invalid msgt kskl8bktk2b/);
    expect(() => methMsgt("-3")).toThrow(/invalid msgt -3/);
    expect(() => methMsgt("154")).toThrow(/invalid msgt 154/);
    expect(() => summonMsgt("kskl8bktk2b")).toThrow(/invalid msgt/);
  });
});

describe("blow binding", () => {
  it("Grip binds BITE / HURT / 1d4", () => {
    const grip = reg.raceByName("Grip, Farmer Maggot's Dog");
    expect(grip).not.toBeNull();
    if (!grip) return;
    expect(grip.blows.length).toBe(1);
    const blow = grip.blows[0];
    expect(blow?.method.name).toBe("BITE");
    expect(blow?.method.cut).toBe(true);
    expect(blow?.effect.name).toBe("HURT");
    expect(blow?.effect.power).toBe(40);
    expect(blow?.diceRaw).toBe("1d4");
    const rng = new Rng(12345);
    for (let i = 0; i < 50; i++) {
      const dmg = blow?.dice?.roll(rng) ?? -1;
      expect(dmg).toBeGreaterThanOrEqual(1);
      expect(dmg).toBeLessThanOrEqual(4);
    }
  });

  it("methods without an effect bind to NONE (urchin BEG)", () => {
    const urchin = reg.raceByName("filthy street urchin");
    const beg = urchin?.blows.find((b) => b.method.name === "BEG");
    expect(beg).toBeDefined();
    expect(beg?.effect.name).toBe("NONE");
    expect(beg?.dice).toBeNull();
  });
});

describe("spell binding", () => {
  it("crow of Durthang: spell-power overrides the level default", () => {
    const crow = reg.raceByName("crow of Durthang");
    expect(crow).not.toBeNull();
    if (!crow) return;
    expect(crow.level).toBe(7);
    expect(crow.spellPower).toBe(4);
    /* spell-freq 9 -> 100 / 9 = 11. */
    expect(crow.freqSpell).toBe(11);
    expect(crow.spellFlags.has(RSF.WOUND)).toBe(true);
    const seen = crow.spellMsgs.find(
      (m) => m.index === RSF.WOUND && m.msgType === "seen",
    );
    expect(seen?.message).toBe("{name} caws three times.");
  });

  it("monster_spell records carry hit, effects, and lore levels", () => {
    const shriek = reg.spells.get(RSF.SHRIEK);
    expect(shriek?.hit).toBe(100);
    expect(shriek?.effects[0]?.eff).toBe("WAKE");
    expect(shriek?.levels[0]?.power).toBe(0);
    expect(shriek?.levels[0]?.loreDesc).toBe("shriek for help");

    /* power-cutoff appends spell levels (SHOT gains one at power 25). */
    const shot = reg.spells.get(RSF.SHOT);
    expect(shot?.levels.length).toBeGreaterThanOrEqual(2);
    expect(shot?.levels[1]?.power).toBe(25);
    expect(shot?.levels[1]?.loreDesc).toBe("sling lead shots");
    /* Effect dice with a bound SPELL_POWER expression parse. */
    expect(shot?.effects[0]?.diceRaw).toBe("$Dd5");
    expect(shot?.effects[0]?.exprs[0]?.base).toBe("SPELL_POWER");
  });
});

describe("friends and shapes resolution (finish_parse_monster)", () => {
  it("resolves 'Same' to the race itself and names to races", () => {
    const urchin = reg.raceByName("filthy street urchin");
    expect(urchin).not.toBeNull();
    if (!urchin) return;
    const same = urchin.friends.find((f) => f.name === "Same");
    expect(same?.race).toBe(urchin);
    expect(same?.numberDice).toBe(3);
    expect(same?.numberSide).toBe(4);
    /* Lookup is case-insensitive: the record says "Scrawny cat". */
    const cat = urchin.friends.find((f) => f.name === "Scrawny cat");
    expect(cat?.race?.name).toBe("scrawny cat");
  });

  it("resolves friends-base to monster bases", () => {
    const soldier = reg.raceByName("soldier");
    expect(soldier?.friendsBase[0]?.base.name).toBe("person");
  });

  it("resolves shapes to races (Beorn)", () => {
    const beorn = reg.raceByName("Beorn, the Shape-Changer");
    expect(beorn?.shapes[0]?.race?.name).toBe("Beorn, the Mountain Bear");
  });
});

describe("moddability: extra records bind cleanly", () => {
  it("a mod-added base and race join the registry", () => {
    const pack = loadPack();
    const modBase: MonsterBaseRecordJson = {
      name: "clockwork",
      glyph: "g",
      pain: 2,
      flags: ["METAL | NONLIVING | EMPTY_MIND", "IM_ELEC"],
      desc: ["Clockwork automaton"],
    };
    const modRace: MonsterRecordJson = {
      name: "brass sentinel",
      base: "clockwork",
      color: "u",
      speed: 110,
      "hit-points": 40,
      hearing: 20,
      "armor-class": 50,
      sleepiness: 10,
      depth: 12,
      rarity: 2,
      experience: 40,
      blow: [{ method: "HIT", effect: "HURT", damage: "2d6" }],
      flags: ["BASH_DOOR"],
      spells: ["BO_ELEC"],
      desc: ["A ticking guardian of brass and cog."],
    };
    const modded = bindMonsters({
      ...pack,
      monsterBases: [...pack.monsterBases, modBase],
      monsters: [...pack.monsters, modRace],
    });

    expect(modded.races.length).toBe(625);
    expect(modded.bases.size).toBe(57);
    const race = modded.raceByName("brass sentinel");
    expect(race).not.toBeNull();
    if (!race) return;
    expect(race.ridx).toBe(624);
    /* Base inheritance applies to modded records identically. */
    expect(race.flags.has(RF.METAL)).toBe(true);
    expect(race.flags.has(RF.IM_ELEC)).toBe(true);
    expect(race.flags.has(RF.BASH_DOOR)).toBe(true);
    expect(race.dChar).toBe("g");
    expect(race.base.pain.painIdx).toBe(2);
    /* The parse_monster_spells frequency default kicks in (no
     * spell-freq given, BO_ELEC is neither breath nor innate). */
    expect(race.freqSpell).toBe(4);
    expect(race.freqInnate).toBe(0);
    expect(race.spellPower).toBe(12);
  });

  it("refuses a later mod race whose name collides", () => {
    const pack = loadPack();
    const kobold = pack.monsters.find((r) => r.name === "kobold");
    if (!kobold) throw new Error("fixture: missing kobold");
    const koboldRidx = pack.monsters.indexOf(kobold);
    const duplicateKobold = {
      ...kobold,
      name: "KOBOLD",
      [PROVENANCE_KEY]: { owner: "duplicate-pack" },
    } as MonsterRecordJson;

    const modded = bindMonsters({
      ...pack,
      monsters: [...pack.monsters, duplicateKobold],
    });

    expect(modded.races).toHaveLength(pack.monsters.length);
    expect(modded.raceByName("kobold")?.ridx).toBe(koboldRidx);
    expect(modded.refused).toEqual([
      expect.objectContaining({
        file: "monster",
        record: "KOBOLD",
        field: "name",
        id: "duplicate-pack",
        why: expect.stringContaining("duplicate name KOBOLD"),
      }),
    ]);
  });
});
