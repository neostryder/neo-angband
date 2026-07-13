import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Rng } from "../rng";
import { TV, RF } from "../generated";
import { startGame } from "../session/game";
import type { GamePack } from "../session/game";
import { objectPrep } from "./make";
import { objectInfoTextblock, type ObjectInfoExtras } from "../game/object-inspect";
import { textblockToString } from "./object-info";
import { OBJ_NOTICE, playerLearnAllRunes } from "./knowledge";
import { ORIGIN } from "../generated/origins";
import type { GameObject } from "./object";
import type { GameState } from "../game/context";

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

/** A booted game with all runes learned and everything flavour-aware. */
function boot(): {
  state: GameState;
  extras: ObjectInfoExtras;
  prep: (name: string, tval: number, over?: Partial<GameObject>) => GameObject;
} {
  const { state, booted, registry } = startGame(pack, { seed: 123, depth: 1 });
  const reg = booted.registries;
  /* Test override: know every rune and treat every flavour as identified so the
     knowledge shadow reveals full details deterministically. */
  playerLearnAllRunes(state.actor.player, state.runeEnv);
  state.isAware = () => true;

  const races = reg.monsters.races;
  void registry;
  const extras: ObjectInfoExtras = {
    projections: reg.projections ?? [],
    constants: reg.constants,
    raceOrigin: (h) => {
      const race = races[h];
      if (!race) return null;
      return {
        name: race.name,
        unique: race.flags.has(RF.UNIQUE),
        comma: race.flags.has(RF.NAME_COMMA),
      };
    },
  };

  /* Deterministic object prep: a throwaway rng and the MINIMISE aspect never
     draw entropy, so state.rng is untouched. */
  const prepRng = new Rng(1);
  const prep = (name: string, tval: number, over: Partial<GameObject> = {}): GameObject => {
    const kind = reg.objects.kinds.find(
      (k) => k.tval === tval && k.name.replace(/[~&]/g, "").trim().toLowerCase().includes(name.toLowerCase()),
    );
    if (!kind) throw new Error(`no kind ${name} (tval ${tval})`);
    const obj = objectPrep(prepRng, reg.objects, reg.constants, kind, 1, "minimise");
    obj.notice |= OBJ_NOTICE.ASSESSED;
    obj.number = 1;
    return Object.assign(obj, over);
  };

  return { state, extras, prep };
}

function info(state: GameState, obj: GameObject, extras: ObjectInfoExtras): string {
  return textblockToString(objectInfoTextblock(state, obj, extras));
}

describe("objectInfo / object_info_out (obj-info.c L2315)", () => {
  it("a plain dagger: combat info, blows and average damage", () => {
    const { state, extras, prep } = boot();
    const dagger = prep("dagger", TV.SWORD, { origin: ORIGIN.NONE });
    const text = info(state, dagger, extras);
    expect(text).toContain("Combat info:");
    expect(text).toMatch(/\d+\.\d+ blows?\/round\./);
    expect(text).toMatch(/Average damage\/round: \d/);
  });

  it("a weapon of *Slay Evil*: slay line and damage breakdown", () => {
    const { state, extras, prep } = boot();
    const dagger = prep("dagger", TV.SWORD, { origin: ORIGIN.NONE });
    /* Add the EVIL_2 slay by index. */
    const slays = state.runeEnv.slays;
    const evil = slays.findIndex((s) => s?.code === "EVIL_2");
    expect(evil).toBeGreaterThan(0);
    dagger.slays = new Array<boolean>(slays.length).fill(false);
    dagger.slays[evil] = true;
    const text = info(state, dagger, extras);
    expect(text).toContain("Slays evil");
    expect(text).toMatch(/vs .*evil/);
    expect(text).toMatch(/vs\. others\./);
  });

  it("a ring of resist fire: resistance line, no combat block", () => {
    const { state, extras, prep } = boot();
    const ring = prep("resist fire", TV.RING, { origin: ORIGIN.NONE });
    const text = info(state, ring, extras);
    expect(text).toContain("Provides resistance to fire");
    expect(text).not.toContain("Combat info:");
  });

  it("a lantern: intensity and refuel text", () => {
    const { state, extras, prep } = boot();
    const lantern = prep("lantern", TV.LIGHT, { origin: ORIGIN.NONE });
    const tb = objectInfoTextblock(state, lantern, extras);
    const text = textblockToString(tb);
    expect(text).toContain("Intensity");
    expect(text).toContain("light.");
    expect(text).toMatch(/Refills other lanterns up to \d+ turns of fuel\.|Cannot be refueled\./);
    /* The intensity number is coloured L_GREEN (13). */
    const green = tb.runs.find((r) => r.attr === 13 && /^\d+$/.test(r.text));
    expect(green).toBeTruthy();
  });

  it("a wand: effect via describeEffect, recharge and success%", () => {
    const { state, extras, prep } = boot();
    const wand = prep("stinking cloud", TV.WAND, { origin: ORIGIN.NONE });
    const text = info(state, wand, extras);
    /* The real effect_describe output, not the platitude fallback. */
    expect(text).toContain("When used, it");
    expect(text).not.toBe("It requires a target. It can be used.");
    expect(text).toMatch(/Your chance of success is \d+\.\d+%/);
  });
});

describe("describe_origin (obj-info.c L2177)", () => {
  it("ORIGIN_FLOOR names the depth as feet and level", () => {
    const { state, extras, prep } = boot();
    const obj = prep("dagger", TV.SWORD, { origin: ORIGIN.FLOOR, originDepth: 2 });
    expect(info(state, obj, extras)).toContain(
      "Found lying on the floor at 100 feet (level 2)",
    );
  });

  it("ORIGIN_STORE and ORIGIN_BIRTH use their fixed phrasing", () => {
    const { state, extras, prep } = boot();
    expect(info(state, prep("dagger", TV.SWORD, { origin: ORIGIN.STORE }), extras)).toContain(
      "Bought from a store",
    );
    expect(info(state, prep("dagger", TV.SWORD, { origin: ORIGIN.BIRTH }), extras)).toContain(
      "An inheritance from your family",
    );
  });

  it("args=-1 origins (NONE/STOLEN) print no origin line", () => {
    const { state, extras, prep } = boot();
    const none = info(state, prep("dagger", TV.SWORD, { origin: ORIGIN.NONE }), extras);
    expect(none).not.toContain("Found lying");
    expect(none).not.toContain("Bought from");
    /* A dagger still has a combat block, so it is not the "no abilities" case. */
    expect(none).toContain("Combat info:");
  });

  it("ORIGIN_DROP names the monster with a/an and RF_UNIQUE bareness", () => {
    const { state, extras, prep } = boot();
    /* Find a non-unique and a unique race by handle via the resolver. */
    let normalHandle = -1;
    let uniqueHandle = -1;
    for (let h = 1; h < 2000 && (normalHandle < 0 || uniqueHandle < 0); h++) {
      const r = extras.raceOrigin?.(h);
      if (!r) continue;
      if (r.unique && uniqueHandle < 0) uniqueHandle = h;
      if (!r.unique && normalHandle < 0) normalHandle = h;
    }
    if (normalHandle > 0) {
      const nr = extras.raceOrigin?.(normalHandle);
      const obj = prep("dagger", TV.SWORD, {
        origin: ORIGIN.DROP,
        originDepth: 2,
        originRace: normalHandle,
      });
      const text = info(state, obj, extras);
      const article = "aeiouAEIOU".includes(nr!.name[0] ?? "") ? "an " : "a ";
      expect(text).toContain(`Dropped by ${article}${nr!.name}`);
    }
    if (uniqueHandle > 0) {
      const ur = extras.raceOrigin?.(uniqueHandle);
      const obj = prep("dagger", TV.SWORD, {
        origin: ORIGIN.DROP,
        originDepth: 2,
        originRace: uniqueHandle,
      });
      const text = info(state, obj, extras);
      /* Uniques appear bare (no article). */
      expect(text).toContain(`Dropped by ${ur!.name}`);
    }
  });
});

describe("knowledge gating", () => {
  it("omits an element resist whose rune is unknown", () => {
    /* Fresh boot WITHOUT learning runes. */
    const { state, booted, registry } = startGame(pack, { seed: 5, depth: 1 });
    const reg = booted.registries;
    state.isAware = () => true;
    void registry;
    const extras: ObjectInfoExtras = {
      projections: reg.projections ?? [],
      constants: reg.constants,
    };
    const prepRng = new Rng(1);
    const kind = reg.objects.kinds.find(
      (k) => k.tval === TV.RING && k.name.toLowerCase().includes("resist fire"),
    )!;
    const ring = objectPrep(prepRng, reg.objects, reg.constants, kind, 1, "minimise");
    ring.notice |= OBJ_NOTICE.ASSESSED;
    ring.origin = ORIGIN.NONE;
    const text = textblockToString(objectInfoTextblock(state, ring, extras));
    /* The resistance rune is unknown, so the resist line is withheld... */
    expect(text).not.toContain("Provides resistance to fire");
    /* ...and a non-useable assessed wearable states powers may be hidden. */
    expect(text).toContain("You do not know the full extent of this item's powers.");
  });
});

describe("RNG invariance (pure read)", () => {
  it("objectInfo does not advance the game RNG (dagger, wand, chest)", () => {
    const { state, extras, prep } = boot();
    const before = JSON.stringify(state.rng.getState());
    info(state, prep("dagger", TV.SWORD), extras);
    info(state, prep("stinking cloud", TV.WAND), extras);
    /* A chest: inspect describes it and must roll nothing. */
    const chest = prep("small wooden chest", TV.CHEST, { origin: ORIGIN.FLOOR, originDepth: 1 });
    info(state, chest, extras);
    const after = JSON.stringify(state.rng.getState());
    expect(after).toBe(before);
  });
});

describe("O-combat damage path (birth_percent_damage)", () => {
  it("renders an average-damage line with the option on", () => {
    const { state, extras, prep } = boot();
    state.options?.set?.("birth_percent_damage", true);
    const dagger = prep("dagger", TV.SWORD, { origin: ORIGIN.NONE });
    const text = info(state, dagger, extras);
    expect(text).toMatch(/Average damage\/round: \d/);
  });
});
