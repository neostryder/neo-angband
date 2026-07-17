/**
 * Locks gaps 3.1 and 3.6, ported from reference/src/obj-slays.c (Angband
 * 4.2.6):
 * - 3.6: temporary brands/slays - improve_attack_modifier's obj == NULL path
 *   (obj-slays.c:378-381, 404-406, player_has_temporary_brand/slay
 *   obj-slays.c:287-317) and learn_brand_slay_helper's allow_temp branches
 *   (obj-slays.c:501-503, 558-560), which teach monster lore but never the
 *   rune itself (player_learn_* is guarded on `learn`).
 * - 3.1: learn_brand_slay_from_throw passes allow_off = FALSE
 *   (obj-slays.c:629-634): a throw must NOT learn brand/slay runes from worn
 *   off-weapon gear, while melee (obj-slays.c:596-600, allow_off = true) does.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag";
import { RF, TV } from "../generated";
import { Rng } from "../rng";
import { getLore } from "../mon/lore";
import type { LoreStore } from "../mon/lore";
import { bindMonsters } from "../mon/bind";
import type { MonsterPackRecords } from "../mon/bind";
import { RF_SIZE } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import {
  makeRuneEnv,
  playerKnowsBrand,
  playerKnowsSlay,
} from "../obj/knowledge";
import type { RuneEnv } from "../obj/knowledge";
import { bindPlayer } from "../player/bind";
import type { PlayerPackRecords } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import type { AttackModifier, BrandSlayLearnTarget, TempBrandSlay } from "./brand-slay";
import {
  improveAttackModifier,
  learnBrandSlayFromMelee,
  learnBrandSlayFromThrow,
} from "./brand-slay";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}
function packJson<T>(name: string): T[] {
  return (load(name) as { records: T[] }).records;
}

const monReg = bindMonsters({
  pain: packJson("pain"),
  blowMethods: packJson("blow_methods"),
  blowEffects: packJson("blow_effects"),
  monsterSpells: packJson("monster_spell"),
  monsterBases: packJson("monster_base"),
  monsters: packJson("monster"),
  summons: packJson("summon"),
  pits: packJson("pit"),
} as MonsterPackRecords);

const objReg = new ObjRegistry({
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
} as ObjPackJson);

const plReg = bindPlayer({
  races: packJson("p_race"),
  classes: packJson("class"),
  properties: packJson("player_property"),
  timed: packJson("player_timed"),
  shapes: packJson("shape"),
  bodies: packJson("body"),
  history: packJson("history"),
  realms: packJson("realm"),
} as PlayerPackRecords);

const realRace = monReg.races.find((r) => r.base) as MonsterRace;

/* Real data indices: the ACID_3 brand (player_timed ATT_ACID's temp brand)
 * and the EVIL_2 slay (ATT_EVIL's temp slay). */
const fireBrand = objReg.brands.findIndex((b) => b !== null && b.code === "FIRE_3");
const evilSlay = objReg.slays.findIndex((s) => s !== null && s.code === "EVIL_2");

function kindOfTval(tval: number): NonNullable<(typeof objReg.kinds)[number]> {
  const k = objReg.kinds.find((kk) => kk !== null && kk.tval === tval);
  if (!k) throw new Error(`no kind for tval ${tval}`);
  return k;
}

/** A player with equipment slots backed by a plain array, and its RuneEnv. */
function fixture(): { p: Player; eq: (GameObject | null)[]; env: RuneEnv } {
  const p = blankPlayer(
    plReg.races[0] as (typeof plReg.races)[number],
    plReg.classes[0] as (typeof plReg.classes)[number],
    plReg.bodies[0] as (typeof plReg.bodies)[number],
  );
  const eq: (GameObject | null)[] = new Array<GameObject | null>(
    p.body.count,
  ).fill(null);
  const rng = new Rng(7);
  const env = makeRuneEnv(
    (slot) => eq[slot] ?? null,
    (v) => rng.randcalcVaries(v),
    {
      brands: objReg.brands,
      slays: objReg.slays,
      curses: objReg.curses,
      properties: objReg.properties,
    },
  );
  return { p, eq, env };
}

/** A monster target with the given race flags and lore record. */
function target(
  store: LoreStore,
  ...flagIdx: number[]
): BrandSlayLearnTarget {
  const flags = new FlagSet(RF_SIZE);
  for (const f of flagIdx) flags.on(f);
  const race: MonsterRace = { ...realRace, flags };
  return { race, visible: true, lore: getLore(store, race) };
}

/** Body armor carrying the fire brand (off-weapon gear). */
function brandedArmor(): GameObject {
  const o = objectNew(kindOfTval(TV.SOFT_ARMOR));
  o.brands = new Array<boolean>(objReg.brands.length).fill(false);
  o.brands[fireBrand] = true;
  return o;
}

const temp = (brand: number, slay: number): TempBrandSlay => ({
  hasBrand: (i) => i === brand,
  hasSlay: (i) => i === slay,
});

describe("improve_attack_modifier obj == NULL (obj-slays.c:378-381,404-406)", () => {
  it("a temporary brand sets the modifier against a non-resistant monster", () => {
    const store: LoreStore = new Map();
    const mod: AttackModifier = { brand: 0, slay: 0, verb: "hit" };
    improveAttackModifier(
      null, target(store), objReg.brands, objReg.slays, mod, false, false,
      temp(fireBrand, -1),
    );
    expect(mod.brand).toBe(fireBrand);
    expect(mod.slay).toBe(0);
  });

  it("a temporary slay sets the modifier against a matching monster", () => {
    const store: LoreStore = new Map();
    const mod: AttackModifier = { brand: 0, slay: 0, verb: "hit" };
    improveAttackModifier(
      null, target(store, RF.EVIL), objReg.brands, objReg.slays, mod, false,
      false, temp(-1, evilSlay),
    );
    expect(mod.slay).toBe(evilSlay);
  });

  it("without a temp predicate the obj == NULL call is a no-op", () => {
    const store: LoreStore = new Map();
    const mod: AttackModifier = { brand: 0, slay: 0, verb: "hit" };
    improveAttackModifier(
      null, target(store, RF.EVIL), objReg.brands, objReg.slays, mod, false,
    );
    expect(mod.brand).toBe(0);
    expect(mod.slay).toBe(0);
  });
});

describe("learn_brand_slay_from_throw allow_off = false (obj-slays.c:629-634, gap 3.1)", () => {
  it("a throw does NOT learn the brand rune carried by worn off-weapon gear", () => {
    const { p, eq, env } = fixture();
    /* Fire-branded armor in a non-weapon slot ("body" is slot 6). */
    const bodySlot = p.body.slots.findIndex((s) => s.type === "BODY_ARMOR");
    eq[bodySlot] = brandedArmor();

    const store: LoreStore = new Map();
    const missile = objectNew(kindOfTval(TV.SHOT));
    learnBrandSlayFromThrow(p, env, missile, target(store));
    expect(playerKnowsBrand(p, fireBrand)).toBe(false);
  });

  it("melee (allow_off = true, obj-slays.c:596-600) DOES learn it", () => {
    const { p, eq, env } = fixture();
    const bodySlot = p.body.slots.findIndex((s) => s.type === "BODY_ARMOR");
    eq[bodySlot] = brandedArmor();

    const store: LoreStore = new Map();
    learnBrandSlayFromMelee(p, env, null, target(store));
    expect(playerKnowsBrand(p, fireBrand)).toBe(true);
  });
});

describe("learn helper allow_temp (obj-slays.c:501-524,558-582, gap 3.6)", () => {
  it("a temporary brand teaches monster lore but not the rune", () => {
    const { p, env } = fixture();
    const store: LoreStore = new Map();
    const mon = target(store);
    learnBrandSlayFromMelee(p, env, null, mon, temp(fireBrand, -1));
    /* Lore learned the resist/vulnerability flags... */
    const brand = objReg.brands[fireBrand]!;
    expect(mon.lore!.flags.has(brand.resistFlag)).toBe(true);
    expect(mon.lore!.flags.has(brand.vulnFlag)).toBe(true);
    /* ...but the rune itself is NOT learned (upstream: if (learn)). */
    expect(playerKnowsBrand(p, fireBrand)).toBe(false);
  });

  it("a temporary slay teaches the race flag but not the rune", () => {
    const { p, env } = fixture();
    const store: LoreStore = new Map();
    const mon = target(store, RF.EVIL);
    learnBrandSlayFromMelee(p, env, null, mon, temp(-1, evilSlay));
    const slay = objReg.slays[evilSlay]!;
    expect(mon.lore!.flags.has(slay.raceFlag)).toBe(true);
    expect(playerKnowsSlay(p, evilSlay)).toBe(false);
  });

  it("throw/launch never consult temporary brands (allow_temp = false)", () => {
    const { p, env } = fixture();
    const store: LoreStore = new Map();
    const mon = target(store);
    const missile = objectNew(kindOfTval(TV.SHOT));
    learnBrandSlayFromThrow(p, env, missile, mon);
    const brand = objReg.brands[fireBrand]!;
    expect(mon.lore!.flags.has(brand.resistFlag)).toBe(false);
  });
});
