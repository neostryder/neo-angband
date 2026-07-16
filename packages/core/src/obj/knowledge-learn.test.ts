import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag";
import { ELEM, OF, TV } from "../generated";
import { Rng } from "../rng";
import { RF_SIZE } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import { bindPlayer } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { ObjRegistry } from "./bind";
import type { ObjPackJson } from "./types";
import { objectNew, sameMonstersSlain } from "./object";
import type { GameObject } from "./object";
import { ELEM_HIGH_MAX, OBJ_PROPERTY, OFID, OFT } from "./types";
import {
  buildRuneList,
  equipLearnAfterTime,
  equipLearnElement,
  equipLearnFlag,
  equipLearnOnDefend,
  equipLearnOnMeleeAttack,
  makeRuneEnv,
  missileLearnOnRangedAttack,
  OBJ_NOTICE,
  objectHasRune,
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
} from "./knowledge";
import type { RuneEnv } from "./knowledge";
import {
  learnBrandSlayFromMelee,
  learnBrandSlayFromLaunch,
} from "../combat/brand-slay";
import { deserializePlayer, serializePlayer } from "../session/save";
import { ContentIdResolver } from "../mod/ids";

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
    const restored = deserializePlayer(saved, players, reg, ids);

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
