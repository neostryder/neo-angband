import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag.js";
import { ELEM, OF, STAT, TV } from "../generated/index.js";
import { Rng } from "../rng.js";
import { RF_SIZE } from "../mon/types.js";
import type { MonsterRace } from "../mon/types.js";
import { bindPlayer } from "../player/bind.js";
import { blankPlayer } from "../player/player.js";
import type { Player } from "../player/player.js";
import { ObjRegistry } from "./bind.js";
import type { ObjPackJson } from "./types.js";
import { objectNew, sameMonstersSlain } from "./object.js";
import type { GameObject } from "./object.js";
import { ELEM_HIGH_MAX, OBJ_PROPERTY, OFID, OFT } from "./types.js";
import type { ObjectProperty } from "./types.js";
import {
  buildRuneList,
  equipLearnAfterTime,
  equipLearnElement,
  equipLearnFlag,
  equipLearnOnDefend,
  equipLearnOnMeleeAttack,
  equipLearnOnRangedAttack,
  makeRuneEnv,
  missileLearnOnRangedAttack,
  OBJ_NOTICE,
  objectHasRune,
  objBaseName,
  objectLearnOnWield,
  objectLearnUnknownRune,
  objectRunesKnown,
  playerKnowsBrand,
  playerKnowsRune,
  playerKnowsSlay,
  playerLearnBrand,
  playerLearnInnate,
  playerLearnRune,
  playerLearnSlay,
} from "./knowledge.js";
import type { RuneEnv } from "./knowledge.js";
import {
  learnBrandSlayFromMelee,
  learnBrandSlayFromLaunch,
} from "../combat/brand-slay.js";
import { deserializePlayer, serializePlayer } from "../session/save.js";
import { ContentIdResolver } from "../mod/ids.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const reg = new ObjRegistry({
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
} as ObjPackJson);

const players = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
});

const rng = new Rng(7);

/** An object-only content-id resolver (enough for the rune round-trip). */
const ids = new ContentIdResolver({ objects: reg });

function makePlayerOf(raceName = "Human"): Player {
  const race = players.raceByName(raceName)!;
  const cls = players.classByName("Warrior")!;
  return blankPlayer(race, cls, players.bodies[race.body]!);
}

function kindOfTval(tval: number) {
  const k = reg.kinds.find(
    (kk) => kk.tval === tval && kk.kidx < reg.ordinaryKindCount,
  );
  if (!k) throw new Error(`no kind for tval ${tval}`);
  return k;
}

/** A test fixture: a player with equipment slots backed by a plain array. */
function fixture(raceName = "Human"): {
  p: Player;
  eq: (GameObject | null)[];
  env: RuneEnv;
  messages: string[];
} {
  const p = makePlayerOf(raceName);
  const eq: (GameObject | null)[] = new Array(p.body.count).fill(null);
  const messages: string[] = [];
  const env = makeRuneEnv(
    (slot) => eq[slot] ?? null,
    (v) => rng.randcalcVaries(v),
    {
      brands: reg.brands,
      slays: reg.slays,
      curses: reg.curses,
      properties: reg.properties,
      elementNames: ["acid", "lightning", "fire", "frost"],
      msg: (t) => messages.push(t),
    },
  );
  return { p, eq, env, messages };
}

/** The first OF flag whose property has the given identify type. */
function flagWithId(id: number): number {
  const prop = reg.properties.find(
    (pr) => pr && pr.type === OBJ_PROPERTY.FLAG && pr.idType === id,
  );
  if (!prop) throw new Error(`no flag with id-type ${id}`);
  return prop.propIndex;
}

describe("object_learn_on_wield (obj-knowledge.c L1820)", () => {
  it("learns obvious flags, sustains on stat items, and all modifiers", () => {
    const { p, env } = fixture();
    const obj = objectNew(kindOfTval(TV.RING));
    const wieldFlag = flagWithId(OFID.WIELD);
    obj.flags.on(wieldFlag);
    obj.flags.on(OF.SUST_STR);
    obj.modifiers[0] = 3; /* +3 STR promotes SUST_STR to obvious */

    objectLearnOnWield(p, obj, env);

    expect(p.objKnown.flags.has(wieldFlag)).toBe(true);
    expect(p.objKnown.flags.has(OF.SUST_STR)).toBe(true);
    expect(p.objKnown.modifiers[0]).toBe(1);
    expect(obj.notice & OBJ_NOTICE.WORN).toBe(OBJ_NOTICE.WORN);
  });

  it("does not learn timed-only flags on wield, and honors the WORN guard", () => {
    const { p, env } = fixture();
    const obj = objectNew(kindOfTval(TV.RING));
    const timedFlag = flagWithId(OFID.TIMED);
    obj.flags.on(timedFlag);

    objectLearnOnWield(p, obj, env);
    expect(p.objKnown.flags.has(timedFlag)).toBe(false);

    /* Second wield of a WORN object is a no-op (upstream guard). */
    obj.modifiers[1] = 2;
    objectLearnOnWield(p, obj, env);
    expect(p.objKnown.modifiers[1]).toBe(0);
  });
});

describe("combat rune learning (equip_learn_* / missile_learn_*)", () => {
  /*
   * In real play the three combat runes are known from birth
   * (do_cmd_accept_character, player-birth.c L1264-1267), so these learn-by-use
   * paths are vestigial. Each test zeroes the relevant rune first to exercise
   * the underlying rune machinery in isolation, exactly as it would fire if the
   * birth hack were ever removed (upstream: "Maybe make them not runes? NRM").
   */
  it("being hit teaches the to-armor rune from worn armor", () => {
    const { p, eq, env } = fixture();
    const armor = objectNew(kindOfTval(TV.SOFT_ARMOR));
    armor.toA = 2;
    const slot = p.body.slots.findIndex((s) => s.type === "BODY_ARMOR");
    eq[slot] = armor;

    p.objKnown.toA = 0;
    equipLearnOnDefend(p, env);
    expect(p.objKnown.toA).toBe(1);
  });

  it("attacking teaches to-hit and to-dam from an enchanted weapon", () => {
    const { p, eq, env } = fixture();
    const weapon = objectNew(kindOfTval(TV.SWORD));
    weapon.toH = 1;
    weapon.toD = 2;
    const slot = p.body.slots.findIndex((s) => s.type === "WEAPON");
    eq[slot] = weapon;

    p.objKnown.toH = 0;
    p.objKnown.toD = 0;
    equipLearnOnMeleeAttack(p, env);
    expect(p.objKnown.toH).toBe(1);
    expect(p.objKnown.toD).toBe(1);
  });

  it("a plain weapon teaches nothing", () => {
    const { p, eq, env } = fixture();
    const weapon = objectNew(kindOfTval(TV.SWORD));
    weapon.toH = 0;
    weapon.toD = 0;
    eq[p.body.slots.findIndex((s) => s.type === "WEAPON")] = weapon;

    p.objKnown.toH = 0;
    p.objKnown.toD = 0;
    equipLearnOnMeleeAttack(p, env);
    expect(p.objKnown.toH).toBe(0);
    expect(p.objKnown.toD).toBe(0);
  });

  it("firing an enchanted missile teaches the combat runes", () => {
    const { p, env } = fixture();
    const arrow = objectNew(kindOfTval(TV.ARROW));
    arrow.toH = 3;
    arrow.toD = 3;
    p.objKnown.toH = 0;
    p.objKnown.toD = 0;
    missileLearnOnRangedAttack(p, env, arrow);
    expect(p.objKnown.toH).toBe(1);
    expect(p.objKnown.toD).toBe(1);
  });

  it("all three combat runes are known at birth (upstream birth hack)", () => {
    const { p } = fixture();
    expect(p.objKnown.toA).toBe(1);
    expect(p.objKnown.toH).toBe(1);
    expect(p.objKnown.toD).toBe(1);
  });
});

describe("flag / element rune learning", () => {
  it("equip_learn_flag notices a flag only on equipment that has it", () => {
    const { p, eq, env } = fixture();
    const flag = OF.FEATHER;
    equipLearnFlag(p, env, flag);
    expect(p.objKnown.flags.has(flag)).toBe(false);

    const boots = objectNew(kindOfTval(TV.BOOTS));
    boots.flags.on(flag);
    eq[p.body.slots.findIndex((s) => s.type === "BOOTS")] = boots;
    equipLearnFlag(p, env, flag);
    expect(p.objKnown.flags.has(flag)).toBe(true);
  });

  it("equip_learn_element notices a resist on worn gear, with the glow", () => {
    const { p, eq, env, messages } = fixture();
    p.upkeep.playing = true;
    const shield = objectNew(kindOfTval(TV.SHIELD));
    shield.elInfo[ELEM.FIRE]!.resLevel = 1;
    eq[p.body.slots.findIndex((s) => s.type === "SHIELD")] = shield;

    equipLearnElement(p, env, ELEM.FIRE);
    expect(p.objKnown.elInfo[ELEM.FIRE]!.resLevel).toBe(1);
    expect(messages.some((m) => m.includes("glows"))).toBe(true);
  });

  it("equip_learn_after_time notices the timed flags", () => {
    const { p, eq, env } = fixture();
    const timedFlag = flagWithId(OFID.TIMED);
    const amulet = objectNew(kindOfTval(TV.AMULET));
    amulet.flags.on(timedFlag);
    eq[p.body.slots.findIndex((s) => s.type === "AMULET")] = amulet;

    equipLearnAfterTime(p, env);
    expect(p.objKnown.flags.has(timedFlag)).toBe(true);
  });
});

describe("brand / slay rune learning (obj-slays.c)", () => {
  const target = (opts: { resistFlag?: number; baseName?: string } = {}) => {
    const flags = new FlagSet(RF_SIZE);
    if (opts.resistFlag) flags.on(opts.resistFlag);
    return {
      race: {
        flags,
        base: { name: opts.baseName ?? "person" },
      } as unknown as MonsterRace,
      visible: true,
    };
  };

  it("learning one brand learns every brand sharing its name", () => {
    const { p, env } = fixture();
    /* Find two distinct brands with the same name (e.g. fire x2 / x3). */
    let a = -1;
    let b = -1;
    outer: for (let i = 1; i < reg.brands.length; i++) {
      for (let j = i + 1; j < reg.brands.length; j++) {
        if (reg.brands[i]?.name && reg.brands[i]?.name === reg.brands[j]?.name) {
          a = i;
          b = j;
          break outer;
        }
      }
    }
    expect(a).toBeGreaterThan(0);
    playerLearnBrand(p, env, a);
    expect(playerKnowsBrand(p, a)).toBe(true);
    expect(playerKnowsBrand(p, b)).toBe(true);
  });

  it("learning one slay learns every slay of the same monsters", () => {
    const { p, env } = fixture();
    let a = -1;
    let b = -1;
    outer: for (let i = 1; i < reg.slays.length; i++) {
      for (let j = i + 1; j < reg.slays.length; j++) {
        if (sameMonstersSlain(reg.slays, i, j)) {
          a = i;
          b = j;
          break outer;
        }
      }
    }
    expect(a).toBeGreaterThan(0);
    playerLearnSlay(p, env, a);
    expect(playerKnowsSlay(p, a)).toBe(true);
    expect(playerKnowsSlay(p, b)).toBe(true);
  });

  it("a melee hit teaches an unresisted weapon brand", () => {
    const { p, env } = fixture();
    const brandIdx = reg.brands.findIndex((br) => br && br.name === "fire");
    const weapon = objectNew(kindOfTval(TV.SWORD));
    weapon.brands = new Array(reg.brands.length).fill(false);
    weapon.brands[brandIdx] = true;

    learnBrandSlayFromMelee(p, env, weapon, target());
    expect(playerKnowsBrand(p, brandIdx)).toBe(true);
  });

  it("a resistant monster teaches nothing about the brand", () => {
    const { p, env } = fixture();
    const brandIdx = reg.brands.findIndex((br) => br && br.name === "fire");
    const resistFlag = reg.brands[brandIdx]!.resistFlag;
    const weapon = objectNew(kindOfTval(TV.SWORD));
    weapon.brands = new Array(reg.brands.length).fill(false);
    weapon.brands[brandIdx] = true;

    learnBrandSlayFromMelee(p, env, weapon, target({ resistFlag }));
    expect(playerKnowsBrand(p, brandIdx)).toBe(false);
  });

  it("a slay teaches only on affected, visible monsters", () => {
    const { p, env } = fixture();
    /* A race-flag slay (e.g. "orcs" via RF_ORC). */
    const slayIdx = reg.slays.findIndex((s) => s && s.raceFlag > 0);
    const raceFlag = reg.slays[slayIdx]!.raceFlag;
    const weapon = objectNew(kindOfTval(TV.SWORD));
    weapon.slays = new Array(reg.slays.length).fill(false);
    weapon.slays[slayIdx] = true;

    /* A monster without the flag: nothing learned. */
    learnBrandSlayFromMelee(p, env, weapon, target());
    expect(playerKnowsSlay(p, slayIdx)).toBe(false);

    /* An invisible affected monster: still nothing. */
    const affected = target({ resistFlag: raceFlag });
    learnBrandSlayFromMelee(p, env, weapon, { ...affected, visible: false });
    expect(playerKnowsSlay(p, slayIdx)).toBe(false);

    /* A visible affected monster: learned. */
    learnBrandSlayFromMelee(p, env, weapon, affected);
    expect(playerKnowsSlay(p, slayIdx)).toBe(true);
  });

  it("launch learning reads the missile and launcher, not worn gear", () => {
    const { p, eq, env } = fixture();
    const brandIdx = reg.brands.findIndex((br) => br && br.name === "cold");
    /* A branded ring: off-weapon gear must NOT teach on launch. */
    const ring = objectNew(kindOfTval(TV.RING));
    ring.brands = new Array(reg.brands.length).fill(false);
    ring.brands[brandIdx] = true;
    eq[p.body.slots.findIndex((s) => s.type === "RING")] = ring;

    const arrow = objectNew(kindOfTval(TV.ARROW));
    learnBrandSlayFromLaunch(p, env, arrow, null, target());
    expect(playerKnowsBrand(p, brandIdx)).toBe(false);

    /* The same brand on the missile itself teaches. */
    arrow.brands = new Array(reg.brands.length).fill(false);
    arrow.brands[brandIdx] = true;
    learnBrandSlayFromLaunch(p, env, arrow, null, target());
    expect(playerKnowsBrand(p, brandIdx)).toBe(true);
  });
});

describe("rune knowledge in the save format", () => {
  it("every learned rune variety round-trips through the save", () => {
    const { p, env } = fixture("High-Elf");
    playerLearnInnate(p, env);
    p.objKnown.toA = 1;
    p.objKnown.modifiers[0] = 1;
    playerLearnBrand(p, env, 1);
    playerLearnSlay(p, env, 1);
    p.objKnown.curses[2] = 1;

    const saved = JSON.parse(
      JSON.stringify(serializePlayer(p, ids)),
    ) as ReturnType<typeof serializePlayer>;
    const restored = deserializePlayer(saved, players, reg, ids, []);

    expect(restored.objKnown.toA).toBe(1);
    expect(restored.objKnown.modifiers).toEqual(p.objKnown.modifiers);
    expect(Array.from(restored.objKnown.flags.bits)).toEqual(
      Array.from(p.objKnown.flags.bits),
    );
    expect(restored.objKnown.elInfo).toEqual(p.objKnown.elInfo);
    /* The live arrays are sparse; compare through the accessors. */
    for (let i = 1; i < reg.brands.length; i++) {
      expect(playerKnowsBrand(restored, i)).toBe(playerKnowsBrand(p, i));
    }
    for (let i = 1; i < reg.slays.length; i++) {
      expect(playerKnowsSlay(restored, i)).toBe(playerKnowsSlay(p, i));
    }
    expect(restored.objKnown.curses[2]).toBe(1);
  });

  it("a legacy save (objKnownModifiers only) still loads", () => {
    const { p } = fixture();
    p.objKnown.modifiers[3] = 1;
    const saved = serializePlayer(p, ids) as unknown as Record<string, unknown>;
    saved.objKnownModifiers = [...p.objKnown.modifiers];
    delete saved.objKnown;
    const restored = deserializePlayer(
      saved as unknown as Parameters<typeof deserializePlayer>[0],
      players,
      reg,
      ids,
      [],
    );
    expect(restored.objKnown.modifiers[3]).toBe(1);
    /* A legacy save predating combat-rune serialization loads to the upstream
     * birth default: combat runes known (do_cmd_accept_character L1264-1267). */
    expect(restored.objKnown.toA).toBe(1);
  });
});

describe("player_learn_innate (player-birth.c L1274)", () => {
  it("a High-Elf is born knowing its racial resist and flag runes", () => {
    const { p, env } = fixture("High-Elf");
    playerLearnInnate(p, env);
    /* p_race.txt High-Elf: values LIGHT resist, flags SEE_INVIS. */
    expect(p.objKnown.elInfo[ELEM.LIGHT]!.resLevel).toBe(1);
    expect(p.objKnown.flags.has(OF.SEE_INVIS)).toBe(true);
  });

  it("a Human is born knowing nothing", () => {
    const { p, env } = fixture("Human");
    playerLearnInnate(p, env);
    expect(p.objKnown.flags.bits.every((b) => b === 0)).toBe(true);
    for (let i = 0; i < ELEM_HIGH_MAX; i++) {
      expect(p.objKnown.elInfo[i]!.resLevel).toBe(0);
    }
  });
});

describe("the rune list (init_rune) and per-object enumeration", () => {
  it("builds in upstream order and dedups brand/slay names", () => {
    const { env } = fixture();
    const runes = buildRuneList(env);
    /* Combat first (the three c_rune names), then the modifiers. */
    expect(runes[0]).toEqual({
      variety: "combat",
      index: 0,
      name: "enchantment to armor",
    });
    expect(runes[1]!.name).toBe("enchantment to hit");
    expect(runes[2]!.name).toBe("enchantment to damage");
    expect(runes[3]!.variety).toBe("mod");
    /* One brand rune per NAME even though brands share names (of Flame
     * egos carry fire x2 and fire x3). */
    const fireBrands = runes.filter(
      (r) => r.variety === "brand" && r.name === "fire",
    );
    expect(fireBrands.length).toBe(1);
    /* Identifiable flags only: no throwing/digging/light subtypes. */
    for (const r of runes) {
      if (r.variety !== "flag") continue;
      const prop = reg.properties.find(
        (pr) =>
          pr && pr.type === OBJ_PROPERTY.FLAG && pr.propIndex === r.index,
      )!;
      expect([prop.subtype]).not.toContain(OFT.THROW);
    }
  });

  it("objectHasRune / playerKnowsRune track an enchanted weapon", () => {
    const { p, env } = fixture();
    const runes = buildRuneList(env);
    /* Combat runes are known from birth (do_cmd_accept_character); zero them to
     * exercise the rune-enumeration machinery on a genuinely unknown rune. */
    p.objKnown.toA = 0;
    p.objKnown.toH = 0;
    p.objKnown.toD = 0;
    const obj = objectNew(kindOfTval(TV.SWORD));
    obj.toD = 5;
    obj.toH = 3; /* nonstandard to-hit: a second combat rune */
    const toD = runes.find(
      (r) => r.variety === "combat" && r.index === 2,
    )!;
    expect(objectHasRune(env, obj, toD)).toBe(true);
    expect(playerKnowsRune(p, toD)).toBe(false);
    expect(objectRunesKnown(p, env, obj, runes)).toBe(false);
    playerLearnRune(p, env, toD, false);
    expect(playerKnowsRune(p, toD)).toBe(true);
    /* The sword also has a nonstandard to-hit rune until learned. */
    expect(objectRunesKnown(p, env, obj, runes)).toBe(false);
    playerLearnRune(
      p,
      env,
      runes.find((r) => r.variety === "combat" && r.index === 1)!,
      false,
    );
    expect(objectRunesKnown(p, env, obj, runes)).toBe(true);
  });

  it("objectLearnUnknownRune learns a random unknown rune with its message", () => {
    const { p, env, messages } = fixture();
    const runes = buildRuneList(env);
    /* Combat runes are known from birth (do_cmd_accept_character); zero them so
     * the to-damage rune below is genuinely unknown and learnable here. */
    p.objKnown.toA = 0;
    p.objKnown.toH = 0;
    p.objKnown.toD = 0;
    const obj = objectNew(kindOfTval(TV.SWORD));
    obj.toD = 5;
    /* Learn to-hit so only the to-damage rune remains. */
    playerLearnRune(
      p,
      env,
      runes.find((r) => r.variety === "combat" && r.index === 1)!,
      false,
    );
    expect(objectLearnUnknownRune(rng, p, env, obj, runes)).toBe(true);
    expect(p.objKnown.toD).toBe(1);
    expect(messages).toContain(
      "You have learned the rune of enchantment to damage.",
    );
    /* Nothing left: the object is assessed instead. */
    expect(objectLearnUnknownRune(rng, p, env, obj, runes)).toBe(false);
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(OBJ_NOTICE.ASSESSED);
  });
});

/**
 * flag_message (obj-properties.c:86-139).
 *
 * Pinned as a whole function rather than by its message text, because the census
 * that found the two missing "Bug:" lines cannot see the three things underneath
 * them: a substitution that was a paraphrase of the C's tag parser, and a
 * `p->upkeep->playing` gate the port had moved off two call sites onto all four.
 * A message the game does not send is exactly as invisible as one it sends wrong.
 */
describe("flag_message (obj-properties.c:86)", () => {
  /** The base name equip_learn_flag will use for the boots below. */
  const BOOTS = objectNew(kindOfTval(TV.BOOTS)).kind.name.replace(/[~&]/g, "").trim();

  function flagProp(flag: number, msg: string | undefined): ObjectProperty {
    return {
      type: OBJ_PROPERTY.FLAG,
      propIndex: flag,
      ...(msg === undefined ? {} : { msg }),
    } as unknown as ObjectProperty;
  }

  /**
   * Equip boots carrying `flag`, then let equip_learn_flag notice it, against an
   * env whose ONLY property records are the ones given - so a MISSING record is
   * testable, which the real registry cannot be.
   */
  function notice(
    flag: number,
    msg: string | undefined,
    props?: readonly (ObjectProperty | null)[],
  ): string[] {
    const p = makePlayerOf("Human");
    const eq: (GameObject | null)[] = new Array(p.body.count).fill(null);
    const messages: string[] = [];
    const env = makeRuneEnv((slot) => eq[slot] ?? null, (v) => rng.randcalcVaries(v), {
      properties: props ?? [flagProp(flag, msg)],
      msg: (t) => messages.push(t),
    });
    const boots = objectNew(kindOfTval(TV.BOOTS));
    boots.flags.on(flag);
    eq[p.body.slots.findIndex((s) => s.type === "BOOTS")] = boots;
    equipLearnFlag(p, env, flag);
    return messages;
  }

  it("substitutes the object's base name for {name}", () => {
    expect(notice(OF.FEATHER, "Your {name} slows your fall.")).toEqual([
      `Your ${BOOTS} slows your fall.`,
    ]);
  });

  it("drops a well-formed tag that is not {name} (L121-127)", () => {
    /* The C only ever appends for a "name" tag; every other valid tag is consumed
     * and contributes nothing. A {name}-only replace would leave it in place. */
    expect(notice(OF.FEATHER, "Your {name} glows {somehow}.")).toEqual([
      `Your ${BOOTS} glows .`,
    ]);
  });

  it("drops an unclosed brace and keeps the rest (L129-132)", () => {
    expect(notice(OF.FEATHER, "Your {name} hums {oddly.")).toEqual([
      `Your ${BOOTS} hums oddly.`,
    ]);
  });

  it('leaves %s alone: the C ends with msg("%s", buf) (L138)', () => {
    /* No shipped record contains %s, but a content mod's own msg: can, and the
     * port used to substitute the object name for it. */
    expect(notice(OF.FEATHER, "Your %s twitches.")).toEqual(["Your %s twitches."]);
  });

  it("matches {names} too, because the C compares only four characters (L125)", () => {
    expect(notice(OF.FEATHER, "Your {names} glow.")).toEqual([`Your ${BOOTS} glow.`]);
  });

  it("says nothing when the property carries no message (L108)", () => {
    expect(notice(OF.FEATHER, undefined)).toEqual([]);
  });

  it("reports a flag with no object_property entry rather than falling silent", () => {
    /* Reachable through a mod that removes or mistypes a record. */
    expect(notice(OF.FEATHER, "x", [])).toEqual([
      `Bug: flag 'FEATHER' (index ${OF.FEATHER}) noticed but has no entry in object_property.txt.`,
    ]);
  });

  it("distinguishes an out-of-range index from a missing entry (L98-105)", () => {
    expect(notice(OF.MAX, "x", [])).toEqual([
      `Bug: invalid flag index, ${OF.MAX}, passed to flag_message().`,
    ]);
  });

  /**
   * The gate, both ways round. The C has it at TWO of flag_message's four call
   * sites, and the port used to hold it inside the callee - which applied it to all
   * four and suppressed messages upstream sends. Each test below asserts the
   * PROPERTY message specifically, and each has a passing arm, so neither can go
   * green by never reaching the call at all.
   */
  describe("the p->upkeep->playing gate belongs to the call sites", () => {
    const NOTE = "Your {name} tingles.";

    /**
     * Wear boots carrying `flag`, run `act`, and collect the messages.
     *
     * A SYNTHETIC property record, because no shipped OFID_WIELD flag has a `msg:`
     * at all - upstream's own flag_message call at :1858 never fires for the data
     * it ships, so the real registry cannot tell a working gate from a broken one.
     * The record carries the id-type both call sites select on, so both reach
     * flag_message for the same flag and the only difference under test is the gate.
     */
    function wearing(
      playing: boolean,
      idType: number,
      act: (p: Player, env: RuneEnv, obj: GameObject) => void,
    ): string[] {
      const flag = OF.FEATHER;
      const p = makePlayerOf("Human");
      const eq: (GameObject | null)[] = new Array(p.body.count).fill(null);
      const messages: string[] = [];
      const env = makeRuneEnv((slot) => eq[slot] ?? null, (v) => rng.randcalcVaries(v), {
        properties: [
          {
            type: OBJ_PROPERTY.FLAG,
            propIndex: flag,
            idType,
            msg: NOTE,
          } as unknown as ObjectProperty,
        ],
        msg: (t) => messages.push(t),
      });
      p.upkeep.playing = playing;
      const boots = objectNew(kindOfTval(TV.BOOTS));
      boots.flags.on(flag);
      eq[p.body.slots.findIndex((s) => s.type === "BOOTS")] = boots;
      act(p, env, boots);
      return messages;
    }

    /** Did the property's own message get sent? */
    const sent = (messages: string[]): boolean =>
      messages.some((m) => m.startsWith("Your") && m.endsWith("tingles."));

    it("equip_learn_flag messages even when not playing (obj-knowledge.c:2110)", () => {
      expect(sent(wearing(false, OFID.TIMED, (p, env) => equipLearnFlag(p, env, OF.FEATHER)))).toBe(
        true,
      );
      /* The passing arm, so a change that stopped reaching flag_message entirely
       * cannot make the assertion above vacuous. */
      expect(sent(wearing(true, OFID.TIMED, (p, env) => equipLearnFlag(p, env, OF.FEATHER)))).toBe(
        true,
      );
    });

    it("object_learn_on_wield stays silent when not playing (obj-knowledge.c:1857)", () => {
      expect(
        sent(wearing(false, OFID.WIELD, (p, env, obj) => objectLearnOnWield(p, obj, env))),
      ).toBe(false);
      expect(
        sent(wearing(true, OFID.WIELD, (p, env, obj) => objectLearnOnWield(p, obj, env))),
      ).toBe(true);
    });
  });
});

/**
 * PORT_TODO 3.23: every one of the six messages in this module must go through
 * `RuneEnv.describeBase` (object_desc ODESC_BASE), not the plain-name fallback.
 *
 * This test exists because the first pass at 3.23 wired the seam and proved it
 * was SUPPLIED, and a mutation that made `baseName` ignore it entirely killed
 * nothing. "The seam is present" and "the six call sites read it" are two
 * different claims, and only the second one is the item.
 */
describe("the six ODESC_BASE messages read env.describeBase (PORT_TODO 3.23)", () => {
  const SENTINEL = "<<described>>";

  function sentinelFixture(): ReturnType<typeof fixture> {
    const f = fixture();
    /* A sentinel rather than a real describe: the assertion is about the ROUTE.
     * A real name could coincide with the fallback and prove nothing. */
    (f.env as { describeBase?: (o: GameObject) => string }).describeBase = () =>
      SENTINEL;
    /* obj-knowledge.c:1857 gates every one of these messages on
     * p->upkeep->playing. With it false the fixture emits only the rune-learn
     * line and NONE of the named messages - which made the negative assertion
     * below pass without ever producing a name. */
    f.p.upkeep.playing = true;
    return f;
  }

  /* flagMessage returns early when the property has no `msg` (obj-knowledge.c
   * L97-107's silent arm), and expandPropertyTags only prints a name where the
   * template carries a {name} tag - so the flag has to be chosen for BOTH or the
   * message never carries a name and the assertion is vacuous. Measured: NO
   * WIELD-id flag in 4.2.6's object_property.txt has a msg at all. The flags
   * whose messages say "Your {name} glows." are the SUSTAINS, and
   * object_learn_on_wield reaches them the way upstream does - by adding
   * sustain_flag(i) to the obvious mask for each nonzero modifier (L1826-1828).
   * So the fixture needs a modifier, not just a flag. */
  it("object_learn_on_wield names the object through the seam", () => {
    const { p, env, messages } = sentinelFixture();
    const obj = objectNew(kindOfTval(TV.RING));
    obj.modifiers[STAT.STR] = 1;
    obj.flags.on(OF.SUST_STR);
    objectLearnOnWield(p, obj, env);
    expect(messages.length, "the wield produced a message").toBeGreaterThan(0);
    expect(messages.join(" | ")).toContain(SENTINEL);
  });

  it("equip_learn_flag names the object through the seam", () => {
    const { p, eq, env, messages } = sentinelFixture();
    const flag = flagWithId(OFID.TIMED);
    const obj = objectNew(kindOfTval(TV.RING));
    obj.flags.on(flag);
    eq[0] = obj;
    equipLearnFlag(p, env, flag);
    expect(messages.length, "the flag produced a message").toBeGreaterThan(0);
    expect(messages.join(" | ")).toContain(SENTINEL);
  });

  it("no message falls back to the plain kind name while the seam is wired", () => {
    /* The negative half: with the seam wired, objBaseName's output must not
     * appear. This is what a `return objBaseName(obj)` mutation trips. */
    const { p, eq, env, messages } = sentinelFixture();
    const flag = flagWithId(OFID.TIMED);
    const obj = objectNew(kindOfTval(TV.RING));
    obj.flags.on(flag);
    eq[0] = obj;
    equipLearnFlag(p, env, flag);
    const plain = objBaseName(obj);
    expect(plain.length, "fixture: the fallback produces a real name").toBeGreaterThan(0);
    expect(messages.join(" | "), "the fallback leaked").not.toContain(plain);
  });
});

/**
 * A source-level ratchet for the other five ODESC_BASE sites.
 *
 * Measured, honestly: mutating the shared `baseName` dispatcher kills three
 * behavioural tests, but reverting an INDIVIDUAL message site back to
 * `objBaseName(obj)` kills nothing for three of the six - those messages need a
 * curse record, a timed equip pass and an element property to fire, and driving
 * each one is a lot of fixture for a one-token regression. So the invariant is
 * checked where it is cheap and total instead: `objBaseName` must be referenced
 * exactly ONCE in the module, inside the dispatcher. Any message site that goes
 * back to the plain name adds a second reference and fails here.
 *
 * This is a structural guard, not a behavioural one, and it is written down as
 * such - it cannot tell whether the seam produces the right STRING, only that
 * nothing bypasses it.
 */
describe("no ODESC_BASE site bypasses the seam (PORT_TODO 3.23)", () => {
  const src = readFileSync(new URL("./knowledge.ts", import.meta.url), "utf8");

  it("objBaseName is used exactly once, in the baseName dispatcher", () => {
    /* Exclude doc comments and objBaseName's own declaration - neither is a use. */
    const uses = src
      .split(/\r?\n/)
      .filter(
        (l) =>
          /\bobjBaseName\s*\(/.test(l) &&
          !/^\s*\*/.test(l) &&
          !/^export function objBaseName/.test(l),
      );
    expect(uses, "one call site, the fallback in baseName()").toEqual([
      "  return env.describeBase?.(obj) ?? objBaseName(obj);",
    ]);
  });

  it("every message site names the object through baseName(env, obj)", () => {
    const sites = src
      .split(/\r?\n/)
      .filter((l) => /baseName\(env, obj\)|\boName\b/.test(l) && !/^\s*\*/.test(l));
    /* Six upstream ODESC_BASE calls in obj-knowledge.c; the port's `oName`
     * locals plus flagMessage's parameter and its one use. A change to the
     * count means a site was added or removed - read it, do not just bump it. */
    expect(sites.length, "the ODESC_BASE surface changed size").toBe(12);
  });
});

// ---------------------------------------------------------------------------
// The shape tails of the three equip_learn_on_* functions - PORT_TODO 3.24
// ---------------------------------------------------------------------------

/**
 * PORT_TODO 3.24 named `equip_learn_flag`, which in 4.2.6 has NO shape branch -
 * it walks the body slots and stops. The three functions that DO test
 * `p->shape` are equip_learn_on_defend (obj-knowledge.c:1991), _on_ranged_attack
 * (:2026) and _on_melee_attack (:2066), and all three were missing their tail
 * here; equipLearnOnDefend even carried a comment saying it could read the bound
 * shape. So a Druid in bear form, with a to-hit and to-damage of +15 each and
 * nothing enchanted worn, learned neither rune by fighting in it.
 *
 * Every case below uses a SHIPPED shape rather than a constructed one, so the
 * numbers are the game's: Pukel-man has to-h 0 and to-d 5, which is what makes
 * "the two are independent" a real claim, and warg has to-a 0, which is what
 * makes the `!== 0` guard one.
 */
describe("equip_learn_on_* shape tails (obj-knowledge.c:1991/2026/2066)", () => {
  const shape = (name: string) => {
    const s = players.shapes.find((x) => x.name === name);
    expect(s, `shipped shape ${name}`).toBeTruthy();
    return s!;
  };

  it("bear form's +5 to-armor teaches the to-armor rune with nothing worn", () => {
    const { p, env } = fixture();
    p.objKnown.toA = 0;
    p.shape = shape("bear"); // to-a 5
    equipLearnOnDefend(p, env);
    expect(p.objKnown.toA).toBe(1);
  });

  it("a shape with to-a 0 teaches nothing", () => {
    const { p, env } = fixture();
    p.objKnown.toA = 0;
    p.shape = shape("warg"); // to-h 5, to-d 5, to-a 0
    equipLearnOnDefend(p, env);
    expect(p.objKnown.toA).toBe(0);
  });

  it("no shape at all teaches nothing", () => {
    const { p, env } = fixture();
    p.objKnown.toA = 0;
    p.objKnown.toH = 0;
    p.objKnown.toD = 0;
    p.shape = null;
    equipLearnOnDefend(p, env);
    equipLearnOnMeleeAttack(p, env);
    equipLearnOnRangedAttack(p, env);
    expect([p.objKnown.toA, p.objKnown.toH, p.objKnown.toD]).toEqual([0, 0, 0]);
  });

  it("melee teaches to-hit and to-dam INDEPENDENTLY (Pukel-man is to-h 0, to-d 5)", () => {
    const { p, env } = fixture();
    p.objKnown.toH = 0;
    p.objKnown.toD = 0;
    p.shape = shape("Pukel-man");
    equipLearnOnMeleeAttack(p, env);
    expect(p.objKnown.toD).toBe(1);
    expect(p.objKnown.toH).toBe(0);
  });

  it("a NEGATIVE bonus is still a bonus to learn from (bat is to-d -10)", () => {
    const { p, env } = fixture();
    p.objKnown.toD = 0;
    p.shape = shape("bat");
    equipLearnOnMeleeAttack(p, env);
    expect(p.objKnown.toD).toBe(1);
  });

  it("firing reads the shape's to-hit and NOT its to-dam", () => {
    const { p, env } = fixture();
    p.objKnown.toH = 0;
    p.objKnown.toD = 0;
    p.shape = shape("bat"); // to-h 0, to-d -10
    equipLearnOnRangedAttack(p, env);
    expect(p.objKnown.toH).toBe(0);
    expect(p.objKnown.toD).toBe(0); // equip_learn_on_ranged_attack has no to_d arm

    p.shape = shape("eagle"); // to-h 5, to-d 0
    equipLearnOnRangedAttack(p, env);
    expect(p.objKnown.toH).toBe(1);
    expect(p.objKnown.toD).toBe(0);
  });

  it("the tail runs after the gear loop, so worn gear still teaches first", () => {
    /* Both routes set the same flag, so this cannot distinguish which one fired;
     * what it does prove is that adding the tail did not break the gear path,
     * which is the regression the change could plausibly cause. */
    const { p, eq, env } = fixture();
    const armor = objectNew(kindOfTval(TV.SOFT_ARMOR));
    armor.toA = 2;
    eq[p.body.slots.findIndex((s) => s.type === "BODY_ARMOR")] = armor;
    p.objKnown.toA = 0;
    p.shape = shape("warg"); // to-a 0: cannot be the one that taught it
    equipLearnOnDefend(p, env);
    expect(p.objKnown.toA).toBe(1);
  });
});
