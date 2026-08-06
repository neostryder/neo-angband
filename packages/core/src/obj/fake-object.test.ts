/**
 * PORT_TODO 3.3: the two knowledge recalls that used to print a name and the
 * record's blurb where upstream prints computed lines - desc_obj_fake's
 * object_info(OINFO_FAKE) body (ui-knowledge.c L1938) and desc_ego_fake's
 * object_info_ego (obj-info.c L2402), plus describe_ego (L2281), which had
 * never been ported because the only mode bit that reaches it is the one only
 * object_info_ego sets.
 *
 * Expectations are DERIVED from the shipped data (the record's own flags and
 * modifiers) rather than declared, so a change to ego_item.txt moves the test
 * with it instead of silently disagreeing.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { KF, OF, TV } from "../generated/index.js";
import { startGame } from "../session/game.js";
import type { GamePack } from "../session/game.js";
import { makeObjectInfoDeps, type ObjectInfoExtras } from "../game/object-inspect.js";
import { OINFO, objectInfo, textblockToString } from "./object-info.js";
import { OBJ_NOTICE, playerLearnAllRunes } from "./knowledge.js";
import { makeFakeKind, objectInfoEgo } from "./fake-object.js";
import { blankObjKnowledge } from "../player/player.js";
import type { Player } from "../player/player.js";
import type { EgoItem } from "./types.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
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
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
};

const { state, booted } = startGame(pack, { seed: 123, depth: 1 });
const reg = booted.registries.objects;
const constants = booted.registries.constants;
playerLearnAllRunes(state.actor.player, state.runeEnv);
state.isAware = () => true;

const extras: ObjectInfoExtras = {
  projections: booted.registries.projections ?? [],
  constants,
};

/**
 * Fixtures are FOUND by the property under test rather than named, so a data
 * change moves the test instead of leaving it asserting about the wrong
 * record - "of Elvenkind" alone means three different egos across three tvals,
 * and only two of them carry RAND_HI_RES.
 */
function egoWithKindFlag(flag: number): EgoItem {
  const e = reg.egos.find((x) => x.kindFlags.has(flag));
  if (!e) throw new Error(`no shipped ego carries kind flag ${flag}`);
  return e;
}

/** The ego record by name; several names repeat across tvals, so index too. */
function ego(name: string, nth = 0): EgoItem {
  const hits = reg.egos.filter((e) => e.name === name);
  const e = hits[nth];
  if (!e) throw new Error(`no ego "${name}" (#${nth}) in the shipped pack`);
  return e;
}

function egoText(e: EgoItem): string {
  return textblockToString(
    objectInfoEgo(reg, e, (obj) => makeObjectInfoDeps(state, obj, extras)),
  );
}

describe("makeFakeKind (desc_obj_fake's object_prep, ui-knowledge.c L1946)", () => {
  it("preps on EXTREMIFY - the end with the larger absolute value, not the max", () => {
    /* Derived, and chosen so the assertion can DISCRIMINATE: pick a kind whose
     * modifiers actually differ under extremify and maximise (a negative
     * range), or the test would pass against either aspect. */
    const probe = new Rng(1);
    const differs = (k: (typeof reg.kinds)[number]): boolean =>
      k.modifiers.some(
        (m) =>
          probe.randcalc(m, 0, "extremify") !== probe.randcalc(m, 0, "maximise"),
      );
    const kind = reg.kinds.find((k) => k.name.length > 0 && differs(k));
    expect(kind, "no kind in the pack distinguishes extremify from maximise").toBeTruthy();

    const rng = new Rng(1);
    const expected = kind!.modifiers.map((m) => rng.randcalc(m, 0, "extremify"));
    const maxed = kind!.modifiers.map((m) => rng.randcalc(m, 0, "maximise"));
    expect(expected).not.toEqual(maxed);

    const obj = makeFakeKind(reg, constants, kind!);
    expect(obj.modifiers).toEqual(expected);
    expect(obj.kind).toBe(kind);
  });

  it("does not touch the game RNG", () => {
    /* A browse must not perturb the stream, and copy_curses ALWAYS rolls the
     * curse timeout on RANDOMISE whatever aspect the caller asked for
     * (obj-curse.c L67) - so "EXTREMIFY draws nothing" is not enough on its
     * own. Compare the game stream's next draw across the whole catalogue. */
    const snapshot = state.rng.getState();
    const expected = state.rng.randint0(1_000_000);
    state.rng.setState(snapshot);
    for (const kind of reg.kinds) makeFakeKind(reg, constants, kind);
    expect(state.rng.randint0(1_000_000)).toBe(expected);
  });

  it("is stable across browses (the fixed seed)", () => {
    const kind = reg.kinds.find((k) => k.name.includes("Digging"))!;
    const a = makeFakeKind(reg, constants, kind);
    const b = makeFakeKind(reg, constants, kind);
    expect(b.modifiers).toEqual(a.modifiers);
    expect(b.toA).toBe(a.toA);
  });
});

describe("describe_ego (obj-info.c L2281), reachable only through OINFO_EGO", () => {
  it("names the random pick for each of the four kind flags", () => {
    expect(egoText(egoWithKindFlag(KF.RAND_HI_RES))).toContain(
      "It provides one random higher resistance.",
    );
    expect(egoText(egoWithKindFlag(KF.RAND_SUSTAIN))).toContain(
      "It provides one random sustain.",
    );
    expect(egoText(egoWithKindFlag(KF.RAND_POWER))).toContain(
      "It provides one random ability.",
    );
    expect(egoText(egoWithKindFlag(KF.RAND_RES_POWER))).toContain(
      "It provides one random ability or base resistance.",
    );
  });

  it("says a light with NO_FUEL and TAKES_FUEL off burns forever", () => {
    const e = reg.egos.find(
      (x) => x.flags.has(OF.NO_FUEL) && x.flagsOff.has(OF.TAKES_FUEL),
    );
    expect(e, "no shipped ego turns TAKES_FUEL off while setting NO_FUEL").toBeTruthy();
    expect(egoText(e!)).toContain("It burns forever without fuel.");
  });

  it("needs BOTH halves of the fuel condition, not either", () => {
    /* The one shipped ego with NO_FUEL also turns TAKES_FUEL off, so the whole
     * catalogue cannot tell `&&` from `||`. Build the two halves separately:
     * an ego that merely turns TAKES_FUEL off (a light that never took fuel to
     * begin with) does not burn forever, and neither does one that sets
     * NO_FUEL without clearing TAKES_FUEL. */
    const donor = reg.egos.find(
      (x) => x.flags.has(OF.NO_FUEL) && x.flagsOff.has(OF.TAKES_FUEL),
    )!;
    const noFuelOff = donor.flags.clone();
    noFuelOff.off(OF.NO_FUEL);
    expect(egoText({ ...donor, flags: noFuelOff })).not.toContain("burns forever");

    const takesFuelOn = donor.flagsOff.clone();
    takesFuelOn.off(OF.TAKES_FUEL);
    expect(egoText({ ...donor, flagsOff: takesFuelOn })).not.toContain("burns forever");
  });

  it("stays silent for an ego carrying none of those flags", () => {
    /* The negative case, without which a describe_ego that printed every line
     * unconditionally would pass all of the above. */
    const plain = reg.egos.find(
      (x) =>
        x.firstPossItem >= 0 &&
        !x.kindFlags.has(KF.RAND_HI_RES) &&
        !x.kindFlags.has(KF.RAND_SUSTAIN) &&
        !x.kindFlags.has(KF.RAND_POWER) &&
        !x.kindFlags.has(KF.RAND_RES_POWER) &&
        !x.flags.has(OF.NO_FUEL),
    );
    expect(plain, "every shipped ego now carries a describe_ego flag").toBeTruthy();
    const text = egoText(plain!);
    expect(text).not.toContain("It provides one random");
    expect(text).not.toContain("burns forever");
  });

  it("takes only the FIRST matching arm - the chain is else-if", () => {
    /* Upstream's four random-pick lines are mutually exclusive. No shipped ego
     * carries two, so scanning the catalogue would be a guard that cannot
     * fire - BUILD the two-flag ego instead. RAND_HI_RES wins over
     * RAND_SUSTAIN because it is first in the chain (obj-info.c L2285), which
     * is NOT the order ego_apply_magic tests them in (obj-make.c L790). */
    const base = egoWithKindFlag(KF.RAND_SUSTAIN);
    const both = base.kindFlags.clone();
    both.on(KF.RAND_HI_RES);
    const text = egoText({ ...base, kindFlags: both });
    expect(text).toContain("It provides one random higher resistance.");
    expect(text).not.toContain("It provides one random sustain.");
    expect((text.match(/It provides one random/gu) ?? []).length).toBe(1);
  });
});

describe("object_info_ego (obj-info.c L2402)", () => {
  it("prints the ego's own modifiers and resists, derived from the record", () => {
    /* The body-armour "of Elvenkind": STEALTH plus four base resists. Both the
     * modifier line and the resist line are the ego's contribution, and both
     * come from paths (describe_stats / describe_elements) that the fully-known
     * twin is what unlocks - this is the test that fails if the twin is not
     * reproduced. */
    const e = reg.egos.find(
      (x) =>
        x.name === "of Elvenkind" &&
        x.elInfo.some((el) => el.resLevel > 0) &&
        x.modifiers.some((m) => m.dice > 0 || m.base !== 0),
    );
    expect(e, "no of Elvenkind with both a modifier and a resist").toBeTruthy();
    const text = egoText(e!);
    /* "Affects your stealth." - the EGO bit suppresses the exact magnitude
     * (describe_stats' suppress_details, obj-info.c L2076). */
    expect(text).toContain("Affects your stealth.");
    expect(text).not.toMatch(/\+\d+ stealth/u);
    expect(text).toMatch(/acid/iu);
  });

  it("prints the ego's flavour text once, from describe_flavor_text", () => {
    /* Only five shipped egos carry a desc line; find one rather than name it. */
    const e = reg.egos.find((x) => x.text.length > 0 && x.firstPossItem >= 0);
    expect(e, "no shipped ego carries a desc line any more").toBeTruthy();
    const text = egoText(e!);
    const firstWords = e!.text.split(/\s+/u).slice(0, 4).join(" ");
    expect(text).toContain(firstWords);
    expect(text.split(firstWords).length - 1, "printed twice").toBe(1);
  });

  it("suppresses the per-instance detail the EGO bit exists to hide", () => {
    /* OINFO_EGO skips describe_effect / describe_combat / describe_digger
     * entirely (obj-info.c L2363) because "abilities can vary". A weapon ego
     * therefore never prints blows-per-round or an average damage line. */
    const text = egoText(ego("(Holy Avenger)"));
    expect(text).not.toMatch(/blows per round/i);
    expect(text).not.toMatch(/average damage/i);
  });

  it("describes the ego on the HEAD of poss_items, not the first Set member", () => {
    /* of *Slay Undead* declares `type:sword|polearm` and then a run of hafted
     * `item:` lines. Upstream PREPENDS, so its poss_items head is the LAST
     * hafted item - and the base kind chosen decides the object's tval. */
    const e = ego("of *Slay Undead*");
    const head = reg.kinds[e.firstPossItem];
    expect(head, "the ego's head kind is missing").toBeTruthy();
    expect(head!.kidx).not.toBe([...e.possItems][0]);
    expect(head!.kidx).toBe([...e.possItems].pop());
  });

  it("closes the no-abilities line with TWO newlines, not three (L2381)", () => {
    /* An ego with nothing to say and no flavour paragraph produces the
     * fallback and NOTHING else, so the exact string is assertable. The port
     * used to emit a third newline here; no screen printed this line until
     * these two recalls started running, which is why it survived. */
    const NL = String.fromCharCode(10);
    const quiet = reg.egos.find(
      (e) =>
        e.firstPossItem >= 0 &&
        e.text.length === 0 &&
        egoText(e).includes("does not seem to possess"),
    );
    expect(quiet, "no shipped ego reaches the fallback with no flavour text").toBeTruthy();
    expect(egoText(quiet!)).toBe(
      `${NL}${NL}This item does not seem to possess any special abilities.`,
    );
  });

  it("is independent of the browsing player's rune knowledge", () => {
    /* object_copy(&known_obj, &obj) makes the twin a FULL copy (L2437), so an
     * ego page reads the same to a fresh character as to one who has learned
     * everything. This file's module-level player already knows every rune, so
     * without this test the "learn everything" step inside objectInfoEgo could
     * be deleted and nothing here would notice. */
    const fresh: Player = { ...state.actor.player, objKnown: blankObjKnowledge() };
    const e = egoWithKindFlag(KF.RAND_SUSTAIN);
    const knowing = egoText(e);
    const naive = textblockToString(
      objectInfoEgo(reg, e, (obj) =>
        makeObjectInfoDeps(
          { ...state, actor: { ...state.actor, player: fresh } },
          obj,
          extras,
        ),
      ),
    );
    expect(naive).toBe(knowing);
    /* Not vacuous: the page has real content to agree about. */
    expect(naive).toContain("It provides one random sustain.");
  });

  it("says so when an ego appears on no items", () => {
    const orphan: EgoItem = { ...ego("of Shadows"), firstPossItem: -1 };
    expect(egoText(orphan)).toBe("This ego does not appear on any items.");
  });

  it("says so when the head kidx dangles", () => {
    const broken: EgoItem = { ...ego("of Shadows"), firstPossItem: 999_999 };
    expect(egoText(broken)).toContain("Bug: the array of kinds of objects");
  });

  it("does not touch the game RNG (ego_apply_magic rolls on RANDOMISE)", () => {
    const snapshot = state.rng.getState();
    const expected = state.rng.randint0(1_000_000);
    state.rng.setState(snapshot);
    for (const e of reg.egos) egoText(e);
    expect(state.rng.randint0(1_000_000)).toBe(expected);
  });
});

describe("get_known_flags' two branches (obj-info.c L2217)", () => {
  it("drops the base kind's object flags under TERSE, and only under TERSE", () => {
    /* A guard that CAN fire: every shipped base carries zero object flags (its
     * `flags:` lines are all HATES_* element info and KF_* kind flags), so the
     * only way to exercise the diff is to put one there. FEATHER is a
     * describe_misc_magic line, so its presence is directly readable. */
    const kind = reg.kinds.find((k) => k.tval === TV["SOFT_ARMOR"] && k.name.length > 0);
    expect(kind, "no soft armour kind in the pack").toBeTruthy();
    const baseFlags = kind!.base.flags.clone();
    baseFlags.on(OF.FEATHER);
    const patchedBase = { ...kind!.base, flags: baseFlags };
    const patched = { ...kind!, base: patchedBase };

    const obj = makeFakeKind(reg, constants, patched);
    obj.flags.on(OF.FEATHER);
    obj.notice |= OBJ_NOTICE.ASSESSED;
    const deps = makeObjectInfoDeps(state, obj, extras);

    const normal = textblockToString(objectInfo(obj, OINFO.SUBJ, deps));
    const terse = textblockToString(objectInfo(obj, OINFO.TERSE | OINFO.SUBJ, deps));
    expect(normal).toContain("Feather Falling");
    expect(terse).not.toContain("Feather Falling");
  });
});
